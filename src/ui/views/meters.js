// Modul Zählerstände (Modell des Wasserzähler-Tools): Zählstellen je Objekt,
// Ablesen am Handy mit Foto, Grund ohne Stand und Zählertausch, Rundgang
// „alle offenen ablesen“, Plausibilität gegen das Vorjahr, Runde abschließen
// (Freigabe), Ablesung als Einsatz einplanen, Übernahme der Jahreslisten,
// Liste und Jahresliste für die Hausverwaltung (CSV, PDF, E-Mail).

import { addDays, formatDate, isoWeekday, todayISO } from '../../core/dates.js'
import { fileSafe } from '../../core/filename.js'
import { applySwap, checkReading, correctNumber, DEFAULT_WINDOW, duePeriod, expectedBetween, formatValue, hasValue, importMeters, INTERVALS, isActive, METER_KINDS, METER_TEMPLATE, meterLabel, meterStatus, notableIssue, parseValue, periodByKey, periodOf, readingRows, readingsCsv, readingsOf, REASONS, segments, unitOf, yearCsv, yearRows } from '../../core/meters.js'
import { sendMail } from '../../auth/graph-mail.js'
import { meterReportDocument } from '../../export/meters-pdf.js'
import { app, canEdit, closeModal, confirmStep, dataStamp, openModal, persist, recordUndo, registerActions, registerModal, registerObjectHint, registerView, renderModal, renderModalKeepingInput, renderNow, toast } from '../context.js'
import { canMail } from '../modals/send.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { photoLink, photoPreview, storePhoto } from '../photo.js'
import { checked, download, esc, ICON, modalFrame, options, uid, val } from '../shared.js'
import { copyText } from './sheet.js'
import { regionFilter } from './objects.js'

const MODULE = 'zaehler'
const Z = () => {
  const z = (app.data.zaehler ||= { meters: [], readings: [], closures: {} })
  z.closures ||= {}
  return z
}
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const meterOf = (id) => Z().meters.find((m) => m.id === id)
const windowDays = () => ({ ...DEFAULT_WINDOW, ...(app.data.settings?.meters?.window || {}) })
const editable = () => canEdit(MODULE)
const isOpen = (st) => st.status === 'faellig' || st.status === 'ueberfaellig'
const canPdf = () => app.config.features.pdf && app.config.features.download
const closureOf = (objectId, periodKey) => Z().closures[`${objectId}|${periodKey}`] || null
const userName = () => app.user?.name || ''
const byLocation = (a, b) => (a.location || '').localeCompare(b.location || '', 'de', { numeric: true }) || String(a.number).localeCompare(String(b.number), 'de', { numeric: true })
/** Ablesung im Zeitraum, die eine neue ersetzt: Tausch ersetzt nur einen Tausch, reguläre nur eine reguläre. */
const existingIn = (readings, period, swap) => readings.find((r) => r.period === period.key && !!r.swap === !!swap)

// Status aller aktiven Zählstellen (nur nach Änderungen neu berechnen)
let memo = { key: null, list: [] }
export function meterList(today = todayISO()) {
  const z = Z()
  const key = `${dataStamp()}|${today}|${z.meters.length}|${z.readings.length}`
  if (memo.key !== key) {
    const list = z.meters
      .filter((m) => isActive(m, today))
      .map((meter) => {
        const readings = readingsOf(z, meter.id)
        return { meter, readings, st: meterStatus(meter, readings, today, windowDays()) }
      })
    memo = { key, list }
  }
  return memo.list
}

/** Offene Ablesungen eines Objekts (für Einsatz-Dialog und Objektblatt). */
export const openMetersAt = (objectId, today = todayISO()) => meterList(today).filter((x) => x.meter.objectId === objectId && isOpen(x.st))

function statusCell(st) {
  if (st.status === 'ueberfaellig') return `<span class="pill error">überfällig</span><br><span class="muted">${esc(st.period.label)} · seit ${formatDate(st.until, { weekday: false })}</span>`
  if (st.status === 'faellig') return `<span class="pill warning">fällig</span><br><span class="muted">${esc(st.period.label)} · bis ${formatDate(st.until, { weekday: false })}</span>`
  if (st.status === 'erledigt') return `<span class="pill ok">${st.reading?.reason ? esc(REASONS[st.reading.reason]) : 'abgelesen'}</span><br><span class="muted">${esc(st.period.label)}</span>`
  return `<span class="muted">nächste ab ${formatDate(st.opensAt, { weekday: false, year: true })}</span>`
}

const ISSUE_LABEL = { kritisch: 'kritisch', hoch: 'hoch', niedrig: 'niedrig', leer: 'kein Verbrauch', tausch_unvollstaendig: 'Tausch unvollständig' }
const issuePill = (issue, reading) => `<span class="pill ${issue.level === 'error' ? 'error' : issue.code === 'kein_stand' ? 'info' : 'warning'}">${esc(issue.code === 'kein_stand' ? REASONS[reading?.reason] || 'kein Stand' : ISSUE_LABEL[issue.code] || issue.code)}</span>`

function meterRow({ meter, readings, st }) {
  const last = st.last
  const seg = segments(readings).at(-1)
  const issue = readings.length ? notableIssue(checkReading(meter, readings, readings.at(-1))) : null
  const unit = unitOf(meter)
  return `<tr class="${st.status === 'ueberfaellig' ? 'row-open' : ''}">
    <td><button class="link-btn" data-action="meter-open" data-id="${esc(meter.id)}"><strong>${esc(meter.location || meter.number)}</strong></button><br><span class="muted">Nr. ${esc(meter.number)}${meter.objektNr ? ` · Obj. ${esc(meter.objektNr)}` : ''} · ${esc(METER_KINDS[meter.kind]?.label || '')}</span></td>
    <td class="num">${last ? `${formatValue(last.value)} ${esc(unit)}<br><span class="muted">${formatDate(last.date, { weekday: false, year: true })}</span>` : '<span class="muted">noch keiner</span>'}</td>
    <td class="num">${seg?.delta !== null && seg?.delta !== undefined ? `${formatValue(seg.delta)} ${esc(unit)}` : '–'}${issue ? `<br>${issuePill(issue, readings.at(-1))}` : ''}</td>
    <td>${statusCell(st)}</td>
    <td>${editable() ? `<button class="btn small ${isOpen(st) ? 'primary' : ''}" data-action="mr-open" data-id="${esc(meter.id)}">${ICON.drop} Ablesen</button>` : ''}</td></tr>`
}

