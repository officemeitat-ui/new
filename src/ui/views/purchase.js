// Einkauf (Modul „Einkauf & Kasse“): Eingangsrechnungen erfassen (auch Foto vom Handy, E-Rechnung einlesen),
// Prüfung für den Vorsteuerabzug, Doppel-Erkennung, Freigabe, Zahlungen mit Skonto, offene Verbindlichkeiten nach
// Fälligkeit, Überweisungsdatei (pain.001), Abbuchungen aus dem Kontoauszug zuordnen, Lieferanten (verknüpft mit
// Material & Lager), Export für die Steuerberatung. Datei einkauf/einkauf.json, Belege unter einkauf/belege/JAHR/.
// Rechenkern: core/purchase.js; Kassenbuch: cashbook.js. „Aus Beleg lesen (KI)“: zuerst die E-Rechnung im PDF,
// sonst ein Vorschlag der KI (ui/kix.js, ai/extract.js, Prüfung in core/ki-vorschlag.js), gespeichert von der Person.

import { addDays, firstOfMonth, formatDate, todayISO } from '../../core/dates.js'
import { eInvoiceFromPdf, parseEInvoice } from '../../core/fak-import.js'
import { COUNTRY_NAMES, formatIban, ibanValid, parseNumber, round2, settingsOf as invoicingSettings } from '../../core/invoicing.js'
import { matchSupplierKi } from '../../core/ki-vorschlag.js'
import {
  applyDebit,
  belegPath,
  bookTransferRun,
  draftFromEInvoice,
  dueFor,
  duePayables,
  invoiceEditable,
  invoiceProblems,
  invoiceTotals,
  markTransferRun,
  materialFields,
  materialLinks,
  needsApproval,
  orderMatch,
  nextInvoiceNo,
  nextSupplierNo,
  openDebits,
  openOf,
  PAY_STATE,
  payables,
  payablesSummary,
  purchaseCsv,
  purchaseExportRows,
  purchasePaymentEntries,
  purchaseState,
  removePayment,
  skontoAvailableOn,
  skontoOfInvoice,
  spendingByMonth,
  suggestDebit,
  suggestOrder,
  supplierAddress,
  supplierFromMaterial,
  supplierMatches,
  supplierName,
  supplierProblems,
  transferPayments,
  undoDebit,
  VAT_RATES,
  vatDeductible,
  vatFor,
  splitGross,
} from '../../core/purchase.js'
import { balanceAt } from '../../core/cashbook.js'
import { openRecharges } from '../../core/recharge.js'
import { sepaFileName, sepaTransfer } from '../../core/sepa-transfer.js'
import { ACTIONS, app, canEdit, closeModal, confirmStep, dataStamp, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { checked, download, esc, ICON, menu, modalFrame, options, tabBar, val } from '../shared.js'
import { kixBox, kixButton, kixConsent, kixFailed, kixFile, kixOurs, kixSet } from '../kix.js'
import { belegChip, by, cashForPayment, E, editable, inflate, K, money, MODULE, newId, nowIso, openBeleg, plural, PS, sees, storeBeleg } from './einkauf-shared.js'
import { einkaufData, fakDocs, rechargeBlock, rechargeLock, rechargePill, syncRechargeBilled } from './weiterverrechnung.js'

const ICON_PURCHASE = '<path d="M3.5 4.5h2l2.2 10.5h10.6l2-7.5H7"/><circle cx="9.5" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>'
const supOf = (id) => E().suppliers.find((s) => s.id === id)
const invOf = (id) => E().invoices.find((x) => x.id === id)
const objName = (id) => app.data.objects?.find((o) => o.id === id)?.name || ''
const day = (iso) => (iso ? formatDate(iso, { year: true }) : '')
const num = (id) => parseNumber(val(id))
const numText = (n) => (n || n === 0 ? round2(n).toFixed(2).replace('.', ',') : '')
const year = () => (/^\d{4}$/.test(app.ui.ekYear || '') ? app.ui.ekYear : todayISO().slice(0, 4))
const STATE_CLASS = { offen: 'info', teilbezahlt: 'warning', bezahlt: 'ok', ueberfaellig: 'error', storniert: '' }
const pill = (st) => `<span class="pill ${STATE_CLASS[st] || ''}">${esc(PAY_STATE[st] || st)}</span>`
const catName = (id) => PS().categories.find((c) => c.id === id)?.name || ''
const PENDING = new Map() // Entwurf → gewählte Datei (wird beim Speichern abgelegt)

/** Ganzen Dialog neu zeichnen (nach Auswahl oder Kästchen; der Fokus bleibt auf dem Feld). */
function rerender() {
  const id = document.activeElement?.id
  renderModal()
  if (id) document.getElementById(id)?.focus({ preventScroll: true })
}
/** Ein Feld im offenen Dialog setzen (ohne neu zu zeichnen). */
const setField = (id, value) => {
  const el = document.getElementById(id)
  if (el) el.value = value ?? ''
}
/** Nur Summe, Skonto-Hinweis und Prüfung neu: Eingaben, Fokus und Bildlauf bleiben. */
function live() {
  const dr = app.ui.modal?.draft
  if (!dr) return
  for (const [id, html] of [['ei-sum', sumHtml(dr)], ['ei-skonto', skontoHtml(dr)], ['ei-probs', problemList(invoiceProblems(dr, { suppliers: E().suppliers, invoices: E().invoices }))]]) {
    const el = document.getElementById(id)
    if (el) el.innerHTML = html
  }
}
const sumHtml = (dr) => {
  const t = invoiceTotals(dr)
  return `Summe: netto ${money(t.net)} · Vorsteuer ${money(dr.reverseCharge ? t.rcVat : t.vat)}${dr.reverseCharge ? ' (Reverse Charge: geschuldet und abziehbar)' : ''} · <strong>brutto ${money(t.gross)}</strong>`
}
const skontoHtml = (dr) => (skontoOfInvoice(dr) ? `Skonto ${money(skontoOfInvoice(dr).amount)} bei Zahlung bis ${day(skontoOfInvoice(dr).until)}.` : '')

function commit(message) {
  persist()
  renderNow()
  if (message) toast(message)
}

/** Kontoauszug der Fakturierung (Reiter Bank): Abbuchungen ohne Eingangsrechnung. */
const bankTx = () => (sees('fakturierung') ? app.data.fakturierung?.bank?.tx || [] : [])
const debits = () => openDebits(bankTx(), E())

// Zähler je Datenstand merken: Seitenleiste, Startseite und „Zu erledigen“ fragen bei jedem Zeichnen
let cache = { key: '', value: null }
function counts() {
  const key = `${dataStamp()}|${todayISO()}|${app.access?.roles?.join() || ''}`
  if (cache.key === key) return cache.value
  const d = E()
  const s = PS()
  const today = todayISO()
  const due = duePayables(d.invoices, today, 3).filter((x) => !needsApproval(x.inv, s))
  const approve = s.approval ? d.invoices.filter((x) => needsApproval(x, s) && openOf(x) > 0.004) : []
  const sure = debits().filter((t) => suggestDebit(t, d).level === 'sicher')
  cache = { key, value: { due, approve, sure, badge: due.length + approve.length } }
  return cache.value
}

// ---------------------------------------------------------------- Ansicht

const TABS = [
  ['start', 'Übersicht'],
  ['rechnungen', 'Eingangsrechnungen'],
  ['offen', 'Offene Zahlungen'],
  ['bank', 'Bank-Ausgänge'],
  ['lieferanten', 'Lieferanten'],
  ['einstellungen', 'Einstellungen'],
]

/** Stand „verrechnet mit …“ aus der Fakturierung mitschreiben (für Rollen ohne Fakturierung), wie checkNumbers in der Fakturierung. */
function syncRecharges() {
  if (!syncRechargeBilled()) return
  setTimeout(() => {
    persist()
    renderNow()
  }, 0)
}

function purchaseView() {
  syncRecharges()
  const tab = TABS.some(([k]) => k === app.ui.ekTab) ? app.ui.ekTab : 'start'
  const n = counts()
  const ed = editable()
  const flags = { offen: n.due.length + n.approve.length, bank: n.sure.length }
  const body = { start: startTab, rechnungen: invoicesTab, offen: openTab, bank: bankTab, lieferanten: suppliersTab, einstellungen: settingsTab }[tab]()
  return `<div class="section-head"><div><h2>Einkauf</h2>
      <p>Eingangsrechnungen mit Beleg (Foto oder PDF, auch E-Rechnung), Prüfung für den Vorsteuerabzug, Freigabe, Zahlungen mit Skonto, Überweisungsdatei und Export für die Steuerberatung.</p></div>
      <div class="actions">${ed ? `<button class="btn primary" data-action="ek-inv-new">${ICON.plus} Eingangsrechnung</button>` : ''}${menu({
        label: 'Mehr',
        icon: ICON.more,
        single: false,
        items: [
          ed && { label: 'Lieferant anlegen', action: 'ek-sup-open' },
          { label: 'Export Steuerberatung', action: 'ek-export-open', hint: 'Eingangsrechnungen als CSV' },
          { label: 'Paket für die Steuerberatung', action: 'stb-open', hint: 'Zeitraum als ZIP mit Belegen' },
          { label: 'Kassenbuch', action: 'view', data: { view: 'kassenbuch' } },
        ],
      })}</div></div>
    ${tabBar({ action: 'ek-tab', current: tab, cls: 'ek-tabs', tabs: TABS.map(([id, label]) => ({ id, label, flag: flags[id] })) })}
    ${body}`
}

registerView({
  id: 'einkauf',
  order: 65,
  label: 'Einkauf',
  group: 'auswertung',
  section: 'finanzen',
  module: MODULE,
  icon: ICON_PURCHASE,
  noWeek: true,
  text: 'Eingangsrechnungen, Lieferanten, offene Zahlungen',
  badge: () => counts().badge,
  render: purchaseView,
})

const tile = (label, value, cls = '', tab = '', sub = '') => `<${tab ? `button data-action="${tab === 'kassenbuch' ? 'view" data-view="kassenbuch' : `ek-tab" data-v="${tab}`}"` : 'div'} class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<small class="muted">${sub}</small>` : ''}</${tab ? 'button' : 'div'}>`

function yearSelect() {
  const years = [...new Set([todayISO().slice(0, 4), ...E().invoices.map((x) => String(x.date || '').slice(0, 4)).filter(Boolean)])].sort().reverse()
  return `<label class="field inline"><span>Jahr</span><select id="ek-year" data-change="ek-year">${options(years.map((y) => [y, y]), year())}</select></label>`
}

function startTab() {
  const d = E()
  const today = todayISO()
  const sum = payablesSummary(d.invoices, today)
  const n = counts()
  const y = year()
  const sp = spendingByMonth(d.invoices, y, PS())
  const max = Math.max(1, ...sp.months.map((m) => Math.abs(m.net)))
  const MON = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
  const bars = sp.months.map((m, i) => `<div class="fak-bar" title="${MON[i]} ${y}: ${money(m.net)} netto, ${plural(m.count, 'Rechnung', 'Rechnungen')}"><span class="fak-bar-fill" style="height:${Math.max(2, Math.round((Math.abs(m.net) / max) * 100))}%"></span><small>${MON[i]}</small></div>`).join('')
  const cash = app.data.kasse?.entries?.length ? balanceAt(K()) : null
  const unchecked = d.invoices.filter((x) => !x.cancelled && openOf(x) > 0.004 && !vatDeductible(invoiceProblems(x, { suppliers: d.suppliers })))
  const recharge = openRecharges({ ...einkaufData(), docs: fakDocs() })
  const todo = [
    n.due.length ? `<div class="todo-item"><span class="flag ${n.due.some((x) => x.overdueDays) ? 'error' : 'warning'}">${n.due.length}</span><div class="todo-text"><strong>Zahlungen fällig</strong> in den nächsten 3 Tagen oder überfällig (${money(n.due.reduce((a, x) => a + (x.skonto ? x.skonto.payable : x.open), 0))})</div><button class="btn small primary" data-action="ek-tab" data-v="offen">Offene Zahlungen</button></div>` : '',
    n.approve.length ? `<div class="todo-item"><span class="flag warning">${n.approve.length}</span><div class="todo-text"><strong>Zur Freigabe:</strong> ${esc(n.approve.slice(0, 4).map((x) => `${x.no} ${x.supplier?.name || ''}`).join(', '))}${n.approve.length > 4 ? ' …' : ''}</div><button class="btn small" data-action="ek-tab" data-v="rechnungen">Ansehen</button></div>` : '',
    n.sure.length ? `<div class="todo-item"><span class="flag">${n.sure.length}</span><div class="todo-text"><strong>Abbuchungen im Kontoauszug</strong> passen sicher zu Eingangsrechnungen</div><button class="btn small" data-action="ek-tab" data-v="bank">Zuordnen</button></div>` : '',
    recharge.length ? `<div class="todo-item"><span class="flag">${recharge.length}</span><div class="todo-text"><strong>Weiterverrechnen:</strong> ${plural(recharge.length, 'Beleg', 'Belege')} für Kunden noch in keiner Rechnung (${money(recharge.reduce((a, x) => a + x.amount.net, 0))} netto)</div>${sees('fakturierung') ? '<button class="btn small" data-action="fwv-goto">Fakturierung</button>' : ''}</div>` : '',
    unchecked.length ? `<div class="todo-item"><span class="flag warning">${unchecked.length}</span><div class="todo-text"><strong>Vorsteuerabzug prüfen:</strong> Angaben nach § 11 UStG fehlen bei ${esc(unchecked.slice(0, 4).map((x) => x.no).join(', '))}${unchecked.length > 4 ? ' …' : ''}</div><button class="btn small" data-action="ek-inv-open" data-id="${esc(unchecked[0].id)}">Prüfen</button></div>` : '',
  ].join('')
  const fresh = !d.invoices.length && editable()
  return `<div class="filters">${yearSelect()}</div>
    ${fresh ? `<div class="banner welcome"><p><strong>Erste Eingangsrechnung:</strong> Foto vom Beleg oder PDF hochladen, E-Rechnungen (ZUGFeRD, XRechnung) füllen die Felder selbst aus. Lieferanten aus Material & Lager lassen sich übernehmen.</p><button class="btn primary" data-action="ek-inv-new">Eingangsrechnung erfassen</button></div>` : ''}
    <div class="impact-stats tc-stats">${tile('Offene Verbindlichkeiten', money(sum.open), '', 'offen', plural(sum.openCount, 'Rechnung', 'Rechnungen'))}${tile('Fällig diese Woche', money(sum.week), sum.weekCount ? 'warn' : '', 'offen', plural(sum.weekCount, 'Rechnung', 'Rechnungen'))}${tile('Überfällig', money(sum.overdue), sum.overdueCount ? 'err' : '', 'offen', plural(sum.overdueCount, 'Rechnung', 'Rechnungen'))}${tile('Skonto möglich', money(sum.skontoChance), '', 'offen')}${cash !== null ? tile('Kassenstand', money(cash), '', 'kassenbuch') : ''}</div>
    ${todo ? `<div class="todo-list">${todo}</div>` : ''}
    <h3>Ausgaben je Monat ${esc(y)} (netto)</h3><div class="fak-bars" role="img" aria-label="Ausgaben je Monat">${bars}</div>
    ${sp.categories.length ? `<h3>Ausgaben je Kategorie ${esc(y)}</h3><div class="table-wrap"><table class="data"><thead><tr><th>Kategorie</th><th class="num">netto</th><th class="num">Anteil</th></tr></thead><tbody>${sp.categories.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${money(c.net)}</td><td class="num">${Math.round((c.net / Math.max(0.01, sp.categories.reduce((a, x) => a + x.net, 0))) * 100)} %</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Noch keine Eingangsrechnungen in diesem Jahr.</p>'}`
}

