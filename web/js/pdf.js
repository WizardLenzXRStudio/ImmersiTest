/**
 * ImmersiTest — XR Application Test Report PDF.
 *
 * Uses jsPDF, vendored locally at /vendor/jspdf.umd.min.js, so this works with
 * no internet. Charts are re-rendered on a detached canvas with a light palette
 * because the dashboard's dark theme is unreadable on paper.
 *
 * The document is a professional QA artefact: it carries Wizardlenz XR Studio
 * branding and describes an application, never a person's academic work.
 */
import {
  GRADE_CONFIG, SCORE_LABEL, CHECKLIST, badFramePct,
  xrHealth, xrDoctor, fixFirst, recommendations, areaBreakdown, HEALTH_LABEL,
} from '/shared/xr-metrics/index.js';

const PRODUCT = 'ImmersiTest';
const TAGLINE = 'Test the Experience. Trust the Immersion.';
/** Full legal entity. The PDF is a formal deliverable, so it never abbreviates. */
const VENDOR_LEGAL = 'Wizardlenz XR Studio (OPC) Pvt Ltd';

/**
 * The official Wizardlenz XR Studio mark, resolved relative to this module so
 * it works whatever route the dashboard happens to be on.
 */
const VENDOR_MARK_URL = new URL('../assets/wizardlenz-logo.png', import.meta.url).href;

/**
 * Loads the vendor mark once per session and caches it.
 *
 * The supplied logo is the reversed-out variant: the glyph is coloured, but the
 * "wizardlenz" wordmark is pure white, so roughly half the artwork disappears
 * on the PDF's white page. There is no dark variant in the project. Rather than
 * recolour the mark — which would alter the identity — the header paints it on
 * a dark brand plate, exactly the way a reversed logo is used on light stock.
 * The PNG itself is embedded byte-for-byte and never modified.
 *
 * Returns null (and the header falls back to text only) if the asset cannot be
 * read, so a missing file can never cost someone their report.
 */
let vendorMarkPromise = null;

function loadVendorMark() {
  if (vendorMarkPromise) return vendorMarkPromise;

  vendorMarkPromise = (async () => {
    try {
      const res = await fetch(VENDOR_MARK_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error ?? new Error('could not read the logo'));
        reader.readAsDataURL(blob);
      });

      // Intrinsic size is read back from the decoded image, so the aspect ratio
      // written into the PDF is the file's own — never a hard-coded guess.
      const img = new Image();
      img.src = dataUrl;
      await img.decode();

      return { dataUrl, w: img.naturalWidth, h: img.naturalHeight };
    } catch (err) {
      console.warn('[pdf] vendor mark unavailable; header falls back to text only', err);
      return null;
    }
  })();

  return vendorMarkPromise;
}

const CHECK_LABEL = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
const SEVERITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const BUG_STATUS_LABEL = {
  open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed',
};

// Print palette: darker shades that read well on white.
const C = {
  text: [24, 28, 42], gray: [92, 100, 122], line: [208, 213, 228], soft: [246, 247, 252],
  pass: [26, 127, 55], warn: [154, 103, 0], fail: [180, 35, 24],
  neutral: [92, 100, 122],
  accent: [59, 100, 214],   // electric blue, darkened for print
  indigo: [92, 78, 208],
  violet: [126, 88, 200],
};
const statusColor = (j) => ({ pass: C.pass, warn: C.warn, fail: C.fail }[j] ?? C.neutral);
const healthColor = (s) =>
  ({ healthy: C.pass, attention: C.warn, critical: C.fail }[s] ?? C.neutral);

export function reportFilename(report) {
  const slug = (s) =>
    (s || 'unknown')
      .toString()
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'unknown';
  const date = new Date(report.capturedAt);
  const stamp = Number.isNaN(date.getTime()) ? 'unknown_date' : date.toISOString().slice(0, 10);
  return `ImmersiTest_Report_${slug(report.projectName)}_${stamp}.pdf`;
}

/**
 * Renders one chart offscreen with a light theme and returns a JPEG data URL.
 * Returns null when there is no series or Chart.js is unavailable.
 */