/** Fällige Runde eines Objekts: Zeitraum, der gerade fällig ist (oder zuletzt war). */
function roundOf(list) {
  const due = list.filter((x) => isOpen(x.st)).map((x) => x.st.period)
  if (due.length) return due.sort((a, b) => a.key.localeCompare(b.key))[0]
  const done = list.filter((x) => x.st.status === 'erledigt').map((x) => x.st.period)
  return done.sort((a, b) => b.key.localeCompare(a.key))[0] || null
}

function objectCard(obj, list, all, today) {
  const open = list.filter((x) => isOpen(x.st))
  const mine = all.filter((x) => x.meter.objectId === obj.id)
  const round = roundOf(mine)
  const closed = round && closureOf(obj.id, round.key)
  // erfasst wie in meterStatus: nur Ablesungen ab Öffnung des Fensters (kein Tausch mitten im Quartal)
  const read = (x) => x.readings.some((r) => r.period === round.key && r.date >= addDays(round.to, -windowDays().before))
  const roundDone = round && mine.every(read)
  const count = round ? mine.filter(read).length : 0
  list.sort((a, b) => byLocation(a.meter, b.meter))
  return `<article class="object-card" style="--obj:var(--o${obj.color || 10})">
    <header><h3>${esc(obj.name)}</h3><span class="addr">${mine.length} Zählstellen${round ? ` · ${esc(round.label)}: ${count}/${mine.length} erfasst` : ''}${closed ? ` · ${ICON.lock} abgeschlossen` : ''}</span>
      ${open.length && editable() ? `<button class="btn small primary" data-action="mr-walk" data-obj="${esc(obj.id)}">${ICON.drop} Rundgang: ${open.length} ablesen</button>` : ''}
      ${open.length && canEdit('planung') ? `<button class="btn small" data-action="mr-plan" data-obj="${esc(obj.id)}" title="Ablesung als Einsatz in den Dienstplan stellen">${ICON.calendar} Einplanen</button>` : ''}
      ${round && roundDone && !closed && editable() ? `<button class="btn small" data-action="mr-close" data-obj="${esc(obj.id)}" data-period="${round.key}" title="Runde freigeben und sperren">${ICON.lock} ${esc(round.label)} abschließen</button>` : ''}
      ${closed && editable() ? `<button class="btn small" data-action="mr-reopen" data-obj="${esc(obj.id)}" data-period="${round.key}">Wieder öffnen</button>` : ''}
      ${editable() ? `<button class="btn small" data-action="meter-new" data-obj="${esc(obj.id)}">${ICON.plus} Zählstelle</button>` : ''}</header>
    <div class="table-wrap"><table class="data meters"><thead><tr><th>Zählstelle</th><th>Letzter Stand</th><th>Verbrauch</th><th>Status</th><th></th></tr></thead><tbody>${list.map(meterRow).join('')}</tbody></table></div>
  </article>`
}

function metersView() {
  const today = todayISO()
  const z = Z()
  const all = meterList(today)
  const region = app.ui.region
  const filter = app.ui.meterFilter || 'offen'
  const q = (app.ui.meterSearch || '').trim().toLowerCase()
  const due = all.filter((x) => x.st.status === 'faellig')
  const overdue = all.filter((x) => x.st.status === 'ueberfaellig')
  const notable = all.filter((x) => x.readings.length && notableIssue(checkReading(x.meter, x.readings, x.readings.at(-1))))
  const month = today.slice(0, 7)
  const readThisMonth = z.readings.filter((r) => r.date.startsWith(month)).length
  const shown = all.filter((x) => {
    const obj = objOf(x.meter.objectId)
    if (region && obj?.region !== region) return false
    if (filter === 'offen' && !isOpen(x.st)) return false
    if (filter === 'auffaellig' && !notable.includes(x)) return false
    return !q || `${x.meter.number} ${x.meter.location || ''} ${x.meter.objektNr || ''} ${obj?.name || ''} ${obj?.short || ''}`.toLowerCase().includes(q)
  })
  const byObject = new Map()
  for (const x of shown) {
    if (!byObject.has(x.meter.objectId)) byObject.set(x.meter.objectId, [])
    byObject.get(x.meter.objectId).push(x)
  }
  const cards = [...byObject]
    .map(([objectId, list]) => ({ obj: objOf(objectId) || { id: objectId, name: 'Unbekanntes Objekt', color: 10 }, list }))
    .sort((a, b) => b.list.filter((x) => isOpen(x.st)).length - a.list.filter((x) => isOpen(x.st)).length || a.obj.name.localeCompare(b.obj.name, 'de'))
    .map(({ obj, list }) => objectCard(obj, list, all, today))
    .join('')
  const empty = !z.meters.length
    ? `<div class="empty"><p><strong>Noch keine Zählstellen.</strong></p><p>Die Jahreslisten aus dem Wasserzähler-Tool übernehmen, die Liste aus Excel einfügen oder Zählstellen einzeln anlegen.</p>${editable() ? `<p><button class="btn primary" data-action="meter-import-open">${ICON.upload} Übernehmen / Einfügen</button> <button class="btn" data-action="meter-new">${ICON.plus} Zählstelle anlegen</button></p>` : ''}</div>`
    : !shown.length
      ? `<p class="empty">${filter === 'offen' ? 'Nichts offen: alle Zählstellen sind für den fälligen Zeitraum erfasst.' : filter === 'auffaellig' ? 'Keine auffälligen Zählstellen.' : 'Keine Zählstelle passt zur Suche.'}</p>`
      : ''
  const w = windowDays()
  return `<div class="section-head"><div><h2>${ICON.drop} Zählerstände <span class="muted">(${all.length} Zählstellen)</span></h2>
      <p>Fällig ${w.before} Tage vor bis ${w.after} Tage nach dem Stichtag (Quartalsende). Ungewöhnliche Werte werden gegen dasselbe Quartal im Vorjahr geprüft und sofort gemeldet.</p></div>
      <div class="actions">${editable() ? `<button class="btn" data-action="meter-new">${ICON.plus} Zählstelle</button><button class="btn" data-action="meter-import-open">${ICON.upload} Übernehmen</button>` : ''}<button class="btn" data-action="meter-export-open">${ICON.sheet} Listen & Berichte</button></div></div>
    <div class="summary">
      <div class="stat ${overdue.length ? 'err' : ''}"><div class="label">Überfällig</div><div class="value">${overdue.length}</div></div>
      <div class="stat ${due.length ? 'warn' : ''}"><div class="label">Jetzt fällig</div><div class="value">${due.length}</div></div>
      <div class="stat ${notable.length ? 'warn' : ''}"><div class="label">Auffällig</div><div class="value">${notable.length}</div></div>
      <div class="stat"><div class="label">Erfasst im ${month.slice(5)}/${month.slice(0, 4)}</div><div class="value">${readThisMonth}</div></div>
    </div>
    <div class="toolbar filters-bar">
      <div class="seg" role="group" aria-label="Filter">${[['offen', `Offen (${due.length + overdue.length})`], ['auffaellig', `Auffällig (${notable.length})`], ['alle', 'Alle']].map(([v, label]) => `<button class="btn small ${filter === v ? 'primary' : ''}" data-action="meter-filter" data-v="${v}">${label}</button>`).join('')}</div>
      <label class="field inline grow"><span>Suche</span><input type="search" id="meter-search" value="${esc(app.ui.meterSearch || '')}" placeholder="Anschrift, Zählernummer, Objekt" data-input="meter-search"></label>
    </div>
    ${regionFilter()}
    ${empty || `<div class="objects">${cards}</div>`}`
}

