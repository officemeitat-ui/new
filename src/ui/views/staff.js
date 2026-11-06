// Mitarbeitende: Liste, Bearbeiten, Import aus Excel. Im Stammblatt auch die Sprache für „Plan am Handy“
// (employees[].lang, leer = Deutsch; core/sprachen.js). Aus einer Bewerbung (views/bewerber.js) öffnet sich das
// Stammblatt vorbefüllt (prefill); nach dem Speichern meldet onEmployeeCreated die neue Person zurück.

import { changeWeeklyHours, MAX_WEEKLY_HOURS } from '../../core/contract.js'
import { formatDate, formatHours, mondayOf, todayISO, WEEKDAY_LONG } from '../../core/dates.js'
import { EMPLOYEE_TEMPLATE, importEmployees, importTasks, TASK_TEMPLATE } from '../../core/importer.js'
import { MEHR_MODES, UE_MODES } from '../../core/overtime.js'
import { mergeRules } from '../../core/rules.js'
import { LANGUAGES, langInfo, langLabel, langOf } from '../../core/sprachen.js'
import { dataRights, DOC } from '../../storage/data-service.js'
import { app, closeModal, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { availabilitySummary, checkboxes, checked, checkedValues, EMPLOYMENT_TYPES, esc, euro, ICON, menu, modalFrame, num, options, uid, val } from '../shared.js'
import { portalSettings } from '../staffplan.js'
import { copyText } from './sheet.js'
import { filterBar, filteredEmployees } from './week.js'

function staffView(c) {
  const objName = (id) => app.data.objects.find((o) => o.id === id)?.short || '?'
  const rows = filteredEmployees(c)
    .map(
      (e) => `<tr>
      <td><button class="link-btn" data-action="open-person" data-emp="${esc(e.id)}"><strong>${esc(e.name)}</strong></button>${e.personnelNo ? ` <span class="muted">#${esc(e.personnelNo)}</span>` : ''}${langOf(e) !== 'de' ? ` <span class="tag" lang="${esc(langInfo(e.lang).html)}" title="Sprache am Handy: ${esc(langInfo(e.lang).label)}">${esc(langInfo(e.lang).own)}</span>` : ''}${e.note ? `<br><span class="muted">${esc(e.note)}</span>` : ''}${e.email ? `<br><span class="muted">${esc(e.email)}</span>` : ''}</td>
      <td>${esc(e.team || '–')}</td>
      <td>${esc(e.type)}${e.minor ? '<br><span class="tag">unter 18 (KJBG)</span>' : ''}${e.durchrechnung && e.type === 'Vollzeit' ? `<br><span class="tag">Durchrechnung ${esc(e.durchrechnung.weeks)} Wochen</span>` : ''}</td>
      <td class="num">${formatHours(e.weeklyHours * 60)} h${e.maxMonthHours ? `<br><span class="muted">max. ${formatHours(e.maxMonthHours * 60)} h/Monat</span>` : ''}</td>
      <td><div class="tags">${(e.skills || []).map((s) => `<span class="tag">${esc(s)}</span>`).join('') || '<span class="muted">–</span>'}</div></td>
      <td><div class="tags">${(e.trained || []).slice(0, 6).map((id) => `<span class="tag">${esc(objName(id))}</span>`).join('')}${(e.trained || []).length > 6 ? `<span class="tag">+${e.trained.length - 6}</span>` : ''}</div></td>
      <td>${esc(availabilitySummary(e)) || '<span class="muted">keine</span>'}</td>
      <td class="edit-only"><button class="btn small" data-action="emp-edit" data-id="${esc(e.id)}">Bearbeiten</button></td></tr>`,
    )
    .join('')
  return `<div class="section-head"><div><h2>Mitarbeitende <span class="muted">(${app.data.employees.length})</span></h2><p>Wochenstunden laut Vertrag (Soll), Revier, Qualifikationen, Einschulung in Objekten (Schlüssel, Alarm, Abläufe) und Verfügbarkeit.</p></div>
    <div class="actions edit-only">${menu({
      label: 'Mehr',
      single: false,
      items: [
        { label: `Plan am Handy${portalSettings().enabled ? ' <span class="tag">ein</span>' : ''}`, icon: ICON.user, action: 'portal-open', hint: 'persönliche Links: Plan, Anträge, Zeiterfassung' },
        { label: 'Aus Excel einfügen', icon: ICON.upload, action: 'import-open', data: { kind: 'employees' } },
      ],
    })}<button class="btn primary" data-action="emp-edit" data-id="new">${ICON.plus} Mitarbeiter:in anlegen</button></div></div>
    ${filterBar(c, { problems: false })}
    ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Revier</th><th>Beschäftigung</th><th>Soll</th><th>Qualifikationen</th><th>Eingeschult</th><th>Verfügbar</th><th class="edit-only"></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">${app.data.employees.length ? 'Niemand in dieser Auswahl (Suche oder Revier).' : 'Noch keine Mitarbeitenden angelegt.'}</p>`}`
}

// Lohngruppe und Stundenlohn stehen im Zeitkonto (lohn/): ohne Schreibrecht dort (z. B. Personalverwaltung) nicht im
// Stammblatt zeigen, sonst wären sie scheinbar gespeichert und nach dem nächsten Laden weg
const editsPay = () => !app.access || dataRights(app.access).write(DOC.account)

// Nach dem Anlegen einer Person: fn(Person, Dialog) – z. B. Bewerbung verknüpfen und Eintritts-Checkliste starten
const CREATED = []
export const onEmployeeCreated = (fn) => CREATED.push(fn)

function employeeModal(c, { id, prefill = null, from = '' }) {
  const e = id === 'new' ? { id: 'new', name: '', type: 'Teilzeit', weeklyHours: 20, skills: [], trained: [], availability: {}, team: app.ui.team || '', ...(prefill || {}) } : app.data.employees.find((x) => x.id === id)
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
  const { wages, pay } = mergeRules(app.data.rules)
  return modalFrame({
    title: id === 'new' ? 'Mitarbeiter:in anlegen' : e.name,
    body: `${from ? `<p class="note">${esc(from)}</p>` : ''}<div class="form-grid">
        <label class="field"><span>Name</span><input type="text" id="emp-name" value="${esc(e.name)}" required></label>
        <label class="field"><span>Personalnummer</span><input type="text" id="emp-pnr" value="${esc(e.personnelNo || '')}"></label>
        <label class="field"><span>Revier / Team</span><input type="text" id="emp-team" list="team-list" value="${esc(e.team || '')}"><datalist id="team-list">${teams.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></label>
        <label class="field"><span>E-Mail (Microsoft 365)</span><input type="email" id="emp-email" value="${esc(e.email || '')}"></label>
        <label class="field"><span>Sprache am Handy (Plan am Handy, Hinweise)</span><select id="emp-lang">${options(LANGUAGES.map((l) => [l.id, langLabel(l.id)]), langOf(e))}</select><small class="muted">Die Person kann sie am Handy umstellen.</small></label>
        <label class="field"><span>Beschäftigung</span><select id="emp-type">${EMPLOYMENT_TYPES.map((t) => `<option ${t === e.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field"><span>Wochenstunden (Soll)</span><input type="number" id="emp-hours" step="0.5" min="0" max="${MAX_WEEKLY_HOURS}" value="${esc(e.weeklyHours ?? '')}"></label>
        ${id === 'new' ? '' : `<label class="field"><span>Neue Wochenstunden gelten ab</span><input type="date" id="emp-hours-from" value="${mondayOf(todayISO())}"><small class="muted">${(e.hoursHistory || []).filter((h) => h.from > '0000-01-01').map((h) => `ab ${formatDate(h.from, { year: true })}: ${formatHours(h.weeklyHours * 60)} h`).join(' · ') || 'Frühere Wochen rechnen mit den bisherigen Stunden.'}</small></label>`}
        <label class="field"><span>Eintritt</span><input type="date" id="emp-entry" value="${esc(e.entryDate || '')}"></label>
        <label class="field"><span>Austritt (letzter Arbeitstag)</span><input type="date" id="emp-exit" value="${esc(e.exitDate || '')}"></label>
        <label class="field"><span>Max. Stunden pro Monat (geringfügig)</span><input type="number" id="emp-maxmonth" step="0.5" min="0" value="${esc(e.maxMonthHours ?? '')}" placeholder="leer = kein Limit"></label>
        <label class="field"><span>Urlaubsanspruch (Arbeitstage/Jahr)</span><input type="number" id="emp-vacation" step="1" min="0" value="${esc(e.vacationDaysYear ?? 25)}"></label>
        <label class="field"><span>Zeitkonto Startsaldo (h)</span><input type="number" id="emp-start" step="0.25" value="${esc(e.startBalanceHours ?? 0)}"></label>
        ${editsPay() ? `<label class="field"><span>Lohngruppe (KV)</span><select id="emp-wagegroup">${options(Object.entries(wages).map(([g, w]) => [g, `Lohngruppe ${g} · ${euro(w)}`]), String(e.wageGroup || ''), { empty: 'keine' })}</select></label>
        <label class="field"><span>Eigener Stundenlohn (€)</span><input type="number" id="emp-wage" step="0.01" min="0" value="${esc(e.hourlyWage ?? '')}" placeholder="leer = KV-Lohn der Lohngruppe"></label>` : '<p class="note">Lohngruppe und Stundenlohn trägt die Lohnverrechnung ein (Zeitkonto).</p>'}
        <label class="field"><span>Überstunden</span><select id="emp-uemode">${options(Object.entries(UE_MODES), e.ueMode || '', { empty: `wie unter „Regeln“ (${UE_MODES[pay.ueMode]})` })}</select></label>
        <label class="field"><span>Mehrarbeit (Teilzeit)</span><select id="emp-mehrmode">${options(Object.entries(MEHR_MODES), e.mehrMode || '', { empty: `wie unter „Regeln“` })}</select></label>
        <label class="field"><span>Durchrechnung ab (Vollzeit, KV)</span><input type="date" id="emp-dr-start" value="${esc(e.durchrechnung?.start || '')}"><small class="muted">Nur mit Betriebsvereinbarung bzw. schriftlicher Vereinbarung; Plan spätestens 2 Wochen vorher bekanntgeben.</small></label>
        <label class="field"><span>Durchrechnung: Wochen je Zeitraum</span><input type="number" id="emp-dr-weeks" min="1" max="52" step="1" value="${esc(e.durchrechnung?.weeks ?? '')}" placeholder="leer = keine Durchrechnung"><small class="muted">KV: 35–45 h je Woche, Schnitt 40 h; bis 52 Wochen (Lohngruppe 2), sonst bis 26. Guthaben am Ende = Überstunden mit 50 %.</small></label>
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
    lang: document.getElementById('emp-lang') && val('emp-lang') !== 'de' ? val('emp-lang') : undefined,
    type: val('emp-type'),
    weeklyHours: num('emp-hours') ?? 0,
    entryDate: val('emp-entry') || undefined,
    exitDate: val('emp-exit') || undefined,
    maxMonthHours: num('emp-maxmonth') || undefined,
    vacationDaysYear: num('emp-vacation') ?? 25,
    startBalanceHours: num('emp-start') || undefined,
    wageGroup: document.getElementById('emp-wagegroup') ? Number(val('emp-wagegroup')) || undefined : existing.wageGroup,
    hourlyWage: document.getElementById('emp-wage') ? num('emp-wage') || undefined : existing.hourlyWage,
    ueMode: val('emp-uemode') || undefined,
    mehrMode: val('emp-mehrmode') || undefined,
    durchrechnung: val('emp-dr-start') && num('emp-dr-weeks') > 0 ? { start: mondayOf(val('emp-dr-start')), weeks: Math.min(52, Math.round(num('emp-dr-weeks'))) } : undefined,
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
registerModal('employee', employeeModal, { module: 'stammdaten' })
registerModal('import', importModal, { module: 'stammdaten' })

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
      const modal = app.ui.modal
      const existing = id === 'new' ? { id: uid('e') } : app.data.employees.find((e) => e.id === id)
      let emp = readEmployeeForm(existing)
      if (!emp.name) return toast('Bitte einen Namen eingeben.')
      if (emp.entryDate && emp.exitDate && emp.exitDate < emp.entryDate) return toast('Der Austritt liegt vor dem Eintritt.')
      if (!(emp.weeklyHours >= 0) || emp.weeklyHours > MAX_WEEKLY_HOURS) return toast(`Wochenstunden zwischen 0 und ${MAX_WEEKLY_HOURS} (gesetzliche Normalarbeitszeit). Mehr ist Mehr- bzw. Überstunden und wird im Plan gezählt.`)
      // Stunden geändert: bisherige gelten bis zum Vortag weiter (vergangene Wochen bleiben, wie sie waren)
      if (id !== 'new' && (existing.weeklyHours || 0) !== emp.weeklyHours) emp = changeWeeklyHours({ ...emp, weeklyHours: existing.weeklyHours }, emp.weeklyHours, val('emp-hours-from') || mondayOf(todayISO()))
      if (id === 'new') app.data.employees.push(emp)
      else app.data.employees = app.data.employees.map((e) => (e.id === id ? emp : e))
      persist()
      closeModal()
      renderNow()
      toast(`${emp.name} gespeichert.`)
      if (id === 'new') for (const fn of CREATED) fn(emp, modal)
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
  { edit: 'stammdaten' },
)
