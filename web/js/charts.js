/**
 * Chart.js rendering. Chart is loaded as a global UMD bundle from
 * /vendor/chart.umd.js - vendored locally so the app works offline.
 */

import { chartAnim } from './motion.js';

// Matches the stylesheet tokens so charts read as part of the same instrument.
const AXIS = '#7C86A0';
const GRID = 'rgba(38,44,66,.85)';
const BLUE = '#5B8CFF';   // electric blue
const INDIGO = '#7C6BF5'; // royal indigo
const VIOLET = '#A981F7'; // violet
const TARGET = '#3FD07A'; // green: meeting target (semantic)
const registry = new Map();

function mount(canvasId, config) {
  const el = document.getElementById(canvasId);
  if (!el || typeof Chart === 'undefined') return null;
  registry.get(canvasId)?.destroy();
  const chart = new Chart(el, config);
  registry.set(canvasId, chart);
  return chart;
}

export function destroyAllCharts() {
  for (const c of registry.values()) c.destroy();
  registry.clear();
}

const baseOptions = (yTitle, y1Title, unit = '') => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  // Charts draw in on reveal; instant when the user prefers reduced motion.
  animation: { duration: chartAnim(), easing: 'easeOutCubic' },
  plugins: {
    legend: {
      labels: {
        color: '#9CA6BE', boxWidth: 8, boxHeight: 8, usePointStyle: true,
        pointStyle: 'rectRounded', font: { size: 11, family: 'ui-monospace, monospace' },
      },
    },
    tooltip: {
      backgroundColor: '#161A2A',
      borderColor: '#262C42',
      borderWidth: 1,
      titleColor: '#EEF1F8',
      bodyColor: '#9CA6BE',
      titleFont: { family: 'ui-monospace, monospace', size: 11 },
      bodyFont: { family: 'ui-monospace, monospace', size: 12 },
      padding: 11,
      cornerRadius: 8,
      displayColors: false,
      callbacks: {
        title: (items) => `${items[0].label} s`,
        label: (ctx) => {
          const v = ctx.parsed.y;
          return `${ctx.dataset.label}: ${v == null ? 'no data' : v.toFixed(unit === 'ms' ? 2 : 1)}${unit ? ` ${unit}` : ''}`;
        },
      },
    },
  },
  scales: {
    x: {
      ticks: { color: AXIS, maxTicksLimit: 10 },
      grid: { color: GRID },
      title: { display: true, text: 'seconds', color: AXIS, font: { size: 11 } },
    },
    y: {
      position: 'left',
      min: 0,
      ticks: { color: AXIS },
      grid: { color: GRID },
      title: { display: true, text: yTitle, color: AXIS, font: { size: 11 } },
    },
    ...(y1Title
      ? {
          y1: {
            position: 'right',
            min: 0,
            ticks: { color: AXIS },
            grid: { drawOnChartArea: false },
            title: { display: true, text: y1Title, color: AXIS, font: { size: 11 } },
          },
        }
      : {}),
  },
});

/** FPS over the session, with the target line. */
export function drawFpsChart(series, targetFps) {
  const labels = series.map((p) => (+p.t).toFixed(1));
  return mount('fpsChart', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'FPS', data: series.map((p) => p.fps), borderColor: BLUE, backgroundColor: 'rgba(91,140,255,.12)', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true },
        { label: 'Target', data: series.map(() => targetFps), borderColor: TARGET, borderWidth: 1, borderDash: [2, 4], pointRadius: 0 },
      ],
    },
    options: baseOptions('FPS', null, 'FPS'),
  });
}

/** Frame time, with the target budget line. */
export function drawFrameTimeChart(series, targetFps) {
  const budget = 1000 / targetFps;
  return mount('frameChart', {
    type: 'line',
    data: {
      labels: series.map((p) => (+p.t).toFixed(1)),
      datasets: [
        { label: 'Frame time', data: series.map((p) => p.frameMs), borderColor: INDIGO, backgroundColor: 'rgba(124,107,245,.12)', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true },
        { label: 'Budget', data: series.map(() => budget), borderColor: TARGET, borderWidth: 1, borderDash: [2, 4], pointRadius: 0 },
      ],
    },
    options: baseOptions('ms', null, 'ms'),
  });
}

export function drawMemoryChart(series) {
  return mount('memChart', {
    type: 'line',
    data: {
      labels: series.map((p) => (+p.t).toFixed(1)),
      datasets: [
        { label: 'Memory', data: series.map((p) => p.memMB), borderColor: VIOLET, backgroundColor: 'rgba(169,129,247,.12)', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true },
      ],
    },
    options: baseOptions('MB', null, 'MB'),
  });
}

/** Avg FPS / 1% low across a project's sessions, oldest to newest. */
export function drawTrendChart(sessions, targetFps) {
  const valid = sessions.filter((s) => s.captureStatus !== 'invalid');
  if (valid.length < 2) return null;
  const opts = baseOptions('FPS', null, 'FPS');
  return mount('trendChart', {
    type: 'line',
    data: {
      labels: valid.map((_, i) => `Test ${i + 1}`),
      datasets: [
        { label: 'Avg FPS', data: valid.map((s) => s.avgFps), borderColor: BLUE, backgroundColor: 'rgba(91,140,255,.12)', borderWidth: 2, pointRadius: 3, tension: 0.2, fill: true },
        { label: '1% Low', data: valid.map((s) => s.onePercentLowFps), borderColor: VIOLET, borderWidth: 2, borderDash: [4, 3], pointRadius: 3, tension: 0.2 },
        { label: 'Target', data: valid.map(() => targetFps), borderColor: TARGET, borderWidth: 1, borderDash: [2, 4], pointRadius: 0 },
      ],
    },
    options: {
      ...opts,
      plugins: {
        ...opts.plugins,
        // The x axis here is "Test 1, Test 2…", not seconds.
        tooltip: { ...opts.plugins.tooltip, callbacks: { ...opts.plugins.tooltip.callbacks, title: (i) => i[0].label } },
      },
      scales: {
        ...opts.scales,
        x: { ticks: { color: AXIS }, grid: { color: GRID } },
      },
    },
  });
}
