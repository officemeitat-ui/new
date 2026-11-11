// Müllplan: Abfuhrtage der Woche je Objekt und wer die Tonnen raus- und
// reinstellt (mit einem Einsatz im Objekt oder als eigener Gang).

import { formatDate } from '../../core/dates.js'
import { personWastePlan } from '../../core/muellplan.js'
import { autoPlan } from '../../core/scheduler.js'
import { streamText, wasteSettings } from '../../core/waste.js'
import { wastePlanDocument, wastePlanPdfName } from '../../export/muellplan-pdf.js'
import { addLog, app, empName, openModal, persist, recordUndo, registerActions, registerModal, registerView, renderNow, toast } from '../context.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { download, esc, ICON, modalFrame } from '../shared.js'
import { waNumber } from '../../core/whatsapp.js'
import { sendFileWhatsApp } from '../whatsapp.js'
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

/** Müll-Gänge der Woche je Person (nur eingeteilte, nicht abgesagte): Map employeeId → [Gang] */
export function dutiesByPerson(c, list = weekDuties(c)) {
  const out = new Map()
  for (const { duty, inst } of list) {
    if (inst.status === 'cancelled') continue
    for (const a of c.state.assigned(inst.key)) {
      if (!out.has(a.employeeId)) out.set(a.employeeId, [])
      out.get(a.employeeId).push(duty)
    }
  }
  return out
}

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
    <div class="actions"><button class="btn" data-action="waste-sheets-open" ${all.length ? '' : 'disabled'} title="Eine Seite je Person: Tage, Orte, was raus und was zurück kommt – als PDF oder per WhatsApp">${ICON.download || ''} Müllpläne je Person</button><span class="edit-only"><button class="btn primary" data-action="waste-plan" ${open.length ? '' : 'disabled'}>Müll-Gänge einteilen</button></span></div></div>
    ${regionFilter()}
    ${withPlan.length ? `<div class="objects">${cards}</div>` : '<p class="note">Noch kein Objekt mit Müllplan. Unter „Objekte & Leistungen“ beim Objekt die Abfuhrtage eintragen oder den Abfuhrkalender einlesen.</p>'}
    ${without.length ? `<details class="waste-without-box"><summary>${without.length} ${without.length === 1 ? 'Objekt' : 'Objekte'} ohne Müllplan</summary><div class="waste-without">${without.map((o) => `<button class="btn small" data-action="obj-edit" data-id="${esc(o.id)}" data-focus="waste-form" ${app.readOnly ? 'disabled' : ''}>${esc(o.short || o.name)}</button>`).join('')}</div></details>` : ''}`
}

registerView({ id: 'waste', order: 47, label: 'Müllplan', group: 'plan', render: wasteView })

/** Pläne der Woche je Person: [{ id, name, plan }] nach Namen. */
function sheetsOf(c) {
  return [...dutiesByPerson(c)].map(([id, duties]) => ({ id, name: empName(id), plan: personWastePlan(duties, app.data.objects, c.monday) })).sort((a, b) => a.name.localeCompare(b.name, 'de'))
}
const wasteBlob = async (c, sheets) => pdfBlob(wastePlanDocument({ sheets, monday: c.monday, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) }))

/** Dialog: je Person PDF oder WhatsApp, dazu alle als ein PDF. */
registerModal('waste-sheets', (c) => {
  const sheets = sheetsOf(c)
  const open = openDuties(c, weekDuties(c)).length
  const phoneOf = (id) => (app.data.employees || []).find((e) => e.id === id)?.phone || ''
  const rows = sheets
    .map((x) => {
      const n = x.plan.days.reduce((k, d) => k + d.groups.reduce((m, g) => m + g.lines.length, 0), 0)
      return `<tr><td><strong>${esc(x.name)}</strong><br><span class="muted">${esc(x.plan.towns.join(', ') || 'ohne Ort')} · ${n} ${n === 1 ? 'Zeile' : 'Zeilen'}</span></td>
        <td class="send-acts"><button class="btn small" data-action="waste-person-pdf" data-emp="${esc(x.id)}">${ICON.sheet} PDF</button><button class="btn small" data-action="waste-person-wa" data-emp="${esc(x.id)}" title="${esc(waNumber(phoneOf(x.id)) ? `Per WhatsApp an ${phoneOf(x.id)}` : 'Per WhatsApp (Handy-Nummer im Stammblatt fehlt: Kontakt in WhatsApp wählen)')}">${ICON.chat} WhatsApp</button></td></tr>`
    })
    .join('')
  return modalFrame({
    title: 'Müllpläne je Person',
    subtitle: `Woche ab ${formatDate(c.monday, { year: true })}`,
    body: sheets.length
      ? `<div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${open ? `<p class="note">${open} ${open === 1 ? 'Gang ist' : 'Gänge sind'} noch ohne Person und stehen auf keinem Plan.</p>` : ''}`
      : '<p class="empty">Diese Woche ist noch kein Müll-Gang einer Person zugeteilt: zuerst „Müll-Gänge einteilen“.</p>',
    foot: `<button class="btn" data-action="close-modal">Schließen</button>${sheets.length ? `<button class="btn primary" data-action="waste-person-pdf">${ICON.download} Alle als ein PDF</button>` : ''}`,
  })
})

registerActions({
  'waste-sheets-open': () => openModal({ type: 'waste-sheets' }),
  // ohne data-emp: alle Personen in einem PDF (eine Seite je Person)
  'waste-person-pdf': async (el) => {
    const c = app.cur
    const all = sheetsOf(c)
    const sheets = el?.dataset?.emp ? all.filter((x) => x.id === el.dataset.emp) : all
    if (!sheets.length) return toast('Diese Woche ist noch kein Müll-Gang einer Person zugeteilt: zuerst „Müll-Gänge einteilen“.')
    const open = openDuties(c, weekDuties(c)).length
    download(wastePlanPdfName(c.monday, sheets.length === 1 ? sheets[0].name : ''), await wasteBlob(c, sheets))
    toast(`${sheets.length} ${sheets.length === 1 ? 'Müllplan' : 'Müllpläne'} erstellt${open && sheets.length > 1 ? ` · ${open} ${open === 1 ? 'Gang ist' : 'Gänge sind'} noch ohne Person` : ''}.`)
  },
  'waste-person-wa': async (el) => {
    const c = app.cur
    const x = sheetsOf(c).find((s) => s.id === el.dataset.emp)
    if (!x) return
    const emp = (app.data.employees || []).find((e) => e.id === x.id) || {}
    try {
      await sendFileWhatsApp({ kind: 'muellplan', makeBlob: () => wasteBlob(c, [x]), name: wastePlanPdfName(c.monday, x.name), phone: emp.phone, title: 'Müllplan', text: `Hallo ${String(x.name).split(' ')[0]}, dein Müllplan für die Woche ab ${formatDate(c.monday, { weekday: false, year: true })}.` })
    } catch (err) {
      toast(`WhatsApp fehlgeschlagen: ${err.message}`)
    }
  },
})

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
