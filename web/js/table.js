/**
 * Sortable, keyboard-accessible data table.
 *
 * The previous implementation put onclick on <tr> and <th>, which made every
 * table mouse-only. Here rows are focusable with a role and Enter/Space
 * activation, and sort headers are real <button>s inside <th scope="col">.
 */
import { esc } from './ui.js';

/**
 * @param {object} o
 * @param {Array}  o.columns  [{key,label,num?,sortable?,render(row),title?}]
 * @param {Array}  o.rows
 * @param {{key,dir}} o.sort
 * @param {string} o.caption      screen-reader description of the table
 * @param {function} [o.rowHref]  makes rows navigable
 * @param {function} [o.rowClass]
 */
export function dataTable({ columns, rows, sort, caption, rowHref, rowClass }) {
  const head = columns
    .map((c) => {
      const on = sort && sort.key === c.key;
      const cls = [c.num ? 'num' : '', on ? 'sorted' : ''].filter(Boolean).join(' ');
      if (c.sortable === false) {
        return `<th scope="col" class="${cls}"><span class="sortbtn">${esc(c.label)}</span></th>`;
      }
      const arrow = on ? (sort.dir === 'asc' ? '▲' : '▼') : '';
      const ariaSort = on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      return `<th scope="col" class="${cls}" aria-sort="${ariaSort}">
          <button type="button" class="sortbtn" data-sort="${esc(c.key)}">
            ${esc(c.label)}<span class="arr" aria-hidden="true">${arrow}</span>
            <span class="sr-only">${on ? `, sorted ${ariaSort}` : ', activate to sort'}</span>
          </button>
        </th>`;
    })
    .join('');

  const body = rows
    .map((row) => {
      const href = rowHref?.(row);
      const cls = [rowClass?.(row), href ? 'clickable' : ''].filter(Boolean).join(' ');
      const nav = href
        ? `tabindex="0" role="link" data-href="${esc(href)}" aria-label="${esc(row.__label ?? '')}"`
        : '';
      const cells = columns
        .map((c) => `<td class="${c.num ? 'num' : ''} ${c.wrap ? 'wrap' : ''}">${c.render(row)}</td>`)
        .join('');
      return `<tr class="${cls}" ${nav}>${cells}</tr>`;
    })
    .join('');

  return `<div class="ctable-wrap">
      <table class="ctable">
        <caption class="sr-only">${esc(caption)}</caption>
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

/**
 * Wires sorting and row activation.
 * @param {HTMLElement} scope
 * @param {function} onSort  called with the column key
 */
export function wireTable(scope, onSort) {
  scope.querySelectorAll('.sortbtn[data-sort]').forEach((btn) =>
    btn.addEventListener('click', () => onSort?.(btn.dataset.sort)),
  );

  scope.querySelectorAll('tr[data-href]').forEach((tr) => {
    const go = () => {
      location.hash = tr.dataset.href;
    };
    tr.addEventListener('click', (e) => {
      // Let real controls inside a row do their own thing.
      if (e.target.closest('button, a, select, input')) return;
      go();
    });
    tr.addEventListener('keydown', (e) => {
      if (e.target !== tr) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
  });
}

/**
 * Generic sort with a stable "missing data sinks to the bottom" rule,
 * regardless of direction.
 */
export function sortRows(rows, { key, dir }, accessor = (r, k) => r[k]) {
  const mul = dir === 'asc' ? 1 : -1;
  const missing = (v) => v == null || v === '' || (typeof v === 'number' && Number.isNaN(v));
  return [...rows].sort((a, b) => {
    const va = accessor(a, key);
    const vb = accessor(b, key);
    const ma = missing(va);
    const mb = missing(vb);
    if (ma && mb) return 0;
    if (ma) return 1;
    if (mb) return -1;
    if (typeof va === 'string' && typeof vb === 'string') {
      return va.localeCompare(vb, undefined, { sensitivity: 'base' }) * mul;
    }
    return (va - vb) * mul;
  });
}

/** Flips direction on the same column, otherwise picks a sensible default. */
export function nextSort(current, key, numericKeys = new Set()) {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: numericKeys.has(key) ? 'desc' : 'asc' };
}
