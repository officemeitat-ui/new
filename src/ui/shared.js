// Gemeinsame Bausteine für Ansichten und Dialoge.

import { formatDate, formatHours, isoWeekday, MONTH_LONG, WEEKDAY_LONG, WEEKDAY_SHORT } from '../core/dates.js'
import { rhythmCategory } from '../core/attention.js'
import { NTH_LABEL } from '../core/plan.js'
import { explain } from '../core/scheduler.js'

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
export const uid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
export const signed = (min) => (min > 0 ? '+' : min < 0 ? '−' : '±') + formatHours(Math.abs(min))
export const saldoClass = (min) => (min > 0 ? 'pos' : min < 0 ? 'neg' : 'zero')
export const euro = (v) => (v || 0).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
export const byStart = (a, b) => a.start - b.start

export const EMPLOYMENT_TYPES = ['Vollzeit', 'Teilzeit', 'Geringfügig', 'Lehrling']
export const ABSENCE_TYPES = ['Urlaub', 'Krankenstand', 'Zeitausgleich', 'Pflegefreistellung', 'Sonstiges']
export const ABSENCE_CLASS = { Urlaub: 'abs-urlaub', Krankenstand: 'abs-krank', Zeitausgleich: 'abs-za', Pflegefreistellung: 'abs-pflege', Sonstiges: 'abs-sonst' }
export const CATEGORY_LABEL = { reinigung: 'Reinigung', sonder: 'Sonderleistung' }
export const COLOR_NAMES = ['Blau', 'Himbeere', 'Grün', 'Orange', 'Violett', 'Petrol', 'Ocker', 'Moos', 'Magenta', 'Schiefer', 'Braun', 'Indigo']