function invRow(x, today) {
  const t = invoiceTotals(x)
  const st = purchaseState(x, today)
  const open = openOf(x)
  const vst = x.cancelled ? true : vatDeductible(invoiceProblems(x, { suppliers: E().suppliers }))
  return `<tr class="clickable" data-action="ek-inv-open" data-id="${esc(x.id)}"><td><strong>${esc(x.no || '')}</strong>${x.imported ? '<br><span class="muted">übernommen</span>' : ''}</td><td>${day(x.date)}</td>
    <td>${esc(x.supplier?.name || supplierName(supOf(x.supplierId) || {}) || '–')}<br><span class="muted">Nr. ${esc(x.number || '–')}</span></td><td>${esc(catName(x.category))}${x.objectId ? `<br><span class="muted">${esc(objName(x.objectId))}</span>` : ''}</td>
    <td class="num">${money(t.net)}</td><td class="num"><strong>${money(t.gross)}</strong>${open > 0.004 && open !== t.gross && !x.cancelled ? `<br><span class="muted">offen ${money(open)}</span>` : ''}</td><td>${day(x.dueDate)}</td>
    <td>${pill(st)}${x.approval ? ' <span class="pill ok" title="geprüft und freigegeben">geprüft</span>' : ''}${vst ? '' : ' <span class="pill warning" title="Angaben für den Vorsteuerabzug fehlen">Vorsteuer?</span>'}${x.reverseCharge ? ' <span class="pill info">RC</span>' : ''}${x.beleg ? ' <span class="pill" title="Beleg abgelegt">Beleg</span>' : ' <span class="pill warning" title="Beleg fehlt">ohne Beleg</span>'}${x.recharge && !x.cancelled ? ` ${rechargePill('einkauf', x.id)}` : ''}</td></tr>`
}

function invoicesTab() {
  const d = E()
  const today = todayISO()
  const q = String(app.ui.ekSearch || '').trim().toLowerCase()
  const st = app.ui.ekState || ''
  const y = year()
  const list = d.invoices
    .filter((x) => String(x.date || '').startsWith(y) || (!x.cancelled && openOf(x) > 0.004))
    .filter((x) => !st || purchaseState(x, today) === st)
    .filter((x) => !q || [x.no, x.number, x.supplier?.name, x.text, catName(x.category), objName(x.objectId)].some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.no).localeCompare(String(a.no)))
  return `<div class="filters">${yearSelect()}<label class="field inline"><span>Status</span><select id="ek-state" data-change="ek-state">${options(Object.entries(PAY_STATE), st, { empty: 'alle' })}</select></label>
      <label class="field inline"><span>Suche</span><input type="search" id="ek-search" value="${esc(app.ui.ekSearch || '')}" data-input="ek-search" placeholder="Nummer, Lieferant, Text"></label><span class="spacer"></span>
      <button class="btn small" data-action="ek-export-open">${ICON.download} Export Steuerberatung</button></div>
    ${list.length ? `<div class="table-wrap"><table class="data ek-table"><thead><tr><th>Eingang</th><th>Datum</th><th>Lieferant</th><th>Kategorie</th><th class="num">netto</th><th class="num">brutto</th><th>fällig</th><th>Status</th></tr></thead><tbody>${list.map((x) => invRow(x, today)).join('')}</tbody></table></div>` : '<p class="empty">Keine Eingangsrechnungen für diese Auswahl.</p>'}
    <p class="note">Jede Eingangsrechnung bekommt eine laufende Eingangsnummer (z. B. ER-${esc(y)}-0001) für die Ablage. Der Beleg liegt in SharePoint unter einkauf/belege/${esc(y)}/ und wird sieben Jahre aufbewahrt (§ 132 BAO). Eine Fehlerfassung wird storniert, nicht gelöscht.</p>`
}

