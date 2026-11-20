// Abwesenheiten: Monatskalender, Urlaubsanspruch, Erfassung.

import { eachDay, formatDate, isoWeekday, lastOfMonth, mondayOf, MONTH_LONG, todayISO, WEEKDAY_SHORT } from '../../core/dates.js'
import { vacationSummary, vacationText } from '../../core/reports.js'
import { absentPerDay, vacationSettings } from '../../core/urlaub.js'
import { dataRights, DOC } from '../../storage/data-service.js'
import { addLog, app, closeModal, confirmStep, empName, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { clearImportUndo, importUndoBanner, recordImportUndo } from '../import-undo.js'
import { addAbsence } from '../modals/absence.js'
import { ABSENCE_CLASS, ABSENCE_TYPES, esc, ICON, modalFrame, uid, val } from '../shared.js'
import { monthPicker } from './controlling.js'
import { copyText } from './sheet.js'
import { filterBar, filteredEmployees } from './week.js'

/**
 * Darf diese Person den Grund sehen (Urlaub, Krankenstand …)? Nur mit Recht auf personal/ – sonst
 * kommt aus daten/abwesend.json nur „abwesend von–bis“ (Krankenstand ist ein Gesundheitsdatum).
 */
export const seesReasons = () => app.data.absencesFull !== false && dataRights(app.access).read(DOC.absences)

const fmtDays = (n) => String(Math.round(n * 100) / 100).replace('.', ',')

function calendar(c, employees, full = true) {
  const from = `${c.month}-01`
  const days = eachDay(from, lastOfMonth(from))
  // Urlaub: Sperrzeiten im Kopf, Abwesende je Tag unten (rot über der Höchstzahl; core/urlaub.js)
  const vac = vacationSettings(app.data.rules)
  const blocked = (d) => (vac.blackouts || []).find((b) => b.from <= d && b.to >= d)
  const active = new Set(app.data.employees.filter((e) => !e.inactive).map((e) => e.id))
  const perDay = absentPerDay(app.data.absences || [], days, active)
  const foot = `<tr class="cal-count"><th class="name-col">Abwesend</th>${days.map((d) => `<td class="num ${vac.maxParallel && perDay.get(d) > vac.maxParallel ? 'err-text' : ''}" title="${esc(`${perDay.get(d)} abwesend${vac.maxParallel ? `, höchstens ${vac.maxParallel}` : ''}`)}">${perDay.get(d) || ''}</td>`).join('')}${full ? '<td></td>' : ''}</tr>`
  const head = days.map((d) => `<th class="${isoWeekday(d) > 5 ? 'weekend' : ''} ${c.holidays.has(d) ? 'holiday' : ''} ${blocked(d) ? 'blackout' : ''}" title="${esc([c.holidays.get(d)?.name, blocked(d) ? `Urlaubssperre: ${blocked(d).label}` : ''].filter(Boolean).join(' · '))}"><span class="dname">${WEEKDAY_SHORT[isoWeekday(d) - 1].slice(0, 2)}</span><span class="ddate">${d.slice(8)}</span></th>`).join('')
  const year = Number(c.month.slice(0, 4))
  const rows = employees
    .map((e) => {
      const list = (app.data.absences || []).filter((a) => a.employeeId === e.id)
      const cells = days
        .map((d) => {
          const a = list.find((x) => d >= x.from && d <= x.to)
          const cls = [isoWeekday(d) > 5 ? 'weekend' : '', c.holidays.has(d) ? 'holiday' : '', a ? (full ? ABSENCE_CLASS[a.type] || 'abs-sonst' : 'abs-sonst') : ''].join(' ')
          const label = full ? a?.type : 'abwesend'
          return `<td class="cal-cell ${cls}" title="${a ? esc(`${label} ${formatDate(a.from)}–${formatDate(a.to)}`) : ''}">${a ? (full ? esc(a.type[0]) : '–') : ''}</td>`
        })
        .join('')
      if (!full) return `<tr><th class="name-col">${esc(e.name)}</th>${cells}</tr>`
      const v = vacationSummary(e, app.data.absences || [], year, app.data.extraFreeDays)
      return `<tr><th class="name-col">${esc(e.name)}</th>${cells}<td class="sum num ${v.rest < 0 ? 'err-text' : ''}" title="${esc(vacationText(v))}">${fmtDays(v.rest)} / ${fmtDays(v.base ? v.base.days : v.entitlement + (v.carry || 0))}</td></tr>`
    })
    .join('')
  if (!full)
    return `<div class="grid-wrap"><table class="grid cal"><thead><tr><th class="name-col">Mitarbeiter:in</th>${head}</tr></thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>
    <div class="legend"><span><span class="cal-key abs-sonst">–</span> abwesend</span><span>Den Grund (Urlaub, Krankenstand …) sieht nur das Büro.</span></div>`
  return `<div class="grid-wrap"><table class="grid cal"><thead><tr><th class="name-col">Mitarbeiter:in</th>${head}<th class="sum-col">Resturlaub ${year}</th></tr></thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>
    <div class="legend">${ABSENCE_TYPES.map((t) => `<span><span class="cal-key ${ABSENCE_CLASS[t]}">${t[0]}</span> ${t}</span>`).join('')}<span>Resturlaub = Anspruch − verplante Urlaubstage (Mo–Fr ohne Feiertage); mit „Resturlaub am Stichtag“ im Stammblatt zählt die App ab dem Stichtag und nimmt den Rest ins nächste Jahr mit</span>${(vac.blackouts || []).length ? '<span><span class="cal-key blackout-key"></span> Urlaubssperre (Regeln &amp; Feiertage)</span>' : ''}</div>`
}

function absencesView(c) {
  if (!seesReasons()) return limitedView(c)
  const employees = filteredEmployees(c)
  const ids = new Set(employees.map((e) => e.id))
  const sorted = [...(app.data.absences || [])].filter((a) => ids.has(a.employeeId)).sort((a, b) => b.from.localeCompare(a.from))
  const affected = (a) =>
    Object.entries(app.data.assignments).filter(([key, list]) => {
      const inst = c.state.instByKey.get(key)
      return inst && inst.date >= a.from && inst.date <= a.to && list.some((x) => x.employeeId === a.employeeId)
    }).length
  const [y, m] = c.month.split('-').map(Number)
  const rows = sorted
    .slice(0, 80)
    .map((a) => {
      const n = affected(a)
      return `<tr><td><strong>${esc(empName(a.employeeId))}</strong></td><td><span class="cal-key ${ABSENCE_CLASS[a.type] || 'abs-sonst'}">${esc(a.type[0])}</span> ${esc(a.type)}</td><td class="num">${formatDate(a.from, { year: true })}</td><td class="num">${formatDate(a.to, { year: true })}</td>
      <td>${n ? `<span class="pill error">${n} Einsätze noch eingeteilt</span>` : ''} <button class="btn small" data-action="open-impact" data-id="${esc(a.id)}">Vertretung planen</button></td>
      <td class="edit-only"><button class="btn small ${app.ui.confirm === `abs-${a.id}` ? 'danger confirm' : 'danger'}" data-action="abs-delete" data-id="${esc(a.id)}">${app.ui.confirm === `abs-${a.id}` ? 'Wirklich?' : 'Löschen'}</button></td></tr>`
    })
    .join('')
  return `<div class="section-head"><div><h2>Abwesenheiten</h2><p>Urlaub, Krankenstand, Zeitausgleich, auch rückwirkend. Nach dem Eintragen zeigt der Assistent, welche Einsätze und Stunden neu zu planen sind, und übergibt Fixobjekte an eine Vertretung. Stammeinsätze werden der abwesenden Person angerechnet (Ausfallprinzip).</p></div>${monthPicker(c)}</div>
    <div class="inline-form edit-only">
      <label class="field"><span>Mitarbeiter:in</span><select id="abs-emp">${c.ctx.employees.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Art</span><select id="abs-type">${ABSENCE_TYPES.map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label class="field"><span>Von</span><input type="date" id="abs-from" value="${c.monday}"></label>
      <label class="field"><span>Bis</span><input type="date" id="abs-to" value="${c.monday}"></label>
      <label class="field"><span>Notiz</span><input type="text" id="abs-note" placeholder="optional"></label>
      <button class="btn primary" data-action="abs-add">${ICON.plus} Eintragen und Vertretung planen</button>
      <button class="btn" data-action="abs-import-open" title="Urlaubsplan oder Liste der Krankenstände auf einmal einfügen">${ICON.upload} Aus Excel einfügen</button>
    </div>
    ${importUndoBanner('absences')}
    ${filterBar(c, { problems: false })}
    <h3>${MONTH_LONG[m - 1]} ${y}</h3>
    ${calendar(c, employees)}
    <h3>Einträge</h3>
    ${sorted.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Mitarbeiter:in</th><th>Art</th><th>Von</th><th>Bis</th><th>Status</th><th class="edit-only"></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine Abwesenheiten eingetragen.</p>'}`
}

/** Ohne Recht auf personal/: wer wann fehlt, ohne Grund, nur lesen (Objektmanagement, Objektleitung). */
function limitedView(c) {
  const employees = filteredEmployees(c)
  const ids = new Set(employees.map((e) => e.id))
  const sorted = [...(app.data.absences || [])].filter((a) => ids.has(a.employeeId) && a.to >= `${c.month}-01`).sort((a, b) => a.from.localeCompare(b.from))
  const [y, m] = c.month.split('-').map(Number)
  const rows = sorted
    .slice(0, 80)
    .map((a) => `<tr><td><strong>${esc(empName(a.employeeId))}</strong></td><td class="num">${formatDate(a.from, { year: true })}</td><td class="num">${formatDate(a.to, { year: true })}</td></tr>`)
    .join('')
  return `<div class="section-head"><div><h2>Abwesenheiten</h2><p>Wer wann fehlt, für die Planung im Objekt. Den Grund (Urlaub, Krankenstand, Zeitausgleich) sieht nur das Büro; eingetragen wird dort.</p></div>${monthPicker(c)}</div>
    ${filterBar(c, { problems: false })}
    <h3>${MONTH_LONG[m - 1]} ${y}</h3>
    ${calendar(c, employees, false)}
    <h3>Ab ${MONTH_LONG[m - 1]}</h3>
    ${sorted.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Mitarbeiter:in</th><th>Von</th><th>Bis</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Niemand ist abwesend eingetragen.</p>'}`
}

// ---------------------------------------------------------------- Abwesenheiten aus Excel einfügen

// Der Einleser (core/absence-import.js) kommt erst beim Prüfen: er gehört nicht in den Start der App.
const TEMPLATE = ['Name', 'Art', 'Von', 'Bis', 'Notiz']
const loadParser = () => import('../../core/absence-import.js')

registerModal(
  'abs-import',
  (c, m) => {
    const r = m.result
    const items = r?.items || []
    const rows = items
      .slice(0, 12)
      .map((a) => `<tr><td>${esc(a.name)}${a.written ? ` <small class="muted">in der Liste: ${esc(a.written)}</small>` : ''}</td><td>${esc(a.type)}</td><td class="num">${formatDate(a.from, { year: true })}${a.to !== a.from ? ` – ${formatDate(a.to, { year: true })}` : ''}</td><td>${a.overlap ? '<span class="pill warning">Überschneidung</span>' : ''}${a.note ? ` <small class="muted">${esc(a.note)}</small>` : ''}</td></tr>`)
      .join('')
    const check = r
      ? `<section class="mw-plan-result" aria-live="polite"><h3>Gelesen</h3>${
          r.problem
            ? `<p><strong>${esc(r.problem)}</strong></p>`
            : `<p><strong>${esc(m.summary || '')}</strong></p>
               <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Art</th><th class="num">Zeitraum</th><th>Hinweis</th></tr></thead><tbody>${rows}</tbody></table></div>${items.length > 12 ? `<p class="muted">… und ${items.length - 12} weitere</p>` : ''}`
        }${r.unknown.length ? `<p><strong>Nicht gefunden</strong> (werden nicht eingetragen): ${esc(r.unknown.slice(0, 12).join(', '))}${r.unknown.length > 12 ? ` und ${r.unknown.length - 12} weitere` : ''}. Schreibweise prüfen oder die Person zuerst unter „Mitarbeitende“ anlegen.</p>` : ''}${
          r.errors.length
            ? `<ul class="mw-review">${r.errors
                .slice(0, 8)
                .map((e) => `<li>Zeile ${e.line}: ${esc(e.text)}</li>`)
                .join('')}${r.errors.length > 8 ? `<li class="muted">… und ${r.errors.length - 8} weitere</li>` : ''}</ul>`
            : ''
        }</section>`
      : ''
    const ok = r && !r.problem
    return modalFrame({
      title: 'Abwesenheiten aus Excel einfügen',
      body: `<p>Den Urlaubsplan oder die Liste der Krankenstände in Excel mit der Überschrift markieren, kopieren und hier einfügen. Pflicht sind „Name“ und „Von“ (oder eine Spalte „Zeitraum“ wie „23.12.–07.01.“). Ohne Art gilt Urlaub.</p>
        <textarea id="abs-imp-text" rows="8" aria-label="Liste aus Excel" placeholder="${esc(`${TEMPLATE.join('\t')}\nErika Beispiel\tUrlaub\t23.12.2026\t07.01.2027\t`)}">${esc(m.text || '')}</textarea>
        <p class="muted">Was es genau so schon gibt, wird übersprungen. Einsätze im Zeitraum bleiben zunächst eingeteilt: „Zu erledigen“ zeigt danach je Abwesenheit „Vertretung planen“.</p>
        ${check}`,
      foot: `<div class="actions"><button class="btn" data-action="abs-imp-template">${ICON.copy} Vorlage kopieren</button></div><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn ${ok ? '' : 'primary'}" data-action="abs-imp-check">Prüfen</button>${ok ? `<button class="btn primary" data-action="abs-imp-save">${items.length === 1 ? '1 Abwesenheit eintragen' : `${items.length} Abwesenheiten eintragen`}</button>` : ''}</div>`,
    })
  },
  { module: 'planung' },
)

/** Text aus dem Dialog lesen und prüfen (merkt Text, Ergebnis und Zusammenfassung am Dialog). */
async function checkImport() {
  const m = app.ui.modal
  if (document.getElementById('abs-imp-text')) m.text = val('abs-imp-text')
  const { absenceSummary, parseAbsenceTable } = await loadParser()
  m.result = parseAbsenceTable(m.text || '', { employees: app.data.employees || [], existing: app.data.absences || [], today: todayISO() })
  m.summary = m.result.problem ? '' : absenceSummary(m.result)
  return m
}

// module planung: Objektmanagement und Objektleitung sehen „abwesend“; eintragen nur mit Recht auf Planung bzw. Stammdaten
registerView({ id: 'absences', order: 100, label: 'Abwesenheiten', group: 'stamm', module: 'planung', render: absencesView })

registerActions(
  {
    'abs-add': () => {
      const from = val('abs-from')
      const entry = { employeeId: val('abs-emp'), type: val('abs-type'), from, to: val('abs-to') || from }
      if (val('abs-note').trim()) entry.note = val('abs-note').trim()
      return addAbsence(entry)
    },
    'abs-import-open': () => openModal({ type: 'abs-import', text: '', result: null }),
    'abs-imp-template': () => copyText(TEMPLATE.join('\t')),
    'abs-imp-check': async () => {
      await checkImport()
      renderModal()
    },
    'abs-imp-save': async () => {
      const m = await checkImport()
      const r = m.result
      if (r.problem || !r.items.length) return renderModal()
      // Stand davor merken: „Einfügen zurücknehmen“ in der Ansicht (30 Minuten, ui/import-undo.js)
      recordImportUndo('absences', ['absences'], m.summary.split(' · ')[0])
      app.data.absences ||= []
      for (const a of r.items) app.data.absences.push({ id: uid('a'), employeeId: a.employeeId, type: a.type, from: a.from, to: a.to, ...(a.note ? { note: a.note } : {}) })
      if (!r.items.length) clearImportUndo()
      // Wochenprotokoll liegt bei den Plänen (auch für Leserollen) → ohne Namen und Grund
      addLog(mondayOf(todayISO()), `Abwesenheiten eingefügt: ${r.items.length}`)
      persist()
      closeModal()
      renderNow()
      toast(`Eingetragen: ${m.summary.split(' · ')[0]}. „Zu erledigen“ zeigt, wo eine Vertretung zu planen ist.`)
    },
    'abs-delete': (el) => {
      if (!confirmStep(`abs-${el.dataset.id}`)) return
      app.data.absences = app.data.absences.filter((a) => a.id !== el.dataset.id)
      persist()
      renderNow()
    },
  },
  { edit: ['planung', 'stammdaten'] },
)