registerView({
  id: 'zaehler',
  order: 70,
  label: 'Zählerstände',
  group: 'service',
  module: MODULE,
  noWeek: true,
  mobile: { icon: ICON.drop, label: 'Zähler' },
  badge: () => meterList().filter((x) => isOpen(x.st)).length,
  render: metersView,
})

// ---------------------------------------------------------------- Ablesen

const checkHtml = (issues) => issues.map((i) => `<p class="check ${i.level}">${i.level === 'error' ? '⚠ ' : ''}${esc(i.text)}</p>`).join('')

/** Ablesung aus dem Formular (ohne ID und Foto). */
function formReading(meter) {
  const date = val('mr-date') || todayISO()
  const reason = val('mr-reason') || null
  const swap = checked('mr-swap') ? { oldNumber: meter.number, newNumber: val('mr-new-no').trim(), oldEnd: parseValue(val('mr-old-end')), newStart: parseValue(val('mr-new-start')) } : null
  return { id: app.ui.modal?.readingId || 'neu', meterId: meter.id, date, value: reason ? null : parseValue(val('mr-value')), ...(reason ? { reason } : {}), ...(swap ? { swap } : {}) }
}

function readModal(c, m) {
  const meter = meterOf(m.meterId)
  if (!meter) return ''
  const obj = objOf(meter.objectId)
  const today = todayISO()
  const readings = readingsOf(Z(), meter.id)
  const last = [...readings].reverse().find(hasValue)
  const period = duePeriod(meter, readings, m.date || today, windowDays())
  const existing = existingIn(readings, period, m.swap)
  const expected = last ? expectedBetween(readings, last.date, today) : null
  const unit = unitOf(meter)
  const walk = m.walk || []
  const rest = walk.slice(walk.indexOf(meter.id) + 1)
  const force = app.ui.confirm === 'mr-force'
  const closed = closureOf(meter.objectId, period.key)
  const reason = m.reason ?? ''
  const swap = !!m.swap
  return modalFrame({
    title: meter.location || meter.number,
    subtitle: `${esc(obj?.name || '')} · Zähler ${esc(meter.number)}${walk.length > 1 ? ` · ${walk.indexOf(meter.id) + 1} von ${walk.length}` : ''}`,
    color: obj?.color,
    body: `<div class="meter-head">
        ${last ? `<div><span class="muted">Vorstand</span><strong>${formatValue(last.value)} ${esc(unit)}</strong><span class="muted">${formatDate(last.date, { year: true })}${last.period ? ` · ${esc(periodByKey(last.period).label)}` : ''}</span></div>` : '<div><span class="muted">Erste Ablesung dieser Zählstelle</span></div>'}
        ${expected !== null && last ? `<div><span class="muted">Erwartet etwa</span><strong>${formatValue(Math.round((last.value + expected) * 10) / 10)} ${esc(unit)}</strong><span class="muted">+${formatValue(Math.round(expected * 10) / 10)} wie Vorjahr</span></div>` : ''}
        <div><span class="muted">Zu</span><strong>${esc(period.label)}</strong>${existing ? '<span class="pill warning">schon erfasst: wird ersetzt</span>' : ''}</div>
      </div>
      ${closed ? `<div class="banner warn-banner"><p>${ICON.lock} ${esc(period.label)} ist für dieses Objekt abgeschlossen. Zum Ändern zuerst „Wieder öffnen“.</p></div>` : ''}
      ${meter.note ? `<p class="note">${ICON.key} ${esc(meter.note)}</p>` : ''}
      <div class="form-grid">
        <label class="field"><span>Ergebnis</span><select id="mr-reason" data-change="mr-reason">${options(Object.entries(REASONS), reason, { empty: 'Stand vorhanden' })}</select></label>
        <label class="field meter-value" ${reason ? 'hidden' : ''}><span>Zählerstand (${esc(unit || 'Einheit')})</span><input id="mr-value" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" data-input="mr-check"></label>
        <label class="field"><span>Datum</span><input id="mr-date" type="date" value="${esc(m.date || today)}" max="${today}" data-change="mr-date"></label>
      </div>
      <label class="field inline"><input type="checkbox" id="mr-swap" data-change="mr-swap-toggle" ${swap ? 'checked' : ''}><span>Zählertausch: neuer Zähler eingebaut</span></label>
      ${swap ? `<div class="form-grid swap-box">
        <label class="field"><span>Neue Zählernummer</span><input id="mr-new-no" type="text" autocomplete="off"></label>
        <label class="field"><span>Endstand alter Zähler (${esc(meter.number)})</span><input id="mr-old-end" type="text" inputmode="decimal" data-input="mr-check"></label>
        <label class="field"><span>Anfangsstand neuer Zähler</span><input id="mr-new-start" type="text" inputmode="decimal" data-input="mr-check"></label>
        <p class="note wide">Endstand und Anfangsstand bitte ablesen und eintragen, sie werden nicht vorbelegt. Fehlt einer, bleibt der Tausch „unvollständig“ und es gibt keinen Leckalarm.</p></div>` : ''}
      <div class="photo-row">
        <label class="btn file-btn">${ICON.camera} Kamera<input type="file" id="mr-photo-cam" accept="image/*" capture="environment" data-change="mr-photo" class="visually-hidden"></label>
        <label class="btn file-btn">${ICON.upload} Galerie<input type="file" id="mr-photo-gal" accept="image/*" data-change="mr-photo" class="visually-hidden"></label>
        ${m.preview ? `<img class="photo-preview" src="${m.preview}" alt="Foto">` : '<span class="note">Foto als Nachweis empfohlen.</span>'}
      </div>
      <label class="field"><span>Bemerkung</span><input id="mr-note" type="text" placeholder="z. B. Schacht nass, Mieter nicht da"></label>
      <div id="mr-check" class="meter-check" aria-live="polite">${m.issues ? checkHtml(m.issues) : ''}</div>`,
    foot: `<button class="btn small" data-action="meter-open" data-id="${esc(meter.id)}">Zählstelle</button>
      <div class="actions">${rest.length ? `<button class="btn" data-action="mr-skip" data-id="${esc(meter.id)}">Überspringen</button>` : '<button class="btn" data-action="close-modal">Abbrechen</button>'}
        <button class="btn primary ${force ? 'confirm' : ''}" data-action="mr-save" data-id="${esc(meter.id)}" ${closed ? 'disabled' : ''}>${force ? 'Wert stimmt, speichern' : rest.length ? `Speichern & weiter (${rest.length})` : 'Speichern'}</button></div>`,
  })
}