function openTab() {
  const d = E()
  const s = PS()
  const today = todayISO()
  const ed = editable()
  const list = payables(d.invoices, today)
  const sel = new Set((app.ui.ekSel || []).filter((id) => list.some((x) => x.inv.id === id)))
  const selSum = round2(list.filter((x) => sel.has(x.inv.id)).reduce((a, x) => a + (x.skonto ? x.skonto.payable : x.open), 0))
  const rows = list
    .map(({ inv: x, open, deadline, skonto, overdueDays }) => {
      const locked = needsApproval(x, s)
      return `<tr><td>${ed ? `<input type="checkbox" class="ek-sel" data-change="ek-sel" data-id="${esc(x.id)}" ${sel.has(x.id) ? 'checked' : ''} ${locked ? 'disabled title="erst nach der Freigabe"' : ''} aria-label="für die Überweisung auswählen">` : ''}</td>
        <td><button class="link-btn" data-action="ek-inv-open" data-id="${esc(x.id)}">${esc(x.no)}</button><br><span class="muted">${esc(x.supplier?.name || '')} · Nr. ${esc(x.number || '–')}</span></td>
        <td>${day(deadline)}${skonto ? `<br><span class="muted">Skonto bis dahin</span>` : ''}${x.dueDate && skonto ? `<br><span class="muted">fällig ${day(x.dueDate)}</span>` : ''}</td>
        <td class="num">${overdueDays ? `<span class="pill ${overdueDays > 14 ? 'error' : 'warning'}">${overdueDays} Tage</span>` : ''}</td>
        <td class="num"><strong>${money(open)}</strong>${skonto ? `<br><span class="muted">mit Skonto ${money(skonto.payable)}</span>` : ''}</td>
        <td>${locked ? '<span class="pill warning">zur Freigabe</span>' : x.sepa && !x.payments?.some((p) => p.sepa === x.sepa.runId) ? `<span class="pill info" title="in der Überweisungsdatei">überwiesen ${day(x.sepa.date)}</span>` : ''}</td>
        <td class="actions-cell">${ed ? `<button class="btn small" data-action="ek-pay-open" data-id="${esc(x.id)}">Zahlung</button>` : ''}</td></tr>`
    })
    .join('')
  const runs = (d.sepaRuns || []).slice(-8).reverse()
  return `<div class="filters">${ed ? `<button class="btn primary" data-action="ek-sepa-open" ${sel.size ? '' : 'disabled'}>Überweisungsdatei (${sel.size}${sel.size ? ` · ${money(selSum)}` : ''})</button><button class="btn small" data-action="ek-sel-all">${sel.size ? 'Auswahl aufheben' : 'Fällige auswählen'}</button>` : ''}<span class="spacer"></span><span class="muted small">sortiert nach Frist (Skonto zuerst)</span></div>
    ${rows ? `<div class="table-wrap"><table class="data ek-open"><thead><tr><th></th><th>Rechnung</th><th>Frist</th><th class="num">überfällig</th><th class="num">offen</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine offenen Eingangsrechnungen.</p>'}
    ${runs.length ? `<h3>Überweisungsdateien</h3><div class="table-wrap"><table class="data"><thead><tr><th>Ausführung</th><th>Datei</th><th class="num">Zahlungen</th><th class="num">Summe</th><th></th></tr></thead><tbody>${runs.map((r) => `<tr><td>${day(r.date)}</td><td>${esc(r.name || r.msgId)}<br><span class="muted">${esc(r.by || '')}, ${day(String(r.at).slice(0, 10))}</span></td><td class="num">${r.count}</td><td class="num">${money(r.sum)}</td><td>${r.booked ? `<span class="pill ok">bezahlt gebucht</span>` : ed ? `<button class="btn small" data-action="ek-sepa-book" data-id="${esc(r.id)}" title="Wenn die Bank den Auftrag ausgeführt hat">Als bezahlt buchen</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <p class="note">Die Überweisungsdatei (pain.001) im Business-Banking hochladen und dort freigeben. Bezahlt ist eine Rechnung erst mit der Zahlung: „Als bezahlt buchen“ oder im Reiter Bank-Ausgänge aus dem Kontoauszug zuordnen.${s.approval ? ' Freigabe vor dem Zahlen ist eingeschaltet.' : ''}</p>`
}

const shortIban = (iban) => (iban ? `${iban.slice(0, 4)} … ${iban.slice(-4)}` : '')
const LEVEL_CLASS = { sicher: 'ok', wahrscheinlich: 'info', unsicher: 'warning' }

function bankTab() {
  if (!sees('fakturierung')) return '<p class="empty">Der Kontoauszug wird in der Fakturierung (Reiter Bank) eingelesen. Dafür braucht es das Recht auf die Fakturierung.</p>'
  const d = E()
  const ed = editable()
  const list = debits()
  const withS = list.map((t) => ({ t, s: suggestDebit(t, d) }))
  const proposals = withS.filter((x) => x.s.level)
  const rest = withS.filter((x) => !x.s.level)
  const card = ({ t, s }) => `<article class="bank-card level-${s.level || 'kein'}"><div class="bank-head"><span class="bank-amount neg">${money(t.amount)}</span><span class="muted">${esc(day(t.date))}</span></div>
      <div class="bank-who"><strong>${esc(t.name || 'ohne Namen')}</strong>${t.iban ? ` <span class="muted">${esc(shortIban(t.iban))}</span>` : ''}</div><div class="bank-text">${esc([t.reference, t.text].filter(Boolean).join(' · ') || '–')}</div>
      <div class="bank-proposal">${s.level ? `<span class="pill ${LEVEL_CLASS[s.level]}">${esc(s.level)}</span> ${s.allocations.map((a) => `<button class="link-btn" data-action="ek-inv-open" data-id="${esc(a.invoiceId)}">${esc(invOf(a.invoiceId)?.no || '')}</button> ${esc(invOf(a.invoiceId)?.supplier?.name || '')} · ${money(a.amount)}`).join('<br>')}` : '<span class="pill">kein Vorschlag</span>'}<ul class="bank-why">${s.reasons.filter(Boolean).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>
      ${ed ? `<div class="bank-actions">${s.allocations.length ? `<button class="btn small primary" data-action="ek-bank-apply" data-id="${esc(t.id)}">Zuordnen</button>` : ''}<button class="btn small" data-action="ek-bank-assign-open" data-id="${esc(t.id)}">${s.allocations.length ? 'andere Rechnung' : 'Rechnung wählen'}</button><button class="btn small ghost" data-action="ek-bank-ignore" data-id="${esc(t.id)}" title="Keine Eingangsrechnung (Lohn, Steuer, Gebühren …)">ignorieren</button></div>` : ''}</article>`
  const done = d.invoices.flatMap((x) => (x.payments || []).filter((p) => p.bank && p.kind !== 'skonto').map((p) => ({ x, p }))).sort((a, b) => String(b.p.date).localeCompare(String(a.p.date)))
  return `<p class="muted">Abbuchungen und Überweisungen aus dem Kontoauszug, den die Fakturierung einliest (Reiter Bank). Hier werden sie Eingangsrechnungen zugeordnet; die Eingänge bleiben in der Fakturierung.</p>
    ${proposals.length ? `<h3>Mit Vorschlag</h3><div class="bank-list">${proposals.map(card).join('')}</div>` : `<p class="empty">${bankTx().length ? 'Keine Abbuchung passt zu einer offenen Eingangsrechnung.' : 'Noch kein Kontoauszug eingelesen (Fakturierung → Bank).'}</p>`}
    ${rest.length ? `<details class="bank-section"><summary>Ohne Vorschlag (${rest.length})</summary><div class="bank-list">${rest.slice(0, 40).map(card).join('')}</div></details>` : ''}
    ${done.length ? `<details class="bank-section"><summary>Zugeordnet (${done.length})</summary><div class="table-wrap"><table class="data"><thead><tr><th>Datum</th><th class="num">Betrag</th><th>Rechnung</th><th></th></tr></thead><tbody>${done.slice(0, 60).map(({ x, p }) => `<tr><td>${day(p.date)}</td><td class="num">${money(p.amount)}</td><td><button class="link-btn" data-action="ek-inv-open" data-id="${esc(x.id)}">${esc(x.no)}</button> ${esc(x.supplier?.name || '')}</td><td>${ed ? `<button class="btn small ghost" data-action="ek-bank-undo" data-id="${esc(p.bank)}">Lösen</button>` : ''}</td></tr>`).join('')}</tbody></table></div></details>` : ''}`
}

function suppliersTab() {
  const d = E()
  const ed = editable()
  const q = app.ui.ekSupSearch || ''
  const open = new Map()
  for (const x of payables(d.invoices, todayISO())) open.set(x.inv.supplierId, round2((open.get(x.inv.supplierId) || 0) + x.open))
  const material = sees('material') ? app.data.material?.suppliers || [] : []
  const matName = new Map(material.map((m) => [m.id, m.name]))
  const list = d.suppliers.filter((s) => supplierMatches(s, q)).sort((a, b) => supplierName(a).localeCompare(supplierName(b), 'de'))
  const rows = list
    .map((s) => `<tr class="clickable" data-action="ek-sup-open" data-id="${esc(s.id)}"><td>${esc(s.supplierNo || '')}</td><td><strong>${esc(supplierName(s) || '–')}</strong>${s.active === false ? ' <span class="pill">inaktiv</span>' : ''}${s.reverseCharge ? ' <span class="pill info">RC</span>' : ''}${s.materialId ? ` <span class="pill" title="verknüpft mit Material & Lager${matName.get(s.materialId) ? `: ${esc(matName.get(s.materialId))}` : ''}">Material</span>` : ''}</td>
      <td>${esc(s.city || '')}</td><td>${esc(s.uid || '')}</td><td>${s.iban ? esc(shortIban(s.iban)) : '<span class="muted">–</span>'}</td><td class="num">${open.get(s.id) ? money(open.get(s.id)) : ''}</td></tr>`)
    .join('')
  const links = material.length ? materialLinks(d.suppliers, material) : []
  return `<div class="filters"><label class="field inline"><span>Suche</span><input type="search" id="ek-sup-search" value="${esc(q)}" data-input="ek-sup-search" placeholder="Name, Ort, UID, IBAN …"></label><span class="spacer"></span>${ed ? `<button class="btn small" data-action="ek-sup-open">${ICON.plus} Lieferant</button>` : ''}</div>
    ${rows ? `<div class="table-wrap"><table class="data ek-sup-table"><thead><tr><th>Nr.</th><th>Lieferant</th><th>Ort</th><th>UID</th><th>IBAN</th><th class="num">offen</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">${d.suppliers.length ? 'Kein Lieferant passt zur Suche.' : 'Noch keine Lieferanten.'}</p>`}
    ${links.length ? `<h3>Lieferanten aus Material & Lager</h3><p class="muted">Bestellungen laufen über Material & Lager (dort sehen Lager und Objektleitung nur Name und Kontakt). Hier kommen Bankverbindung, UID und Zahlungsziel dazu. Übernehmen legt einen verknüpften Lieferanten an, nichts wird verschoben.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Material & Lager</th><th>Kontakt</th><th></th></tr></thead><tbody>${links
        .map((l) => `<tr><td><strong>${esc(l.material.name)}</strong>${l.material.customerNo ? `<br><span class="muted">Kundennr. ${esc(l.material.customerNo)}</span>` : ''}</td><td>${esc([l.material.contact, l.material.email, l.material.phone].filter(Boolean).join(' · ') || '–')}</td><td class="actions-cell">${ed ? (l.match ? `<button class="btn small" data-action="ek-sup-link" data-id="${esc(l.match.id)}" data-material="${esc(l.material.id)}">mit ${esc(supplierName(l.match))} verknüpfen</button>` : `<button class="btn small" data-action="ek-sup-from-material" data-material="${esc(l.material.id)}">übernehmen</button>`) : ''}</td></tr>`)
        .join('')}</tbody></table></div>${ed && links.some((l) => !l.match) ? `<p><button class="btn small" data-action="ek-sup-from-material" data-material="*">Alle ohne Gegenstück übernehmen</button></p>` : ''}` : ''}`
}

function settingsTab() {
  const s = PS()
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const fak = sees('fakturierung') ? invoicingSettings(app.data.fakturierung || {}) : null
  return `<h3>Kategorien und Aufwandskonten</h3>
    <p class="muted">Vorschlag nach dem österreichischen Einheitskontenrahmen. Bitte mit der Steuerberatung abstimmen (Kontenplan, Steuercodes).</p>
    <div class="table-wrap"><table class="data ek-cats"><thead><tr><th>Kategorie</th><th>Aufwandskonto</th><th>USt-Satz üblich</th><th></th></tr></thead><tbody>${s.categories
      .map((c, i) => `<tr><td><input type="text" id="ec-name-${i}" value="${esc(c.name)}" ${dis} aria-label="Kategorie"></td><td><input type="text" id="ec-acc-${i}" value="${esc(c.account || '')}" ${dis} style="width:6rem" aria-label="Aufwandskonto"></td><td><select id="ec-vat-${i}" ${dis} aria-label="USt-Satz">${options(VAT_RATES.map((v) => [String(v), `${v} %`]), String(c.vat ?? 20))}</select></td><td>${ed ? `<button class="btn small ghost" data-action="ek-cat-del" data-i="${i}" title="Entfernen">×</button>` : ''}</td></tr>`)
      .join('')}</tbody></table></div>
    ${ed ? '<p><button class="btn small" data-action="ek-cat-add">+ Kategorie</button></p>' : ''}
    <h3>Buchhaltung</h3>
    <div class="form-grid">
      <label class="field"><span>Kreditorenkonto (Sammelkonto)</span><input type="text" id="es-kreditor" value="${esc(s.accounts.kreditor)}" ${dis}></label>
      <label class="field"><span>Konto für Skontoerträge (leer: Aufwandskonto)</span><input type="text" id="es-skonto" value="${esc(s.accounts.skonto)}" ${dis}></label>
      <label class="check wide"><input type="checkbox" id="es-approval" ${s.approval ? 'checked' : ''} ${dis}><span>Freigabe vor dem Zahlen verlangen („geprüft von“)</span></label>
    </div>
    <h3>Eigenes Konto für Überweisungen</h3>
    <div class="form-grid">
      <label class="field"><span>Auftraggeber (Firma)</span><input type="text" id="es-dname" value="${esc(s.debtor.name)}" placeholder="${esc(fak?.sender.name || '')}" ${dis}></label>
      <label class="field"><span>IBAN</span><input type="text" id="es-diban" value="${esc(formatIban(s.debtor.iban))}" placeholder="${esc(fak ? formatIban(fak.bank.iban) : '')}" ${dis}></label>
      <label class="field"><span>BIC</span><input type="text" id="es-dbic" value="${esc(s.debtor.bic)}" placeholder="${esc(fak?.bank.bic || '')}" ${dis}></label>
    </div>
    <p class="muted">Leer: Firma und Bankverbindung aus den Einstellungen der Fakturierung.</p>
    ${ed ? '<p><button class="btn primary" data-action="ek-settings-save">Speichern</button></p>' : ''}`
}

// ---------------------------------------------------------------- Dialog: Eingangsrechnung

const RATES = [20, 13, 10, 0]

function blankDraft() {
  const today = todayISO()
  return { id: newId('er'), supplierId: '', number: '', date: today, serviceFrom: today, serviceTo: '', receivedAt: today, text: '', groups: [], category: '', account: '', objectId: '', costCenter: '', orderId: '', dueDate: '', dueAuto: true, note: '', checks: {}, reverseCharge: false }
}

/** Formular → Entwurf. */
function readForm(dr) {
  if (!document.getElementById('ei-date')) return dr
  const g = RATES.map((rate) => ({ rate, net: num(`ei-net-${rate}`), vat: num(`ei-vat-${rate}`) })).filter((x) => x.net || x.vat)
  Object.assign(dr, {
    supplierId: val('ei-supplier') || dr.supplierId,
    number: val('ei-number').trim(),
    date: val('ei-date'),
    serviceFrom: val('ei-sfrom'),
    serviceTo: val('ei-sto'),
    receivedAt: val('ei-received'),
    text: val('ei-text').trim(),
    category: val('ei-cat'),
    account: val('ei-account').trim(),
    objectId: val('ei-object'),
    costCenter: val('ei-cost').trim(),
    orderId: val('ei-order'),
    dueDate: val('ei-due'),
    reverseCharge: checked('ei-rc'),
    note: val('ei-note').trim(),
    groups: g,
    checks: { recipient: checked('ei-chk-rec'), ourUid: checked('ei-chk-uid'), rcNote: checked('ei-chk-rc') },
  })
  const pct = num('ei-sk-pct')
  dr.skonto = pct > 0 ? { percent: pct, days: Number(val('ei-sk-days')) || 0 } : null
  return dr
}

/** Vorgaben des Lieferanten (Kategorie, Konto, Zahlungsziel, Skonto, Reverse Charge). */
function applySupplier(dr, s, { force = false } = {}) {
  if (!s) return
  const cat = PS().categories.find((c) => c.id === s.category)
  if (force || !dr.category) dr.category = s.category || dr.category
  if (force || !dr.account) dr.account = s.expenseAccount || cat?.account || dr.account
  if (dr.dueAuto || force) dr.dueDate = dueFor(dr.date, s.paymentDays ?? 14)
  if ((force || !dr.skonto) && Number(s.skontoPercent) > 0) dr.skonto = { percent: Number(s.skontoPercent), days: Number(s.skontoDays) || 0 }
  if (force) dr.reverseCharge = !!s.reverseCharge
  dr.supplier = { name: supplierName(s), address: supplierAddress(s), uid: s.uid || '' }
}

function supplierOptions(selected) {
  const list = E().suppliers.filter((s) => s.active !== false || s.id === selected).sort((a, b) => supplierName(a).localeCompare(supplierName(b), 'de'))
  return options(list.map((s) => [s.id, `${supplierName(s)}${s.city ? `, ${s.city}` : ''}`]), selected, { empty: '– Lieferant wählen –' })
}

function orderOptions(dr) {
  if (!sees('material')) return ''
  const sup = supOf(dr.supplierId)
  const orders = (app.data.material?.orders || []).filter((o) => o.status !== 'entwurf' && o.status !== 'storniert' && (!sup?.materialId || o.supplierId === sup.materialId)).slice(-30).reverse()
  if (!orders.length && !dr.orderId) return ''
  return `<label class="field"><span>Bestellung (Material & Lager)</span><select id="ei-order">${options(orders.map((o) => [o.id, `${o.no || 'Bestellung'} vom ${day(String(o.orderedAt || o.createdAt || '').slice(0, 10))}`]), dr.orderId, { empty: '–' })}</select></label>`
}

function problemList(list) {
  const issues = list.filter((p) => p.level !== 'info')
  const infos = list.filter((p) => p.level === 'info')
  const head = issues.length ? `<ul class="ek-problems">${issues.map((p) => `<li class="${p.level === 'error' ? 'err-text' : 'warn-text'}">${esc(p.text)}</li>`).join('')}</ul>` : '<p class="ek-ok"><span class="pill ok">Angaben vollständig</span> Vorsteuerabzug nach § 12 UStG ohne Bedenken.</p>'
  return `${head}${infos.length ? `<p class="muted">${infos.map((p) => esc(p.text)).join(' ')}</p>` : ''}`
}

function invForm(dr, m) {
  const s = PS()
  const probs = invoiceProblems(dr, { suppliers: E().suppliers, invoices: E().invoices })
  const pending = PENDING.get(dr.id)
  const group = (rate) => dr.groups?.find((g) => Number(g.rate) === rate) || {}
  const newSup = m.newSupplier && !dr.supplierId
  // von der KI gelesene Felder: markiert, bis gespeichert ist
  const ki = (key) => (m.kixFields?.includes(key) ? ' kix-mark' : '')
  const kiTag = (key) => (m.kixFields?.includes(key) ? ' <span class="kix-tag">KI</span>' : '')
  const readKi = pending ? `<button type="button" class="btn kix-btn" data-action="kix-beleg">Aus Beleg lesen (KI)</button>` : `<label class="btn kix-btn">Aus Beleg lesen (KI)<input type="file" id="kix-beleg-file" accept="application/pdf,image/*" data-change="kix-beleg-file" hidden></label>`
  return `<div class="ek-beleg-bar">
      <label class="btn">${ICON.camera} Foto<input type="file" id="ei-photo" accept="image/*" capture="environment" data-change="ek-inv-file" hidden></label>
      <label class="btn">${ICON.upload} PDF oder Bild<input type="file" id="ei-file" accept="application/pdf,image/*" data-change="ek-inv-file" hidden></label>
      <label class="btn">E-Rechnung einlesen<input type="file" id="ei-einv" accept=".xml,.pdf,application/xml,text/xml,application/pdf" data-change="ek-inv-einv" hidden></label>
      ${kixButton(readKi)}
      <span class="muted small">${pending ? `Beleg bereit: ${esc(pending.name)} (wird beim Speichern abgelegt)` : dr.beleg ? `Beleg: ${esc(dr.beleg.name)}` : 'Beleg: Foto vom Handy, PDF, ZUGFeRD oder XRechnung'}</span></div>
    ${kixBox('beleg')}
    ${m.notes?.length ? `<ul class="ek-problems">${m.notes.map((x) => `<li class="muted">${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="form-grid">
      <label class="field wide${ki('supplier')}"><span>Lieferant${kiTag('supplier')}</span><select id="ei-supplier" data-change="ek-inv-supplier">${supplierOptions(dr.supplierId)}</select></label>
      ${newSup ? `<p class="wide info-text">Neuer Lieferant ${m.newSupplierFrom === 'ki' ? 'laut Beleg (von der KI gelesen)' : 'aus der E-Rechnung'}: <strong>${esc(m.newSupplier.name)}</strong>${m.newSupplier.uid ? `, UID ${esc(m.newSupplier.uid)}` : ''}${m.newSupplier.iban ? `, IBAN ${esc(formatIban(m.newSupplier.iban))}` : ''} – wird beim Speichern angelegt.</p>` : ''}
      <label class="field${ki('number')}"><span>Rechnungsnummer des Lieferanten${kiTag('number')}</span><input type="text" id="ei-number" value="${esc(dr.number)}" data-change="ek-inv-redraw"></label>
      <label class="field${ki('date')}"><span>Rechnungsdatum${kiTag('date')}</span><input type="date" id="ei-date" value="${esc(dr.date)}" data-change="ek-inv-redraw"></label>
      <label class="field${ki('serviceFrom')}"><span>Leistung von (Liefertag)${kiTag('serviceFrom')}</span><input type="date" id="ei-sfrom" value="${esc(dr.serviceFrom || '')}" data-change="ek-inv-redraw"></label>
      <label class="field${ki('serviceTo')}"><span>Leistung bis${kiTag('serviceTo')}</span><input type="date" id="ei-sto" value="${esc(dr.serviceTo || '')}"></label>
      <label class="field"><span>Eingangsdatum</span><input type="date" id="ei-received" value="${esc(dr.receivedAt || '')}"></label>
      <label class="field wide${ki('text')}"><span>Leistung (Menge und Bezeichnung)${kiTag('text')}</span><input type="text" id="ei-text" value="${esc(dr.text || '')}" placeholder="z. B. 20 Kanister Allzweckreiniger 10 l" data-change="ek-inv-redraw"></label>
    </div>
    <h4>Beträge${kiTag('groups')}</h4>
    <div class="ek-amounts${ki('groups')}"><div class="ek-amount-head"><span>USt-Satz</span><span>Netto</span><span>Vorsteuer</span></div>${RATES.map((rate) => {
      const g = group(rate)
      return `<div class="ek-amount-row"><span>${rate} %</span><input type="text" inputmode="decimal" id="ei-net-${rate}" value="${esc(numText(g.net))}" data-change="ek-inv-net" data-rate="${rate}" aria-label="Netto ${rate} %"><input type="text" inputmode="decimal" id="ei-vat-${rate}" value="${esc(numText(g.vat))}" data-change="ek-inv-redraw" aria-label="Vorsteuer ${rate} %" ${dr.reverseCharge || !rate ? 'disabled' : ''}></div>`
    }).join('')}
      <div class="ek-amount-row ek-gross"><span>Brutto</span><input type="text" inputmode="decimal" id="ei-gross" placeholder="aus Brutto rechnen" data-change="ek-inv-gross" aria-label="Brutto eingeben"><select id="ei-gross-rate" aria-label="Steuersatz für Brutto">${options(RATES.map((r) => [String(r), `${r} %`]), String(PS().categories.find((c) => c.id === dr.category)?.vat ?? 20))}</select></div>
      <p class="ek-sum" id="ei-sum" aria-live="polite">${sumHtml(dr)}</p></div>
    <label class="check${ki('reverseCharge')}"><input type="checkbox" id="ei-rc" ${dr.reverseCharge ? 'checked' : ''} data-change="ek-inv-redraw"><span>Reverse Charge (Steuerschuld geht auf uns über, § 19 Abs. 1a UStG – z. B. Subunternehmer Reinigung)</span></label>
    <div class="form-grid">
      <label class="field"><span>Kategorie</span><select id="ei-cat" data-change="ek-inv-cat">${options(s.categories.map((c) => [c.id, c.name]), dr.category, { empty: '–' })}</select></label>
      <label class="field"><span>Aufwandskonto</span><input type="text" id="ei-account" value="${esc(dr.account || '')}"></label>
      <label class="field"><span>Objekt (Kostenstelle)</span><select id="ei-object">${options((app.data.objects || []).map((o) => [o.id, o.name]), dr.objectId, { empty: '–' })}</select></label>
      <label class="field"><span>Kostenstelle (frei)</span><input type="text" id="ei-cost" value="${esc(dr.costCenter || '')}"></label>
      ${orderOptions(dr)}
      <label class="field${ki('dueDate')}"><span>Fällig am${kiTag('dueDate')}</span><input type="date" id="ei-due" value="${esc(dr.dueDate || '')}" data-change="ek-inv-due"></label>
      <label class="field${ki('skonto')}"><span>Skonto %${kiTag('skonto')}</span><input type="text" inputmode="decimal" id="ei-sk-pct" value="${esc(dr.skonto?.percent ? String(dr.skonto.percent).replace('.', ',') : '')}" placeholder="z. B. 2" data-change="ek-inv-redraw"></label>
      <label class="field"><span>Skonto bis (Tage ab Rechnungsdatum)</span><input type="number" min="0" id="ei-sk-days" value="${esc(dr.skonto?.days ?? '')}" data-change="ek-inv-redraw"></label>
    </div>
    <p class="muted" id="ei-skonto">${skontoHtml(dr)}</p>
    <h4>Prüfung (Vorsteuerabzug)</h4>
    <div class="ek-checks${ki('checks')}"><label class="check"><input type="checkbox" id="ei-chk-rec" ${dr.checks?.recipient ? 'checked' : ''} data-change="ek-inv-redraw"><span>Unser Firmenname und unsere Anschrift stehen auf der Rechnung</span></label>
      <label class="check"><input type="checkbox" id="ei-chk-uid" ${dr.checks?.ourUid ? 'checked' : ''} data-change="ek-inv-redraw"><span>Unsere UID steht auf der Rechnung (Pflicht über 10.000 € brutto und bei Reverse Charge)</span></label>
      ${dr.reverseCharge ? `<label class="check"><input type="checkbox" id="ei-chk-rc" ${dr.checks?.rcNote ? 'checked' : ''} data-change="ek-inv-redraw"><span>Hinweis auf den Übergang der Steuerschuld steht drauf</span></label>` : ''}</div>
    <div id="ei-probs" aria-live="polite">${problemList(probs)}</div>
    <label class="field wide"><span>Notiz</span><input type="text" id="ei-note" value="${esc(dr.note || '')}"></label>`
}

function invDetails(x) {
  const s = PS()
  const t = invoiceTotals(x)
  const ed = editable()
  const today = todayISO()
  const st = purchaseState(x, today)
  const probs = invoiceProblems(x, { suppliers: E().suppliers, invoices: E().invoices })
  const pays = (x.payments || [])
    .map((p) => `<li>${day(p.date)}: ${p.kind === 'skonto' ? 'Skontoabzug ' : ''}${money(p.amount)}${p.method === 'bar' ? ' · bar (Kassenbuch)' : p.bank ? ' · Bank' : p.method === 'sepa' ? ' · Überweisung' : ''}${p.note ? ` · ${esc(p.note)}` : ''}${ed && p.kind !== 'skonto' ? ` <button class="link-btn" data-action="ek-pay-del" data-id="${esc(x.id)}" data-pay="${esc(p.id)}">${app.ui.confirm === `ek-pdel:${p.id}` ? 'wirklich entfernen?' : 'entfernen'}</button>` : ''}</li>`)
    .join('')
  return `<div class="ek-detail">
      <p>${pill(st)}${x.approval ? ` <span class="pill ok">geprüft von ${esc(x.approval.by)}, ${day(String(x.approval.at).slice(0, 10))}</span>` : ''}${x.reverseCharge ? ' <span class="pill info">Reverse Charge</span>' : ''}${x.imported ? ` <span class="pill">übernommen aus ${esc(x.imported.system)}</span>` : ''} ${belegChip(x.beleg, 'ek-inv-beleg', { id: x.id })}</p>
      ${x.cancelled ? `<p class="err-text">Erfassung storniert am ${day(String(x.cancelled.at).slice(0, 10))} von ${esc(x.cancelled.by)}: ${esc(x.cancelled.reason || '')}</p>` : ''}
      <dl class="ek-dl"><dt>Lieferant</dt><dd>${esc(x.supplier?.name || '')}${x.supplier?.uid ? ` · UID ${esc(x.supplier.uid)}` : ''}</dd><dt>Rechnung</dt><dd>Nr. ${esc(x.number || '–')} vom ${day(x.date)}</dd><dt>Leistung</dt><dd>${esc(x.text || '–')}${x.serviceFrom ? ` (${day(x.serviceFrom)}${x.serviceTo && x.serviceTo !== x.serviceFrom ? ` – ${day(x.serviceTo)}` : ''})` : ''}</dd>
        <dt>Beträge</dt><dd>${t.groups.map((g) => `${g.rate} %: netto ${money(g.net)}, Vorsteuer ${money(x.reverseCharge ? round2((g.net * (g.rate || 20)) / 100) : g.vat)}`).join('<br>')}<br><strong>brutto ${money(t.gross)}</strong></dd>
        <dt>Kategorie</dt><dd>${esc(catName(x.category) || '–')}${x.account ? ` · Konto ${esc(x.account)}` : ''}${x.objectId ? ` · ${esc(objName(x.objectId))}` : ''}${x.costCenter ? ` · ${esc(x.costCenter)}` : ''}</dd>
        <dt>Fällig</dt><dd>${day(x.dueDate) || '–'}${skontoOfInvoice(x) ? ` · Skonto ${String(skontoOfInvoice(x).percent).replace('.', ',')} % bis ${day(skontoOfInvoice(x).until)}` : ''} · offen <strong>${money(openOf(x))}</strong></dd>${x.note ? `<dt>Notiz</dt><dd>${esc(x.note)}</dd>` : ''}</dl>
      ${problemList(probs)}
      ${orderBlock(x)}
      ${pays ? `<h4>Zahlungen</h4><ul class="ek-pays">${pays}</ul>` : ''}
      ${x.cancelled ? '' : rechargeBlock('einkauf', x.id)}
      ${ed && !x.cancelled ? `<div class="ek-beleg-bar"><label class="btn small">${ICON.camera} Foto<input type="file" accept="image/*" capture="environment" data-change="ek-inv-file" data-id="${esc(x.id)}" hidden></label><label class="btn small">${ICON.upload} ${x.beleg ? 'Beleg ersetzen' : 'Beleg ablegen'}<input type="file" accept="application/pdf,image/*,.xml" data-change="ek-inv-file" data-id="${esc(x.id)}" hidden></label></div>` : ''}
      ${ed && !x.cancelled && !(x.payments || []).length ? `<div class="ek-cancel"><label class="field"><span>Erfassung stornieren (Grund)</span><input type="text" id="ei-cancel-reason" placeholder="z. B. doppelt erfasst, falscher Lieferant"></label><button class="btn danger small" data-action="ek-inv-cancel" data-id="${esc(x.id)}">${app.ui.confirm === `ek-cancel:${x.id}` ? 'Wirklich stornieren?' : 'Stornieren'}</button></div>` : ''}
      ${(x.history || []).length ? `<details><summary>Verlauf</summary><ul class="muted">${x.history.map((h) => `<li>${day(String(h.at).slice(0, 10))} ${esc(h.by || '')}: ${esc(h.text)}</li>`).join('')}</ul></details>` : ''}
      ${s.approval && !x.approval && !x.cancelled ? '<p class="warn-text">Freigabe vor dem Zahlen ist eingeschaltet: erst nach „Geprüft und freigegeben“ in die Überweisungsdatei.</p>' : ''}
    </div>`
}

// Abgleich mit der Bestellung (Material & Lager): Bestellwert, Wareneingang, Rechnungen zur Bestellung, Abweichung;
// ohne Verknüpfung ein Vorschlag mit „Verknüpfen“ (core/purchase.js orderMatch, suggestOrder)
const materialOrders = () => app.data.material?.orders || []
function orderBlock(x) {
  const m = orderMatch(x, { orders: materialOrders(), invoices: E().invoices })
  const LV = { warn: 'warn-text', info: 'muted', ok: 'ok-text' }
  if (m) {
    const o = m.order
    const head = o ? `<p><strong>Bestellung ${esc(o.no || '')}</strong> ${m.level === 'ok' ? '<span class="pill ok">passt</span>' : m.level === 'warn' ? '<span class="pill warning">prüfen</span>' : '<span class="pill info">Hinweis</span>'}</p>
      <dl class="ek-dl"><dt>Bestellt</dt><dd>${money(m.ordered)}</dd><dt>Geliefert</dt><dd>${money(m.received)}</dd><dt>Rechnung${m.others.length ? 'en' : ''}</dt><dd>${money(m.invoiced + m.othersNet)}${m.others.length ? ` (diese ${money(m.invoiced)})` : ''}</dd><dt>Abweichung</dt><dd>${m.diff >= 0 ? '+' : '−'}${money(Math.abs(m.diff))}</dd></dl>` : ''
    return `<div class="ek-order-check"><h4>Abgleich mit der Bestellung</h4>${head}${m.notes.length ? `<ul>${m.notes.map((n) => `<li class="${LV[n.level] || ''}">${esc(n.text)}</li>`).join('')}</ul>` : ''}</div>`
  }
  if (!editable() || x.cancelled) return ''
  const sug = suggestOrder(x, { orders: materialOrders(), suppliers: E().suppliers, invoices: E().invoices })
  return sug ? `<p class="note ek-order-check">Passt zur Bestellung <strong>${esc(sug.order.no || '')}</strong> (${sug.order.status === 'bestellt' ? 'bestellt' : 'geliefert'} ${money(sug.value)}). <button class="btn small" data-action="ek-inv-order-link" data-id="${esc(x.id)}" data-order="${esc(sug.order.id)}">Verknüpfen</button></p>` : ''
}

function invModal(c, m) {
  const saved = m.id ? invOf(m.id) : null
  const ed = editable()
  if (m.id && !saved) return ''
  const editing = ed && (!saved || (invoiceEditable(saved) && m.edit))
  if (editing) {
    m.draft ||= saved ? structuredClone(saved) : blankDraft()
    const dr = m.draft
    return modalFrame({
      title: saved ? `Eingangsrechnung ${saved.no} bearbeiten` : 'Eingangsrechnung erfassen',
      subtitle: saved ? esc(saved.supplier?.name || '') : 'Beleg, Lieferant, Beträge, Prüfung',
      wide: true,
      body: invForm(dr, m),
      foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="ek-inv-save">Speichern</button></div>`,
    })
  }
  const x = saved
  return modalFrame({
    title: `Eingangsrechnung ${x.no}`,
    subtitle: `${esc(x.supplier?.name || '')} · Nr. ${esc(x.number || '–')}`,
    wide: true,
    body: invDetails(x),
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${
      ed && !x.cancelled
        ? `${invoiceEditable(x) ? `<button class="btn" data-action="ek-inv-edit" data-id="${esc(x.id)}">Bearbeiten</button>` : ''}${x.approval && !(x.payments || []).length ? `<button class="btn" data-action="ek-inv-unapprove" data-id="${esc(x.id)}">Freigabe zurücknehmen</button>` : ''}${!x.approval ? `<button class="btn ${app.ui.confirm === `ek-appr:${x.id}` ? 'danger confirm' : ''}" data-action="ek-inv-approve" data-id="${esc(x.id)}">${app.ui.confirm === `ek-appr:${x.id}` ? 'Trotz Abweichung freigeben?' : 'Geprüft und freigegeben'}</button>` : ''}${openOf(x) > 0.004 ? `<button class="btn primary" data-action="ek-pay-open" data-id="${esc(x.id)}">Zahlung</button>` : ''}`
        : ''
    }</div>`,
  })
}
registerModal('ek-inv', invModal, { module: MODULE })

// ---------------------------------------------------------------- Dialog: Zahlung

function payModal(c, m) {
  const x = invOf(m.id)
  if (!x) return ''
  const open = openOf(x)
  const today = todayISO()
  const sk = skontoAvailableOn(x, today)
  const cash = app.data.kasse?.entries?.length ? balanceAt(K()) : 0
  return modalFrame({
    title: `Zahlung ${x.no}`,
    subtitle: `${esc(x.supplier?.name || '')} · offen ${money(open)}`,
    body: `<div class="form-grid"><label class="field"><span>Datum</span><input type="date" id="ep-date" value="${today}"></label><label class="field"><span>Betrag (€)</span><input type="text" inputmode="decimal" id="ep-amount" value="${esc(numText(sk ? open - sk : open))}"></label>
        <label class="field"><span>Zahlungsart</span><select id="ep-method">${options([['bank', 'Überweisung'], ['lastschrift', 'Lastschrift / Einzug'], ['bar', 'bar aus der Kasse (Kassenbuch)']], 'bank')}</select></label>
        <label class="field wide"><span>Notiz</span><input type="text" id="ep-note" placeholder="z. B. Kontoauszug 11/2026"></label></div>
      ${sk ? `<div class="fak-skonto-hint"><p>Skonto bis ${day(skontoOfInvoice(x).until)}: ${money(sk)} – mit ${money(open - sk)} ist die Rechnung bezahlt (das Skonto wird vermerkt).</p><button class="btn small" data-action="ek-pay-skonto" data-amount="${round2(open - sk)}">Betrag mit Skonto</button></div>` : skontoOfInvoice(x) ? `<p class="muted">Die Skontofrist endete am ${day(skontoOfInvoice(x).until)}.</p>` : ''}
      <p class="muted">Bar aus der Kasse: Die Ausgabe kommt ins Kassenbuch (Kassenstand jetzt ${money(cash)}). Reicht das Bargeld nicht, wird nichts gebucht.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="ek-pay-save" data-id="${esc(x.id)}">Zahlung buchen</button></div>`,
  })
}
registerModal('ek-pay', payModal, { module: MODULE })

// ---------------------------------------------------------------- Dialog: Lieferant

function supModal(c, m) {
  const s = m.id ? supOf(m.id) : null
  const x = s || { country: 'AT', paymentDays: 14 }
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const material = sees('material') ? app.data.material?.suppliers || [] : []
  const linkedTo = material.find((mm) => mm.id === x.materialId)
  const free = material.filter((mm) => !E().suppliers.some((y) => y.materialId === mm.id && y.id !== x.id))
  const used = s ? E().invoices.filter((i) => i.supplierId === s.id).length : 0
  const f = (id, label, value, extra = '') => `<label class="field"><span>${label}</span><input type="text" id="${id}" value="${esc(value ?? '')}" ${dis} ${extra}></label>`
  return modalFrame({
    title: s ? supplierName(s) || 'Lieferant' : 'Lieferant anlegen',
    subtitle: s ? `Nr. ${esc(s.supplierNo || '')}` : '',
    wide: true,
    body: `<div class="form-grid">
        ${f('es-no', 'Lieferantennummer', x.supplierNo || nextSupplierNo(E().suppliers))}
        <label class="field wide"><span>Firma</span><input type="text" id="es-name" value="${esc(x.name || '')}" ${dis}></label>
        ${f('es-salutation', 'Anrede (Ansprechpartner)', x.salutation, 'placeholder="Frau, Herr"')}${f('es-title', 'Titel', x.title)}${f('es-first', 'Vorname', x.firstName)}${f('es-last', 'Nachname', x.lastName)}
        <label class="field wide"><span>Straße und Hausnummer</span><input type="text" id="es-street" value="${esc(x.street || '')}" ${dis}></label>
        ${f('es-zip', 'PLZ', x.zip, 'inputmode="numeric"')}${f('es-city', 'Ort', x.city)}
        <label class="field"><span>Land</span><select id="es-country" ${dis}>${options(Object.entries(COUNTRY_NAMES), x.country || 'AT')}</select></label>
        ${f('es-phone', 'Telefon', x.phone, 'type="tel"')}${f('es-mobile', 'Mobil', x.mobile, 'type="tel"')}${f('es-email', 'E-Mail', x.email, 'type="email"')}${f('es-web', 'Web', x.web)}
        ${f('es-uid', 'UID', x.uid, 'placeholder="ATU…"')}${f('es-taxno', 'Steuernummer', x.taxNo)}
        ${f('es-iban', 'IBAN', formatIban(x.iban || ''))}${f('es-bic', 'BIC', x.bic)}${f('es-bank', 'Bank', x.bank)}
        ${f('es-days', 'Zahlungsziel (Tage)', x.paymentDays ?? 14, 'inputmode="numeric"')}${f('es-skpct', 'Skonto %', x.skontoPercent ? String(x.skontoPercent).replace('.', ',') : '', 'inputmode="decimal"')}${f('es-skdays', 'Skonto Tage', x.skontoDays || '', 'inputmode="numeric"')}
        ${f('es-custno', 'Unsere Kundennummer beim Lieferanten', x.customerNo)}${f('es-account', 'Kreditorenkonto', x.account)}
        <label class="field"><span>Kategorie (Vorschlag)</span><select id="es-cat" ${dis}>${options(PS().categories.map((cc) => [cc.id, cc.name]), x.category || '', { empty: '–' })}</select></label>
        ${f('es-expense', 'Aufwandskonto (Vorschlag)', x.expenseAccount)}
        <label class="check wide"><input type="checkbox" id="es-rc" ${x.reverseCharge ? 'checked' : ''} ${dis}><span>Rechnet mit Reverse Charge ab (Subunternehmer, Bauleistungen § 19 Abs. 1a UStG)</span></label>
        <label class="check wide"><input type="checkbox" id="es-active" ${x.active === false ? '' : 'checked'} ${dis}><span>aktiv (in der Auswahl)</span></label>
        <label class="field wide"><span>Notiz</span><input type="text" id="es-note" value="${esc(x.note || '')}" ${dis}></label>
      </div>
      ${
        material.length || x.materialId
          ? `<h4>Material & Lager</h4>${
              linkedTo
                ? `<p>Verknüpft mit <strong>${esc(linkedTo.name)}</strong> (Bestellungen).</p>${ed && canEdit('material') ? '<label class="check"><input type="checkbox" id="es-sync"><span>Name und Kontaktdaten auch in Material & Lager aktualisieren</span></label>' : ''}`
                : `<label class="field"><span>Verknüpfen mit</span><select id="es-material" ${dis}>${options(free.map((mm) => [mm.id, mm.name]), x.materialId || '', { empty: '– nicht verknüpft –' })}</select></label>${ed && canEdit('material') && !s ? '<label class="check"><input type="checkbox" id="es-mat-new"><span>Auch in Material & Lager anlegen (für Bestellungen)</span></label>' : ''}`
            }`
          : ''
      }`,
    foot: `${ed && s && !used ? `<button class="btn danger" data-action="ek-sup-delete" data-id="${esc(s.id)}">${app.ui.confirm === `ek-sup-del:${s.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : '<span></span>'}<div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? `<button class="btn primary" data-action="ek-sup-save" data-id="${esc(s?.id || '')}">Speichern</button>` : ''}</div>`,
  })
}
registerModal('ek-sup', supModal, { module: MODULE })

// ---------------------------------------------------------------- Dialog: Überweisungsdatei

const nextWorkday = (iso) => {
  let d = addDays(iso, 1)
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1)
  return d
}

function debtorOf() {
  const s = PS()
  const fak = invoicingSettings(app.data.fakturierung || {})
  return { name: s.debtor.name || fak.sender.name || '', iban: s.debtor.iban || fak.bank.iban || '', bic: s.debtor.bic || fak.bank.bic || '' }
}

function sepaModal(c, m) {
  const date = m.date || nextWorkday(todayISO())
  const { payments, problems } = transferPayments(app.ui.ekSel || [], E(), date)
  const debtor = debtorOf()
  const sum = round2(payments.reduce((a, p) => a + p.amount, 0))
  const more = []
  if (!ibanValid(debtor.iban)) more.push('Eigenes Konto fehlt: unter Einstellungen „Eigenes Konto für Überweisungen“ oder in der Fakturierung eintragen.')
  for (const p of payments) if (!ibanValid(p.iban)) more.push(`${p.name}: IBAN fehlt oder ist ungültig (beim Lieferanten eintragen).`)
  return modalFrame({
    title: 'Überweisungsdatei (SEPA pain.001)',
    subtitle: `${plural(payments.length, 'Zahlung', 'Zahlungen')} · ${money(sum)}`,
    wide: true,
    body: `<div class="form-grid"><label class="field"><span>Ausführung am</span><input type="date" id="esp-date" value="${esc(date)}" data-change="ek-sepa-date"></label><label class="field"><span>Format</span><select id="esp-version">${options([['09', 'pain.001.001.09 (aktuell)'], ['03', 'pain.001.001.03 (ältere Banken)']], '09')}</select></label></div>
      <p class="muted">Von: ${esc(debtor.name || '–')} · ${esc(formatIban(debtor.iban) || 'ohne IBAN')}</p>
      ${payments.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Empfänger</th><th>IBAN</th><th>Verwendungszweck</th><th class="num">Betrag</th></tr></thead><tbody>${payments.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(formatIban(p.iban)) || '<span class="err-text">fehlt</span>'}</td><td>${esc(p.text)}</td><td class="num">${money(p.amount)}${p.skonto ? `<br><span class="muted">Skonto ${money(p.skonto)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${[...problems, ...more].length ? `<ul class="ek-problems">${[...problems, ...more].map((t) => `<li class="err-text">${esc(t)}</li>`).join('')}</ul>` : ''}
      <p class="muted">Skonto zählt, wenn die Frist am Ausführungstag noch läuft. Die Datei im Business-Banking hochladen und dort freigeben; danach „Als bezahlt buchen“ oder den Kontoauszug zuordnen.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="ek-sepa-create" ${payments.length && !more.length ? '' : 'disabled'}>${ICON.download} Datei erzeugen</button></div>`,
  })
}
registerModal('ek-sepa', sepaModal, { module: MODULE })

// ---------------------------------------------------------------- Dialog: Abbuchung zuordnen

function assignModal(c, m) {
  const t = bankTx().find((x) => x.id === m.id)
  if (!t) return ''
  const q = String(m.q || '').toLowerCase()
  const list = payables(E().invoices, todayISO()).filter((x) => !q || [x.inv.no, x.inv.number, x.inv.supplier?.name].some((v) => String(v || '').toLowerCase().includes(q)))
  return modalFrame({
    title: 'Abbuchung zuordnen',
    subtitle: `${money(t.amount)} am ${day(t.date)} · ${esc(t.name || '')}`,
    body: `<p class="muted">${esc([t.reference, t.text].filter(Boolean).join(' · '))}</p>
      <label class="field"><span>Suche</span><input type="search" id="eba-q" value="${esc(m.q || '')}" data-input="ek-bank-q" placeholder="Lieferant, Nummer"></label>
      <div class="table-wrap"><table class="data"><thead><tr><th></th><th>Rechnung</th><th class="num">offen</th><th class="num">Betrag</th></tr></thead><tbody>${list
        .slice(0, 40)
        .map((x) => `<tr><td><input type="checkbox" name="eba" value="${esc(x.inv.id)}" aria-label="auswählen"></td><td>${esc(x.inv.no)} ${esc(x.inv.supplier?.name || '')}<br><span class="muted">Nr. ${esc(x.inv.number || '–')}</span></td><td class="num">${money(x.open)}</td><td class="num"><input type="text" inputmode="decimal" id="eba-amt-${esc(x.inv.id)}" value="${esc(numText(x.skonto && sameDayOk(x, t) ? x.skonto.payable : x.open))}" style="width:7rem" aria-label="Betrag"></td></tr>`)
        .join('')}</tbody></table></div>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="ek-bank-assign-save" data-id="${esc(t.id)}">Zuordnen</button></div>`,
  })
}
const sameDayOk = (x, t) => x.skonto && t.date <= x.skonto.until
registerModal('ek-bank-assign', assignModal, { module: MODULE })

// ---------------------------------------------------------------- Dialog: Export

function exportModal() {
  const today = todayISO()
  return modalFrame({
    title: 'Export für die Steuerberatung',
    subtitle: 'Eingangsrechnungen als CSV (BMD, RZL u. a.)',
    body: `<div class="form-grid"><label class="field"><span>von</span><input type="date" id="ex-from" value="${esc(app.ui.ekExFrom || `${addDays(firstOfMonth(today), -1).slice(0, 8)}01`)}"></label><label class="field"><span>bis</span><input type="date" id="ex-to" value="${esc(app.ui.ekExTo || addDays(firstOfMonth(today), -1))}"></label></div>
      <p class="muted">Eine Zeile je Eingangsrechnung und Steuersatz (Belegart ER) mit Eingangsnummer, Rechnungsdatum, Kreditor, Aufwandskonto, Lieferant, UID, Rechnungsnummer, Steuersatz, Steuercode (RC19-1a bei Reverse Charge), Netto, Vorsteuer, Brutto; dazu Skontoabzüge mit Zahlungsdatum (Belegart SK, negativ: Vorsteuer berichtigen). Strichpunkt, Dezimalkomma – wie der Export der Fakturierung. Das Kassenbuch hat einen eigenen Export.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn" data-action="mail-export" data-of="ek-export" data-subject="Eingangsrechnungen" title="Als Anhang per E-Mail senden">${ICON.send} Per E-Mail</button><button class="btn primary" data-action="ek-export">${ICON.download} CSV herunterladen</button></div>`,
  })
}
registerModal('ek-export', exportModal, { module: MODULE })

// ---------------------------------------------------------------- Aktionen

function saveSupplierFrom(raw, { materialId = '' } = {}) {
  const d = E()
  const s = { id: newId('ls'), supplierNo: nextSupplierNo(d.suppliers), country: 'AT', active: true, createdAt: nowIso(), ...raw, ...(materialId ? { materialId } : {}) }
  s.contacts = (s.contacts || []).map((p, i) => ({ id: `${s.id}-k${i + 1}`, ...p }))
  d.suppliers.push(s)
  return s
}

async function readEInvoice(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const xml = await eInvoiceFromPdf(bytes, inflate).catch(() => null)
    return xml ? parseEInvoice(xml) : null
  }
  return parseEInvoice(new TextDecoder('utf-8').decode(bytes))
}

/** Gelesene E-Rechnung in den Entwurf (Kategorie, Konto, Objekt, Eingang bleiben, wenn schon gewählt). */
function applyEInvoice(m, e, file) {
  const r = draftFromEInvoice(e, { suppliers: E().suppliers })
  const keep = { id: m.draft.id, category: m.draft.category, account: m.draft.account, objectId: m.draft.objectId, costCenter: m.draft.costCenter, receivedAt: m.draft.receivedAt }
  m.draft = { ...m.draft, ...r.draft, ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v)), dueAuto: !r.draft.dueDate, kiRead: false }
  if (r.supplier) applySupplier(m.draft, r.supplier)
  if (r.draft.dueDate) m.draft.dueDate = r.draft.dueDate
  m.newSupplier = r.newSupplier
  m.newSupplierFrom = 'einvoice'
  m.kixFields = []
  m.notes = [`E-Rechnung (${e.format === 'UBL' ? 'XRechnung/UBL' : 'ZUGFeRD/CII'}) gelesen: Felder vorbelegt, bitte prüfen.`, ...r.notes]
  PENDING.set(m.draft.id, file)
}

