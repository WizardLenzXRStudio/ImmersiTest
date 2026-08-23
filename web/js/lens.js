/**
 * THE DIAGNOSTIC LENS — ImmersiTest's product signature.
 *
 * A precision aperture with telemetry inside it: an FPS trace, a frame-time
 * waveform, a target line and measurement ticks. It is deliberately NOT a
 * functional chart — the traces are fixed, hand-authored paths that read as
 * "an instrument inspecting something", not as data anyone should interpret.
 *
 * Everything is inline SVG so there is no image to download, no library, and
 * no second network request. The only motion is a slow parallax that follows
 * the pointer, and it is disabled entirely for reduced motion and for coarse
 * pointers, matching how The Field behaves.
 */

const reduced = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const finePointer = () =>
  window.matchMedia?.('(hover:hover) and (pointer:fine)').matches ?? false;

/** Measurement ticks around the aperture rim. */
function ticks() {
  const out = [];
  for (let i = 0; i < 72; i++) {
    const major = i % 6 === 0;
    const a = (i / 72) * Math.PI * 2 - Math.PI / 2;
    const r1 = 132;
    const r2 = r1 - (major ? 9 : 4.5);
    out.push(
      `<line x1="${(160 + Math.cos(a) * r1).toFixed(2)}" y1="${(160 + Math.sin(a) * r1).toFixed(2)}"
             x2="${(160 + Math.cos(a) * r2).toFixed(2)}" y2="${(160 + Math.sin(a) * r2).toFixed(2)}"
             stroke="currentColor" stroke-width="${major ? 1.1 : 0.6}" opacity="${major ? 0.5 : 0.26}"/>`,
    );
  }
  return out.join('');
}

/** A steady-ish FPS trace: readable as telemetry, not as a real measurement. */
const FPS_TRACE =
  'M44 116 L58 112 L70 118 L82 108 L94 113 L104 96 L116 110 L128 105 L140 112 '
  + 'L152 101 L164 109 L176 104 L188 118 L200 107 L212 111 L226 106 L240 113 L262 110';

/** Frame-time waveform, tighter amplitude, sitting below the FPS trace. */
const FRAME_TRACE =
  'M44 196 L60 199 L72 193 L84 201 L96 195 L108 205 L120 197 L132 200 L144 194 '
  + 'L156 202 L168 196 L180 199 L192 207 L204 198 L216 201 L230 197 L244 200 L262 198';

