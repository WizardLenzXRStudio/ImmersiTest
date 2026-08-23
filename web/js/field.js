/**
 * THE DIAGNOSTIC FIELD — ImmersiTest's ambient background environment.
 *
 * The page sits inside a quiet XR diagnostic instrument that is always running.
 * Nothing here reacts to the cursor: the field has its own slow, autonomous
 * behaviour, so the interface feels observed by an instrument rather than
 * poked at by the reader.
 *
 * Six layers, all extremely faint, drawn to one 2D canvas:
 *
 *   1  FOCUS    a focal point drifting on a long Lissajous path (~2 min/cycle)
 *   2  LENS     concentric optical rings around it, breathing very slowly
 *   3  GRID     sparse coordinate ticks — fragments of a measuring lattice
 *   4  SCAN     a soft band sweeping the viewport, lifting whatever it crosses
 *   5  SIGNAL   a couple of low-amplitude trace lines, like an idle readout
 *   6  PARTICLE tiny telemetry motes drifting along gentle sine paths
 *
 * Performance is the governing constraint:
 *   - one canvas, one 2D context, no shadows, no per-item gradients
 *   - each layer is a single batched path with one stroke/fill
 *   - backing store capped at 1.5x DPR; the layer is deliberately near-invisible
 *   - the loop is throttled to ~30fps and parked entirely while the tab is hidden
 *   - density scales down on small viewports
 *
 * Fully disabled under prefers-reduced-motion — the field is atmosphere, never
 * information, so removing it costs the reader nothing.
 */

/* Brand accents. Alpha is applied per-layer; these are the hues only. */
const BLUE = '91,140,255';
const VIOLET = '169,129,247';
const INDIGO = '124,107,245';

const GRID = 94;          // px between coordinate ticks
const TICK = 3.2;         // px half-length of a tick arm
const FPS = 30;           // ambient motion does not need more
const SCAN_PERIOD = 41000;   // ms for one full sweep
const PULSE_PERIOD = 15000;  // ms between focus pulses
const DRIFT_PERIOD = 128000; // ms for one focal Lissajous cycle

