// Anlagen & Prüffristen (Objektservice / Hausbetreuung): je Objekt Anlagen mit Prüffrist (Feuerlöscher,
// Rauchwarnmelder, Notbeleuchtung, Spielplatz, Lift …), Prüfung erfassen am Handy mit Foto und Prüfbericht
// (in SharePoint unter anlagen/nachweise/), nächste Fälligkeit ab dem Prüfdatum, offene Mängel bis „behoben“,
// Anlagenliste als PDF für die Hausverwaltung, verrechenbare Prüfungen je Monat mit Stand der Verrechnung und
// „Rechnungsentwurf“ je Kunde (wer die Fakturierung bearbeitet; core/anlagen-rechnung.js), „Zu erledigen“,
// Hinweis im Einsatz-Dialog. Datei anlagen/anlagen.json (Rechenkern: core/anlagen.js). Der digitale
// Mitarbeiter „Fristen“ (disponent.js) liest dieselbe Datei. Aktionen und Dialoge mit dem Kürzel „anl-“.

import { addCheck, allTypes, ANLAGEN_DEFAULTS, anlagenRows, attention, BY, billableChecks, CHECK_KINDS, checkProblem, checksOf, counts, emptyAnlagen, filterRows, intervalOf, isDefectOpen, isUrgent, itemProblem, nextAfter, openDefects, operativeOf, resolveDefect, RESULTS, STATES, STATUS_FILTERS, typeOf, typesOf } from '../../core/anlagen.js'
import { addAnlageLines, ANLAGE_STATES, anlageLock, checkBillState, checksToBill } from '../../core/anlagen-rechnung.js'
import { addDays, formatDate, todayISO } from '../../core/dates.js'
import { settingsOf as fakSettings } from '../../core/invoicing.js'
import { toCSV } from '../../core/reports.js'
import { anlagenDocument, anlagenPdfName, stateText } from '../../export/anlagen-pdf.js'
import { ACTIONS, app, canEdit, closeModal, confirmStep, memo, openModal, persist, registerActions, registerModal, registerObjectHint, registerView, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, download, esc, euro, ICON, menu, modalFrame, options, tabBar, uid, val } from '../shared.js'
import { abrechnungHooks } from './invoicing-abrechnung.js'