/**
 * Vorschlag der KI (core/ki-vorschlag.js → checkBeleg) in den Entwurf: nur gelesene Felder, Lieferant über UID, IBAN
 * oder Namen zugeordnet bzw. neu vorgeschlagen; markiert „von der KI gelesen – bitte prüfen“. Gespeichert wird erst
 * mit „Speichern“.
 */
function applyKiBeleg(m, res) {
  const f = res.fields
  const dr = m.draft
  const filled = []
  const set = (key, value) => {
    if (value === '' || value === undefined || value === null) return
    dr[key] = value
    filled.push(key)
  }
  set('number', f.number)
  set('date', f.date)
  set('serviceFrom', f.serviceFrom)
  set('serviceTo', f.serviceTo)
  set('text', f.text)
  if (f.groups.length) set('groups', f.groups)
  if (f.reverseCharge || dr.reverseCharge) set('reverseCharge', f.reverseCharge)
  if (f.skonto) set('skonto', f.skonto)
  dr.checks = { ...dr.checks, recipient: dr.checks?.recipient || f.checks.recipient, ourUid: dr.checks?.ourUid || f.checks.ourUid, rcNote: dr.checks?.rcNote || f.checks.rcNote }
  if (f.checks.recipient || f.checks.ourUid || f.checks.rcNote) filled.push('checks')
  const match = matchSupplierKi(E().suppliers, res.supplier)
  if (match.supplier) {
    dr.supplierId = match.supplier.id
    applySupplier(dr, match.supplier)
    m.newSupplier = null
    filled.push('supplier')
  } else if (match.newSupplier) {
    dr.supplierId = ''
    dr.supplier = { name: match.newSupplier.name, address: supplierAddress(match.newSupplier), uid: match.newSupplier.uid || '' }
    m.newSupplier = match.newSupplier
    m.newSupplierFrom = 'ki'
  }
  if (f.dueDate) {
    set('dueDate', f.dueDate)
    dr.dueAuto = false
  } else if (dr.dueAuto) dr.dueDate = dueFor(dr.date, (match.supplier?.paymentDays ?? 14))
  dr.kiRead = true
  dr.einvoice = undefined
  m.kixFields = filled
  m.notes = []
  const via = { uid: 'über die UID', iban: 'über die IBAN', name: 'über den Namen' }[match.via]
  const items = [
    ...(match.supplier ? [{ level: 'info', text: `Lieferant „${supplierName(match.supplier)}“ ${via} zugeordnet.` }] : match.newSupplier ? [{ level: 'info', text: `Lieferant „${match.newSupplier.name}“ ist neu und wird beim Speichern angelegt.` }] : []),
    ...match.warnings.map((text) => ({ level: 'warning', text })),
    ...res.problems,
  ]
  kixSet('beleg', { notice: { title: 'Von der KI gelesen – bitte prüfen. Gespeichert wird erst mit „Speichern“.', items } })
}

