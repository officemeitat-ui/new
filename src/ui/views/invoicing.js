// Fakturierung (eigenes Modul): Kunden und Artikel, Angebote → Auftrag → Rechnung, Stornorechnung und
// Rechnungskorrektur, Daueraufträge mit Wertsicherung (Monatslauf), Übernahme aus Leistungsnachweis und
// Kalkulation, offene Posten mit Zahlungseingang und Mahnstufen, PDF mit Zahlungs-QR-Code, Versand per
// E-Mail, Ablage in SharePoint, Export für die Steuerberatung (CSV), Umsatz je Monat und Kunde.
// Datei fakturierung/fakturierung.json (Rechenkern: core/invoicing.js, PDF: export/invoice-pdf.js).
//
// Festgeschriebene Belege ändert niemand mehr: Korrektur nur über Storno bzw. Rechnungskorrektur.
// Haben zwei Personen gleichzeitig festgeschrieben (zusammengeführte Datei mit doppelter Nummer),
// bekommt der spätere, noch nicht versendete Beleg beim nächsten Öffnen die nächste freie Nummer.

import { sendMail } from '../../auth/graph-mail.js'
import { calcWage, calculate } from '../../core/calculation.js'
import { addDays, firstOfMonth, formatDate, todayISO } from '../../core/dates.js'
import {
  archivePath,
  blocking,
  convertDraft,
  correctionDraft,
  customerForObject,
  deDate,
  docFileName,
  dueDateFor,
  emptyInvoicing,
  EXPORT_DEFAULT_COLUMNS,
  exportCsv,
  exportRows,
  finalize,
  formatIban,
  ibanValid,
  INTERVALS,
  intact,
  invoiceMailText,
  isInvoice,
  KINDS,
  linesFromProof,
  monthLabel,
  nextCustomerNo,
  openAmount,
  openItems,
  paidOf,
  parseNumber,
  PAY_STATUS,
  periodLabel,
  periodOf,
  problems,
  recipientOf,
  reminderFileName,
  reminderFor,
  reminderMailText,
  resolveDuplicates,
  revenueByCustomer,
  revenueByMonth,
  round2,
  runRecurring,
  settingsOf,
  stateOf,
  stornoDraft,
  totals,
  UNITS,
  VAT_RATES,
} from '../../core/invoicing.js'
import { objectsWithWork, proofFor } from '../../core/proof.js'
import { mergeRules } from '../../core/rules.js'
import { absMinutes } from '../../core/timeclock.js'
import { invoiceDocument, reminderDocument } from '../../export/invoice-pdf.js'
import { app, canEdit, closeModal, computeRange, confirmStep, ensureRange, openModal, persist, registerActions, registerModal, registerObjectHint, registerView, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { bankTab, openCredits, staleBankCredits } from './invoicing-bank.js'
import { canMail } from '../modals/send.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, download, esc, euro, ICON, menu, modalFrame, options, tabBar, uid, val } from '../shared.js'

const MODULE = 'fakturierung'
const ICON_INVOICE = '<path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z"/><path d="M9 7.5h6M9 11h6M9 14.5h3.5"/>'

const F = () => {
  const d = (app.data.fakturierung ||= emptyInvoicing())
  for (const k of ['customers', 'articles', 'documents', 'recurring']) d[k] ||= []
  d.settings ||= {}
  d.indexValues ||= {}
  return d
}
const S = () => settingsOf(F())
const editable = () => canEdit(MODULE) && !app.readOnly
const by = () => app.user?.name || 'Browser'
const nowIso = () => new Date().toISOString()
const custOf = (id) => F().customers.find((c) => c.id === id)
const docOf = (id) => F().documents.find((d) => d.id === id)
const objName = (id) => app.data.objects.find((o) => o.id === id)?.name || ''
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const money = (n) => euro(round2(n))
const num = (id) => parseNumber(val(id))
const STATE_CLASS = { entwurf: '', offen: 'info', ueberfaellig: 'error', teilbezahlt: 'warning', bezahlt: 'ok', storniert: '', angenommen: 'ok', abgelehnt: '', abgelaufen: 'warning', erledigt: 'ok' }
const pill = (state) => `<span class="pill ${STATE_CLASS[state] || ''}">${PAY_STATUS[state] || state}</span>`
const year = () => (/^\d{4}$/.test(app.ui.fakYear || '') ? app.ui.fakYear : todayISO().slice(0, 4))
const sees = (m) => !app.access || app.access.sees(m)

function commit(message) {
  persist()
  renderNow()
  if (message) toast(message)
}

/** Doppelte Nummern (gleichzeitig festgeschrieben, zusammengeführt) gleich bereinigen. */
function checkNumbers() {
  if (!editable()) return { conflicts: [] }
  const d = F()
  const r = resolveDuplicates(d.documents, S(), { now: nowIso(), by: by() })
  if (r.renumbered.length) {
    d.documents = r.docs
    setTimeout(() => {
      persist()
      toast(`Doppelt vergebene Nummer bereinigt: ${r.renumbered.map((x) => `${x.from} → ${x.to}`).join(', ')}`)
      renderNow()
    }, 0)
  }
  return r
}

// ---------------------------------------------------------------- Ansicht

const TABS = [
  ['start', 'Übersicht'],
  ['rechnungen', 'Rechnungen'],
  ['angebote', 'Angebote & Aufträge'],
  ['offen', 'Offene Posten'],
  ['bank', 'Bank'],
  ['dauer', 'Daueraufträge'],
  ['kunden', 'Kunden'],
  ['artikel', 'Artikel'],
  ['einstellungen', 'Einstellungen'],
]
// Reiter gegliedert: Belege, Zahlungen und Stammdaten als Aufklappmenü
const TAB_GROUPS = ['start', { label: 'Belege', items: ['rechnungen', 'angebote', 'dauer'] }, { label: 'Zahlungen', items: ['offen', 'bank'] }, { label: 'Stammdaten', items: ['kunden', 'artikel'] }, 'einstellungen']
const tabOf = (k, flags) => ({ id: k, label: TABS.find(([id]) => id === k)[1], flag: flags[k] })

/** Neben „+ Rechnung“: weitere Belege anlegen, Übernahmen, Export. */
function headMenus(ed) {
  const proofOk = sees('planung')
  return `${menu({
    label: 'Anlegen',
    icon: ICON.plus,
    items: [
      ed && { heading: 'Beleg' },
      ed && { label: 'Angebot', action: 'fak-new', data: { kind: 'angebot' } },
      ed && { label: 'Auftragsbestätigung', action: 'fak-new', data: { kind: 'auftrag' } },
      ed && { label: 'Dauerauftrag', action: 'fak-rec-open', hint: 'monatlich, quartalsweise … abrechnen' },
      ed && proofOk && { label: 'Aus Leistungsnachweis', action: 'fak-proof-open', hint: 'Entwürfe je Objekt und Monat' },
      ed && { heading: 'Stammdaten' },
      ed && { label: 'Kunde', action: 'fak-cust-open' },
      ed && { label: 'Artikel / Leistung', action: 'fak-art-open' },
    ],
    single: false,
  })}${menu({
    label: 'Export',
    icon: ICON.download,
    items: [
      { label: 'Export Steuerberatung', action: 'fak-export-open', hint: 'Belege und Zahlungen als CSV' },
      ed && { label: 'Kontoauszug einlesen', action: 'fak-tab', data: { v: 'bank' }, hint: 'camt.053 oder CSV im Reiter Bank' },
    ],
  })}`
}

function counts() {
  const d = F()
  const today = todayISO()
  const items = openItems(d.documents, today, S())
  const remind = items.filter((x) => x.next).length
  const drafts = d.documents.filter((x) => !x.number && isInvoice(x)).length
  const due = recurringDue(todayISO().slice(0, 7)).length
  return { items, remind, drafts, due, badge: remind + due }
}

/** Daueraufträge mit Abrechnung im Monat, für die noch kein Entwurf besteht. */
function recurringDue(ym) {
  const d = F()
  const have = new Set(d.documents.map((x) => x.source?.key).filter(Boolean))
  return d.recurring.filter((r) => r.active !== false && periodOf(r, ym) && !have.has(`rec:${r.id}:${ym}`))
}

function invoicingView() {
  checkNumbers()
  const tab = TABS.some(([k]) => k === app.ui.fakTab) ? app.ui.fakTab : 'start'
  const n = counts()
  const flags = { offen: n.remind, rechnungen: n.drafts, dauer: n.due, bank: openCredits().length }
  const ed = editable()
  const setup = !S().sender.name || !S().bank.iban
  const body = { start: startTab, rechnungen: invoicesTab, angebote: offersTab, offen: openTab, bank: bankTab, dauer: recurringTab, kunden: customersTab, artikel: articlesTab, einstellungen: settingsTab }[tab]()
  return `<div class="section-head"><div><h2>Fakturierung</h2>
      <p>Angebote, Rechnungen und Daueraufträge mit allen Angaben nach § 11 UStG, Zahlungseingang und Mahnungen, PDF mit QR-Code zum Bezahlen, Versand per E-Mail, Export für die Steuerberatung.</p></div>
      <div class="actions">${ed ? `<button class="btn primary" data-action="fak-new" data-kind="rechnung">${ICON.plus} Rechnung</button>` : ''}${headMenus(ed)}</div></div>
    ${setup && tab !== 'einstellungen' ? `<div class="banner warn-banner"><p><strong>Noch nicht eingerichtet:</strong> Firmenname, Anschrift, UID und Bankverbindung für die Belege fehlen.</p>${ed ? '<button class="btn primary" data-action="fak-tab" data-v="einstellungen">Einstellungen</button>' : ''}</div>` : ''}
    ${tabBar({ action: 'fak-tab', current: tab, cls: 'fak-tabs', tabs: TAB_GROUPS.map((g) => (g.items ? { label: g.label, items: g.items.map((k) => tabOf(k, flags)) } : tabOf(g, flags))) })}
    ${body}`
}

registerView({
  id: 'fakturierung',
  order: 64,
  label: 'Fakturierung',
  group: 'auswertung',
  section: 'finanzen',
  module: MODULE,
  icon: ICON_INVOICE,
  noWeek: true,
  text: 'Angebote, Rechnungen, offene Posten, Mahnungen',
  badge: () => counts().badge,
  render: invoicingView,
})

const tile = (label, value, cls = '', action = '') => `<${action ? `button data-action="fak-tab" data-v="${action}"` : 'div'} class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></${action ? 'button' : 'div'}>`

function yearSelect() {
  const years = [...new Set([todayISO().slice(0, 4), ...F().documents.map((d) => String(d.date || '').slice(0, 4)).filter(Boolean)])].sort().reverse()
  return `<label class="field inline"><span>Jahr</span><select id="fak-year" data-change="fak-year">${options(years.map((y) => [y, y]), year())}</select></label>`
}

function startTab() {
  const d = F()
  const s = S()
  const y = year()
  const today = todayISO()
  const months = revenueByMonth(d.documents, y, s)
  const total = round2(months.reduce((a, m) => a + m.net, 0))
  const n = counts()
  const open = round2(n.items.reduce((a, x) => a + x.open, 0))
  const overdue = n.items.filter((x) => x.overdueDays > 0)
  const max = Math.max(1, ...months.map((m) => Math.abs(m.net)))
  const bars = months
    .map((m) => `<div class="fak-bar" title="${esc(monthLabel(m.month))}: ${money(m.net)} netto, ${plural(m.count, 'Rechnung', 'Rechnungen')}"><span class="fak-bar-fill" style="height:${Math.max(2, Math.round((Math.abs(m.net) / max) * 100))}%"></span><small>${monthLabel(m.month).slice(0, 3)}</small></div>`)
    .join('')
  const top = revenueByCustomer(d.documents, y, s).slice(0, 8)
  const ym = today.slice(0, 7)
  const due = recurringDue(ym)
  const drafts = d.documents.filter((x) => !x.number && isInvoice(x))
  const broken = d.documents.filter((x) => !intact(x))
  const todo = [
    due.length ? `<div class="todo-item"><span class="flag warning">${due.length}</span><div class="todo-text"><strong>Daueraufträge für ${esc(monthLabel(ym))}</strong> noch nicht abgerechnet</div>${editable() ? `<button class="btn small primary" data-action="fak-run" data-ym="${ym}">Monatslauf</button>` : ''}</div>` : '',
    drafts.length ? `<div class="todo-item"><span class="flag">${drafts.length}</span><div class="todo-text"><strong>Entwürfe</strong> prüfen und festschreiben</div><button class="btn small" data-action="fak-tab" data-v="rechnungen">Ansehen</button></div>` : '',
    n.remind ? `<div class="todo-item"><span class="flag error">${n.remind}</span><div class="todo-text"><strong>Mahnung fällig</strong> (Zahlungsziel überschritten)</div><button class="btn small" data-action="fak-tab" data-v="offen">Offene Posten</button></div>` : '',
    broken.length ? `<div class="todo-item"><span class="flag error">!</span><div class="todo-text"><strong>Beleg nachträglich verändert:</strong> ${esc(broken.map((x) => x.number).join(', '))}. Die Prüfsumme passt nicht mehr; im Versionsverlauf von SharePoint nachsehen.</div></div>` : '',
  ].join('')
  return `<div class="filters">${yearSelect()}</div>
    <div class="impact-stats tc-stats">${tile(`Umsatz ${y} netto`, money(total))}${tile('Offen', money(open), '', 'offen')}${tile('Überfällig', `${overdue.length} · ${money(overdue.reduce((a, x) => a + x.open, 0))}`, overdue.length ? 'err' : '', 'offen')}${tile('Entwürfe', drafts.length, '', 'rechnungen')}</div>
    ${todo ? `<div class="todo-list">${todo}</div>` : ''}
    <h3>Umsatz je Monat (netto)</h3><div class="fak-bars" role="img" aria-label="Umsatz je Monat">${bars}</div>
    ${top.length ? `<h3>Kunden ${y}</h3><div class="table-wrap"><table class="data"><thead><tr><th>Kunde</th><th class="num">Rechnungen</th><th class="num">Umsatz netto</th><th class="num">offen</th></tr></thead><tbody>${top.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.count}</td><td class="num">${money(c.net)}</td><td class="num">${c.open ? money(c.open) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Noch keine festgeschriebenen Rechnungen in diesem Jahr.</p>'}`
}

function docRow(x, docs, today, s) {
  const t = x.total || totals(x, s)
  const st = stateOf(x, docs, today, s)
  const open = x.kind === 'rechnung' && x.number ? openAmount(x, docs, s) : 0
  return `<tr class="clickable" data-action="fak-open" data-id="${esc(x.id)}"><td>${x.number ? `<strong>${esc(x.number)}</strong>` : '<span class="muted">Entwurf</span>'}${x.kind !== 'rechnung' && x.kind !== 'angebot' ? `<br><span class="muted">${esc(KINDS[x.kind])}${x.refNumber ? ` zu ${esc(x.refNumber)}` : ''}</span>` : ''}</td>
    <td>${x.date ? formatDate(x.date, { year: true }) : ''}</td><td>${esc(x.recipient?.name || '–')}${x.objectId ? `<br><span class="muted">${esc(objName(x.objectId))}</span>` : ''}</td>
    <td>${esc(x.title || '')}${x.serviceFrom ? `<br><span class="muted">${esc(periodLabel({ from: x.serviceFrom, to: x.serviceTo || x.serviceFrom }))}</span>` : ''}</td>
    <td class="num">${money(t.net)}</td><td class="num"><strong>${money(t.gross)}</strong>${open && open !== t.gross ? `<br><span class="muted">offen ${money(open)}</span>` : ''}</td>
    <td>${pill(st)}${x.reverseCharge ? ' <span class="pill info" title="Reverse Charge § 19 Abs. 1a UStG">RC</span>' : ''}${x.sent?.length ? ` <span class="pill" title="versendet">${ICON.send}</span>` : ''}${intact(x) ? '' : ' <span class="pill error" title="Prüfsumme passt nicht">verändert</span>'}</td></tr>`
}

function listFilters(kinds) {
  const st = app.ui.fakState || ''
  const states = kinds.includes('angebot') ? ['entwurf', 'offen', 'angenommen', 'abgelehnt', 'abgelaufen'] : ['entwurf', 'offen', 'ueberfaellig', 'teilbezahlt', 'bezahlt', 'storniert']
  return `${yearSelect()}<label class="field inline"><span>Status</span><select id="fak-state" data-change="fak-state">${options(states.map((k) => [k, PAY_STATUS[k]]), st, { empty: 'alle' })}</select></label>
    <label class="field inline"><span>Suche</span><input type="search" id="fak-search" value="${esc(app.ui.fakSearch || '')}" data-input="fak-search" placeholder="Nummer, Kunde, Objekt"></label>`
}

function filteredDocs(kinds) {
  const d = F()
  const s = S()
  const today = todayISO()
  const y = year()
  const q = String(app.ui.fakSearch || '').trim().toLowerCase()
  const st = app.ui.fakState || ''
  return d.documents
    .filter((x) => kinds.includes(x.kind))
    .filter((x) => !x.number || String(x.date).startsWith(y))
    .filter((x) => !st || stateOf(x, d.documents, today, s) === st)
    .filter((x) => !q || [x.number, x.recipient?.name, x.title, objName(x.objectId)].some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => (a.number ? 1 : 0) - (b.number ? 1 : 0) || String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)))
}