registerModal('meter-read', readModal, { module: MODULE })

function nextInWalk(m, fromId) {
  const walk = m.walk || []
  const today = todayISO()
  return walk.slice(walk.indexOf(fromId) + 1).find((id) => {
    const meter = meterOf(id)
    return meter && isOpen(meterStatus(meter, readingsOf(Z(), id), today, windowDays()))
  })
}

function startWalk(objectId) {
  const open = openMetersAt(objectId)
    .map((x) => x.meter)
    .sort(byLocation)
  if (!open.length) return toast('Hier ist nichts offen.')
  openModal({ type: 'meter-read', meterId: open[0].id, walk: open.map((m) => m.id) })
}

function refreshCheck() {
  const meter = meterOf(app.ui.modal?.meterId)
  const box = document.getElementById('mr-check')
  if (!meter || !box) return
  const reading = formReading(meter)
  box.innerHTML = reading.value === null && !reading.reason ? '' : checkHtml(checkReading(meter, readingsOf(Z(), meter.id), reading))
}

registerActions({
  'meter-filter': (el) => {
    app.ui.meterFilter = el.dataset.v
    renderNow()
  },
  'meter-search': (el) => {
    app.ui.meterSearch = el.value
    renderNow()
    const input = document.getElementById('meter-search')
    input?.focus()
    input?.setSelectionRange(input.value.length, input.value.length)
  },
  'mr-check': () => {
    if (app.ui.confirm === 'mr-force') {
      app.ui.confirm = null
      renderModalKeepingInput()
    }
    refreshCheck()
  },
  'mr-reason': (el) => {
    app.ui.modal.reason = el.value
    app.ui.confirm = null
    renderModalKeepingInput()
    refreshCheck()
  },
  'mr-swap-toggle': (el) => {
    app.ui.modal.swap = el.checked
    renderModalKeepingInput()
  },
  'mr-date': (el) => {
    app.ui.modal.date = el.value
    renderModalKeepingInput()
    refreshCheck()
  },
  'goto-meters': (el) => {
    app.ui.view = 'zaehler'
    app.ui.meterFilter = 'offen'
    app.ui.modal = null
    renderNow()
    if (el.dataset.obj && editable()) startWalk(el.dataset.obj)
  },
})

registerActions(
  {
    'mr-open': (el) => openModal({ type: 'meter-read', meterId: el.dataset.id, ...(el.dataset.swap ? { swap: true } : {}) }),
    'mr-walk': (el) => startWalk(el.dataset.obj),
    'mr-photo': async (el) => {
      const file = el.files?.[0]
      if (!file) return
      const m = app.ui.modal
      m.file = file
      try {
        m.preview = await photoPreview(file)
      } catch {
        m.preview = null
        toast('Das Foto konnte nicht gelesen werden.')
      }
      renderModalKeepingInput()
    },
    'mr-skip': (el) => {
      const m = app.ui.modal
      const next = nextInWalk(m, el.dataset.id)
      if (next) openModal({ type: 'meter-read', meterId: next, walk: m.walk })
      else closeModal()
    },
    'mr-save': async (el) => {
      const m = app.ui.modal
      const meter = meterOf(el.dataset.id)
      if (!meter) return
      const z = Z()
      const readings = readingsOf(z, meter.id)
      const draft = formReading(meter)
      if (draft.value === null && !draft.reason) {
        document.getElementById('mr-check').innerHTML = checkHtml([{ level: 'error', text: 'Bitte den Zählerstand eingeben oder einen Grund wählen (kein Zutritt …).' }])
        return document.getElementById('mr-value')?.focus()
      }
      if (draft.swap && !draft.swap.newNumber) return toast('Bitte die Nummer des neuen Zählers eintragen.')
      const period = duePeriod(meter, readings, draft.date, windowDays())
      if (closureOf(meter.objectId, period.key)) return toast(`${period.label} ist abgeschlossen.`)
      const existing = existingIn(readings, period, draft.swap)
      const issues = checkReading(meter, readings.filter((r) => r !== existing), draft)
      if (issues.some((i) => i.level === 'error') && app.ui.confirm !== 'mr-force') {
        m.issues = issues
        app.ui.confirm = 'mr-force'
        return renderModalKeepingInput()
      }
      el.disabled = true
      let photo = existing?.photo || null
      if (m.file) {
        try {
          photo = await storePhoto(m.file, `zaehler/fotos/${period.key.replace('-', '/')}/${meter.location || 'Zaehler'}_${draft.swap?.newNumber || meter.number}`)
        } catch (err) {
          toast(`Foto konnte nicht gespeichert werden: ${err.message}`)
        }
      }
      const note = val('mr-note').trim() || existing?.note
      const reading = {
        ...draft,
        id: existing?.id || uid('r'),
        period: period.key,
        ...(userName() ? { by: userName() } : {}),
        ...(note ? { note } : {}),
        ...(photo ? { photo } : {}),
        at: new Date().toISOString(),
      }
      app.data.zaehler = draft.swap ? applySwap(z, meter.id, reading, { by: userName() }) : { ...z, readings: [...z.readings.filter((r) => r.id !== reading.id), reading] }
      persist()
      const next = nextInWalk(m, meter.id)
      if (next) openModal({ type: 'meter-read', meterId: next, walk: m.walk })
      else closeModal()
      renderNow()
      const what = reading.reason ? REASONS[reading.reason] : `${formatValue(reading.value)} ${unitOf(meter)}`
      toast(`${meter.location || meter.number}: ${what} gespeichert (${period.label}).${next ? ' Nächste Zählstelle.' : m.walk?.length > 1 ? ' Rundgang fertig.' : ''}`)
    },
    'mr-close': (el) => {
      Z().closures[`${el.dataset.obj}|${el.dataset.period}`] = { at: new Date().toISOString(), ...(userName() ? { by: userName() } : {}) }
      persist()
      renderNow()
      toast(`${periodByKey(el.dataset.period).label} abgeschlossen: Ablesungen sind gesperrt. Liste und PDF unter „Listen & Berichte“.`)
    },
    'mr-reopen': (el) => {
      delete Z().closures[`${el.dataset.obj}|${el.dataset.period}`]
      persist()
      renderNow()
      toast('Wieder geöffnet.')
    },
  },
  { edit: MODULE },
)

