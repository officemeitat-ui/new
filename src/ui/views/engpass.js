// Dialog „Engpass-Vorschau“ (Menü „⋯“ → Diese Woche): je Woche der nächsten 8 Wochen Bedarf an Stunden aus den
// Einsätzen gegen die verfügbaren Stunden der Mitarbeitenden (Vertrag minus Abwesenheiten), eingeteilt und offen,
// Ampel. Dazu ein Hinweis in „Zu erledigen“, wenn in den nächsten 4 Wochen der Bedarf die verfügbaren Stunden
// übersteigt. Rechenkern core/engpass.js.

import { capacityForecast, shortWeeks } from '../../core/engpass.js'
import { addDays, formatDate, isoWeek, mondayOf, todayISO } from '../../core/dates.js'
import { app, closeModal, computeRange, ensureRange, openModal, registerActions, registerModal, renderNow, stampMemo } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { esc, modalFrame } from '../shared.js'

export const WEEKS = 8
const TODO_WEEKS = 4
const LABEL = { rot: 'zu knapp', gelb: 'knapp', gruen: 'passt' }
const PILL = { rot: 'error', gelb: 'warning', gruen: 'ok' }
const h = (min) => `${Math.round(min / 60).toLocaleString('de-AT')} h` // ganze Stunden: es geht um die Größenordnung

/** Vorschau ab dem Montag dieser Woche; gemerkt am Datenstand (Einsätze, Einteilungen, Abwesenheiten, Personal). */
export function forecast(weeks = WEEKS) {
  const first = mondayOf(todayISO())
  const last = addDays(first, weeks * 7 - 1)
  return stampMemo(`engpass:${first}:${weeks}`, () => {
    const r = computeRange(first, last)
    // Einteilungen nur für geladene Wochen (sonst „noch nicht eingeteilt“)
    const state = r.state
    const list = Array.from({ length: weeks }, (_, i) => {
      const monday = addDays(first, i * 7)
      const sunday = addDays(monday, 6)
      return { monday, instances: r.instances.filter((x) => x.date >= monday && x.date <= sunday), state }
    })
    return capacityForecast({ weeks: list, employees: app.data.employees || [], absences: app.data.absences || [] })
  })
}

function modal() {
  const rows = forecast()
    .map((w) => {
      const kw = isoWeek(w.monday).week
      const pct = w.demand ? Math.round((w.reserve / w.demand) * 100) : 0
      return `<tr><td>KW ${kw}<br><span class="muted small">${esc(formatDate(w.monday, { weekday: false }))} – ${esc(formatDate(addDays(w.monday, 6), { weekday: false }))}</span></td>
        <td class="num">${esc(h(w.demand))}</td><td class="num">${esc(h(w.available))}</td>
        <td class="num ${w.reserve < 0 ? 'err-text' : ''}">${w.reserve < 0 ? '−' : ''}${esc(h(Math.abs(w.reserve)))}${w.demand ? `<br><span class="muted small">${pct < 0 ? '−' : ''}${Math.abs(pct)} %</span>` : ''}</td>
        <td class="num">${w.planned ? `${esc(h(w.assigned))}${w.open > 0 ? `<br><span class="muted small">offen ${esc(h(w.open))}</span>` : ''}` : '<span class="muted small">noch nicht eingeteilt</span>'}</td>
        <td class="num">${w.absent || ''}</td>
        <td><span class="pill ${PILL[w.level]}">${LABEL[w.level]}</span></td>
        <td><button class="btn small ghost" data-action="engpass-week" data-v="${esc(w.monday)}">Woche öffnen</button></td></tr>`
    })
    .join('')
  return modalFrame({
    title: 'Engpass-Vorschau',
    subtitle: `Die nächsten ${WEEKS} Wochen: Bedarf aus den Einsätzen gegen die Vertragsstunden`,
    wide: true,
    body: `<div class="table-wrap"><table class="data"><thead><tr><th>Woche</th><th class="num">Bedarf</th><th class="num">verfügbar</th><th class="num">Reserve</th><th class="num">eingeteilt</th><th class="num">abwesend</th><th>Stand</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note">Bedarf: alle Einsätze der Woche (je Einsatz mal die Zahl der Personen), ohne entfallene. Verfügbar: Vertragsstunden der aktiven Mitarbeitenden, ein Fünftel je Werktag, ohne Tage mit Abwesenheit (Urlaub, Krankenstand, Zeitausgleich …) und außerhalb der Beschäftigung. „Zu knapp“: der Bedarf ist größer als die Vertragsstunden – Vertretung, Mehrstunden oder Neueinstellung einplanen. „Knapp“: weniger als 10 % Reserve. Mehrstunden von Teilzeitkräften sind nicht eingerechnet.</p>`,
    foot: '<button class="btn" data-action="close-modal">Schließen</button>',
  })
}
registerModal('engpass', modal, { module: 'planung' })

registerActions({
  'engpass-open': async () => {
    await ensureRange(mondayOf(todayISO()), addDays(mondayOf(todayISO()), WEEKS * 7 - 1)).catch(() => {})
    openModal({ type: 'engpass' })
  },
  'engpass-week': (el) => {
    app.ui.monday = mondayOf(el.dataset.v)
    app.ui.month = null
    app.ui.view = 'week'
    closeModal()
    renderNow()
  },
})

registerTodo({
  id: 'engpass',
  module: 'planung',
  title: 'Engpass in den nächsten Wochen',
  compute: () => shortWeeks(forecast(TODO_WEEKS), todayISO()),
  render: (list) =>
    list
      .map((w) => `<div class="todo-item"><span class="flag error">!</span><div class="todo-text"><strong>KW ${isoWeek(w.monday).week}</strong>: Bedarf ${esc(h(w.demand))}, verfügbar ${esc(h(w.available))} (${esc(h(-w.reserve))} zu wenig)${w.absent ? `, ${w.absent} ${w.absent === 1 ? 'Person' : 'Personen'} abwesend` : ''}<br><span class="muted">Vertretung, Mehrstunden oder Neueinstellung einplanen.</span></div><button class="btn small" data-action="engpass-open">Vorschau</button></div>`)
      .join(''),
})