function invoicesTab() {
  const d = F()
  const s = S()
  const today = todayISO()
  const list = filteredDocs(['rechnung', 'storno', 'korrektur'])
  const ed = editable()
  const proofOk = sees('planung')
  return `<div class="filters">${listFilters(['rechnung'])}<span class="spacer"></span>
      ${ed && proofOk ? `<button class="btn small" data-action="fak-proof-open">Aus Leistungsnachweis</button>` : ''}
      <button class="btn small" data-action="fak-export-open">${ICON.download} Export Steuerberatung</button></div>
    ${list.length ? `<div class="table-wrap"><table class="data fak-table"><thead><tr><th>Nummer</th><th>Datum</th><th>Empfänger</th><th>Betreff</th><th class="num">netto</th><th class="num">brutto</th><th>Status</th></tr></thead><tbody>${list.map((x) => docRow(x, d.documents, today, s)).join('')}</tbody></table></div>` : '<p class="empty">Keine Rechnungen für diese Auswahl.</p>'}
    <p class="note">Entwürfe lassen sich ändern und löschen. Festgeschriebene Rechnungen sind unveränderlich (fortlaufende Nummer, Prüfsumme); korrigiert wird mit Stornorechnung oder Rechnungskorrektur. Aufbewahrung 7 Jahre (§ 132 BAO): die Datei fakturierung/fakturierung.json und die PDFs unter fakturierung/belege/ in SharePoint.</p>`
}

function offersTab() {
  const d = F()
  const s = S()
  const today = todayISO()
  const list = filteredDocs(['angebot', 'auftrag'])
  return `<div class="filters">${listFilters(['angebot'])}</div>
    ${list.length ? `<div class="table-wrap"><table class="data fak-table"><thead><tr><th>Nummer</th><th>Datum</th><th>Empfänger</th><th>Betreff</th><th class="num">netto</th><th class="num">brutto</th><th>Status</th></tr></thead><tbody>${list.map((x) => docRow(x, d.documents, today, s)).join('')}</tbody></table></div>` : '<p class="empty">Keine Angebote für diese Auswahl.</p>'}
    <p class="note">Aus einem Angebot wird mit einem Klick eine Auftragsbestätigung oder Rechnung (Positionen werden übernommen). Preise je Objekt kommen auf Wunsch aus der Kalkulation.</p>`
}

function openTab() {
  const s = S()
  const items = counts().items
  const ed = editable()
  const rows = items
    .map(({ doc: x, open, overdueDays, level, next }) => `<tr><td><button class="link-btn" data-action="fak-open" data-id="${esc(x.id)}">${esc(x.number)}</button></td><td>${esc(x.recipient?.name || '')}</td><td>${formatDate(x.dueDate, { year: true })}</td>
      <td class="num">${overdueDays ? `<span class="pill ${overdueDays > 30 ? 'error' : 'warning'}">${overdueDays} Tage</span>` : ''}</td><td class="num">${money(grossOfDoc(x))}</td><td class="num"><strong>${money(open)}</strong></td>
      <td>${level ? esc(s.reminders[Math.min(level, s.reminders.length) - 1]?.name || '') : ''}${next ? ` <span class="pill error">${esc(next.step.name)} fällig</span>` : ''}</td>
      <td class="actions-cell">${ed ? `<button class="btn small" data-action="fak-pay-open" data-id="${esc(x.id)}">Zahlung</button> ${level < s.reminders.length ? `<button class="btn small ${next ? 'primary' : ''}" data-action="fak-remind-open" data-id="${esc(x.id)}">${esc(s.reminders[level].name)}</button>` : ''}` : ''}</td></tr>`)
    .join('')
  const sum = round2(items.reduce((a, x) => a + x.open, 0))
  return `<div class="impact-stats tc-stats">${tile('Offene Rechnungen', items.length)}${tile('Summe offen', money(sum))}${tile('überfällig', items.filter((x) => x.overdueDays).length, items.some((x) => x.overdueDays) ? 'err' : '')}${tile('Mahnung fällig', items.filter((x) => x.next).length)}</div>
    ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Rechnung</th><th>Kunde</th><th>fällig</th><th class="num">überfällig</th><th class="num">brutto</th><th class="num">offen</th><th>Mahnstufe</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine offenen Rechnungen.</p>'}
    <p class="note">Mahnstufen und Fristen in den Einstellungen. Verzugszinsen unter Unternehmern: Basiszinssatz (${String(s.baseRate).replace('.', ',')} %) plus 9,2 Prozentpunkte (§ 456 UGB), dazu einmal 40 € Pauschale (§ 458 UGB); gegenüber Verbrauchern 4 %.</p>`
}

const grossOfDoc = (x) => (x.total ? x.total.gross : totals(x, S()).gross)

function recurringTab() {
  const d = F()
  const ed = editable()
  const ym = /^\d{4}-\d{2}$/.test(app.ui.fakRunMonth || '') ? app.ui.fakRunMonth : todayISO().slice(0, 7)
  const due = new Set(recurringDue(ym).map((r) => r.id))
  const rows = d.recurring
    .map((r) => {
      const t = totals({ lines: r.lines, reverseCharge: custOf(r.customerId)?.reverseCharge }, S())
      return `<tr class="clickable" data-action="fak-rec-open" data-id="${esc(r.id)}"><td><strong>${esc(r.title || 'Dauerauftrag')}</strong>${r.objectId ? `<br><span class="muted">${esc(objName(r.objectId))}</span>` : ''}</td><td>${esc(custOf(r.customerId)?.name || '–')}</td><td>${esc(INTERVALS[r.interval] || '')}</td>
        <td>${r.startMonth ? esc(monthLabel(r.startMonth)) : ''}${r.endMonth ? ` – ${esc(monthLabel(r.endMonth))}` : ''}</td><td class="num">${money(t.net)}</td><td>${r.index?.active ? `${esc(S().indexName)} ${String(r.index.baseValue || '').replace('.', ',')}${r.index.threshold ? ` (ab ${String(r.index.threshold).replace('.', ',')} %)` : ''}` : '–'}</td>
        <td>${r.active === false ? '<span class="pill">beendet</span>' : due.has(r.id) ? `<span class="pill warning">für ${esc(monthLabel(ym))} offen</span>` : r.lastRun ? `<span class="pill ok">zuletzt ${esc(monthLabel(r.lastRun))}</span>` : ''}</td></tr>`
    })
    .join('')
  const idx = Object.entries(d.indexValues).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12)
  return `<div class="filters"><label class="field inline"><span>Monat</span><input type="month" id="fak-run-month" value="${ym}" data-change="fak-run-month"></label>
      ${ed ? `<button class="btn primary" data-action="fak-run" data-ym="${ym}" ${due.size ? '' : 'disabled'}>Monatslauf: ${plural(due.size, 'Entwurf', 'Entwürfe')} erstellen</button><span class="spacer"></span><button class="btn small" data-action="fak-rec-open">${ICON.plus} Dauerauftrag</button>` : ''}</div>
    ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Dauerauftrag</th><th>Kunde</th><th>Rhythmus</th><th>Laufzeit</th><th class="num">netto je Abrechnung</th><th>Wertsicherung</th><th>Stand</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Noch keine Daueraufträge. Typisch: Unterhaltsreinigung je Objekt monatlich, Glasreinigung quartalsweise.</p>'}
    <h3>Indexzahlen (${esc(S().indexName)})</h3>
    <p class="muted">Monatswerte laut Statistik Austria eintragen. Der Monatslauf vergleicht den letzten Wert vor dem Abrechnungsmonat mit der Basis des Auftrags und passt die Preise an, sobald die Schwelle erreicht ist (dann um die ganze Veränderung; der neue Wert wird die Basis).</p>
    <div class="filters">${ed ? `<label class="field inline"><span>Monat</span><input type="month" id="fak-idx-month" value="${addDays(firstOfMonth(todayISO()), -1).slice(0, 7)}"></label><label class="field inline"><span>Wert</span><input type="text" inputmode="decimal" id="fak-idx-value" placeholder="z. B. 131,4" style="width:7rem"></label><button class="btn small" data-action="fak-idx-add">Eintragen</button>` : ''}</div>
    ${idx.length ? `<p>${idx.map(([m, v]) => `<span class="pill">${esc(monthLabel(m))}: ${String(v).replace('.', ',')}${ed ? ` <button class="link-btn" data-action="fak-idx-del" data-ym="${m}" title="Entfernen">×</button>` : ''}</span>`).join(' ')}</p>` : ''}`
}

