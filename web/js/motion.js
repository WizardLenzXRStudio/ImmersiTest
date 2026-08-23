/**
 * Purposeful motion: staggered panel reveal, telemetry count-up, score-ring
 * draw. Every helper no-ops when the user prefers reduced motion, so the
 * interface arrives instantly and fully rendered rather than half-animated.
 */

export const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Reveals top-level panels in sequence. Elements start hidden via `.rise` and
 * are switched to `.rise.in`; with reduced motion they are simply shown.
 */
export function revealStagger(scope, selector = ':scope > .section, :scope > .stat-grid, :scope > .hero, :scope > .verdict, :scope > .page-head, :scope > #sessionGroups > .section') {
  const items = [...scope.querySelectorAll(selector)];
  if (!items.length) return;

  if (reducedMotion()) {
    items.forEach((el) => el.classList.remove('rise'));
    return;
  }
  items.forEach((el) => el.classList.add('rise'));
  requestAnimationFrame(() => {
    items.forEach((el, i) => {
      // 45ms apart: fast enough to feel instant, slow enough to read as a sweep.
      setTimeout(() => el.classList.add('in'), Math.min(i * 45, 360));
    });
  });
}

/**
 * Route transition. List routes cross-fade; opening a single object uses the
 * "focus acquisition" settle so the interface reads as locking onto it.
 */
export function pageEnter(main, isDetail = false) {
  main.classList.remove('page-enter', 'focus-acquire');
  if (reducedMotion()) return;
  void main.offsetWidth; // restart the animation
  main.classList.add(isDetail ? 'focus-acquire' : 'page-enter');
}

/**
 * Telemetry-style count-up on any `[data-count]` element inside `scope`.
 * The final value is written first so the DOM is always correct even if the
 * animation is skipped or interrupted.
 */
export function countUp(scope) {
  const els = [...scope.querySelectorAll('[data-count]')];
  if (!els.length) return;

  for (const el of els) {
    const to = Number(el.dataset.count);
    const dec = Number(el.dataset.dec ?? 0);
    const suffix = el.dataset.suffix ?? '';
    if (!Number.isFinite(to)) continue;

    const final = to.toLocaleString(undefined, {
      minimumFractionDigits: dec, maximumFractionDigits: dec,
    }) + suffix;

    if (reducedMotion() || to === 0) { el.textContent = final; continue; }

    const dur = 780;
    const t0 = performance.now();
    const ease = (x) => 1 - Math.pow(1 - x, 3);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const v = to * ease(k);
      el.textContent = v.toLocaleString(undefined, {
        minimumFractionDigits: dec, maximumFractionDigits: dec,
      }) + suffix;
      if (k < 1) requestAnimationFrame(step);
      else el.textContent = final;
    };
    requestAnimationFrame(step);
  }
}

/**
 * Score ring markup. `score` 0-100, `status` drives the stroke colour.
 * The arc is drawn from 0 by animating stroke-dashoffset after mount.
 */
export function scoreRingHTML(score, status, { size = 104, label = 'Score' } = {}) {
  const r = (size - 14) / 2;
  const circ = 2 * Math.PI * r;
  return `<div class="score-ring ${status}" data-ring="${score}" data-circ="${circ.toFixed(2)}"
      role="img" aria-label="Score ${score} out of 100">
    <svg viewBox="0 0 ${size} ${size}">
      <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}"/>
      <circle class="prog"  cx="${size / 2}" cy="${size / 2}" r="${r}"
        stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${circ.toFixed(2)}"/>
    </svg>
    <div class="rv">
      <b data-count="${score}">0</b>
      <small>${label}</small>
    </div>
  </div>`;
}

/** Animates any score rings inside `scope` to their value. */
export function drawRings(scope) {
  for (const ring of scope.querySelectorAll('[data-ring]')) {
    const circ = Number(ring.dataset.circ);
    const pct = Math.max(0, Math.min(100, Number(ring.dataset.ring))) / 100;
    const prog = ring.querySelector('.prog');
    if (!prog) continue;
    const target = circ * (1 - pct);
    if (reducedMotion()) { prog.style.strokeDashoffset = String(target); continue; }
    requestAnimationFrame(() => { prog.style.strokeDashoffset = String(target); });
  }
}

/** Chart.js animation duration, honouring the motion preference. */
export const chartAnim = () => (reducedMotion() ? 0 : 700);