// Ablesung als Einsatz in den Dienstplan stellen (Zuteilung an Ableser)
registerActions(
  {
    'mr-plan': (el) => {
      const obj = objOf(el.dataset.obj)
      const open = openMetersAt(obj.id)
      if (!open.length) return toast('Hier ist nichts offen.')
      const today = todayISO()
      const opens = open.map((x) => addDays(x.st.period.to, -windowDays().before)).sort()[0]
      let date = opens > today ? opens : addDays(today, 1)
      while (isoWeekday(date) > 5) date = addDays(date, 1)
      const minutes = Math.ceil((15 + open.length * 4) / 15) * 15
      const end = `${String(8 + Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
      if (app.data.tasks.some((t) => t.objectId === obj.id && t.meterRound === open[0].st.period.key)) return toast('Für diese Runde gibt es schon einen Einsatz im Dienstplan.')
      recordUndo('Zählerablesung einplanen')
      app.data.tasks.push({ id: uid('t'), objectId: obj.id, label: `Zählerablesung ${open[0].st.period.label} (${open.length} Zähler)`, category: 'sonder', recurrence: { type: 'once', date }, start: '08:00', end, staff: 1, regulars: [], skills: [], holidayRule: 'verschieben', meterRound: open[0].st.period.key, instructions: 'Zählerstände in der App unter „Zählerstände“ erfassen (Rundgang), mit Foto.' })
      persist()
      renderNow()
      toast(`Einsatz am ${formatDate(date)} 08:00–${end} angelegt. Unter „Woche“ jemandem zuteilen.`)
    },
  },
  { edit: 'planung' },
)

// ---------------------------------------------------------------- Zählstelle bearbeiten

function meterModal(c, m) {
  const isNew = m.id === 'new'
  const meter = isNew ? { id: 'new', objectId: m.objectId || '', number: '', kind: 'kaltwasser', location: '', unit: 'm³', interval: 'quartal', history: [] } : meterOf(m.id)
  if (!meter) return ''
  const ro = !editable()
  const dis = ro ? 'disabled' : ''
  const readings = isNew ? [] : readingsOf(Z(), meter.id)
  const segBy = new Map(segments(readings).map((s) => [s.reading.id, s]))
  const confirmDel = app.ui.confirm === 'meter-del'
  const objects = [...app.data.objects].sort((a, b) => a.name.localeCompare(b.name, 'de')).map((o) => [o.id, o.name])
  const history = readings.length
    ? `<div class="table-wrap"><table class="data"><thead><tr><th>Zeitraum</th><th>Datum</th><th>Stand</th><th>Verbrauch</th><th>Hinweis</th><th>Foto</th>${ro ? '' : '<th></th>'}</tr></thead><tbody>${[...readings]
        .reverse()
        .map((r) => {
          const seg = segBy.get(r.id)
          const issue = notableIssue(checkReading(meter, readings, r))
          const locked = r.period && closureOf(meter.objectId, r.period)
          const confirm = app.ui.confirm === `rd-del:${r.id}`
          return `<tr><td>${r.period ? esc(periodByKey(r.period).label) : ''}${locked ? ` ${ICON.lock}` : ''}</td><td>${formatDate(r.date, { weekday: false, year: true })}<br><span class="muted">${esc(r.by || '')}</span></td>
            <td class="num">${hasValue(r) ? formatValue(r.value) : `<span class="muted">${esc(REASONS[r.reason] || '–')}</span>`}</td>
            <td class="num">${seg?.delta !== null && seg?.delta !== undefined ? formatValue(seg.delta) : '–'}${issue && issue.code !== 'kein_stand' ? `<br>${issuePill(issue, r)}` : ''}</td>
            <td>${esc([r.swap ? `Tausch ${r.swap.oldNumber} → ${r.swap.newNumber}` : '', r.note || ''].filter(Boolean).join(', '))}</td><td>${photoLink(r.photo)}</td>
            ${ro ? '' : `<td>${locked ? '' : `<button class="btn small ${confirm ? 'danger confirm' : 'danger'}" data-action="rd-del" data-id="${esc(r.id)}">${confirm ? 'Wirklich?' : 'Löschen'}</button>`}</td>`}</tr>`
        })
        .join('')}</tbody></table></div>`
    : '<p class="note">Noch keine Ablesung.</p>'
  const changes = (meter.history || []).length
    ? `<ul class="plain">${[...meter.history].reverse().map((h) => `<li>${formatDate(h.date || h.at.slice(0, 10), { weekday: false, year: true })}: ${h.type === 'tausch' ? 'Zählertausch' : 'Nummer berichtigt'} ${esc(h.from)} → ${esc(h.to)}${h.by ? ` · ${esc(h.by)}` : ''}${h.note ? ` · ${esc(h.note)}` : ''}</li>`).join('')}</ul>`
    : ''
  return modalFrame({
    title: isNew ? 'Neue Zählstelle' : meter.location || meter.number,
    subtitle: isNew ? 'Wasser, Strom, Gas oder Wärme' : `${esc(objOf(meter.objectId)?.name || '')} · Zähler ${esc(meter.number)} · ID ${esc(meter.id)}`,
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Objekt / Standort</span><select id="mt-obj" ${dis}>${options(objects, meter.objectId, { empty: 'Objekt wählen' })}</select></label>
        <label class="field"><span>Anschrift / Lage</span><input id="mt-loc" type="text" value="${esc(meter.location || '')}" ${dis} placeholder="z. B. Musterstraße 12, Top 3, Keller"></label>
        <label class="field"><span>Zählernummer</span><input id="mt-no" type="text" value="${esc(meter.number)}" ${dis} placeholder="laut Typenschild"></label>
        <label class="field"><span>Objekt Nr. (Hausverwaltung)</span><input id="mt-objnr" type="text" value="${esc(meter.objektNr || '')}" ${dis}></label>
        <label class="field"><span>Art</span><select id="mt-kind" data-change="mt-kind" ${dis}>${options(Object.entries(METER_KINDS).map(([k, v]) => [k, v.label]), meter.kind)}</select></label>
        <label class="field"><span>Einheit</span><input id="mt-unit" type="text" value="${esc(unitOf(meter))}" ${dis}></label>
        <label class="field"><span>Ablesen</span><select id="mt-int" ${dis}>${options(Object.entries(INTERVALS).map(([k, v]) => [k, v.label]), meter.interval)}</select></label>
        <label class="field"><span>Zustand</span><select id="mt-state" ${dis}>${options([['', 'aktiv'], ['abriss', 'Abriss (nicht mehr ablesen)']], meter.state || '')}</select></label>
        ${isNew ? `<label class="field"><span>Aktueller Stand (optional)</span><input id="mt-start" type="text" inputmode="decimal"></label><label class="field"><span>vom</span><input id="mt-start-date" type="date" value="${todayISO()}" max="${todayISO()}"></label>` : ''}
        <label class="field wide"><span>Hinweis / Ansprechperson (erscheint beim Ablesen)</span><input id="mt-note" type="text" value="${esc(meter.note || '')}" ${dis} placeholder="z. B. Schlüssel im Büro, Hausmeister Tel. …"></label>
        ${isNew || ro ? '' : '<label class="field wide"><span>Grund, falls die Nummer berichtigt wird</span><input id="mt-why" type="text" placeholder="z. B. Tippfehler aus Excel"></label>'}
      </div>
      ${isNew ? '' : `${changes ? `<section><h3>Nummernverlauf</h3>${changes}</section>` : ''}<section><h3>Ablesungen</h3>${history}</section>`}`,
    foot: ro
      ? '<span></span><button class="btn primary" data-action="close-modal">Schließen</button>'
      : `<div class="actions">${isNew ? '' : `<button class="btn small" data-action="mr-open" data-id="${esc(meter.id)}" data-swap="1">Zähler wurde getauscht</button><button class="btn small ${confirmDel ? 'danger confirm' : 'danger'}" data-action="meter-del" data-id="${esc(meter.id)}">${confirmDel ? 'Samt Ablesungen löschen?' : 'Löschen'}</button>`}</div>
        <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="meter-save" data-id="${esc(meter.id)}">Speichern</button></div>`,
  })
}

