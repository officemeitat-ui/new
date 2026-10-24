// Gemeinsame Bausteine für Ansichten und Dialoge.

import { formatDate, formatHours, isoWeekday, MONTH_LONG, WEEKDAY_LONG, WEEKDAY_SHORT } from '../core/dates.js'
import { rhythmCategory } from '../core/attention.js'
import { NTH_LABEL } from '../core/plan.js'

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
export const uid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
export const signed = (min) => (min > 0 ? '+' : min < 0 ? '−' : '±') + formatHours(Math.abs(min))
export const saldoClass = (min) => (min > 0 ? 'pos' : min < 0 ? 'neg' : 'zero')
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
  bell: svg('<path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.3 1.2H2.7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M6.6 14.2a1.5 1.5 0 0 0 2.8 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'),
  user: svg('<circle cx="8" cy="5.5" r="2.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 14c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6"/>'),
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
