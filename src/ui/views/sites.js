// Objekte & Leistungen (Stammplan), Objektmappe, Schlüssel, Budget.

import { addDays, formatHours, mondayOf, todayISO, WEEKDAY_LONG, WEEKDAY_SHORT } from '../../core/dates.js'
import { holidayCalendar } from '../../core/holidays.js'
import { DEFAULT_HOLIDAY_RULE, HOLIDAY_RULES, NTH_LABEL } from '../../core/plan.js'
import { wasteSummary } from '../../core/waste.js'
import { app, closeModal, empName, openModal, persist, registerActions, registerModal, registerView, renderModal, renderModalKeepingInput, renderNow, toast } from '../context.js'
import { CATEGORY_LABEL, checkboxes, checked, checkedValues, COLOR_NAMES, esc, ICON, modalFrame, num, options, rhythmText, uid, val } from '../shared.js'
import { readWaste, wasteSection } from '../waste-form.js'
import { regionFilter } from './objects.js'

function sitesView() {
  const region = app.ui.region
  const today = todayISO()
  const holidays = holidayCalendar(today, addDays(today, 70), app.data.extraFreeDays)
  const cards = app.data.objects
    .filter((o) => !region || o.region === region)
    .map((obj) => {
      const tasks = app.data.tasks.filter((t) => t.objectId === obj.id)
      const rows = tasks
        .map(
          (t) => `<tr>
          <td><strong>${esc(t.label)}</strong>${t.category === 'sonder' ? ' <span class="tag special">Sonderleistung</span>' : ''}</td>
          <td>${esc(rhythmText(t))}</td><td class="num">${esc(t.start)}–${esc(t.end)}${Number.isFinite(t.travelAfterMin) || t.travelNote ? `<br><span class="muted">Fahrt danach ${Number.isFinite(t.travelAfterMin) ? `${t.travelAfterMin} min` : 'automatisch'}${t.travelNote ? `: ${esc(t.travelNote)}` : ''}</span>` : ''}</td><td class="num">${t.staff}</td>
          <td>${t.regulars.map((id) => esc(empName(id))).join(', ') || '<span class="muted">–</span>'}</td>
          <td>${esc(HOLIDAY_RULES[t.holidayRule || DEFAULT_HOLIDAY_RULE])}</td>
          <td>${(t.skills || []).map((s) => `<span class="tag">${esc(s)}</span>`).join(' ') || '<span class="muted">–</span>'}</td>
          <td class="edit-only"><button class="btn small" data-action="task-edit" data-id="${esc(t.id)}">Bearbeiten</button></td></tr>`,
        )
        .join('')
      const keys = obj.keys || []
      return `<article class="object-card" style="--obj:var(--o${obj.color})">
        <header><h3>${esc(obj.name)}</h3><span class="addr">${esc([obj.address, obj.region].filter(Boolean).join(' · '))}${obj.onlyTrained ? ' · nur eingeschultes Personal' : ''}${obj.budgetHoursMonth ? ` · Budget ${formatHours(obj.budgetHoursMonth * 60)} h/Monat` : ''}</span>
          <span class="edit-only"><button class="btn small" data-action="task-edit" data-id="new" data-obj="${esc(obj.id)}">${ICON.plus} Leistung</button>
          <button class="btn small" data-action="obj-edit" data-id="${esc(obj.id)}">Objekt bearbeiten</button></span></header>
        ${obj.waste?.streams?.length ? `<div class="folder-line waste-line">${ICON.trash}<span>${esc(wasteSummary(obj, today, holidays))}</span></div>` : ''}
        ${obj.instructions || keys.length ? `<div class="folder-line">${obj.instructions ? `<span>${esc(obj.instructions)}</span>` : ''}${keys.length ? `<span class="keys">${ICON.key} ${keys.map((k) => `${esc(k.label)}: ${k.holderId ? esc(empName(k.holderId)) : 'Büro'}`).join(' · ')}</span>` : ''}</div>` : ''}
        ${tasks.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Leistung</th><th>Rhythmus</th><th>Zeit</th><th>Pers.</th><th>Stammkraft</th><th>An Feiertagen</th><th>Qualifikation</th><th class="edit-only"></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="note" style="padding:10px 14px;margin:0">Noch keine Leistungen.</p>'}
      </article>`
    })
    .join('')
  return `<div class="section-head"><div><h2>Objekte & Leistungen <span class="muted">(${app.data.objects.length} Objekte, ${app.data.tasks.length} Leistungen)</span></h2><p>Der Stammplan: welche Leistung in welchem Rhythmus, zu welcher Zeit, mit wem als Stammkraft, und was an Feiertagen passiert. Dazu Objektmappe, Schlüssel und Budget.</p></div>
    <div class="actions edit-only"><button class="btn" data-action="import-open" data-kind="tasks">${ICON.upload} Aus Excel einfügen</button><button class="btn primary" data-action="obj-edit" data-id="new">${ICON.plus} Objekt anlegen</button></div></div>
    ${regionFilter()}
    <div class="objects">${cards}</div>`
}

