/* views/quotelist.js — every live quotation, newest first.
 *
 * The list is a working queue, not an archive: what is still out with
 * a client sits at the top of mind, so status is the primary filter
 * and the figure shown is always the one the client saw. Decided
 * quotations — accepted or declined — leave this screen entirely and
 * file themselves into Archive, which is its own station on the line
 * now rather than a filter hiding inside this one.
 *
 * A row is one line: who and what, then the total and where it
 * stands, then the edit pencil a change actually needs. Everything
 * else a quotation can do — share, PDF, revise, decline — lives one
 * tap under the "⋯", because a phone has room for one icon on a row
 * and a thumb, not for five.
 */

import { icon } from '../icons.js';
import { on, esc, toast, confirmSheet, field, openSheet, haptic } from '../ui.js';
import {
  quoteFamilies, quoteTotals, quoteName, STATUS, setStatus, deleteQuote, getQuote,
  reviseQuote, duplicateQuote, archiveQuote, unarchiveQuote, isArchived,
  jobValueFor, quotationStats, acceptQuote,
} from '../quotes.js';
import { inr, dmy, fyOf } from '../format.js';
import { openQuoteSheet } from './quotebuilder.js';
import { openQuoteDoc } from './quotedoc.js';
import { shareQuotePdf, downloadQuotePdf } from '../quotepdf.js';
import { pageHead, statCards, searchBar, sectionHead, nothingHere } from './chrome.js';

let filter = 'all';
let query = '';
let fy = 'all';
/* Decided quotations have their own station now — the Archive tab —
   so this screen only ever lists what is still live. */
const archived = false;

/* The headline's own control, not a filter chip: this decides the
   order of the list, the chips decide which of it is shown. "Reversed
   ... in terms of MR Number" is the plain-language spec for what this
   defaults to — newest MR number first, direction flipped by tapping
   the option already active. */
const SORTS = {
  mrNo:   { label: 'MR number', cmp: (a, b) => compareMr(a.head.mrNo, b.head.mrNo) },
  date:   { label: 'Date',      cmp: (a, b) => (a.head.date || '').localeCompare(b.head.date || '') },
  client: { label: 'Client',    cmp: (a, b) => clientOf(a.head).localeCompare(clientOf(b.head)) },
  value:  { label: 'Value',     cmp: (a, b) => valueOf(a.head) - valueOf(b.head) },
  status: { label: 'Status',    cmp: (a, b) => statusRank(a.head) - statusRank(b.head) },
};
let sortKey = 'mrNo';
let sortDir = 'desc';

/* Which quotations are ticked, for the actions that are worth doing to
   a dozen at once rather than one sheet at a time. It survives a
   refresh — marking six as sent re-renders the list, and losing the
   ticks halfway through the batch is how a batch gets done twice. */
const selected = new Set();

/* Status sorts by where a quotation stands in the conversation, not by
   the alphabet: a draft has not gone out, a sent one is waiting. */
const STATUS_ORDER = ['draft', 'sent', 'accepted', 'declined', 'superseded'];
function statusRank(q) {
  const i = STATUS_ORDER.indexOf(q.status);
  return i < 0 ? STATUS_ORDER.length : i;
}

function clientOf(q) {
  return ((q.client && q.client.name) || 'Unnamed client').trim().toLowerCase();
}

function valueOf(q) {
  const t = quoteTotals(q);
  return q.status === 'accepted' ? jobValueFor(q) : t.total;
}

/* "C101" < "C119" < "C129-1" < "C129-2" — a plain string compare
   would put "C119" after "C19" and a revision suffix after nothing
   at all. Split into the letter, the number, and the revision (if
   any) and compare those in turn instead. */
