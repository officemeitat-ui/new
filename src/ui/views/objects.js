// Objektplan: Objekte/Leistungen × Tage.

import { formatDate } from '../../core/dates.js'
import { maxSeverity } from '../../core/rules.js'
import { app, registerView } from '../context.js'
import { dayClass, dayHeads, esc, options, rhythmText } from '../shared.js'

export function regions() {
  return [...new Set(app.data.objects.map((o) => o.region).filter(Boolean))].sort()
}

export function regionFilter() {
  const list = regions()
  if (!list.length) return ''
  return `<div class="toolbar filters-bar"><label class="field inline"><span>Revier</span><select id="f-region">${options(list.map((r) => [r, r]), app.ui.region, { empty: 'Alle Reviere' })}</select></label></div>`
}

function slot(c, inst) {
  const names = c.state.assigned(inst.key).map((a) => c.ctx.employeesById.get(a.employeeId)?.name.split(' ')[0] || '?')
  if (inst.status === 'cancelled') {
    const why = inst.reason === 'holiday' ? inst.origHoliday?.name || 'Feiertag' : 'diese Woche'
    return `<button class="slot cancelled" data-action="open-shift" data-key="${esc(inst.key)}"><span class="who">${inst.startTime}–${inst.endTime}</span><span>entfällt: ${esc(why)}</span></button>`
  }
  const sev = maxSeverity((c.validation.byShift.get(inst.key) || []).filter((i) => i.severity !== 'info'))
  const missing = inst.staff - names.length
  return `<button class="slot ${sev ? `sev-${sev}` : ''}" data-action="open-shift" data-key="${esc(inst.key)}">
    <span class="who">${names.length ? esc(names.join(', ')) : 'offen'}</span>
    <span class="muted">${inst.startTime}–${inst.endTime}${missing > 0 && names.length ? ` · ${missing} offen` : ''}${inst.status === 'moved' ? ` · von ${formatDate(inst.origDate)}` : ''}</span></button>`
}

function objectsView(c) {
  const region = app.ui.region
  const blocks = app.data.objects
    .filter((o) => !region || o.region === region)
    .map((obj) => {
      const tasks = app.data.tasks.filter((t) => t.objectId === obj.id && c.week.some((i) => i.taskId === t.id))
      if (!tasks.length) return ''
      const rows = tasks
        .map((task) => {
          const cells = c.days
            .map((d) => {
              const list = c.week.filter((i) => i.taskId === task.id && (i.status === 'cancelled' ? i.origDate === d : i.date === d))
              return `<td class="${dayClass(c, d)}"><div class="cell-stack">${list.map((i) => slot(c, i)).join('')}</div></td>`
            })
            .join('')
          const regs = task.regulars.map((id) => c.ctx.employeesById.get(id)?.name).filter(Boolean)
          return `<tr><th class="name-col"><span class="${task.category === 'sonder' ? 'tag special' : ''}">${esc(task.label)}</span><span class="emp-meta">${esc(rhythmText(task))} · ${task.staff} P.</span></th>${cells}<td class="sum">${regs.length ? esc(regs.join(', ')) : '<span class="muted">keine Stammkraft</span>'}</td></tr>`
        })
        .join('')
      return `<tr class="obj-row"><th class="name-col"><span class="swatch" style="--obj:var(--o${obj.color})"></span>${esc(obj.name)}</th><td colspan="8" class="muted">${esc([obj.address, obj.region].filter(Boolean).join(' · '))}${obj.onlyTrained ? ' · nur eingeschultes Personal' : ''}</td></tr>${rows}`
    })
    .join('')
  return `${regionFilter()}<div class="grid-wrap"><table class="grid"><thead><tr><th class="name-col">Objekt / Leistung</th>${dayHeads(c)}<th class="sum-col">Stammkraft</th></tr></thead><tbody>${blocks}</tbody></table></div>`
}

registerView({ id: 'objects', order: 30, label: 'Objektplan', group: 'plan', summary: true, render: objectsView })
