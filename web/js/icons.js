/**
 * Inline SVG icons — stroke-based, 1.5px, currentColor.
 *
 * Deliberately hand-rolled rather than an icon package: the app must run
 * offline, and this is a handful of glyphs. Emoji are never used as icons.
 */

const svg = (paths, size = 24, extra = '') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
     stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
     aria-hidden="true" focusable="false" ${extra}>${paths}</svg>`;

export const icons = {
  /**
   * Brand mark — a precision aperture.
   *
   * An open outer ring broken by four alignment gaps, a tighter inner aperture
   * and a solid core: an instrument locking focus, not a camera. Stroked with
   * the blue -> indigo -> violet brand gradient defined once in index.html.
   */
  reticle: (size = 26) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
       stroke="url(#markGrad)" stroke-width="1.35" stroke-linecap="round"
       aria-hidden="true" focusable="false">
      <path d="M12 2.6a9.4 9.4 0 0 1 9.4 9.4" opacity=".95"/>
      <path d="M21.4 12a9.4 9.4 0 0 1-9.4 9.4" opacity=".62"/>
      <path d="M12 21.4A9.4 9.4 0 0 1 2.6 12" opacity=".95"/>
      <path d="M2.6 12A9.4 9.4 0 0 1 12 2.6" opacity=".62"/>
      <path d="M12 6.6a5.4 5.4 0 0 1 5.4 5.4M12 17.4A5.4 5.4 0 0 1 6.6 12" opacity=".9"/>
      <circle cx="12" cy="12" r="1.75" fill="url(#markGrad)" stroke="none"/>
    </svg>`,

  upload: (s) => svg('<path d="M12 15V3m0 0L8 7m4-4 4 4"/><path d="M3 15v3a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-3"/>', s),
  inbox: (s) => svg('<path d="M3 12h4l2 3h6l2-3h4"/><path d="M5.5 5h13l2.5 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"/>', s),
  layers: (s) => svg('<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>', s),
  users: (s) => svg('<path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3.2"/><path d="M22 20v-2a4 4 0 0 0-3-3.8"/><path d="M16 3.2A3.2 3.2 0 0 1 16 9.6"/>', s),
  pulse: (s) => svg('<path d="M2 12h4l3-8 4 16 3-8h6"/>', s),
  bug: (s) => svg('<path d="M8 6a4 4 0 0 1 8 0"/><rect x="6" y="6" width="12" height="12" rx="6"/><path d="M3 11h3M18 11h3M3.6 17H6M18 17h2.4M4.5 6.5 6.8 8M19.5 6.5 17.2 8M12 12v6"/>', s),
  check: (s) => svg('<path d="M20 6 9 17l-5-5"/>', s),
  alert: (s) => svg('<path d="M12 8v5"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9.5"/>', s),
  search: (s) => svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>', s),
  clock: (s) => svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5.2l3.2 1.9"/>', s),
  database: (s) => svg('<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>', s),
  download: (s) => svg('<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/>', s),
  grid: (s) => svg('<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>', s),
};

export default icons;