export function initField(canvas) {
  if (!canvas) return () => {};

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduced) return () => {};

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return () => {};

  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  let w = 0;
  let h = 0;
  let cols = 0;
  let rows = 0;
  let particles = [];
  let raf = 0;
  let running = false;
  let last = 0;
  const started = performance.now();

  /* ------------------------------------------------------------- layout -- */

  function build() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cols = Math.ceil(w / GRID) + 1;
    rows = Math.ceil(h / GRID) + 1;

    // Fewer motes on small screens: the effect reads the same and phones stay cool.
    const count = w < 900 ? 16 : 34;
    particles = Array.from({ length: count }, (_, i) => ({
      x: Math.random(),                        // 0..1 of viewport width
      y: Math.random(),
      amp: 12 + Math.random() * 34,            // px of sine wander
      speed: 0.16 + Math.random() * 0.42,      // cycles per DRIFT period
      phase: Math.random() * Math.PI * 2,
      size: 0.7 + Math.random() * 0.9,
      warm: i % 3 === 0,                       // a third pick up the violet
    }));
  }

  /* -------------------------------------------------------------- layers -- */

  /** Focal point: a slow Lissajous path, always well inside the viewport. */
  function focus(t) {
    const a = (t / DRIFT_PERIOD) * Math.PI * 2;
    return {
      x: w * (0.5 + 0.26 * Math.sin(a)),
      y: h * (0.42 + 0.20 * Math.sin(a * 1.37 + 0.9)),
    };
  }

  /** Scan band centre, sweeping left to right and wrapping. */
  const scanX = (t) => ((t % SCAN_PERIOD) / SCAN_PERIOD) * (w + 620) - 310;

  /** How strongly the scan band lifts something at x. 0..1 */
  function lift(x, sx) {
    const d = Math.abs(x - sx);
    const R = 250;
    return d > R ? 0 : (1 - d / R) ** 2;
  }

  function drawRings(f, t) {
    // Breathing is tiny and very slow — it should never read as a pulse.
    const breathe = 1 + 0.035 * Math.sin((t / 21000) * Math.PI * 2);
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const r = (128 + i * 132) * breathe;
      ctx.strokeStyle = `rgba(${i === 1 ? INDIGO : BLUE},${0.05 - i * 0.009})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawPulse(f, t) {
    const phase = (t % PULSE_PERIOD) / PULSE_PERIOD;
    if (phase > 0.55) return;                  // silent for most of the cycle
    const e = phase / 0.55;
    const r = 60 + e * 340;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${VIOLET},${0.07 * (1 - e)})`;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * Coordinate ticks. Two batches only — one at rest, one lifted by the scan —
   * so the whole lattice costs two stroke calls regardless of density.
   */
  function drawGrid(sx) {
    const rest = [];
    const lit = [];
    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        // A sparse, stable subset reads as fragments of a lattice, not a grid.
        if ((ix * 7 + iy * 13) % 5 !== 0) continue;
        const x = ix * GRID;
        const y = iy * GRID;
        (lift(x, sx) > 0.35 ? lit : rest).push(x, y);
      }
    }
    const stroke = (pts, alpha) => {
      if (!pts.length) return;
      ctx.strokeStyle = `rgba(${BLUE},${alpha})`;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i];
        const y = pts[i + 1];
        ctx.moveTo(x - TICK, y);
        ctx.lineTo(x + TICK, y);
        ctx.moveTo(x, y - TICK);
        ctx.lineTo(x, y + TICK);
      }
      ctx.stroke();
    };
    ctx.lineWidth = 1;
    stroke(rest, 0.05);
    stroke(lit, 0.12);
  }

  function drawScan(sx) {
    const g = ctx.createLinearGradient(sx - 250, 0, sx + 250, 0);
    g.addColorStop(0, `rgba(${INDIGO},0)`);
    g.addColorStop(0.5, `rgba(${INDIGO},0.035)`);
    g.addColorStop(1, `rgba(${INDIGO},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(sx - 250, 0, 500, h);
  }

  /** Two idle readout traces, drifting horizontally at different rates. */
  function drawTraces(t) {
    ctx.lineWidth = 1;
    for (let k = 0; k < 2; k++) {
      const y0 = h * (k === 0 ? 0.30 : 0.72);
      const off = (t / (k === 0 ? 46000 : 61000)) * Math.PI * 2;
      ctx.strokeStyle = `rgba(${k === 0 ? BLUE : VIOLET},0.045)`;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 26) {
        const y = y0
          + Math.sin(x / 190 + off) * 13
          + Math.sin(x / 63 + off * 1.7) * 4;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function drawParticles(t, sx) {
    for (const p of particles) {
      const a = (t / DRIFT_PERIOD) * Math.PI * 2 * p.speed + p.phase;
      const x = p.x * w + Math.sin(a) * p.amp;
      const y = p.y * h + Math.cos(a * 0.83) * p.amp * 0.6;
      const alpha = 0.07 + lift(x, sx) * 0.16;
      ctx.fillStyle = `rgba(${p.warm ? VIOLET : BLUE},${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------------------------------------------------------------- loop -- */

  function render(now) {
    const t = now - started;
    const f = focus(t);
    const sx = scanX(t);

    ctx.clearRect(0, 0, w, h);
    drawScan(sx);
    drawRings(f, t);
    drawPulse(f, t);
    drawGrid(sx);
    drawTraces(t);
    drawParticles(t, sx);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / FPS) return;       // throttle: ambient needs no more
    last = now;
    render(now);
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  /* A hidden tab must cost nothing at all. */
  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }

  let resizeTimer;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      build();
      render(performance.now());
    }, 150);
  }

  build();
  start();
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);

  return function destroy() {
    stop();
    clearTimeout(resizeTimer);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export default initField;