function mrParts(mrNo) {
  const m = String(mrNo || '').match(/^([A-Za-z]*)(\d+)(?:[-\s(]+(\d+))?/);
  return m ? [m[1] || '', Number(m[2]) || 0, Number(m[3]) || 0] : [String(mrNo || ''), 0, 0];
}
function compareMr(a, b) {
  const pa = mrParts(a); const pb = mrParts(b);
  if (pa[0] !== pb[0]) return pa[0] < pb[0] ? -1 : 1;
  if (pa[1] !== pb[1]) return pa[1] - pb[1];
  return pa[2] - pb[2];
}

/* Opening one quotation straight from the Dashboard — the same
   read-only view a card in this list opens to. */
export function openById(id, ctx) {
  openQuoteDoc(id, { onSaved: ctx.refresh });
}

export function setFilter(next) {
  if (next && next.status) filter = next.status;
  if (next && next.q != null) query = next.q;
}

/* The Quotations subnav pill is navigation, not a filter — tapping it
   always lands on the plain working list, the way tapping any other
   destination does. Without this, tapping it while inside the Archive
   just re-painted the same screen (same route, so `show()` treats it
   as an in-place refresh) and Archive never let go. */
export function resetView() {
  archived = false;
  filter = 'all';
}

export async function render(root, ctx) {
  const inFy = (f) => fy === 'all' || fyOf(f.head.date) === fy;
  const list = quoteFamilies({ status: filter, q: query, archived }).filter(inFy);
  const dir = sortDir === 'desc' ? -1 : 1;
  list.sort((a, b) => dir * SORTS[sortKey].cmp(a, b));
  const qs = quotationStats();
  const all = quoteFamilies({ q: query, archived }).filter(inFy);
  const archivedCount = quoteFamilies({ q: query, archived: true }).filter(inFy).length;
  // Newest year first, and only offered once there is more than one.
  const years = [...new Set(quoteFamilies({ archived: null })
    .map((f) => f.head.date).filter(Boolean).map(fyOf))].sort().reverse();
  const counts = { all: all.length };
  for (const k of ['draft', 'sent', 'accepted', 'declined']) {
    counts[k] = all.filter((f) => f.head.status === k).length;
  }
  // In the archive the live statuses are all that is left, so the
  // chips that would read zero forever are simply not offered.
  const statusKeys = archived ? ['all', 'accepted', 'declined'] : ['all', 'draft', 'sent'];

  root.innerHTML = `
    <div class="floor">
      ${pageHead({
        title: 'Quotation',
        sub: `${counts.all} job${counts.all === 1 ? '' : 's'} quoted${fy === 'all' ? '' : ` · ${esc(fy)}`}`,
        actions: `<button class="pill-btn" data-newquote>${icon('plus', 16)} New quotation</button>`,
      })}

      ${statCards([
        { label: 'Open quotations', value: qs.openCount, tone: 'quote', hint: 'awaiting a decision' },
        { label: 'Active orders', value: qs.activeCount, hint: 'confirmed and in hand' },
        { label: 'Active order value', value: qs.activeValue || '', money: Boolean(qs.activeValue) },
        { label: 'Decided', value: archivedCount, tone: 'done', go: 'archive', hint: 'in the archive' },
      ])}

      ${searchBar(query, 'Search client, MR number, job')}

      <div class="chipbar">
        ${statusKeys.map((k) => `
          <button class="chip ${filter === k ? 'on' : ''}" data-filter="${k}">
            ${k === 'all' ? 'All' : STATUS[k].label}
            <small>${counts[k]}</small>
          </button>
        `).join('')}
        ${years.length > 1 ? `
          <span class="chipbar-sep"></span>
          <button class="chip ${fy === 'all' ? 'on' : ''}" data-fy="all">All years</button>
          ${years.map((y) => `<button class="chip ${fy === y ? 'on' : ''}" data-fy="${esc(y)}">${esc(y)}</button>`).join('')}
        ` : ''}
      </div>

      ${sectionHead(
        filter === 'all' ? 'Live quotations' : `${STATUS[filter].label} quotations`,
        sortControl(),
      )}
      ${bulkBar()}
      ${list.length ? `${table(list)}<div class="qrows">${list.map(row).join('')}</div>`
        : nothingHere('note',
            query || filter !== 'all' ? 'No quotation matches' : 'No quotations yet',
            query || filter !== 'all' ? 'Try another filter' : 'Write the first one and it lands here')}
    </div>
  `;

  // A tick that scrolled off the list — filtered or searched away —
  // is not something a bulk action should quietly act on.
  const live = new Set(list.map((f) => f.head.id));
  for (const id of [...selected]) if (!live.has(id)) selected.delete(id);
  paintSelection(root, list);

  on(root, '[data-filter]', (e, b) => { filter = b.dataset.filter; ctx.refresh(); });
  on(root, '[data-fy]', (e, b) => { fy = b.dataset.fy; ctx.refresh(); });
  on(root, '[data-go]', (e, b) => ctx.go(b.dataset.go));
  on(root, '[data-newquote]', () => openQuoteSheet({ onSaved: ctx.refresh }));

  on(root, '[data-sort]', (e, b) => {
    const key = b.dataset.sort;
    // Tapping the sort already active flips its direction; picking a
    // new one starts descending — "newest / largest first" is what
    // every one of these fields means the first time you reach for it.
    if (key === sortKey) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    else { sortKey = key; sortDir = 'desc'; }
    ctx.refresh();
  });

  // The same quotation appears twice in the DOM — once as a table row
  // for a wide screen, once as a card for a narrow one, only ever one
  // of them visible. The tick lives in the Set, not in either input,
  // so both are repainted from it rather than from each other.
  on(root, '[data-sel]', (e, b) => {
    e.stopPropagation();
    if (b.checked) selected.add(b.dataset.sel); else selected.delete(b.dataset.sel);
    paintSelection(root, list);
  }, 'change');

  on(root, '[data-selall]', (e, b) => {
    e.stopPropagation();
    if (b.checked) for (const f of list) selected.add(f.head.id);
    else selected.clear();
    paintSelection(root, list);
  }, 'change');

  on(root, '[data-bulk]', (e, b) => runBulk(b.dataset.bulk, ctx));

  on(root, '[data-edit]', (e, b) => {
    e.stopPropagation();
    openQuoteSheet({ id: b.dataset.edit, onSaved: ctx.refresh });
  });

  on(root, '[data-more]', (e, b) => {
    e.stopPropagation();
    openActions(b.dataset.more, ctx);
  });

  // The row opens the document as it stands — the same view.js is
  // for. Editing is its own pencil, never the first tap: a row in a
  // scrolling list is too easy to hit by accident to drop someone
  // into an edit.
  on(root, '[data-open]', (e, b) => {
    if (e.target.closest('button, label, input')) return;
    openQuoteDoc(b.dataset.open, { onSaved: ctx.refresh });
  });

  const q = root.querySelector('[data-q]');
  if (q) {
    q.addEventListener('input', () => {
      query = q.value;
      clearTimeout(q._t);
      q._t = setTimeout(() => ctx.refresh(), 220);
    });
  }
}

/* The headline's own sort control: the field that decides the order
   is tappable text, not a form — tap the one already active to flip
   its direction, tap another to switch to it (descending, since
   "newest / largest first" is what makes sense the first time). */
function sortControl() {
  return `
    <div class="sortbar only-narrow">
      ${Object.entries(SORTS).map(([key, s]) => `
        <button class="sortbtn ${key === sortKey ? 'on' : ''}" data-sort="${key}">
          ${esc(s.label)}${key === sortKey ? icon(sortDir === 'desc' ? 'chevD' : 'chevU', 12) : ''}
        </button>
      `).join('')}
    </div>`;
}

/* ── The table, for a screen with room for columns ───────────────
   Same list, same sort, same actions as the cards below it — the
   difference is that a wide screen can show the fields side by side
   under headings that sort them, which is how this is read at a desk.
   Only ever one of the two is on screen; the media query decides.

   The heading is the sorter: tapping the one already active flips
   its direction, exactly as the chips do, because they are the same
   handler. */
const COLS = [
  ['mrNo',   'Quotation', ''],
  ['client', 'Client',    ''],
  ['date',   'Issued',    'qt-date'],
  ['value',  'Amount',    'qt-amt num'],
  ['status', 'Status',    'qt-st'],
];

function sortMark(key) {
  if (key !== sortKey) return `<span class="qt-sortmark">${icon('swap', 11)}</span>`;
  return `<span class="qt-sortmark on">${icon(sortDir === 'desc' ? 'chevD' : 'chevU', 11)}</span>`;
}

function checkbox(id, label) {
  return `
    <label class="ckbox">
      <input type="checkbox" data-sel="${esc(id)}" aria-label="${esc(label)}">
      <span class="ckbox-box">${icon('check', 12)}</span>
    </label>`;
}

function table(list) {
  return `
    <div class="qtable-wrap">
      <table class="qtable">
        <thead>
          <tr>
            <th class="qt-check">
              <label class="ckbox">
                <input type="checkbox" data-selall aria-label="Select every quotation shown">
                <span class="ckbox-box">${icon('check', 12)}</span>
              </label>
            </th>
            ${COLS.map(([key, label, cls]) => `
              <th class="${cls}">
                <button class="qt-sort ${key === sortKey ? 'on' : ''}" data-sort="${key}">
                  ${esc(label)}${sortMark(key)}
                </button>
              </th>`).join('')}
            <th class="qt-acts"></th>
          </tr>
        </thead>
        <tbody>${list.map(trow).join('')}</tbody>
      </table>
    </div>`;
}

function trow({ head: q, revisions }) {
  const t = quoteTotals(q);
  const st = STATUS[q.status];
  const jobValue = q.status === 'accepted' ? jobValueFor(q) : t.total;
  const lines = (q.lines || []).length;

  return `
    <tr class="qt-row" data-open="${esc(q.id)}" data-row="${esc(q.id)}" tabindex="0">
      <td class="qt-check">${checkbox(q.id, `Select ${q.mrNo}`)}</td>
      <td>
        <div class="qt-no">${esc(q.mrNo)}</div>
        <div class="qt-sub">${lines} item${lines === 1 ? '' : 's'}${revisions > 1 ? ` · rev ${revisions}` : ''}${q.title ? ` · ${esc(q.title)}` : ''}</div>
      </td>
      <td class="qt-client">${esc((q.client && q.client.name) || 'Unnamed client')}</td>
      <td class="qt-date">${esc(dmy(q.date))}</td>
      <td class="qt-amt num">${inr(jobValue)}</td>
      <td class="qt-st"><span class="pill ${st.tone}">${esc(st.label)}</span></td>
      <td class="qt-acts">
        <button class="icon-btn plain sm" data-edit="${esc(q.id)}" aria-label="Edit ${esc(q.mrNo)}">${icon('edit', 16)}</button>
        <button class="icon-btn plain sm" data-more="${esc(q.id)}" aria-label="More actions for ${esc(q.mrNo)}">${icon('menu', 16)}</button>
      </td>
    </tr>`;
}

/* ── Bulk selection ──────────────────────────────────────────────
   The bar is in the page from the start and simply hidden while
   nothing is ticked: ticking a box then has nothing to re-render, so
   the list does not jump under the finger that ticked it. */
function bulkBar() {
  const acts = [
    ['sent',    'check',    'Mark sent'],
    ['produce', 'anvil',    'Send to production'],
    ['archive', 'inbox',    'Archive'],
    ['pdf',     'download', 'Download PDFs'],
    ['del',     'trash',    'Delete'],
  ];
  return `
    <div class="bulkbar" data-bulkbar hidden>
      <span class="bulkbar-n" data-bulkcount>0 selected</span>
      <div class="bulkbar-acts">
        ${acts.map(([act, ico, label]) => `
          <button class="bulkbtn ${act === 'del' ? 'danger' : ''}" data-bulk="${act}">
            ${icon(ico, 15)}<span>${esc(label)}</span>
          </button>`).join('')}
        <button class="bulkbtn ghost" data-bulk="clear" aria-label="Clear the selection">${icon('close', 15)}</button>
      </div>
    </div>`;
}

/* One place decides how a tick looks, so the table row, the card and
   the "select all" box can never disagree about what is selected. */
function paintSelection(root, list) {
  const n = selected.size;
  for (const el of root.querySelectorAll('[data-sel]')) {
    const on2 = selected.has(el.dataset.sel);
    el.checked = on2;
    const holder = el.closest('.qt-row, .qrow2');
    if (holder) holder.classList.toggle('picked', on2);
  }
  const all = root.querySelector('[data-selall]');
  if (all) {
    all.checked = n > 0 && n === list.length;
    all.indeterminate = n > 0 && n < list.length;
  }
  const bar = root.querySelector('[data-bulkbar]');
  if (bar) {
    bar.hidden = n === 0;
    const label = bar.querySelector('[data-bulkcount]');
    if (label) label.textContent = `${n} selected`;
  }
}

/* Everything here is worth doing to a dozen quotations at once and
   nothing here needs a decision per quotation: sending to production
   books each job at the figure that was quoted, which is what
   approving one by one with the amount left alone already does. A
   quotation that cannot take an action is skipped rather than
   refused, so one draft in a batch of sent ones does not stop it. */
async function runBulk(act, ctx) {
  const ids = [...selected];
  if (act === 'clear') { selected.clear(); return ctx.refresh(); }
  if (!ids.length) return;
  haptic();

  if (act === 'del') {
    const ok = await confirmSheet({
      title: `Delete ${ids.length} quotation${ids.length === 1 ? '' : 's'}?`,
      message: 'Only the selected revisions go. Other rounds of the same MR numbers are left alone.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    ids.forEach(deleteQuote);
    selected.clear();
    toast(`${ids.length} deleted`);
    return ctx.refresh();
  }

  if (act === 'pdf') {
    let made = 0;
    for (const id of ids) {
      const q = getQuote(id);
      if (!q) continue;
      try { await downloadQuotePdf(q); made += 1; } catch {}
    }
    toast(made ? `${made} PDF${made === 1 ? '' : 's'} saved` : 'Could not make those PDFs', made ? '' : 'err');
    return;
  }

  let done = 0;
  for (const id of ids) {
    const q = getQuote(id);
    if (!q) continue;
    if (act === 'sent') {
      if (q.status !== 'draft') continue;
      setStatus(id, 'sent'); done += 1;
    } else if (act === 'produce') {
      if (q.status === 'accepted') continue;
      acceptQuote(id); done += 1;
    } else if (act === 'archive') {
      if (isArchived(q)) continue;
      archiveQuote(id); done += 1;
    }
  }
  selected.clear();
  const said = {
    sent: `${done} marked sent`,
    produce: `${done} sent to production`,
    archive: `${done} archived`,
  };
  toast(done ? said[act] : 'Nothing in that selection could take it');
  ctx.refresh();
}

/* ── One line per job ────────────────────────────────────────────
   The revision that is currently live: who, what number, when, and
   how many pieces — then the total and its status, then the one
   action a row actually needs often enough to earn its own icon.
   Everything else is a tap under "⋯". Earlier rounds of the same
   job fold under it exactly as they did as a card. */
function row({ head: q, family, revisions }) {
  const t = quoteTotals(q);
  const st = STATUS[q.status];
  const lines = (q.lines || []).length;
  const older = family.filter((x) => x.id !== q.id);
  const jobValue = q.status === 'accepted' ? jobValueFor(q) : t.total;
  const adjusted = q.approvedTotal != null;

  return `
    <article class="qrow2 reveal" data-open="${esc(q.id)}" tabindex="0" role="button">
      ${checkbox(q.id, `Select ${q.mrNo}`)}
      <div class="qrow2-main">
        <div class="qrow2-top">
          <span class="qrow2-client">${esc(quoteName(q))}</span>
          <span class="pill ${st.tone}">${esc(st.label)}</span>
        </div>
        <div class="qrow2-meta">
          ${esc(dmy(q.date))}
          <span class="qcard-dot"></span>${lines} item${lines === 1 ? '' : 's'}
          ${revisions > 1 ? `<span class="qcard-dot"></span>rev ${revisions}` : ''}
          ${q.title ? `<span class="qcard-dot"></span>${esc(q.title)}` : ''}
        </div>
        ${adjusted || q.jobExcludesGst ? `
          <div class="qcard-flags">
            ${adjusted ? `<span class="pill mut sm">Approved at ${inr(jobValue)}, quoted ${inr(t.total)}</span>` : ''}
            ${q.jobExcludesGst ? `<span class="pill mut sm">Job value excl. GST</span>` : ''}
          </div>` : ''}
        ${older.length ? `
          <details class="qcard-hist">
            <summary>${older.length} earlier round${older.length === 1 ? '' : 's'}</summary>
            ${older.map((o) => {
              const ot = quoteTotals(o);
              const ost = STATUS[o.status];
              return `
                <button class="qhist" data-doc="${esc(o.id)}">
                  <span class="qhist-n">${esc(o.mrNo)}</span>
                  <span class="qhist-d">${esc(dmy(o.date))}</span>
                  <span class="pill ${ost.tone}">${esc(ost.label)}</span>
                  <span class="qhist-a num">${inr(ot.total)}</span>
                </button>`;
            }).join('')}
          </details>` : ''}
      </div>

      <div class="qrow2-side">
        <span class="qrow2-amt num">${inr(jobValue)}</span>
        <div class="qrow2-acts">
          <button class="icon-btn plain sm" data-edit="${esc(q.id)}" aria-label="Edit this quotation">${icon('edit', 16)}</button>
          <button class="icon-btn plain sm" data-more="${esc(q.id)}" aria-label="More actions">${icon('menu', 16)}</button>
        </div>
      </div>
    </article>
  `;
}

/* ── Sharing ───────────────────────────────────────────────────
   One call, three outcomes, each of which needs something different
   said — a silent share sheet is indistinguishable from a dead
   button on a phone. */
async function share(id) {
  const q = getQuote(id);
  if (!q) return;
  haptic();
  try {
    const how = await shareQuotePdf(q);
    if (how === 'downloaded') toast('PDF saved — attach it from Downloads');
    else if (how === 'shared') toast('Shared');
  } catch {
    toast('Could not share that', 'err');
  }
}

/* ── The action sheet ──────────────────────────────────────────
   Everything a quotation can do, in the order it is likely wanted:
   the decision first, then the paperwork, then the destructive end.
   Which decisions are offered depends on where the quotation is. */
function openActions(id, ctx) {
  const q = getQuote(id);
  if (!q) return;
  const gone = isArchived(q);

  const rows = [
    ['view', 'note', 'Preview the document', ''],
    ['share', 'upload', 'Share', 'Sends the PDF'],
    ['pdf', 'download', 'Download as PDF', ''],
  ];
  if (!gone && q.status === 'draft') {
    rows.push(['sent', 'check', 'Mark as sent', 'It is with the client now']);
  }
  if (!gone && (q.status === 'sent' || q.status === 'draft')) {
    rows.push(['accept', 'check', 'Client approved', 'Opens the job in Phynance']);
    rows.push(['decline', 'close', 'Client declined', 'Moves it to the archive']);
  }
  if (gone) {
    rows.push(['restore', 'upload', 'Move back to the list', 'Status is left as it is']);
  } else {
    rows.push(['archive', 'inbox', 'Archive', 'Out of the working list']);
  }

  rows.push(['edit', 'edit', 'Edit', '']);
  if (q.status !== 'accepted') rows.push(['revise', 'repeat', 'Revise', 'A new round under the same number']);
  rows.push(['dup', 'box', 'Duplicate', 'Same items, a new client']);
  rows.push(['del', 'trash', 'Delete', '']);

  const h = openSheet({
    title: quoteName(q),
    body: `
      <div class="sheet-body">
        <div class="actlist">
          ${rows.map(([act, ico, label, sub]) => `
            <button class="actrow ${act === 'del' ? 'danger' : ''}" data-act="${act}">
              <span class="actrow-ico">${icon(ico, 18)}</span>
              <span class="actrow-t">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
              ${icon('chevR', 15)}
            </button>
          `).join('')}
        </div>
      </div>`,
    onMount(root) {
      on(root, '[data-act]', async (e, b) => {
        const act = b.dataset.act;

        // Delete asks before the sheet goes, so the question is not
        // stacked on top of a sheet that is animating away.
        if (act === 'del') {
          h.close();
          const ok = await confirmSheet({
            title: 'Delete this quotation?',
            message: 'Only this revision goes. Other rounds of the same MR number are left alone.',
            confirmLabel: 'Delete', danger: true,
          });
          if (!ok) return;
          deleteQuote(id);
          toast('Quotation deleted');
          return ctx.refresh();
        }

        if (act === 'accept') { h.close(); return openAccept(id, ctx); }

        if (act === 'view') { h.close(); return openQuoteDoc(id, { onSaved: ctx.refresh }); }
        if (act === 'share') { h.close(); return share(id); }
        if (act === 'pdf') {
          h.close();
          try { await downloadQuotePdf(q); toast('PDF saved'); }
          catch { toast('Could not make that PDF', 'err'); }
          return;
        }

        h.close();
        if (act === 'sent') { setStatus(id, 'sent'); toast('Marked sent'); }
        else if (act === 'decline') { setStatus(id, 'declined'); toast('Declined · moved to archive'); }
        else if (act === 'archive') { archiveQuote(id); toast('Archived'); }
        else if (act === 'restore') { unarchiveQuote(id); toast('Back in the list'); }
        else if (act === 'edit') { return openQuoteSheet({ id, onSaved: ctx.refresh }); }
        else if (act === 'revise') {
          const next = reviseQuote(id);
          toast(`Revised as ${next.mrNo}`);
          return openQuoteSheet({ id: next.id, onSaved: ctx.refresh });
        } else if (act === 'dup') {
          const next = duplicateQuote(id);
          toast(`Copied to ${next.mrNo} — add the client`);
          return openQuoteSheet({ id: next.id, onSaved: ctx.refresh });
        }
        ctx.refresh();
      });
    },
  });
}

/* Accepting is the one action that reaches into Phynance, and one
   form covers the three ways a quotation is actually approved:
   as quoted, at a figure the client negotiated to, or with GST kept
   out of the job's own value. The amount field is what tells the
   two apart — editing it away from the quoted total is what makes a
   sub-quotation, not a separate button, because that is the one
   piece of information that decides it. */
async function openAccept(id, ctx) {
  const { acceptQuote, quoteTotals: totals, baseNo } = await import('../quotes.js');
  const q = getQuote(id);
  if (!q) return;
  const t = totals(q);
  let includeGst = true;

  const h = openSheet({
    title: 'Quotation approved',
    body: `
      <div class="sheet-body">
      <p class="sheet-lede">This opens the job in Phynance and moves the quotation to the archive.</p>

      ${field('Job code',
        `<input class="control" data-code value="${esc(q.jobCode || baseNo(q.mrNo) || '')}" autocapitalize="characters">`)}

      ${field('Approved amount',
        `<input class="control num" data-amount type="number" inputmode="decimal" value="${t.total}">`,
        'Leave as quoted, or change it to what the client actually agreed — that writes a sub-quotation carrying this figure rather than editing the one you sent.')}

      <label class="switchrow" data-gst-row>
        <div><div class="sw-t">Count GST in the job value</div>
          <div class="sw-s">Off books the job at ${inr(t.sub)} — the pre-tax figure — and the quotation shows it was approved that way.</div></div>
        <div class="switch on" data-gst-switch></div>
      </label>

      <button class="btn" data-go>Approve and open job</button>
      </div>
    `,
    onMount(sheet, hdl) {
      const amountEl = sheet.querySelector('[data-amount]');
      const swEl = sheet.querySelector('[data-gst-switch]');

      on(sheet, '[data-gst-row]', () => {
        includeGst = !includeGst;
        swEl.classList.toggle('on', includeGst);
      });

      sheet.querySelector('[data-go]').onclick = () => {
        const code = sheet.querySelector('[data-code]').value.trim().toUpperCase();
        const approvedTotal = Number(amountEl.value) || 0;
        const result = acceptQuote(id, { jobCode: code, approvedTotal, excludeGst: !includeGst });
        const differed = result && result.approvedTotal != null;
        toast(code
          ? `Approved${differed ? ` at ${inr(approvedTotal)}` : ''} · job ${code} open`
          : 'Approved');
        hdl.close();
        ctx.refresh();
      };
    },
  });
  return h;
}