const svg = (body) => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`
export const ICON = {
  left: svg('<path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  right: svg('<path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
  lock: svg('<rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
  close: svg('<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  bolt: svg('<path d="M9.5 1 3 9h4.2L6.5 15 13 7H8.8z" fill="currentColor"/>'),
  plus: svg('<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  copy: svg('<rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 11V3a1 1 0 0 1 1-1h7" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
  send: svg('<path d="M1.5 7.5 14.5 2 9 14.5 7.3 9.2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'),
  print: svg('<path d="M4 6V2h8v4M4 12H2.5V6.5h11V12H12" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="9.5" width="8" height="5" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
  sheet: svg('<rect x="2" y="2" width="12" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 6h12M2 10h12M6 6v8" stroke="currentColor" stroke-width="1.4"/>'),
  key: svg('<circle cx="5" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 8h6.5M12 8v2.5M14 8v2" stroke="currentColor" stroke-width="1.6"/>'),
  upload: svg('<path d="M8 11V2M4.5 5.5 8 2l3.5 3.5M2.5 11v3h11v-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  car: svg('<path d="M2.5 10.5V8.3l1.4-3.6A1.5 1.5 0 0 1 5.3 3.7h5.4a1.5 1.5 0 0 1 1.4 1l1.4 3.6v2.2a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 8h10" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="11.5" r="1.3" fill="currentColor"/><circle cx="11" cy="11.5" r="1.3" fill="currentColor"/>'),
  trash: svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 7v4.5M9 7v4.5" stroke="currentColor" stroke-width="1.3"/>'),
  bell: svg('<path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.3 1.2H2.7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6.6 14.2a1.5 1.5 0 0 0 2.8 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  calendar: svg('<rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  users: svg('<circle cx="6" cy="5.5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1.8 13.5c.6-2.4 2.3-3.6 4.2-3.6s3.6 1.2 4.2 3.6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 3.4a2.3 2.3 0 0 1 0 4.4M12 9.9c1.2.4 1.9 1.6 2.2 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
  menu: svg('<path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  download: svg('<path d="M8 2v8.5M4.5 7 8 10.5 11.5 7M2.5 13.5h11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  palette: svg('<path d="M8 1.8a6.2 6.2 0 1 0 0 12.4c1 0 1.5-.6 1.5-1.3 0-.9-.8-1.2-.8-2 0-.7.6-1.2 1.4-1.2h1.6a2.5 2.5 0 0 0 2.5-2.5C14.2 4.3 11.4 1.8 8 1.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="5" cy="6.6" r="1" fill="currentColor"/><circle cx="7.6" cy="4.6" r="1" fill="currentColor"/><circle cx="10.6" cy="5.4" r="1" fill="currentColor"/><circle cx="4.9" cy="9.8" r="1" fill="currentColor"/>'),
  user: svg('<circle cx="8" cy="5.5" r="2.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 14c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
  drop: svg('<path d="M8 1.8C6 4.6 3.8 7.2 3.8 9.9a4.2 4.2 0 0 0 8.4 0C12.2 7.2 10 4.6 8 1.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'),
  check: svg('<rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m5 8.2 2 2 4-4.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  search: svg('<circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m10.4 10.4 3.6 3.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  folder: svg('<path d="M1.8 4a1 1 0 0 1 1-1h3.4l1.5 1.6h5.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'),
  more: svg('<circle cx="3" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="13" cy="8" r="1.4" fill="currentColor"/>'),
  camera: svg('<path d="M2 5.5a1 1 0 0 1 1-1h2l1.2-1.7h3.6L11 4.5h2a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="8.6" r="2.4" fill="none" stroke="currentColor" stroke-width="1.5"/>'),
}

export function objectOf(c, inst) {
  return c.ctx.objectsById.get(inst.objectId) || { name: 'Objekt', short: 'Objekt', color: 10 }
}

export function dayClass(c, date) {
  return [isoWeekday(date) > 5 ? 'weekend' : '', c.holidays.has(date) ? 'holiday' : ''].join(' ')
}

export function dayHeads(c, days = c.days, { compact = false } = {}) {
  return days
    .map((d) => {
      const h = c.holidays.get(d)
      return `<th class="day-head ${dayClass(c, d)}"><span class="dname">${WEEKDAY_SHORT[isoWeekday(d) - 1]}</span><span class="ddate">${compact ? d.slice(8) : formatDate(d, { weekday: false })}</span>${h && !compact ? `<span class="hol-tag">${esc(h.name)}</span>` : ''}</th>`
    })
    .join('')
}

export function issueList(issues) {
  if (!issues.length) return '<ul class="issue-list"><li class="ok">Keine Einwände</li></ul>'
  return `<ul class="issue-list">${issues.map((i) => `<li class="${i.severity}">${esc(i.message)}</li>`).join('')}</ul>`
}

export function modalFrame({ title, subtitle = '', color = null, body, foot = '', wide = false }) {
  return `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}" ${color ? `style="--obj:var(--o${color})"` : ''}>
    <header><h2>${esc(title)}${subtitle ? `<small>${subtitle}</small>` : ''}</h2><button class="btn icon" data-action="close-modal" aria-label="Schließen">${ICON.close}</button></header>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`
}

export function checkboxes(name, options, selected) {
  return options.map(([value, label]) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(value)}" ${selected.includes(value) ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')
}

/** Begründung eines Vorschlags als kleine Liste: ✓ dafür, ✗ dagegen. */
export function reasonsHtml(factors, opts) {
  if (!factors?.length) return ''
  const { pro, contra } = explain(factors, opts)
  if (!pro.length && !contra.length) return ''
  return `<span class="reasons">${pro.map((t) => `<span class="why pro">${esc(t)}</span>`).join('')}${contra.map((t) => `<span class="why contra">${esc(t)}</span>`).join('')}</span>`
}

export const reasonsText = (factors) => {
  const { pro, contra } = explain(factors || [])
  return [...pro.map((t) => `✓ ${t}`), ...contra.map((t) => `✗ ${t}`)].join('\n')
}

export function rhythmText(task) {
  const r = task.recurrence
  if (r.type === 'once') return `einmalig ${formatDate(r.date)}`
  if (r.type === 'monthly') {
    const when = r.mode === 'day' ? (r.day >= 31 ? 'am Monatsletzten' : `am ${r.day}.`) : `${NTH_LABEL[r.nth] || '1.'} ${WEEKDAY_LONG[(r.weekday || 1) - 1]}`
    const from = (r.everyMonths || 1) > 1 && r.anchor ? ` ab ${MONTH_LONG[Number(r.anchor.slice(5, 7)) - 1]}` : ''
    return `${when}, ${rhythmCategory(task)}${from}`
  }
  const days = r.weekdays.length === 7 ? 'täglich' : r.weekdays.map((d) => WEEKDAY_SHORT[d - 1]).join(', ')
  return `${days}${r.everyWeeks > 1 ? `, alle ${r.everyWeeks} Wochen` : ''}`
}

export function availabilitySummary(emp) {
  const groups = []
  for (let d = 1; d <= 7; d++) {
    const w = emp.availability?.[d]
    const text = w ? `${w.from}–${w.to}` : null
    const last = groups.at(-1)
    if (last && last.text === text && last.to === d - 1) last.to = d
    else groups.push({ from: d, to: d, text })
  }
  return groups
    .filter((g) => g.text)
    .map((g) => `${WEEKDAY_SHORT[g.from - 1]}${g.to > g.from ? `–${WEEKDAY_SHORT[g.to - 1]}` : ''} ${g.text}`)
    .join(', ')
}

export function options(list, selected, { empty } = {}) {
  return `${empty !== undefined ? `<option value="">${esc(empty)}</option>` : ''}${list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(l)}</option>`).join('')}`
}

// Formularwerte lesen
export const val = (id) => document.getElementById(id)?.value ?? ''
export const num = (id) => {
  const n = parseFloat(String(val(id)).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
export const checked = (id) => !!document.getElementById(id)?.checked
export const checkedValues = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value)

/** Datei im Browser speichern (auf der eigenen Domain; in eingebetteten Vorschauen ggf. blockiert). */
export function download(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function hoursCell(min) {
  return min ? formatHours(min) : ''
}
