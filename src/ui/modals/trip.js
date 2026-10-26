// Fahrt nach einem Einsatz planen: Dauer und eigene Notiz, für diese Woche
// oder als Standard der Leistung.

import { formatDate, formatTime, mondayOf } from '../../core/dates.js'
import { tripKey } from '../../core/rules.js'
import { addLog, app, closeModal, empName, openModal, persist, recordUndo, registerActions, registerModal, renderNow, toast } from '../context.js'
import { byStart, esc, ICON, modalFrame, num, objectOf, val } from '../shared.js'

const SOURCE = { woche: 'für diese Woche geplant', leistung: 'Standard der Leistung', automatisch: 'automatisch (Fahrzeit-Matrix bzw. Pauschale)', keine: 'keine Fahrt geplant' }

/** Einsatz, Folgeeinsatz und geplante Fahrt einer Person. */
export function tripContext(c, key, empId) {
  const inst = c.state.instByKey.get(key)
  if (!inst) return null
  const day = c.state.instancesOf(empId).filter((i) => i.date === inst.date).sort(byStart)
  const next = day[day.findIndex((i) => i.key === key) + 1] || null
  return { inst, next, trip: c.ctx.tripAfter(empId, inst, next), auto: next ? c.ctx.travel(inst.objectId, next.objectId) : 0 }
}

function tripModal(c, { key, emp }) {
  const t = tripContext(c, key, emp)
  if (!t) return null
  const { inst, next, trip, auto } = t
  const from = objectOf(c, inst)
  const to = next ? objectOf(c, next) : null
  const entry = app.data.trips?.[tripKey(inst, emp)] || {}
  const gap = next ? next.start - inst.end : null
  const tight = next && trip.minutes > gap
  const quick = [0, 15, 20, 30, 45, 60]
  return modalFrame({
    title: `Fahrt ${from.short || from.name} → ${to ? to.short || to.name : 'Rückfahrt'}`,
    subtitle: `${esc(empName(emp))} · ${formatDate(inst.date)}`,
    color: from.color,
    body: `<div class="trip-route">
        <div class="trip-stop"><span class="swatch" style="--obj:var(--o${from.color})"></span><strong>${esc(from.name)}</strong><span class="muted">${inst.startTime}–${inst.endTime}</span></div>
        <div class="trip-arrow ${tight ? 'err-text' : ''}">${ICON.car} ${trip.minutes ? `${trip.minutes} min` : 'keine Fahrt'}${gap !== null ? ` · Zeit bis zum nächsten Einsatz ${gap} min` : ''}</div>
        <div class="trip-stop">${to ? `<span class="swatch" style="--obj:var(--o${to.color})"></span><strong>${esc(to.name)}</strong><span class="muted">${next.startTime}–${next.endTime}</span>` : '<span class="muted">Letzter Einsatz des Tages: z. B. Rückfahrt ins Büro oder Lager eintragen</span>'}</div>
      </div>
      <p class="note">Derzeit: <strong>${trip.minutes} min</strong>, ${SOURCE[trip.source]}${to ? `. Automatisch wären es ${auto} min.` : '.'}${tight ? ` <span class="err-text">Die Fahrt passt nicht in die ${gap} min bis zum nächsten Einsatz.</span>` : ''} Fahrzeit zählt als Arbeitszeit und erscheint im Wochenzettel in der Spalte „Fahrzeit“.</p>
      <div class="form-grid edit-only">
        <label class="field"><span>Fahrzeit (Minuten)</span><input type="number" id="trip-min" min="0" step="5" value="${Number.isFinite(entry.min) ? entry.min : ''}" placeholder="automatisch: ${next ? auto : 0}"></label>
        <div class="field"><span>Schnellwahl</span><div class="weekday-picker">${quick.map((m) => `<button class="btn small" data-action="trip-quick" data-min="${m}">${m}</button>`).join('')}</div></div>
        <label class="field wide"><span>Notiz zur Fahrt (erscheint im Wochenzettel und in der Zeitlinie)</span><input type="text" id="trip-note" value="${esc(entry.note || '')}" placeholder="${esc(inst.travelNote || 'z. B. Firmenauto, Schlüssel im Büro holen, Öffi Linie 3')}"></label>
      </div>`,
    foot: `<button class="btn edit-only" data-action="trip-reset" data-key="${esc(key)}" data-emp="${esc(emp)}" ${Object.keys(entry).length ? '' : 'disabled'}>Zurücksetzen</button>
      <div class="actions edit-only">${inst.category === 'muell' ? '' : `<button class="btn" data-action="trip-default" data-key="${esc(key)}" data-emp="${esc(emp)}" title="Gilt jede Woche für diese Leistung, für alle Personen">Als Standard der Leistung</button>`}<button class="btn primary" data-action="trip-save" data-key="${esc(key)}" data-emp="${esc(emp)}">Für diese Woche speichern</button></div>`,
  })
}

registerModal('trip', tripModal, { module: 'planung' })

const readForm = () => {
  const raw = val('trip-min').trim()
  const min = raw === '' ? undefined : Math.max(0, Math.round(num('trip-min') ?? 0))
  const note = val('trip-note').trim() || undefined
  return { min, note }
}

registerActions({
  'open-trip': (el) => openModal({ type: 'trip', key: el.dataset.key, emp: el.dataset.emp }),
  'trip-quick': (el) => {
    const input = document.getElementById('trip-min')
    if (input) input.value = el.dataset.min
  },
})

registerActions(
  {
    'trip-save': (el) => {
      recordUndo('Fahrt geplant')
      const { key, emp } = el.dataset
      const inst = app.cur.state.instByKey.get(key)
      const { min, note } = readForm()
      app.data.trips = app.data.trips || {}
      const k = tripKey(inst, emp)
      if (min === undefined && !note) delete app.data.trips[k]
      else app.data.trips[k] = { ...(min !== undefined ? { min } : {}), ...(note ? { note } : {}) }
      addLog(mondayOf(inst.origDate), `Fahrt geplant: ${empName(emp)} nach ${objectOf(app.cur, inst).name} ${formatDate(inst.date)} ${formatTime(inst.end)}${min !== undefined ? `, ${min} min` : ''}${note ? `, ${note}` : ''}`)
      persist()
      closeModal()
      renderNow()
      toast('Fahrt für diese Woche gespeichert.')
    },
    'trip-default': (el) => {
      recordUndo('Fahrt als Standard')
      const { key, emp } = el.dataset
      const inst = app.cur.state.instByKey.get(key)
      const task = app.data.tasks.find((x) => x.id === inst.taskId)
      if (!task) return
      const { min, note } = readForm()
      if (min === undefined) delete task.travelAfterMin
      else task.travelAfterMin = min
      if (note) task.travelNote = note
      else delete task.travelNote
      delete app.data.trips?.[tripKey(inst, emp)]
      persist()
      closeModal()
      renderNow()
      toast(`Standard für „${task.label}“ gespeichert: gilt jede Woche.`)
    },
    'trip-reset': (el) => {
      recordUndo('Fahrt zurückgesetzt')
      const { key, emp } = el.dataset
      delete app.data.trips?.[tripKey(app.cur.state.instByKey.get(key), emp)]
      persist()
      closeModal()
      renderNow()
    },
  },
  { edit: 'planung' },
)

