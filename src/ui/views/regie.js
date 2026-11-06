// Regieberichte (Sonderleistungen nach Auftrag): vor Ort am Handy erfassen – Objekt, Datum, Leistung und Auftrag,
// Stunden je Person (von–bis oder Dauer), Material (aus Material & Lager oder frei), Fotos vorher und nachher – und von
// Kunde oder Hausbetreuung am Gerät unterschreiben lassen (Unterschriftsfeld aus ui/signature.js wie beim Schlüsselbuch).
// Danach das PDF „Regiebericht“ (export/regie-pdf.js) in SharePoint unter regie/nachweise/<Jahr>/, Versand per E-Mail
// über das Senden-Fenster der App (mailer.js) und mit einem Klick ein Rechnungsentwurf in der Fakturierung (nur mit
// Recht auf die Fakturierung; der Bericht reist eingefroren als Beilage mit, siehe invoicing-abrechnung.js). Material
// optional als Abgang im Lager (nur mit Recht auf Material & Lager, sonst Hinweis in „Zu erledigen“).
// Datei regie/regie.json (Rechenkern: core/regie.js). Aktionen und Dialoge mit dem Kürzel „reg-“.
// „Diktieren“ (Kürzel „kix-“, nur mit eingerichteter KI): sprechen oder tippen, die KI füllt Leistung, Beschreibung,
// Personen mit Stunden und Material als Vorschlag (Prüfung und Zuordnung in core/ki-vorschlag.js); gespeichert wird
// erst mit „Speichern“.