function customersTab() {
  const d = F()
  const ed = editable()
  const q = String(app.ui.fakCustSearch || '').trim().toLowerCase()
  const list = d.customers.filter((c) => !q || [c.name, c.customerNo, c.email].some((v) => String(v || '').toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const without = app.data.objects.filter((o) => !customerForObject(d, o.id))
  const rows = list
    .map((c) => `<tr class="clickable" data-action="fak-cust-open" data-id="${esc(c.id)}"><td>${esc(c.customerNo || '')}</td><td><strong>${esc(c.name)}</strong>${c.address ? `<br><span class="muted">${esc(String(c.address).split('\n').join(', '))}</span>` : ''}</td><td>${esc(c.uid || '')}</td><td>${esc(c.email || '')}</td>
      <td>${esc((c.objectIds || []).map(objName).filter(Boolean).join(', '))}</td><td>${c.reverseCharge ? '<span class="pill info">Reverse Charge</span>' : ''}${c.consumer ? '<span class="pill">Verbraucher</span>' : ''}</td></tr>`)
    .join('')
  return `<div class="filters"><label class="field inline"><span>Suche</span><input type="search" id="fak-cust-search" value="${esc(app.ui.fakCustSearch || '')}" data-input="fak-cust-search" placeholder="Name, Nummer, E-Mail"></label><span class="spacer"></span>
      ${ed && without.length ? `<button class="btn small" data-action="fak-cust-from-objects">Kunden aus ${plural(without.length, 'Objekt', 'Objekten')} anlegen</button>` : ''}${ed ? `<button class="btn small" data-action="fak-cust-open">${ICON.plus} Kunde</button>` : ''}</div>
    ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Nr.</th><th>Kunde (Rechnungsempfänger)</th><th>UID</th><th>E-Mail</th><th>Objekte</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Noch keine Kunden.</p>'}
    <p class="note">Rechnungsempfänger ist oft die Hausverwaltung, nicht das Objekt. Reverse Charge nur, wenn der Kunde selbst üblicherweise Bauleistungen erbringt (z. B. eine andere Reinigungsfirma, ein Bauunternehmen) – nicht für Hausverwaltungen, Büros oder Geschäfte.</p>`
}

const STARTER_ARTICLES = [
  ['Unterhaltsreinigung lt. Vertrag', 'Monat', 0],
  ['Reinigung nach Aufwand', 'Std.', 0],
  ['Grundreinigung', 'm²', 0],
  ['Glas- und Fensterreinigung', 'm²', 0],
  ['Sonderreinigung', 'Std.', 0],
  ['Winterdienst Pauschale', 'Monat', 0],
  ['Anfahrt', 'Pauschale', 0],
  ['Reinigungsmittel und Verbrauchsmaterial', 'Pauschale', 0],
]

function articlesTab() {
  const d = F()
  const ed = editable()
  const rows = d.articles
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .map((a) => `<tr class="clickable" data-action="fak-art-open" data-id="${esc(a.id)}"><td><strong>${esc(a.name)}</strong>${a.text ? `<br><span class="muted">${esc(a.text)}</span>` : ''}</td><td>${esc(a.unit || '')}</td><td class="num">${a.price ? money(a.price) : '–'}</td><td class="num">${a.vat ?? S().vat} %</td></tr>`)
    .join('')
  return `<div class="filters"><span class="spacer"></span>${ed && !d.articles.length ? '<button class="btn small" data-action="fak-art-starter">Übliche Leistungen anlegen</button>' : ''}${ed ? `<button class="btn small" data-action="fak-art-open">${ICON.plus} Artikel</button>` : ''}</div>
    ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Artikel / Leistung</th><th>Einheit</th><th class="num">Preis netto</th><th class="num">USt</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Noch keine Artikel. Artikel sind Vorlagen für Positionen (Bezeichnung, Einheit, Preis).</p>'}`
}

function settingsTab() {
  const s = S()
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const y = todayISO().slice(0, 4)
  const r = s.reminders
  const ibanWarn = s.bank.iban && !ibanValid(s.bank.iban)
  return `<h3>Absender (steht auf jedem Beleg)</h3>
    <div class="form-grid">
      <label class="field"><span>Firmenname</span><input type="text" id="fs-name" value="${esc(s.sender.name)}" ${dis}></label>
      <label class="field"><span>UID-Nummer</span><input type="text" id="fs-uid" value="${esc(s.sender.uid)}" placeholder="ATU…" ${dis}></label>
      <label class="field wide"><span>Anschrift (mehrzeilig)</span><textarea id="fs-address" rows="2" ${dis}>${esc(s.sender.address)}</textarea></label>
      <label class="field"><span>Telefon</span><input type="text" id="fs-phone" value="${esc(s.sender.phone)}" ${dis}></label>
      <label class="field"><span>E-Mail</span><input type="email" id="fs-email" value="${esc(s.sender.email)}" ${dis}></label>
      <label class="field"><span>Web</span><input type="text" id="fs-web" value="${esc(s.sender.web)}" ${dis}></label>
      <label class="field"><span>Firmenbuch, Gericht</span><input type="text" id="fs-register" value="${esc(s.sender.register)}" placeholder="FN 123456 a, LG Salzburg" ${dis}></label>
    </div>
    <h3>Bankverbindung</h3>
    <div class="form-grid">
      <label class="field"><span>IBAN</span><input type="text" id="fs-iban" value="${esc(formatIban(s.bank.iban))}" ${dis}></label>
      <label class="field"><span>BIC</span><input type="text" id="fs-bic" value="${esc(s.bank.bic)}" ${dis}></label>
      <label class="field"><span>Bank</span><input type="text" id="fs-bank" value="${esc(s.bank.name)}" ${dis}></label>
    </div>
    ${ibanWarn ? '<p class="err-text">Die IBAN ist ungültig (Prüfziffer). Ohne gültige IBAN gibt es keinen QR-Code.</p>' : ''}
    <h3>Rechnungen</h3>
    <div class="form-grid">
      <label class="field"><span>Zahlungsziel (Tage)</span><input type="number" id="fs-days" min="0" value="${esc(s.paymentDays)}" ${dis}></label>
      <label class="field"><span>USt-Satz Standard</span><select id="fs-vat" ${dis}>${options(VAT_RATES.map((v) => [String(v), `${v} %`]), String(s.vat))}</select></label>
      <label class="field"><span>Angebot gültig (Tage)</span><input type="number" id="fs-offer-days" min="1" value="${esc(s.offerDays)}" ${dis}></label>
      <label class="field"><span>Stellen der Nummer</span><input type="number" id="fs-digits" min="3" max="6" value="${esc(s.digits)}" ${dis}></label>
      ${Object.entries(KINDS).map(([k, label]) => `<label class="field"><span>Kürzel ${esc(label)}</span><input type="text" id="fs-series-${k}" value="${esc(s.series[k])}" maxlength="6" ${dis}></label>`).join('')}
      <label class="field"><span>Erste Rechnungsnummer ${y} (Umstieg)</span><input type="number" id="fs-start" min="1" value="${esc(s.start[`rechnung|${y}`] || '')}" placeholder="1" ${dis}></label>
      <label class="field wide"><span>Einleitung Rechnung</span><input type="text" id="fs-intro" value="${esc(s.intro)}" ${dis}></label>
      <label class="field wide"><span>Schlusstext Rechnung</span><input type="text" id="fs-outro" value="${esc(s.outro)}" ${dis}></label>
      <label class="field wide"><span>Einleitung Angebot</span><input type="text" id="fs-offer-intro" value="${esc(s.offerIntro)}" ${dis}></label>
      <label class="field wide"><span>Schlusstext Angebot</span><input type="text" id="fs-offer-outro" value="${esc(s.offerOutro)}" ${dis}></label>
      <label class="check wide"><input type="checkbox" id="fs-small" ${s.smallBusiness ? 'checked' : ''} ${dis}><span>Kleinunternehmer (§ 6 Abs. 1 Z 27 UStG): keine Umsatzsteuer, Hinweis auf jeder Rechnung</span></label>
    </div>
    <h3>Mahnwesen</h3>
    <div class="form-grid">
      <label class="field"><span>Basiszinssatz OeNB (%)</span><input type="text" inputmode="decimal" id="fs-base" value="${esc(String(s.baseRate).replace('.', ','))}" ${dis}></label>
      ${r.map((x, i) => `<label class="field"><span>Stufe ${i + 1}: Name</span><input type="text" id="fs-r${i}-name" value="${esc(x.name)}" ${dis}></label><label class="field"><span>Tage nach ${i ? 'voriger Frist' : 'Fälligkeit'}</span><input type="number" id="fs-r${i}-days" min="0" value="${esc(x.days)}" ${dis}></label><label class="check"><input type="checkbox" id="fs-r${i}-interest" ${x.interest ? 'checked' : ''} ${dis}><span>Verzugszinsen</span></label><label class="check"><input type="checkbox" id="fs-r${i}-fee" ${x.fee ? 'checked' : ''} ${dis}><span>40 € Pauschale (Unternehmer)</span></label>`).join('')}
    </div>
    <h3>Export für die Steuerberatung</h3>
    <div class="form-grid">
      <label class="field"><span>Debitorenkonto (Sammelkonto)</span><input type="text" id="fs-acc-deb" value="${esc(s.accounts.debitor)}" placeholder="leer: Kundennummer" ${dis}></label>
      ${VAT_RATES.map((v) => `<label class="field"><span>Erlöskonto ${v} %</span><input type="text" id="fs-acc-${v}" value="${esc(s.accounts.erloese[v] ?? '')}" ${dis}></label>`).join('')}
      <label class="field"><span>Erlöskonto Reverse Charge</span><input type="text" id="fs-acc-rc" value="${esc(s.accounts.rc)}" ${dis}></label>
      <label class="field"><span>Index für Wertsicherung</span><input type="text" id="fs-index" value="${esc(s.indexName)}" ${dis}></label>
    </div>
    ${ed ? '<p><button class="btn primary" data-action="fak-settings-save">Speichern</button></p>' : ''}
    <p class="note">Kontonummern mit der Steuerberatung abstimmen (Kontenplan, Steuercodes in BMD bzw. RZL). Den Basiszinssatz legt die Oesterreichische Nationalbank je Halbjahr fest.</p>`
}

// ---------------------------------------------------------------- Beleg bearbeiten (Entwurf)

function newDraft(kind, extra = {}) {
  const s = S()
  const today = todayISO()
  const id = uid('f')
  const customer = extra.customerId ? custOf(extra.customerId) : null
  return {
    id,
    kind,
    status: 'entwurf',
    date: today,
    serviceFrom: kind === 'rechnung' ? addDays(firstOfMonth(today), -1).slice(0, 8) + '01' : '',
    serviceTo: kind === 'rechnung' ? addDays(firstOfMonth(today), -1) : '',
    dueDate: kind === 'rechnung' ? dueDateFor(today, customer?.paymentDays ?? s.paymentDays) : '',
    validUntil: kind === 'angebot' ? addDays(today, Number(s.offerDays) || 30) : '',
    customerId: '',
    objectId: '',
    recipient: {},
    reverseCharge: false,
    discount: 0,
    title: '',
    intro: kind === 'angebot' ? s.offerIntro : s.intro,
    outro: kind === 'angebot' ? s.offerOutro : s.outro,
    lines: [{ id: uid('l'), text: '', qty: 1, unit: 'Pauschale', price: '', vat: s.vat, discount: 0 }],
    createdAt: nowIso(),
    createdBy: by(),
    ...extra,
  }
}

const numText = (v) => (v === '' || v === null || v === undefined ? '' : String(v).replace('.', ','))

function linesEditor(lines, prefix, dis = '') {
  const s = S()
  const rows = lines
    .map(
      (l, i) => `<tr><td><textarea id="${prefix}-${i}-text" rows="1" data-input="fak-recalc" ${dis}>${esc(l.text || '')}</textarea></td>
      <td class="num"><input type="text" inputmode="decimal" id="${prefix}-${i}-qty" value="${esc(numText(l.qty))}" data-input="fak-recalc" ${dis}></td>
      <td><select id="${prefix}-${i}-unit" ${dis}>${options([...new Set([...UNITS, l.unit].filter(Boolean))].map((u) => [u, u]), l.unit || 'Pauschale')}</select></td>
      <td class="num"><input type="text" inputmode="decimal" id="${prefix}-${i}-price" value="${esc(numText(l.price))}" data-input="fak-recalc" ${dis}></td>
      <td class="num"><input type="text" inputmode="decimal" id="${prefix}-${i}-disc" value="${esc(numText(l.discount || ''))}" placeholder="0" data-input="fak-recalc" ${dis}></td>
      <td><select id="${prefix}-${i}-vat" data-change="fak-recalc" ${dis}>${options(VAT_RATES.map((v) => [String(v), `${v} %`]), String(l.vat ?? s.vat))}</select></td>
      <td>${dis ? '' : `<button class="btn icon ghost" data-action="fak-line-del" data-i="${i}" data-prefix="${prefix}" title="Position entfernen">${ICON.trash}</button>`}</td></tr>`,
    )
    .join('')
  return `<div class="table-wrap"><table class="data fak-lines"><thead><tr><th>Bezeichnung</th><th class="num">Menge</th><th>Einheit</th><th class="num">Einzelpreis netto</th><th class="num">Rabatt %</th><th>USt</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
}

function readLines(prefix, old = []) {
  const out = []
  for (let i = 0; document.getElementById(`${prefix}-${i}-text`); i++) {
    out.push({ id: old[i]?.id || uid('l'), text: val(`${prefix}-${i}-text`).trim(), qty: num(`${prefix}-${i}-qty`), unit: val(`${prefix}-${i}-unit`), price: num(`${prefix}-${i}-price`), discount: num(`${prefix}-${i}-disc`), vat: Number(val(`${prefix}-${i}-vat`)) })
  }
  return out
}

/** Eingaben des Belegformulars in den Entwurf übernehmen. */
function readForm(m) {
  const x = m.draft
  if (!document.getElementById('fd-date')) return x
  x.date = val('fd-date')
  x.title = val('fd-title').trim()
  x.intro = val('fd-intro')
  x.outro = val('fd-outro')
  x.discount = num('fd-discount')
  x.reverseCharge = checked('fd-rc')
  if (document.getElementById('fd-from')) {
    x.serviceFrom = val('fd-from')
    x.serviceTo = val('fd-to') || x.serviceFrom
  }
  if (document.getElementById('fd-due')) x.dueDate = val('fd-due')
  if (document.getElementById('fd-valid')) x.validUntil = val('fd-valid')
  x.objectId = val('fd-object')
  x.objectName = objName(x.objectId)
  x.recipient = { ...x.recipient, name: val('fd-rname').trim(), address: val('fd-raddress').trim(), uid: val('fd-ruid').trim().toUpperCase(), email: val('fd-remail').trim(), consumer: checked('fd-rconsumer') }
  x.lines = readLines('fl', x.lines)
  return x
}

function totalsHtml(x) {
  const t = totals(x, S())
  return `<table class="fak-sums">${t.discount ? `<tr><td>Summe Positionen</td><td class="num">${money(t.subtotal)}</td></tr><tr><td>Rabatt</td><td class="num">−${money(t.discount)}</td></tr>` : ''}<tr><td>netto</td><td class="num">${money(t.net)}</td></tr>${t.vatOn ? t.groups.map((g) => `<tr><td>USt ${g.rate} %</td><td class="num">${money(g.vat)}</td></tr>`).join('') : `<tr><td>USt</td><td class="num">${x.reverseCharge ? 'Reverse Charge' : 'Kleinunternehmer'}</td></tr>`}<tr class="sum"><td>brutto</td><td class="num">${money(t.gross)}</td></tr></table>`
}

function problemsHtml(x) {
  const list = problems(x, S())
  const info = list.filter((p) => p.level === 'info')
  const rest = list.filter((p) => p.level !== 'info')
  const li = (p) => `<li class="${p.level === 'error' ? 'err-text' : p.level === 'warn' ? 'warn-text' : 'muted'}">${esc(p.text)}</li>`
  return `${rest.length ? '' : '<p class="ok-text">Alle Pflichtangaben vorhanden.</p>'}${list.length ? `<ul class="fak-problems">${[...rest, ...info].map(li).join('')}</ul>` : ''}`
}

function editorModal(c, m) {
  const x = m.draft
  const d = F()
  const s = S()
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const isInv = isInvoice(x)
  const custOpts = options(d.customers.slice().sort((a, b) => a.name.localeCompare(b.name, 'de')).map((cu) => [cu.id, `${cu.name}${cu.customerNo ? ` (${cu.customerNo})` : ''}`]), x.customerId, { empty: '– Kunde wählen –' })
  const objOpts = options(app.data.objects.map((o) => [o.id, o.name]), x.objectId, { empty: '– ohne Objekt –' })
  const artOpts = options(d.articles.map((a) => [a.id, `${a.name}${a.price ? ` · ${money(a.price)}` : ''}`]), '', { empty: '– Artikel einfügen –' })
  const calc = x.objectId && app.data.kalkulation?.objects?.[x.objectId]?.areas?.length
  const confirm = app.ui.confirm === `fak-final:${x.id}`
  return modalFrame({
    title: `${KINDS[x.kind]} – Entwurf`,
    subtitle: x.refNumber ? `Bezug: ${x.refNumber}` : x.source?.type === 'dauerauftrag' ? 'aus Dauerauftrag' : x.source?.type === 'nachweis' ? 'aus Leistungsnachweis' : '',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Kunde</span><select id="fd-customer" data-change="fak-customer" ${dis}>${custOpts}</select></label>
        <label class="field"><span>Objekt</span><select id="fd-object" data-change="fak-object" ${dis}>${objOpts}</select></label>
        <label class="field"><span>Datum</span><input type="date" id="fd-date" value="${esc(x.date)}" data-change="fak-date" ${dis}></label>
        ${isInv || x.kind === 'auftrag' ? `<label class="field"><span>Leistung von</span><input type="date" id="fd-from" value="${esc(x.serviceFrom)}" ${dis}></label><label class="field"><span>Leistung bis</span><input type="date" id="fd-to" value="${esc(x.serviceTo)}" ${dis}></label>` : ''}
        ${x.kind === 'rechnung' ? `<label class="field"><span>Fällig am</span><input type="date" id="fd-due" value="${esc(x.dueDate)}" ${dis}></label>` : ''}
        ${x.kind === 'angebot' ? `<label class="field"><span>Gültig bis</span><input type="date" id="fd-valid" value="${esc(x.validUntil)}" ${dis}></label>` : ''}
      </div>
      <details class="fak-recipient" ${x.recipient?.name ? '' : 'open'}><summary>Empfänger: <strong>${esc(x.recipient?.name || 'fehlt')}</strong>${x.recipient?.uid ? ` · ${esc(x.recipient.uid)}` : ''}</summary>
        <div class="form-grid">
          <label class="field"><span>Name</span><input type="text" id="fd-rname" value="${esc(x.recipient?.name || '')}" data-input="fak-recalc" ${dis}></label>
          <label class="field"><span>UID-Nummer</span><input type="text" id="fd-ruid" value="${esc(x.recipient?.uid || '')}" data-input="fak-recalc" ${dis}></label>
          <label class="field wide"><span>Anschrift</span><textarea id="fd-raddress" rows="2" data-input="fak-recalc" ${dis}>${esc(x.recipient?.address || '')}</textarea></label>
          <label class="field"><span>E-Mail für den Versand</span><input type="email" id="fd-remail" value="${esc(x.recipient?.email || '')}" ${dis}></label>
          <label class="check"><input type="checkbox" id="fd-rconsumer" ${x.recipient?.consumer ? 'checked' : ''} data-change="fak-recalc" ${dis}><span>Verbraucher (privat)</span></label>
        </div></details>
      <div class="form-grid">
        <label class="field wide"><span>Betreff</span><input type="text" id="fd-title" value="${esc(x.title || '')}" placeholder="z. B. Unterhaltsreinigung Oktober 2026" ${dis}></label>
        <label class="field wide"><span>Einleitung</span><input type="text" id="fd-intro" value="${esc(x.intro || '')}" ${dis}></label>
      </div>
      ${linesEditor(x.lines, 'fl', dis)}
      ${ed ? `<div class="filters"><button class="btn small" data-action="fak-line-add">${ICON.plus} Position</button>${d.articles.length ? `<select id="fd-article" data-change="fak-article">${artOpts}</select>` : ''}${calc ? '<button class="btn small" data-action="fak-from-calc">Preis aus Kalkulation</button>' : ''}</div>` : ''}
      <div class="fak-foot-grid">
        <div class="form-grid">
          <label class="field"><span>Rabatt auf alles (%)</span><input type="text" inputmode="decimal" id="fd-discount" value="${esc(numText(x.discount || ''))}" placeholder="0" data-input="fak-recalc" ${dis}></label>
          <label class="check wide"><input type="checkbox" id="fd-rc" ${x.reverseCharge ? 'checked' : ''} data-change="fak-recalc" ${dis}><span>Reverse Charge (§ 19 Abs. 1a UStG): Empfänger erbringt selbst Bauleistungen</span></label>
          <label class="field wide"><span>Schlusstext</span><textarea id="fd-outro" rows="2" ${dis}>${esc(x.outro || '')}</textarea></label>
        </div>
        <div id="fd-totals">${totalsHtml(x)}</div>
      </div>
      <div id="fd-problems">${problemsHtml(x)}</div>
      ${s.smallBusiness ? '<p class="muted">Kleinunternehmer: Rechnungen ohne Umsatzsteuer, mit Hinweis.</p>' : ''}`,
    foot: `<div class="actions">${ed ? `<button class="btn danger" data-action="fak-draft-delete" data-id="${esc(x.id)}">${app.ui.confirm === `fak-del:${x.id}` ? 'Wirklich löschen?' : 'Entwurf löschen'}</button>` : ''}</div>
      <div class="actions"><button class="btn" data-action="fak-pdf" data-id="${esc(x.id)}">${ICON.download} Vorschau (PDF)</button>${ed ? `<button class="btn" data-action="fak-draft-save">Speichern</button><button class="btn primary ${confirm ? 'confirm' : ''}" data-action="fak-finalize">${confirm ? `Wirklich festschreiben? Danach nicht mehr änderbar` : 'Festschreiben'}</button>` : ''}</div>`,
  })
}
registerModal('fak-edit', editorModal, { module: MODULE })

