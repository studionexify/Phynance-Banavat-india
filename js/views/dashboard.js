/* views/dashboard.js — Kontour's own screen.
 *
 * Not a fifth copy of the money log. The Dashboard answers one
 * question — what needs me today — and it answers it with the same
 * nine figures the three modules already open with, in one place,
 * each one a door back to the screen that owns it. Nothing here can
 * be edited in place; that is the point. You look, you decide where
 * to go.
 */

import { icon } from '../icons.js';
import { on, esc } from '../ui.js';
import { phynanceStats } from '../store.js';
import { quotationStats } from '../quotes.js';
import { totalSummary, seedKnownPartners } from '../commissions.js';
import { inrShort, todayISO, fyOf } from '../format.js';

export async function render(root, ctx) {
  const today = todayISO();
  seedKnownPartners();

  const p = phynanceStats();
  const q = quotationStats();
  const c = totalSummary();

  const cards = [
    // Phynance
    { go: 'home', ico: 'arrowIn', label: 'Outstanding', val: p.outstanding },
    { go: 'home', ico: 'arrowOut', label: 'Vendor Payment', val: p.vendorPayment },
    { go: 'home', ico: 'wallet', label: 'Turn Over', val: p.turnover },
    // Quotation
    { go: 'quotes', ico: 'note', label: 'Active Order', val: q.activeCount, plain: true },
    { go: 'quotes', ico: 'note', label: 'Active Order Value', val: q.activeValue },
    { go: 'quotes', ico: 'note', label: 'Open Quotations', val: q.openCount, plain: true },
    // Commission
    { go: 'commission', ico: 'percent', label: 'Total Earned', val: c.commission },
    { go: 'commission', ico: 'percent', label: 'Paid Out', val: c.paid },
    { go: 'commission', ico: 'percent', label: 'Outstanding', val: c.remaining },
  ];

  root.innerHTML = `
    <header class="hero">
      <div class="hero-bar">
        <div class="hero-title">
          Dashboard
          <small>Banavat India · ${esc(fyOf(today))}</small>
        </div>
        <button class="icon-btn" data-settings aria-label="Settings">${icon('gear', 21)}</button>
      </div>
    </header>

    <div class="sec" style="padding-top:16px">
      <div class="grid3">
        ${cards.map(cardHTML).join('')}
      </div>
    </div>
  `;

  on(root, '[data-settings]', () => ctx.openSettings());
  on(root, '[data-go]', (e, b) => ctx.go(b.dataset.go));
}

function cardHTML(c) {
  const shown = c.val ? (c.plain ? String(c.val) : inrShort(c.val)) : '—';
  return `
    <button class="card" data-go="${esc(c.go)}">
      <span class="card-ico">${icon(c.ico, 16)}</span>
      <div class="card-name">${esc(c.label)}</div>
      <div class="card-val num">${esc(shown)}</div>
    </button>
  `;
}