function objectModal(c, { id }) {
  const o = id === 'new' ? { id: 'new', name: '', short: '', address: '', region: app.ui.region || '', color: (app.data.objects.length % 12) + 1, onlyTrained: false, keys: [] } : app.data.objects.find((x) => x.id === id)
  if (!o) return null
  const regions = [...new Set(app.data.objects.map((x) => x.region).filter(Boolean))]
  const keys = app.ui.modal.keys ?? o.keys ?? []
  const empOptions = app.data.employees.map((e) => [e.id, e.name])
  const confirmDel = app.ui.confirm === 'obj-delete'
  return modalFrame({
    title: id === 'new' ? 'Objekt anlegen' : o.name,
    color: o.color,
    body: `<div class="form-grid">
        <label class="field wide"><span>Name</span><input type="text" id="obj-name" value="${esc(o.name)}" required></label>
        <label class="field"><span>Kurzname (für den Plan)</span><input type="text" id="obj-short" value="${esc(o.short)}"></label>
        <label class="field"><span>Adresse</span><input type="text" id="obj-address" value="${esc(o.address)}"></label>
        <label class="field"><span>Revier</span><input type="text" id="obj-region" list="region-list" value="${esc(o.region || '')}"><datalist id="region-list">${regions.map((r) => `<option value="${esc(r)}">`).join('')}</datalist></label>
        <label class="field"><span>Farbe</span><select id="obj-color">${COLOR_NAMES.map((n, i) => `<option value="${i + 1}" ${o.color === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span>Budget (Sollstunden/Monat)</span><input type="number" id="obj-budget" min="0" step="1" value="${esc(o.budgetHoursMonth ?? '')}" placeholder="laut Kalkulation"></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="obj-trained" ${o.onlyTrained ? 'checked' : ''}><span>Nur eingeschultes Personal (Schlüssel, Alarm, Hygiene)</span></label>
      </div>
      <section><h3>Objektmappe</h3><div class="form-grid">
        <label class="field wide"><span>Anweisungen für das Personal (erscheint im Einsatz und für Vertretungen)</span><textarea id="obj-instructions" rows="3" style="font-family:inherit;font-size:inherit">${esc(o.instructions || '')}</textarea></label>
        <label class="field wide"><span>Ansprechperson beim Kunden</span><input type="text" id="obj-contact" value="${esc(o.contact || '')}"></label>
      </div><p class="note">Keine Alarmcodes oder Passwörter eintragen: diese Daten liegen für alle Disponent:innen lesbar in SharePoint.</p></section>
      <section><h3>Schlüssel</h3>
        ${keys.map((k, i) => `<div class="inline-row"><input type="text" id="key-label-${i}" value="${esc(k.label)}" aria-label="Schlüssel"><select id="key-holder-${i}" aria-label="Bei">${options(empOptions, k.holderId, { empty: 'im Büro' })}</select><button class="btn small danger" data-action="key-remove" data-idx="${i}">Entfernen</button></div>`).join('')}
        <button class="btn small" data-action="key-add">${ICON.plus} Schlüssel</button>
        <p class="note">Ist ein Schlüssel hinterlegt, markiert der Plan jede Vertretung ohne Schlüssel mit „Schlüsselübergabe nötig“.</p></section>
      ${wasteSection(o)}`,
    foot: `${id === 'new' ? '<span></span>' : `<button class="btn ${confirmDel ? 'danger confirm' : 'danger'}" data-action="obj-delete" data-id="${esc(o.id)}">${confirmDel ? 'Objekt samt Leistungen löschen?' : 'Löschen'}</button>`}
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="obj-save" data-id="${esc(o.id)}">Speichern</button></div>`,
  })
}

function readKeys() {
  const keys = []
  for (let i = 0; document.getElementById(`key-label-${i}`); i++) {
    const label = val(`key-label-${i}`).trim()
    if (label) keys.push({ id: `k${i}${Date.now().toString(36)}`, label, holderId: val(`key-holder-${i}`) })
  }
  return keys
}

function taskModal(c, { id, objectId }) {
  const t =
    id === 'new'
      ? { id: 'new', objectId: objectId || app.data.objects[0]?.id, label: '', category: 'reinigung', recurrence: { type: 'weekly', weekdays: [1, 2, 3, 4, 5], everyWeeks: 1, anchor: c.monday }, start: '18:00', end: '20:00', staff: 1, regulars: [], skills: [], holidayRule: DEFAULT_HOLIDAY_RULE, breakMin: 0 }
      : app.data.tasks.find((x) => x.id === id)
  if (!t) return null
  const r = t.recurrence
  const type = r.type
  const monthly = type === 'monthly' ? r : { mode: 'nth', nth: 1, weekday: r.weekdays?.[0] || 1, day: 1, everyMonths: 1, anchor: `${c.monday.slice(0, 7)}-01` }
  const obj = app.data.objects.find((o) => o.id === t.objectId)
  const confirmDel = app.ui.confirm === 'task-delete'
  return modalFrame({
    title: id === 'new' ? 'Leistung anlegen' : t.label,
    subtitle: esc(obj?.name || ''),
    color: obj?.color,
    body: `<div class="form-grid">
        <label class="field"><span>Objekt</span><select id="task-object">${options(app.data.objects.map((o) => [o.id, o.name]), t.objectId)}</select></label>
        <label class="field"><span>Bezeichnung</span><input type="text" id="task-label" value="${esc(t.label)}" placeholder="z. B. Büroreinigung"></label>
        <label class="field"><span>Art</span><select id="task-category">${options(Object.entries(CATEGORY_LABEL), t.category)}</select></label>
        <label class="field"><span>Rhythmus</span><select id="task-type" data-toggle="rhythm">${options([['weekly', 'wöchentlich / 14-tägig'], ['monthly', 'monatlich / quartalsweise'], ['once', 'einmalig']], type)}</select></label>
      </div>
      <div class="form-grid" data-rhythm="weekly" ${type === 'weekly' ? '' : 'hidden'}>
        <div class="field wide"><span>Wochentage</span><div class="weekday-picker">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label><input type="checkbox" name="task-wd" value="${d}" ${type === 'weekly' && r.weekdays.includes(d) ? 'checked' : ''}>${WEEKDAY_SHORT[d - 1]}</label>`).join('')}</div></div>
        <label class="field"><span>Intervall</span><select id="task-every">${options([[1, 'jede Woche'], [2, 'alle 2 Wochen (14-tägig)'], [3, 'alle 3 Wochen'], [4, 'alle 4 Wochen']], r.everyWeeks || 1)}</select></label>
        <label class="field"><span>Erstmals in der Woche vom</span><input type="date" id="task-anchor" value="${esc(r.anchor || c.monday)}"></label>
        <label class="field"><span>Gültig bis (optional)</span><input type="date" id="task-until" value="${esc(r.until || '')}"></label>
      </div>
      <div class="form-grid" data-rhythm="monthly" ${type === 'monthly' ? '' : 'hidden'}>
        <label class="field"><span>Intervall</span><select id="task-months">${options([[1, 'monatlich'], [2, 'alle 2 Monate'], [3, 'quartalsweise'], [6, 'halbjährlich'], [12, 'jährlich']], monthly.everyMonths || 1)}</select></label>
        <label class="field"><span>Termin</span><select id="task-mmode" data-toggle="mmode">${options([['nth', 'Wochentag im Monat'], ['day', 'fixer Tag im Monat']], monthly.mode)}</select></label>
        <label class="field" data-mmode="nth" ${monthly.mode === 'day' ? 'hidden' : ''}><span>Welcher</span><select id="task-nth">${options(Object.entries(NTH_LABEL).sort((a, b) => (a[0] === '-1') - (b[0] === '-1') || a[0] - b[0]), monthly.nth)}</select></label>
        <label class="field" data-mmode="nth" ${monthly.mode === 'day' ? 'hidden' : ''}><span>Wochentag</span><select id="task-mweekday">${options(WEEKDAY_LONG.map((n, i) => [i + 1, n]), monthly.weekday)}</select></label>
        <label class="field" data-mmode="day" ${monthly.mode === 'day' ? '' : 'hidden'}><span>Tag im Monat</span><input type="number" id="task-mday" min="1" max="31" step="1" value="${esc(monthly.day || 1)}"><small class="muted">31 = immer Monatsletzter</small></label>
        <label class="field"><span>Erstmals im Monat</span><input type="month" id="task-manchor" value="${esc((monthly.anchor || c.monday).slice(0, 7))}"></label>
        <label class="field"><span>Gültig bis (optional)</span><input type="date" id="task-muntil" value="${esc(type === 'monthly' ? r.until || '' : '')}"></label>
      </div>
      <div class="form-grid" data-rhythm="once" ${type === 'once' ? '' : 'hidden'}>
        <label class="field"><span>Datum</span><input type="date" id="task-date" value="${esc(type === 'once' ? r.date : c.monday)}"></label>
      </div>
      <div class="form-grid">
        <label class="field"><span>Beginn</span><input type="time" id="task-start" value="${esc(t.start)}"></label>
        <label class="field"><span>Ende</span><input type="time" id="task-end" value="${esc(t.end)}"></label>
        <label class="field"><span>Personen</span><input type="number" id="task-staff" min="1" step="1" value="${esc(t.staff)}"></label>
        <label class="field"><span>An Feiertagen</span><select id="task-holiday">${options(Object.entries(HOLIDAY_RULES), t.holidayRule || DEFAULT_HOLIDAY_RULE)}</select></label>
        <label class="field"><span>Fahrzeit danach (min)</span><input type="number" id="task-travel" min="0" step="5" value="${Number.isFinite(t.travelAfterMin) ? t.travelAfterMin : ''}" placeholder="automatisch"></label>
        <label class="field wide"><span>Fahrtnotiz (Standard, je Woche änderbar)</span><input type="text" id="task-travel-note" value="${esc(t.travelNote || '')}" placeholder="z. B. Firmenauto zurück ins Lager"></label>
      </div>
      <section><h3>Stammkraft</h3><div class="form-grid">${checkboxes('task-reg', app.data.employees.filter((e) => !obj?.region || !e.team || e.team === obj.region || t.regulars.includes(e.id)).map((e) => [e.id, e.name]), t.regulars || [])}</div><p class="note">Angezeigt werden Personen aus dem Revier des Objekts.</p></section>
      <section><h3>Benötigte Qualifikation</h3><div class="form-grid">${checkboxes('task-skill', (app.data.skills || []).map((s) => [s, s]), t.skills || [])}</div></section>`,
    foot: `${id === 'new' ? '<span></span>' : `<button class="btn ${confirmDel ? 'danger confirm' : 'danger'}" data-action="task-delete" data-id="${esc(t.id)}">${confirmDel ? 'Wirklich löschen?' : 'Löschen'}</button>`}
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="task-save" data-id="${esc(t.id)}">Speichern</button></div>`,
  })
}

function readRecurrence() {
  const type = val('task-type')
  if (type === 'once') return { type: 'once', date: val('task-date') }
  if (type === 'monthly') {
    const mode = val('task-mmode')
    return {
      type: 'monthly',
      mode,
      ...(mode === 'day' ? { day: Math.min(31, Math.max(1, Math.round(num('task-mday') || 1))) } : { nth: Number(val('task-nth')) || 1, weekday: Number(val('task-mweekday')) || 1 }),
      everyMonths: Number(val('task-months')) || 1,
      anchor: `${val('task-manchor') || app.cur.monday.slice(0, 7)}-01`,
      ...(val('task-muntil') ? { until: val('task-muntil') } : {}),
    }
  }
  return { type: 'weekly', weekdays: checkedValues('task-wd').map(Number), everyWeeks: Number(val('task-every')) || 1, anchor: val('task-anchor') || app.cur.monday, ...(val('task-until') ? { until: val('task-until') } : {}) }
}

/**
 * „Erstmals in der Woche vom … / im Monat …“ in der Zukunft gilt auch als Beginn
 * (vorher nur als Takt: der Einsatz erschien schon in früheren Wochen).
 * Ein Anker in der Vergangenheit bleibt reiner Takt, damit veröffentlichte Wochen unverändert bleiben.
 */
function withStart(recurrence, old) {
  if (recurrence.type === 'once' || !recurrence.anchor) return recurrence
  const start = recurrence.type === 'monthly' ? recurrence.anchor : mondayOf(recurrence.anchor)
  const now = recurrence.type === 'monthly' ? `${todayISO().slice(0, 7)}-01` : mondayOf(todayISO())
  if (old && old.anchor === recurrence.anchor) return old.from ? { ...recurrence, from: old.from } : recurrence
  return start > now ? { ...recurrence, from: start } : recurrence
}

function readTaskForm(existing) {
  const recurrence = withStart(readRecurrence(), existing?.recurrence)
  return {
    ...existing,
    objectId: val('task-object'),
    label: val('task-label').trim(),
    category: val('task-category'),
    recurrence,
    start: val('task-start'),
    end: val('task-end'),
    staff: Math.max(1, Math.round(num('task-staff') || 1)),
    holidayRule: val('task-holiday'),
    travelAfterMin: val('task-travel').trim() === '' ? undefined : Math.max(0, Math.round(num('task-travel') ?? 0)),
    travelNote: val('task-travel-note').trim() || undefined,
    regulars: checkedValues('task-reg'),
    skills: checkedValues('task-skill'),
  }
}

function removeTaskEverywhere(id) {
  const { data } = app
  data.tasks = data.tasks.filter((t) => t.id !== id)
  for (const key of Object.keys(data.assignments)) if (key.endsWith(`|${id}`)) delete data.assignments[key]
  for (const key of Object.keys(data.overrides)) if (key.endsWith(`|${id}`)) delete data.overrides[key]
}

registerView({ id: 'sites', order: 90, label: 'Objekte & Leistungen', group: 'stamm', render: sitesView })
registerModal('object', objectModal, { module: 'stammdaten' })
registerModal('task', taskModal, { module: 'stammdaten' })

registerActions(
  {
    'obj-edit': (el) => {
      openModal({ type: 'object', id: el.dataset.id })
      if (el.dataset.focus) document.querySelector(`#modal-root .${el.dataset.focus}`)?.scrollIntoView({ block: 'start' })
    },
    'key-add': () => {
      app.ui.modal.keys = [...readKeys(), { label: 'Haupteingang', holderId: '' }]
      app.ui.modal.waste = readWaste()
      renderModalKeepingInput(/^key-|^wsr-/)
    },
    'key-remove': (el) => {
      const keys = readKeys()
      keys.splice(Number(el.dataset.idx), 1)
      app.ui.modal.keys = keys
      app.ui.modal.waste = readWaste()
      renderModalKeepingInput(/^key-|^wsr-/)
    },
    'obj-save': (el) => {
      const id = el.dataset.id
      const existing = id === 'new' ? { id: uid('o') } : app.data.objects.find((o) => o.id === id)
      const obj = {
        ...existing,
        name: val('obj-name').trim(),
        short: val('obj-short').trim(),
        address: val('obj-address').trim(),
        region: val('obj-region').trim() || undefined,
        color: Number(val('obj-color')) || 1,
        budgetHoursMonth: num('obj-budget') || undefined,
        onlyTrained: checked('obj-trained'),
        instructions: val('obj-instructions').trim() || undefined,
        contact: val('obj-contact').trim() || undefined,
        keys: readKeys(),
      }
      const waste = readWaste()
      obj.waste = waste.streams?.length ? waste : undefined
      if (!obj.name) return toast('Bitte einen Namen eingeben.')
      if (!obj.short) obj.short = obj.name.split(' ')[0]
      for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k]
      if (id === 'new') app.data.objects.push(obj)
      else app.data.objects = app.data.objects.map((o) => (o.id === id ? obj : o))
      persist()
      closeModal()
      renderNow()
    },
    'obj-delete': (el) => {
      if (app.ui.confirm !== 'obj-delete') {
        app.ui.confirm = 'obj-delete'
        return renderModal()
      }
      const id = el.dataset.id
      for (const t of app.data.tasks.filter((x) => x.objectId === id)) removeTaskEverywhere(t.id)
      for (const action of ['out', 'in']) removeTaskEverywhere(`muell-${id}-${action}`)
      app.data.objects = app.data.objects.filter((o) => o.id !== id)
      for (const e of app.data.employees) e.trained = (e.trained || []).filter((x) => x !== id)
      persist()
      closeModal()
      renderNow()
    },
    'task-edit': (el) => {
      if (!app.data.objects.length) return toast('Bitte zuerst ein Objekt anlegen.')
      openModal({ type: 'task', id: el.dataset.id, objectId: el.dataset.obj })
    },
    'task-save': (el) => {
      const id = el.dataset.id
      const existing = id === 'new' ? { id: uid('t') } : app.data.tasks.find((t) => t.id === id)
      const task = readTaskForm(existing)
      if (!task.label) return toast('Bitte eine Bezeichnung eingeben.')
      if (task.recurrence.type === 'weekly' && !task.recurrence.weekdays.length) return toast('Bitte mindestens einen Wochentag wählen.')
      if (!task.start || !task.end) return toast('Bitte Beginn und Ende angeben.')
      for (const k of Object.keys(task)) if (task[k] === undefined) delete task[k]
      if (id === 'new') app.data.tasks.push(task)
      else app.data.tasks = app.data.tasks.map((t) => (t.id === id ? task : t))
      for (const empId of task.regulars) {
        const emp = app.data.employees.find((e) => e.id === empId)
        if (emp && !(emp.trained || []).includes(task.objectId)) emp.trained = [...(emp.trained || []), task.objectId]
      }
      persist()
      closeModal()
      renderNow()
      toast(`Leistung „${task.label}“ gespeichert. Mit „Woche planen“ einteilen.`)
    },
    'task-delete': (el) => {
      if (app.ui.confirm !== 'task-delete') {
        app.ui.confirm = 'task-delete'
        return renderModal()
      }
      removeTaskEverywhere(el.dataset.id)
      persist()
      closeModal()
      renderNow()
    },
  },
  { edit: 'stammdaten' },
)