// ---------------------------------------------------------------- Beleg ansehen (festgeschrieben)

function viewModal(c, m) {
  const x = docOf(m.id)
  if (!x) return ''
  if (!x.number) {
    // Entwurf (z. B. über einen Bezug geöffnet): im Formular
    m.type = 'fak-edit'
    m.draft ||= structuredClone(x)
    return editorModal(c, m)
  }
  const d = F()
  const s = S()
  const ed = editable()
  const t = x.total || totals(x, s)
  const st = stateOf(x, d.documents, todayISO(), s)
  const open = x.kind === 'rechnung' ? openAmount(x, d.documents, s) : 0
  const refs = d.documents.filter((y) => y.refId === x.id)
  const lines = totals(x, s)
    .lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.text)}</td><td class="num">${numText(l.qty)}</td><td>${esc(l.unit || '')}</td><td class="num">${money(l.price)}</td><td class="num">${t.groups.length && totals(x, s).vatOn ? `${l.vat} %` : '–'}</td><td class="num">${money(l.net)}</td></tr>`)
    .join('')
  const mode = app.ui.fakAct || ''
  const act =
    mode === 'storno'
      ? `<div class="form-grid"><label class="field wide"><span>Grund des Stornos</span><input type="text" id="fv-reason" placeholder="z. B. doppelt verrechnet, falscher Empfänger"></label></div><div class="actions"><button class="btn" data-action="fak-act" data-v="">Abbrechen</button><button class="btn primary" data-action="fak-storno" data-id="${esc(x.id)}">Stornorechnung erstellen</button></div>`
      : mode === 'korrektur'
        ? `<div class="form-grid"><label class="field wide"><span>Bezeichnung</span><input type="text" id="fv-ktext" value="Preisminderung"></label><label class="field"><span>Betrag netto (€)</span><input type="text" inputmode="decimal" id="fv-kamount"></label><label class="field"><span>USt</span><select id="fv-kvat">${options(VAT_RATES.map((v) => [String(v), `${v} %`]), String(s.vat))}</select></label></div><div class="actions"><button class="btn" data-action="fak-act" data-v="">Abbrechen</button><button class="btn primary" data-action="fak-correct" data-id="${esc(x.id)}">Korrektur als Entwurf</button></div>`
        : ''
  const pays = (x.payments || []).map((p) => `<li>${formatDate(p.date, { year: true })}: ${money(p.amount)}${p.note ? ` · ${esc(p.note)}` : ''}${ed ? ` <button class="link-btn" data-action="fak-pay-del" data-id="${esc(x.id)}" data-pay="${esc(p.id)}">entfernen</button>` : ''}</li>`).join('')
  const reminders = (x.reminders || []).map((r) => `<li>${formatDate(r.date, { year: true })}: ${esc(r.name)}${r.total ? ` über ${money(r.total)}` : ''}${r.sentTo ? ` an ${esc(r.sentTo)}` : ''}</li>`).join('')
  const sent = (x.sent || []).map((v) => `<li>${formatDate(v.at.slice(0, 10), { year: true })} an ${esc(v.to)}${v.via === 'mailto' ? ' (E-Mail-Programm)' : ''}</li>`).join('')
  const history = (x.history || []).map((h) => `<li>${formatDate(String(h.at).slice(0, 10), { year: true })} ${esc(h.by || '')}: ${esc(h.text)}</li>`).join('')
  return modalFrame({
    title: `${KINDS[x.kind]} ${x.number}`,
    subtitle: `${x.recipient?.name || ''} · ${formatDate(x.date, { year: true })}${x.refNumber ? ` · zu ${x.refNumber}` : ''}`,
    wide: true,
    body: `<p>${pill(st)}${x.reverseCharge ? ' <span class="pill info">Reverse Charge</span>' : ''} ${intact(x) ? '<span class="muted">Prüfsumme in Ordnung</span>' : '<span class="pill error">Inhalt nach dem Festschreiben verändert</span>'}</p>
      ${x.title ? `<p><strong>${esc(x.title)}</strong>${x.serviceFrom ? ` · Leistung ${esc(periodLabel({ from: x.serviceFrom, to: x.serviceTo || x.serviceFrom }))}` : ''}</p>` : ''}
      <div class="table-wrap"><table class="data"><thead><tr><th>Pos.</th><th>Bezeichnung</th><th class="num">Menge</th><th>Einheit</th><th class="num">Einzelpreis</th><th class="num">USt</th><th class="num">netto</th></tr></thead><tbody>${lines}</tbody></table></div>
      <div class="fak-foot-grid"><div>${x.kind === 'rechnung' ? `<p>Fällig am ${formatDate(x.dueDate, { year: true })} · bezahlt ${money(paidOf(x))} · <strong>offen ${money(open)}</strong></p>` : ''}
        ${refs.length ? `<p>Dazu: ${refs.map((y) => `<button class="link-btn" data-action="fak-open" data-id="${esc(y.id)}">${esc(y.number || `${KINDS[y.kind]} (Entwurf)`)}</button>`).join(', ')}</p>` : ''}</div>
        <table class="fak-sums"><tr><td>netto</td><td class="num">${money(t.net)}</td></tr>${(t.groups || []).filter((g) => g.vat).map((g) => `<tr><td>USt ${g.rate} %</td><td class="num">${money(g.vat)}</td></tr>`).join('')}<tr class="sum"><td>brutto</td><td class="num">${money(t.gross)}</td></tr></table></div>
      ${act}
      ${pays ? `<h3>Zahlungen</h3><ul>${pays}</ul>` : ''}${reminders ? `<h3>Mahnungen</h3><ul>${reminders}</ul>` : ''}${sent ? `<h3>Versendet</h3><ul>${sent}</ul>` : ''}
      ${history ? `<details><summary>Verlauf</summary><ul class="muted">${history}</ul></details>` : ''}`,
    foot: `<div class="actions">${
      ed
        ? x.kind === 'rechnung' && st !== 'storniert'
          ? `<button class="btn" data-action="fak-act" data-v="storno">Stornieren</button><button class="btn" data-action="fak-act" data-v="korrektur">Korrektur</button>`
          : x.kind === 'angebot' && st === 'offen'
            ? `<button class="btn" data-action="fak-offer-state" data-id="${esc(x.id)}" data-v="abgelehnt">Abgelehnt</button><button class="btn" data-action="fak-offer-state" data-id="${esc(x.id)}" data-v="angenommen">Angenommen</button>`
            : ''
        : ''
    }</div>
      <div class="actions">${ed ? `<button class="btn" data-action="fak-copy" data-id="${esc(x.id)}">Als Vorlage kopieren</button>` : ''}${ed && ['angebot', 'auftrag'].includes(x.kind) ? `${x.kind === 'angebot' ? `<button class="btn" data-action="fak-convert" data-id="${esc(x.id)}" data-kind="auftrag">→ Auftrag</button>` : ''}<button class="btn" data-action="fak-convert" data-id="${esc(x.id)}" data-kind="rechnung">→ Rechnung</button>` : ''}
        ${ed && x.kind === 'rechnung' && open > 0 ? `<button class="btn" data-action="fak-pay-open" data-id="${esc(x.id)}">Zahlung</button>` : ''}
        <button class="btn" data-action="fak-pdf" data-id="${esc(x.id)}">${ICON.download} PDF</button><button class="btn primary" data-action="fak-mail-open" data-id="${esc(x.id)}">${ICON.send} E-Mail</button></div>`,
  })
}
registerModal('fak-doc', viewModal, { module: MODULE })

// ---------------------------------------------------------------- Dialoge: Zahlung, Mahnung, E-Mail, Export, Übernahme

function payModal(c, m) {
  const x = docOf(m.id)
  if (!x) return ''
  const open = openAmount(x, F().documents, S())
  return modalFrame({
    title: `Zahlungseingang ${x.number}`,
    subtitle: `${x.recipient?.name || ''} · offen ${money(open)}`,
    body: `<div class="form-grid"><label class="field"><span>Datum</span><input type="date" id="fp-date" value="${todayISO()}"></label><label class="field"><span>Betrag (€)</span><input type="text" inputmode="decimal" id="fp-amount" value="${esc(numText(open))}"></label><label class="field wide"><span>Notiz</span><input type="text" id="fp-note" placeholder="z. B. Kontoauszug 11/2026"></label></div>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="fak-pay-save" data-id="${esc(x.id)}">Zahlung buchen</button></div>`,
  })
}
registerModal('fak-pay', payModal, { module: MODULE })

function remindModal(c, m) {
  const x = docOf(m.id)
  if (!x) return ''
  const r = reminderFor(x, F().documents, { today: todayISO(), settings: S() })
  m.text ??= reminderMailText({ doc: x, reminder: r, company: S().sender.name, sender: app.user?.name || '' })
  return modalFrame({
    title: `${r.name}: ${x.number}`,
    subtitle: `${x.recipient?.name || ''} · fällig seit ${formatDate(x.dueDate, { year: true })}`,
    wide: true,
    body: `<table class="fak-sums"><tr><td>offen</td><td class="num">${money(r.open)}</td></tr>${r.interest.amount ? `<tr><td>Verzugszinsen ${String(r.interest.rate).replace('.', ',')} % für ${r.interest.days} Tage</td><td class="num">${money(r.interest.amount)}</td></tr>` : ''}${r.fee ? `<tr><td>Pauschale § 458 UGB</td><td class="num">${money(r.fee)}</td></tr>` : ''}<tr class="sum"><td>zu bezahlen bis ${deDate(r.deadline)}</td><td class="num">${money(r.total)}</td></tr></table>
      <div class="form-grid"><label class="field wide"><span>An</span><input type="email" id="fr-to" value="${esc(x.recipient?.email || custOf(x.customerId)?.email || '')}"></label><label class="field wide"><span>Text</span><textarea id="fr-text" rows="8">${esc(m.text)}</textarea></label></div>
      <p class="note">Die Mahnung wird als Stufe ${r.level + 1} vermerkt, sobald sie gesendet oder als PDF erstellt ist.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn" data-action="fak-remind" data-id="${esc(x.id)}" data-via="pdf">${ICON.download} Nur PDF</button>${canMail() ? `<button class="btn primary" data-action="fak-remind" data-id="${esc(x.id)}" data-via="mail">${ICON.send} Senden</button>` : ''}</div>`,
  })
}
registerModal('fak-remind', remindModal, { module: MODULE })