const MODULE = 'anlagen'
const ICON_ANL = '<path d="M9 8.5h6v11a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 19.5z"/><path d="M12 8.5V5.5M9.5 5.5H15l2.5-2.5M12 5.5c-2.2 0-4.6.8-5.5 3.2"/><path d="M9 12.5h6"/>'
const MOBILE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 5.5h4v7.3a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 5.5V3.5M6.3 3.5H10l1.7-1.6M8 3.5c-1.5 0-3 .5-3.6 2.1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const doc = () => {
  const d = (app.data.anlagen ||= emptyAnlagen())
  d.types ||= []
  d.items ||= []
  d.checks ||= []
  d.settings ||= {}
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const objName = (id) => objOf(id)?.name || 'Objekt'
const itemOf = (id) => doc().items.find((i) => i.id === id)
const checkOf = (id) => doc().checks.find((c) => c.id === id)
const typeName = (item) => typeOf(doc(), item?.typeId)?.name || 'Anlage'
const short = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const STATE_CLS = { ueberfaellig: 'error', faellig: 'warning', ok: 'ok', inaktiv: 'na' }
const RESULT_CLS = { ok: 'ok', maengel: 'warning', ausser: 'error' }
const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
const parsePrice = (v) => Math.round((Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')) || 0) * 100) / 100
const sees = (m) => !app.access || app.access.sees(m)
/** Fakturierung, wenn lesbar (sonst null: Stand der Verrechnung aus billed an der Prüfung). */
const fak = () => (sees('fakturierung') ? app.data.fakturierung || null : null)
const fakDocs = () => fak()?.documents || null
/** Rechnungsentwurf erstellen: Schreibrecht auf die Fakturierung (die Fakturierung ist mit diesem Paket geladen). */
const mayInvoice = () => canEdit('fakturierung') && !app.readOnly && !!fak() && !!abrechnungHooks.newDraft
const BILL_CLS = { offen: 'info', entwurf: 'warning', verrechnet: 'ok' }
const billPill = (st) => (!st ? '' : `<span class="pill ${BILL_CLS[st.state]}">${esc(st.state === 'verrechnet' && st.number ? `verrechnet: ${st.number}` : ANLAGE_STATES[st.state])}</span>`)

/** Alle Anlagen mit Zustand (je Berechnung gemerkt). */
const rowsAt = (today = todayISO()) => memo(app.cur, `anlagen:${today}`, () => anlagenRows({ doc: doc(), objects: app.data.objects, today }))
const rowOf = (id) => rowsAt().find((r) => r.item.id === id)

/** Vor dem ersten Ändern der Arten die Vorgaben in die Datei übernehmen. */
function ownTypes() {
  if (!doc().types.length) doc().types = structuredClone(ANLAGEN_DEFAULTS)
  return doc().types
}

/** Kunde zum Objekt aus der Fakturierung (nur wer sie sieht). */
function customerOf(objectId) {
  const c = (app.data.fakturierung?.customers || []).find((x) => (x.objectIds || []).includes(objectId))
  return c ? c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') : ''
}

/** Text zur Frist: „überfällig seit 31.08.2026“, „fällig am 30.11.2026“, „noch keine Prüfung“, „bis 03.2028“. */
function dueText(r) {
  if (r.state === 'inaktiv') return 'inaktiv'
  if (!r.next) return r.dues.some((d) => d.noInterval) ? 'Intervall fehlt' : 'noch keine Prüfung'
  if (r.state === 'ueberfaellig') return `überfällig seit ${short(r.next)}`
  if (r.state === 'faellig') return `fällig am ${short(r.next)}`
  return `nächste am ${short(r.next)}`
}
const statePill = (r) => `<span class="pill ${STATE_CLS[r.state]}">${esc(r.state === 'faellig' && !r.next ? 'fällig' : STATES[r.state])}</span>`
const defectPill = (r) => (r.defects.length ? ` <span class="pill ${r.defects.some((c) => c.result === 'ausser') ? 'error' : 'warning'}">${r.defects.some((c) => c.result === 'ausser') ? 'außer Betrieb' : r.defects.length === 1 ? 'Mangel offen' : `${r.defects.length} Mängel offen`}</span>` : '')
const intervalText = (r) => r.dues.map((d) => (d.months ? `${d.months} ${d.months === 1 ? 'Monat' : 'Monate'}${d.kind === 'operativ' ? ' (operativ)' : ''}` : 'ohne Intervall')).join('<br>') || '–'
/** „⋯“ in der Zeile, auch mit nur einem Eintrag (die erste Spalte öffnet die Anlage ohnehin). */
const moreMenu = (items) => menu({ icon: ICON.more, title: 'Weitere Aktionen', btn: 'small ghost icon', caret: false, items, cls: 'row-menu', single: false })
const whoText = (item) => (item.by === 'fremd' ? `${esc(item.company || 'Fremdfirma')}${item.contact ? `<br><span class="muted">${esc(item.contact)}</span>` : ''}` : 'eigene Leute')

// ---------------------------------------------------------------- Dateien (Fotos, Prüfbericht)

// Browser-Modus: Dateien nur in diesem Fenster; mit SharePoint unter anlagen/nachweise/<Jahr>/ (ohne Netz wartet
// das Hochladen im Gerät, siehe storage/offline.js)
const LOCAL = new Map()

/** Foto verkleinern (Handy: oft 4–8 MB): längste Seite höchstens 2000 Pixel, JPEG. PDFs und kleine Bilder bleiben. */
async function shrink(file) {
  if (!/^image\//.test(file.type) || file.size < 600e3 || typeof createImageBitmap !== 'function') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
    return blob && blob.size < file.size ? new File([blob], `${file.name.replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

/**
 * Datei ablegen; liefert { path, name, type, size, at, by, url?, queued?, local? } oder null (mit Meldung).
 * Auch für Geräte & Maschinen (views/geraete.js: Fotos, Anleitungen, Rechnungen, Prüfprotokolle).
 */
export async function storeFile(file, base) {
  if (file.size > 15e6) {
    toast(`${file.name}: zu groß (höchstens 15 MB).`)
    return null
  }
  const f = await shrink(file)
  const ext = (f.name.match(/\.(\w{2,4})$/)?.[1] || (f.type === 'application/pdf' ? 'pdf' : 'jpg')).toLowerCase()
  const path = `${base}.${ext}`
  const meta = { path, name: file.name, type: f.type || 'application/octet-stream', size: f.size, at: nowIso(), by: user() }
  if (app.store?.kind !== 'sharepoint') {
    LOCAL.set(path, f)
    return { ...meta, local: true }
  }
  try {
    const up = await app.store.upload(path, f, meta.type)
    return { ...meta, ...(up?.webUrl ? { url: up.webUrl } : {}), ...(up?.queued ? { queued: true } : {}) }
  } catch (err) {
    toast(`${file.name} nicht gespeichert: ${err.message}`)
    return null
  }
}

export async function openFile(meta) {
  if (!meta) return
  const local = LOCAL.get(meta.path)
  if (local) return void window.open(URL.createObjectURL(local), '_blank', 'noopener')
  if (meta.local) return toast('Im Browser-Modus werden Fotos und Dateien nicht gespeichert (nur im Betrieb mit SharePoint).')
  if (meta.url) return void window.open(meta.url, '_blank', 'noopener')
  try {
    const blob = await app.store.readBlob?.(meta.path)
    if (!blob) return toast(meta.queued ? 'Die Datei wartet noch im Gerät aufs Hochladen.' : 'Datei nicht gefunden.')
    window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  } catch (err) {
    toast(`Datei nicht geöffnet: ${err.message}`)
  }
}

const fileChips = (c) =>
  [
    ...(c.photos || []).map((p, i) => `<button type="button" class="pill anl-file" data-action="anl-file" data-check="${esc(c.id)}" data-i="${i}" title="${esc(p.name)}">${ICON.camera} Foto ${i + 1}</button>`),
    c.report ? `<button type="button" class="pill anl-file" data-action="anl-file" data-check="${esc(c.id)}" data-i="report" title="${esc(c.report.name)}">${ICON.download} Prüfbericht</button>` : '',
  ].join(' ')

// ---------------------------------------------------------------- Ansicht

function anlagenView() {
  const today = todayISO()
  const all = rowsAt(today)
  const ed = editable()
  const tab = ['maengel', 'verrechnung'].includes(app.ui.anlTab) ? app.ui.anlTab : 'liste'
  const n = counts(all)
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const head = `<div class="section-head"><div><h2>Anlagen &amp; Prüffristen</h2><p>Je Objekt die Anlagen mit Prüffrist: Prüfung vor Ort am Handy erfassen (mit Foto und Prüfbericht), die nächste Frist rechnet die App ab dem Prüfdatum. Mängel bleiben offen, bis sie behoben sind.</p></div>
      <div class="actions">${ed && all.length ? `<button class="btn primary" data-action="anl-check-open">${ICON.check} Prüfung erfassen</button>` : ''}${menu({
        label: 'Mehr',
        single: false,
        items: [
          ed && { label: 'Anlage anlegen', icon: ICON.plus, action: 'anl-edit-open', hint: 'Objekt, Art, Standort, Intervall' },
          ed && { label: 'Arten und Intervalle', icon: ICON.gear, action: 'anl-types-open', hint: 'Vorschläge anpassen' },
          { heading: 'Export' },
          app.ui.anlObj && { label: 'Anlagenliste (PDF)', icon: ICON.download, action: 'anl-pdf', data: { obj: app.ui.anlObj }, hint: esc(objName(app.ui.anlObj)), mail: { subject: `Anlagen und Prüfungen ${objName(app.ui.anlObj)}` } },
          all.length && { label: 'Liste (CSV)', icon: ICON.download, action: 'anl-csv', mail: true },
        ],
      })}</div></div>`
  if (!all.length)
    return `${head}<div class="banner welcome"><p><strong>Noch keine Anlagen.</strong> Je Objekt die Anlagen mit Prüffrist anlegen, z. B. Feuerlöscher, Rauchwarnmelder, Notbeleuchtung, Spielplatz oder Lift. Die Intervalle sind Vorschläge und lassen sich je Anlage ändern.</p>${ed ? `<button class="btn primary" data-action="anl-edit-open">${ICON.plus} Anlage anlegen</button>` : ''}</div>${basisNote()}`
  const defectCount = doc().checks.filter(isDefectOpen).length
  const tabs = tabBar({
    action: 'anl-tab',
    current: tab,
    tabs: [
      { id: 'liste', label: 'Anlagen' },
      { id: 'maengel', label: 'Mängel', flag: defectCount },
      { id: 'verrechnung', label: 'Verrechnung' },
    ],
  })
  const body = tab === 'maengel' ? defectsTab() : tab === 'verrechnung' ? billingTab() : listTab(all)
  return `${head}
    <div class="impact-stats tc-stats">${tile('überfällig', n.ueberfaellig, n.ueberfaellig ? 'err' : '')}${tile('bald fällig', n.faellig)}${tile('Mängel offen', n.maengel, n.maengel ? 'err' : '')}${tile('Anlagen', n.aktiv)}</div>
    ${tabs}${body}`
}

const basisNote = () => '<p class="note">Intervalle und Grundlagen der Arten sind Vorschläge ohne Gewähr, keine Rechtsauskunft. Bitte mit Hersteller, Prüfstelle oder Sicherheitsfachkraft bestätigen und unter „Mehr“ → „Arten und Intervalle“ anpassen.</p>'

function listTab(all) {
  const ed = editable()
  const f = { objectId: app.ui.anlObj || '', region: app.ui.anlRegion || '', typeId: app.ui.anlType || '', status: app.ui.anlStatus || '' }
  const rows = filterRows(all, f)
  const objectIds = [...new Set(all.map((r) => r.item.objectId))]
  const objects = objectIds.map((id) => [id, objName(id)]).sort((a, b) => a[1].localeCompare(b[1], 'de'))
  const regions = [...new Set(all.map((r) => r.object?.region).filter(Boolean))].sort()
  const usedTypes = [...new Set(all.map((r) => r.item.typeId))].map((id) => [id, typeOf(doc(), id)?.name || id]).sort((a, b) => a[1].localeCompare(b[1], 'de'))
  const filtered = f.objectId || f.region || f.typeId || f.status
  const filters = `<div class="filters anl-filters">
      <label class="field inline"><span>Objekt</span><select id="anl-f-obj" data-change="anl-filter">${options(objects, f.objectId, { empty: 'alle' })}</select></label>
      ${regions.length > 1 ? `<label class="field inline"><span>Revier</span><select id="anl-f-region" data-change="anl-filter">${options(regions.map((x) => [x, x]), f.region, { empty: 'alle' })}</select></label>` : ''}
      <label class="field inline"><span>Art</span><select id="anl-f-type" data-change="anl-filter">${options(usedTypes, f.typeId, { empty: 'alle' })}</select></label>
      <label class="field inline"><span>Status</span><select id="anl-f-status" data-change="anl-filter">${options(Object.entries(STATUS_FILTERS), f.status)}</select></label>
      ${filtered ? '<button class="btn small ghost" data-action="anl-reset">Filter zurücksetzen</button>' : ''}</div>`
  const groups = new Map()
  for (const r of rows) groups.set(r.item.objectId, [...(groups.get(r.item.objectId) || []), r])
  const blocks = [...groups]
    .map(([objectId, list]) => {
      const o = objOf(objectId) || {}
      const lines = list
        .map((r) => {
          const acts = `${ed && r.state !== 'inaktiv' ? `<button class="btn small primary" data-action="anl-check-open" data-id="${esc(r.item.id)}">Prüfung</button> ` : ''}${moreMenu([
            { label: ed ? 'Bearbeiten und Verlauf' : 'Ansehen und Verlauf', action: 'anl-edit-open', data: { id: r.item.id } },
            canEdit('termine') && !app.readOnly && r.state !== 'inaktiv' && { label: 'Termin in Outlook', icon: ICON.calendar, action: 'anl-appt', data: { id: r.item.id }, hint: 'unter Termine' },
          ])}`
          return `<tr><td class="clickable" data-action="anl-edit-open" data-id="${esc(r.item.id)}"><strong>${esc(r.type?.name || 'Anlage')}</strong><br>${esc(r.item.label || '')}${Number(r.item.count) > 1 ? ` <span class="muted">· ${esc(r.item.count)} Stück</span>` : ''}</td>
            <td>${whoText(r.item)}</td><td>${intervalText(r)}</td>
            <td>${r.last ? `${short(r.last.date)} <span class="pill ${RESULT_CLS[r.last.result]}">${esc(RESULTS[r.last.result])}</span>` : '<span class="muted">noch keine</span>'}</td>
            <td>${esc(dueText(r))}</td><td>${statePill(r)}${defectPill(r)}</td><td class="actions-cell">${acts}</td></tr>`
        })
        .join('')
      return `<section class="anl-obj"><div class="section-head small"><h3>${esc(o.name || 'Objekt')} <span class="muted anl-addr">${esc([o.address, o.region && !String(o.address || '').includes(o.region) ? o.region : ''].filter(Boolean).join(' · '))}</span></h3>
          <div class="actions"><button class="btn small" data-action="anl-pdf" data-obj="${esc(objectId)}" title="Anlagenliste und Prüfnachweis für die Hausverwaltung">${ICON.download} Anlagenliste</button>${ed ? `<button class="btn small" data-action="anl-edit-open" data-obj="${esc(objectId)}">${ICON.plus} Anlage</button>` : ''}</div></div>
        <div class="table-wrap"><table class="data anl-table"><thead><tr><th>Anlage</th><th>zuständig</th><th>Intervall</th><th>zuletzt geprüft</th><th>Frist</th><th>Status</th><th></th></tr></thead><tbody>${lines}</tbody></table></div></section>`
    })
    .join('')
  return `${filters}${blocks || `<p class="empty">Keine Anlage in dieser Auswahl.${filtered ? ' Filter zurücksetzen zeigt alle.' : ''}</p>`}${basisNote()}`
}

function defectsTab() {
  const ed = editable()
  const today = todayISO()
  const showAll = !!app.ui.anlDefAll
  const list = doc()
    .checks.filter((c) => isDefectOpen(c) || (showAll && (c.result === 'maengel' || c.result === 'ausser') && c.resolved && c.resolved.date >= addDays(today, -90)))
    .sort((a, b) => Number(!!a.resolved) - Number(!!b.resolved) || a.date.localeCompare(b.date))
  const rows = list
    .map((c) => {
      const item = itemOf(c.itemId)
      if (!item) return ''
      return `<tr><td>${short(c.date)}</td><td>${esc(objName(item.objectId))}</td><td class="clickable" data-action="anl-edit-open" data-id="${esc(item.id)}"><strong>${esc(typeName(item))}</strong><br>${esc(item.label || '')}</td>
        <td>${esc(c.defects || RESULTS[c.result])}${fileChips(c) ? `<br>${fileChips(c)}` : ''}</td>
        <td>${c.resolved ? `<span class="pill ok">behoben ${short(c.resolved.date)}</span>${c.resolved.note ? `<br><span class="muted">${esc(c.resolved.note)}</span>` : ''}` : `<span class="pill ${RESULT_CLS[c.result]}">${esc(RESULTS[c.result])}</span>`}</td>
        <td class="actions-cell">${ed && !c.resolved ? `<button class="btn small primary" data-action="anl-defect-open" data-id="${esc(c.id)}">Behoben</button>` : ''}</td></tr>`
    })
    .join('')
  return `<div class="filters"><label class="check"><input type="checkbox" id="anl-def-all" ${showAll ? 'checked' : ''} data-change="anl-def-all"><span>auch behobene (letzte 90 Tage)</span></label></div>
    ${rows ? `<div class="table-wrap"><table class="data anl-table"><thead><tr><th>seit</th><th>Objekt</th><th>Anlage</th><th>Mangel</th><th>Zustand</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine offenen Mängel.</p>'}
    <p class="note">Ein Mangel bleibt offen, bis er als behoben vermerkt ist (Datum und was getan wurde). Eine Prüfung „in Ordnung“ kann offene Mängel der Anlage gleich mit schließen.</p>`
}

/** Offene verrechenbare Prüfungen je Kunde (aus allen Monaten) mit „Rechnungsentwurf“, dazu die Entwürfe. */
function toBillSection() {
  const f = fak()
  if (!f) return ''
  const open = checksToBill({ doc: doc(), objects: app.data.objects, fak: f })
  const drafts = checksToBill({ doc: doc(), objects: app.data.objects, fak: f, states: ['entwurf'] })
  if (!open.length && !drafts.length) return ''
  const may = mayInvoice()
  const span = (g) => (g.from ? `${short(g.from)}${g.to && g.to !== g.from ? ` – ${short(g.to)}` : ''}` : '')
  const rows = open
    .map(
      (g) => `<tr><td><strong>${esc(g.customerId ? g.name : 'ohne Kunde')}</strong><br><span class="muted">${esc([...new Set(g.rows.map((r) => r.object?.name || 'Objekt'))].join(', '))}</span></td><td class="num">${g.rows.length}</td><td>${span(g)}</td><td class="num">${euro(g.sum)}</td>
        <td class="actions-cell">${g.customerId ? (may ? `<button class="btn small primary" data-action="anl-invoice" data-customer="${esc(g.customerId)}">Rechnungsentwurf</button>` : '') : '<span class="muted">Kunde zum Objekt fehlt (Fakturierung → Kunden)</span>'}</td></tr>`,
    )
    .join('')
  const docIds = [...new Set(drafts.flatMap((g) => g.rows.map((r) => r.state.docId)))]
  const draftLine = docIds.length
    ? `<p class="muted">Im Rechnungsentwurf: ${plural(drafts.reduce((s, g) => s + g.rows.length, 0), 'Prüfung', 'Prüfungen')} (${esc(drafts.map((g) => g.name || 'ohne Kunde').join(', '))}). ${docIds.map((id) => `<button class="btn small" data-action="anl-invoice-open" data-doc="${esc(id)}">Entwurf öffnen</button>`).join(' ')}</p>`
    : ''
  return `<section class="anl-obj anl-bill"><div class="section-head small"><h3>Offen zu verrechnen</h3></div>
    ${rows ? `<div class="table-wrap"><table class="data anl-table"><thead><tr><th>Kunde</th><th class="num">Prüfungen</th><th>Zeitraum</th><th class="num">netto</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Alle verrechenbaren Prüfungen stehen in einer Rechnung oder einem Entwurf.</p>'}
    ${draftLine}</section>`
}

function billingTab() {
  const month = /^\d{4}-\d\d$/.test(app.ui.anlMonth || '') ? app.ui.anlMonth : todayISO().slice(0, 7)
  const groups = billableChecks({ doc: doc(), objects: app.data.objects, month })
  const total = groups.reduce((s, g) => s + g.sum, 0)
  const docs = fakDocs()
  const blocks = groups
    .map((g) => {
      const cust = customerOf(g.objectId)
      const rows = g.rows.map(({ check: c, item, type }) => `<tr><td>${short(c.date)}</td><td><strong>${esc(type?.name || 'Anlage')}</strong><br>${esc(item.label || '')}</td><td><span class="pill ${RESULT_CLS[c.result]}">${esc(RESULTS[c.result])}</span></td><td>${esc(c.by || '')}</td><td class="num">${euro(c.price)}</td><td>${billPill(checkBillState(c, docs))}</td></tr>`).join('')
      return `<section class="anl-obj"><div class="section-head small"><h3>${esc(g.object?.name || 'Objekt')}${cust ? ` <span class="muted anl-addr">Kunde: ${esc(cust)}</span>` : ''}</h3></div>
        <div class="table-wrap"><table class="data anl-table"><thead><tr><th>Datum</th><th>Anlage</th><th>Ergebnis</th><th>geprüft von</th><th class="num">Preis</th><th>Verrechnung</th></tr></thead><tbody>${rows}<tr class="anl-sum"><td colspan="4"><strong>Summe ${esc(g.object?.name || '')}</strong></td><td class="num"><strong>${euro(g.sum)}</strong></td><td></td></tr></tbody></table></div></section>`
    })
    .join('')
  return `${toBillSection()}<div class="filters"><label class="field inline"><span>Monat</span><input type="month" id="anl-month" value="${esc(month)}" data-change="anl-month"></label>${groups.length ? `<button class="btn small" data-action="anl-bill-csv">${ICON.download} CSV</button>` : ''}</div>
    ${blocks ? `${blocks}<p><strong>Gesamt: ${euro(total)}</strong> (netto, ${plural(groups.reduce((s, g) => s + g.rows.length, 0), 'Prüfung', 'Prüfungen')})</p>` : '<p class="empty">Keine verrechenbaren Prüfungen in diesem Monat.</p>'}
    <p class="note">Verrechenbar sind Prüfungen von Anlagen mit „verrechenbar“ und Preis je Prüfung (Preis wie beim Erfassen). „Rechnungsentwurf“ übernimmt die offenen Prüfungen eines Kunden in die Fakturierung, eine Position je Prüfung mit Objekt, Anlage und Datum. Verrechnet sind sie mit dem Festschreiben; ein gelöschter Entwurf oder ein Storno gibt sie wieder frei.</p>`
}

registerView({
  id: 'anlagen',
  order: 76,
  label: 'Anlagen & Prüffristen',
  group: 'service',
  module: MODULE,
  icon: ICON_ANL,
  noWeek: true,
  mobile: { icon: MOBILE_ICON, label: 'Anlagen' },
  text: 'Feuerlöscher, Rauchmelder, Spielplatz: Prüfungen und Fristen',
  badge: () => {
    const n = counts(rowsAt())
    return n.ueberfaellig + n.maengel
  },
  render: anlagenView,
})

// ---------------------------------------------------------------- Anlage anlegen und bearbeiten

function itemDraft(m) {
  if (!m.draft) {
    const existing = m.id ? itemOf(m.id) : null
    const type = typesOf(doc())[0]
    m.draft = existing ? structuredClone(existing) : { id: '', objectId: m.objectId || app.ui.anlObj || '', typeId: m.typeId || type?.id || '', label: '', count: 1, maker: '', serial: '', months: '', operative: !!type?.operativeMonths, operativeMonths: '', firstDue: '', by: type?.by || 'eigen', company: '', contact: '', billable: false, price: '', note: '', active: true }
  }
  return m.draft
}

function readItem() {
  const d = itemDraft(app.ui.modal)
  if (!document.getElementById('anl-label')) return d
  const typeId = val('anl-type')
  if (!d.id && typeId !== d.typeId) {
    // neue Anlage: Vorgaben der neuen Art übernehmen (wer prüft, operative Inspektion)
    const t = typeOf(doc(), typeId)
    d.by = t?.by || d.by
    d.operative = !!t?.operativeMonths
  } else {
    d.by = val('anl-by') || d.by
    d.operative = checked('anl-op')
  }
  Object.assign(d, {
    objectId: val('anl-obj'),
    typeId,
    label: val('anl-label').trim(),
    count: Math.max(1, Math.round(Number(val('anl-count')) || 1)),
    maker: val('anl-maker').trim(),
    serial: val('anl-serial').trim(),
    months: val('anl-months') ? Math.max(0, Math.round(Number(val('anl-months')) || 0)) || '' : '',
    operativeMonths: document.getElementById('anl-op-months') && val('anl-op-months') ? Math.max(0, Math.round(Number(val('anl-op-months')) || 0)) || '' : d.operativeMonths,
    firstDue: val('anl-first'),
    company: document.getElementById('anl-company') ? val('anl-company').trim() : d.company,
    contact: document.getElementById('anl-contact') ? val('anl-contact').trim() : d.contact,
    billable: checked('anl-bill'),
    price: document.getElementById('anl-price') ? val('anl-price').trim() : d.price,
    note: val('anl-note').trim(),
    active: checked('anl-active'),
  })
  return d
}

function editModal(c, m) {
  const d = itemDraft(m)
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const type = typeOf(doc(), d.typeId)
  const existing = d.id ? itemOf(d.id) : null
  const r = existing ? rowOf(existing.id) : null
  const typeList = typesOf(doc())
  if (type && !typeList.includes(type)) typeList.push(type)
  const history = existing ? checksOf(doc().checks, existing.id) : []
  const historyHtml = history.length
    ? `<section><h3>Verlauf</h3><ul class="tc-list anl-history">${history
        .map((h) => {
          const del = ed ? ` <button class="btn small ghost" data-action="anl-check-delete" data-id="${esc(h.id)}">${app.ui.confirm === `anl-cdel:${h.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''
          const defect = h.result !== 'ok' ? ` ${esc(h.defects || '')}${h.resolved ? ` <span class="pill ok">behoben ${short(h.resolved.date)}</span>${h.resolved.note ? ` <span class="muted">${esc(h.resolved.note)}</span>` : ''}` : ed ? ` <button class="btn small" data-action="anl-defect-open" data-id="${esc(h.id)}">Behoben</button>` : ''}` : ''
          return `<li><strong>${short(h.date)}</strong> ${h.kind === 'operativ' ? `${esc(CHECK_KINDS.operativ)} ` : ''}<span class="pill ${RESULT_CLS[h.result]}">${esc(RESULTS[h.result])}</span>${defect} <span class="muted">· ${esc(h.by || '')}${h.note ? ` · ${esc(h.note)}` : ''}${h.billable ? ` · ${euro(h.price)}` : ''}</span> ${fileChips(h)}${del}</li>`
        })
        .join('')}</ul></section>`
    : existing
      ? '<p class="muted">Noch keine Prüfung eingetragen.</p>'
      : ''
  const firstHint = history.length ? 'gilt nur, solange keine Prüfung eingetragen ist' : 'z. B. laut Plakette; leer = gleich fällig'
  return modalFrame({
    title: existing ? `${type?.name || 'Anlage'}: ${existing.label}` : 'Anlage anlegen',
    subtitle: existing ? `${esc(objName(existing.objectId))}${r ? ` · ${esc(dueText(r))}` : ''}` : '',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Objekt</span><select id="anl-obj" ${dis}>${options(app.data.objects.filter((o) => !o.inactive || o.id === d.objectId).map((o) => [o.id, o.name]), d.objectId, { empty: '– wählen –' })}</select></label>
        <label class="field"><span>Art</span><select id="anl-type" data-change="anl-redraw" ${dis}>${options(typeList.map((t) => [t.id, t.name]), d.typeId)}</select></label>
        <label class="field"><span>Bezeichnung / Standort</span><input type="text" id="anl-label" value="${esc(d.label)}" placeholder="z. B. Stiege 2, EG" ${dis}></label>
        <label class="field"><span>Anzahl</span><input type="number" id="anl-count" min="1" max="999" value="${esc(d.count || 1)}" ${dis}></label>
        <label class="field"><span>Hersteller (optional)</span><input type="text" id="anl-maker" value="${esc(d.maker || '')}" ${dis}></label>
        <label class="field"><span>Seriennummer (optional)</span><input type="text" id="anl-serial" value="${esc(d.serial || '')}" ${dis}></label>
        <label class="field"><span>Intervall in Monaten</span><input type="number" id="anl-months" min="1" max="120" value="${esc(d.months || '')}" placeholder="${type?.months ? esc(type.months) : 'eintragen'}" ${dis}><small class="muted">${type?.months ? `leer = ${type.months} (Vorschlag der Art)` : 'laut Hersteller oder Vertrag eintragen'}</small></label>
        <label class="field"><span>Nächste Prüfung fällig am</span><input type="date" id="anl-first" value="${esc(d.firstDue || '')}" ${dis}><small class="muted">${firstHint}</small></label>
        <label class="check wide"><input type="checkbox" id="anl-op" ${d.operative ? 'checked' : ''} data-change="anl-redraw" ${dis}><span>zusätzlich operative Inspektion (z. B. Spielplatz monatlich)</span></label>
        ${d.operative ? `<label class="field"><span>operative Inspektion alle … Monate</span><input type="number" id="anl-op-months" min="1" max="24" value="${esc(d.operativeMonths || '')}" placeholder="${esc(type?.operativeMonths || 1)}" ${dis}></label>` : ''}
        <label class="field"><span>Zuständig</span><select id="anl-by" data-change="anl-redraw" ${dis}>${options(Object.entries(BY), d.by)}</select></label>
        ${d.by === 'fremd' ? `<label class="field"><span>Fremdfirma</span><input type="text" id="anl-company" value="${esc(d.company || '')}" placeholder="z. B. Brandschutz Muster GmbH" ${dis}></label>
        <label class="field"><span>Kontakt</span><input type="text" id="anl-contact" value="${esc(d.contact || '')}" placeholder="Telefon, E-Mail" ${dis}></label>` : ''}
        <label class="check"><input type="checkbox" id="anl-bill" ${d.billable ? 'checked' : ''} data-change="anl-redraw" ${dis}><span>verrechenbar</span></label>
        ${d.billable ? `<label class="field"><span>Preis je Prüfung (netto, €)</span><input type="text" inputmode="decimal" id="anl-price" value="${esc(d.price ?? '')}" placeholder="z. B. 35,00" ${dis}></label>` : ''}
        <label class="field wide"><span>Notiz</span><input type="text" id="anl-note" value="${esc(d.note || '')}" placeholder="z. B. Schlüssel Technikraum beim Hausbesorger" ${dis}></label>
        <label class="check"><input type="checkbox" id="anl-active" ${d.active !== false ? 'checked' : ''} ${dis}><span>aktiv (inaktive haben keine Frist, der Verlauf bleibt)</span></label>
      </div>
      ${type ? `<p class="note"><strong>Vorschlag für ${esc(type.name)}:</strong> ${type.months ? `alle ${type.months} Monate` : 'Intervall je Anlage'}${type.operativeMonths ? `, operativ alle ${type.operativeMonths} ${type.operativeMonths === 1 ? 'Monat' : 'Monate'}` : ''}${type.basis ? ` · ${esc(type.basis)}` : ''}${type.note ? ` · ${esc(type.note)}` : ''}. Bitte prüfen, keine Rechtsauskunft.</p>` : ''}
      ${historyHtml}`,
    foot: `<div class="actions">${ed && existing && !history.length ? `<button class="btn danger" data-action="anl-delete" data-id="${esc(existing.id)}">${app.ui.confirm === `anl-del:${existing.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}${existing ? `<button class="btn" data-action="anl-pdf" data-obj="${esc(existing.objectId)}">${ICON.download} Anlagenliste</button>` : ''}</div>
      <div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed && existing && existing.active !== false ? `<button class="btn" data-action="anl-check-open" data-id="${esc(existing.id)}">Prüfung erfassen</button>` : ''}${ed ? '<button class="btn primary" data-action="anl-save">Speichern</button>' : ''}</div>`,
  })
}
registerModal('anl-edit', editModal, { module: MODULE })

function saveItem() {
  const d = readItem()
  const type = typeOf(doc(), d.typeId)
  const fields = { ...d, price: d.billable ? parsePrice(d.price) : '' }
  const problem = itemProblem(fields, type)
  if (problem) return toast(problem)
  const list = doc().items
  if (d.id) {
    doc().items = list.map((i) => (i.id === d.id ? { ...i, ...fields, changedAt: nowIso(), changedBy: user() } : i))
  } else {
    fields.id = uid('an')
    fields.createdAt = nowIso()
    fields.createdBy = user()
    list.push(fields)
  }
  persist()
  closeModal()
  renderNow()
  const r = rowOf(fields.id)
  toast(`${d.id ? 'Gespeichert' : `${type.name} angelegt`}${r ? `: ${dueText(r)}` : ''}.`)
}

// ---------------------------------------------------------------- Prüfung erfassen

function checkDraft(m) {
  if (!m.draft) {
    const item = m.id ? itemOf(m.id) : null
    m.draft = { itemId: item?.id || '', objectId: item?.objectId || m.objectId || app.ui.anlObj || '', kind: m.kind || 'haupt', date: todayISO(), result: 'ok', defects: '', by: '', note: '', billable: !!item?.billable, price: item?.billable ? String(item.price ?? '') : '', resolveOpen: true, photos: [], report: null }
    fillFromItem(m.draft, item)
  }
  return m.draft
}

/** Vorgaben der gewählten Anlage: wer prüft, verrechenbar, Art der Prüfung. */
function fillFromItem(d, item) {
  if (!item) {
    d.kind = 'haupt'
    return
  }
  d.by = item.by === 'fremd' ? item.company || '' : user()
  d.billable = !!item.billable
  d.price = item.billable ? String(item.price ?? '') : ''
  if (!operativeOf(item, typeOf(doc(), item.typeId))) d.kind = 'haupt'
}

function readCheck() {
  const d = checkDraft(app.ui.modal)
  if (!document.getElementById('anlc-date')) return d
  Object.assign(d, {
    kind: document.getElementById('anlc-kind') ? val('anlc-kind') : d.kind,
    date: val('anlc-date'),
    result: document.querySelector('input[name="anlc-result"]:checked')?.value || d.result,
    defects: document.getElementById('anlc-defects') ? val('anlc-defects') : d.defects,
    by: val('anlc-by'),
    note: val('anlc-note'),
    billable: checked('anlc-bill'),
    price: document.getElementById('anlc-price') ? val('anlc-price') : d.price,
    resolveOpen: document.getElementById('anlc-resolve') ? checked('anlc-resolve') : d.resolveOpen,
  })
  const objectId = val('anlc-obj')
  let itemId = val('anlc-item')
  if (objectId !== d.objectId) {
    // anderes Objekt: hat es nur eine Anlage, gleich diese
    const mine = rowsAt().filter((r) => r.item.objectId === objectId && r.state !== 'inaktiv')
    itemId = mine.length === 1 ? mine[0].item.id : ''
  }
  if (objectId !== d.objectId || itemId !== d.itemId) {
    Object.assign(d, { objectId, itemId })
    fillFromItem(d, itemOf(itemId))
  }
  return d
}

function checkModal(c, m) {
  const d = checkDraft(m)
  const today = todayISO()
  const rows = rowsAt(today).filter((r) => r.state !== 'inaktiv')
  const objectIds = [...new Set(rows.map((r) => r.item.objectId))]
  const objectOpts = objectIds.map((id) => [id, objName(id)]).sort((a, b) => a[1].localeCompare(b[1], 'de'))
  const itemRows = rows.filter((r) => r.item.objectId === d.objectId)
  const item = itemOf(d.itemId)
  const type = item ? typeOf(doc(), item.typeId) : null
  const r = item ? rowOf(item.id) : null
  const op = item ? operativeOf(item, type) : 0
  const open = item ? openDefects(doc().checks, item.id) : []
  const next = item && d.date ? nextAfter(item, type, d.date, d.kind) : ''
  const radio = (v) => `<label class="check anl-result"><input type="radio" name="anlc-result" value="${v}" ${d.result === v ? 'checked' : ''} data-change="anl-check-redraw"><span><span class="pill ${RESULT_CLS[v]}">${esc(RESULTS[v])}</span></span></label>`
  const people = [...new Set([...(app.data.employees || []).filter((e) => !e.exitDate || e.exitDate >= today).map((e) => e.name), item?.company].filter(Boolean))]
  const pending = [
    ...d.photos.map((f, i) => `<span class="pill anl-file">${ICON.camera} ${esc(f.name)} <button type="button" class="btn small ghost" data-action="anl-file-del" data-kind="photo" data-i="${i}" aria-label="Foto ${i + 1} entfernen">${ICON.close}</button></span>`),
    d.report ? `<span class="pill anl-file">${ICON.download} ${esc(d.report.name)} <button type="button" class="btn small ghost" data-action="anl-file-del" data-kind="report" aria-label="Prüfbericht entfernen">${ICON.close}</button></span>` : '',
  ].join(' ')
  return modalFrame({
    title: 'Prüfung erfassen',
    subtitle: item ? `${esc(type?.name || 'Anlage')} · ${esc(item.label)} · ${esc(objName(item.objectId))}${r ? ` · ${esc(dueText(r))}` : ''}` : 'Objekt und Anlage wählen',
    body: `<div class="form-grid">
        <label class="field"><span>Objekt</span><select id="anlc-obj" data-change="anl-check-redraw">${options(objectOpts, d.objectId, { empty: '– Objekt –' })}</select></label>
        <label class="field"><span>Anlage</span><select id="anlc-item" data-change="anl-check-redraw">${options(itemRows.map((x) => [x.item.id, `${x.type?.name || 'Anlage'} – ${x.item.label}${x.state === 'ueberfaellig' ? ' (überfällig)' : x.state === 'faellig' ? ' (fällig)' : ''}`]), d.itemId, { empty: d.objectId ? '– Anlage –' : '– zuerst das Objekt –' })}</select></label>
        ${op ? `<label class="field"><span>Art der Prüfung</span><select id="anlc-kind" data-change="anl-check-redraw">${options([['haupt', `Hauptprüfung (alle ${intervalOf(item, type)} Monate)`], ['operativ', `operative Inspektion (alle ${op} ${op === 1 ? 'Monat' : 'Monate'})`]], d.kind)}</select></label>` : ''}
        <label class="field"><span>Geprüft am</span><input type="date" id="anlc-date" value="${esc(d.date)}" max="${today}" data-change="anl-check-redraw"></label>
      </div>
      <fieldset class="anl-results"><legend>Ergebnis</legend>${radio('ok')}${radio('maengel')}${radio('ausser')}</fieldset>
      <div class="form-grid">
        ${d.result !== 'ok' ? `<label class="field wide"><span>${d.result === 'ausser' ? 'Was ist außer Betrieb (optional)' : 'Mängel'}</span><textarea id="anlc-defects" rows="2" placeholder="z. B. Plombe fehlt, Druck zu gering, Leuchte Stiege 2 defekt">${esc(d.defects)}</textarea></label>` : ''}
        <label class="field"><span>Geprüft von</span><input type="text" id="anlc-by" list="anlc-people" value="${esc(d.by)}" placeholder="Name oder Firma"><datalist id="anlc-people">${people.map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist></label>
        <label class="field wide"><span>Notiz (optional)</span><input type="text" id="anlc-note" value="${esc(d.note)}" placeholder="z. B. Prüfplakette erneuert"></label>
        <label class="check"><input type="checkbox" id="anlc-bill" ${d.billable ? 'checked' : ''} data-change="anl-check-redraw"><span>verrechenbar</span></label>
        ${d.billable ? `<label class="field"><span>Preis (netto, €)</span><input type="text" inputmode="decimal" id="anlc-price" value="${esc(d.price)}"></label>` : ''}
      </div>
      ${open.length && d.result === 'ok' ? `<label class="check"><input type="checkbox" id="anlc-resolve" ${d.resolveOpen ? 'checked' : ''}><span>${plural(open.length, 'offener Mangel', 'offene Mängel')} damit behoben (${esc(open.map((x) => x.defects || RESULTS[x.result]).join('; '))})</span></label>` : ''}
      <div class="ek-beleg-bar anl-files"><label class="btn">${ICON.camera} Foto aufnehmen<input type="file" accept="image/*" capture="environment" data-change="anl-photo" hidden></label><label class="btn">${ICON.upload} Prüfbericht (PDF)<input type="file" accept="application/pdf,image/*" data-change="anl-report" hidden></label>${pending ? `<span class="anl-pending">${pending}</span>` : '<span class="muted small">Fotos und Prüfbericht einer Fremdfirma kommen nach SharePoint.</span>'}</div>
      ${next ? `<p class="note">Nächste ${d.kind === 'operativ' ? 'operative Inspektion' : 'Prüfung'} danach: <strong>${short(next)}</strong> (ab dem Prüfdatum).</p>` : ''}`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="anl-check-save">Prüfung eintragen</button></div>`,
  })
}
registerModal('anl-check', checkModal, { module: MODULE })

async function saveCheck() {
  const d = readCheck()
  const item = itemOf(d.itemId)
  const problem = checkProblem(d, todayISO())
  if (problem) return toast(problem)
  if (d.billable && !(parsePrice(d.price) > 0)) return toast('Bitte den Preis eintragen (oder „verrechenbar“ abwählen).')
  const type = typeOf(doc(), item.typeId)
  const id = uid('ap')
  const base = `anlagen/nachweise/${d.date.slice(0, 4)}/${fileSafe(objName(item.objectId))}_${fileSafe(type?.name)}_${d.date}_${id}`
  toast(d.photos.length || d.report ? 'Wird gespeichert …' : 'Prüfung wird eingetragen …')
  let failed = 0
  const photos = []
  for (const [i, f] of d.photos.entries()) {
    const meta = await storeFile(f, `${base}_foto-${i + 1}`)
    if (meta) photos.push(meta)
    else failed++
  }
  let report = null
  if (d.report) {
    report = await storeFile(d.report, `${base}_pruefbericht`)
    if (!report) failed++
  }
  const res = addCheck(doc().checks, { ...d, price: parsePrice(d.price), external: item.by === 'fremd', photos, report }, { newId: () => id, at: nowIso(), user: user(), resolveOpen: d.resolveOpen })
  doc().checks = res.checks
  persist()
  closeModal()
  renderNow()
  const r = rowOf(item.id)
  const queued = [...photos, ...(report ? [report] : [])].some((x) => x.queued)
  toast(`Prüfung eingetragen${r?.next ? `, nächste am ${short(r.next)}` : ''}${res.resolved ? `; ${plural(res.resolved, 'Mangel', 'Mängel')} behoben` : ''}${failed ? `; ${plural(failed, 'Datei', 'Dateien')} nicht gespeichert` : ''}${queued ? '; Fotos werden hochgeladen, sobald wieder Netz da ist' : ''}.`)
}

// ---------------------------------------------------------------- Mangel behoben

function defectModal(c, m) {
  const chk = checkOf(m.id)
  const item = chk ? itemOf(chk.itemId) : null
  if (!chk || !item) return ''
  return modalFrame({
    title: 'Mangel behoben',
    subtitle: `${esc(typeName(item))} · ${esc(item.label)} · ${esc(objName(item.objectId))}`,
    body: `<p><strong>${esc(RESULTS[chk.result])}</strong> seit ${short(chk.date)}${chk.defects ? `: ${esc(chk.defects)}` : ''}</p>
      <div class="form-grid">
        <label class="field"><span>Behoben am</span><input type="date" id="anld-date" value="${todayISO()}" max="${todayISO()}"></label>
        <label class="field wide"><span>Was wurde getan</span><input type="text" id="anld-note" placeholder="z. B. Plombe ersetzt durch Fa. Muster"></label>
      </div>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="anl-defect-save" data-id="${esc(chk.id)}">Als behoben vermerken</button></div>`,
  })
}
registerModal('anl-defect', defectModal, { module: MODULE })

// ---------------------------------------------------------------- Arten und Intervalle

function typesModal() {
  const m = app.ui.modal
  m.rows ||= structuredClone(allTypes(doc()))
  const rows = m.rows
    .map((t, i) => `<tr><td><input type="text" id="anlt-name-${i}" value="${esc(t.name)}" aria-label="Name"></td>
      <td><input type="number" id="anlt-months-${i}" min="0" max="120" value="${esc(t.months ?? 0)}" class="num-input" aria-label="Intervall in Monaten"></td>
      <td><input type="number" id="anlt-op-${i}" min="0" max="24" value="${esc(t.operativeMonths || '')}" class="num-input" aria-label="operative Inspektion in Monaten"></td>
      <td><input type="text" id="anlt-basis-${i}" value="${esc(t.basis || '')}" aria-label="Grundlage"></td>
      <td><input type="text" id="anlt-note-${i}" value="${esc(t.note || '')}" aria-label="Hinweis"></td>
      <td><select id="anlt-by-${i}" aria-label="zuständig">${options(Object.entries(BY), t.by || 'eigen')}</select></td>
      <td><label class="check"><input type="checkbox" id="anlt-active-${i}" ${t.active !== false ? 'checked' : ''}><span>aktiv</span></label></td></tr>`)
    .join('')
  return modalFrame({
    title: 'Arten und Intervalle',
    subtitle: 'Vorschläge für neue Anlagen',
    wide: true,
    body: `<div class="table-wrap"><table class="data anl-types"><thead><tr><th>Name</th><th>Monate</th><th>operativ (Monate)</th><th>Grundlage (Hinweis)</th><th>Was wird geprüft</th><th>prüft meist</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p><button class="btn small" data-action="anl-type-add">${ICON.plus} Art</button></p>
      <p class="note">Die Intervalle und Grundlagen sind Vorschläge ohne Gewähr, keine Rechtsauskunft: bitte mit Hersteller, Prüfstelle oder Sicherheitsfachkraft bestätigen. 0 Monate = Intervall je Anlage eintragen (z. B. Fettabscheider laut Hersteller). Eine Anlage mit eigenem Intervall behält es. Nicht mehr nötige Arten auf „aktiv“ aus, die Anlagen bleiben.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="anl-types-save">Speichern</button></div>`,
  })
}
registerModal('anl-types', typesModal, { module: MODULE })

function readTypes() {
  const m = app.ui.modal
  m.rows = m.rows.map((t, i) => ({ ...t, name: val(`anlt-name-${i}`).trim(), months: Math.max(0, Math.round(Number(val(`anlt-months-${i}`)) || 0)), operativeMonths: Math.max(0, Math.round(Number(val(`anlt-op-${i}`)) || 0)), basis: val(`anlt-basis-${i}`).trim(), note: val(`anlt-note-${i}`).trim(), by: val(`anlt-by-${i}`) || 'eigen', active: checked(`anlt-active-${i}`) }))
  return m.rows
}

// ---------------------------------------------------------------- Export

const csvColumns = [
  ['Objekt', (r) => r.object?.name || ''],
  ['Revier', (r) => r.object?.region || ''],
  ['Art', (r) => r.type?.name || ''],
  ['Bezeichnung / Standort', (r) => r.item.label || ''],
  ['Anzahl', (r) => r.item.count || 1],
  ['Hersteller', (r) => r.item.maker || ''],
  ['Seriennummer', (r) => r.item.serial || ''],
  ['Intervall (Monate)', (r) => r.dues[0]?.months || ''],
  ['operativ (Monate)', (r) => r.dues.find((d) => d.kind === 'operativ')?.months || ''],
  ['zuständig', (r) => (r.item.by === 'fremd' ? r.item.company || 'Fremdfirma' : 'eigene Leute')],
  ['zuletzt geprüft', (r) => r.last?.date || ''],
  ['Ergebnis', (r) => (r.last ? RESULTS[r.last.result] : '')],
  ['nächste Prüfung', (r) => r.next || ''],
  ['Status', (r) => stateText(r)],
  ['offene Mängel', (r) => r.defects.map((c) => c.defects || RESULTS[c.result]).join('; ')],
  ['Preis je Prüfung', (r) => (r.item.billable ? r.item.price : '')],
]

async function objectPdf(objectId) {
  const today = todayISO()
  const object = objOf(objectId) || { name: 'Objekt' }
  const rows = rowsAt(today).filter((r) => r.item.objectId === objectId)
  if (!rows.length) return toast('Für dieses Objekt sind keine Anlagen eingetragen.')
  const pdf = anlagenDocument({ object, rows, checks: doc().checks, today, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })
  download(anlagenPdfName(object.name, today), await pdfBlob(pdf))
}

/** Nächster Werktag ab einem Tag (Mo–Fr). */
function workday(date) {
  let d = date
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1)
  return d
}

// ---------------------------------------------------------------- Aktionen

registerActions({
  'anl-tab': (el) => {
    app.ui.anlTab = el.dataset.v
    renderNow()
  },
  'anl-filter': () => {
    app.ui.anlObj = val('anl-f-obj')
    app.ui.anlRegion = document.getElementById('anl-f-region') ? val('anl-f-region') : ''
    app.ui.anlType = val('anl-f-type')
    app.ui.anlStatus = val('anl-f-status')
    renderNow()
  },
  'anl-reset': () => {
    Object.assign(app.ui, { anlObj: '', anlRegion: '', anlType: '', anlStatus: '' })
    renderNow()
  },
  // von „Zu erledigen“, dem digitalen Mitarbeiter und dem Einsatz-Dialog: Ansicht auf das Objekt gefiltert
  'anl-goto': (el) => {
    Object.assign(app.ui, { view: 'anlagen', anlTab: 'liste', anlObj: el.dataset.obj || '', anlRegion: '', anlType: '', anlStatus: el.dataset.status || '' })
    if (app.ui.modal) closeModal()
    renderNow()
  },
  'anl-def-all': () => {
    app.ui.anlDefAll = checked('anl-def-all')
    renderNow()
  },
  'anl-month': () => {
    app.ui.anlMonth = val('anl-month')
    renderNow()
  },
  'anl-edit-open': (el) => openModal({ type: 'anl-edit', id: el.dataset.id || '', objectId: el.dataset.obj || '' }),
  'anl-redraw': () => {
    readItem()
    renderModal()
  },
  'anl-check-redraw': () => {
    readCheck()
    renderModal()
  },
  'anl-file': (el) => {
    const c = checkOf(el.dataset.check)
    if (c) openFile(el.dataset.i === 'report' ? c.report : c.photos?.[Number(el.dataset.i)])
  },
  'anl-pdf': (el) => objectPdf(el.dataset.obj || app.ui.anlObj),
  'anl-invoice-open': (el) => openDraft(el.dataset.doc),
  'anl-csv': () => {
    const rows = filterRows(rowsAt(), { objectId: app.ui.anlObj || '', region: app.ui.anlRegion || '', typeId: app.ui.anlType || '', status: app.ui.anlStatus || '' })
    download(`Anlagen_Pruefungen_${todayISO()}.csv`, new Blob([`﻿${toCSV(rows, csvColumns)}`], { type: 'text/csv;charset=utf-8' }))
  },
  'anl-bill-csv': () => {
    const month = app.ui.anlMonth || todayISO().slice(0, 7)
    const lines = billableChecks({ doc: doc(), objects: app.data.objects, month }).flatMap((g) => g.rows.map((x) => ({ ...x, g })))
    const cols = [
      ['Objekt', (x) => x.g.object?.name || ''],
      ['Kunde', (x) => customerOf(x.g.objectId)],
      ['Datum', (x) => x.check.date],
      ['Anlage', (x) => x.type?.name || ''],
      ['Standort', (x) => x.item.label || ''],
      ['Ergebnis', (x) => RESULTS[x.check.result]],
      ['geprüft von', (x) => x.check.by || ''],
      ['Preis netto', (x) => String(x.check.price).replace('.', ',')],
      ['Verrechnung', (x) => {
        const st = checkBillState(x.check, fakDocs())
        return st ? `${ANLAGE_STATES[st.state]}${st.number ? ` ${st.number}` : ''}` : ''
      }],
    ]
    download(`Anlagen_verrechenbar_${month}.csv`, new Blob([`﻿${toCSV(lines, cols)}`], { type: 'text/csv;charset=utf-8' }))
  },
})

registerActions(
  {
    'anl-save': () => saveItem(),
    'anl-delete': (el) => {
      if (!confirmStep(`anl-del:${el.dataset.id}`, renderModal)) return
      doc().items = doc().items.filter((i) => i.id !== el.dataset.id)
      persist()
      closeModal()
      renderNow()
      toast('Anlage gelöscht.')
    },
    'anl-check-open': (el) => openModal({ type: 'anl-check', id: el.dataset.id || '', objectId: el.dataset.obj || '', kind: el.dataset.kind || '' }),
    'anl-photo': (el) => {
      const files = [...(el.files || [])]
      if (!files.length) return
      const d = readCheck()
      d.photos = [...d.photos, ...files].slice(0, 6)
      if (d.photos.length === 6) toast('Höchstens 6 Fotos je Prüfung.')
      renderModal()
    },
    'anl-report': (el) => {
      const file = el.files?.[0]
      if (!file) return
      readCheck().report = file
      renderModal()
    },
    'anl-file-del': (el) => {
      const d = readCheck()
      if (el.dataset.kind === 'report') d.report = null
      else d.photos = d.photos.filter((_, i) => i !== Number(el.dataset.i))
      renderModal()
    },
    'anl-check-save': () => saveCheck(),
    'anl-check-delete': (el) => {
      const lock = checkOf(el.dataset.id) ? anlageLock(checkOf(el.dataset.id), fakDocs()) : ''
      if (lock) return toast(lock)
      if (!confirmStep(`anl-cdel:${el.dataset.id}`, renderModal)) return
      doc().checks = doc().checks.filter((c) => c.id !== el.dataset.id)
      persist()
      renderModal()
      renderNow()
      toast('Prüfung gelöscht. Fotos und Prüfbericht bleiben in SharePoint.')
    },
    'anl-defect-open': (el) => openModal({ type: 'anl-defect', id: el.dataset.id, back: app.ui.modal?.type === 'anl-edit' ? app.ui.modal.draft?.id || '' : '' }),
    'anl-defect-save': (el) => {
      const chk = checkOf(el.dataset.id)
      if (!chk) return
      const date = val('anld-date')
      if (!date) return toast('Bitte das Datum eintragen.')
      if (date < chk.date) return toast('Das Datum liegt vor dem Mangel.')
      const back = app.ui.modal?.back
      doc().checks = doc().checks.map((c) => (c.id === chk.id ? resolveDefect(c, { date, note: val('anld-note'), by: user(), at: nowIso() }) : c))
      persist()
      if (back) openModal({ type: 'anl-edit', id: back })
      else closeModal()
      renderNow()
      toast('Mangel als behoben vermerkt.')
    },
    'anl-types-open': () => openModal({ type: 'anl-types' }),
    'anl-type-add': () => {
      readTypes().push({ id: uid('at'), name: 'Neue Art', months: 12, operativeMonths: 0, basis: '', note: '', by: 'eigen', active: true })
      renderModal()
    },
    'anl-types-save': () => {
      const rows = readTypes()
      if (rows.some((t) => !t.name)) return toast('Jede Art braucht einen Namen.')
      ownTypes()
      doc().types = rows
      persist()
      closeModal()
      renderNow()
      toast('Arten gespeichert.')
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Rechnungsentwurf (Recht: Fakturierung bearbeiten)

function openDraft(docId) {
  Object.assign(app.ui, { view: 'fakturierung', fakTab: 'rechnungen', fakState: 'entwurf' })
  if (app.ui.modal) closeModal()
  renderNow()
  ACTIONS['fak-open']?.({ dataset: { id: docId } })
}

registerActions(
  {
    // offene verrechenbare Prüfungen eines Kunden → ein Rechnungsentwurf, eine Position je Prüfung
    'anl-invoice': (el) => {
      const d = fak()
      if (!d || !abrechnungHooks.newDraft) return toast('Die Fakturierung ist nicht geladen.')
      const g = checksToBill({ doc: doc(), objects: app.data.objects, fak: d }).find((x) => x.customerId && x.customerId === el.dataset.customer)
      if (!g) return toast('Für diesen Kunden ist keine Prüfung offen.')
      const objects = [...new Set(g.rows.map((r) => r.item.objectId))]
      const one = objects.length === 1 ? objects[0] : ''
      const x = abrechnungHooks.newDraft('rechnung', { title: `Prüfung von Anlagen${one ? ` – ${objName(one)}` : ''}`, serviceFrom: g.from, serviceTo: g.to, ...(one ? { objectId: one, objectName: objName(one) } : {}) })
      abrechnungHooks.applyCustomer(x, g.customerId)
      if (one) x.objectId = one
      addAnlageLines(x, g.rows, { newId: () => uid('l'), vat: fakSettings(d).vat })
      d.documents.push(x)
      persist()
      openDraft(x.id)
      toast(`Rechnungsentwurf mit ${plural(g.rows.length, 'Prüfung', 'Prüfungen')} (${euro(g.sum)} netto). Bitte prüfen und festschreiben.`)
    },
  },
  { edit: 'fakturierung' },
)

// Outlook-Termin über die Termine (Dialog „appt“, Recht auf Termine)
registerActions(
  {
    'anl-appt': (el) => {
      const r = rowOf(el.dataset.id)
      if (!r) return
      const today = todayISO()
      const date = workday(r.next && r.next > today ? r.next : addDays(today, 1))
      openModal({ type: 'appt', date, time: '08:00', minutes: 60, kind: 'sonstiges', title: `Prüfung ${r.type?.name || 'Anlage'}: ${r.item.label}${r.item.by === 'fremd' && r.item.company ? ` (${r.item.company})` : ''}`, objectId: r.item.objectId })
    },
  },
  { edit: 'termine' },
)

// ---------------------------------------------------------------- Zu erledigen, Objekt-Hinweis

const lineOf = (r) => `${r.type?.name || 'Anlage'} (${r.item.label}): ${dueText(r)}`

registerTodo({
  id: 'anlagen',
  module: MODULE,
  title: 'Anlagen & Prüffristen',
  compute: (today) =>
    attention(rowsAt(today)).map((g) => ({
      ...g,
      id: `${g.objectId}:${g.due.map((r) => `${r.item.id}-${r.state}-${r.next}`).join(',')}:${g.defects.flatMap((r) => r.defects.map((c) => c.id)).join(',')}`,
    })),
  render: (list) =>
    list
      .map((g) => {
        const lines = [...g.due.map(lineOf), ...g.defects.flatMap((r) => r.defects.map((c) => `${r.type?.name || 'Anlage'} (${r.item.label}): ${RESULTS[c.result]} seit ${short(c.date)}${c.defects ? `, ${c.defects}` : ''}`))]
        return `<div class="todo-item"><span class="flag ${isUrgent(g) ? 'error' : 'warning'}">${lines.length}</span><div class="todo-text"><strong>${esc(g.object?.name || objName(g.objectId))}</strong><br><span class="muted">${esc(lines.slice(0, 4).join(' · '))}${lines.length > 4 ? ' …' : ''}</span></div><button class="btn small primary" data-action="anl-goto" data-obj="${esc(g.objectId)}" data-status="bedarf">Öffnen</button></div>`
      })
      .join(''),
})

registerObjectHint({
  module: MODULE,
  html: (objectId) => {
    const rows = rowsAt().filter((r) => r.item.objectId === objectId)
    const due = rows.filter((r) => r.state === 'ueberfaellig' || r.state === 'faellig')
    const defects = rows.filter((r) => r.defects.length)
    if (!due.length && !defects.length) return ''
    return `<strong>Anlagen</strong>: ${[due.length ? `${plural(due.length, 'Prüfung', 'Prüfungen')} fällig (${due.map((r) => esc(r.type?.name || 'Anlage')).join(', ')})` : '', defects.length ? plural(defects.length, 'Anlage mit offenem Mangel', 'Anlagen mit offenen Mängeln') : ''].filter(Boolean).join(', ')} <button class="btn small" data-action="anl-goto" data-obj="${esc(objectId)}" data-status="bedarf">Ansehen</button>`
  },
})