import { formatDate, todayISO } from '../../core/dates.js'
import { customerForObject, settingsOf as fakSettings } from '../../core/invoicing.js'
import { issueMoves, locationsOf, MAIN_LOCATION } from '../../core/material.js'
import { markupDefault } from '../../core/recharge.js'
import {
  BILL_STATES,
  cleanReport,
  closeProblem,
  closeReport,
  durationText,
  emptyRegie,
  freezeRegie,
  matchFilter,
  MAX_PHOTOS,
  NAME_MODES,
  namesOf,
  nextRegieNo,
  parseDuration,
  personName,
  RATE_SOURCES,
  regieBase,
  regieKey,
  regieLines,
  regieRate,
  regieState,
  regieStates,
  regieTotals,
  REGIE_KINDS,
  reportProblem,
  SIGNER_ROLES,
  STATUS_FILTERS,
  stockLines,
  syncRegieBilled,
  timeText,
  toBill,
  workerMinutes,
} from '../../core/regie.js'
import { toCSV } from '../../core/reports.js'
import { regieDocument, regiePdfName, signedAtText } from '../../export/regie-pdf.js'
import { ACTIONS, app, canEdit, closeModal, confirmStep, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { openCompose } from '../mailer.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { clearSignatures, signatureField, signatureSvg } from '../signature.js'
import { checked, download, esc, ICON, menu, modalFrame, options, uid, val } from '../shared.js'
import { kixBox, kixButton, kixConsent, kixDictate, kixFailed, kixListening, kixSet, kixSpeech } from '../kix.js'
import { abrechnungHooks } from './invoicing-abrechnung.js'

const MODULE = 'regie'
const ICON_REG = '<path d="M5.5 3.5h9l4 4v13h-13z"/><path d="M14.5 3.5v4h4"/><path d="M8.5 12h7M8.5 15h4"/><path d="M8 18.5c1.2-1.4 2.2-1.4 3 0s1.8 1.4 3 0"/>'
const MOBILE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 1.8h6l3 3v9.4h-9z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.6 8h4.8M5.6 10.4h2.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5.3 12.8c.8-.9 1.5-.9 2 0s1.2.9 2 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
const doc = () => {
  const d = (app.data.regie ||= emptyRegie())
  d.reports ||= []
  d.settings ||= {}
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const sees = (m) => !app.access || app.access.sees(m)
const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const objOf = (id) => (app.data.objects || []).find((o) => o.id === id)
const objName = (id) => objOf(id)?.name || 'Objekt'
const reportOf = (id) => doc().reports.find((r) => r.id === id)
const day = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const hoursNum = (min) => String(Math.round((min / 60) * 100) / 100).replace('.', ',')
const kindText = (r) => REGIE_KINDS[r.kind] || 'Sonderleistung'
/** Fakturierung, wenn lesbar (sonst null: Stand der Verrechnung aus billed). */
const fak = () => (sees('fakturierung') ? app.data.fakturierung || null : null)
const fakDocs = () => fak()?.documents || null
/** Rechnungsentwurf erstellen: Schreibrecht auf die Fakturierung (die Fakturierung ist mit diesem Paket geladen). */
const mayInvoice = () => canEdit('fakturierung') && !!fak() && !!abrechnungHooks.newDraft
/** Artikel aus Material & Lager (nur wer den Bereich sieht). */
const stockArticles = () => (sees('material') ? (app.data.material?.articles || []).filter((a) => a.active !== false) : [])
const STATE_CLS = { offen: 'info', entwurf: 'warning', verrechnet: 'ok', nicht: '' }
const statesNow = () => regieStates(doc().reports, fakDocs())
const statusPill = (r) => (r.status !== 'abgeschlossen' ? '<span class="pill warning">offen</span>' : r.signature ? '<span class="pill ok">unterschrieben</span>' : '<span class="pill">ohne Unterschrift</span>')
const billPill = (st) => (!st ? '' : `<span class="pill ${STATE_CLS[st.state]}">${esc(st.state === 'verrechnet' && st.number ? `verrechnet: ${st.number}` : BILL_STATES[st.state])}</span>`)
const moreMenu = (items) => menu({ icon: ICON.more, title: 'Weitere Aktionen', btn: 'small ghost icon', caret: false, items, cls: 'row-menu', single: false })
const sigImg = (svg) => (svg ? `<img class="reg-sig-img" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" alt="Unterschrift">` : '')

// ---------------------------------------------------------------- Dateien (Fotos, PDF)

// Browser-Modus: Dateien nur in diesem Fenster; mit SharePoint unter regie/nachweise/<Jahr>/ (ohne Netz wartet das
// Hochladen im Gerät, siehe storage/offline.js). BLOBS: in dieser Sitzung abgelegte Fotos fürs PDF (auch ohne Netz).
const LOCAL = new Map()
const BLOBS = new Map()

/** Foto verkleinern (Handy: oft 4–8 MB): längste Seite höchstens 2000 Pixel, JPEG. Kleine Bilder bleiben. */
async function shrink(file, max = 2000, quality = 0.82, minSize = 600e3) {
  if (!/^image\//.test(file.type) || file.size < minSize || typeof createImageBitmap !== 'function') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality))
    return blob && blob.size < file.size ? new File([blob], `${String(file.name || 'foto').replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

/** Datei ablegen; liefert { path, name, type, size, at, by, url?, queued?, local? } oder null (mit Meldung). */
async function storeBlob(blob, path, name) {
  const meta = { path, name, type: blob.type || 'application/octet-stream', size: blob.size, at: nowIso(), by: user() }
  BLOBS.set(path, blob)
  if (app.store?.kind !== 'sharepoint') {
    LOCAL.set(path, blob)
    return { ...meta, local: true }
  }
  try {
    const up = await app.store.upload(path, blob, meta.type)
    return { ...meta, ...(up?.webUrl ? { url: up.webUrl } : {}), ...(up?.queued ? { queued: true } : {}) }
  } catch (err) {
    toast(`${name} nicht gespeichert: ${err.message}`)
    return null
  }
}

async function storePhoto(file, base) {
  if (file.size > 15e6) {
    toast(`${file.name}: zu groß (höchstens 15 MB).`)
    return null
  }
  const f = await shrink(file)
  const ext = (String(f.name || '').match(/\.(\w{2,4})$/)?.[1] || 'jpg').toLowerCase()
  return storeBlob(f, `${base}.${ext}`, file.name || `foto.${ext}`)
}

async function fileBlob(meta) {
  if (!meta) return null
  const mem = BLOBS.get(meta.path) || LOCAL.get(meta.path)
  if (mem) return mem
  if (meta.local || !app.store?.readBlob) return null
  return app.store.readBlob(meta.path).catch(() => null)
}

async function openFile(meta) {
  if (!meta) return
  const local = BLOBS.get(meta.path) || LOCAL.get(meta.path)
  if (local) return void window.open(URL.createObjectURL(local), '_blank', 'noopener')
  if (meta.local) return toast('Im Browser-Modus werden Fotos und PDFs nicht gespeichert (nur im Betrieb mit SharePoint).')
  if (meta.url) return void window.open(meta.url, '_blank', 'noopener')
  const blob = await fileBlob(meta)
  if (!blob) return toast(meta.queued ? 'Die Datei wartet noch im Gerät aufs Hochladen.' : 'Datei nicht gefunden.')
  window.open(URL.createObjectURL(blob), '_blank', 'noopener')
}

/** Foto fürs PDF: verkleinert (höchstens 1200 Pixel) als data:-URL; nicht lesbare Bilder werden ausgelassen. */
async function photoImage(blob) {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.78)
  } catch {
    return null
  }
}

/** Fotos eines Berichts für das PDF: [{ image, phase, label }] (vorher zuerst). */
async function photoImages(r, extra = []) {
  const n = { vorher: 0, nachher: 0 }
  const list = [...(r.photos || []).map((p) => ({ phase: p.phase === 'vorher' ? 'vorher' : 'nachher', get: () => fileBlob(p) })), ...extra.map((f) => ({ phase: f.phase, get: async () => f.file }))]
  list.sort((a, b) => (a.phase === b.phase ? 0 : a.phase === 'vorher' ? -1 : 1))
  const out = []
  for (const p of list) {
    n[p.phase]++
    const blob = await p.get()
    const image = blob ? await photoImage(blob) : null
    if (image) out.push({ image, phase: p.phase, label: `${p.phase} ${n[p.phase]}` })
  }
  return out
}

/** PDF eines Berichts (mit Fotos): { name, blob }. extra: noch nicht gespeicherte Fotos (Vorschau im Dialog). */
async function reportPdf(r, { extra = [] } = {}) {
  const o = objOf(r.objectId) || { name: 'Objekt' }
  const frozen = freezeRegie(r, { object: o, names: namesOf(doc()) })
  frozen.photos.vorher += extra.filter((f) => f.phase === 'vorher').length
  frozen.photos.nachher += extra.filter((f) => f.phase !== 'vorher').length
  const pdf = regieDocument({ report: frozen, photos: await photoImages(r, extra), brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })
  return { name: regiePdfName(r.no || 'Entwurf', o.name), blob: await pdfBlob(pdf) }
}

// ---------------------------------------------------------------- Stand der Verrechnung mitschreiben

/** „verrechnet mit …“ in die Berichte schreiben (für Rollen ohne Fakturierung), wie im Einkauf. */
function syncBilled() {
  if (!canEdit(MODULE) || !fakDocs() || !app.data.regie) return
  if (!syncRegieBilled(doc().reports, fakDocs())) return
  setTimeout(() => {
    persist()
    renderNow()
  }, 0)
}

// ---------------------------------------------------------------- Ansicht

function regieView() {
  syncBilled()
  const today = todayISO()
  const ed = editable()
  const reports = doc().reports
  const states = statesNow()
  const month = today.slice(0, 7)
  const inMonth = reports.filter((r) => String(r.date).startsWith(month))
  const minutes = inMonth.reduce((s, r) => s + regieTotals(r).minutes, 0)
  const open = reports.filter((r) => r.status !== 'abgeschlossen').length
  const bill = reports.filter((r) => states.get(r.id)?.state === 'offen').length
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const head = `<div class="section-head"><div><h2>Regieberichte</h2><p>Sonderleistungen vor Ort erfassen: Stunden je Person, Material, Fotos vorher und nachher. Kunde oder Hausbetreuung unterschreibt am Handy, das PDF geht per E-Mail hinaus und liegt in SharePoint. Daraus mit einem Klick ein Rechnungsentwurf.</p></div>
      <div class="actions">${ed ? `<button class="btn primary" data-action="reg-new">${ICON.plus} Regiebericht erfassen</button>` : ''}${menu({
        label: 'Mehr',
        single: false,
        items: [
          ed && { label: 'Namen im Bericht', icon: ICON.gear, action: 'reg-settings-open', hint: NAME_MODES[namesOf(doc())] },
          mayInvoice() && bill && { label: 'Alle verrechnen', icon: ICON.send, action: 'reg-invoice-all', hint: `${plural(bill, 'Rechnungsentwurf', 'Rechnungsentwürfe')}` },
          { heading: 'Export' },
          reports.length && { label: 'Liste (CSV)', icon: ICON.download, action: 'reg-csv', mail: true },
        ],
      })}</div></div>`
  if (!reports.length)
    return `${head}<div class="banner welcome"><p><strong>Noch keine Regieberichte.</strong> Für jede Sonderleistung nach Auftrag (Grundreinigung, Wasserschaden, Zusatzarbeiten) vor Ort einen Bericht anlegen und am Handy unterschreiben lassen.</p>${ed ? `<button class="btn primary" data-action="reg-new">${ICON.plus} Regiebericht erfassen</button>` : ''}</div>`
  const f = { objectId: app.ui.regObj || '', status: STATUS_FILTERS[app.ui.regStatus] !== undefined ? app.ui.regStatus || '' : '' }
  const list = reports.filter((r) => matchFilter(r, states.get(r.id), f)).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.no).localeCompare(String(a.no)))
  const objects = [...new Set(reports.map((r) => r.objectId))].map((id) => [id, objName(id)]).sort((a, b) => a[1].localeCompare(b[1], 'de'))
  const filtered = f.objectId || f.status
  const filters = `<div class="filters reg-filters">
      <label class="field inline"><span>Objekt</span><select id="reg-f-obj" data-change="reg-filter">${options(objects, f.objectId, { empty: 'alle' })}</select></label>
      <label class="field inline"><span>Status</span><select id="reg-f-status" data-change="reg-filter">${options(Object.entries(STATUS_FILTERS), f.status)}</select></label>
      ${filtered ? '<button class="btn small ghost" data-action="reg-reset">Filter zurücksetzen</button>' : ''}</div>`
  const shown = list.slice(0, 200)
  const rows = shown
    .map((r) => {
      const st = states.get(r.id)
      const t = regieTotals(r)
      const main =
        r.status !== 'abgeschlossen'
          ? ed
            ? `<button class="btn small primary" data-action="reg-sign-open" data-id="${esc(r.id)}">Unterschrift</button>`
            : ''
          : st?.state === 'offen' && mayInvoice()
            ? `<button class="btn small primary" data-action="reg-invoice" data-id="${esc(r.id)}">Rechnungsentwurf</button>`
            : ''
      const more = moreMenu([
        { label: r.status !== 'abgeschlossen' && ed ? 'Bearbeiten' : 'Ansehen', action: 'reg-open', data: { id: r.id } },
        { label: r.status !== 'abgeschlossen' ? 'Vorschau (PDF)' : 'PDF', icon: ICON.download, action: 'reg-pdf', data: { id: r.id } },
        r.status === 'abgeschlossen' && { label: 'Per E-Mail senden', icon: ICON.send, action: 'reg-mail', data: { id: r.id } },
      ])
      return `<tr><td class="clickable" data-action="reg-open" data-id="${esc(r.id)}"><span class="reg-cell"><strong>${esc(r.no || '')}</strong><br>${esc(day(r.date))}</span></td>
        <td>${esc(objName(r.objectId))}</td>
        <td><span class="reg-cell"><strong>${esc(kindText(r))}</strong>${r.title ? `<br>${esc(r.title)}` : ''}${r.orderedBy ? `<br><span class="muted">beauftragt von ${esc(r.orderedBy)}</span>` : ''}</span></td>
        <td class="num"><span class="reg-cell">${t.minutes ? `${hoursNum(t.minutes)} Std.` : '–'}${t.persons > 1 ? `<br><span class="muted">${t.persons} Personen</span>` : ''}</span></td>
        <td><span class="reg-cell reg-pills">${statusPill(r)}${r.sent?.length ? ' <span class="pill info">gesendet</span>' : ''}${r.stock?.status === 'hinweis' ? ' <span class="pill warning">Lager offen</span>' : ''}</span></td>
        <td>${billPill(st)}</td>
        <td class="actions-cell">${main} ${more}</td></tr>`
    })
    .join('')
  return `${head}
    <div class="impact-stats tc-stats">${tile('nicht abgeschlossen', open, open ? 'warn' : '')}${tile('noch nicht verrechnet', bill)}${tile('Berichte im Monat', inMonth.length)}${tile('Stunden im Monat', hoursNum(minutes))}</div>
    ${filters}
    ${rows ? `<div class="table-wrap"><table class="data reg-table"><thead><tr><th>Bericht</th><th>Objekt</th><th>Leistung</th><th class="num">Stunden</th><th>Stand</th><th>Verrechnung</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">Kein Regiebericht in dieser Auswahl.${filtered ? ' Filter zurücksetzen zeigt alle.' : ''}</p>`}
    ${list.length > shown.length ? `<p class="muted">Die neuesten 200 von ${list.length}. Für ältere nach Objekt filtern.</p>` : ''}
    <p class="note">Ein abgeschlossener Bericht ist fest (der Kunde hat ihn so bestätigt). Verrechnet wird er einmal: ein gelöschter Rechnungsentwurf oder ein Storno gibt ihn wieder frei.</p>`
}

registerView({
  id: 'regie',
  order: 77,
  label: 'Regieberichte',
  group: 'service',
  module: MODULE,
  icon: ICON_REG,
  noWeek: true,
  mobile: { icon: MOBILE_ICON, label: 'Regie' },
  text: 'Sonderleistungen vor Ort: Stunden, Material, Fotos, Unterschrift, Rechnung',
  badge: () => doc().reports.filter((r) => r.status !== 'abgeschlossen').length,
  render: regieView,
})

// ---------------------------------------------------------------- Erfassen und bearbeiten (offene Berichte)

let redrawing = false
const newWorker = (name = '', employeeId = '') => ({ id: uid('rw'), employeeId, name, from: '', to: '', pause: '', minutes: 0, dur: '' })
const newMaterial = () => ({ id: uid('rm'), articleId: '', text: '', qty: '', unit: '' })

function draftOf(m) {
  if (!m.draft) {
    const r = m.id ? reportOf(m.id) : null
    if (r) {
      m.draft = structuredClone(r)
      m.draft.workers = (m.draft.workers || []).map((w) => ({ ...w, dur: w.from && w.to ? '' : w.minutes ? hoursNum(w.minutes) : '' }))
      m.draft.material = (m.draft.material || []).map((x) => ({ ...x, qty: String(x.qty ?? '').replace('.', ',') }))
    } else {
      const me = (app.data.employees || []).find((e) => e.name === app.user?.name)
      m.draft = { id: '', no: '', objectId: m.objectId || app.ui.regObj || '', date: todayISO(), kind: 'sonder', title: '', description: '', orderedBy: '', orderedRole: '', orderRef: '', workers: [newWorker(app.user?.name || '', me?.id || '')], material: [], photos: [], status: 'offen' }
    }
    m.files = []
  }
  return m.draft
}

/** Eingaben des Dialogs in den Entwurf (vor jedem Neuzeichnen und vor dem Speichern). */
function readDraft() {
  const m = app.ui.modal
  const d = draftOf(m)
  const dictation = document.getElementById('kix-diktat-text')
  if (dictation) m.kixText = dictation.value
  if (!document.getElementById('reg-obj')) return d
  Object.assign(d, { objectId: val('reg-obj'), date: val('reg-date'), kind: val('reg-kind') || d.kind, title: val('reg-title'), description: val('reg-desc'), orderedBy: val('reg-by'), orderedRole: val('reg-role'), orderRef: val('reg-ref') })
  d.workers = d.workers.map((w, i) => {
    if (!document.getElementById(`reg-w-name-${i}`)) return w
    const name = val(`reg-w-name-${i}`)
    const emp = (app.data.employees || []).find((e) => e.name === name.trim())
    const dur = val(`reg-w-dur-${i}`)
    return { ...w, name, employeeId: emp?.id || '', from: val(`reg-w-from-${i}`), to: val(`reg-w-to-${i}`), pause: val(`reg-w-pause-${i}`), dur, minutes: parseDuration(dur) }
  })
  const stock = stockArticles()
  d.material = d.material.map((x, i) => {
    if (!document.getElementById(`reg-m-qty-${i}`)) return x
    const articleId = document.getElementById(`reg-m-art-${i}`) ? val(`reg-m-art-${i}`) : x.articleId
    const a = stock.find((y) => y.id === articleId)
    const changed = articleId !== x.articleId
    return { ...x, articleId, text: a ? a.name : document.getElementById(`reg-m-text-${i}`) ? val(`reg-m-text-${i}`) : x.text, qty: val(`reg-m-qty-${i}`), unit: changed && a ? a.unit || '' : val(`reg-m-unit-${i}`) }
  })
  return d
}

const sumText = (t) => (t.minutes ? `zusammen ${durationText(t.minutes)} (${hoursNum(t.minutes)} Std.)` : '')

function workerRow(w, i, count) {
  const min = workerMinutes(w)
  return `<div class="reg-row reg-worker${w.ki ? ' kix-mark' : ''}">
      <label class="field reg-name"><span>Person</span><input type="text" id="reg-w-name-${i}" list="reg-people" value="${esc(w.name)}" placeholder="Name" autocomplete="off"></label>
      <label class="field reg-time"><span>von</span><input type="time" id="reg-w-from-${i}" value="${esc(w.from || '')}" data-input="reg-calc" data-change="reg-calc"></label>
      <label class="field reg-time"><span>bis</span><input type="time" id="reg-w-to-${i}" value="${esc(w.to || '')}" data-input="reg-calc" data-change="reg-calc"></label>
      <label class="field reg-num"><span>Pause (Min.)</span><input type="number" id="reg-w-pause-${i}" min="0" step="5" inputmode="numeric" value="${esc(w.pause || '')}" data-input="reg-calc" data-change="reg-calc"></label>
      <label class="field reg-num"><span>oder Dauer (Std.)</span><input type="text" id="reg-w-dur-${i}" inputmode="decimal" value="${esc(w.dur || '')}" placeholder="z. B. 2,5" data-input="reg-calc" data-change="reg-calc"></label>
      <span class="reg-dur" data-dur="${i}" aria-live="polite">${min ? durationText(min) : '–'}</span>
      ${count > 1 ? `<button type="button" class="btn small ghost icon" data-action="reg-worker-del" data-i="${i}" aria-label="Person ${i + 1} entfernen" title="Zeile entfernen">${ICON.close}</button>` : ''}
    </div>`
}

function materialRow(x, i, stock) {
  const own = x.articleId && !stock.some((a) => a.id === x.articleId) ? [[x.articleId, x.text || 'Artikel']] : []
  return `<div class="reg-row reg-mat${x.ki ? ' kix-mark' : ''}">
      ${stock.length || own.length ? `<label class="field reg-art"><span>Artikel</span><select id="reg-m-art-${i}" data-change="reg-redraw">${options([...stock.map((a) => [a.id, a.name]), ...own], x.articleId, { empty: '– frei eintragen –' })}</select></label>` : ''}
      ${x.articleId ? '' : `<label class="field reg-text"><span>Bezeichnung</span><input type="text" id="reg-m-text-${i}" value="${esc(x.text || '')}" placeholder="z. B. Bautrocknerfolie"></label>`}
      <label class="field reg-num"><span>Menge</span><input type="text" id="reg-m-qty-${i}" inputmode="decimal" value="${esc(x.qty ?? '')}"></label>
      <label class="field reg-unit"><span>Einheit</span><input type="text" id="reg-m-unit-${i}" list="reg-units" value="${esc(x.unit || '')}" placeholder="Stk"></label>
      <button type="button" class="btn small ghost icon" data-action="reg-mat-del" data-i="${i}" aria-label="Material ${i + 1} entfernen" title="Zeile entfernen">${ICON.close}</button>
    </div>`
}

const photoChips = (r, { del = false } = {}) =>
  (r.photos || [])
    .map((p, i) => `<span class="pill reg-file"><button type="button" class="reg-file-open" data-action="reg-file" data-id="${esc(r.id)}" data-i="${i}" ${del ? 'data-src="draft"' : ''} title="${esc(p.name)}">${ICON.camera} ${esc(p.phase === 'vorher' ? 'vorher' : 'nachher')}</button>${del ? `<button type="button" class="btn small ghost" data-action="reg-photo-del" data-kind="saved" data-i="${i}" aria-label="Foto ${i + 1} entfernen">${ICON.close}</button>` : ''}</span>`)
    .join(' ')

function editModal(c, m) {
  const d = draftOf(m)
  const today = todayISO()
  const stock = stockArticles()
  const people = [...new Set((app.data.employees || []).filter((e) => !e.exitDate || e.exitDate >= today).map((e) => e.name))]
  const t = regieTotals(d)
  const pending = (m.files || []).map((f, i) => `<span class="pill reg-file">${ICON.camera} ${esc(f.phase)}: ${esc(f.file.name || 'Foto')} <button type="button" class="btn small ghost" data-action="reg-photo-del" data-kind="new" data-i="${i}" aria-label="Foto entfernen">${ICON.close}</button></span>`).join(' ')
  const photoCount = (d.photos || []).length + (m.files || []).length
  const existing = d.id ? reportOf(d.id) : null
  // von der KI aus dem Diktat übernommene Felder: markiert, bis gespeichert ist
  const ki = (key) => (m.kixFields?.includes(key) ? ' kix-mark' : '')
  const listening = kixListening()
  const dictate = m.kixDiktat
    ? `<section class="reg-block kix-diktat"><h3>Diktat</h3>
        <label class="field wide"><span>Bericht, gesprochen oder getippt</span><textarea id="kix-diktat-text" rows="4" placeholder="z. B. Keller nach Wasserschaden für die Hausverwaltung, Wasser abgesaugt und desinfiziert, Ana und ich von 8 bis halb 12, zwei Flaschen Flächendesinfektion">${esc(m.kixText || '')}</textarea></label>
        <div class="actions">${kixSpeech() ? `<button type="button" class="btn${listening ? ' on' : ''}" id="kix-diktat-mic" data-action="kix-diktat-mic" aria-pressed="${listening}">${listening ? 'Aufhören' : 'Sprechen'}</button>` : ''}<button type="button" class="btn primary" data-action="kix-diktat-run">Felder füllen (KI)</button></div>
        ${kixBox('diktat')}</section>`
    : kixButton('<div class="kix-diktat-bar"><button type="button" class="btn kix-btn" data-action="kix-diktat">Diktieren</button><span class="muted small">sprechen oder tippen – die KI füllt die Felder als Vorschlag</span></div>')
  return modalFrame({
    title: existing ? `Regiebericht ${esc(existing.no)}` : 'Regiebericht erfassen',
    subtitle: existing ? `${esc(objName(existing.objectId))} · ${esc(day(existing.date))} · noch nicht unterschrieben` : 'Sonderleistung nach Auftrag',
    wide: true,
    body: `${dictate}<div class="form-grid">
        <label class="field"><span>Objekt</span><select id="reg-obj">${options((app.data.objects || []).filter((o) => !o.inactive || o.id === d.objectId).map((o) => [o.id, o.name]), d.objectId, { empty: '– wählen –' })}</select></label>
        <label class="field${ki('date')}"><span>Datum</span><input type="date" id="reg-date" value="${esc(d.date)}" max="${today}"></label>
        <label class="field${ki('kind')}"><span>Art</span><select id="reg-kind">${options(Object.entries(REGIE_KINDS), d.kind)}</select></label>
        <label class="field${ki('title')}"><span>Leistung kurz</span><input type="text" id="reg-title" value="${esc(d.title)}" placeholder="z. B. Keller nach Wasserschaden"></label>
        <label class="field wide${ki('description')}"><span>Beschreibung / Auftrag</span><textarea id="reg-desc" rows="3" placeholder="Was wurde gemacht? z. B. Wasser abgesaugt, Boden gereinigt und desinfiziert">${esc(d.description)}</textarea></label>
        <label class="field${ki('orderedBy')}"><span>Beauftragt von</span><input type="text" id="reg-by" value="${esc(d.orderedBy)}" placeholder="Name"></label>
        <label class="field${ki('orderedRole')}"><span>Funktion</span><input type="text" id="reg-role" list="reg-roles" value="${esc(d.orderedRole)}" placeholder="z. B. Hausverwaltung"></label>
        <label class="field"><span>Auftrags- oder Bestellnummer (optional)</span><input type="text" id="reg-ref" value="${esc(d.orderRef)}"></label>
      </div>
      <section class="reg-block"><h3>Stunden je Person <span class="muted" id="reg-sum">${sumText(t)}</span></h3>
        ${d.workers.map((w, i) => workerRow(w, i, d.workers.length)).join('')}
        <button type="button" class="btn small" data-action="reg-worker-add">${ICON.plus} Person</button>
        <p class="muted reg-hint">Von–bis mit Pause oder nur die Dauer, z. B. 2,5 oder 2:30.</p></section>
      <section class="reg-block"><h3>Material</h3>
        ${d.material.map((x, i) => materialRow(x, i, stock)).join('') || '<p class="muted reg-hint">Kein Material eingetragen.</p>'}
        <button type="button" class="btn small" data-action="reg-mat-add">${ICON.plus} Material</button></section>
      <section class="reg-block"><h3>Fotos <span class="muted">${photoCount ? `${photoCount} von höchstens ${MAX_PHOTOS}` : ''}</span></h3>
        <div class="ek-beleg-bar reg-files"><label class="btn">${ICON.camera} Foto vorher<input type="file" accept="image/*" data-change="reg-photo" data-phase="vorher" hidden></label><label class="btn">${ICON.camera} Foto nachher<input type="file" accept="image/*" data-change="reg-photo" data-phase="nachher" hidden></label></div>
        ${photoChips(d, { del: true }) || pending ? `<div class="reg-pending">${photoChips(d, { del: true })} ${pending}</div>` : '<p class="muted reg-hint">Fotos kommen nach SharePoint; ohne Netz warten sie im Gerät. Möglichst ohne Personen fotografieren.</p>'}</section>
      <datalist id="reg-people">${people.map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist>
      <datalist id="reg-roles">${SIGNER_ROLES.map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist>
      <datalist id="reg-units">${['Stk', 'Fl.', 'l', 'kg', 'm', 'm²', 'Rolle', 'Pkg', 'Kanister', 'Karton'].map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist>`,
    foot: `<div class="actions">${existing ? `<button class="btn danger" data-action="reg-delete" data-id="${esc(existing.id)}">${app.ui.confirm === `reg-del:${existing.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}<button class="btn" data-action="reg-preview">${ICON.download} Vorschau</button></div>
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn" data-action="reg-save">Speichern</button><button class="btn primary" data-action="reg-save" data-sign="1">Weiter zur Unterschrift</button></div>`,
  })
}
registerModal('reg-edit', editModal, { module: MODULE })

async function saveReport(el) {
  const m = app.ui.modal
  if (m?.type !== 'reg-edit' || m.saving) return
  m.saving = true
  try {
    await storeReport(el, m)
  } finally {
    m.saving = false
  }
}

async function storeReport(el, m) {
  const d = readDraft()
  const problem = reportProblem(d, todayISO())
  if (problem) return toast(problem)
  if (d.id && reportOf(d.id)?.status === 'abgeschlossen') return toast('Der Regiebericht ist schon abgeschlossen.')
  const r = cleanReport(d, { stock: stockArticles() })
  delete r.dur
  if (!r.id) Object.assign(r, { id: uid('rb'), no: nextRegieNo(doc().reports, r.date.slice(0, 4)), status: 'offen', signature: null, unsigned: null, email: '', pdf: null, sent: [], stock: null, billing: null, createdAt: nowIso(), createdBy: user() })
  else Object.assign(r, { changedAt: nowIso(), changedBy: user() })
  el.disabled = true
  let failed = 0
  if (m.files?.length) {
    toast('Fotos werden gespeichert …')
    const base = regieBase(r, objName(r.objectId))
    const n = { vorher: r.photos.filter((p) => p.phase === 'vorher').length, nachher: r.photos.filter((p) => p.phase !== 'vorher').length }
    for (const f of m.files) {
      n[f.phase]++
      const meta = await storePhoto(f.file, `${base}_${f.phase}-${n[f.phase]}-${Math.random().toString(36).slice(2, 6)}`)
      if (meta) r.photos.push({ ...meta, phase: f.phase })
      else failed++
    }
  }
  const list = doc().reports
  const i = list.findIndex((x) => x.id === r.id)
  if (i >= 0) list[i] = r
  else list.push(r)
  persist()
  m.files = []
  const queued = r.photos.some((p) => p.queued)
  // frisches Unterschriftsfeld (keine Striche von einem anderen Bericht oder aus der Fassung vor der Änderung)
  clearSignatures('reg-')
  if (el.dataset.sign) openModal({ type: 'reg-sign', id: r.id })
  else closeModal()
  renderNow()
  toast(`Regiebericht ${r.no} gespeichert${failed ? `; ${plural(failed, 'Foto', 'Fotos')} nicht gespeichert` : ''}${queued ? '; Fotos werden hochgeladen, sobald wieder Netz da ist' : ''}.`)
}

// ---------------------------------------------------------------- Diktat (KI)

const FIELD_LABELS = { kind: 'Art', title: 'Leistung', description: 'Beschreibung', orderedBy: 'Beauftragt von', orderedRole: 'Funktion', date: 'Datum' }
const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

/**
 * Vorschlag aus dem Diktat (core/ki-vorschlag.js → checkDiktat) in den Entwurf: leere Felder füllen (Art und Datum
 * immer), Personen ohne Zeit ersetzen, Material ergänzen; alles markiert. Gespeichert wird erst mit „Speichern“.
 */
function applyDiktat(m, res) {
  const d = m.draft
  const marked = []
  const kept = []
  for (const [key, value] of Object.entries(res.fields)) {
    if (key === 'kind' || key === 'date' || !String(d[key] || '').trim()) {
      d[key] = value
      marked.push(key)
    } else if (!sameText(d[key], value)) kept.push(FIELD_LABELS[key] || key)
  }
  if (res.workers.length) {
    const timed = d.workers.filter((w) => w.from || w.to || w.dur || Number(w.minutes) > 0)
    const add = res.workers.filter((w) => !timed.some((t) => t.name && sameText(t.name, w.name)))
    d.workers = [...timed, ...add.map((w) => ({ ...newWorker(w.name, w.employeeId), from: w.from, to: w.to, pause: w.pause, dur: w.dur, minutes: parseDuration(w.dur), ki: true }))]
    if (!d.workers.length) d.workers = [newWorker()]
  }
  let materials = 0
  for (const x of res.material) {
    if (d.material.some((y) => (x.articleId && y.articleId === x.articleId) || sameText(y.text, x.text))) continue
    d.material.push({ ...newMaterial(), ...x, ki: true })
    materials++
  }
  m.kixFields = marked
  const items = [
    ...(kept.length ? [{ level: 'info', text: `Schon ausgefüllt, nicht geändert: ${kept.join(', ')}.` }] : []),
    { level: 'info', text: `${plural(res.workers.length, 'Person', 'Personen')}, ${plural(materials, 'Material', 'Materialien')} übernommen.` },
    ...res.problems,
  ]
  kixSet('diktat', { notice: { title: 'Von der KI aus dem Diktat übernommen – bitte prüfen. Gespeichert wird erst mit „Speichern“.', items } })
}

const activeEmployees = () => (app.data.employees || []).filter((e) => !e.exitDate || e.exitDate >= todayISO())

// ---------------------------------------------------------------- Zusammenfassung (Unterschrift, Ansicht)

function summaryHtml(r, { names = 'voll' } = {}) {
  const o = objOf(r.objectId) || {}
  const t = regieTotals(r)
  const workers = (r.workers || []).filter((w) => workerMinutes(w) > 0)
  const who = (w, i) => (names === 'voll' ? w.name : personName(w.name, names)) || `Person ${i + 1}`
  const vorher = (r.photos || []).filter((p) => p.phase === 'vorher').length
  const nachher = (r.photos || []).length - vorher
  return `<dl class="reg-summary">
      <dt>Objekt</dt><dd>${esc([o.name, o.address].filter(Boolean).join(', ') || 'Objekt')}</dd>
      <dt>Datum</dt><dd>${esc(day(r.date))}</dd>
      <dt>Leistung</dt><dd>${esc(kindText(r))}${r.title ? `: ${esc(r.title)}` : ''}</dd>
      ${r.orderedBy ? `<dt>Beauftragt von</dt><dd>${esc(r.orderedBy)}${r.orderedRole ? ` (${esc(r.orderedRole)})` : ''}${r.orderRef ? ` · Auftrag ${esc(r.orderRef)}` : ''}</dd>` : ''}
      ${r.description ? `<dt>Ausgeführt</dt><dd class="reg-desc">${esc(r.description)}</dd>` : ''}
    </dl>
    ${workers.length ? `<div class="table-wrap"><table class="data reg-mini"><thead><tr><th>Person</th><th>Zeit</th><th class="num">Dauer</th></tr></thead><tbody>${workers.map((w, i) => `<tr><td>${esc(who(w, i))}</td><td>${esc(timeText(w))}</td><td class="num">${durationText(workerMinutes(w))}</td></tr>`).join('')}<tr class="reg-sum-row"><td><strong>Summe</strong></td><td></td><td class="num"><strong>${durationText(t.minutes)}</strong></td></tr></tbody></table></div>` : '<p class="muted">Keine Arbeitszeit.</p>'}
    ${(r.material || []).length ? `<div class="table-wrap"><table class="data reg-mini"><thead><tr><th>Material</th><th class="num">Menge</th><th>Einheit</th></tr></thead><tbody>${r.material.map((x) => `<tr><td>${esc(x.text)}</td><td class="num">${esc(String(x.qty).replace('.', ','))}</td><td>${esc(x.unit || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${vorher + nachher ? `<p class="muted">Fotos: ${vorher} vorher, ${nachher} nachher</p>` : ''}`
}

// ---------------------------------------------------------------- Unterschrift am Gerät und abschließen

function signDefaults(m, r) {
  if (m.ready) return
  const o = objOf(r.objectId)
  const cu = fak() ? customerForObject(fak(), r.objectId) : null
  Object.assign(m, { ready: true, signer: r.orderedBy || '', role: r.orderedRole || '', email: r.email || o?.proofEmail || cu?.email || '', stock: canEdit('material') && !!app.data.material, loc: MAIN_LOCATION.id, noSig: false, reason: '' })
}

function readSign() {
  const m = app.ui.modal
  if (!document.getElementById('reg-s-mail')) return m
  if (document.getElementById('reg-s-name')) m.signer = val('reg-s-name')
  if (document.getElementById('reg-s-role')) m.role = val('reg-s-role')
  if (document.getElementById('reg-s-reason')) m.reason = val('reg-s-reason')
  if (document.getElementById('reg-s-stock')) m.stock = checked('reg-s-stock')
  if (document.getElementById('reg-s-loc')) m.loc = val('reg-s-loc')
  m.email = val('reg-s-mail')
  return m
}

function signModal(c, m) {
  const r = reportOf(m.id)
  if (!r) return ''
  if (r.status === 'abgeschlossen') return viewModal(c, m)
  signDefaults(m, r)
  const lines = stockLines(r)
  const locs = app.data.material ? locationsOf(app.data.material) : []
  const stockHtml = !lines.length
    ? ''
    : canEdit('material') && app.data.material
      ? `<label class="check wide"><input type="checkbox" id="reg-s-stock" ${m.stock ? 'checked' : ''}><span>Material im Lager als Abgang buchen (${plural(lines.length, 'Artikel', 'Artikel')})</span></label>${locs.length > 1 ? `<label class="field"><span>aus dem Lager</span><select id="reg-s-loc">${options(locs.map((l) => [l.id, l.name]), m.loc)}</select></label>` : ''}`
      : '<p class="muted wide">Das Material wird nicht im Lager gebucht (kein Recht auf Material & Lager): es steht als Hinweis in „Zu erledigen“.</p>'
  const sign = m.noSig
    ? `<label class="field wide"><span>Warum ohne Unterschrift?</span><input type="text" id="reg-s-reason" value="${esc(m.reason || '')}" placeholder="z. B. niemand vor Ort, Bestätigung folgt per E-Mail"></label>`
    : `<div class="form-grid">
        <label class="field"><span>Name</span><input type="text" id="reg-s-name" value="${esc(m.signer || '')}" placeholder="Vor- und Nachname" autocomplete="off"></label>
        <label class="field"><span>Funktion</span><input type="text" id="reg-s-role" list="reg-roles" value="${esc(m.role || '')}" placeholder="z. B. Kunde, Hausbetreuung"></label>
      </div>
      <p class="reg-confirm">Mit der Unterschrift bestätigen Sie die oben angeführten Arbeiten, Arbeitszeiten und Materialien.</p>
      ${signatureField('reg-sig', 'Unterschrift (mit dem Finger)')}`
  return modalFrame({
    title: `Regiebericht ${esc(r.no)} unterschreiben`,
    subtitle: `${esc(objName(r.objectId))} · ${esc(day(r.date))}`,
    wide: true,
    body: `${summaryHtml(r, { names: namesOf(doc()) })}
      <p><button type="button" class="btn small" data-action="reg-pdf" data-id="${esc(r.id)}">${ICON.download} Vorschau (PDF)</button> <button type="button" class="btn small ghost" data-action="reg-open" data-id="${esc(r.id)}" data-edit="1">Ändern</button></p>
      <section class="reg-block reg-signbox"><h3>${m.noSig ? 'Ohne Unterschrift abschließen' : 'Bestätigung durch Kunde oder Hausbetreuung'}</h3>${sign}</section>
      <div class="form-grid">
        <label class="field wide"><span>E-Mail für den Bericht (optional)</span><input type="email" id="reg-s-mail" value="${esc(m.email || '')}" inputmode="email" autocomplete="email" placeholder="name@firma.at"></label>
        ${stockHtml}
      </div>
      <datalist id="reg-roles">${SIGNER_ROLES.map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist>
      <p class="note">Nach dem Abschließen ist der Bericht fest. Das PDF kommt nach SharePoint und lässt sich gleich per E-Mail senden.</p>`,
    foot: `<button class="btn ghost" data-action="reg-nosig">${m.noSig ? 'Doch unterschreiben' : 'Ohne Unterschrift'}</button><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="reg-close">${m.noSig ? 'Abschließen' : 'Unterschreiben und abschließen'}</button></div>`,
  })
}
registerModal('reg-sign', signModal, { module: MODULE })

/** Material als Abgang buchen (core/material.js → issueMoves); liefert den Vermerk für stock. */
function bookStock(r, loc) {
  const mat = app.data.material
  mat.moves ||= []
  const at = nowIso()
  const moves = issueMoves(stockLines(r), { articles: mat.articles || [], loc: loc || MAIN_LOCATION.id, objectId: r.objectId, date: r.date, at, by: user(), note: `Regiebericht ${r.no}`, newId: () => uid('mv') })
  mat.moves.push(...moves)
  return { status: 'gebucht', loc: loc || MAIN_LOCATION.id, moves: moves.map((x) => x.id), at, by: user() }
}

async function closeWithSignature(el) {
  const m = readSign()
  const r = reportOf(m.id)
  if (!r || r.status === 'abgeschlossen') return
  const signature = m.noSig ? null : { name: m.signer || '', role: m.role || '', svg: signatureSvg('reg-sig') }
  const problem = closeProblem(r, { signature, reason: m.reason })
  if (problem) return toast(problem)
  if (m.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email.trim())) return toast('Bitte die E-Mail-Adresse prüfen.')
  el.disabled = true
  const closed = closeReport(r, { signature, reason: m.reason, at: nowIso(), by: user() })
  closed.email = (m.email || '').trim()
  if (stockLines(closed).length) closed.stock = m.stock && canEdit('material') && app.data.material ? bookStock(closed, m.loc) : { status: 'hinweis', at: nowIso(), by: user() }
  const list = doc().reports
  list[list.findIndex((x) => x.id === r.id)] = closed
  persist()
  clearSignatures('reg-')
  toast('Abgeschlossen. Das PDF wird erstellt …')
  let file = null
  try {
    file = await reportPdf(closed)
    const meta = await storeBlob(file.blob, `${regieBase(closed, objName(closed.objectId))}_Regiebericht.pdf`, file.name)
    const now = reportOf(closed.id)
    if (meta && now) {
      now.pdf = meta
      persist()
    }
  } catch (err) {
    toast(`PDF nicht erstellt: ${err.message || err}`)
  }
  closeModal()
  renderNow()
  if (file) mailReport(reportOf(closed.id), file)
  else toast(`Regiebericht ${closed.no} abgeschlossen.`)
}

// ---------------------------------------------------------------- E-Mail

function mailText(r) {
  const o = objOf(r.objectId)
  const sig = r.signature ? `\nBestätigt von ${r.signature.name}${r.signature.role ? ` (${r.signature.role})` : ''} am ${signedAtText(r.signature.at)}.` : ''
  const brand = app.config.brand?.name || ''
  return `Sehr geehrte Damen und Herren,\n\nim Anhang finden Sie den Regiebericht ${r.no} vom ${day(r.date)} für ${o?.name || 'das Objekt'}: ${r.title || kindText(r)}.${sig}\n\nMit freundlichen Grüßen\n${user()}${brand ? `\n${brand}` : ''}`
}

function mailReport(r, file) {
  if (!r) return
  const id = r.id
  openCompose({
    to: r.email || objOf(r.objectId)?.proofEmail || '',
    subject: `Regiebericht ${r.no} – ${objName(r.objectId)}`,
    text: mailText(r),
    files: [{ name: file.name, blob: file.blob, type: 'application/pdf' }],
    origin: `Regiebericht ${r.no}`,
    onSent: ({ via, to }) => {
      const x = reportOf(id)
      if (!x) return
      x.sent = [...(x.sent || []), { at: nowIso(), to, by: user(), via }]
      persist()
      renderNow()
    },
  })
}

// ---------------------------------------------------------------- Ansehen (abgeschlossene Berichte)

function viewModal(c, m) {
  const r = reportOf(m.id)
  if (!r) return ''
  const ed = editable()
  const st = regieState(r, fakDocs())
  const lines = stockLines(r)
  const sig = r.signature
    ? `<div class="reg-signed">${sigImg(r.signature.svg)}<p><strong>${esc(r.signature.name)}</strong>${r.signature.role ? `, ${esc(r.signature.role)}` : ''}<br><span class="muted">unterschrieben am Gerät am ${esc(signedAtText(r.signature.at))}</span></p></div>`
    : r.unsigned
      ? `<p><span class="pill">ohne Unterschrift</span> ${esc(r.unsigned.reason || '')} <span class="muted">(${esc(signedAtText(r.unsigned.at))}, ${esc(r.unsigned.by || '')})</span></p>`
      : ''
  let bill = ''
  if (st) {
    const acts = []
    if (st.state === 'offen' && mayInvoice()) acts.push(`<button class="btn primary" data-action="reg-invoice" data-id="${esc(r.id)}">${ICON.plus} Rechnungsentwurf erstellen</button>`)
    if (st.state === 'entwurf' && st.docId && sees('fakturierung')) acts.push(`<button class="btn" data-action="reg-invoice-open" data-doc="${esc(st.docId)}">Rechnungsentwurf öffnen</button>`)
    if (st.state === 'nicht' && ed) acts.push(`<button class="btn small" data-action="reg-unskip" data-id="${esc(r.id)}">Doch verrechnen</button>`)
    const skip =
      st.state === 'offen' && ed
        ? `<details class="reg-skip"><summary>Nicht verrechnen …</summary><div class="form-grid"><label class="field wide"><span>Grund</span><input type="text" id="reg-v-reason" placeholder="z. B. Kulanz, im Pauschalpreis enthalten"></label></div><button class="btn small" data-action="reg-skip" data-id="${esc(r.id)}">Nicht verrechnen</button></details>`
        : ''
    bill = `<section class="reg-block"><h3>Verrechnung</h3><p>${billPill(st)}${st.state === 'nicht' && r.billing?.reason ? ` <span class="muted">${esc(r.billing.reason)}</span>` : ''}${!fakDocs() && st.state === 'offen' ? ' <span class="muted">(Stand laut letzter Abstimmung mit der Fakturierung)</span>' : ''}</p>${acts.length ? `<div class="actions">${acts.join('')}</div>` : ''}${skip}</section>`
  }
  const stock = lines.length
    ? `<section class="reg-block"><h3>Lager</h3>${
        r.stock?.status === 'gebucht'
          ? `<p><span class="pill ok">im Lager gebucht</span> <span class="muted">${esc(locationsOf(app.data.material || {}).find((l) => l.id === r.stock.loc)?.name || 'Hauptlager')}, ${esc(signedAtText(r.stock.at))}</span></p>`
          : `<p><span class="pill warning">noch nicht im Lager gebucht</span></p>${canEdit('material') && app.data.material && !app.readOnly ? `<button class="btn small" data-action="reg-stock" data-id="${esc(r.id)}">Material jetzt als Abgang buchen</button>` : '<p class="muted">Das Lager bucht den Abgang (Hinweis in „Zu erledigen“).</p>'}`
      }</section>`
    : ''
  const sent = (r.sent || []).length ? `<ul class="tc-list">${r.sent.map((s) => `<li>${esc(signedAtText(s.at))}: ${s.via === 'mailto' ? 'im E-Mail-Programm geöffnet für' : 'gesendet an'} ${esc((s.to || []).join(', '))} <span class="muted">(${esc(s.by || '')})</span></li>`).join('')}</ul>` : '<p class="muted">Noch nicht per E-Mail gesendet.</p>'
  return modalFrame({
    title: `Regiebericht ${esc(r.no)}`,
    subtitle: `${esc(objName(r.objectId))} · ${esc(day(r.date))} · ${r.signature ? 'unterschrieben' : 'abgeschlossen'}`,
    wide: true,
    body: `${summaryHtml(r)}
      ${(r.photos || []).length || r.pdf ? `<p class="reg-pending">${photoChips(r)}${r.pdf ? ` <span class="pill reg-file"><button type="button" class="reg-file-open" data-action="reg-file" data-id="${esc(r.id)}" data-i="pdf" title="${esc(r.pdf.name)}">${ICON.download} PDF in SharePoint</button></span>` : ''}</p>` : ''}
      <section class="reg-block"><h3>Bestätigung</h3>${sig}</section>
      ${bill}${stock}
      <section class="reg-block"><h3>Versand</h3>${sent}</section>`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions"><button class="btn" data-action="reg-pdf" data-id="${esc(r.id)}">${ICON.download} PDF</button><button class="btn primary" data-action="reg-mail" data-id="${esc(r.id)}">${ICON.send} Per E-Mail senden</button></div>`,
  })
}
registerModal('reg-view', viewModal, { module: MODULE })

// ---------------------------------------------------------------- Einstellungen

function settingsModal() {
  return modalFrame({
    title: 'Namen im Regiebericht',
    subtitle: 'PDF für den Kunden und Beilage zur Rechnung',
    body: `<div class="form-grid"><label class="field wide"><span>Eigene Mitarbeitende im PDF</span><select id="reg-set-names">${options(Object.entries(NAME_MODES), namesOf(doc()))}</select></label></div>
      <p class="note">Der Kunde bestätigt die Stunden je Person. Ganze Namen nur, wenn das mit dem Kunden so vereinbart ist; Standard sind die Vornamen. In der App stehen immer die ganzen Namen.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="reg-settings-save">Speichern</button></div>`,
  })
}
registerModal('reg-settings', settingsModal, { module: MODULE })

// ---------------------------------------------------------------- Rechnungsentwurf

/**
 * Rechnungsentwurf aus einem abgeschlossenen Bericht: Positionen (Regiestunden, Material), Kunde des Objekts,
 * Leistungsdatum, Beilage eingefroren. Liefert { x, missing, rate } oder { error }.
 */
function draftFor(r) {
  const d = fak()
  if (!d || !abrechnungHooks.newDraft) return { error: 'Die Fakturierung ist nicht geladen.' }
  if (r.status !== 'abgeschlossen') return { error: 'Erst abschließen (unterschreiben lassen), dann verrechnen.' }
  const st = regieState(r, d.documents)
  if (st.state === 'entwurf') return { error: `Für ${r.no} gibt es schon einen Rechnungsentwurf.`, docId: st.docId }
  if (st.state === 'verrechnet') return { error: `${r.no} ist schon mit ${st.number} verrechnet.` }
  if (st.state === 'nicht') return { error: `${r.no} steht auf „nicht verrechnen“.` }
  const o = objOf(r.objectId) || { id: r.objectId, name: 'Objekt', address: '' }
  const cu = customerForObject(d, r.objectId)
  const s = fakSettings(d)
  const rate = regieRate({ customer: cu, articles: d.articles || [], settings: d.settings || {} })
  const names = namesOf(doc())
  const res = regieLines({ report: r, objectName: o.name, rate: rate.rate, rateInfo: rate, vat: s.vat, newId: () => uid('l'), names, stock: app.data.material?.articles || [], articles: d.articles || [], markup: markupDefault(s) })
  const x = abrechnungHooks.newDraft('rechnung', {
    objectId: r.objectId,
    objectName: o.name,
    serviceFrom: r.date,
    serviceTo: r.date,
    title: `Regiebericht ${r.no}: ${r.title || kindText(r)} – ${o.name}`,
    ...(r.orderRef ? { reference: r.orderRef } : {}),
    lines: res.lines,
    // Schutz vor doppelter Verrechnung (source.key) und Beilage ohne Zugriff auf regie/ (eingefroren)
    source: { type: 'regie', key: regieKey(r.id), reportId: r.id, no: r.no, objectId: r.objectId, date: r.date, beilage: freezeRegie(r, { object: o, names }) },
  })
  if (cu) abrechnungHooks.applyCustomer(x, cu.id)
  x.objectId = r.objectId
  d.documents.push(x)
  return { x, missing: res.missing, rateMissing: res.rateMissing, rate, customer: cu }
}

function invoiceToast(list) {
  const missing = [...new Set(list.flatMap((x) => x.missing))]
  const noRate = list.some((x) => x.rateMissing)
  const one = list.length === 1 ? list[0] : null
  const rateText = one && one.rate.rate ? ` Stundensatz ${one.rate.rate.toFixed(2).replace('.', ',')} € (${RATE_SOURCES[one.rate.source]}).` : ''
  const warn = [noRate ? 'Regiestundensatz fehlt (Einstellungen der Fakturierung oder beim Kunden)' : '', missing.length ? `Preis fehlt: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' …' : ''}` : '', list.some((x) => !x.customer) ? 'Kunde zum Objekt fehlt' : ''].filter(Boolean)
  return `${plural(list.length, 'Rechnungsentwurf', 'Rechnungsentwürfe')} erstellt.${rateText}${warn.length ? ` Bitte prüfen: ${warn.join('; ')}.` : ' Bitte prüfen und festschreiben.'}`
}

function openDraft(docId) {
  Object.assign(app.ui, { view: 'fakturierung', fakTab: 'rechnungen', fakState: 'entwurf' })
  renderNow()
  ACTIONS['fak-open']?.({ dataset: { id: docId } })
}

// ---------------------------------------------------------------- Export

const csvColumns = (states) => [
  ['Nummer', (r) => r.no || ''],
  ['Datum', (r) => r.date || ''],
  ['Objekt', (r) => objName(r.objectId)],
  ['Art', (r) => kindText(r)],
  ['Leistung', (r) => r.title || ''],
  ['beauftragt von', (r) => [r.orderedBy, r.orderedRole ? `(${r.orderedRole})` : ''].filter(Boolean).join(' ')],
  ['Auftrag', (r) => r.orderRef || ''],
  ['Personen', (r) => regieTotals(r).persons],
  ['Stunden', (r) => hoursNum(regieTotals(r).minutes)],
  ['Material', (r) => (r.material || []).map((x) => `${String(x.qty).replace('.', ',')} ${x.unit} ${x.text}`.trim()).join('; ')],
  ['Stand', (r) => (r.status !== 'abgeschlossen' ? 'offen' : r.signature ? 'unterschrieben' : 'ohne Unterschrift')],
  ['unterschrieben von', (r) => (r.signature ? `${r.signature.name}${r.signature.role ? ` (${r.signature.role})` : ''}` : '')],
  ['Verrechnung', (r) => (states.get(r.id) ? BILL_STATES[states.get(r.id).state] : '')],
  ['Rechnung', (r) => states.get(r.id)?.number || ''],
]

// ---------------------------------------------------------------- Aktionen

registerActions({
  'reg-filter': () => {
    app.ui.regObj = val('reg-f-obj')
    app.ui.regStatus = val('reg-f-status')
    renderNow()
  },
  'reg-reset': () => {
    Object.assign(app.ui, { regObj: '', regStatus: '' })
    renderNow()
  },
  // von „Zu erledigen“ und dem digitalen Mitarbeiter: Ansicht gefiltert
  'reg-goto': (el) => {
    Object.assign(app.ui, { view: 'regie', regObj: el.dataset.obj || '', regStatus: el.dataset.status || '' })
    if (app.ui.modal) closeModal()
    renderNow()
  },
  'reg-open': (el) => {
    const r = reportOf(el.dataset.id)
    if (!r) return
    if (r.status !== 'abgeschlossen' && editable()) openModal({ type: 'reg-edit', id: r.id })
    else openModal({ type: 'reg-view', id: r.id })
  },
  'reg-file': (el) => {
    // im Dialog „Erfassen“: Fotos des Entwurfs (dort gelöschte fehlen schon)
    const r = el.dataset.src === 'draft' && app.ui.modal?.draft ? app.ui.modal.draft : reportOf(el.dataset.id)
    if (r) openFile(el.dataset.i === 'pdf' ? r.pdf : r.photos?.[Number(el.dataset.i)])
  },
  'reg-pdf': async (el) => {
    const r = reportOf(el.dataset.id)
    if (!r) return
    el.disabled = true
    try {
      const f = await reportPdf(r)
      download(f.name, f.blob)
    } catch (err) {
      toast(`PDF nicht erstellt: ${err.message || err}`)
    } finally {
      el.disabled = false
    }
  },
  'reg-mail': async (el) => {
    const r = reportOf(el.dataset.id)
    if (!r) return
    el.disabled = true
    try {
      mailReport(r, await reportPdf(r))
    } catch (err) {
      el.disabled = false
      toast(`PDF nicht erstellt: ${err.message || err}`)
    }
  },
  'reg-csv': () => {
    const states = statesNow()
    const rows = doc()
      .reports.filter((r) => matchFilter(r, states.get(r.id), { objectId: app.ui.regObj || '', status: app.ui.regStatus || '' }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    download(`Regieberichte_${todayISO()}.csv`, new Blob([`﻿${toCSV(rows, csvColumns(states))}`], { type: 'text/csv;charset=utf-8' }))
  },
  'reg-invoice-open': (el) => openDraft(el.dataset.doc),
})

registerActions(
  {
    'reg-new': (el) => openModal({ type: 'reg-edit', id: '', objectId: el?.dataset?.obj || '' }),
    // Artikel gewählt: neu zeichnen (Bezeichnung, Einheit). Nicht verschachtelt: entfernt das Neuzeichnen ein Feld mit
    // Fokus, meldet der Browser dessen Änderung noch einmal
    'reg-redraw': () => {
      if (redrawing) return
      redrawing = true
      try {
        readDraft()
        renderModal()
      } finally {
        redrawing = false
      }
    },
    // Zeiten getippt: Dauer je Person und Summe an Ort und Stelle (kein Neuzeichnen, der Fokus bleibt im Feld)
    'reg-calc': () => {
      const d = readDraft()
      d.workers.forEach((w, i) => {
        const el = document.querySelector(`#modal-root [data-dur="${i}"]`)
        if (el) el.textContent = workerMinutes(w) ? durationText(workerMinutes(w)) : '–'
      })
      const sum = document.getElementById('reg-sum')
      if (sum) sum.textContent = sumText(regieTotals(d))
    },
    'reg-worker-add': () => {
      const d = readDraft()
      const last = d.workers.at(-1)
      // gleiche Zeit wie die Zeile davor (oft ein Team): nur der Name fehlt
      d.workers.push({ ...newWorker(), from: last?.from || '', to: last?.to || '', pause: last?.pause || '', dur: last?.from ? '' : last?.dur || '', minutes: last?.from ? 0 : last?.minutes || 0 })
      renderModal()
      document.getElementById(`reg-w-name-${d.workers.length - 1}`)?.focus()
    },
    'reg-worker-del': (el) => {
      const d = readDraft()
      d.workers = d.workers.filter((_, i) => i !== Number(el.dataset.i))
      renderModal()
    },
    'reg-mat-add': () => {
      readDraft().material.push(newMaterial())
      renderModal()
    },
    'reg-mat-del': (el) => {
      const d = readDraft()
      d.material = d.material.filter((_, i) => i !== Number(el.dataset.i))
      renderModal()
    },
    'reg-photo': (el) => {
      const files = [...(el.files || [])]
      if (!files.length) return
      const m = app.ui.modal
      const d = readDraft()
      const room = MAX_PHOTOS - (d.photos || []).length - (m.files || []).length
      if (room <= 0) return toast(`Höchstens ${MAX_PHOTOS} Fotos je Regiebericht.`)
      m.files = [...(m.files || []), ...files.slice(0, room).map((file) => ({ file, phase: el.dataset.phase === 'vorher' ? 'vorher' : 'nachher' }))]
      if (files.length > room) toast(`Höchstens ${MAX_PHOTOS} Fotos je Regiebericht.`)
      renderModal()
    },
    'reg-photo-del': (el) => {
      const m = app.ui.modal
      const d = readDraft()
      if (el.dataset.kind === 'saved') d.photos = d.photos.filter((_, i) => i !== Number(el.dataset.i))
      else m.files = (m.files || []).filter((_, i) => i !== Number(el.dataset.i))
      renderModal()
    },
    'reg-preview': async (el) => {
      const m = app.ui.modal
      const d = readDraft()
      el.disabled = true
      try {
        const f = await reportPdf({ ...cleanReport(d, { stock: stockArticles() }), no: d.no || 'Entwurf' }, { extra: m.files || [] })
        download(f.name, f.blob)
      } catch (err) {
        toast(`PDF nicht erstellt: ${err.message || err}`)
      } finally {
        el.disabled = false
      }
    },
    'reg-save': (el) => saveReport(el),
    // Diktieren: Feld für den Bericht öffnen und gleich zuhören (wo der Browser Spracheingabe kann)
    'kix-diktat': () => {
      const m = app.ui.modal
      if (m?.type !== 'reg-edit') return
      readDraft()
      m.kixDiktat = true
      renderModal()
      document.getElementById('kix-diktat-text')?.focus()
      if (kixSpeech()) ACTIONS['kix-diktat-mic']?.()
    },
    'kix-diktat-mic': () =>
      kixDictate('kix-diktat-text', (on) => {
        const btn = document.getElementById('kix-diktat-mic')
        if (!btn) return
        btn.classList.toggle('on', on)
        btn.setAttribute('aria-pressed', String(on))
        btn.textContent = on ? 'Aufhören' : 'Sprechen'
      }),
    'kix-diktat-run': async (el) => {
      const m = app.ui.modal
      if (m?.type !== 'reg-edit' || m.kix?.diktat?.busy) return
      readDraft()
      const text = String(m.kixText || '').trim()
      if (!text) return toast('Bitte zuerst sprechen oder den Bericht tippen.')
      if (kixListening()) kixDictate('kix-diktat-text')
      if (!el?.dataset?.consent && !kixConsent('diktat', 'Der Text des Diktats', { action: 'kix-diktat-run' })) return
      kixSet('diktat', { busy: 'Die KI ordnet das Diktat den Feldern zu …' })
      try {
        const { readDiktat } = await import('../../ai/extract.js')
        const res = await readDiktat(text, { today: todayISO(), employees: activeEmployees(), articles: stockArticles() })
        if (app.ui.modal !== m) return
        readDraft()
        applyDiktat(m, res)
        renderModal()
      } catch (err) {
        if (app.ui.modal === m) kixSet('diktat', { error: kixFailed(err) })
      }
    },
    'reg-delete': (el) => {
      const r = reportOf(el.dataset.id)
      if (!r || r.status === 'abgeschlossen') return toast('Abgeschlossene Regieberichte bleiben stehen.')
      if (!confirmStep(`reg-del:${r.id}`, renderModal)) return
      doc().reports = doc().reports.filter((x) => x.id !== r.id)
      persist()
      closeModal()
      renderNow()
      toast(`Regiebericht ${r.no} gelöscht. Fotos bleiben in SharePoint.`)
    },
    'reg-sign-open': (el) => {
      const r = reportOf(el.dataset.id)
      if (!r) return
      clearSignatures('reg-')
      openModal({ type: r.status === 'abgeschlossen' ? 'reg-view' : 'reg-sign', id: r.id })
    },
    'reg-nosig': () => {
      const m = readSign()
      m.noSig = !m.noSig
      renderModal()
    },
    'reg-close': (el) => closeWithSignature(el),
    'reg-stock': (el) => {
      const r = reportOf(el.dataset.id)
      if (!r || r.stock?.status === 'gebucht') return
      if (!canEdit('material') || !app.data.material) return toast('Buchen im Lager braucht das Recht auf Material & Lager.')
      r.stock = bookStock(r, MAIN_LOCATION.id)
      persist()
      renderModal()
      renderNow()
      toast(`Material aus ${r.no} im Lager als Abgang gebucht.`)
    },
    'reg-skip': (el) => {
      const r = reportOf(el.dataset.id)
      if (!r) return
      const reason = val('reg-v-reason').trim()
      if (!reason) return toast('Bitte den Grund angeben, warum nicht verrechnet wird.')
      const st = regieState(r, fakDocs())
      if (st?.state !== 'offen') return toast('Nur noch nicht verrechnete Berichte lassen sich auf „nicht verrechnen“ setzen.')
      r.billing = { status: 'nicht', reason, at: nowIso(), by: user() }
      persist()
      renderModal()
      renderNow()
    },
    'reg-unskip': (el) => {
      const r = reportOf(el.dataset.id)
      if (!r) return
      r.billing = null
      persist()
      renderModal()
      renderNow()
    },
    'reg-settings-open': () => openModal({ type: 'reg-settings' }),
    'reg-settings-save': () => {
      doc().settings.names = NAME_MODES[val('reg-set-names')] ? val('reg-set-names') : 'vorname'
      persist()
      closeModal()
      renderNow()
      toast('Gespeichert. Gilt für neue PDFs und Rechnungsentwürfe.')
    },
  },
  { edit: MODULE },
)

// Rechnungsentwurf: Schreibrecht auf die Fakturierung (und den Bereich Regieberichte sehen)
registerActions(
  {
    // data-quiet: vom KI-Assistenten (ai/tools-module.js) – gleicher Ablauf, aber ohne Dialog zu schließen oder zu
    // springen; liefert das Ergebnis ({ x, customer, message } oder { error })
    'reg-invoice': (el) => {
      const quiet = !!el.dataset.quiet
      const r = reportOf(el.dataset.id)
      if (!r || !sees(MODULE)) return quiet ? { error: 'Regiebericht nicht gefunden.' } : undefined
      const res = draftFor(r)
      if (res.error) {
        if (quiet) return res
        toast(res.error)
        if (res.docId) openDraft(res.docId)
        return
      }
      persist()
      if (quiet) {
        renderNow()
        return { ...res, message: invoiceToast([res]) }
      }
      if (app.ui.modal) closeModal()
      openDraft(res.x.id)
      toast(invoiceToast([res]))
    },
    'reg-invoice-all': () => {
      if (!sees(MODULE) || !fak()) return
      const created = toBill(doc().reports, fakDocs())
        .map((r) => draftFor(r))
        .filter((x) => x.x)
      if (!created.length) return toast('Kein Regiebericht zu verrechnen.')
      persist()
      if (app.ui.modal) closeModal()
      Object.assign(app.ui, { view: 'fakturierung', fakTab: 'rechnungen', fakState: 'entwurf' })
      renderNow()
      toast(invoiceToast(created))
    },
  },
  { edit: 'fakturierung' },
)

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'regie',
  module: MODULE,
  title: 'Regieberichte',
  compute: (today) => {
    const reports = app.data.regie?.reports || []
    const out = []
    // seit gestern oder länger nicht abgeschlossen (Unterschrift fehlt)
    const open = reports.filter((r) => r.status !== 'abgeschlossen' && r.date < today)
    if (open.length) out.push({ id: `offen:${open.map((r) => r.id).join(',')}`, kind: 'offen', list: open })
    if (canEdit('fakturierung') && fakDocs()) {
      const bill = toBill(reports, fakDocs())
      if (bill.length) out.push({ id: `rechnung:${bill.map((r) => r.id).join(',')}`, kind: 'zuverrechnen', list: bill })
    }
    if (canEdit('material')) {
      const hint = reports.filter((r) => r.stock?.status === 'hinweis' && stockLines(r).length)
      if (hint.length) out.push({ id: `lager:${hint.map((r) => r.id).join(',')}`, kind: 'lager', list: hint })
    }
    return out
  },
  render: (items) =>
    items
      .map((g) => {
        const title = g.kind === 'offen' ? `${plural(g.list.length, 'Regiebericht', 'Regieberichte')} noch nicht unterschrieben` : g.kind === 'zuverrechnen' ? `${plural(g.list.length, 'Regiebericht', 'Regieberichte')} noch nicht verrechnet` : `Material aus ${plural(g.list.length, 'Regiebericht', 'Regieberichten')} nicht im Lager gebucht`
        const lines = g.list.slice(0, 4).map((r) => `${r.no} ${objName(r.objectId)} (${day(r.date)})`)
        const status = g.kind === 'offen' ? 'offen' : g.kind === 'zuverrechnen' ? 'zuverrechnen' : 'abgeschlossen'
        return `<div class="todo-item"><span class="flag warning">${g.list.length}</span><div class="todo-text"><strong>${esc(title)}</strong><br><span class="muted">${esc(lines.join(' · '))}${g.list.length > 4 ? ' …' : ''}</span></div><button class="btn small primary" data-action="reg-goto" data-status="${status}">Öffnen</button></div>`
      })
      .join(''),
})