registerModal('meter', meterModal, { module: MODULE })

registerActions({
  'meter-open': (el) => openModal({ type: 'meter', id: el.dataset.id }),
  'mt-kind': (el) => {
    const unit = document.getElementById('mt-unit')
    if (unit) unit.value = METER_KINDS[el.value]?.unit || ''
  },
})

registerActions(
  {
    'meter-new': (el) => openModal({ type: 'meter', id: 'new', objectId: el.dataset.obj || '' }),
    'meter-save': (el) => {
      const isNew = el.dataset.id === 'new'
      const fields = { objectId: val('mt-obj'), location: val('mt-loc').trim(), objektNr: val('mt-objnr').trim(), kind: val('mt-kind'), unit: val('mt-unit').trim(), interval: val('mt-int'), state: val('mt-state'), note: val('mt-note').trim() }
      const number = val('mt-no').trim()
      if (!fields.objectId) return toast('Bitte Objekt / Standort wählen.')
      if (!number) return toast('Bitte die Zählernummer eintragen.')
      const z = Z()
      if (z.meters.some((m) => m.id !== el.dataset.id && m.objectId === fields.objectId && m.number === number && isActive(m))) return toast('Diese Zählernummer gibt es in diesem Objekt schon.')
      const clean = (m) => {
        for (const k of ['location', 'objektNr', 'note', 'state']) if (!m[k]) delete m[k]
        return m
      }
      if (isNew) {
        const id = uid('S-')
        z.meters.push(clean({ id, ...fields, number, history: [] }))
        const start = parseValue(val('mt-start'))
        const date = val('mt-start-date') || todayISO()
        if (start !== null) z.readings.push({ id: uid('r'), meterId: id, period: periodOf(date, fields.interval).key, date, value: start, ...(userName() ? { by: userName() } : {}), note: 'Erfassung', at: new Date().toISOString() })
      } else {
        const i = z.meters.findIndex((m) => m.id === el.dataset.id)
        const renamed = correctNumber(z.meters[i], number, { by: userName(), note: val('mt-why').trim() })
        z.meters[i] = clean({ ...renamed, ...fields })
      }
      persist()
      closeModal()
      renderNow()
      toast(isNew ? `Zählstelle ${fields.location || number} angelegt.` : 'Gespeichert.')
    },
    'meter-del': (el) => {
      if (!confirmStep('meter-del', renderModal)) return
      const z = Z()
      const m = meterOf(el.dataset.id)
      z.meters = z.meters.filter((x) => x.id !== el.dataset.id)
      z.readings = z.readings.filter((r) => r.meterId !== el.dataset.id)
      persist()
      closeModal()
      renderNow()
      toast(`Zählstelle ${m?.location || m?.number || ''} gelöscht.`)
    },
    'rd-del': (el) => {
      if (!confirmStep(`rd-del:${el.dataset.id}`, renderModal)) return
      const z = Z()
      z.readings = z.readings.filter((r) => r.id !== el.dataset.id)
      persist()
      renderNow()
      toast('Ablesung gelöscht.')
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Übernehmen / Einfügen

const TEMPLATE_TEXT = `${METER_TEMPLATE.join('\t')}\nWohnanlage Lehen\t12345678\tKaltwasser\tMusterstraße 12, Keller\tquartalsweise\t1234,5\t31.12.2025\t520001\tSchlüssel im Büro`

registerModal('meter-import', (c, m) => {
  const result = m.text ? importMeters(m.text, app.data.objects, { today: todayISO() }) : null
  const dupes = result ? result.items.filter((x) => Z().meters.some((y) => y.objectId === x.meter.objectId && y.number === x.meter.number && isActive(y))) : []
  return modalFrame({
    title: 'Zählstellen übernehmen',
    wide: true,
    body: `<section><h3>Aus dem Wasserzähler-Tool</h3>
        <p class="note">Die Jahreslisten liegen schon in SharePoint (Ordner „Wasserzähler - Ablesung“). Die App liest sie dort direkt, mit Zählstellen-IDs, Nummernverlauf, Gründen, Tausch, Fotos und abgeschlossenen Quartalen. Ein neuer Abgleich verdoppelt nichts.</p>
        <button class="btn primary" data-action="legacy-open">${ICON.upload} Aus den bisherigen Werkzeugen übernehmen</button></section>
      <section><h3>Aus Excel einfügen</h3>
        <p class="note">Zeilen in Excel markieren, kopieren und hier einfügen. Spalten (Reihenfolge egal, erste Zeile = Überschriften): <strong>${METER_TEMPLATE.join(', ')}</strong>. Stand und Datum sind optional.</p>
        <textarea id="mi-text" rows="6" placeholder="${esc(TEMPLATE_TEXT)}" data-input="mi-preview">${esc(m.text || '')}</textarea>
        <div id="mi-result">${result ? `<p><strong>${result.items.length - dupes.length} Zählstellen erkannt</strong>${dupes.length ? `, ${dupes.length} schon vorhanden (werden übersprungen)` : ''}.</p>${result.errors.length ? `<ul class="issues">${result.errors.map((e) => `<li class="warning">${esc(e)}</li>`).join('')}</ul>` : ''}` : ''}</div>
        <div class="actions"><button class="btn" data-action="mi-template">${ICON.copy} Vorlage kopieren</button><button class="btn primary" data-action="mi-apply" ${result && result.items.length > dupes.length ? '' : 'disabled'}>Einfügen</button></div></section>`,
    foot: '<span></span><button class="btn" data-action="close-modal">Schließen</button>',
  })
})

registerActions({
  'mi-template': () => copyText(TEMPLATE_TEXT),
  'mi-preview': (el) => {
    app.ui.modal.text = el.value
    renderModalKeepingInput()
    const t = document.getElementById('mi-text')
    t?.focus()
    t?.setSelectionRange(t.value.length, t.value.length)
  },
})

registerActions(
  {
    'meter-import-open': () => openModal({ type: 'meter-import', text: '' }),
    'mi-apply': () => {
      const { items } = importMeters(val('mi-text'), app.data.objects, { today: todayISO() })
      const z = Z()
      let added = 0
      for (const { meter, reading } of items) {
        if (z.meters.some((y) => y.objectId === meter.objectId && y.number === meter.number && isActive(y))) continue
        const id = uid('S-')
        z.meters.push({ id, ...meter, history: [] })
        if (!meter.location) delete z.meters.at(-1).location
        if (reading) z.readings.push({ id: uid('r'), meterId: id, period: periodOf(reading.date, meter.interval).key, ...reading, note: 'Import', at: new Date().toISOString() })
        added++
      }
      persist()
      closeModal()
      renderNow()
      toast(`${added} Zählstellen eingefügt.`)
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Listen & Berichte

function exportState(m) {
  const today = todayISO()
  const q = periodOf(today, 'quartal')
  const lastQ = periodOf(addDays(q.from, -1), 'quartal')
  const period = periodByKey(m.period || lastQ.key)
  return { kind: m.kind || 'quartal', period, year: m.year || Number(today.slice(0, 4)), objectId: m.objectId || '' }
}

function exportRows(m) {
  const s = exportState(m)
  if (s.kind === 'jahr') return yearRows(Z(), app.data.objects, { year: s.year, objectId: s.objectId || null })
  return readingRows(Z(), app.data.objects, { from: s.period.from, to: addDays(s.period.to, windowDays().after), objectId: s.objectId || null }).filter((r) => !r.period || r.period === s.period.label)
}

const exportBase = (m) => {
  const s = exportState(m)
  const obj = s.objectId ? objOf(s.objectId) : null
  return fileSafe(`${s.kind === 'jahr' ? 'Jahresliste' : 'Zaehlerstaende'}_${obj ? `${obj.short || obj.name}_` : ''}${s.kind === 'jahr' ? s.year : s.period.key}`)
}

registerModal('meter-export', (c, m) => {
  const s = exportState(m)
  const rows = exportRows(m)
  const today = todayISO()
  const periods = []
  for (let p = periodOf(today, 'quartal'), i = 0; i < 8; i++, p = periodOf(addDays(p.from, -1), 'quartal')) periods.push([p.key, p.label])
  const years = [0, 1, 2, 3].map((d) => Number(today.slice(0, 4)) - d)
  const objects = [...new Set(Z().meters.map((x) => x.objectId))].map(objOf).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const flagged = s.kind === 'quartal' ? rows.filter((r) => r.flag && r.flag !== 'kein_stand') : []
  const preview = s.kind === 'jahr'
    ? rows.slice(0, 10).map((r) => `<tr><td>${esc(r.object)}</td><td>${esc(r.location)}<br><span class="muted">Nr. ${esc(r.number)}</span></td><td class="num">${r.start ?? '–'}</td><td class="num">${r.end ?? '–'}</td><td class="num">${r.total === null ? '–' : formatValue(r.total)}</td></tr>`).join('')
    : rows.slice(0, 10).map((r) => `<tr><td>${esc(r.object)}</td><td>${esc(r.location)}<br><span class="muted">Nr. ${esc(r.number)}</span></td><td>${formatDate(r.date, { weekday: false })}</td><td class="num">${r.value === null ? esc(r.note) : `${formatValue(r.value)} ${esc(r.unit)}`}</td><td class="num">${r.delta === null ? '–' : formatValue(r.delta)}${r.flag && r.flag !== 'kein_stand' ? ` <span class="pill warning">${esc(r.flag)}</span>` : ''}</td></tr>`).join('')
  return modalFrame({
    title: 'Zählerstände: Listen & Berichte',
    subtitle: `${rows.length} ${s.kind === 'jahr' ? 'Zählstellen' : 'Ablesungen'}${flagged.length ? ` · ${flagged.length} auffällig` : ''}`,
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Liste</span><select id="me-kind" data-change="me-set">${options([['quartal', 'Ablesungen eines Quartals'], ['jahr', 'Jahresliste je Zählstelle (Q1–Q4)']], s.kind)}</select></label>
        ${s.kind === 'jahr' ? `<label class="field"><span>Jahr</span><select id="me-year" data-change="me-set">${options(years.map((y) => [String(y), String(y)]), String(s.year))}</select></label>` : `<label class="field"><span>Quartal</span><select id="me-period" data-change="me-set">${options(periods, s.period.key)}</select></label>`}
        <label class="field"><span>Objekt / Standort</span><select id="me-obj" data-change="me-set">${options(objects.map((o) => [o.id, o.name]), s.objectId, { empty: 'Alle' })}</select></label>
      </div>
      ${rows.length ? `<div class="table-wrap"><table class="data"><thead><tr>${s.kind === 'jahr' ? '<th>Objekt</th><th>Zählstelle</th><th>Anfang</th><th>Ende</th><th>Jahresverbrauch</th>' : '<th>Objekt</th><th>Zählstelle</th><th>Datum</th><th>Stand</th><th>Verbrauch</th>'}</tr></thead><tbody>${preview}</tbody></table></div>${rows.length > 10 ? `<p class="note">… und ${rows.length - 10} weitere.</p>` : ''}` : '<p class="empty">Keine Daten für diese Auswahl.</p>'}
      ${canMail() ? `<section><h3>Per E-Mail senden</h3><p class="note">Nichts ist vorbelegt: Empfänger bitte bewusst eintragen.</p><label class="field"><span>An</span><input id="me-mail" type="text" placeholder="hausverwaltung@…" value="${esc(m.mail || '')}"></label></section>` : ''}`,
    foot: `<div class="actions"><button class="btn" data-action="me-copy" ${rows.length ? '' : 'disabled'}>${ICON.copy} Für Excel kopieren</button>${app.config.features.download ? `<button class="btn" data-action="me-csv" ${rows.length ? '' : 'disabled'}>${ICON.sheet} CSV</button>` : ''}${canPdf() && s.kind === 'quartal' ? `<button class="btn" data-action="me-pdf" ${rows.length ? '' : 'disabled'}>${ICON.print} PDF</button>` : ''}</div>
      ${canMail() ? `<button class="btn primary" data-action="me-mail" ${rows.length ? '' : 'disabled'}>${ICON.send} Senden</button>` : '<button class="btn primary" data-action="close-modal">Fertig</button>'}`,
  })
})

const exportCsv = (m) => (exportState(m).kind === 'jahr' ? yearCsv(exportRows(m)) : readingsCsv(exportRows(m)))

async function reportPdf(m) {
  const s = exportState(m)
  const logo = await loadLogo()
  return pdfBlob(meterReportDocument(exportRows(m), { period: s.period, brand: app.config.brand, logo, note: app.config.brand.contact || '' }))
}

registerActions({
  'meter-export-open': (el) => openModal({ type: 'meter-export', ...(el.dataset.obj ? { objectId: el.dataset.obj } : {}) }),
  'me-set': () => {
    const m = app.ui.modal
    m.kind = val('me-kind')
    if (document.getElementById('me-period')) m.period = val('me-period')
    if (document.getElementById('me-year')) m.year = Number(val('me-year'))
    m.objectId = val('me-obj')
    m.mail = val('me-mail')
    renderModalKeepingInput(/^me-(period|year)$/)
  },
  'me-copy': () => copyText(exportCsv(app.ui.modal).replace(/^﻿/, '').replace(/;/g, '\t')),
  'me-csv': () => {
    const m = app.ui.modal
    download(`${exportBase(m)}.csv`, new Blob([exportCsv(m)], { type: 'text/csv;charset=utf-8' }))
  },
  'me-pdf': async () => {
    const m = app.ui.modal
    toast('PDF wird erstellt …')
    download(`${exportBase(m)}.pdf`, await reportPdf(m))
  },
  'me-mail': async (el) => {
    const m = app.ui.modal
    const to = val('me-mail').trim()
    if (!to) return toast('Bitte die E-Mail-Adresse eintragen.')
    el.disabled = true
    const s = exportState(m)
    const obj = s.objectId ? objOf(s.objectId) : null
    const what = s.kind === 'jahr' ? `Jahresliste ${s.year}` : s.period.label
    try {
      const attachments = [{ name: `${exportBase(m)}.csv`, blob: new Blob([exportCsv(m)], { type: 'text/csv' }), type: 'text/csv' }]
      if (s.kind === 'quartal') attachments.unshift({ name: `${exportBase(m)}.pdf`, blob: await reportPdf(m), type: 'application/pdf' })
      await sendMail(app.auth.getToken, { to, subject: `Zählerstände ${obj ? `${obj.name} ` : ''}${what}`, text: `Guten Tag,\n\nanbei die Zählerstände${obj ? ` für ${obj.name}` : ''} (${what})${s.kind === 'quartal' ? ' als PDF und' : ''} als CSV für Excel.\n\nFreundliche Grüße\n${userName()}\n${app.config.brand.name || ''}`, attachments }, { from: app.config.mail?.from || '' })
      toast(`Gesendet an ${to}.`)
      closeModal()
    } catch (err) {
      el.disabled = false
      toast(`Senden fehlgeschlagen: ${err.message}`)
    }
  },
})

// ---------------------------------------------------------------- Hinweis im Einsatz

registerObjectHint({
  module: MODULE,
  html: (objectId) => {
    const open = openMetersAt(objectId)
    if (!open.length) return ''
    return `${ICON.drop} <strong>Zählerstände fällig:</strong> ${open.length} ${open.length === 1 ? 'Zählstelle' : 'Zählstellen'} (${esc(open[0].st.period.label)}), bis ${formatDate(open[0].st.until || open[0].st.due, { weekday: false })}. <button class="btn small" data-action="goto-meters" data-obj="${esc(objectId)}">Ablesen</button>`
  },
})

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'zaehler',
  module: MODULE,
  title: 'Zählerstände ablesen',
  compute: (today) => {
    const byObject = new Map()
    for (const x of meterList(today).filter((y) => isOpen(y.st))) {
      if (!byObject.has(x.meter.objectId)) byObject.set(x.meter.objectId, [])
      byObject.get(x.meter.objectId).push(x)
    }
    return [...byObject].map(([objectId, list]) => ({ id: `${objectId}:${list[0].st.period.key}:${list.length}`, objectId, list }))
  },
  render: (items) =>
    items
      .map(({ objectId, list }) => {
        const late = list.filter((x) => x.st.status === 'ueberfaellig').length
        return `<div class="todo-item"><span class="flag ${late ? 'error' : 'warning'}">${list.length}</span>
          <div class="todo-text"><strong>${esc(objOf(objectId)?.name || 'Objekt')}</strong> · ${esc(list[0].st.period.label)}<br><span class="muted">${list.length} ${list.length === 1 ? 'Zählstelle' : 'Zählstellen'} offen${late ? `, ${late} überfällig` : `, bis ${formatDate(list[0].st.until, { weekday: false })}`}</span></div>
          <button class="btn small primary" data-action="goto-meters" data-obj="${esc(objectId)}">Ablesen</button></div>`
      })
      .join(''),
})
