// Müllplan im Objekt-Dialog: Tonnen mit Rhythmus oder Terminen, Abfuhrkalender
// einlesen (.ics oder eingefügte Termine) und wie die Gänge eingeplant werden.

import { datesIn, parseDateList, parseIcs, rhythmOf, streamsFromEntries, WASTE_DEFAULTS, WASTE_RHYTHMS, WASTE_TYPES, wasteRecurrence } from '../core/waste.js'
import { app, registerActions, renderModalKeepingInput, toast } from './context.js'
import { checked, esc, ICON, num, options, uid, val } from './shared.js'

const ROW = /^wsr-/
const deDate = (iso) => iso.split('-').reverse().join('.')

const objectWaste = () => app.data.objects.find((o) => o.id === app.ui.modal?.id)?.waste || {}
const current = () => app.ui.modal?.waste ?? objectWaste()

export function wasteSection(object) {
  const w = app.ui.modal.waste ?? object.waste ?? {}
  const s = { ...WASTE_DEFAULTS, ...w }
  const streams = w.streams || []
  const rows = streams
    .map((stream, i) => {
      const r = rhythmOf(stream)
      const when =
        r.rhythm === 'dates'
          ? `<textarea id="wsr-dates-${i}" rows="2" aria-label="Termine" placeholder="03.11.2026, 17.11.2026 …">${esc(r.dates.map(deDate).join(', '))}</textarea>`
          : `<label class="waste-ref"><span>${r.rhythm === 'm1' ? 'z. B. am (gleicher Wochentag im Monat)' : 'z. B. am'}</span><input type="date" id="wsr-ref-${i}" value="${esc(r.ref)}"></label>`
      return `<div class="waste-row">
        <select id="wsr-type-${i}" aria-label="Tonne">${options(WASTE_TYPES.map((t) => [t, t]), stream.type)}</select>
        <select id="wsr-rhythm-${i}" aria-label="Rhythmus" data-change="waste-redraw">${options(Object.entries(WASTE_RHYTHMS), r.rhythm)}</select>
        ${when}
        <button class="btn small danger" data-action="waste-remove" data-idx="${i}">Entfernen</button></div>`
    })
    .join('')
  const empOptions = app.data.employees.map((e) => [e.id, e.name])
  return `<section class="waste-form"><h3>${ICON.trash} Müllplan</h3>
    <p class="note">Abfuhrtage der Tonnen eintragen. Die Automatik plant das Raus- und Reinstellen beim Personal mit: Passt ein Einsatz im Objekt zeitlich, erledigt die eingeteilte Person es mit (Minuten werden angerechnet). Sonst entsteht ein kurzer eigener Gang, den „Woche planen“ besetzt.</p>
    ${rows || '<p class="muted">Noch keine Abfuhrtage.</p>'}
    <div class="inline-row"><button class="btn small" data-action="waste-add">${ICON.plus} Abfuhr</button></div>
    <details class="waste-import" ${app.ui.modal.wasteImport ? 'open' : ''}><summary>Abfuhrkalender einlesen</summary>
      <p class="note">Gemeinden und Entsorger bieten den Abfuhrkalender meist als Kalenderdatei (.ics) an. Datei wählen oder Termine einfügen, eine Zeile je Termin, z. B. „03.11.2026 Restmüll“. Die Art der Tonne wird aus dem Text erkannt.</p>
      <div class="form-grid">
        <label class="field"><span>Kalenderdatei (.ics)</span><input type="file" id="ws-file" accept=".ics,text/calendar,.txt,.csv,text/plain" data-change="waste-file"></label>
        <label class="field"><span>Art, wenn im Text keine steht</span><select id="ws-default-type">${options(WASTE_TYPES.map((t) => [t, t]), 'Restmüll')}</select></label>
        <label class="field wide"><span>Termine einfügen</span><textarea id="ws-paste" rows="3" placeholder="03.11.2026 Restmüll&#10;05.11.2026 Altpapier"></textarea></label>
      </div>
      <button class="btn small" data-action="waste-import">Termine übernehmen</button>
    </details>
    <div class="form-grid">
      <label class="field"><span>Rausstellen</span><select id="ws-out">${options([['vortag', 'am Vorabend'], ['abholtag', 'in der Früh am Abholtag']], s.outWhen)}</select></label>
      <label class="field"><span>Minuten je Gang</span><input type="number" id="ws-min" min="1" step="1" value="${esc(s.minutes)}"></label>
      <label class="field" title="Automatisch: Stammkraft im Objekt, die zu der Zeit verfügbar ist"><span>Eigene Gänge übernimmt</span><select id="ws-resp">${options(empOptions, s.responsible || '', { empty: 'automatisch' })}</select></label>
      <label class="check" style="align-self:end"><input type="checkbox" id="ws-back" ${s.bringBack ? 'checked' : ''}><span>Nach der Abholung wieder reinstellen</span></label>
      <label class="field wide"><span>Hinweis (erscheint im Einsatz)</span><input type="text" id="ws-note" value="${esc(s.note || '')}" placeholder="z. B. Müllraum im Hof, Tonnen an den Gehsteig stellen"></label>
    </div></section>`
}