function chartImage({ series, label, valueKey, colour, targetValue, targetLabel, yTitle }) {
  if (!series?.length || typeof Chart === 'undefined') return null;

  const cv = document.createElement('canvas');
  cv.width = 1100;
  cv.height = 300;

  const whiteBg = {
    id: 'whiteBg',
    beforeDraw(c) {
      const x = c.ctx;
      x.save();
      x.globalCompositeOperation = 'destination-over';
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, c.width, c.height);
      x.restore();
    },
  };

  const datasets = [
    {
      label,
      data: series.map((p) => p[valueKey]),
      borderColor: colour,
      backgroundColor: `${colour}14`,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
      fill: true,
    },
  ];
  if (targetValue != null) {
    datasets.push({
      label: targetLabel,
      data: series.map(() => targetValue),
      borderColor: '#1a7f37',
      borderWidth: 1,
      borderDash: [3, 3],
      pointRadius: 0,
    });
  }

  const chart = new Chart(cv, {
    type: 'line',
    data: { labels: series.map((p) => (+p.t).toFixed(1)), datasets },
    options: {
      responsive: false,
      animation: false,
      devicePixelRatio: 2,
      plugins: { legend: { labels: { color: '#24292f', font: { size: 13 }, boxWidth: 14 } } },
      scales: {
        x: {
          ticks: { color: '#57606a', maxTicksLimit: 12 },
          grid: { color: '#e6eaef' },
          title: { display: true, text: 'seconds', color: '#57606a', font: { size: 12 } },
        },
        y: {
          min: 0,
          ticks: { color: '#57606a' },
          grid: { color: '#e6eaef' },
          title: { display: true, text: yTitle, color: '#57606a', font: { size: 12 } },
        },
      },
    },
    plugins: [whiteBg],
  });

  let url = null;
  try {
    url = chart.toBase64Image('image/jpeg', 0.92);
  } catch {
    url = null;
  }
  chart.destroy();
  return url;
}

/**
 * Builds and downloads the XR Application Test Report.
 *
 * @param {object} s      the report (hosted analysis report or local session)
 * @param {object|null} g the computed grade (null for an invalid capture)
 */
