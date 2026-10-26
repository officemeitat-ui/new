// Müllplan: Abfuhrtage der Woche je Objekt und wer die Tonnen raus- und
// reinstellt (mit einem Einsatz im Objekt oder als eigener Gang).

import { formatDate } from '../../core/dates.js'
import { autoPlan } from '../../core/scheduler.js'
import { streamText, wasteSettings } from '../../core/waste.js'
import { addLog, app, empName, persist, recordUndo, registerActions, registerView, renderNow, toast } from '../context.js'
import { esc, ICON } from '../shared.js'
import { regionFilter } from './objects.js'

/** Alle Gänge der Woche: { duty, inst, attached } */
export function weekDuties(c) {
  const out = []
  for (const inst of c.instances) {
    if (inst.date < c.monday || inst.date > c.sunday) continue
    for (const duty of inst.addOns || []) out.push({ duty, inst, attached: true })
    if (inst.waste) out.push({ duty: inst.waste, inst, attached: false })
  }
  return out.sort((a, b) => a.duty.date.localeCompare(b.duty.date) || (a.duty.action === 'out') - (b.duty.action === 'out'))
}

const openDuties = (c, list) => list.filter((d) => !d.attached && d.inst.status !== 'cancelled' && c.state.count(d.inst.key) < d.inst.staff)

function dutyRow(c, { duty, inst, attached }) {
  const names = c.state.assigned(inst.key).map((a) => empName(a.employeeId))
  const how = attached
    ? `mit Einsatz ${inst.startTime}–${inst.endTime} ${esc(inst.label)} <span class="muted">(+${duty.minutes} min)</span>`
    : `eigener Gang ${inst.startTime}–${inst.endTime}`
  const who =
    inst.status === 'cancelled'
      ? '<span class="pill info">entfällt</span>'
      : names.length
        ? `<span class="pill ok name">${esc(names.join(', '))}</span>`
        : '<span class="pill error">offen</span>'
  return `<tr>
    <td>${formatDate(duty.date)}</td>
    <td><strong>${duty.action === 'out' ? 'Rausstellen' : 'Reinstellen'}</strong><br><span class="muted">${esc(duty.types.join(', '))}${duty.action === 'out' ? ` · Abfuhr ${formatDate(duty.collection)}` : ''}</span></td>
    <td>${how}</td><td>${who}</td>
    <td><button class="btn small" data-action="open-shift" data-key="${esc(inst.key)}">Öffnen</button></td></tr>`
}

function wasteView(c) {
  const region = app.ui.region
  const objects = app.data.objects.filter((o) => !region || o.region === region)
  const withPlan = objects.filter((o) => o.waste?.streams?.length)
  const without = objects.filter((o) => !o.waste?.streams?.length)
  const all = weekDuties(c)
  const open = openDuties(c, all)
  const cards = withPlan
    .map((obj) => {
      const list = all.filter((d) => d.duty.objectId === obj.id)
      const s = wasteSettings(obj)
      return `<article class="object-card" style="--obj:var(--o${obj.color})">
        <header><h3>${esc(obj.name)}</h3><span class="addr">${esc(obj.waste.streams.map(streamText).join(' · '))} · raus ${s.outWhen === 'abholtag' ? 'in der Früh' : 'am Vorabend'}${s.bringBack ? ', rein am Abholtag' : ''}</span>
          <span class="edit-only"><button class="btn small" data-action="obj-edit" data-id="${esc(obj.id)}" data-focus="waste-form">Müllplan bearbeiten</button></span></header>
        ${obj.waste.note ? `<div class="folder-line"><span>${esc(obj.waste.note)}</span></div>` : ''}
        ${list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Tag</th><th>Gang</th><th>Wie</th><th>Wer</th><th></th></tr></thead><tbody>${list.map((d) => dutyRow(c, d)).join('')}</tbody></table></div>` : '<p class="note" style="padding:10px 14px;margin:0">Diese Woche keine Abfuhr.</p>'}
      </article>`
    })
    .join('')
  const attached = all.filter((d) => d.attached).length
  return `<div class="section-head"><div><h2>${ICON.trash} Müllplan <span class="muted">(${all.length} Gänge diese Woche)</span></h2><p>Abfuhrtage je Objekt und wer die Tonnen raus- und reinstellt. ${attached} Gänge laufen mit einem Einsatz mit, ${all.length - attached} als eigener Gang.${open.length ? ` <span class="err-text">${open.length} noch offen.</span>` : ''}</p></div>
    <div class="actions edit-only"><button class="btn primary" data-action="waste-plan" ${open.length ? '' : 'disabled'}>Müll-Gänge einteilen</button></div></div>
    ${regionFilter()}
    ${withPlan.length ? `<div class="objects">${cards}</div>` : '<p class="note">Noch kein Objekt mit Müllplan. Unter „Objekte & Leistungen“ beim Objekt die Abfuhrtage eintragen oder den Abfuhrkalender einlesen.</p>'}
    ${without.length ? `<details class="waste-without-box"><summary>${without.length} ${without.length === 1 ? 'Objekt' : 'Objekte'} ohne Müllplan</summary><div class="waste-without">${without.map((o) => `<button class="btn small" data-action="obj-edit" data-id="${esc(o.id)}" data-focus="waste-form" ${app.readOnly ? 'disabled' : ''}>${esc(o.short || o.name)}</button>`).join('')}</div></details>` : ''}`
}

registerView({ id: 'waste', order: 47, label: 'Müllplan', group: 'plan', render: wasteView })

registerActions(
  {
    'waste-plan': () => {
      const c = app.cur
      const open = openDuties(c, weekDuties(c))
      if (!open.length) return toast('Alle Müll-Gänge sind eingeteilt.')
      recordUndo('Müll-Gänge einteilen')
      const res = autoPlan(c.ctx, c.instances, app.data.assignments, { from: c.monday, to: c.sunday, only: new Set(open.map((d) => d.inst.key)) })
      app.data.assignments = res.assignments
      addLog(c.monday, `Müll-Gänge eingeteilt: ${open.length - res.open.length} von ${open.length}`)
      persist()
      renderNow()
      toast(res.open.length ? `${open.length - res.open.length} Gänge eingeteilt, ${res.open.length} bleiben offen.` : `${open.length} Müll-Gänge eingeteilt.`)
    },
  },
  { edit: 'planung' },
)
