// Fakturierung → Reiter „Verträge“: Kundenverträge mit Fristen (Laufzeit, Mindestlaufzeit, Kündigungsfrist zum Termin,
// automatische Verlängerung, Kündigung, Ansprechperson, Vertrag als PDF in SharePoint, Leistungsumfang mit Objekten und
// Leistungen), Kundenblatt „Verträge“, Erinnerungen in „Zu erledigen“ und beim digitalen Mitarbeiter Buchhaltung (nur
// „Öffnen“), Lauf „Preisanpassung“ nach KV-Lohnerhöhung (Lohnkostenklausel) mit Vorschau je Vertrag und Musterschreiben
// über den Serienbrief, Kennzahlen (kpiHooks.vertraege). Geladen mit invoicing.js; Aktionen und Dialoge mit „fvt-“.
// Rechenkern: core/vertraege.js. Abgerechnet wird nur über die Daueraufträge (recurring[].contractId, steps[]); diese Datei
// hat keine eigene Preis- oder Rechnungslogik. Rechte wie die Daueraufträge: sehen mit Leserecht auf die Fakturierung,
// ändern mit Recht zum Bearbeiten.

import { todayISO } from '../../core/dates.js'
import { fileSafe } from '../../core/filename.js'
import { customerName, emptyInvoicing, INTERVALS, monthLabel, round2, settingsOf } from '../../core/invoicing.js'
import {
  applyKvRun,
  CANCEL_BY,
  CLAUSES,
  contractDate,
  contractKpi,
  contractProblems,
  contractRecs,
  contractReminders,
  contractStatus,
  contractVolume,
  earliestEnd,
  endRecurring,
  KUENDBAR_DAYS,
  KV_LETTER,
  KV_SHARE,
  letterValues,
  minEndOf,
  nextContractNo,
  NOTICE_UNITS,
  noticeLabel,
  planKvRun,
  recNet,
  REMIND_DAYS,
  TERMS,
  termLabel,
  undoKvRun,
  addDays as addDaysIso,
} from '../../core/vertraege.js'
import { app, canEdit, closeModal, confirmStep, memo, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { checked, checkedValues, dayAt, esc, euro, ICON, modalFrame, options, uid, val } from '../shared.js'
import { buchhaltungHooks } from './disponent.js'
import { openSerialDraft } from './invoicing-briefe.js'
import { kpiHooks } from './lazy.js'

const MODULE = 'fakturierung'
const F = () => {
  const d = (app.data.fakturierung ||= emptyInvoicing())
  for (const k of ['contracts', 'recurring', 'customers', 'documents', 'priceRuns', 'serials']) d[k] ||= []
  d.settings ||= {}
  return d
}
const S = () => settingsOf(F())
const editable = () => canEdit(MODULE) && !app.readOnly
const by = () => app.user?.name || 'Browser'
const nowIso = () => new Date().toISOString()
const money = (n) => euro(round2(n))
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const de = contractDate
const custOf = (id) => F().customers.find((c) => c.id === id)
const custName = (id) => customerName(custOf(id) || {}) || '–'
const contractOf = (id) => F().contracts.find((c) => c.id === id)
const objName = (id) => (app.data.objects || []).find((o) => o.id === id)?.name || 'Objekt'
const STATUS_CLASS = { laeuft: 'ok', kuendbar: 'warning', gekuendigt: 'error', beendet: '' }
const pill = (st) => `<span class="pill ${STATUS_CLASS[st.status] || ''}">${esc(st.label)}</span>`
const numText = (v) => (v === '' || v === null || v === undefined ? '' : String(v).replace('.', ','))
const pctText = (n) => `${String(round2(n)).replace('.', ',')} %`
const remindOf = () => F().settings.contracts?.remindDays ?? ''

const statusAt = (c, today = todayISO()) => contractStatus(c, today)
const nameOf = (c) => c.title || c.no || 'Vertrag'
/** Monatswert netto jetzt (Daueraufträge des Vertrags bzw. eingetragener Monatswert). */
const volumeNow = (c) => contractVolume(F(), c, todayISO().slice(0, 7), S())

// ---------------------------------------------------------------- Liste (Reiter „Verträge“)

/** Zahl am Reiter: kündbar in den nächsten 90 Tagen und gekündigte, noch nicht erledigte. */
export function contractsFlag() {
  const today = todayISO()
  return F().contracts.filter((c) => {
    const st = statusAt(c, today)
    return st.status === 'kuendbar' || (st.status === 'gekuendigt' && !c.cancel?.doneAt)
  }).length
}

const FILTERS = { alle: 'alle Verträge', aktiv: 'laufend (ohne beendete)', kuendbar: `kündbar in den nächsten ${KUENDBAR_DAYS} Tagen`, gekuendigt: 'gekündigt', beendet: 'beendet' }

function matches(c, q) {
  if (!q) return true
  const cu = custOf(c.customerId) || {}
  return [c.title, c.no, customerName(cu), cu.customerNo, c.contact?.name, c.scope].some((x) => String(x || '').toLowerCase().includes(q.toLowerCase()))
}

export function contractsTab() {
  const d = F()
  const ed = editable()
  const today = todayISO()
  const filter = FILTERS[app.ui.fvtFilter] ? app.ui.fvtFilter : 'aktiv'
  const q = app.ui.fvtSearch || ''
  const all = d.contracts.map((c) => ({ c, st: statusAt(c, today), vol: volumeNow(c) }))
  const n = { aktiv: all.filter((x) => x.st.status !== 'beendet'), kuendbar: all.filter((x) => x.st.status === 'kuendbar'), gekuendigt: all.filter((x) => x.st.status === 'gekuendigt') }
  const list = all
    .filter((x) => filter === 'alle' || (filter === 'aktiv' ? x.st.status !== 'beendet' : x.st.status === filter))
    .filter((x) => matches(x.c, q))
    .sort((a, b) => (a.st.latest || a.st.end || '9999').localeCompare(b.st.latest || b.st.end || '9999') || custName(a.c.customerId).localeCompare(custName(b.c.customerId), 'de'))
  const rows = list
    .map(({ c, st, vol }) => {
      const next = st.status === 'gekuendigt' ? `endet am ${de(c.cancel.to)}${c.cancel.doneAt ? ' · erledigt' : ''}` : st.model.kind === 'befristet' ? `endet am ${de(c.end)}` : st.termin ? `zum ${de(st.termin)}, spätestens ${de(st.latest)}${st.renewal ? `<br><span class="muted">sonst verlängert am ${de(st.renewal)}</span>` : ''}` : st.end ? `endet am ${de(st.end)}` : '–'
      return `<tr class="clickable" data-action="fvt-open" data-id="${esc(c.id)}"><td><strong>${esc(nameOf(c))}</strong>${c.no && c.title ? ` <span class="muted">${esc(c.no)}</span>` : ''}<br><span class="muted">${esc(custName(c.customerId))}</span></td>
        <td>${esc(termLabel(c))}</td><td>${esc(noticeLabel(c))}</td><td>${pill(st)}</td><td>${next}</td><td class="num">${vol ? money(vol) : '–'}</td><td>${esc(CLAUSES[c.clause] || CLAUSES.keine)}</td></tr>`
    })
    .join('')
  const tile = (label, value, cls = '', f = '') => `<${f ? `button data-action="fvt-filter" data-v="${f}"` : 'div'} class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></${f ? 'button' : 'div'}>`
  const volume = round2(n.aktiv.reduce((s, x) => s + x.vol, 0))
  return `<div class="impact-stats fvt-stats">${tile('Verträge laufend', n.aktiv.length, '', 'aktiv')}${tile(`kündbar in ${KUENDBAR_DAYS} Tagen`, n.kuendbar.length, n.kuendbar.length ? 'warn' : '', 'kuendbar')}${tile('gekündigt', n.gekuendigt.length, '', 'gekuendigt')}${tile('Vertragsvolumen je Monat', money(volume))}</div>
    <div class="filters"><label class="field inline"><span>Suche</span><input type="search" id="fvt-search" value="${esc(q)}" data-input="fvt-search" placeholder="Kunde, Vertrag, Ansprechperson …"></label>
      <label class="field inline"><span>Anzeigen</span><select id="fvt-filter" data-change="fvt-filter">${options(Object.entries(FILTERS), filter)}</select></label><span class="spacer"></span>
      ${ed ? `<button class="btn small" data-action="fvt-kv-open">Preisanpassung</button><button class="btn small primary" data-action="fvt-open">${ICON.plus} Vertrag</button>` : ''}</div>
    ${rows ? `<div class="table-wrap"><table class="data fvt-table"><thead><tr><th>Vertrag</th><th>Laufzeit</th><th>Kündigung</th><th>Stand</th><th>Nächster Termin</th><th class="num">netto je Monat</th><th>Preisanpassung</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">${d.contracts.length ? 'Kein Vertrag passt zur Auswahl.' : 'Noch keine Verträge. Ein Vertrag hält Laufzeit, Kündigungsfrist, Ansprechperson und das unterschriebene PDF fest; abgerechnet wird weiter über die Daueraufträge.'}</p>`}
    <p class="note">Kündigungsfrist: Die Kündigung muss spätestens am angegebenen Tag beim Vertragspartner sein (3 Monate zum 31.12. heißt bis 30.9.). Bei automatischer Verlängerung wird zum Ende der Laufzeit gekündigt. Erinnerung ${remindOf() === '' ? REMIND_DAYS : esc(remindOf())} Tage vor dem letzten Tag in „Zu erledigen“.</p>`
}

// ---------------------------------------------------------------- Kundenblatt, Dauerauftrag

/** Kundenblatt, Reiter „Verträge“: Verträge des Kunden mit Stand und Fristen. */
export function customerContractsTab(v, x) {
  if (!x) return '<p class="muted">Erst den Kunden speichern, dann einen Vertrag anlegen.</p>'
  const today = todayISO()
  const list = F().contracts.filter((c) => c.customerId === x.id)
  const rows = list
    .map((c) => {
      const st = statusAt(c, today)
      return `<tr class="clickable" data-action="fvt-open" data-id="${esc(c.id)}"><td><strong>${esc(nameOf(c))}</strong></td><td>${esc(termLabel(c))}</td><td>${esc(noticeLabel(c))}</td><td>${pill(st)}${st.termin && st.status !== 'gekuendigt' && st.model.kind !== 'befristet' ? `<br><span class="muted">zum ${de(st.termin)}, spätestens ${de(st.latest)}</span>` : ''}</td><td class="num">${money(volumeNow(c))}</td></tr>`
    })
    .join('')
  return `<div class="filters"><span class="muted">${plural(list.length, 'Vertrag', 'Verträge')}</span><span class="spacer"></span>${editable() ? `<button class="btn small" data-action="fvt-open" data-customer="${esc(x.id)}">${ICON.plus} Vertrag für diesen Kunden</button>` : ''}</div>
    ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Vertrag</th><th>Laufzeit</th><th>Kündigung</th><th>Stand</th><th class="num">netto je Monat</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Noch kein Vertrag für diesen Kunden.</p>'}`
}
/** Zahl am Reiter „Verträge“ im Kundenblatt. */
export const customerContractCount = (id) => (id ? F().contracts.filter((c) => c.customerId === id).length : 0)

/** Im Dauerauftrag: Auswahl des Vertrags und geplante Preisanpassungen. */
export function recContractField(v, dis) {
  const list = F().contracts.filter((c) => c.customerId === v.customerId)
  const steps = (v.steps || []).filter((st) => !st.applied)
  return `<label class="field"><span>Vertrag</span><select id="fr-contract" ${dis}>${options(list.map((c) => [c.id, nameOf(c)]), v.contractId || '', { empty: list.length ? '– ohne Vertrag –' : '– keiner für diesen Kunden –' })}</select></label>
    ${steps.length ? `<p class="field wide muted">Geplante Preisanpassung: ${steps.map((st) => `ab ${esc(monthLabel(st.fromMonth))} +${pctText(st.change)} (KV-Lohn)`).join(', ')}</p>` : ''}`
}
/** Schild im Reiter „Daueraufträge“: geplante Preisanpassung. */
export const recStepPill = (r) =>
  (r.steps || [])
    .filter((st) => !st.applied)
    .map((st) => ` <span class="pill info">ab ${esc(monthLabel(st.fromMonth))} +${pctText(st.change)}</span>`)
    .join('')

// ---------------------------------------------------------------- Vertragsdokument (PDF in SharePoint)

const LOCAL = new Map() // Browser-Modus: Datei nur in diesem Fenster

/** fakturierung/vertraege/<Kundennummer>/<Vertrag>_<Datei>.pdf */
function docPath(c, file) {
  const cu = custOf(c.customerId)
  const folder = fileSafe(cu?.customerNo || c.customerId || 'ohne-Kunde')
  const base = fileSafe(String(file.name || 'Vertrag.pdf').replace(/\.pdf$/i, '')).slice(0, 60)
  return `fakturierung/vertraege/${folder}/${fileSafe(c.no || c.id)}_${base}.pdf`
}

async function storeDocument(c, file) {
  if (!/pdf/i.test(file.type) && !/\.pdf$/i.test(file.name || '')) return toast('Bitte das Vertragsdokument als PDF wählen.')
  if (file.size > 15e6) return toast('Die Datei ist zu groß (höchstens 15 MB).')
  const path = docPath(c, file)
  const meta = { path, name: file.name, type: 'application/pdf', size: file.size, at: nowIso(), by: by() }
  if (app.store?.kind !== 'sharepoint') {
    LOCAL.set(path, file)
    return { ...meta, local: true }
  }
  try {
    const up = await app.store.upload(path, file, 'application/pdf')
    return { ...meta, ...(up?.webUrl ? { url: up.webUrl } : {}), ...(up?.queued ? { queued: true } : {}) }
  } catch (err) {
    toast(`Vertrag nicht gespeichert: ${err.message}`)
    return null
  }
}

async function openDocument(meta) {
  if (!meta) return
  const local = LOCAL.get(meta.path)
  if (local) return void window.open(URL.createObjectURL(local), '_blank', 'noopener')
  if (meta.local) return toast('Im Browser-Modus werden Vertragsdokumente nicht gespeichert (nur im Betrieb mit SharePoint).')
  try {
    const blob = await app.store?.readBlob?.(meta.path)
    if (blob) return void window.open(URL.createObjectURL(blob), '_blank', 'noopener')
    if (meta.url) return void window.open(meta.url, '_blank', 'noopener')
    toast(meta.queued ? 'Die Datei wartet noch im Gerät aufs Hochladen.' : 'Vertragsdokument nicht gefunden.')
  } catch (err) {
    if (meta.url) return void window.open(meta.url, '_blank', 'noopener')
    toast(`Vertragsdokument nicht geöffnet: ${err.message}`)
  }
}

// ---------------------------------------------------------------- Dialog: Vertrag

function newContract(customerId = '') {
  const today = todayISO()
  return { id: uid('vt'), no: nextContractNo(F().contracts, today.slice(0, 4)), customerId, title: '', start: `${today.slice(0, 7)}-01`, minMonths: 12, end: '', renewMonths: '', notice: { n: 3, unit: 'monat' }, term: 'quartal', remindDays: '', clause: 'keine', kvShare: KV_SHARE, objectIds: [...(custOf(customerId)?.objectIds || [])], taskIds: [], scope: '', note: '', contact: null, history: [] }
}

/** „Frühestens zum … (Eingang …).“ für die Kündigung im Formular. */
const earliestHint = (v) => `Frühestens zum ${esc(de(earliestEnd({ ...v, cancel: null }, v.cancel?.at || todayISO())) || '–')} (Eingang ${esc(de(v.cancel?.at || todayISO()))}).`

const problemList = (list) => (list.length ? `<ul class="fak-problems" role="alert">${list.map((p) => `<li class="${p.level === 'error' ? 'err-text' : 'warn-text'}">${esc(p.text)}</li>`).join('')}</ul>` : '')

/** Fristen zum Stand des Formulars (live). */
function calcBox(v) {
  const today = todayISO()
  const st = statusAt(v, today)
  const min = minEndOf(v)
  const lead = String(v.remindDays ?? '').trim() !== '' ? Number(v.remindDays) : remindOf() !== '' ? Number(remindOf()) : REMIND_DAYS
  const rows = [['Stand', pill(st)]]
  if (min) rows.push(['Mindestlaufzeit bis', de(min)])
  if (st.status === 'gekuendigt' || st.status === 'beendet') rows.push(['Ende', de(st.end)])
  else if (st.model.kind === 'befristet') rows.push(['Ende', `${de(v.end)} (befristet, ohne Kündigung)`])
  else if (st.termin) {
    rows.push(['Nächster Kündigungstermin', `zum ${de(st.termin)}`], ['Spätester Tag für die Kündigung', `<strong>${de(st.latest)}</strong> (beim Vertragspartner eingelangt)`])
    if (st.renewal) rows.push(['Verlängerung', `am ${de(st.renewal)} um ${st.model.renew} Monate, wenn bis ${de(st.latest)} nicht gekündigt`])
    if (Number.isFinite(lead)) rows.push(['Erinnerung', `ab ${de(addDaysIso(st.latest, -lead))} in „Zu erledigen“`])
  }
  return `<dl class="fvt-calc-list">${rows.map(([k, x]) => `<dt>${esc(k)}</dt><dd>${x}</dd>`).join('')}</dl>${problemList(contractProblems(v))}`
}

function contractModal(c, m) {
  const d = F()
  const x = m.id ? contractOf(m.id) : null
  m.draft ||= structuredClone(x || newContract(m.customerId || ''))
  m.recIds ||= contractRecs(d, m.draft.id).map((r) => r.id)
  const v = m.draft
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const cu = custOf(v.customerId)
  const contacts = cu?.contacts || []
  const objects = app.data.objects || []
  const ownObj = new Set(cu?.objectIds || [])
  const objList = [...objects.filter((o) => ownObj.has(o.id) || (v.objectIds || []).includes(o.id)), ...(v.objectIds || []).filter((id) => !objects.some((o) => o.id === id)).map((id) => ({ id, name: id }))]
  const tasks = (app.data.tasks || []).filter((t) => (v.objectIds || []).includes(t.objectId))
  const recs = d.recurring.filter((r) => r.customerId === v.customerId || r.contractId === v.id)
  const cancel = v.cancel
  const show = (k) => (k === 'kv' || k === 'beides')
  const doc = v.document
  const cancelHtml = cancel
    ? `<h3>Kündigung</h3>
      <div class="form-grid">
        <label class="field"><span>Gekündigt am (Eingang)</span><input type="date" id="fvt-c-at" value="${esc(cancel.at || '')}" data-change="fvt-c-at" data-input="fvt-c-at" ${dis}></label>
        <label class="field"><span>Von</span><select id="fvt-c-by" ${dis}>${options(Object.entries(CANCEL_BY), cancel.by || 'kunde')}</select></label>
        <label class="field"><span>Zum</span><input type="date" id="fvt-c-to" value="${esc(cancel.to || '')}" data-input="fvt-calc" data-change="fvt-calc" ${dis}></label>
        <label class="field wide"><span>Grund</span><input type="text" id="fvt-c-reason" value="${esc(cancel.reason || '')}" placeholder="z. B. Hausverwaltung gewechselt, Preis, Qualität" ${dis}></label>
        ${!cancel.recordedAt ? `<label class="check wide"><input type="checkbox" id="fvt-c-recs" ${m.endRecs !== false ? 'checked' : ''} ${dis}><span>Daueraufträge des Vertrags enden mit dem Monat des Vertragsendes</span></label>` : ''}
      </div>
      <p class="muted"><span id="fvt-c-hint">${earliestHint(v)}</span>${cancel.doneAt ? ` Erledigt am ${esc(de(dayAt(cancel.doneAt)))} von ${esc(cancel.doneBy || '')}.` : ''}</p>
      ${ed ? `<div class="filters">${cancel.recordedAt && !cancel.doneAt ? '<button class="btn small primary" data-action="fvt-done">Erledigt: Dauerauftrag beendet, Objekt freigegeben</button>' : ''}<button class="btn small ghost" data-action="fvt-cancel-undo">${app.ui.confirm === `fvt-cu:${v.id}` ? 'Kündigung wirklich zurücknehmen?' : 'Kündigung zurücknehmen'}</button></div>` : ''}`
    : ed && x
      ? '<div class="filters"><button class="btn small" data-action="fvt-cancel-open">Kündigung erfassen</button></div>'
      : ''
  return modalFrame({
    title: x ? nameOf(x) : 'Neuer Vertrag',
    subtitle: x ? `${esc(custName(x.customerId))}${x.no ? ` · ${esc(x.no)}` : ''}` : 'Laufzeit, Fristen, Preisanpassung',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Kunde</span><select id="fvt-customer" data-change="fvt-redraw" ${dis}>${options(d.customers.map((k) => [k.id, customerName(k)]).sort((a, b) => a[1].localeCompare(b[1], 'de')), v.customerId, { empty: '– Kunde –' })}</select></label>
        <label class="field"><span>Vertragsnummer</span><input type="text" id="fvt-no" value="${esc(v.no || '')}" ${dis}></label>
        <label class="field wide"><span>Bezeichnung</span><input type="text" id="fvt-title" value="${esc(v.title || '')}" placeholder="z. B. Unterhaltsreinigung Wohnanlage" ${dis}></label>
        <label class="field"><span>Ansprechperson</span><input type="text" id="fvt-contact" list="fvt-contact-list" value="${esc(v.contact?.name || '')}" placeholder="Name" ${dis}><datalist id="fvt-contact-list">${contacts.map((p) => `<option value="${esc(p.name)}"></option>`).join('')}</datalist></label>
        <label class="field"><span>E-Mail</span><input type="email" id="fvt-contact-mail" value="${esc(v.contact?.email || '')}" placeholder="leer: vom Ansprechpartner" ${dis}></label>
        <label class="field"><span>Telefon</span><input type="tel" id="fvt-contact-phone" value="${esc(v.contact?.phone || '')}" ${dis}></label>
      </div>
      <h3>Laufzeit und Kündigung</h3>
      <div class="form-grid fvt-term">
        <label class="field"><span>Beginn</span><input type="date" id="fvt-start" value="${esc(v.start || '')}" data-input="fvt-calc" data-change="fvt-calc" ${dis}></label>
        <label class="field"><span>Mindestlaufzeit (Monate)</span><input type="text" inputmode="numeric" id="fvt-min" value="${esc(numText(v.minMonths))}" placeholder="0 = keine" data-input="fvt-calc" ${dis}></label>
        <label class="field"><span>Ende (leer = unbefristet)</span><input type="date" id="fvt-end" value="${esc(v.end || '')}" data-input="fvt-calc" data-change="fvt-calc" ${dis}></label>
        <label class="field"><span>Verlängert sich um (Monate)</span><input type="text" inputmode="numeric" id="fvt-renew" value="${esc(numText(v.renewMonths))}" placeholder="0 = nein" data-input="fvt-calc" ${dis}></label>
        <label class="field"><span>Kündigungsfrist</span><span class="fvt-notice"><input type="text" inputmode="numeric" id="fvt-notice-n" value="${esc(numText(v.notice?.n ?? ''))}" aria-label="Kündigungsfrist" data-input="fvt-calc" ${dis}><select id="fvt-notice-unit" data-change="fvt-calc" aria-label="Einheit" ${dis}>${options(Object.entries(NOTICE_UNITS).map(([k, [, many]]) => [k, many]), v.notice?.unit || 'monat')}</select></span></label>
        <label class="field"><span>Zum (ohne Verlängerung)</span><select id="fvt-term" data-change="fvt-calc" ${dis}>${options(Object.entries(TERMS), v.term || 'monat')}</select></label>
        <label class="field"><span>Erinnerung (Tage vorher)</span><input type="text" inputmode="numeric" id="fvt-remind" value="${esc(numText(v.remindDays))}" placeholder="${esc(remindOf() === '' ? REMIND_DAYS : remindOf())}" data-input="fvt-calc" ${dis}></label>
      </div>
      <div id="fvt-calc" class="fak-preview fvt-calc" aria-live="polite">${calcBox(v)}</div>
      ${cancelHtml}
      <h3>Preisanpassung</h3>
      <div class="form-grid">
        <label class="field"><span>Klausel</span><select id="fvt-clause" data-change="fvt-redraw" ${dis}>${options(Object.entries(CLAUSES), v.clause || 'keine')}</select></label>
        ${show(v.clause) ? `<label class="field"><span>Lohnanteil am Preis (%)</span><input type="text" inputmode="decimal" id="fvt-share" value="${esc(numText(v.kvShare ?? KV_SHARE))}" ${dis}></label>` : ''}
      </div>
      <p class="muted">${v.clause === 'vpi' || v.clause === 'beides' ? 'VPI: Basis, Schwelle und Indexzahlen stehen beim Dauerauftrag; der Monatslauf passt an. ' : ''}${show(v.clause) ? 'KV-Lohn: „Läufe ▾“ → „Preisanpassung“ erhöht den Preis um KV-Erhöhung × Lohnanteil, ab einem Datum. Innerhalb von 12 Monaten nie zweimal (auch nicht VPI und KV).' : v.clause === 'vpi' ? '' : 'Ohne Klausel bleiben die Preise, bis sie im Dauerauftrag geändert werden.'}</p>
      <h3>Abrechnung (Daueraufträge)</h3>
      ${recs.length ? `<ul class="fvt-picks">${recs.map((r) => `<li><label class="check"><input type="checkbox" name="fvt-rec" value="${esc(r.id)}" ${m.recIds.includes(r.id) ? 'checked' : ''} data-change="fvt-redraw" ${dis}><span><strong>${esc(r.title || 'Dauerauftrag')}</strong> · ${esc(INTERVALS[r.interval] || '')} · ${money(recNet(r, S()))} netto${r.endMonth ? ` · bis ${esc(monthLabel(r.endMonth))}` : ''}${r.contractId && r.contractId !== v.id ? ` <span class="muted">(jetzt bei ${esc(nameOf(contractOf(r.contractId) || {}))})</span>` : ''}${r.active === false ? ' <span class="muted">(beendet)</span>' : ''}</span></label></li>`).join('')}</ul>` : `<p class="muted">${v.customerId ? 'Dieser Kunde hat noch keinen Dauerauftrag.' : 'Erst den Kunden wählen.'}</p>`}
      ${!m.recIds.length ? `<div class="form-grid"><label class="field"><span>Monatswert netto (€, ohne Dauerauftrag)</span><input type="text" inputmode="decimal" id="fvt-volume" value="${esc(numText(v.volume ?? ''))}" placeholder="für die Kennzahlen" ${dis}></label></div>` : ''}
      <h3>Leistungsumfang</h3>
      ${objList.length ? `<ul class="fvt-picks">${objList.map((o) => `<li><label class="check"><input type="checkbox" name="fvt-obj" value="${esc(o.id)}" ${(v.objectIds || []).includes(o.id) ? 'checked' : ''} data-change="fvt-redraw" ${dis}><span>${esc(o.name)}</span></label></li>`).join('')}</ul>` : '<p class="muted">Keine Objekte beim Kunden (Stammdaten des Kunden).</p>'}
      ${tasks.length ? `<p class="muted">Leistungen der gewählten Objekte:</p><ul class="fvt-picks">${tasks.map((t) => `<li><label class="check"><input type="checkbox" name="fvt-task" value="${esc(t.id)}" ${(v.taskIds || []).includes(t.id) ? 'checked' : ''} ${dis}><span>${esc(t.label || t.id)} <span class="muted">(${esc(objName(t.objectId))})</span></span></label></li>`).join('')}</ul>` : (v.taskIds || []).length ? `<p class="muted">${plural(v.taskIds.length, 'Leistung', 'Leistungen')} gewählt (Einsatzplanung hier nicht lesbar).</p>` : ''}
      <div class="form-grid"><label class="field wide"><span>Leistungsbeschreibung</span><textarea id="fvt-scope" rows="3" placeholder="z. B. Stiegenhaus 2× wöchentlich, Glasreinigung 4× jährlich laut Leistungsverzeichnis" ${dis}>${esc(v.scope || '')}</textarea></label></div>
      <h3>Vertragsdokument</h3>
      <div class="filters">${doc ? `<button class="btn small" data-action="fvt-doc-open">${ICON.download} ${esc(doc.name || 'Vertrag.pdf')}</button><span class="muted">${esc(de(String(doc.at || '').slice(0, 10)))}${doc.local ? ' · nur Vorschau (Browser-Modus)' : ''}</span>` : '<span class="muted">Noch kein PDF.</span>'}${ed ? `<label class="btn small">${ICON.upload} ${doc ? 'PDF ersetzen' : 'PDF ablegen'}<input type="file" id="fvt-doc-file" accept="application/pdf,.pdf" data-change="fvt-doc" hidden></label>` : ''}</div>
      <div class="form-grid"><label class="field wide"><span>Notiz</span><textarea id="fvt-note" rows="2" ${dis}>${esc(v.note || '')}</textarea></label></div>
      ${(x?.history || []).length ? `<details><summary>Verlauf</summary><ul class="muted">${x.history.slice(-12).reverse().map((h) => `<li>${esc(de(dayAt(h.at)))}${h.by ? ` ${esc(h.by)}` : ''}: ${esc(h.text)}</li>`).join('')}</ul></details>` : ''}`,
    foot: `<div class="actions">${ed && x ? `<button class="btn danger" data-action="fvt-del" data-id="${esc(x.id)}">${app.ui.confirm === `fvt-del:${x.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</div><div class="actions"><button class="btn" data-action="close-modal">Schließen</button>${ed ? '<button class="btn primary" data-action="fvt-save">Speichern</button>' : ''}</div>`,
  })
}
registerModal('fvt-edit', contractModal, { module: MODULE })

/** Formular in den Entwurf lesen. */
function readContract(m) {
  const v = m.draft
  if (!document.getElementById('fvt-start')) return v
  const opt = (id, fallback) => (document.getElementById(id) ? val(id).trim() : fallback)
  Object.assign(v, {
    customerId: val('fvt-customer'),
    no: val('fvt-no').trim(),
    title: val('fvt-title').trim(),
    start: val('fvt-start'),
    minMonths: val('fvt-min').trim(),
    end: val('fvt-end'),
    renewMonths: val('fvt-renew').trim(),
    notice: { n: val('fvt-notice-n').trim(), unit: val('fvt-notice-unit') || 'monat' },
    term: val('fvt-term') || v.term || 'monat',
    remindDays: val('fvt-remind').trim(),
    clause: val('fvt-clause') || 'keine',
    kvShare: opt('fvt-share', v.kvShare ?? KV_SHARE),
    volume: opt('fvt-volume', v.volume ?? ''),
    scope: val('fvt-scope'),
    note: val('fvt-note'),
    objectIds: checkedValues('fvt-obj'),
    taskIds: checkedValues('fvt-task'),
  })
  const name = val('fvt-contact').trim()
  const known = (custOf(v.customerId)?.contacts || []).find((p) => p.name === name)
  v.contact = name ? { ...(known ? { id: known.id } : {}), name, email: val('fvt-contact-mail').trim() || known?.email || '', phone: val('fvt-contact-phone').trim() || known?.phone || '' } : null
  m.recIds = checkedValues('fvt-rec')
  if (v.cancel && document.getElementById('fvt-c-at')) {
    Object.assign(v.cancel, { at: val('fvt-c-at'), by: val('fvt-c-by') || 'kunde', to: val('fvt-c-to'), reason: val('fvt-c-reason').trim() })
    if (document.getElementById('fvt-c-recs')) m.endRecs = checked('fvt-c-recs')
  }
  return v
}

const clean = (v) => {
  const out = structuredClone(v)
  for (const k of ['minMonths', 'renewMonths', 'remindDays', 'kvShare', 'volume']) if (out[k] !== undefined && out[k] !== '') out[k] = Number(String(out[k]).replace(',', '.'))
  if (out.notice) out.notice = { n: Number(String(out.notice.n || 0).replace(',', '.')) || 0, unit: out.notice.unit || 'monat' }
  if (!['kv', 'beides'].includes(out.clause)) delete out.kvShare
  return out
}

// ---------------------------------------------------------------- Dialog: Preisanpassung (KV-Lohn)

const nextJan = () => `${Number(todayISO().slice(0, 4)) + 1}-01-01`
const customerNames = () => Object.fromEntries(F().customers.map((c) => [c.id, customerName(c)]))
const planOf = (c, m) => memo(c, `fvt:kv:${m.percent}:${m.from}`, () => planKvRun(F(), { percent: m.percent, from: m.from, today: todayISO(), settings: S(), names: customerNames() }))

function kvModal(c, m) {
  m.from ||= nextJan()
  m.percent ??= ''
  const ed = editable()
  const plan = planOf(c, m)
  m.sel ||= Object.fromEntries(plan.rows.filter((r) => r.ready).map((r) => [r.contract.id, true]))
  const chosen = plan.rows.filter((r) => r.ready && m.sel[r.contract.id])
  const recCount = chosen.reduce((s, r) => s + r.recs.filter((x) => !x.blocked).length, 0)
  const more = round2(chosen.reduce((s, r) => s + r.recs.filter((x) => !x.blocked).reduce((a, x) => a + (x.newNet - x.oldNet) / ({ quartal: 3, halbjahr: 6, jahr: 12 }[x.rec.interval] || 1), 0), 0))
  const rows = plan.rows
    .map((r) => {
      const box = r.ready && ed && !m.done ? `<input type="checkbox" data-change="fvt-kv-pick" data-id="${esc(r.contract.id)}" ${m.sel[r.contract.id] ? 'checked' : ''} aria-label="${esc(`${r.name} anpassen`)}">` : ''
      const recs = r.recs
        .map((x) => `<li class="${x.blocked ? 'fvt-off' : ''}"><strong>${esc(x.rec.title || 'Dauerauftrag')}</strong> (${esc(x.interval)}): ${money(x.oldNet)} → <strong>${money(x.newNet)}</strong>${x.effective && !x.blocked ? ` ab ${esc(monthLabel(x.effective))}` : ''}${x.blocked ? `<br><span class="err-text">nicht angepasst: ${esc(x.blocked)}</span>` : ''}${x.hints.map((h) => `<br><span class="muted">${esc(h)}</span>`).join('')}</li>`)
        .join('')
      return `<tr class="${r.ready ? '' : 'fvt-off'}"><td class="mwr-box">${box}</td><td><strong>${esc(r.name || '–')}</strong><br><span class="muted">${esc(nameOf(r.contract))}</span></td><td>${esc(pctText(r.share))} → +${esc(pctText(r.change))}</td><td><ul class="fvt-recs">${recs}</ul></td></tr>`
    })
    .join('')
  const skipped = plan.skipped.length ? `<details><summary>Nicht betroffen (${plan.skipped.length})</summary><ul class="muted">${plan.skipped.map((s) => `<li>${esc(s.name || '')} – ${esc(nameOf(s.contract))}: ${esc(s.reason)}</li>`).join('')}</ul></details>` : ''
  const runs = F().priceRuns.slice().reverse()
  const runList = runs.length
    ? `<h3>Bisherige Läufe</h3><ul class="fvt-runs">${runs
        .map((run) => {
          const open = F().recurring.some((r) => (r.steps || []).some((st) => st.runId === run.id && !st.applied))
          return `<li><strong>${esc(run.label)}</strong> <span class="muted">(${esc(de(dayAt(run.at)))}, ${esc(run.by || '')}, ${plural(run.items.length, 'Dauerauftrag', 'Daueraufträge')})</span> <button class="btn small" data-action="fvt-kv-letter" data-id="${esc(run.id)}">Musterschreiben</button>${ed && open ? `<button class="btn small ghost" data-action="fvt-kv-undo" data-id="${esc(run.id)}">${app.ui.confirm === `fvt-ku:${run.id}` ? 'Wirklich zurücknehmen?' : 'Zurücknehmen'}</button>` : ''}</li>`
        })
        .join('')}</ul>`
    : ''
  const tile = (label, value) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const valid = Number(String(m.percent).replace(',', '.')) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(m.from)
  return modalFrame({
    title: 'Preisanpassung nach KV-Lohnerhöhung',
    subtitle: 'Lohnkostenklausel: neuer Preis = alter Preis × (1 + KV-Erhöhung × Lohnanteil)',
    wide: true,
    body: `${m.done ? `<div class="banner"><p><strong>${plural(m.done.count, 'Dauerauftrag', 'Daueraufträge')} angepasst</strong> ab ${esc(monthLabel(plan.fromMonth))}. Der Monatslauf rechnet ab dann mit den neuen Preisen; festgeschriebene Rechnungen bleiben unverändert.</p><button class="btn small primary" data-action="fvt-kv-letter" data-id="${esc(m.done.runId)}">Musterschreiben an die Kunden</button></div>` : ''}
      <div class="filters fvt-kv-in"><label class="field inline"><span>KV-Erhöhung (%)</span><input type="text" inputmode="decimal" id="fvt-kv-pct" value="${esc(m.percent)}" placeholder="z. B. 4,5" data-input="fvt-kv-calc" ${m.done ? 'disabled' : ''}></label>
        <label class="field inline"><span>Gültig ab</span><input type="date" id="fvt-kv-from" value="${esc(m.from)}" data-change="fvt-kv-calc" ${m.done ? 'disabled' : ''}></label></div>
      ${valid ? `<div class="impact-stats">${tile('Verträge', chosen.length)}${tile('Daueraufträge', recCount)}${tile('mehr je Monat netto', money(more))}</div>
      ${rows ? `<div class="table-wrap"><table class="data fvt-kv-table"><thead><tr><th></th><th>Kunde und Vertrag</th><th>Lohnanteil</th><th>Daueraufträge: alt → neu (netto je Abrechnung)</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Kein Vertrag mit Lohnkostenklausel (Klausel „KV-Lohn“ oder „nach Wahl“ im Vertrag).</p>'}${skipped}` : '<p class="muted">KV-Erhöhung und „gültig ab“ eintragen: die Vorschau zeigt je Vertrag den alten und den neuen Preis.</p>'}
      <p class="note">Neue Preise gelten ab dem ersten Abrechnungszeitraum, der am oder nach „gültig ab“ beginnt und noch nicht abgerechnet ist – nie rückwirkend auf festgeschriebene Rechnungen. Wertsicherung nach VPI und KV-Lohn werden innerhalb von 12 Monaten nicht beide angewandt; nach der KV-Anpassung ist die Indexzahl davor die neue Basis.</p>
      ${runList}`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${ed && !m.done ? `<button class="btn primary" data-action="fvt-kv-apply" ${valid && recCount ? '' : 'disabled'}>Preise anpassen (${recCount})</button>` : ''}</div>`,
  })
}
registerModal('fvt-kv', kvModal, { module: MODULE })

/** Eintrag im Menü „Läufe“ der Fakturierung. */
export const contractRunMenuItem = () => ({ label: 'Preisanpassung', action: 'fvt-kv-open', hint: 'nach KV-Lohnerhöhung, mit Vorschau je Vertrag' })

// ---------------------------------------------------------------- Erinnerungen

/** Erinnerungen von heute (gemerkt je Datenstand). */
export const remindersNow = (today = todayISO()) => (app.data?.fakturierung ? memo(app.cur, `fvt:remind:${today}`, () => contractReminders(F(), today)) : [])

registerTodo({
  id: 'fakturierung-vertraege',
  module: MODULE,
  title: 'Verträge',
  compute: (today) => remindersNow(today),
  render: (items) =>
    items
      .map((x) => `<div class="todo-item"><span class="flag ${x.kind === 'gekuendigt' ? 'error' : 'warning'}">${x.kind === 'gekuendigt' ? '!' : esc(de(x.date).replace(/\.\d{4}$/, '.'))}</span><div class="todo-text"><strong>${esc(x.text)}</strong><br><span class="muted">${esc(custName(x.customerId))} · ${esc(x.detail || '')}</span></div><button class="btn small primary" data-action="fvt-goto" data-id="${esc(x.contractId)}">Öffnen</button></div>`)
      .join(''),
})

// digitaler Mitarbeiter Buchhaltung: dieselben Erinnerungen, nur „Öffnen“
buchhaltungHooks.push((today) =>
  remindersNow(today).map((x) => ({
    id: `fvt:${x.id}`,
    agent: 'buchhaltung',
    prio: x.kind === 'gekuendigt' || addDaysIso(today, 7) >= x.date ? 1 : 2,
    title: x.text,
    text: `${custName(x.customerId)}: ${x.detail}. Öffnen zeigt den Vertrag mit allen Fristen; ich ändere dabei nichts selbst.`,
    open: { label: 'Öffnen', action: 'fvt-goto', data: { id: x.contractId } },
  })),
)

// Kennzahlen: Vertragsvolumen je Monat, Kündigungen, auslaufende Verträge (gezeichnet in views/kpi.js)
kpiHooks.vertraege = ({ months, today }) => (app.data?.fakturierung ? contractKpi(F(), months, today, S()) : null)

// ---------------------------------------------------------------- Aktionen

function saveContract(m) {
  const d = F()
  const v = readContract(m)
  const errors = contractProblems(v).filter((p) => p.level === 'error')
  if (errors.length) {
    renderModal()
    toast(errors[0].text)
    return null
  }
  const at = nowIso()
  const old = contractOf(v.id)
  const fresh = clean(v)
  const history = [...(old?.history || [])]
  const newCancel = fresh.cancel && !old?.cancel?.recordedAt
  if (newCancel) {
    fresh.cancel = { ...fresh.cancel, recordedAt: at, recordedBy: by() }
    history.push({ at, by: by(), text: `Kündigung ${CANCEL_BY[fresh.cancel.by] || ''} am ${de(fresh.cancel.at)} zum ${de(fresh.cancel.to)}${fresh.cancel.reason ? ` (${fresh.cancel.reason})` : ''}` })
  } else history.push({ at, by: by(), text: old ? 'geändert' : 'angelegt' })
  const saved = { ...fresh, history, ...(old ? { createdAt: old.createdAt, createdBy: old.createdBy } : { createdAt: at, createdBy: by() }), updatedAt: at, updatedBy: by() }
  const i = d.contracts.findIndex((c) => c.id === v.id)
  if (i >= 0) d.contracts[i] = saved
  else d.contracts.push(saved)
  // Daueraufträge zuordnen (ein Dauerauftrag gehört zu höchstens einem Vertrag)
  const want = new Set(m.recIds || [])
  d.recurring = d.recurring.map((r) => {
    if (want.has(r.id) && r.contractId !== v.id) return { ...r, contractId: v.id }
    if (!want.has(r.id) && r.contractId === v.id) {
      const { contractId, ...rest } = r
      return rest
    }
    return r
  })
  let ended = null
  if (newCancel && m.endRecs !== false) {
    ended = endRecurring(d.recurring, v.id, saved.cancel.to)
    d.recurring = ended.recurring
  }
  return { saved, ended, isNew: !old }
}

function openContract(id, extra = {}) {
  app.ui.confirm = null
  openModal({ type: 'fvt-edit', id, ...extra })
}

registerActions({
  'fvt-filter': (el) => {
    app.ui.fvtFilter = el.dataset?.v || val('fvt-filter')
    renderNow()
  },
  'fvt-search': () => {
    app.ui.fvtSearch = val('fvt-search')
    renderNow()
    const el = document.getElementById('fvt-search')
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  },
  'fvt-open': (el) => openContract(el?.dataset?.id || '', el?.dataset?.customer ? { customerId: el.dataset.customer } : {}),
  'fvt-goto': (el) => {
    app.ui.view = 'fakturierung'
    app.ui.fakTab = 'vertraege'
    closeModal()
    renderNow()
    if (el?.dataset?.id && contractOf(el.dataset.id)) openContract(el.dataset.id)
  },
  'fvt-calc': () => {
    const m = app.ui.modal
    if (m?.type !== 'fvt-edit') return
    readContract(m)
    const box = document.getElementById('fvt-calc')
    if (box) box.innerHTML = calcBox(m.draft)
  },
  'fvt-redraw': () => {
    const m = app.ui.modal
    if (m?.type !== 'fvt-edit') return
    const before = m.draft.customerId
    readContract(m)
    if (before !== m.draft.customerId && !m.id) m.draft.objectIds = [...(custOf(m.draft.customerId)?.objectIds || [])]
    renderModal()
  },
  'fvt-doc-open': () => openDocument(app.ui.modal?.draft?.document),
  'fvt-kv-open': () => {
    app.ui.view = 'fakturierung'
    closeModal()
    renderNow()
    openModal({ type: 'fvt-kv' })
  },
  'fvt-kv-calc': () => {
    const m = app.ui.modal
    if (m?.type !== 'fvt-kv') return
    const focus = document.activeElement?.id
    const percent = val('fvt-kv-pct').trim()
    const from = val('fvt-kv-from') || m.from
    if (percent === m.percent && from === m.from) return
    m.percent = percent
    m.from = from
    m.sel = null
    renderModal()
    const el = focus && document.getElementById(focus)
    if (el) {
      el.focus()
      if (el.type === 'text') el.setSelectionRange(el.value.length, el.value.length)
    }
  },
  'fvt-kv-pick': (el) => {
    const m = app.ui.modal
    m.sel ||= {}
    m.sel[el.dataset.id] = el.checked
    renderModal()
  },
})

registerActions(
  {
    'fvt-save': () => {
      const m = app.ui.modal
      if (m?.type !== 'fvt-edit') return
      const r = saveContract(m)
      if (!r) return
      closeModal()
      persist()
      renderNow()
      toast(`Vertrag gespeichert.${r.ended?.changed.length ? ` ${plural(r.ended.changed.length, 'Dauerauftrag endet', 'Daueraufträge enden')} mit ${monthLabel(r.saved.cancel.to.slice(0, 7))}${r.ended.partial ? ' (letzter Monat anteilig: im Entwurf anpassen)' : ''}.` : ''}`)
    },
    'fvt-del': (el) => {
      if (!confirmStep(`fvt-del:${el.dataset.id}`, renderModal)) return
      const d = F()
      d.contracts = d.contracts.filter((c) => c.id !== el.dataset.id)
      d.recurring = d.recurring.map((r) => {
        if (r.contractId !== el.dataset.id) return r
        const { contractId, ...rest } = r
        return rest
      })
      closeModal()
      persist()
      renderNow()
      toast('Vertrag gelöscht. Daueraufträge und Rechnungen bleiben.')
    },
    'fvt-doc': async (el) => {
      const m = app.ui.modal
      const file = el.files?.[0]
      if (m?.type !== 'fvt-edit' || !file) return
      readContract(m)
      const meta = await storeDocument(m.draft, file)
      if (!meta) return
      m.draft.document = meta
      // gleich am gespeicherten Vertrag vermerken (die Datei liegt schon in SharePoint)
      const saved = contractOf(m.draft.id)
      if (saved) {
        saved.document = meta
        saved.history = [...(saved.history || []), { at: nowIso(), by: by(), text: `Vertragsdokument abgelegt (${file.name})` }]
        persist()
      }
      renderModal()
      toast(meta.local ? 'PDF angehängt (Browser-Modus: nur Vorschau, nicht gespeichert).' : 'Vertragsdokument in SharePoint abgelegt.')
    },
    'fvt-cancel-open': () => {
      const m = app.ui.modal
      if (m?.type !== 'fvt-edit') return
      readContract(m)
      const at = todayISO()
      m.draft.cancel = { at, by: 'kunde', to: earliestEnd({ ...m.draft, cancel: null }, at), reason: '' }
      m.endRecs = true
      renderModal()
    },
    'fvt-c-at': () => {
      const m = app.ui.modal
      if (m?.type !== 'fvt-edit' || !m.draft.cancel) return
      const prev = m.draft.cancel.at
      readContract(m)
      if (m.draft.cancel.at === prev) return
      // „zum“ mitziehen, solange es der Vorschlag war (ohne neu zu zeichnen: das Datumsfeld behält den Fokus)
      if (m.draft.cancel.to === earliestEnd({ ...m.draft, cancel: null }, prev) || !m.draft.cancel.to) {
        m.draft.cancel.to = earliestEnd({ ...m.draft, cancel: null }, m.draft.cancel.at || todayISO())
        const to = document.getElementById('fvt-c-to')
        if (to) to.value = m.draft.cancel.to
      }
      const hint = document.getElementById('fvt-c-hint')
      if (hint) hint.innerHTML = earliestHint(m.draft)
      const box = document.getElementById('fvt-calc')
      if (box) box.innerHTML = calcBox(m.draft)
    },
    'fvt-cancel-undo': () => {
      const m = app.ui.modal
      if (m?.type !== 'fvt-edit') return
      if (m.draft.cancel?.recordedAt && !confirmStep(`fvt-cu:${m.draft.id}`, renderModal)) return
      readContract(m)
      const saved = contractOf(m.draft.id)
      delete m.draft.cancel
      if (saved?.cancel) {
        delete saved.cancel
        saved.history = [...(saved.history || []), { at: nowIso(), by: by(), text: 'Kündigung zurückgenommen (Daueraufträge bitte prüfen)' }]
        persist()
        toast('Kündigung zurückgenommen. Das Ende der Daueraufträge bitte im Dauerauftrag prüfen.')
      }
      renderModal()
      renderNow()
    },
    'fvt-done': () => {
      const m = app.ui.modal
      const saved = m?.type === 'fvt-edit' && contractOf(m.draft.id)
      if (!saved?.cancel) return
      const at = nowIso()
      saved.cancel = { ...saved.cancel, doneAt: at, doneBy: by() }
      saved.history = [...(saved.history || []), { at, by: by(), text: 'Kündigung erledigt: Dauerauftrag beendet, Objekt freigegeben' }]
      m.draft.cancel = structuredClone(saved.cancel)
      persist()
      renderModal()
      renderNow()
      toast('Erledigt. Die Erinnerung verschwindet aus „Zu erledigen“.')
    },
    'fvt-kv-apply': async (el) => {
      const m = app.ui.modal
      if (m?.type !== 'fvt-kv' || m.busy) return
      m.busy = true
      el.disabled = true
      try {
        // erst den Stand der anderen holen (z. B. inzwischen abgerechnete Monate)
        await app.service?.flush?.().catch(() => {})
        await app.service?.refresh?.().catch(() => [])
        const d = F()
        const plan = planKvRun(d, { percent: m.percent, from: m.from, today: todayISO(), settings: S(), names: customerNames() })
        const ids = Object.entries(m.sel || {})
          .filter(([, on]) => on)
          .map(([id]) => id)
        const runId = uid('pa')
        const r = applyKvRun(d, plan, ids, { runId, at: nowIso(), by: by(), newId: () => uid('st') })
        if (!r.count) throw new Error('Nichts anzupassen.')
        d.recurring = r.recurring
        d.contracts = r.contracts
        d.priceRuns.push(r.run)
        persist()
        await app.service?.flush?.().catch(() => {})
        m.done = { count: r.count, runId }
        m.busy = false
        renderModal()
        renderNow()
        toast(`${plural(r.count, 'Dauerauftrag', 'Daueraufträge')} ab ${monthLabel(plan.fromMonth)} angepasst. Festgeschriebene Rechnungen bleiben unverändert.`)
      } catch (err) {
        m.busy = false
        renderModal()
        toast(`Nicht angepasst: ${err.message}`)
      }
    },
    'fvt-kv-letter': (el) => {
      const d = F()
      const run = d.priceRuns.find((r) => r.id === el.dataset.id)
      if (!run) return
      run.serialId ||= uid('sb')
      persist()
      closeModal()
      openSerialDraft({ id: run.serialId, date: todayISO(), subject: KV_LETTER.subject, text: KV_LETTER.text, advertising: false, filter: { scope: 'alle', group: '', objectId: '', type: '', role: '', search: '', ids: [...new Set(run.items.map((i) => i.customerId))] }, values: letterValues(run, d.contracts), source: { type: 'preisanpassung', runId: run.id } })
    },
    'fvt-kv-undo': (el) => {
      if (!confirmStep(`fvt-ku:${el.dataset.id}`, renderModal)) return
      const d = F()
      const r = undoKvRun(d, el.dataset.id)
      d.recurring = r.recurring
      const run = d.priceRuns.find((x) => x.id === el.dataset.id)
      if (run) run.undone = { at: nowIso(), by: by(), removed: r.removed }
      persist()
      renderModal()
      renderNow()
      toast(`${plural(r.removed, 'geplante Preisanpassung', 'geplante Preisanpassungen')} zurückgenommen${r.kept ? `, ${r.kept} schon im Monatslauf übernommen (bleiben)` : ''}.`)
    },
  },
  { edit: MODULE },
)