export async function downloadReportPdf(s, g) {
  const { jsPDF } = window.jspdf ?? {};
  if (!jsPDF) throw new Error('The PDF library is not loaded.');

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const M = 40;
  const W = 595;
  const H = 842;
  const CW = W - 2 * M;
  const invalid = s.captureStatus === 'invalid' || !(s.totalFrames > 0);
  const ctx = { checklist: s.checklist ?? {} };

  let y = M;
  let page = 1;

  const footer = () => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.gray);
    // Year is evaluated at render time, so a report built in 2027 says 2027.
    doc.text(
      `${PRODUCT}  ·  © ${new Date().getFullYear()} ${VENDOR_LEGAL}. All rights reserved.`
        + `  ·  generated ${new Date().toLocaleString()}`,
      M,
      H - 22,
    );
    doc.text(`Page ${page}`, W - M, H - 22, { align: 'right' });
  };

  /** Starts a new page when `needed` points will not fit. */
  const room = (needed) => {
    if (y + needed <= H - 46) return;
    footer();
    doc.addPage();
    page += 1;
    y = M;
  };

  const heading = (text) => {
    room(40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...C.text);
    doc.text(text, M, y);
    y += 6;
    doc.setDrawColor(...C.line);
    doc.line(M, y, W - M, y);
    y += 14;
  };

  const para = (text, { size = 9, color = C.gray, indent = 0, italic = false } = {}) => {
    const lines = doc.splitTextToSize(text, CW - indent);
    room(lines.length * (size + 2.5) + 6);
    doc.setFont('helvetica', italic ? 'italic' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(lines, M + indent, y);
    y += lines.length * (size + 2.5);
  };

  /* ------------------------------------------------------------ header -- */

  // Vendor mark first, product identity beneath it. The plate is deliberately
  // small: it reads as an official mark of origin, not as the document's title.
  const mark = await loadVendorMark();
  if (mark) {
    const markH = 15;                                  // well under the 17pt product title
    const markW = markH * (mark.w / mark.h);           // the file's own ratio, never forced
    const padX = 9;
    const padY = 6;
    const plateW = markW + padX * 2;
    const plateH = markH + padY * 2;

    doc.setFillColor(...C.text);                       // brand dark, so the reversed mark reads
    doc.roundedRect(M, y, plateW, plateH, 5, 5, 'F');
    doc.addImage(mark.dataUrl, 'PNG', M + padX, y + padY, markW, markH);

    y += plateH + 13;                                  // breathing room before the product name
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...C.text);
  doc.text(PRODUCT, M, y + 4);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.accent);
  doc.text(TAGLINE, M, y + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...C.gray);
  doc.text(`XR APPLICATION TEST REPORT   ·   Built by ${VENDOR_LEGAL}`, M, y + 31);

  // Quality classification badge, top-right.
  if (g) {
    const bw = 62;
    const bh = 44;
    const bx = W - M - bw;
    const by = y - 8;
    doc.setFillColor(...statusColor(g.status));
    doc.roundedRect(bx, by, bw, bh, 6, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.text(g.grade, bx + bw / 2, by + bh / 2 + 8, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.gray);
    doc.text(`${g.score}/100`, bx + bw / 2, by + bh + 11, { align: 'center' });
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...C.gray);
    doc.text('SCORE N/A', W - M, y + 8, { align: 'right' });
  }
  y += 48;

  doc.setDrawColor(...C.line);
  doc.line(M, y, W - M, y);
  y += 18;

  /* ------------------------------------------------------ identification */
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...C.text);
  doc.text(doc.splitTextToSize(s.projectName ?? '—', CW), M, y);
  y += 18;

  const pairs = [
    ['Report ID', s.id ?? '—'],
    ['Test Date', new Date(s.capturedAt).toLocaleString()],
    ['Duration', `${Number(s.durationSec ?? 0).toFixed(1)} s`],
    ['Platform', s.platform ?? '—'],
    ['Target FPS', `${s.targetFps} Hz`],
    ['Device', s.device ?? '—'],
    ['GPU', s.gpu ?? '—'],
    ['OS', s.os ?? '—'],
    // Tester identity is optional metadata and only printed when supplied.
    ...(s.testerName ? [['Tester', s.testerName]] : []),
  ];
  doc.setFontSize(9);
  const colW = CW / 3;
  pairs.forEach(([label, value], i) => {
    const x = M + (i % 3) * colW;
    const py = y + Math.floor(i / 3) * 26;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.gray);
    doc.text(label.toUpperCase(), x, py);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.text);
    doc.text(doc.splitTextToSize(String(value), colW - 8)[0] ?? '—', x, py + 12);
  });
  y += Math.ceil(pairs.length / 3) * 26 + 12;

  /* ------------------------------------------------------- performance -- */
  heading('Performance');

  if (invalid) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...C.gray);
    doc.text('INVALID CAPTURE', M, y);
    y += 14;
    para(
      'The profiler ran but recorded no frames, so this test carries no performance evidence. '
      + 'Score and status are N/A. This is a capture problem, not an application failure.',
    );
    y += 8;
  } else {
    const dropPct = badFramePct(s);
    const m = g?.metrics ?? {};
    const marks = g?.metricMarks ?? {};
    const cells = [
      ['Average FPS', Number(s.avgFps).toFixed(1), m.avgFps, marks.avgFps],
      ['Bad Frame %', dropPct == null ? '—' : `${dropPct.toFixed(1)} %`, m.badFrames, marks.badFrames],
      ['Avg Frame Time', `${Number(s.avgFrameMs).toFixed(2)} ms`, m.frameTime, marks.frameTime],
      ['Memory', s.memoryMB > 0 ? `${Number(s.memoryMB).toFixed(0)} MB` : '—', m.memory, marks.memory],
    ];

    const cols = 4;
    const gap = 10;
    const cw = (CW - gap * (cols - 1)) / cols;
    const ch = 62;
    room(ch + 8);
    cells.forEach((c, i) => {
      const x = M + i * (cw + gap);
      doc.setDrawColor(...C.line);
      doc.setFillColor(...C.soft);
      doc.roundedRect(x, y, cw, ch, 5, 5, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.gray);
      doc.text(c[0].toUpperCase(), x + 8, y + 14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...C.text);
      doc.text(String(c[1]), x + 8, y + 34);
      doc.setFontSize(7.5);
      doc.setTextColor(...statusColor(c[2]));
      doc.text(
        `${CHECK_LABEL[c[2]] ?? '—'}${c[3] != null ? `   ${c[3]}/${GRADE_CONFIG.performance.pass}` : ''}`,
        x + 8,
        y + 50,
      );
    });
    y += ch + 16;

    /* ------------------------------------------------------ diagnostics -- */
    room(46);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.gray);
    doc.text('DIAGNOSTIC — CAPTURED BUT NOT SCORED', M, y);
    y += 12;
    const diag = [
      ['Minimum FPS', s.minFps == null ? '—' : Number(s.minFps).toFixed(1)],
      ['1% Low FPS', s.onePercentLowFps == null ? '—' : Number(s.onePercentLowFps).toFixed(1)],
      ['Draw Calls', s.drawCalls == null ? '—' : String(s.drawCalls)],
      ['Triangles', s.triangles == null ? '—' : Number(s.triangles).toLocaleString()],
      ['Battery', s.batteryLevel == null ? '—' : `${Math.round(s.batteryLevel * 100)}%`],
    ];
    const dw = CW / diag.length;
    diag.forEach(([label, value], i) => {
      const x = M + i * dw;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.gray);
      doc.text(label.toUpperCase(), x, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...C.text);
      doc.text(value, x, y + 13);
    });
    y += 28;
  }

  /* ------------------------------------------------------ xr validation -- */
  // Deliberately BEFORE the score: these eight human judgements carry 40 of the
  // 100 marks, so the reader meets them before the number they feed into.
  // Rendered for an invalid capture too, exactly as it always was.
  heading('XR Validation');
  const items = s.checklistItems ?? CHECKLIST;
  items.forEach((c) => {
    const value = s.checklist?.[c.id];
    const note = s.checklistNotes?.[c.id];
    const label = `${c.n ?? ''} ${c.t}`.trim();
    const lines = doc.splitTextToSize(label, CW - 130);
    const noteLines = note ? doc.splitTextToSize(`Note: ${note}`, CW - 130) : [];
    room(lines.length * 11 + noteLines.length * 10 + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...C.text);
    doc.text(lines, M, y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...statusColor(value ?? 'neutral'));
    doc.text(
      value ? `${CHECK_LABEL[value]}   ${GRADE_CONFIG.checklist[value]}/${GRADE_CONFIG.checklist.pass}` : 'NOT ASSESSED   0/5',
      W - M,
      y,
      { align: 'right' },
    );

    y += lines.length * 11;
    if (noteLines.length) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(...C.gray);
      doc.text(noteLines, M + 10, y);
      y += noteLines.length * 10;
    }
    y += 4;
    doc.setDrawColor(238, 241, 245);
    doc.line(M, y - 2, W - M, y - 2);
  });
  y += 10;

  if (!invalid) {
    /* ---------------------------------------------------- score summary -- */
    if (g) {
      room(52);
      doc.setDrawColor(...C.line);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(M, y, CW, 40, 5, 5, 'FD');
      // Four columns, sized to what each actually needs at its own font size.
      // The first three carry short fixed labels (121 / 65 / 68 pt at 8pt), so
      // the old 163 / 90 / 120 pt allocation starved BREAKDOWN: its value is
      // 171 pt wide and ran 41 pt past the right margin, off the page.
      const PAD = 12;                       // inner padding, both card edges
      const COL = { score: 12, grade: 145, status: 220, breakdown: 300 };
      const bdX = M + COL.breakdown;
      const bdMaxW = M + CW - PAD - bdX;    // hard stop inside the card

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...C.gray);
      doc.text(SCORE_LABEL.toUpperCase(), M + COL.score, y + 15);
      doc.text('CLASSIFICATION', M + COL.grade, y + 15);
      doc.text('OVERALL STATUS', M + COL.status, y + 15);
      doc.text('BREAKDOWN', bdX, y + 15);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...C.text);
      doc.text(`${g.score} / 100`, M + COL.score, y + 31);
      doc.text(g.grade, M + COL.grade, y + 31);
      doc.setTextColor(...statusColor(g.status));
      doc.text(CHECK_LABEL[g.status] ?? '—', M + COL.status, y + 31);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...C.gray);
      // Wrapping is a guarantee rather than the mechanism: the rebalanced
      // column already fits this string, but splitting means no future label
      // or score width can push it over the margin again.
      const bdLines = doc.splitTextToSize(
        `Performance ${g.performanceScore}/${GRADE_CONFIG.maxPerformance}   ·   XR validation ${g.checklistScore}/${GRADE_CONFIG.maxChecklist}`,
        bdMaxW,
      );
      doc.text(bdLines, bdX, bdLines.length > 1 ? y + 25 : y + 31, { lineHeightFactor: 1.15 });
      y += 52;
    }

    /* --------------------------------------------------- evaluation areas */
    const areas = areaBreakdown(s, ctx);
    if (areas) {
      heading('Evaluation Areas');
      para('Technical Performance is the 60-mark Performance Score. The remaining 40 marks are the eight '
         + 'XR Validation items, grouped by theme. These buckets classify the same 100 marks; they do not add to them.',
         { size: 8, italic: true });
      y += 4;
      const gap = 10;
      const aw = (CW - gap * (areas.length - 1)) / areas.length;
      room(52);
      areas.forEach((a, i) => {
        const x = M + i * (aw + gap);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...C.gray);
        doc.text(a.label.toUpperCase(), x, y);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(...C.text);
        doc.text(`${a.earned}/${a.max}`, x, y + 14);
        // Fill bar
        doc.setFillColor(...C.line);
        doc.rect(x, y + 20, aw - 6, 3, 'F');
        doc.setFillColor(...C.accent);
        doc.rect(x, y + 20, ((aw - 6) * a.pct) / 100, 3, 'F');
      });
      y += 36;
    }
  }

  /* --------------------------------------------------------- xr health -- */
  heading('XR Health');
  const health = xrHealth(s, ctx);
  [...health.rows, health.overall].forEach((r) => {
    const detail = doc.splitTextToSize(r.detail, CW - 210);
    room(Math.max(16, detail.length * 10 + 8));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.text);
    doc.text(r.label, M, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...healthColor(r.state));
    doc.text(HEALTH_LABEL[r.state].toUpperCase(), M + 118, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.gray);
    doc.text(detail, M + 205, y);
    y += Math.max(14, detail.length * 10) + 4;
    doc.setDrawColor(238, 241, 245);
    doc.line(M, y - 3, W - M, y - 3);
  });
  y += 8;

  /* --------------------------------------------------------- fix first -- */
  heading('Fix First');
  const fix = fixFirst(s, ctx);
  if (!fix) {
    para('No priority issue in this capture. Every scored metric and every assessed validation item passed.');
    y += 6;
  } else {
    room(30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...(fix.severity === 'critical' ? C.fail : C.warn));
    doc.text(fix.title, M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.gray);
    doc.text(fix.severity === 'critical' ? 'CRITICAL' : 'NEEDS ATTENTION', W - M, y, { align: 'right' });
    y += 16;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...C.gray);
    doc.text('EVIDENCE', M, y);
    y += 12;
    para(fix.evidence, { size: 9.5, color: C.text });
    y += 6;

    if (fix.investigate?.length) {
      room(20);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...C.gray);
      doc.text('RECOMMENDED INVESTIGATION', M, y);
      y += 12;
      fix.investigate.forEach((i) => {
        room(13);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...C.text);
        doc.text(`•  ${i}`, M + 6, y);
        y += 12;
      });
      y += 2;
      para(
        'These are possible areas to investigate, not confirmed causes. This profiler measures frame '
        + 'timing and memory from inside the application; it cannot attribute a spike to a specific system.',
        { size: 8, italic: true, indent: 6 },
      );
    }
    if (fix.note) para(fix.note, { size: 8, italic: true, indent: 6 });
    y += 10;
  }

  /* --------------------------------------------------------- xr doctor -- */
  heading('XR Doctor');
  xrDoctor(s, ctx).forEach((r) => {
    const detail = doc.splitTextToSize(r.detail, CW - 210);
    room(Math.max(16, detail.length * 10 + 8));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.text);
    doc.text(r.label, M, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...healthColor(r.state));
    doc.text(HEALTH_LABEL[r.state].toUpperCase(), M + 118, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.gray);
    doc.text(detail, M + 205, y);
    y += Math.max(14, detail.length * 10) + 4;
  });
  y += 10;

  heading('Recommendations');
  recommendations(s, ctx).forEach((r) => {
    const detail = doc.splitTextToSize(r.detail, CW - 14);
    room(detail.length * 10 + 22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...(r.severity === 'critical' ? C.fail : r.severity === 'attention' ? C.warn : C.text));
    doc.text(r.title, M, y);
    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...C.gray);
    doc.text(detail, M + 8, y);
    y += detail.length * 10 + 6;
  });
  y += 4;

  /* ------------------------------------------------------------ charts -- */
  if (!invalid && s.series?.length) {
    const charts = [
      chartImage({ series: s.series, label: 'FPS', valueKey: 'fps', colour: '#3B64D6', targetValue: s.targetFps, targetLabel: 'Target', yTitle: 'FPS' }),
      chartImage({ series: s.series, label: 'Frame time (ms)', valueKey: 'frameMs', colour: '#5C4ED0', targetValue: 1000 / s.targetFps, targetLabel: 'Budget', yTitle: 'ms' }),
      chartImage({ series: s.series, label: 'Memory (MB)', valueKey: 'memMB', colour: '#7E58C8', yTitle: 'MB' }),
    ];
    const titles = ['Frame Rate Over Time', 'Frame Time Over Time', 'Memory Over Time'];

    // The three charts are read as one set, so they are kept on one page.
    // Without this the block breaks wherever it happens to land and the last
    // chart is stranded alone on an otherwise empty final page.
    //
    // Reserve the whole run up front. The figure has to match what the loop
    // below actually demands or the block still splits: each chart advances y
    // by perChart, but the LAST one must additionally satisfy its own
    // room(ih + 40) guard. So the run needs (n-1) advances plus that guard.
    // Charts are never resized to make them fit — if the run genuinely cannot
    // fit on a fresh page, the per-chart guard paginates them the old way.
    const ih = 132;
    const perChart = ih + 36;               // heading 20 + image 132 + gap 16
    const drawable = charts.filter(Boolean);
    const blockH = Math.max(0, drawable.length - 1) * perChart + (ih + 40);
    if (blockH <= H - 46 - M) room(blockH);

    charts.forEach((img, i) => {
      if (!img) return;
      room(ih + 40);   // safety net; a no-op once the block above has room
      heading(titles[i]);
      doc.addImage(img, 'JPEG', M, y, CW, ih);
      y += ih + 16;
    });
  }

  /* ------------------------------------------------------------ defects -- */
  // Local instances track defects; a hosted analysis has none.
  const bugs = s.bugs ?? [];
  if (bugs.length) {
    heading(`Defects (${bugs.length})`);
    bugs.forEach((b) => {
      const titleLines = doc.splitTextToSize(b.title ?? '', CW - 150);
      const descLines = b.description ? doc.splitTextToSize(b.description, CW - 20) : [];
      const resLines = b.resolutionNote ? doc.splitTextToSize(`Resolution: ${b.resolutionNote}`, CW - 20) : [];
      room(titleLines.length * 11 + descLines.length * 10 + resLines.length * 10 + 16);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...C.text);
      doc.text(titleLines, M, y);

      doc.setFontSize(8);
      doc.setTextColor(...(b.severity === 'critical' ? C.fail : b.severity === 'high' ? C.warn : C.neutral));
      doc.text(
        `${SEVERITY_LABEL[b.severity] ?? b.severity}  ·  ${BUG_STATUS_LABEL[b.status] ?? b.status}`,
        W - M,
        y,
        { align: 'right' },
      );
      y += titleLines.length * 11;

      if (descLines.length) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...C.gray);
        doc.text(descLines, M, y);
        y += descLines.length * 10;
      }
      if (resLines.length) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8.5);
        doc.setTextColor(...C.pass);
        doc.text(resLines, M, y);
        y += resLines.length * 10;
      }
      y += 8;
      doc.setDrawColor(238, 241, 245);
      doc.line(M, y - 4, W - M, y - 4);
    });
  }

  footer();
  doc.save(reportFilename(s));
}

/** Retained so older callers keep working. */
export const downloadSessionPdf = downloadReportPdf;
