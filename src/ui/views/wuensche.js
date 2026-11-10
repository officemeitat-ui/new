// Dialog „Wünsche der Mitarbeitenden“ (Menü „⋯“ → Diese Woche): Wunschzeiten je Woche ansehen, im Büro eintragen
// (z. B. nach einem Anruf) und löschen; nach dem Planen steht je Wunsch, ob er erfüllt ist. Wünsche vom Handy kommen
// über „Plan am Handy“ (mein-plan.php) mit den Anträgen (staffplan.js loadWishes). Rechenkern core/wuensche.js; die Automatik
// (core/scheduler.js) berücksichtigt sie als weiche Vorgabe.

import { weeklyHoursAt } from '../../core/contract.js'
import { addDays, formatDate, isoWeek, mondayOf, todayISO } from '../../core/dates.js'
import { makeWish, WISH_KINDS, wishKey, wishReport } from '../../core/wuensche.js'
import { app, canEdit, computeRange, confirmStep, openModal, persist, registerActions, registerModal, renderModal, toast } from '../context.js'
import { esc, modalFrame, options, uid, val } from '../shared.js'
import { forgetHandyWish } from '../staffplan.js'

const editable = () => canEdit('planung')
const wishes = () => (app.data.wishes ||= {})
const empName = (id) => app.data.employees.find((e) => e.id === id)?.name || 'Person (gelöscht)'

/** Wünsche einer Woche (Tageswünsche der Woche und Wochenwünsche mit diesem Montag). */
export const weekWishes = (monday) => Object.values(app.data.wishes || {}).filter((w) => w?.date >= monday && w.date <= addDays(monday, 6))

