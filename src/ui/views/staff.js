// Mitarbeitende: Liste, Bearbeiten, Import aus Excel.

import { formatHours, WEEKDAY_LONG } from '../../core/dates.js'
import { EMPLOYEE_TEMPLATE, importEmployees, importTasks, TASK_TEMPLATE } from '../../core/importer.js'
import { app, closeModal, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { availabilitySummary, checkboxes, checked, checkedValues, EMPLOYMENT_TYPES, esc, ICON, modalFrame, num, uid, val } from '../shared.js'
import { copyText } from './sheet.js'
import { filterBar, filteredEmployees } from './week.js'

function staffView(c) {
  const objName = (id) => app.data.objects.find((o) => o.id === id)?.short || '?'
  const rows = filteredEmployees(c)
    .map(
      (e) => `<tr>
      <td><strong>${esc(e.name)}</strong>${e.personnelNo ? ` <span class="muted">#${esc(e.personnelNo)}</span>` : ''}${e.note ? `<br><span class="muted">${esc(e.note)}</span>` : ''}${e.email ? `<br><span class="muted">${esc(e.email)}</span>` : ''}</td>
      <td>${esc(e.team || '–')}</td>
      <td>${esc(e.type)}${e.minor ? '<br><span class="tag">unter 18 (KJBG)</span>' : ''}</td>
      <td class="num">${formatHours(e.weeklyHours * 60)} h${e.maxMonthHours ? `<br><span class="muted">max. ${formatHours(e.maxMonthHours * 60)} h/Monat</span>` : ''}</td>
      <td><div class="tags">${(e.skills || []).map((s) => `<span class="tag">${esc(s)}</span>`).join('') || '<span class="muted">–</span>'}</div></td>
      <td><div class="tags">${(e.trained || []).slice(0, 6).map((id) => `<span class="tag">${esc(objName(id))}</span>`).join('')}${(e.trained || []).length > 6 ? `<span class="tag">+${e.trained.length - 6}</span>` : ''}</div></td>
      <td>${esc(availabilitySummary(e)) || '<span class="muted">keine</span>'}</td>
      <td class="edit-only"><button class="btn small" data-action="emp-edit" data-id="${esc(e.id)}">Bearbeiten</button></td></tr>`,
    )
    .join('')
  return `<div class="section-head"><div><h2>Mitarbeitende <span class="muted">(${app.data.employees.length})</span></h2><p>Wochenstunden laut Vertrag (Soll), Revier, Qualifikationen, Einschulung in Objekten (Schlüssel, Alarm, Abläufe) und Verfügbarkeit.</p></div>
    <div class="actions edit-only"><button class="btn" data-action="import-open" data-kind="employees">${ICON.upload} Aus Excel einfügen</button><button class="btn primary" data-action="emp-edit" data-id="new">${ICON.plus} Mitarbeiter:in anlegen</button></div></div>
    ${filterBar(c, { problems: false })}
    <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Revier</th><th>Beschäftigung</th><th>Soll</th><th>Qualifikationen</th><th>Eingeschult</th><th>Verfügbar</th><th class="edit-only"></th></tr></thead><tbody>${rows}</tbody></table></div>`
}

function employeeModal(c, { id }) {
  const e = id === 'new' ? { id: 'new', name: '', type: 'Teilzeit', weeklyHours: 20, skills: [], trained: [], availability: {}, team: app.ui.team || '' } : app.data.employees.find((x) => x.id === id)
  if (!e) return null
  const teams = [...new Set(app.data.employees.map((x) => x.team).filter(Boolean))]
  const avail = [1, 2, 3, 4, 5, 6, 7]
    .map((d) => {
      const w = e.availability?.[d]
      return `<label class="check"><input type="checkbox" id="emp-av-on-${d}" ${w ? 'checked' : ''}><span>${WEEKDAY_LONG[d - 1]}</span></label>
        <input type="time" id="emp-av-from-${d}" value="${esc(w?.from || '06:00')}" aria-label="${WEEKDAY_LONG[d - 1]} von"><input type="time" id="emp-av-to-${d}" value="${esc(w?.to || '20:00')}" aria-label="${WEEKDAY_LONG[d - 1]} bis">`
    })
    .join('')
  const confirmDel = app.ui.confirm === 'emp-delete'
  return modalFrame({
    title: id === 'new' ? 'Mitarbeiter:in anlegen' : e.name,
    body: `<div class="form-grid">
        <label class="field"><span>Name</span><input type="text" id="emp-name" value="${esc(e.name)}" required></label>
        <label class="field"><span>Personalnummer</span><input type="text" id="emp-pnr" value="${esc(e.personnelNo || '')}"></label>
        <label class="field"><span>Revier / Team</span><input type="text" id="emp-team" list="team-list" value="${esc(e.team || '')}"><datalist id="team-list">${teams.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></label>
        <label class="field"><span>E-Mail (Microsoft 365)</span><input type="email" id="emp-email" value="${esc(e.email || '')}"></label>
        <label class="field"><span>Beschäftigung</span><select id="emp-type">${EMPLOYMENT_TYPES.map((t) => `<option ${t === e.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field"><span>Wochenstunden (Soll)</span><input type="number" id="emp-hours" step="0.5" min="0" value="${e.weeklyHours ?? ''}"></label>
        <label class="field"><span>Max. Stunden pro Monat (geringfügig)</span><input type="number" id="emp-maxmonth" step="0.5" min="0" value="${e.maxMonthHours ?? ''}" placeholder="leer = kein Limit"></label>
        <label class="field"><span>Urlaubsanspruch (Arbeitstage/Jahr)</span><input type="number" id="emp-vacation" step="1" min="0" value="${e.vacationDaysYear ?? 25}"></label>
        <label class="field"><span>Zeitkonto Startsaldo (h)</span><input type="number" id="emp-start" step="0.25" value="${e.startBalanceHours ?? 0}"></label>
        <label class="field"><span>Notiz</span><input type="text" id="emp-note" value="${esc(e.note || '')}" placeholder="z. B. Springer:in, Führerschein B"></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="emp-minor" ${e.minor ? 'checked' : ''}><span>unter 18 Jahre (Jugendschutz KJBG)</span></label>
      </div>
      <section><h3>Qualifikationen</h3><div class="form-grid">${checkboxes('emp-skill', (app.data.skills || []).map((s) => [s, s]), e.skills || [])}</div></section>
      <section><h3>Eingeschult in Objekten</h3><div class="form-grid">${checkboxes('emp-trained', app.data.objects.map((o) => [o.id, `${o.name}${o.region ? ` (${o.region})` : ''}`]), e.trained || [])}</div></section>
      <section><h3>Verfügbarkeit</h3><div class="avail-grid">${avail}</div><p class="note">Ende vor Beginn bedeutet „bis in den nächsten Tag“.</p></section>`,
    foot: `${id === 'new' ? '<span></span>' : `<button class="btn ${confirmDel ? 'danger confirm' : 'danger'}" data-action="emp-delete" data-id="${esc(e.id)}">${confirmDel ? 'Wirklich löschen?' : 'Löschen'}</button>`}
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="emp-save" data-id="${esc(e.id)}">Speichern</button></div>`,
  })
}

function readEmployeeForm(existing) {
  const availability = {}
  for (let d = 1; d <= 7; d++) if (checked(`emp-av-on-${d}`)) availability[d] = { from: val(`emp-av-from-${d}`) || '00:00', to: val(`emp-av-to-${d}`) || '24:00' }
  const out = {
    ...existing,
    name: val('emp-name').trim(),
    personnelNo: val('emp-pnr').trim() || undefined,
    team: val('emp-team').trim() || undefined,
    email: val('emp-email').trim().toLowerCase() || undefined,
    type: val('emp-type'),
    weeklyHours: num('emp-hours') ?? 0,
    maxMonthHours: num('emp-maxmonth') || undefined,
    vacationDaysYear: num('emp-vacation') ?? 25,
    startBalanceHours: num('emp-start') || undefined,
    note: val('emp-note').trim() || undefined,
    minor: checked('emp-minor') || undefined,
    skills: checkedValues('emp-skill'),
    trained: checkedValues('emp-trained'),
    availability,
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
  return out
}

function removeEmployeeEverywhere(id) {
  const { data } = app
  data.employees = data.employees.filter((e) => e.id !== id)
  data.absences = data.absences.filter((a) => a.employeeId !== id)
  for (const t of data.tasks) t.regulars = t.regulars.filter((r) => r !== id)
  for (const o of data.objects) if (o.keys) o.keys = o.keys.map((k) => (k.holderId === id ? { ...k, holderId: '' } : k))
  for (const [key, list] of Object.entries(data.assignments)) {
    const rest = list.filter((a) => a.employeeId !== id)
    if (rest.length) data.assignments[key] = rest
    else delete data.assignments[key]
  }
}

// ---------------------------------------------------------------- Import

function importModal(c, { kind, text = '', preview = null }) {
  const isEmp = kind === 'employees'
  const template = (isEmp ? EMPLOYEE_TEMPLATE : TASK_TEMPLATE).join('\t')
  const example = isEmp
    ? 'Ana Muster\t1001\tVollzeit\t40\tana.muster@firma.at\tSalzburg Stadt\tHygienebereich, Glasreinigung\tMo-Fr\t05:30\t17:00'
    : 'Kanzlei Muster\tMustergasse 1, 5020 Salzburg\tSalzburg Stadt\tBüroreinigung\tMo, Mi, Fr\t17:30\t19:30\t1\tAna Muster\t1\tverschieben\tReinigung'
  return modalFrame({
    title: isEmp ? 'Mitarbeitende aus Excel einfügen' : 'Objekte & Leistungen aus Excel einfügen',
    wide: true,
    body: `<p class="note">In Excel die Zeilen <strong>mit Überschrift</strong> markieren, kopieren und unten einfügen. Die Spaltenreihenfolge ist egal, erkannt wird über die Überschrift. Vorhandene Einträge mit gleichem Namen werden aktualisiert.</p>
      <div class="toolbar"><button class="btn small" data-action="import-template" data-kind="${kind}">${ICON.copy} Vorlage kopieren</button><code class="template">${esc(template.replace(/\t/g, ' | '))}</code></div>
      <textarea id="import-text" rows="9" placeholder="${esc(`${template}\n${example}`)}">${esc(text)}</textarea>
      ${preview ? `<div class="import-preview">${preview}</div>` : ''}`,
    foot: `<span></span><div class="actions"><button class="btn" data-action="import-preview" data-kind="${kind}">Prüfen</button><button class="btn primary" data-action="import-run" data-kind="${kind}">Übernehmen</button></div>`,
  })
}

function runImport(kind, text, apply) {
  const { data } = app
  if (kind === 'employees') {
    const { items, errors } = importEmployees(text)
    if (apply) {
      for (const item of items) {
        const existing = data.employees.find((e) => e.name.toLowerCase() === item.name.toLowerCase())
        if (existing) Object.assign(existing, { ...item, trained: existing.trained, availability: Object.keys(item.availability).length ? item.availability : existing.availability })
        else data.employees.push({ id: uid('e'), vacationDaysYear: 25, ...item })
      }
    }
    return { count: items.length, errors, summary: `${items.length} Mitarbeitende erkannt` }
  }
  const { items, errors } = importTasks(text, data.employees, { anchor: app.cur.monday })
  const objectNames = new Set(items.map((i) => i.object))
  if (apply) {
    for (const item of items) {
      let obj = data.objects.find((o) => o.name.toLowerCase() === item.object.toLowerCase())
      if (!obj) {
        obj = { id: uid('o'), name: item.object, short: item.object.split(' ')[0], address: item.address, region: item.region || undefined, color: (data.objects.length % 12) + 1, onlyTrained: false }
        data.objects.push(obj)
      }
      data.tasks.push({ id: uid('t'), objectId: obj.id, ...item.task, recurrence: { ...item.task.recurrence, anchor: app.cur.monday } })
      for (const empId of item.task.regulars) {
        const emp = data.employees.find((e) => e.id === empId)
        if (emp && !(emp.trained || []).includes(obj.id)) emp.trained = [...(emp.trained || []), obj.id]
      }
    }
  }
  return { count: items.length, errors, summary: `${items.length} Leistungen in ${objectNames.size} Objekten erkannt` }
}

registerView({ id: 'staff', order: 80, label: 'Mitarbeitende', group: 'stamm', render: staffView })
registerModal('employee', employeeModal)
registerModal('import', importModal)

registerActions({
  'import-template': (el) => {
    const header = el.dataset.kind === 'employees' ? EMPLOYEE_TEMPLATE : TASK_TEMPLATE
    copyText(header.join('\t'))
  },
})

registerActions(
  {
    'emp-edit': (el) => openModal({ type: 'employee', id: el.dataset.id }),
    'emp-save': (el) => {
      const id = el.dataset.id
      const existing = id === 'new' ? { id: uid('e') } : app.data.employees.find((e) => e.id === id)
      const emp = readEmployeeForm(existing)
      if (!emp.name) return toast('Bitte einen Namen eingeben.')
      if (id === 'new') app.data.employees.push(emp)
      else app.data.employees = app.data.employees.map((e) => (e.id === id ? emp : e))
      persist()
      closeModal()
      renderNow()
      toast(`${emp.name} gespeichert.`)
    },
    'emp-delete': (el) => {
      if (app.ui.confirm !== 'emp-delete') {
        app.ui.confirm = 'emp-delete'
        return renderModal()
      }
      removeEmployeeEverywhere(el.dataset.id)
      persist()
      closeModal()
      renderNow()
    },
    'import-open': (el) => openModal({ type: 'import', kind: el.dataset.kind }),
    'import-preview': (el) => {
      const text = val('import-text')
      const res = runImport(el.dataset.kind, text, false)
      app.ui.modal = { type: 'import', kind: el.dataset.kind, text, preview: `<p><span class="pill ${res.errors.length ? 'warning' : 'ok'}">${esc(res.summary)}</span></p>${res.errors.length ? `<ul class="issue-list">${res.errors.slice(0, 15).map((e) => `<li class="warning">${esc(e)}</li>`).join('')}</ul>` : ''}` }
      renderModal()
    },
    'import-run': (el) => {
      const res = runImport(el.dataset.kind, val('import-text'), true)
      if (!res.count) return toast('Nichts erkannt. Bitte die Zeilen mit Überschrift einfügen.')
      persist()
      closeModal()
      renderNow()
      toast(`Übernommen: ${res.summary}.${res.errors.length ? ` ${res.errors.length} Hinweise beachten.` : ''}`)
    },
  },
  { edit: true },
)