export function lensHTML() {
  return `
  <div class="lens" id="lens" aria-hidden="true">
    <svg viewBox="0 0 320 320" class="lens-svg" focusable="false">
      <defs>
        <radialGradient id="lensGlow" cx="50%" cy="42%" r="62%">
          <stop offset="0%"  stop-color="#5B8CFF" stop-opacity=".20"/>
          <stop offset="55%" stop-color="#7C6BF5" stop-opacity=".08"/>
          <stop offset="100%" stop-color="#A981F7" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="lensArc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stop-color="#5B8CFF"/>
          <stop offset="55%"  stop-color="#7C6BF5"/>
          <stop offset="100%" stop-color="#A981F7"/>
        </linearGradient>
        <clipPath id="lensClip"><circle cx="160" cy="160" r="118"/></clipPath>
      </defs>

      <!-- optical bloom -->
      <circle cx="160" cy="160" r="150" fill="url(#lensGlow)"/>

      <!-- rim + measurement ticks -->
      <g class="lens-rim" color="#7C86A0">${ticks()}</g>
      <circle cx="160" cy="160" r="140" fill="none" stroke="#262C42" stroke-width="1"/>
      <circle cx="160" cy="160" r="118" fill="none" stroke="#262C42" stroke-width="1"/>

      <!-- orbital arcs: the aperture reading -->
      <g class="lens-orbit">
        <circle cx="160" cy="160" r="129" fill="none" stroke="url(#lensArc)" stroke-width="1.6"
                stroke-linecap="round" stroke-dasharray="150 660" opacity=".85"/>
        <circle cx="160" cy="160" r="129" fill="none" stroke="url(#lensArc)" stroke-width="1.6"
                stroke-linecap="round" stroke-dasharray="42 768" stroke-dashoffset="-300" opacity=".55"/>
      </g>

      <!-- telemetry field -->
      <g clip-path="url(#lensClip)">
        <!-- micro grid -->
        <g class="lens-grid" stroke="#5B8CFF" stroke-width=".5" opacity=".13">
          ${[70, 100, 130, 160, 190, 220].map((y) => `<line x1="34" y1="${y}" x2="286" y2="${y}"/>`).join('')}
          ${[60, 100, 140, 180, 220, 260].map((x) => `<line x1="${x}" y1="52" x2="${x}" y2="252"/>`).join('')}
        </g>

        <!-- target line for the FPS trace -->
        <line x1="34" y1="106" x2="286" y2="106" stroke="#3FD07A" stroke-width="1"
              stroke-dasharray="3 5" opacity=".45"/>

        <path d="${FPS_TRACE}" fill="none" stroke="#5B8CFF" stroke-width="1.8"
              stroke-linejoin="round" stroke-linecap="round" class="lens-trace"/>
        <path d="${FRAME_TRACE}" fill="none" stroke="#A981F7" stroke-width="1.4"
              stroke-linejoin="round" stroke-linecap="round" class="lens-trace slow" opacity=".85"/>

        <!-- scan sweep -->
        <rect class="lens-scan" x="34" y="52" width="26" height="200" fill="url(#lensArc)" opacity=".07"/>
      </g>

      <!-- focus brackets -->
      <g stroke="url(#lensArc)" stroke-width="1.4" fill="none" stroke-linecap="round" class="lens-brackets">
        <path d="M92 62 H74 V80"/>
        <path d="M228 62 H246 V80"/>
        <path d="M92 258 H74 V240"/>
        <path d="M228 258 H246 V240"/>
      </g>

      <!-- core -->
      <circle cx="160" cy="160" r="2.6" fill="url(#lensArc)"/>
    </svg>

    <!-- telemetry readouts, positioned around the aperture -->
    <div class="lens-read tl"><span>FPS</span><b>72.4</b></div>
    <div class="lens-read tr"><span>TARGET</span><b>72 Hz</b></div>
    <div class="lens-read bl"><span>FRAME</span><b>13.8 ms</b></div>
    <div class="lens-read br"><span>MEMORY</span><b>1180 MB</b></div>
    <div class="lens-caption">INSPECTING</div>
  </div>`;
}

/**
 * Slow parallax on the lens layers. Stops entirely when the pointer is idle,
 * so an untouched hero costs nothing.
 */
export function initLens(root) {
  const lens = root?.querySelector?.('#lens') ?? document.getElementById('lens');
  if (!lens) return () => {};
  if (reduced() || !finePointer()) return () => {};

  const svg = lens.querySelector('.lens-svg');
  const rim = lens.querySelector('.lens-rim');
  const orbit = lens.querySelector('.lens-orbit');
  const brackets = lens.querySelector('.lens-brackets');

  let tx = 0;
  let ty = 0;
  let cx = 0;
  let cy = 0;
  let raf = 0;
  let running = false;

  const frame = () => {
    cx += (tx - cx) * 0.08;
    cy += (ty - cy) * 0.08;
    // Layers move by different amounts: the depth cue that sells "optics".
    if (svg) svg.style.transform = `translate3d(${(cx * 6).toFixed(2)}px, ${(cy * 6).toFixed(2)}px, 0)`;
    if (rim) rim.style.transform = `translate(${(cx * -4).toFixed(2)}px, ${(cy * -4).toFixed(2)}px)`;
    if (orbit) orbit.style.transform = `translate(${(cx * 9).toFixed(2)}px, ${(cy * 9).toFixed(2)}px)`;
    if (brackets) brackets.style.transform = `translate(${(cx * 13).toFixed(2)}px, ${(cy * 13).toFixed(2)}px)`;

    if (Math.abs(tx - cx) < 0.001 && Math.abs(ty - cy) < 0.001) {
      running = false;
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(frame);
  };

  const onMove = (e) => {
    const r = lens.getBoundingClientRect();
    // -1..1 relative to the lens centre, clamped so far-away movement saturates.
    tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width || 1)));
    ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height || 1)));
    start();
  };

  const onLeave = () => {
    tx = 0;
    ty = 0;
    start();
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerleave', onLeave, { passive: true });

  return function destroy() {
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerleave', onLeave);
  };
}