function mailModal(c, m) {
  const x = docOf(m.id)
  if (!x) return ''
  const s = S()
  const to = m.to ?? (x.recipient?.email || custOf(x.customerId)?.email || '')
  m.text ??= invoiceMailText({ doc: x, company: s.sender.name, sender: app.user?.name || '', iban: s.bank.iban })
  return modalFrame({
    title: `${KINDS[x.kind]} ${x.number || '(Entwurf)'} senden`,
    subtitle: x.recipient?.name || '',
    wide: true,
    body: `${x.number ? '' : '<div class="banner warn-banner"><p>Ein Entwurf wird nicht versendet. Bitte zuerst festschreiben.</p></div>'}<div class="form-grid"><label class="field wide"><span>An</span><input type="email" id="fm-to" value="${esc(to)}" placeholder="buchhaltung@kunde.at"></label><label class="field wide"><span>Betreff</span><input type="text" id="fm-subject" value="${esc(m.subject ?? `${KINDS[x.kind]} ${x.number || ''}${x.title ? ` – ${x.title}` : ''}`)}"></label><label class="field wide"><span>Text</span><textarea id="fm-text" rows="9">${esc(m.text)}</textarea></label></div>
      <p class="note">${canMail() ? 'Geht aus deinem Postfach, das PDF hängt an und liegt danach auch in SharePoint (fakturierung/belege/).' : 'Öffnet dein E-Mail-Programm; das PDF wird heruntergeladen und muss angehängt werden.'}</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="fak-mail-send" data-id="${esc(x.id)}" ${x.number ? '' : 'disabled'}>${ICON.send} ${canMail() ? 'Senden' : 'Im E-Mail-Programm öffnen'}</button></div>`,
  })
}
registerModal('fak-mail', mailModal, { module: MODULE })

function exportModal() {
  const y = year()
  const today = todayISO()
  return modalFrame({
    title: 'Export für die Steuerberatung',
    subtitle: 'Ausgangsrechnungen als CSV (BMD, RZL u. a.)',
    body: `<div class="form-grid"><label class="field"><span>von</span><input type="date" id="fx-from" value="${esc(app.ui.fakExFrom || addDays(firstOfMonth(today), -1).slice(0, 8) + '01')}"></label><label class="field"><span>bis</span><input type="date" id="fx-to" value="${esc(app.ui.fakExTo || addDays(firstOfMonth(today), -1))}"></label></div>
      <p class="muted">Eine Zeile je Beleg und Steuersatz: Belegnummer, Datum, Belegart (AR Rechnung, GU Storno/Korrektur), Debitor, Erlöskonto, Kunde, UID, Steuersatz, Steuercode, Netto, Steuer, Brutto, Leistungszeitraum. Trennzeichen Strichpunkt, Dezimalkomma. Spalten: ${EXPORT_DEFAULT_COLUMNS.length}. Zeitraum frei wählbar (z. B. Monat oder Quartal für die UVA, ganzes Jahr ${esc(y)}).</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="fak-export">${ICON.download} CSV herunterladen</button></div>`,
  })
}
registerModal('fak-export', exportModal, { module: MODULE })

/** Leistungsnachweis eines Monats: Objekte mit Einsätzen und der Nachweis je Objekt. */
function proofsOf(month) {
  const from = `${month}-01`
  const r = computeRange(from, lastDayOf(month))
  const ids = objectsWithWork(r.instances, { from, to: lastDayOf(month) })
  return app.data.objects.filter((o) => ids.has(o.id)).map((o) => ({ object: o, proof: proofFor({ objectId: o.id, from, to: lastDayOf(month), instances: r.instances, state: r.state, stamps: app.data.stamps || {}, employeesById: r.ctx.employeesById, today: todayISO(), now: absMinutes(nowIso()) }) }))
}
const lastDayOf = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10)

function proofModal(c, m) {
  const month = m.month || addDays(firstOfMonth(todayISO()), -1).slice(0, 7)
  const list = proofsOf(month)
  const d = F()
  const rows = list
    .map(({ object: o, proof }) => {
      const cu = customerForObject(d, o.id)
      const done = proof.rows.filter((r) => ['erbracht', 'bestaetigt'].includes(r.status))
      const special = done.filter((r) => r.category === 'sonder').length
      const exists = d.documents.some((x) => x.source?.key === `nachweis:${o.id}:${month}`)
      const rec = d.recurring.some((r) => r.objectId === o.id && r.active !== false)
      return `<tr><td><label class="check"><input type="checkbox" name="fpo" value="${esc(o.id)}" ${exists || !done.length ? '' : rec ? (special ? 'checked' : '') : 'checked'}><span><strong>${esc(o.name)}</strong></span></label></td><td>${esc(cu?.name || '–')}</td><td class="num">${done.length}</td><td class="num">${special || ''}</td><td class="num">${String(round2(done.reduce((a, r) => a + r.planMinutes, 0) / 60)).replace('.', ',')}</td>
        <td>${exists ? '<span class="pill ok">schon übernommen</span>' : rec ? '<span class="pill info">Dauerauftrag: nur Sonderleistungen</span>' : ''}</td></tr>`
    })
    .join('')
  return modalFrame({
    title: 'Rechnungen aus dem Leistungsnachweis',
    subtitle: monthLabel(month),
    wide: true,
    body: `<div class="filters"><label class="field inline"><span>Monat</span><input type="month" id="fpo-month" value="${month}" data-change="fak-proof-month"></label><label class="field inline"><span>Stundensatz netto (€)</span><input type="text" inputmode="decimal" id="fpo-rate" value="${esc(numText(m.rate ?? d.settings.hourRate ?? ''))}" placeholder="z. B. 32,50" style="width:7rem"></label></div>
      ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Objekt</th><th>Kunde</th><th class="num">Einsätze</th><th class="num">davon Sonderleistung</th><th class="num">Stunden</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine Einsätze in diesem Monat.</p>'}
      <p class="note">Je Objekt ein Rechnungsentwurf: regelmäßige Einsätze als Stunden (Stundensatz des Kunden oder der hier eingetragene), Sonderleistungen einzeln mit Datum. Objekte mit Dauerauftrag bekommen nur ihre Sonderleistungen. Ohne Kunde beim Objekt bleibt der Empfänger leer.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="fak-proof-create" data-month="${month}">Entwürfe erstellen</button></div>`,
  })
}
registerModal('fak-proof', proofModal, { module: MODULE })

// ---------------------------------------------------------------- Kunden, Artikel, Daueraufträge

