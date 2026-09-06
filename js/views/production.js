/* views/production.js — the shop floor's own screen.
 *
 * A quotation says what was promised; this says what is actually
 * being made, grouped by MR number the way the Quotations list
 * groups by revision. A card is only as far along as its least
 * finished piece, because a client does not care that four of five
 * pieces shipped if the fifth is still on the drawing board.
 */

import { icon } from '../icons.js';
import { on, esc, emptyState, openSheet, toast, confirmSheet, field } from '../ui.js';
import {
  orderGroups, orderStats, isOverdue, overallStage, stageLabel, STAGES,
  getLine, addLine, updateLine, deleteLine, seedOrders,
} from '../orders.js';
import { dmy, todayISO } from '../format.js';

let query = '';

export function render(root, ctx) {
  seedOrders();
  const stats = orderStats();
  const groups = orderGroups({ q: query });

  root.innerHTML = `
    <header class="hero with-panel">
      <div class="hero-bar">
        <div class="hero-title">
          Production
          <small>${groups.length} order${groups.length === 1 ? '' : 's'}</small>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat">
          <div class="stat-val num">${stats.open}</div>
          <div class="stat-lbl">OPEN ORDERS</div>
        </div>
        <div class="stat">
          <div class="stat-val num ${stats.overdue ? 'neg' : ''}">${stats.overdue}</div>
          <div class="stat-lbl">OVERDUE</div>
        </div>
        <div class="stat">
          <div class="stat-val num">${stats.deliveredThisMonth}</div>
          <div class="stat-lbl">DELIVERED, THIS MONTH</div>
        </div>
      </div>
    </header>

    <div class="panel">
      <div class="searchbar">
        <span class="searchbar-ico">${icon('search', 17)}</span>
        <input class="control" type="search" data-q value="${esc(query)}"
               placeholder="Search client, MR number, item" aria-label="Search orders">
      </div>

      ${groups.length ? `<div class="qlist">${groups.map(card).join('')}</div>`
        : emptyState('box', query ? 'No order matches' : 'No orders yet',
            query ? 'Try another search' : 'Tap + to log the first one')}
    </div>
  `;

  on(root, '[data-open]', (e, b) => openGroup(b.dataset.open, ctx));

  const q = root.querySelector('[data-q]');
  if (q) {
    q.addEventListener('input', () => {
      query = q.value;
      clearTimeout(q._t);
      q._t = setTimeout(() => ctx.refresh(), 220);
    });
  }
}

function toneOf(stage, overdue) {
  if (overdue) return 'out';
  if (stage === 'delivered') return 'in';
  if (stage === 'shipped') return 'in';
  return 'warn';
}

function card(g) {
  const overdue = isOverdue(g);
  return `
    <article class="qcard reveal" data-open="${esc(g.mrNo)}" tabindex="0" role="button">
      <div class="qcard-top">
        <div class="qcard-id">
          <div class="qcard-client">${esc(g.client || g.mrNo)}</div>
          <div class="qcard-line">
            ${esc(g.mrNo)}
            <span class="qcard-dot"></span>${g.lines.length} item${g.lines.length === 1 ? '' : 's'}
            ${g.deliveryDate ? `<span class="qcard-dot"></span>due ${esc(dmy(g.deliveryDate))}` : ''}
          </div>
        </div>
        <div class="qcard-money">
          <span class="pill ${toneOf(g.stage, overdue)}">${overdue ? 'Overdue' : esc(stageLabel(g.stage))}</span>
        </div>
      </div>
    </article>
  `;
}

/* ── One MR number, every piece under it ─────────────────────── */

function openGroup(mrNo, ctx) {
  const groups = orderGroups({});
  const g = groups.find((x) => x.mrNo === mrNo);
  if (!g) return;

  const h = openSheet({
    title: `${g.client || mrNo} · ${mrNo}`,
    full: true,
    body: `
      <div class="sheet-body" data-lines>
        ${g.lines.map(lineHTML).join('')}
      </div>
      <div class="sheet-body" style="padding-top:0">
        <button class="btn sec sm" data-addline>${icon('plus', 15)} Add a piece to this order</button>
      </div>
    `,
    onMount(root, handle) {
      wireLineEvents(root, () => { refresh(); ctx.refresh(); });

      on(root, '[data-addline]', () => {
        openLineSheet({ mrNo, client: g.client, orderReceived: g.orderReceived, deliveryDate: g.deliveryDate },
          () => { refresh(); ctx.refresh(); });
      });

      function refresh() {
        const fresh = orderGroups({}).find((x) => x.mrNo === mrNo);
        const box = root.querySelector('[data-lines]');
        if (!fresh) { handle.close(); return; }
        box.innerHTML = fresh.lines.map(lineHTML).join('');
      }
    },
  });
}