registerActions({
  'ek-tab': (el) => {
    app.ui.ekTab = el.dataset.v
    renderNow()
  },
  'ek-year': (el) => {
    app.ui.ekYear = el.value
    renderNow()
  },
  'ek-state': (el) => {
    app.ui.ekState = el.value
    renderNow()
  },
  'ek-search': (el) => {
    app.ui.ekSearch = el.value
    renderNow()
    document.getElementById('ek-search')?.focus()
  },
  'ek-sup-search': (el) => {
    app.ui.ekSupSearch = el.value
    renderNow()
    document.getElementById('ek-sup-search')?.focus()
  },
  'ek-inv-open': (el) => openModal({ type: 'ek-inv', id: el.dataset.id }),
  'ek-sup-open': (el) => openModal({ type: 'ek-sup', id: el.dataset.id || '' }),
  'ek-export-open': () => openModal({ type: 'ek-export' }),
  'ek-inv-beleg': (el) => openBeleg(invOf(el.dataset.id)?.beleg),
  'ek-bank-q': (el) => {
    app.ui.modal.q = el.value
    renderModal()
    const input = document.getElementById('eba-q')
    input?.focus()
    input?.setSelectionRange(el.value.length, el.value.length)
  },
  'ek-sepa-date': (el) => {
    app.ui.modal.date = el.value
    renderModal()
  },
  'ek-export': () => {
    const from = val('ex-from')
    const to = val('ex-to')
    if (!from || !to || to < from) return toast('Bitte einen gültigen Zeitraum wählen.')
    app.ui.ekExFrom = from
    app.ui.ekExTo = to
    const rows = purchaseExportRows(E(), { from, to, objectsById: new Map((app.data.objects || []).map((o) => [o.id, o])) })
    if (!rows.length) return toast('Keine Eingangsrechnungen in diesem Zeitraum.')
    download(`Eingangsrechnungen_${from}_${to}.csv`, new Blob([`﻿${purchaseCsv(rows)}`], { type: 'text/csv;charset=utf-8' }))
    closeModal()
    toast(`${plural(new Set(rows.map((r) => r.number)).size, 'Eingangsrechnung', 'Eingangsrechnungen')} exportiert.`)
  },
})

