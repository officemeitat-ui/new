// Wochen-Ablauf: führt Schritt für Schritt durch die Woche und zeigt immer
// den nächsten sinnvollen Klick. Einteilen → Offene Einsätze → Prüfen →
// Veröffentlichen → Versenden.

import { isoWeek } from '../core/dates.js'
import { app, plannedWeeks } from './context.js'
import { toSend } from './modals/send.js'
import { esc, ICON } from './shared.js'

export function weekSteps(c) {
  const active = c.week.filter((i) => i.status !== 'cancelled' && i.date >= c.monday && i.date <= c.sunday)
  const slots = active.reduce((s, i) => s + i.staff, 0)
  const open = active.reduce((s, i) => s + Math.max(0, i.staff - c.state.count(i.key)), 0) + c.validation.issues.filter((i) => i.code === 'ABSENT').length
  const errors = c.validation.issues.filter((i) => i.severity === 'error' && i.code !== 'OPEN' && i.code !== 'ABSENT').length
  const planned = plannedWeeks().has(c.monday) || (slots > 0 && open === 0)
  const p = c.published
  const changed = p?.snapshot ? c.ctx.employees.filter((e) => c.changedSincePublish(e)).length : 0
  const pending = p ? toSend(c).length : c.ctx.employees.length
  const kw = isoWeek(c.monday).week
  return [
    { id: 'plan', label: 'Einteilen', done: planned, info: planned ? 'eingeteilt' : 'Stammkräfte + Vertretungen', action: 'plan', button: `${ICON.bolt} Woche planen`, edit: true },
    { id: 'open', label: 'Offene Einsätze', done: planned && open === 0, info: open ? `${open} offen` : 'alles besetzt', action: 'view', view: 'coverage', button: 'Vertretungen ansehen' },
    { id: 'check', label: 'Prüfen', done: planned && errors === 0, info: errors ? `${errors} Verstöße` : `${c.validation.counts.warning || 0} Hinweise`, action: 'view', view: 'report', button: 'Prüfbericht' },
    { id: 'publish', label: 'Veröffentlichen', done: !!p && !changed, info: p ? (changed ? `${changed} geändert` : 'veröffentlicht') : 'Entwurf', action: 'open-publish', button: `${ICON.send} ${p ? 'Korrektur buchen' : `KW ${kw} veröffentlichen`}` },
    { id: 'send', label: 'Versenden', done: !!p && pending === 0, info: p ? (pending ? `${pending} zu versenden` : 'alle haben den Plan') : 'nach dem Veröffentlichen', action: 'open-send', button: `${ICON.send} ${pending} versenden` },
  ]
}

export function flowBar(c) {
  if (!c.ctx.employees.length) return ''
  const steps = weekSteps(c)
  const next = steps.find((s) => !s.done && !(s.edit && app.readOnly))
  return `<nav class="flow" aria-label="Ablauf der Woche">${steps
    .map((s, i) => {
      const state = s.done ? 'done' : s === next ? 'next' : 'todo'
      const attrs = `data-action="${s.action}"${s.view ? ` data-view="${s.view}"` : ''}`
      return `<button class="flow-step ${state}" ${attrs} title="${esc(s.info)}"><span class="flow-num">${s.done ? '✓' : i + 1}</span><span class="flow-text"><b>${s.label}</b><small>${esc(s.info)}</small></span></button>`
    })
    .join('<span class="flow-sep" aria-hidden="true"></span>')}
    ${next ? `<button class="btn primary flow-next ${next.edit ? 'edit-only' : ''}" data-action="${next.action}"${next.view ? ` data-view="${next.view}"` : ''}>${next.button}</button>` : '<span class="pill ok">Woche erledigt</span>'}</nav>`
}