/** Müllplan aus dem Formular lesen. Ohne Formular im Dialog bleibt der gespeicherte Stand. */
export function readWaste() {
  if (!document.getElementById('ws-out')) return current()
  const prev = current().streams || []
  const streams = []
  for (let i = 0; document.getElementById(`wsr-type-${i}`); i++) {
    const rhythm = val(`wsr-rhythm-${i}`)
    const before = prev[i] ? rhythmOf(prev[i]) : { ref: '', dates: [] }
    const datesEl = document.getElementById(`wsr-dates-${i}`)
    const dates = datesEl ? datesIn(datesEl.value) : before.dates
    const ref = document.getElementById(`wsr-ref-${i}`)?.value || before.ref || dates[0] || app.cur.monday
    streams.push({ id: prev[i]?.id || uid('w'), type: val(`wsr-type-${i}`), recurrence: wasteRecurrence(rhythm, ref, dates) })
  }
  const waste = {
    streams,
    outWhen: val('ws-out'),
    bringBack: checked('ws-back'),
    minutes: Math.max(1, Math.round(num('ws-min') || WASTE_DEFAULTS.minutes)),
    responsible: val('ws-resp') || undefined,
    note: val('ws-note').trim() || undefined,
  }
  for (const k of Object.keys(waste)) if (waste[k] === undefined) delete waste[k]
  return waste
}

function importEntries(entries) {
  if (!entries.length) return toast('Keine Termine erkannt. Format: eine Zeile je Termin, z. B. „03.11.2026 Restmüll“.')
  const waste = readWaste()
  app.ui.modal.waste = { ...waste, streams: streamsFromEntries(entries, waste.streams) }
  app.ui.modal.wasteImport = false
  renderModalKeepingInput(ROW)
  const paste = document.getElementById('ws-paste')
  if (paste) paste.value = ''
  const perType = {}
  for (const e of entries) perType[e.type] = (perType[e.type] || 0) + 1
  toast(`${entries.length} Termine übernommen: ${Object.entries(perType).map(([t, n]) => `${t} ${n}`).join(', ')}. Mit „Speichern“ sichern.`)
}

const parseAny = (text) => (/BEGIN:VCALENDAR/i.test(text) ? parseIcs(text) : parseDateList(text, val('ws-default-type') || 'Restmüll'))

registerActions(
  {
    'waste-add': () => {
      const waste = readWaste()
      app.ui.modal.waste = { ...waste, streams: [...waste.streams, { id: uid('w'), type: 'Restmüll', recurrence: wasteRecurrence('w2', app.cur.monday) }] }
      renderModalKeepingInput(ROW)
    },
    'waste-remove': (el) => {
      const waste = readWaste()
      waste.streams.splice(Number(el.dataset.idx), 1)
      app.ui.modal.waste = waste
      renderModalKeepingInput(ROW)
    },
    'waste-redraw': () => {
      app.ui.modal.waste = readWaste()
      renderModalKeepingInput(ROW)
    },
    'waste-import': () => {
      app.ui.modal.wasteImport = true
      importEntries(parseAny(val('ws-paste')))
    },
    'waste-file': async (el) => {
      const file = el.files?.[0]
      if (!file) return
      app.ui.modal.wasteImport = true
      importEntries(parseAny(await file.text()))
    },
  },
  { edit: ['stammdaten', 'planung'] },
)