registerActions(
  {
    'ek-inv-new': () => openModal({ type: 'ek-inv', draft: blankDraft() }),
    'ek-inv-edit': (el) => {
      app.ui.modal = { ...app.ui.modal, edit: true, draft: structuredClone(invOf(el.dataset.id)) }
      renderModal()
    },
    // Textfelder: nur Summen, Skonto und Prüfung neu (die Felder bleiben, nichts Getipptes geht verloren);
    // Kästchen (Reverse Charge, Prüfung): ganzer Dialog, der Fokus bleibt
    'ek-inv-redraw': (el) => {
      const m = app.ui.modal
      if (!m?.draft) return
      const before = m.draft.date
      readForm(m.draft)
      if (m.draft.dueAuto && m.draft.date !== before) setField('ei-due', (m.draft.dueDate = dueFor(m.draft.date, supOf(m.draft.supplierId)?.paymentDays ?? 14)))
      if (el?.type === 'checkbox') rerender()
      else live()
    },
    'ek-inv-due': () => {
      const m = app.ui.modal
      readForm(m.draft)
      m.draft.dueAuto = false
      live()
    },
    'ek-inv-net': (el) => {
      const rate = Number(el.dataset.rate)
      if (!app.ui.modal.draft.reverseCharge) setField(`ei-vat-${rate}`, rate ? numText(vatFor(el.value, rate)) : '')
      readForm(app.ui.modal.draft)
      live()
    },
    'ek-inv-gross': () => {
      const m = app.ui.modal
      const rate = Number(val('ei-gross-rate'))
      const rc = checked('ei-rc')
      const g = splitGross(val('ei-gross'), rc ? 0 : rate)
      if (!(g.gross > 0)) return
      setField(`ei-net-${rate}`, numText(rc ? g.gross : g.net))
      setField(`ei-vat-${rate}`, rc || !rate ? '' : numText(g.vat))
      readForm(m.draft)
      live()
    },
    'ek-inv-cat': () => {
      const m = app.ui.modal
      readForm(m.draft)
      const cat = PS().categories.find((x) => x.id === m.draft.category)
      if (cat?.account) setField('ei-account', (m.draft.account = cat.account))
      live()
    },
    'ek-inv-supplier': () => {
      const m = app.ui.modal
      readForm(m.draft)
      applySupplier(m.draft, supOf(m.draft.supplierId), { force: true })
      rerender()
    },
    'ek-inv-file': async (el) => {
      const file = el.files?.[0]
      if (!file) return
      const id = el.dataset.id
      if (!id) {
        // neue Erfassung: Datei merken, abgelegt wird beim Speichern (dann steht die Eingangsnummer fest)
        readForm(app.ui.modal.draft)
        PENDING.set(app.ui.modal.draft.id, file)
        renderModal()
        return
      }
      const x = invOf(id)
      const beleg = await storeBeleg(file, (ext) => belegPath(x, ext))
      if (!beleg) return
      x.beleg = beleg
      x.history = [...(x.history || []), { at: nowIso(), by: by(), text: `Beleg abgelegt (${file.name})` }]
      persist()
      renderModal()
      toast(beleg.local ? 'Beleg angehängt (Browser-Modus: nur Vorschau, nicht gespeichert).' : 'Beleg in SharePoint abgelegt.')
    },
    'ek-inv-einv': async (el) => {
      const file = el.files?.[0]
      if (!file) return
      const m = app.ui.modal
      readForm(m.draft)
      let e = null
      try {
        e = await readEInvoice(file)
      } catch (err) {
        return toast(`Keine lesbare E-Rechnung: ${err.message}`)
      }
      if (!e) {
        PENDING.set(m.draft.id, file)
        renderModal()
        return toast('Im PDF steckt keine E-Rechnung (ZUGFeRD). Es ist als Beleg angehängt; bitte die Felder ausfüllen.')
      }
      applyEInvoice(m, e, file)
      renderModal()
    },
    // Aus Beleg lesen (KI): Datei wählen (wird auch der Beleg), dann lesen
    'kix-beleg-file': (el) => {
      const file = el.files?.[0]
      const m = app.ui.modal
      if (!file || !m?.draft) return
      readForm(m.draft)
      PENDING.set(m.draft.id, file)
      renderModal()
      return ACTIONS['kix-beleg']?.({ dataset: {} })
    },
    'kix-beleg': async (el) => {
      const m = app.ui.modal
      if (m?.type !== 'ek-inv' || !m.draft || m.kix?.beleg?.busy) return
      readForm(m.draft)
      const file = PENDING.get(m.draft.id)
      if (!file) return toast('Bitte zuerst den Beleg wählen (Foto oder PDF).')
      // 1. E-Rechnung im PDF (ZUGFeRD/Factur-X) oder als XML: genauer als jede KI und ohne Übertragung
      if (/pdf|xml/i.test(file.type) || /\.(pdf|xml)$/i.test(file.name || '')) {
        const e = await readEInvoice(file).catch(() => null)
        if (e) {
          applyEInvoice(m, e, file)
          kixSet('beleg', {})
          renderModal()
          return toast('Im PDF steckt eine E-Rechnung: Felder ohne KI ausgefüllt. Bitte prüfen.')
        }
      }
      // 2. KI (nach dem Hinweis, einmal je Gerät)
      if (!el?.dataset?.consent && !kixConsent('beleg', 'Der Beleg (Foto oder PDF)', { action: 'kix-beleg' })) return
      const draftId = m.draft.id
      kixSet('beleg', { busy: 'Die KI liest den Beleg …' })
      try {
        const prepared = await kixFile(file)
        const { readBeleg } = await import('../../ai/extract.js')
        const res = await readBeleg(prepared, { ours: kixOurs(), today: todayISO() })
        if (app.ui.modal !== m || m.draft?.id !== draftId) return
        applyKiBeleg(m, res)
        renderModal()
        toast(res.ok ? 'Von der KI gelesen – bitte jedes Feld mit dem Beleg vergleichen und dann speichern.' : 'Von der KI gelesen, aber mit Unstimmigkeiten – bitte die Hinweise prüfen.')
      } catch (err) {
        if (app.ui.modal === m) kixSet('beleg', { error: kixFailed(err) })
      }
    },
    'ek-inv-save': async () => {
      const m = app.ui.modal
      const d = E()
      const dr = readForm(m.draft)
      if (!dr.supplierId && m.newSupplier) {
        const s = saveSupplierFrom(m.newSupplier)
        dr.supplierId = s.id
        m.newSupplier = null
      }
      const sup = supOf(dr.supplierId)
      if (sup) dr.supplier = { name: supplierName(sup), address: supplierAddress(sup), uid: sup.uid || '' }
      const probs = invoiceProblems(dr, { suppliers: d.suppliers, invoices: d.invoices })
      const err = probs.find((p) => p.level === 'error')
      if (err) {
        renderModal()
        return toast(err.text)
      }
      const isNew = !d.invoices.some((x) => x.id === dr.id)
      const { dueAuto, kiRead, ...inv } = dr
      if (isNew) {
        inv.no = nextInvoiceNo(d.invoices, String(inv.date || todayISO()).slice(0, 4), PS())
        inv.createdAt = nowIso()
        inv.createdBy = by()
        inv.payments = []
        inv.history = [{ at: nowIso(), by: by(), text: `erfasst${inv.einvoice ? ` aus E-Rechnung (${inv.einvoice.format})` : kiRead ? ' mit Vorschlag der KI aus dem Beleg (geprüft und gespeichert)' : ''}` }]
      } else inv.history = [...(inv.history || []), { at: nowIso(), by: by(), text: 'geändert' }]
      if (!inv.skonto) delete inv.skonto
      const file = PENDING.get(dr.id)
      if (file) {
        const beleg = await storeBeleg(file, (ext) => belegPath(inv, ext, sup))
        if (beleg) inv.beleg = beleg
        PENDING.delete(dr.id)
      }
      if (isNew) d.invoices.push(inv)
      else d.invoices = d.invoices.map((x) => (x.id === inv.id ? inv : x))
      const warn = probs.filter((p) => p.code.startsWith('vst')).length
      closeModal()
      commit(`${inv.no} gespeichert${warn ? ` – ${plural(warn, 'Angabe', 'Angaben')} für den Vorsteuerabzug prüfen` : ''}${inv.beleg ? '' : ' (ohne Beleg)'}.`)
    },
    'ek-inv-approve': (el) => {
      const x = invOf(el.dataset.id)
      const err = invoiceProblems(x, { suppliers: E().suppliers, invoices: E().invoices }).find((p) => p.level === 'error')
      if (err) return toast(err.text)
      // Abweichung zur Bestellung: erst beim zweiten Klick freigeben
      const om = orderMatch(x, { orders: materialOrders(), invoices: E().invoices })
      if (om?.level === 'warn' && !confirmStep(`ek-appr:${x.id}`, renderModal)) return toast(`Abweichung zur Bestellung: ${om.notes.find((n) => n.level === 'warn')?.text || ''} Nochmals „Geprüft und freigegeben“, um trotzdem freizugeben.`)
      x.approval = { by: by(), at: nowIso() }
      x.history = [...(x.history || []), { at: nowIso(), by: by(), text: 'geprüft und freigegeben' }]
      persist()
      renderModal()
      renderNow()
      toast(`${x.no} freigegeben.`)
    },
    'ek-inv-order-link': (el) => {
      const x = invOf(el.dataset.id)
      const o = materialOrders().find((y) => y.id === el.dataset.order)
      if (!x || !o) return
      x.orderId = o.id
      x.history = [...(x.history || []), { at: nowIso(), by: by(), text: `mit Bestellung ${o.no || o.id} verknüpft` }]
      persist()
      renderModal()
      renderNow()
      toast(`Mit Bestellung ${o.no || ''} verknüpft.`)
    },
    'ek-inv-unapprove': (el) => {
      const x = invOf(el.dataset.id)
      delete x.approval
      x.history = [...(x.history || []), { at: nowIso(), by: by(), text: 'Freigabe zurückgenommen' }]
      persist()
      renderModal()
    },
    'ek-inv-cancel': (el) => {
      const x = invOf(el.dataset.id)
      const reason = val('ei-cancel-reason').trim()
      if (!reason) return toast('Bitte den Grund angeben.')
      if ((x.payments || []).length) return toast('Erst die Zahlungen entfernen.')
      if (rechargeLock('einkauf', x.id)) return toast(rechargeLock('einkauf', x.id))
      if (!confirmStep(`ek-cancel:${x.id}`, () => {
        renderModal()
        const r = document.getElementById('ei-cancel-reason')
        if (r) r.value = reason
      }))
        return
      x.cancelled = { at: nowIso(), by: by(), reason }
      x.history = [...(x.history || []), { at: nowIso(), by: by(), text: `Erfassung storniert: ${reason}` }]
      closeModal()
      commit(`${x.no} storniert (bleibt sichtbar, zählt nicht mehr).`)
    },
    'ek-pay-open': (el) => openModal({ type: 'ek-pay', id: el.dataset.id }),
    'ek-pay-skonto': (el) => {
      const input = document.getElementById('ep-amount')
      if (input) input.value = numText(Number(el.dataset.amount))
    },
    'ek-pay-save': (el) => {
      const x = invOf(el.dataset.id)
      const amount = round2(num('ep-amount'))
      const date = val('ep-date') || todayISO()
      const method = val('ep-method') || 'bank'
      if (!x || !(amount > 0)) return toast('Bitte einen Betrag eintragen.')
      if (needsApproval(x, PS())) return toast('Zuerst prüfen und freigeben (Freigabe vor dem Zahlen ist eingeschaltet).')
      const pay = { id: newId('zp'), date, amount, method, note: val('ep-note').trim(), by: by(), at: nowIso() }
      if (method === 'bar') {
        try {
          const entry = cashForPayment({ kind: 'ausgabe', date, amount, text: `Zahlung ${x.supplier?.name || ''} Rechnung ${x.number || x.no}`.trim(), ref: { type: 'eingang', id: x.id, number: x.no }, account: supOf(x.supplierId)?.account || PS().accounts.kreditor })
          pay.cash = entry.id
          pay.note = pay.note || `bar, Kassenbuch Nr. ${entry.no}`
        } catch (err) {
          return toast(err.message)
        }
      }
      const entries = purchasePaymentEntries(x, pay, { newId: () => newId('zp') })
      x.payments = [...(x.payments || []), ...entries]
      x.history = [...(x.history || []), { at: nowIso(), by: by(), text: `Zahlung ${money(amount)} (${method === 'bar' ? 'bar' : method === 'lastschrift' ? 'Lastschrift' : 'Überweisung'})${entries[1] ? `, Skonto ${money(entries[1].amount)}` : ''}` }]
      closeModal()
      const open = openOf(x)
      commit(open <= 0.004 ? `${x.no} ist bezahlt${entries[1] ? ` (Skonto ${money(entries[1].amount)})` : ''}.` : `Zahlung gebucht, offen ${money(open)}.`)
    },
    'ek-pay-del': (el) => {
      const x = invOf(el.dataset.id)
      const p = (x.payments || []).find((y) => y.id === el.dataset.pay)
      if (!p) return
      if (p.cash) return toast('Barzahlung: bitte im Kassenbuch stornieren (dann verschwindet sie hier).')
      if (p.bank) return toast('Aus dem Kontoauszug zugeordnet: im Reiter Bank-Ausgänge „Lösen“.')
      if (!confirmStep(`ek-pdel:${p.id}`, renderModal)) return
      removePayment(x, (y) => y.id === p.id, { by: by(), at: nowIso() })
      persist()
      renderModal()
      renderNow()
    },
    'ek-sel': (el) => {
      const set = new Set(app.ui.ekSel || [])
      if (el.checked) set.add(el.dataset.id)
      else set.delete(el.dataset.id)
      app.ui.ekSel = [...set]
      renderNow()
    },
    'ek-sel-all': () => {
      const s = PS()
      app.ui.ekSel = (app.ui.ekSel || []).length ? [] : duePayables(E().invoices, todayISO(), 7).filter((x) => !needsApproval(x.inv, s)).map((x) => x.inv.id)
      renderNow()
    },
    'ek-sepa-open': () => {
      if (!(app.ui.ekSel || []).length) return toast('Bitte zuerst Rechnungen auswählen.')
      openModal({ type: 'ek-sepa' })
    },
    'ek-sepa-create': () => {
      const date = val('esp-date')
      const version = val('esp-version') || '09'
      const d = E()
      const { payments } = transferPayments(app.ui.ekSel || [], d, date)
      const at = nowIso()
      const msgId = `EK-${at.replace(/\D/g, '').slice(0, 14)}`
      let r
      try {
        r = sepaTransfer({ debtor: debtorOf(), payments, date, msgId, createdAt: new Date(at), version })
      } catch (err) {
        return toast(err.message)
      }
      const name = sepaFileName(date, msgId)
      download(name, new Blob([r.xml], { type: 'application/xml' }))
      markTransferRun(d, { id: newId('ue'), at, by: by(), msgId, date, name, version, invoiceIds: payments.map((p) => p.invoiceId), sum: r.sum, count: r.count }, payments)
      app.ui.ekSel = []
      closeModal()
      commit(`Überweisungsdatei mit ${plural(r.count, 'Zahlung', 'Zahlungen')} (${money(r.sum)}) erzeugt. Im Business-Banking hochladen und freigeben.`)
    },
    'ek-sepa-book': (el) => {
      if (!confirmStep(`ek-sepa-book:${el.dataset.id}`)) return
      const n = bookTransferRun(E(), el.dataset.id, { by: by(), at: nowIso(), newId: () => newId('zp') })
      commit(`${plural(n, 'Rechnung', 'Rechnungen')} als bezahlt gebucht.`)
    },
    'ek-bank-apply': (el) => {
      const t = bankTx().find((x) => x.id === el.dataset.id)
      const s = suggestDebit(t, E())
      try {
        applyDebit(t, s.allocations, E().invoices, { by: by(), at: nowIso(), newId: () => newId('zp') })
      } catch (err) {
        return toast(err.message)
      }
      commit('Abbuchung zugeordnet.')
    },
    'ek-bank-assign-open': (el) => openModal({ type: 'ek-bank-assign', id: el.dataset.id }),
    'ek-bank-assign-save': (el) => {
      const t = bankTx().find((x) => x.id === el.dataset.id)
      const ids = [...document.querySelectorAll('input[name="eba"]:checked')].map((x) => x.value)
      const allocations = ids.map((id) => ({ invoiceId: id, amount: num(`eba-amt-${id}`) }))
      try {
        applyDebit(t, allocations, E().invoices, { by: by(), at: nowIso(), newId: () => newId('zp') })
      } catch (err) {
        return toast(err.message)
      }
      closeModal()
      commit('Abbuchung zugeordnet.')
    },
    'ek-bank-ignore': (el) => {
      E().bankIgnored[el.dataset.id] = { by: by(), at: nowIso() }
      commit('Abbuchung ausgeblendet (keine Eingangsrechnung).')
    },
    'ek-bank-undo': (el) => {
      if (!confirmStep(`ek-bank-undo:${el.dataset.id}`)) return
      undoDebit(el.dataset.id, E().invoices, { by: by(), at: nowIso() })
      commit('Zuordnung gelöst.')
    },
    'ek-sup-save': (el) => {
      const d = E()
      const name = val('es-name').trim()
      const iban = val('es-iban').replace(/\s+/g, '').toUpperCase()
      const fields = {
        supplierNo: val('es-no').trim(),
        name,
        salutation: val('es-salutation').trim(),
        title: val('es-title').trim(),
        firstName: val('es-first').trim(),
        lastName: val('es-last').trim(),
        street: val('es-street').trim(),
        zip: val('es-zip').trim(),
        city: val('es-city').trim(),
        country: val('es-country') || 'AT',
        phone: val('es-phone').trim(),
        mobile: val('es-mobile').trim(),
        email: val('es-email').trim(),
        web: val('es-web').trim(),
        uid: val('es-uid').replace(/\s+/g, '').toUpperCase(),
        taxNo: val('es-taxno').trim(),
        iban,
        bic: val('es-bic').replace(/\s+/g, '').toUpperCase(),
        bank: val('es-bank').trim(),
        paymentDays: Number(val('es-days')) || 0,
        skontoPercent: num('es-skpct'),
        skontoDays: Number(val('es-skdays')) || 0,
        customerNo: val('es-custno').trim(),
        account: val('es-account').trim(),
        category: val('es-cat'),
        expenseAccount: val('es-expense').trim(),
        reverseCharge: checked('es-rc'),
        active: checked('es-active'),
        note: val('es-note').trim(),
      }
      const err = supplierProblems(fields).find((p) => p.level === 'error')
      if (err) return toast(err.text)
      if (fields.supplierNo && d.suppliers.some((s) => s.supplierNo === fields.supplierNo && s.id !== el.dataset.id)) return toast(`Die Lieferantennummer ${fields.supplierNo} ist schon vergeben.`)
      const matSel = document.getElementById('es-material') ? val('es-material') : undefined
      let s = el.dataset.id ? supOf(el.dataset.id) : null
      if (s) Object.assign(s, fields, matSel !== undefined ? { materialId: matSel } : {})
      else s = saveSupplierFrom(fields, { materialId: matSel || '' })
      if (!s.materialId) delete s.materialId
      const mat = app.data.material
      if (mat && canEdit('material')) {
        if (checked('es-sync') && s.materialId) mat.suppliers = (mat.suppliers || []).map((y) => (y.id === s.materialId ? { ...y, ...materialFields(s) } : y))
        if (checked('es-mat-new')) {
          const id = newId('s')
          mat.suppliers = [...(mat.suppliers || []), { id, ...materialFields(s), note: '' }]
          s.materialId = id
        }
      }
      closeModal()
      commit('Lieferant gespeichert.')
    },
    'ek-sup-delete': (el) => {
      if (E().invoices.some((x) => x.supplierId === el.dataset.id)) return toast('Es gibt Eingangsrechnungen dieses Lieferanten: bitte „inaktiv“ setzen statt löschen.')
      if (!confirmStep(`ek-sup-del:${el.dataset.id}`, renderModal)) return
      E().suppliers = E().suppliers.filter((s) => s.id !== el.dataset.id)
      closeModal()
      commit('Lieferant gelöscht.')
    },
    'ek-sup-from-material': (el) => {
      const d = E()
      const material = app.data.material?.suppliers || []
      const todo = materialLinks(d.suppliers, material).filter((l) => (el.dataset.material === '*' ? !l.match : l.material.id === el.dataset.material))
      for (const l of todo) d.suppliers.push(supplierFromMaterial(l.material, { id: newId('ls'), supplierNo: nextSupplierNo(d.suppliers), now: nowIso() }))
      commit(`${plural(todo.length, 'Lieferant', 'Lieferanten')} aus Material & Lager übernommen (verknüpft). Bankverbindung und UID bitte ergänzen.`)
    },
    'ek-sup-link': (el) => {
      const s = supOf(el.dataset.id)
      s.materialId = el.dataset.material
      commit(`${supplierName(s)} mit Material & Lager verknüpft.`)
    },
    'ek-cat-add': () => {
      const d = E()
      d.settings.categories = [...PS().categories, { id: newId('kat'), name: 'Neue Kategorie', account: '', vat: 20 }]
      commit()
    },
    'ek-cat-del': (el) => {
      const i = Number(el.dataset.i)
      const cat = PS().categories[i]
      if (E().invoices.some((x) => x.category === cat?.id)) return toast('Diese Kategorie ist schon verwendet: bitte umbenennen statt entfernen.')
      E().settings.categories = PS().categories.filter((_, k) => k !== i)
      commit()
    },
    'ek-settings-save': () => {
      const d = E()
      const s = PS()
      const iban = val('es-diban').replace(/\s+/g, '').toUpperCase()
      if (iban && !ibanValid(iban)) return toast('Die IBAN des eigenen Kontos ist ungültig (Prüfziffer).')
      d.settings = {
        ...d.settings,
        categories: s.categories.map((c, i) => ({ ...c, name: val(`ec-name-${i}`).trim() || c.name, account: val(`ec-acc-${i}`).trim(), vat: Number(val(`ec-vat-${i}`)) })),
        approval: checked('es-approval'),
        accounts: { ...s.accounts, kreditor: val('es-kreditor').trim(), skonto: val('es-skonto').trim() },
        debtor: { name: val('es-dname').trim(), iban, bic: val('es-dbic').replace(/\s+/g, '').toUpperCase() },
      }
      commit('Einstellungen gespeichert.')
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'einkauf',
  module: MODULE,
  title: 'Einkauf',
  compute: () => {
    if (!app.data?.einkauf) return []
    const n = counts()
    const out = []
    if (n.due.length) out.push({ id: `due:${n.due.map((x) => `${x.inv.id}.${x.deadline}`).join(',')}`, kind: 'due', list: n.due, sum: round2(n.due.reduce((a, x) => a + (x.skonto ? x.skonto.payable : x.open), 0)), overdue: n.due.some((x) => x.overdueDays) })
    if (n.approve.length) out.push({ id: `approve:${n.approve.map((x) => x.id).join(',')}`, kind: 'approve', count: n.approve.length })
    if (n.sure.length) out.push({ id: `bank:${n.sure.map((t) => t.id).join(',')}`, kind: 'bank', count: n.sure.length })
    return out
  },
  render: (items) =>
    items
      .map((x) =>
        x.kind === 'due'
          ? `<div class="todo-item"><span class="flag ${x.overdue ? 'error' : 'warning'}">${x.list.length}</span><div class="todo-text"><strong>Eingangsrechnungen zahlen</strong> (${money(x.sum)}): ${esc(x.list.slice(0, 3).map((i) => `${i.inv.supplier?.name || i.inv.no} bis ${day(i.deadline)}${i.skonto ? ' (Skonto)' : ''}`).join(', '))}${x.list.length > 3 ? ' …' : ''}</div><button class="btn small primary" data-action="ek-goto" data-v="offen">Offene Zahlungen</button></div>`
          : x.kind === 'approve'
            ? `<div class="todo-item"><span class="flag warning">${x.count}</span><div class="todo-text"><strong>Eingangsrechnungen freigeben</strong> (geprüft von …)</div><button class="btn small" data-action="ek-goto" data-v="rechnungen">Ansehen</button></div>`
            : `<div class="todo-item"><span class="flag">${x.count}</span><div class="todo-text"><strong>Abbuchungen</strong> passen sicher zu Eingangsrechnungen</div><button class="btn small" data-action="ek-goto" data-v="bank">Zuordnen</button></div>`,
      )
      .join(''),
})

registerActions({
  'ek-goto': (el) => {
    closeModal()
    app.ui.view = 'einkauf'
    app.ui.ekTab = el.dataset.v
    renderNow()
  },
})