function lineHTML(l) {
  const finishes = [l.metal, l.wood, l.upholstery, l.others].filter(Boolean);
  return `
    <div class="list" style="padding:2px 14px;margin-bottom:12px" data-line="${esc(l.id)}">
      <div class="kv"><span>${esc(l.name)}${l.qty > 1 ? ` × ${l.qty}` : ''}</span><b></b></div>
      ${l.specs ? `<div class="kv"><span style="color:var(--ink-3);font-weight:400">${esc(l.specs)}</span><b></b></div>` : ''}
      ${l.dims ? `<div class="kv"><span>Dimensions</span><b>${esc(l.dims)}</b></div>` : ''}
      ${l.upholstery ? `<div class="kv"><span>Upholstery</span><b>${esc(l.upholstery.name || '')}${l.upholstery.length ? ` · ${esc(l.upholstery.length)}` : ''}</b></div>` : ''}
      ${l.metal ? `<div class="kv"><span>Metal</span><b>${esc(l.metal.type || '')}${l.metal.finish ? ` · ${esc(l.metal.finish)}` : ''}</b></div>` : ''}
      ${l.wood ? `<div class="kv"><span>Wood</span><b>${esc(l.wood.type || '')}${l.wood.finish ? ` · ${esc(l.wood.finish)}` : ''}</b></div>` : ''}
      ${vendorsLine(l.vendors)}
      <div class="qpair" style="padding:10px 0 4px">
        <span class="qpair-l">Stage</span>
        <select class="control flush" data-stage="${esc(l.id)}">
          <option value="pending" ${l.stage === 'pending' ? 'selected' : ''}>Pending</option>
          ${STAGES.map((s) => `<option value="${s.key}" ${l.stage === s.key ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
      </div>
      <button class="mini" data-delline="${esc(l.id)}" style="margin-top:6px;color:var(--out)">${icon('trash', 13)} Remove this piece</button>
    </div>
  `;
}

function vendorsLine(vendors) {
  if (!vendors) return '';
  const parts = Object.entries(vendors).filter(([, v]) => v && v !== 'NA');
  if (!parts.length) return '';
  return `<div class="kv"><span>Vendors</span><b>${esc(parts.map(([k, v]) => `${k}: ${v}`).join(', '))}</b></div>`;
}

function wireLineEvents(root, onChanged) {
  on(root, '[data-stage]', (e, b) => {
    updateLine(b.dataset.stage, { stage: b.value });
    toast('Stage updated');
    onChanged();
  });
  on(root, '[data-delline]', async (e, b) => {
    const ok = await confirmSheet({
      title: 'Remove this piece?',
      message: 'It is dropped from this order — nothing else under this MR number is touched.',
      confirmLabel: 'Remove', danger: true,
    });
    if (!ok) return;
    deleteLine(b.dataset.delline);
    toast('Removed');
    onChanged();
  });
}

/* ── Adding a piece ────────────────────────────────────────────── */

export function openNewOrder(ctx) {
  openLineSheet({}, ctx.refresh);
}

function openLineSheet(prefill, onSaved) {
  const h = openSheet({
    title: 'New piece',
    body: `
      <div class="sheet-body">
        ${field('MR number', `<input class="control" data-f="mrNo" value="${esc(prefill.mrNo || '')}" autocapitalize="characters" placeholder="C129-1">`)}
        ${field('Client', `<input class="control" data-f="client" value="${esc(prefill.client || '')}">`)}
        <div class="qb-grid">
          ${field('Order received', `<input class="control" type="date" data-f="orderReceived" value="${esc(prefill.orderReceived || todayISO())}">`)}
          ${field('Delivery date', `<input class="control" type="date" data-f="deliveryDate" value="${esc(prefill.deliveryDate || '')}">`)}
        </div>
        ${field('Name', `<input class="control" data-f="name" placeholder="Center table">`)}
        ${field('Specifications', `<textarea class="control" data-f="specs" rows="3"></textarea>`)}
        <div class="qb-grid">
          ${field('Dimensions', `<input class="control" data-f="dims" placeholder="As per dimensions">`)}
          ${field('Qty', `<input class="control num" data-f="qty" type="number" inputmode="numeric" value="1">`)}
        </div>
        <button class="btn" data-save>Add piece</button>
      </div>`,
    onMount(root) {
      const get = (k) => root.querySelector(`[data-f="${k}"]`).value;
      on(root, '[data-save]', () => {
        const mrNo = get('mrNo').trim();
        if (!mrNo) { toast('An MR number is needed', 'warn'); return; }
        if (!get('name').trim()) { toast('Give the piece a name', 'warn'); return; }
        addLine({
          mrNo, client: get('client').trim(),
          orderReceived: get('orderReceived'), deliveryDate: get('deliveryDate'),
          name: get('name').trim(), specs: get('specs').trim(), dims: get('dims').trim(),
          qty: Number(get('qty')) || 1,
        });
        toast('Added');
        h.close();
        onSaved();
      });
    },
  });
}