function modal(c, m) {
  const monday = m.monday || app.ui.monday
  const sunday = addDays(monday, 6)
  const list = weekWishes(monday)
  const r = list.length ? computeRange(monday, sunday) : null
  const report = r
    ? wishReport(Object.fromEntries(list.map((w) => [w.id, w])), {
        instancesOf: (id) => r.state.instancesOf(id),
        contractMin: (id, mon) => {
          const e = r.ctx.employeesById.get(id)
          return e ? weeklyHoursAt(e, mon) * 60 : 0
        },
        from: monday,
        to: sunday,
      })
    : []
  const planned = report.length && list.some((w) => (r.state.instancesOf(w.empId) || []).length)
  const ok = report.filter((x) => x.ok).length
  const rows = report
    .map(({ wish: w, ok: fine, text }) => `<tr><td>${esc(empName(w.empId))}</td><td>${WISH_KINDS[w.kind].week ? `Woche ab ${formatDate(w.date, { weekday: false })}` : formatDate(w.date)}</td>
      <td>${esc(WISH_KINDS[w.kind].label)}${w.note ? `<br><span class="muted small">${esc(w.note)}</span>` : ''}</td>
      <td><span class="muted small">${w.source === 'handy' ? 'Handy' : 'Büro'}</span></td>
      <td>${planned ? `<span class="pill ${fine ? 'ok' : 'warning'}">${fine ? 'erfüllt' : 'nicht erfüllt'}</span><br><span class="muted small">${esc(text)}</span>` : '<span class="muted">noch nicht geplant</span>'}</td>
      <td class="actions-cell">${editable() ? `<button class="btn small ${app.ui.confirm === `wish-del:${w.id}` ? 'danger' : 'ghost'}" data-action="wish-del" data-id="${esc(w.id)}" aria-label="Wunsch löschen">${app.ui.confirm === `wish-del:${w.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</td></tr>`)
    .join('')
  const d = m.draft || {}
  const emps = [...app.data.employees].filter((e) => !e.inactive).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  return modalFrame({
    title: 'Wünsche der Mitarbeitenden',
    subtitle: `KW ${isoWeek(monday).week} · ${formatDate(monday, { weekday: false })} – ${formatDate(sunday, { weekday: false, year: true })}`,
    wide: true,
    body: `<div class="toolbar"><div class="seg" role="group" aria-label="Woche"><button class="btn small" data-action="wish-week" data-v="${esc(addDays(monday, -7))}" aria-label="Vorige Woche">‹</button><button class="btn small" data-action="wish-week" data-v="${esc(addDays(monday, 7))}" aria-label="Nächste Woche">›</button></div>
      ${report.length && planned ? `<span class="pill ${ok === report.length ? 'ok' : 'info'}">${ok} von ${report.length} erfüllt</span>` : ''}</div>
      ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th>Wann</th><th>Wunsch</th><th>Von</th><th>Stand</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Keine Wünsche in dieser Woche.</p>'}
      ${
        editable()
          ? `<h3>Wunsch eintragen</h3><div class="form-grid">
        <label class="field"><span>Person</span><select id="wish-emp">${options(emps.map((e) => [e.id, e.name]), d.empId || '', { empty: '–' })}</select></label>
        <label class="field"><span>Datum</span><input type="date" id="wish-date" value="${esc(d.date || addDays(monday, 2))}" min="${esc(addDays(todayISO(), 1))}"></label>
        <label class="field"><span>Wunsch</span><select id="wish-kind">${options(Object.entries(WISH_KINDS).map(([k, x]) => [k, x.label]), d.kind || 'frei')}</select></label>
        <label class="field"><span>Notiz (optional)</span><input type="text" id="wish-note" maxlength="160" value="${esc(d.note || '')}" placeholder="z. B. Familienfeier (keine Gesundheitsangaben)"></label>
      </div>`
          : ''
      }
      <p class="note">Wünsche sind keine Abwesenheit und kein Anspruch: Stammkräfte bleiben eingeteilt, offene Einsätze gibt die Automatik lieber an jemanden ohne Wunsch. Mitarbeitende tragen Wünsche im „Plan am Handy“ ein (bis ${Math.round(56 / 7)} Wochen voraus, höchstens 4 je Woche).</p>`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${editable() ? '<button class="btn primary" data-action="wish-add">Wunsch eintragen</button>' : ''}</div>`,
  })
}
registerModal('wishes', modal, { module: 'planung' })

registerActions({
  'wish-open': () => openModal({ type: 'wishes', monday: app.ui.monday }),
  'wish-week': (el) => {
    const m = app.ui.modal
    if (m?.type !== 'wishes') return
    m.monday = mondayOf(el.dataset.v)
    renderModal()
  },
  'wish-add': () => {
    const m = app.ui.modal
    if (m?.type !== 'wishes' || !editable()) return
    const input = { empId: val('wish-emp'), date: val('wish-date'), kind: val('wish-kind'), note: val('wish-note') }
    m.draft = input
    const res = makeWish(input, { existing: Object.values(wishes()), today: todayISO(), newId: () => uid('w'), source: 'buero', by: app.user?.name || '' })
    if (res.error) return toast(res.error)
    wishes()[wishKey(res.wish)] = res.wish
    persist()
    m.draft = { empId: input.empId }
    m.monday = mondayOf(res.wish.date)
    toast(`Wunsch eingetragen: ${empName(res.wish.empId)}, ${WISH_KINDS[res.wish.kind].label}.`)
    renderModal()
  },
  'wish-del': (el) => {
    if (!editable()) return
    const k = Object.keys(wishes()).find((key) => wishes()[key]?.id === el.dataset.id)
    if (!k || !confirmStep(`wish-del:${el.dataset.id}`, renderModal)) return
    const w = wishes()[k]
    delete wishes()[k]
    persist()
    // vom Handy: auch am Webspace löschen, sonst käme er beim nächsten Abruf wieder
    if (w?.source === 'handy' && w.webId) forgetHandyWish(w.webId)
    toast('Wunsch gelöscht.')
    renderModal()
  },
})
