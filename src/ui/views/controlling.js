// Objekt-Controlling: Budget (Sollstunden laut Kalkulation/Vertrag) gegen
// geplante und besetzte Stunden je Objekt und Monat.

import { formatHours, isoWeek, lastOfMonth, mondayOf, MONTH_LONG } from '../../core/dates.js'
import { mondaysBetween, objectControlling } from '../../core/reports.js'
import { app, registerActions, registerView, render } from '../context.js'
import { esc } from '../shared.js'
import { regionFilter } from './objects.js'

export function monthPicker(c) {
  const [y, m] = c.month.split('-').map(Number)
  return `<div class="toolbar"><button class="btn small" data-action="month-step" data-delta="-1">‹</button><strong class="month-label">${MONTH_LONG[m - 1]} ${y}</strong><button class="btn small" data-action="month-step" data-delta="1">›</button></div>`
}

function controllingView(c) {
  const region = app.ui.region
  const scheduledWeeks = new Set(Object.keys(app.data.assignments).map((k) => mondayOf(k.slice(0, 10))))
  const monthWeeks = mondaysBetween(`${c.month}-01`, lastOfMonth(`${c.month}-01`))
  const unscheduled = monthWeeks.filter((m) => !scheduledWeeks.has(m))
  const rows = objectControlling(c.ctx, app.data.objects.filter((o) => !region || o.region === region), c.month, c.instances, c.state, (m) => scheduledWeeks.has(m))
  const tot = rows.reduce((t, r) => ({ budget: t.budget + r.budget, planned: t.planned + r.planned, staffed: t.staffed + r.staffed, cancelled: t.cancelled + r.cancelled }), { budget: 0, planned: 0, staffed: 0, cancelled: 0 })
  const max = Math.max(1, ...rows.map((r) => Math.max(r.budget, r.planned)))
  const pct = (r) => (r.budget ? Math.round(((r.planned - r.budget) / r.budget) * 100) : null)
  const cls = (p) => (p === null ? '' : p > 5 ? 'warn-text' : p < -10 ? 'info-text' : 'ok-text')
  const body = rows
    .sort((a, b) => Math.abs(pct(b) ?? 0) - Math.abs(pct(a) ?? 0))
    .map((r) => {
      const p = pct(r)
      return `<tr>
        <td><span class="swatch" style="--obj:var(--o${r.object.color})"></span><strong>${esc(r.object.name)}</strong><br><span class="muted">${esc(r.object.region || '')}</span></td>
        <td class="num">${r.budget ? formatHours(r.budget) : '<span class="muted">–</span>'}</td>
        <td class="num">${formatHours(r.planned)}</td>
        <td class="num">${formatHours(r.staffed)}${r.open > 0 ? ` <span class="pill error">${formatHours(r.open)} offen</span>` : ''}</td>
        <td class="num">${r.cancelled ? formatHours(r.cancelled) : ''}</td>
        <td class="num ${cls(p)}">${p === null ? '<span class="muted">kein Budget</span>' : `${p > 0 ? '+' : ''}${p} %`}</td>
        <td class="bar-cell"><div class="bar"><span class="bar-budget" style="width:${(r.budget / max) * 100}%"></span><span class="bar-plan ${cls(p)}" style="width:${(r.planned / max) * 100}%"></span></div></td>
      </tr>`
    })
    .join('')
  return `<div class="section-head"><div><h2>Objekt-Controlling</h2><p>Budget je Objekt (Sollstunden laut Kalkulation oder Vertrag) im Vergleich zu den geplanten und besetzten Stunden. Über Budget heißt: das Objekt kostet mehr Zeit als kalkuliert.</p></div>${monthPicker(c)}</div>
    ${regionFilter()}
    <section class="summary"><div class="stat"><div class="label">Budget</div><div class="value">${formatHours(tot.budget)} h</div></div><div class="stat"><div class="label">Geplant</div><div class="value">${formatHours(tot.planned)} h</div></div><div class="stat"><div class="label">Besetzt</div><div class="value">${formatHours(tot.staffed)} h</div></div><div class="stat"><div class="label">Entfallen (Feiertage)</div><div class="value">${formatHours(tot.cancelled)} h</div></div></section>
    <div class="table-wrap"><table class="data"><thead><tr><th>Objekt</th><th>Budget</th><th>Geplant</th><th>Besetzt</th><th>Entfallen</th><th>Abweichung</th><th style="width:22%">Budget ▮ / Plan ▬</th></tr></thead><tbody>${body}</tbody></table></div>
    <p class="note">Geplant = Stunden aller Einsätze laut Stammplan im Monat (nach Feiertagsregeln). Besetzt = davon mit Personal eingeteilt; „offen“ zählt nur in Wochen, die schon eingeteilt sind.${unscheduled.length ? ` Noch nicht eingeteilt: ${unscheduled.map((m) => `KW ${isoWeek(m).week}`).join(', ')}.` : ''}</p>`
}

registerView({ id: 'controlling', order: 60, label: 'Objekt-Controlling', group: 'auswertung', render: controllingView })

registerActions({
  'month-step': (el) => {
    const [y, m] = app.cur.month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + Number(el.dataset.delta), 1))
    app.ui.month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    render()
  },
})