function customerModal(c, m) {
  const x = m.id ? custOf(m.id) : null
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const v = x || { name: '', address: '', paymentDays: '', objectIds: m.objectIds || [] }
  const chosen = new Set(v.objectIds || [])
  return modalFrame({
    title: x ? x.name : 'Neuer Kunde',
    subtitle: x?.customerNo ? `Kundennummer ${x.customerNo}` : 'Rechnungsempfänger',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Name</span><input type="text" id="fc-name" value="${esc(v.name)}" ${dis}></label>
        <label class="field"><span>Kundennummer</span><input type="text" id="fc-no" value="${esc(v.customerNo || nextCustomerNo(F().customers))}" ${dis}></label>
        <label class="field wide"><span>Anschrift (mehrzeilig)</span><textarea id="fc-address" rows="3" ${dis}>${esc(v.address || '')}</textarea></label>
        <label class="field"><span>UID-Nummer</span><input type="text" id="fc-uid" value="${esc(v.uid || '')}" placeholder="ATU…" ${dis}></label>
        <label class="field"><span>E-Mail für Rechnungen</span><input type="email" id="fc-email" value="${esc(v.email || '')}" ${dis}></label>
        <label class="field"><span>Zahlungsziel (Tage)</span><input type="number" id="fc-days" min="0" value="${esc(v.paymentDays ?? '')}" placeholder="${S().paymentDays}" ${dis}></label>
        <label class="field"><span>Stundensatz netto (€)</span><input type="text" inputmode="decimal" id="fc-rate" value="${esc(numText(v.hourRate ?? ''))}" placeholder="für Abrechnung nach Aufwand" ${dis}></label>
        <label class="field"><span>Debitorenkonto</span><input type="text" id="fc-account" value="${esc(v.account || '')}" placeholder="leer: Kundennummer" ${dis}></label>
        <label class="check wide"><input type="checkbox" id="fc-rc" ${v.reverseCharge ? 'checked' : ''} ${dis}><span>Reverse Charge (§ 19 Abs. 1a UStG): Kunde erbringt selbst üblicherweise Bauleistungen (z. B. Reinigungs- oder Baufirma als Auftraggeber)</span></label>
        <label class="check wide"><input type="checkbox" id="fc-consumer" ${v.consumer ? 'checked' : ''} ${dis}><span>Verbraucher (privat): 4 % Verzugszinsen, keine 40-€-Pauschale</span></label>
        <label class="field wide"><span>Notiz</span><input type="text" id="fc-note" value="${esc(v.note || '')}" ${dis}></label>
      </div>
      <h3>Objekte dieses Kunden</h3>
      <div class="check-grid">${app.data.objects.map((o) => `<label class="check"><input type="checkbox" name="fc-obj" value="${esc(o.id)}" ${chosen.has(o.id) ? 'checked' : ''} ${dis}><span>${esc(o.name)}</span></label>`).join('')}</div>`,
    foot: `<div class="actions">${ed && x && !F().documents.some((d) => d.customerId === x.id) ? `<button class="btn danger" data-action="fak-cust-del" data-id="${esc(x.id)}">${app.ui.confirm === `fak-cdel:${x.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</div><div class="actions"><button class="btn" data-action="close-modal">Schließen</button>${ed ? `<button class="btn primary" data-action="fak-cust-save" data-id="${esc(x?.id || '')}">Speichern</button>` : ''}</div>`,
  })
}
registerModal('fak-cust', customerModal, { module: MODULE })

function articleModal(c, m) {
  const x = m.id ? F().articles.find((a) => a.id === m.id) : null
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const v = x || { name: '', unit: 'Pauschale', price: '', vat: S().vat }
  return modalFrame({
    title: x ? x.name : 'Neuer Artikel',
    body: `<div class="form-grid"><label class="field wide"><span>Bezeichnung</span><input type="text" id="fa-name" value="${esc(v.name)}" ${dis}></label><label class="field wide"><span>Zusatztext (optional)</span><input type="text" id="fa-text" value="${esc(v.text || '')}" ${dis}></label>
      <label class="field"><span>Einheit</span><select id="fa-unit" ${dis}>${options(UNITS.map((u) => [u, u]), v.unit)}</select></label><label class="field"><span>Preis netto (€)</span><input type="text" inputmode="decimal" id="fa-price" value="${esc(numText(v.price))}" ${dis}></label><label class="field"><span>USt</span><select id="fa-vat" ${dis}>${options(VAT_RATES.map((r) => [String(r), `${r} %`]), String(v.vat ?? S().vat))}</select></label></div>`,
    foot: `<div class="actions">${ed && x ? `<button class="btn danger" data-action="fak-art-del" data-id="${esc(x.id)}">${app.ui.confirm === `fak-adel:${x.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</div><div class="actions"><button class="btn" data-action="close-modal">Schließen</button>${ed ? `<button class="btn primary" data-action="fak-art-save" data-id="${esc(x?.id || '')}">Speichern</button>` : ''}</div>`,
  })
}
registerModal('fak-art', articleModal, { module: MODULE })

function recurringModal(c, m) {
  const d = F()
  const x = m.id ? d.recurring.find((r) => r.id === m.id) : null
  m.draft ||= structuredClone(x || { id: uid('rec'), title: 'Unterhaltsreinigung', interval: 'monat', startMonth: todayISO().slice(0, 7), endMonth: '', customerId: '', objectId: '', active: true, lines: [{ id: uid('l'), text: 'Unterhaltsreinigung lt. Vertrag', qty: 1, unit: 'Monat', price: '', vat: S().vat }], index: { active: false, baseValue: '', baseMonth: '', threshold: 3, onlyUp: false } })
  const v = m.draft
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const idx = v.index || {}
  return modalFrame({
    title: x ? x.title : 'Neuer Dauerauftrag',
    subtitle: 'Wiederkehrende Rechnung (Monatslauf erstellt Entwürfe)',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Kunde</span><select id="fr-customer" ${dis}>${options(d.customers.map((cu) => [cu.id, cu.name]), v.customerId, { empty: '– Kunde –' })}</select></label>
        <label class="field"><span>Objekt</span><select id="fr-object" ${dis}>${options(app.data.objects.map((o) => [o.id, o.name]), v.objectId, { empty: '– ohne –' })}</select></label>
        <label class="field"><span>Betreff</span><input type="text" id="fr-title" value="${esc(v.title || '')}" ${dis}></label>
        <label class="field"><span>Rhythmus</span><select id="fr-interval" ${dis}>${options(Object.entries(INTERVALS), v.interval)}</select></label>
        <label class="field"><span>Erster Abrechnungsmonat</span><input type="month" id="fr-start" value="${esc(v.startMonth || '')}" ${dis}></label>
        <label class="field"><span>Letzter Monat (optional)</span><input type="month" id="fr-end" value="${esc(v.endMonth || '')}" ${dis}></label>
        <label class="check"><input type="checkbox" id="fr-active" ${v.active !== false ? 'checked' : ''} ${dis}><span>aktiv</span></label>
      </div>
      ${linesEditor(v.lines || [], 'frl', dis)}
      ${ed ? `<div class="filters"><button class="btn small" data-action="fak-rec-line-add">${ICON.plus} Position</button></div>` : ''}
      <h3>Wertsicherung</h3>
      <div class="form-grid">
        <label class="check wide"><input type="checkbox" id="fr-idx" ${idx.active ? 'checked' : ''} ${dis}><span>Preise nach ${esc(S().indexName)} anpassen</span></label>
        <label class="field"><span>Basis (Indexzahl)</span><input type="text" inputmode="decimal" id="fr-idx-base" value="${esc(numText(idx.baseValue))}" ${dis}></label>
        <label class="field"><span>Basismonat</span><input type="month" id="fr-idx-month" value="${esc(idx.baseMonth || '')}" ${dis}></label>
        <label class="field"><span>Schwelle (%)</span><input type="text" inputmode="decimal" id="fr-idx-threshold" value="${esc(numText(idx.threshold ?? 3))}" ${dis}></label>
        <label class="check"><input type="checkbox" id="fr-idx-up" ${idx.onlyUp ? 'checked' : ''} ${dis}><span>nur Erhöhungen</span></label>
      </div>
      ${(x?.history || []).length ? `<details><summary>Verlauf</summary><ul class="muted">${x.history.map((h) => `<li>${esc(String(h.at).slice(0, 10))}: ${esc(h.text)}</li>`).join('')}</ul></details>` : ''}`,
    foot: `<div class="actions">${ed && x ? `<button class="btn danger" data-action="fak-rec-del" data-id="${esc(x.id)}">${app.ui.confirm === `fak-rdel:${x.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</div><div class="actions"><button class="btn" data-action="close-modal">Schließen</button>${ed ? '<button class="btn primary" data-action="fak-rec-save">Speichern</button>' : ''}</div>`,
  })
}
registerModal('fak-rec', recurringModal, { module: MODULE })

function readRecurring(m) {
  const v = m.draft
  if (!document.getElementById('fr-title')) return v
  Object.assign(v, { customerId: val('fr-customer'), objectId: val('fr-object'), title: val('fr-title').trim(), interval: val('fr-interval'), startMonth: val('fr-start'), endMonth: val('fr-end'), active: checked('fr-active'), lines: readLines('frl', v.lines) })
  v.index = { ...(v.index || {}), active: checked('fr-idx'), baseValue: num('fr-idx-base') || '', baseMonth: val('fr-idx-month'), threshold: num('fr-idx-threshold'), onlyUp: checked('fr-idx-up') }
  return v
}

// ---------------------------------------------------------------- PDF, Ablage

async function docPdf(x) {
  const s = S()
  return pdfBlob(invoiceDocument({ doc: { ...x, objectName: x.objectName || objName(x.objectId) }, settings: s, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) }))
}

/** PDF in SharePoint ablegen (fakturierung/belege/JAHR/…); im Browser-Modus nicht. */
async function archive(x, blob, name = docFileName(x)) {
  if (app.store?.kind !== 'sharepoint') return null
  try {
    const path = archivePath(x, name)
    await app.store.upload(path, blob, 'application/pdf')
    return path
  } catch (err) {
    toast(`PDF nicht in SharePoint abgelegt: ${err.message}`)
    return null
  }
}

function upsertDoc(x) {
  const d = F()
  const i = d.documents.findIndex((y) => y.id === x.id)
  if (i >= 0) d.documents[i] = x
  else d.documents.push(x)
}

function applyCustomer(x, customerId) {
  const cu = custOf(customerId)
  x.customerId = customerId
  if (!cu) return
  x.recipient = recipientOf(cu)
  x.reverseCharge = !!cu.reverseCharge
  if (x.kind === 'rechnung') x.dueDate = dueDateFor(x.date, cu.paymentDays === '' || cu.paymentDays === undefined ? S().paymentDays : cu.paymentDays)
  if (!x.objectId && cu.objectIds?.length === 1) x.objectId = cu.objectIds[0]
}

// ---------------------------------------------------------------- Aktionen (lesen)

registerActions({
  'fak-tab': (el) => {
    app.ui.fakTab = el.dataset.v
    app.ui.fakState = ''
    renderNow()
  },
  'fak-year': () => {
    app.ui.fakYear = val('fak-year')
    renderNow()
  },
  'fak-state': () => {
    app.ui.fakState = val('fak-state')
    renderNow()
  },
  'fak-search': () => {
    app.ui.fakSearch = val('fak-search')
    renderNow()
    const el = document.getElementById('fak-search')
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  },
  'fak-cust-search': () => {
    app.ui.fakCustSearch = val('fak-cust-search')
    renderNow()
    const el = document.getElementById('fak-cust-search')
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  },
  'fak-run-month': () => {
    app.ui.fakRunMonth = val('fak-run-month')
    renderNow()
  },
  'fak-open': (el) => {
    app.ui.fakAct = ''
    const x = docOf(el.dataset.id)
    if (!x) return
    openModal(x.number ? { type: 'fak-doc', id: x.id } : { type: 'fak-edit', id: x.id, draft: structuredClone(x) })
  },
  'fak-act': (el) => {
    app.ui.fakAct = el.dataset.v
    renderModal()
  },
  'fak-recalc': () => {
    const m = app.ui.modal
    if (m?.type !== 'fak-edit') return
    readForm(m)
    const t = document.getElementById('fd-totals')
    if (t) t.innerHTML = totalsHtml(m.draft)
    const p = document.getElementById('fd-problems')
    if (p) p.innerHTML = problemsHtml(m.draft)
  },
  'fak-pdf': async (el) => {
    const m = app.ui.modal
    const x = m?.type === 'fak-edit' && m.draft?.id === el.dataset.id ? readForm(m) : docOf(el.dataset.id)
    if (!x) return
    el.disabled = true
    try {
      download(docFileName(x), await docPdf(x))
    } catch (err) {
      toast(`PDF nicht erstellt: ${err.message}`)
    } finally {
      el.disabled = false
    }
  },
  'fak-export-open': () => openModal({ type: 'fak-export' }),
  'fak-export': () => {
    const from = val('fx-from')
    const to = val('fx-to')
    if (!from || !to || to < from) return toast('Bitte einen gültigen Zeitraum wählen.')
    app.ui.fakExFrom = from
    app.ui.fakExTo = to
    const d = F()
    const rows = exportRows(d.documents, { from, to, settings: S(), customersById: new Map(d.customers.map((c) => [c.id, c])) })
    if (!rows.length) return toast('Keine festgeschriebenen Rechnungen in diesem Zeitraum.')
    download(`Ausgangsrechnungen_${from}_${to}.csv`, new Blob([`﻿${exportCsv(rows)}`], { type: 'text/csv;charset=utf-8' }))
    closeModal()
    toast(`${plural(new Set(rows.map((r) => r.number)).size, 'Beleg', 'Belege')} exportiert.`)
  },
})

// ---------------------------------------------------------------- Aktionen (ändern)

registerActions(
  {
    'fak-new': (el) => {
      app.ui.fakAct = ''
      const x = newDraft(el.dataset.kind || 'rechnung')
      openModal({ type: 'fak-edit', id: x.id, draft: x, isNew: true })
    },
    'fak-customer': () => {
      const m = app.ui.modal
      readForm(m)
      applyCustomer(m.draft, val('fd-customer'))
      renderModal()
    },
    'fak-object': () => {
      const m = app.ui.modal
      readForm(m)
      const cu = customerForObject(F(), m.draft.objectId)
      if (cu && !m.draft.customerId) applyCustomer(m.draft, cu.id)
      renderModal()
    },
    'fak-date': () => {
      const m = app.ui.modal
      readForm(m)
      const cu = custOf(m.draft.customerId)
      if (m.draft.kind === 'rechnung') m.draft.dueDate = dueDateFor(m.draft.date, cu?.paymentDays === '' || cu?.paymentDays === undefined ? S().paymentDays : cu.paymentDays)
      renderModal()
    },
    'fak-line-add': () => {
      const m = app.ui.modal
      readForm(m)
      m.draft.lines.push({ id: uid('l'), text: '', qty: 1, unit: 'Pauschale', price: '', vat: S().vat, discount: 0 })
      renderModal()
      document.getElementById(`fl-${m.draft.lines.length - 1}-text`)?.focus()
    },
    'fak-line-del': (el) => {
      const m = app.ui.modal
      const rec = el.dataset.prefix === 'frl'
      if (rec) readRecurring(m)
      else readForm(m)
      m.draft.lines.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'fak-article': () => {
      const m = app.ui.modal
      readForm(m)
      const a = F().articles.find((x) => x.id === val('fd-article'))
      if (!a) return
      const empty = m.draft.lines.findIndex((l) => !l.text && !parseNumber(l.price))
      const line = { id: uid('l'), text: [a.name, a.text].filter(Boolean).join(' – '), qty: 1, unit: a.unit, price: a.price, vat: a.vat ?? S().vat, discount: 0 }
      if (empty >= 0) m.draft.lines[empty] = line
      else m.draft.lines.push(line)
      renderModal()
    },
    'fak-from-calc': () => {
      const m = app.ui.modal
      readForm(m)
      const areas = app.data.kalkulation?.objects?.[m.draft.objectId]?.areas || []
      const settings = app.data.kalkulation?.settings || {}
      const calc = calculate({ areas, settings, wage: calcWage(settings, mergeRules(app.data.rules).wages) })
      if (!calc.net) return toast('Die Kalkulation dieses Objekts ergibt noch keinen Preis.')
      m.draft.lines = m.draft.lines.filter((l) => l.text || parseNumber(l.price))
      m.draft.lines.push({ id: uid('l'), text: `Unterhaltsreinigung ${objName(m.draft.objectId)} lt. Kalkulation (${String(calc.hours).replace('.', ',')} Std./Monat)`, qty: 1, unit: 'Monat', price: calc.net, vat: S().vat, discount: 0 })
      renderModal()
    },
    'fak-draft-save': () => {
      const m = app.ui.modal
      const x = readForm(m)
      upsertDoc(structuredClone({ ...x, updatedAt: nowIso() }))
      m.isNew = false
      commit('Entwurf gespeichert.')
    },
    'fak-draft-delete': (el) => {
      const m = app.ui.modal
      readForm(m)
      if (!confirmStep(`fak-del:${el.dataset.id}`, renderModal)) return
      const d = F()
      const x = d.documents.find((y) => y.id === el.dataset.id)
      if (x?.number) return toast('Festgeschriebene Belege werden nicht gelöscht (Storno).')
      d.documents = d.documents.filter((y) => y.id !== el.dataset.id)
      closeModal()
      commit('Entwurf gelöscht.')
    },
    'fak-finalize': async (el) => {
      const m = app.ui.modal
      const x = readForm(m)
      const list = blocking(problems(x, S()))
      if (list.length) return toast(list[0].text)
      if (!confirmStep(`fak-final:${x.id}`, renderModal)) return
      el.disabled = true
      try {
        upsertDoc(structuredClone(x))
        // erst den Stand der anderen holen (deren Nummern), dann die Nummer vergeben und gleich speichern
        await app.service.flush().catch(() => {})
        await app.service.refresh?.().catch(() => [])
        const d = F()
        const fixed = finalize(d.documents.find((y) => y.id === x.id) || x, d.documents, S(), { now: nowIso(), by: by() })
        upsertDoc(fixed)
        persist()
        await app.service.flush().catch(() => {})
        checkNumbers()
        const done = docOf(x.id)
        // Beleg als PDF in SharePoint ablegen (im Hintergrund; scheitert das, bleibt der Beleg festgeschrieben)
        if (app.store?.kind === 'sharepoint')
          docPdf(done)
            .then((blob) => archive(done, blob))
            .then((path) => {
              if (path && docOf(x.id)) {
                docOf(x.id).pdfPath = path
                persist()
              }
            })
            .catch(() => {})
        openModal({ type: 'fak-doc', id: x.id })
        renderNow()
        toast(`${KINDS[done.kind]} ${done.number} festgeschrieben.`)
      } catch (err) {
        el.disabled = false
        toast(`Nicht festgeschrieben: ${err.message}`)
      }
    },
    'fak-copy': (el) => {
      const src = docOf(el.dataset.id)
      if (!src) return
      const kind = src.kind === 'storno' || src.kind === 'korrektur' ? 'rechnung' : src.kind
      const x = newDraft(kind, { customerId: src.customerId, objectId: src.objectId, recipient: { ...(src.recipient || {}) }, reverseCharge: !!src.reverseCharge, title: src.title, discount: src.discount || 0, lines: (src.lines || []).map((l) => ({ ...l, id: uid('l'), qty: Math.abs(parseNumber(l.qty)) })) })
      openModal({ type: 'fak-edit', id: x.id, draft: x, isNew: true })
    },
    'fak-convert': (el) => {
      const src = docOf(el.dataset.id)
      if (!src) return
      const x = { ...convertDraft(src, el.dataset.kind, { id: uid('f'), date: todayISO() }), intro: el.dataset.kind === 'rechnung' ? S().intro : '', outro: el.dataset.kind === 'rechnung' ? S().outro : '', createdAt: nowIso(), createdBy: by() }
      if (x.kind === 'rechnung') x.dueDate = dueDateFor(x.date, custOf(x.customerId)?.paymentDays ?? S().paymentDays)
      if (src.kind === 'angebot' && src.status !== 'angenommen') {
        src.status = 'angenommen'
        src.history = [...(src.history || []), { at: nowIso(), by: by(), text: `angenommen (${KINDS[x.kind]} erstellt)` }]
        persist()
      }
      openModal({ type: 'fak-edit', id: x.id, draft: x, isNew: true })
    },
    'fak-offer-state': (el) => {
      const x = docOf(el.dataset.id)
      if (!x) return
      x.status = el.dataset.v
      x.history = [...(x.history || []), { at: nowIso(), by: by(), text: el.dataset.v }]
      commit(`Angebot ${x.number}: ${el.dataset.v}.`)
    },
    'fak-storno': async (el) => {
      const x = docOf(el.dataset.id)
      const reason = val('fv-reason').trim()
      if (!reason) return toast('Bitte einen Grund für das Storno angeben.')
      try {
        const draft = { ...stornoDraft(x, { id: uid('f'), date: todayISO(), reason }), createdAt: nowIso(), createdBy: by() }
        app.ui.fakAct = ''
        openModal({ type: 'fak-edit', id: draft.id, draft, isNew: true })
        toast('Stornorechnung als Entwurf: prüfen und festschreiben.')
      } catch (err) {
        toast(err.message)
      }
    },
    'fak-correct': (el) => {
      const x = docOf(el.dataset.id)
      const amount = num('fv-kamount')
      if (!(amount > 0)) return toast('Bitte den Betrag der Minderung (netto) eintragen.')
      const draft = { ...correctionDraft(x, { id: uid('f'), date: todayISO(), text: val('fv-ktext').trim() || 'Preisminderung', amount, vat: Number(val('fv-kvat')) }), createdAt: nowIso(), createdBy: by() }
      app.ui.fakAct = ''
      openModal({ type: 'fak-edit', id: draft.id, draft, isNew: true })
    },
    'fak-pay-open': (el) => openModal({ type: 'fak-pay', id: el.dataset.id }),
    'fak-pay-save': (el) => {
      const x = docOf(el.dataset.id)
      const amount = num('fp-amount')
      if (!x || !amount) return toast('Bitte einen Betrag eintragen.')
      x.payments = [...(x.payments || []), { id: uid('p'), date: val('fp-date') || todayISO(), amount: round2(amount), note: val('fp-note').trim(), by: by(), at: nowIso() }]
      closeModal()
      const open = openAmount(x, F().documents, S())
      commit(open <= 0.004 ? `${x.number} ist bezahlt.` : `Zahlung gebucht, offen ${money(open)}.`)
    },
    'fak-pay-del': (el) => {
      const x = docOf(el.dataset.id)
      if (!confirmStep(`fak-pdel:${el.dataset.pay}`, renderModal)) return
      x.payments = (x.payments || []).filter((p) => p.id !== el.dataset.pay)
      x.history = [...(x.history || []), { at: nowIso(), by: by(), text: 'Zahlung entfernt' }]
      persist()
      renderModal()
    },
    'fak-remind-open': (el) => openModal({ type: 'fak-remind', id: el.dataset.id }),
    'fak-remind': async (el) => {
      const x = docOf(el.dataset.id)
      if (!x) return
      checkNumbers()
      const s = S()
      const r = reminderFor(x, F().documents, { today: todayISO(), settings: s })
      const via = el.dataset.via
      const to = val('fr-to').trim()
      el.disabled = true
      try {
        const blob = await pdfBlob(reminderDocument({ doc: x, reminder: r, settings: s, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null), today: todayISO() }))
        const name = reminderFileName(x, r.level)
        if (via === 'mail') {
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('Bitte eine gültige E-Mail-Adresse eintragen.')
          await sendMail(app.auth.getToken, { to, subject: `${r.name}: Rechnung ${x.number}`, text: val('fr-text'), attachments: [{ name, blob, type: 'application/pdf' }] }, { from: app.config.mail?.from || '' })
        } else download(name, blob)
        archive(x, blob, name)
        x.reminders = [...(x.reminders || []), { level: r.level, name: r.name, date: todayISO(), deadline: r.deadline, interest: r.interest.amount, fee: r.fee, total: r.total, sentTo: via === 'mail' ? to : '', by: by() }]
        closeModal()
        commit(via === 'mail' ? `${r.name} an ${to} gesendet.` : `${r.name} erstellt (PDF).`)
      } catch (err) {
        el.disabled = false
        toast(`Nicht erstellt: ${err.message}`)
      }
    },
    'fak-mail-open': (el) => openModal({ type: 'fak-mail', id: el.dataset.id }),
    'fak-mail-send': async (el) => {
      checkNumbers()
      const x = docOf(el.dataset.id)
      const to = val('fm-to').trim()
      if (!x?.number) return toast('Bitte zuerst festschreiben.')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return toast('Bitte eine gültige E-Mail-Adresse eintragen.')
      const subject = val('fm-subject').trim() || `${KINDS[x.kind]} ${x.number}`
      const text = val('fm-text')
      el.disabled = true
      try {
        await app.service.flush().catch(() => {})
        const blob = await docPdf(x)
        const name = docFileName(x)
        if (canMail()) {
          await sendMail(app.auth.getToken, { to, subject, text, attachments: [{ name, blob, type: 'application/pdf' }] }, { from: app.config.mail?.from || '' })
          const path = await archive(x, blob, name)
          if (path) x.pdfPath = path
        } else {
          download(name, blob)
          location.href = `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?${new URLSearchParams({ subject, body: `${text}\n\n(PDF bitte anhängen: ${name})` }).toString().replace(/\+/g, '%20')}`
        }
        x.sent = [...(x.sent || []), { at: nowIso(), to, via: canMail() ? 'graph' : 'mailto', by: by() }]
        if (!x.recipient?.email && x.customerId && !custOf(x.customerId)?.email) custOf(x.customerId).email = to
        closeModal()
        commit(canMail() ? `${KINDS[x.kind]} ${x.number} an ${to} gesendet.` : `E-Mail an ${to} vorbereitet; das PDF liegt im Download-Ordner.`)
      } catch (err) {
        el.disabled = false
        toast(`Nicht gesendet: ${err.message}`)
      }
    },
    'fak-run': (el) => {
      const ym = el.dataset.ym || todayISO().slice(0, 7)
      const d = F()
      const r = runRecurring(d, ym, { today: todayISO(), newId: () => uid('f'), by: by(), customersById: new Map(d.customers.map((c) => [c.id, c])) })
      if (!r.created.length) return toast('Für diesen Monat ist nichts mehr abzurechnen.')
      d.documents = r.documents.map((x) => (r.created.some((c) => c.id === x.id) ? { ...x, objectName: objName(x.objectId) } : x))
      d.recurring = r.recurring
      app.ui.fakTab = 'rechnungen'
      app.ui.fakState = 'entwurf'
      commit(`${plural(r.created.length, 'Rechnungsentwurf', 'Rechnungsentwürfe')} für ${monthLabel(ym)} erstellt${r.adjusted.length ? `, ${plural(r.adjusted.length, 'Preis', 'Preise')} wertgesichert angepasst` : ''}. Bitte prüfen und festschreiben.`)
    },
    'fak-idx-add': () => {
      const ym = val('fak-idx-month')
      const v = num('fak-idx-value')
      if (!/^\d{4}-\d{2}$/.test(ym) || !(v > 0)) return toast('Bitte Monat und Indexzahl eintragen.')
      F().indexValues[ym] = v
      commit(`${S().indexName} ${monthLabel(ym)}: ${String(v).replace('.', ',')}`)
    },
    'fak-idx-del': (el) => {
      delete F().indexValues[el.dataset.ym]
      commit()
    },
    'fak-rec-open': (el) => openModal({ type: 'fak-rec', id: el.dataset.id || '' }),
    'fak-rec-line-add': () => {
      const m = app.ui.modal
      readRecurring(m)
      m.draft.lines.push({ id: uid('l'), text: '', qty: 1, unit: 'Monat', price: '', vat: S().vat })
      renderModal()
    },
    'fak-rec-save': () => {
      const m = app.ui.modal
      const v = readRecurring(m)
      if (!v.customerId) return toast('Bitte einen Kunden wählen.')
      if (!v.startMonth) return toast('Bitte den ersten Abrechnungsmonat wählen.')
      if (!v.lines.some((l) => l.text && parseNumber(l.price))) return toast('Bitte mindestens eine Position mit Preis.')
      if (v.index?.active && !(Number(v.index.baseValue) > 0)) return toast('Wertsicherung: bitte die Basis-Indexzahl eintragen.')
      const d = F()
      const i = d.recurring.findIndex((r) => r.id === v.id)
      const clean = { ...structuredClone(v), lines: v.lines.filter((l) => l.text || parseNumber(l.price)) }
      if (i >= 0) d.recurring[i] = { ...d.recurring[i], ...clean }
      else d.recurring.push(clean)
      closeModal()
      commit('Dauerauftrag gespeichert.')
    },
    'fak-rec-del': (el) => {
      if (!confirmStep(`fak-rdel:${el.dataset.id}`, renderModal)) return
      F().recurring = F().recurring.filter((r) => r.id !== el.dataset.id)
      closeModal()
      commit('Dauerauftrag gelöscht. Erstellte Rechnungen bleiben.')
    },
    'fak-cust-open': (el) => openModal({ type: 'fak-cust', id: el.dataset.id || '' }),
    'fak-cust-save': (el) => {
      const name = val('fc-name').trim()
      if (!name) return toast('Bitte einen Namen eintragen.')
      const d = F()
      const days = val('fc-days')
      const fields = { name, customerNo: val('fc-no').trim(), address: val('fc-address').trim(), uid: val('fc-uid').trim().toUpperCase(), email: val('fc-email').trim(), paymentDays: days === '' ? '' : Number(days), hourRate: num('fc-rate') || '', account: val('fc-account').trim(), reverseCharge: checked('fc-rc'), consumer: checked('fc-consumer'), note: val('fc-note').trim(), objectIds: [...document.querySelectorAll('input[name="fc-obj"]:checked')].map((x) => x.value) }
      if (fields.reverseCharge && !fields.uid) return toast('Reverse Charge braucht die UID-Nummer des Kunden.')
      if (d.customers.some((c) => c.customerNo && c.customerNo === fields.customerNo && c.id !== el.dataset.id)) return toast(`Kundennummer ${fields.customerNo} gibt es schon.`)
      // ein Objekt gehört zu genau einem Kunden
      for (const c of d.customers) if (c.id !== el.dataset.id) c.objectIds = (c.objectIds || []).filter((o) => !fields.objectIds.includes(o))
      const x = custOf(el.dataset.id)
      if (x) Object.assign(x, fields)
      else d.customers.push({ id: uid('c'), ...fields, createdAt: nowIso() })
      closeModal()
      commit('Kunde gespeichert.')
    },
    'fak-cust-del': (el) => {
      if (!confirmStep(`fak-cdel:${el.dataset.id}`, renderModal)) return
      F().customers = F().customers.filter((c) => c.id !== el.dataset.id)
      closeModal()
      commit('Kunde gelöscht.')
    },
    'fak-cust-from-objects': () => {
      const d = F()
      const list = app.data.objects.filter((o) => !customerForObject(d, o.id))
      for (const o of list) d.customers.push({ id: uid('c'), name: o.name, customerNo: nextCustomerNo(d.customers), address: o.address || '', email: o.proofEmail || '', uid: '', paymentDays: '', objectIds: [o.id], reverseCharge: false, consumer: false, createdAt: nowIso() })
      commit(`${plural(list.length, 'Kunde', 'Kunden')} angelegt (Name und Anschrift wie beim Objekt). Rechnungsempfänger, Anschrift und UID bitte ergänzen.`)
    },
    'fak-art-open': (el) => openModal({ type: 'fak-art', id: el.dataset.id || '' }),
    'fak-art-save': (el) => {
      const name = val('fa-name').trim()
      if (!name) return toast('Bitte eine Bezeichnung eintragen.')
      const d = F()
      const fields = { name, text: val('fa-text').trim(), unit: val('fa-unit'), price: num('fa-price'), vat: Number(val('fa-vat')) }
      const x = d.articles.find((a) => a.id === el.dataset.id)
      if (x) Object.assign(x, fields)
      else d.articles.push({ id: uid('a'), ...fields })
      closeModal()
      commit('Artikel gespeichert.')
    },
    'fak-art-del': (el) => {
      if (!confirmStep(`fak-adel:${el.dataset.id}`, renderModal)) return
      F().articles = F().articles.filter((a) => a.id !== el.dataset.id)
      closeModal()
      commit('Artikel gelöscht.')
    },
    'fak-art-starter': () => {
      const d = F()
      for (const [name, unit, price] of STARTER_ARTICLES) d.articles.push({ id: uid('a'), name, unit, price, vat: S().vat })
      commit(`${STARTER_ARTICLES.length} übliche Leistungen angelegt (ohne Preise).`)
    },
    'fak-settings-save': () => {
      const d = F()
      const y = todayISO().slice(0, 4)
      const iban = val('fs-iban').replace(/\s+/g, '').toUpperCase()
      if (iban && !ibanValid(iban)) toast('Hinweis: Die IBAN ist ungültig (Prüfziffer).')
      const reminders = S().reminders.map((r, i) => ({ ...r, name: val(`fs-r${i}-name`).trim() || r.name, days: Number(val(`fs-r${i}-days`)) || 0, interest: checked(`fs-r${i}-interest`), fee: checked(`fs-r${i}-fee`) }))
      const start = { ...(d.settings.start || {}) }
      const startNo = Number(val('fs-start'))
      if (startNo > 1) start[`rechnung|${y}`] = startNo
      else delete start[`rechnung|${y}`]
      d.settings = {
        ...d.settings,
        sender: { name: val('fs-name').trim(), address: val('fs-address').trim(), uid: val('fs-uid').trim().toUpperCase(), email: val('fs-email').trim(), phone: val('fs-phone').trim(), web: val('fs-web').trim(), register: val('fs-register').trim() },
        bank: { iban, bic: val('fs-bic').trim().toUpperCase(), name: val('fs-bank').trim() },
        paymentDays: Number(val('fs-days')) || 0,
        vat: Number(val('fs-vat')),
        offerDays: Number(val('fs-offer-days')) || 30,
        digits: Math.min(6, Math.max(3, Number(val('fs-digits')) || 4)),
        series: Object.fromEntries(Object.keys(KINDS).map((k) => [k, val(`fs-series-${k}`).trim().toUpperCase() || S().series[k]])),
        start,
        intro: val('fs-intro'),
        outro: val('fs-outro'),
        offerIntro: val('fs-offer-intro'),
        offerOutro: val('fs-offer-outro'),
        smallBusiness: checked('fs-small'),
        baseRate: num('fs-base'),
        reminders,
        accounts: { debitor: val('fs-acc-deb').trim(), erloese: Object.fromEntries(VAT_RATES.map((v) => [v, val(`fs-acc-${v}`).trim()])), rc: val('fs-acc-rc').trim() },
        indexName: val('fs-index').trim() || 'VPI 2020',
      }
      commit('Einstellungen gespeichert.')
    },
    'fak-proof-open': async () => {
      const month = addDays(firstOfMonth(todayISO()), -1).slice(0, 7)
      await ensureRange(`${month}-01`, lastDayOf(month)).catch(() => {})
      openModal({ type: 'fak-proof', month })
    },
    'fak-proof-month': async () => {
      const m = app.ui.modal
      m.month = val('fpo-month')
      m.rate = num('fpo-rate') || ''
      await ensureRange(`${m.month}-01`, lastDayOf(m.month)).catch(() => {})
      renderModal()
    },
    'fak-proof-create': (el) => {
      const month = el.dataset.month
      const chosen = new Set([...document.querySelectorAll('input[name="fpo"]:checked')].map((x) => x.value))
      const rate = num('fpo-rate')
      const d = F()
      if (rate) d.settings.hourRate = rate
      const created = []
      for (const { object: o, proof } of proofsOf(month).filter((p) => chosen.has(p.object.id))) {
        const cu = customerForObject(d, o.id)
        const rec = d.recurring.some((r) => r.objectId === o.id && r.active !== false)
        const useProof = rec ? { ...proof, rows: proof.rows.filter((r) => r.category === 'sonder') } : proof
        const lines = linesFromProof({ proof: useProof, objectName: o.name, month, rate: Number(cu?.hourRate) || rate, vat: S().vat, newId: () => uid('l') })
        if (!lines.length) continue
        const x = newDraft('rechnung', { objectId: o.id, objectName: o.name, serviceFrom: `${month}-01`, serviceTo: lastDayOf(month), title: `${rec ? 'Sonderleistungen' : 'Reinigung'} ${o.name} ${monthLabel(month)}`, lines, source: { type: 'nachweis', key: `nachweis:${o.id}:${month}` } })
        if (cu) applyCustomer(x, cu.id)
        x.objectId = o.id
        d.documents.push(x)
        created.push(x)
      }
      closeModal()
      if (!created.length) return toast('Nichts übernommen (keine erbrachten Einsätze bzw. Sonderleistungen gewählt).')
      app.ui.fakTab = 'rechnungen'
      app.ui.fakState = 'entwurf'
      commit(`${plural(created.length, 'Rechnungsentwurf', 'Rechnungsentwürfe')} aus dem Leistungsnachweis ${monthLabel(month)}. Preise prüfen und festschreiben.`)
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Zu erledigen und Hinweise

registerTodo({
  id: 'fakturierung',
  module: MODULE,
  title: 'Fakturierung',
  compute: (today) => {
    if (!app.data?.fakturierung) return []
    const s = S()
    const out = []
    const due = recurringDue(today.slice(0, 7))
    if (due.length) out.push({ id: `rec:${today.slice(0, 7)}:${due.length}`, kind: 'run', count: due.length, ym: today.slice(0, 7) })
    const remind = openItems(F().documents, today, s).filter((x) => x.next)
    if (remind.length) out.push({ id: `remind:${remind.map((x) => `${x.doc.id}.${x.level}`).join(',')}`, kind: 'remind', list: remind })
    const conflicts = resolveDuplicates(F().documents, s).conflicts
    if (conflicts.length) out.push({ id: `dup:${conflicts.flat().join(',')}`, kind: 'dup', conflicts })
    // Bankabgleich: Eingänge, die seit über 7 Tagen keiner Rechnung zugeordnet sind
    const stale = staleBankCredits(today)
    if (stale.length) out.push({ id: `bank:${stale.map((t) => t.id).join(',')}`, kind: 'bank', count: stale.length, sum: round2(stale.reduce((a, t) => a + t.amount, 0)) })
    return out
  },
  render: (items) =>
    items
      .map((x) =>
        x.kind === 'run'
          ? `<div class="todo-item"><span class="flag warning">${x.count}</span><div class="todo-text"><strong>Daueraufträge ${esc(monthLabel(x.ym))}</strong> noch nicht abgerechnet</div><button class="btn small primary" data-action="fak-run" data-ym="${x.ym}">Monatslauf</button></div>`
          : x.kind === 'bank'
            ? `<div class="todo-item"><span class="flag warning">${x.count}</span><div class="todo-text"><strong>Zahlungseingänge ohne Rechnung</strong> seit über 7 Tagen (${money(x.sum)})</div><button class="btn small primary" data-action="fak-bank-goto">Zuordnen</button></div>`
          : x.kind === 'remind'
            ? `<div class="todo-item"><span class="flag error">${x.list.length}</span><div class="todo-text"><strong>Mahnung fällig:</strong> ${esc(x.list.slice(0, 4).map((i) => `${i.doc.number} (${i.doc.recipient?.name || ''})`).join(', '))}${x.list.length > 4 ? ' …' : ''}</div><button class="btn small" data-action="view" data-view="fakturierung">Offene Posten</button></div>`
            : `<div class="todo-item"><span class="flag error">!</span><div class="todo-text"><strong>Rechnungsnummer doppelt vergeben</strong> und beide schon versendet. Eine davon stornieren und neu ausstellen.</div></div>`,
      )
      .join(''),
})

registerObjectHint({
  module: MODULE,
  html: (objectId) => {
    const d = app.data?.fakturierung
    if (!d) return ''
    const cu = customerForObject(F(), objectId)
    const open = openItems(F().documents, todayISO(), S()).filter((x) => x.doc.objectId === objectId)
    if (!cu && !open.length) return ''
    return `<strong>Rechnungsempfänger</strong>: ${esc(cu?.name || '–')}${open.length ? ` · <span class="err-text">${plural(open.length, 'offene Rechnung', 'offene Rechnungen')} (${money(open.reduce((a, x) => a + x.open, 0))})</span>` : ''}`
  },
})
