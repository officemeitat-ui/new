// Wetter grafisch wie in Wetter-Apps: Stundenverlauf (Temperatur, Niederschlag,
// Schnee, Böen, Symbole, Nacht), Tageskarten und der Nowcast-Streifen für die
// nächsten Stunden. Alles als SVG/HTML-Text, ohne Bibliothek.

import { formatDate } from '../core/dates.js'
import { forecastDays, hourSlots, isNight, viennaParts, WARN_LEVEL, warningText, weatherKind } from '../core/weather.js'
import { KIND, nowcastHint, rateColor } from '../core/nowcast.js'
import { esc } from './shared.js'

const de = (x, digits = 0) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? '–' : Number(x).toLocaleString('de-AT', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).replace('-', '−'))
const clock = (ms) => new Date(ms).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' })
const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

// ---------------------------------------------------------------- Symbole (24er-Raster)

const CLOUD = 'M7 17.5h10a4 4 0 0 0 .4-7.98A5.6 5.6 0 0 0 6.6 10.8 3.4 3.4 0 0 0 7 17.5z'
const sun = (cx, cy, r) => {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4
    const p = (d) => `${(cx + Math.cos(a) * d).toFixed(2)} ${(cy + Math.sin(a) * d).toFixed(2)}`
    return `M${p(r + 1.6)}L${p(r + 3.4)}`
  }).join('')
  return `<circle class="i-sun" cx="${cx}" cy="${cy}" r="${r}"/><path class="i-ray" d="${rays}"/>`
}
const moon = (cx, cy, r) => `<path class="i-moon" d="M${cx + r * 0.3} ${cy - r}a${r} ${r} 0 1 0 ${r * 0.75} ${r * 1.6}A${r * 0.8} ${r * 0.8} 0 0 1 ${cx + r * 0.3} ${cy - r}z"/>`
const cloud = (dx = 0, dy = 0, s = 1, cls = 'i-cloud') => `<path class="${cls}" transform="translate(${dx} ${dy}) scale(${s})" d="${CLOUD}"/>`
const drops = (n = 3) => `<path class="i-rain" d="${['M8.5 19.2l-1 2.6', 'M12.5 19.2l-1 2.6', 'M16.5 19.2l-1 2.6'].slice(0, n).join('')}"/>`
const flakes = () => '<g class="i-snow"><circle cx="8.3" cy="20.4" r="1.25"/><circle cx="12.3" cy="21.6" r="1.25"/><circle cx="16.3" cy="20.4" r="1.25"/></g>'

/** Symbol als SVG-Inhalt (24 × 24). */
export function iconBody(kind, night = false) {
  const lit = (cx, cy, r) => (night ? moon(cx, cy, r) : sun(cx, cy, r))
  switch (kind) {
    case 'clear':
      return night ? moon(12, 12, 6.5) : sun(12, 12, 4.6)
    case 'partly':
      return `${lit(8.5, 8.5, 3.4)}${cloud(2.5, 2.5, 0.85)}`
    case 'cloudy':
      return `${cloud(-2.5, -3, 0.8, 'i-cloud back')}${cloud(1, 1, 0.95)}`
    case 'overcast':
      return `${cloud(-2, -3.5, 0.85, 'i-cloud back')}${cloud(0, 0.5)}`
    case 'fog':
      return `${cloud(0, -3)}<path class="i-fog" d="M4 17.5h16M6.5 20.5h11"/>`
    case 'shower':
      return `${lit(7.5, 6.5, 3)}${cloud(1.5, -2, 0.9)}${drops(2)}`
    case 'rain':
      return `${cloud(0, -3.5)}${drops(3)}`
    case 'heavyrain':
      return `${cloud(0, -3.5, 1, 'i-cloud dark')}${drops(3)}<path class="i-rain" d="M10.5 22.2l-.6 1.3M14.5 22.2l-.6 1.3"/>`
    case 'sleet':
      return `${cloud(0, -3.5)}<path class="i-rain" d="M8.5 19.2l-1 2.6M16.5 19.2l-1 2.6"/><circle class="i-snow" cx="12.3" cy="21" r="1.25"/>`
    case 'snowshower':
      return `${lit(7.5, 6.5, 3)}${cloud(1.5, -2, 0.9)}${flakes()}`
    case 'snow':
      return `${cloud(0, -3.5)}${flakes()}`
    case 'thunder':
      return `${cloud(0, -4, 1, 'i-cloud dark')}<path class="i-bolt" d="M12.8 13.6 9.6 18.6h3l-1.6 4.6 4.2-6h-3z"/>`
    default:
      return ''
  }
}
export const icon = (kind, { night = false, size = 28, label = '' } = {}) =>
  kind ? `<svg class="wx-icon" viewBox="0 0 24 24" width="${size}" height="${size}" role="img" aria-label="${esc(label || kind)}">${iconBody(kind, night)}</svg>` : ''

// ---------------------------------------------------------------- Stundenverlauf

const COL = 40 // Pixel je Stunde
const G = 34 // Rand links für die Einheiten
const H = { day: 12, hour: 27, icon: 32, tTop: 74, tBottom: 142, pTop: 152, pBottom: 200, gust: 216, limit: 236, total: 246 }

/** Pfad durch Punkte, sanft gerundet (Mittelpunkte als Stützen). */
function smoothPath(pts) {
  if (!pts.length) return ''
  if (pts.length < 3) return `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}`
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2
    const my = (pts[i][1] + pts[i + 1][1]) / 2
    d += `Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`
  }
  const last = pts.at(-1)
  return `${d}L${last[0].toFixed(1)} ${last[1].toFixed(1)}`
}

/**
 * Stundenverlauf als SVG: Temperatur (Linie), Niederschlag (Regen blau, Schnee lila),
 * Symbole, Böen mit Windrichtung, Schneefallgrenze, Nacht schattiert, „jetzt“ markiert.
 * entry: Wetter eines Orts (hours, warnings), loc: { lat, lon }, cfg: Schwellen (gustKmh).
 */
export function hourlyChart(entry, loc, { now = Date.now(), hours = 48, cfg = {} } = {}) {
  const slots = hourSlots(entry?.hours || [], { from: now, count: hours })
  if (slots.length < 3) return '<p class="muted">Für den Stundenverlauf fehlen Daten.</p>'
  const width = G + slots.length * COL
  const lat = Number(loc?.lat) || 47.8
  const lon = Number(loc?.lon) || 13.05
  const x = (i) => G + i * COL + COL / 2
  const left = (i) => G + i * COL
  const ts = slots.map((s) => s.t).filter((t) => t !== null)
  const tMin = Math.floor(Math.min(...ts) - 1)
  const tMax = Math.ceil(Math.max(...ts) + 1)
  const yT = (t) => H.tTop + ((tMax - t) / Math.max(1, tMax - tMin)) * (H.tBottom - H.tTop)
  const pMax = Math.max(2, ...slots.map((s) => s.precip || 0))
  const yP = (p) => H.pBottom - (Math.min(p, pMax) / pMax) * (H.pBottom - H.pTop)
  const gustWarn = Number(cfg.gustKmh) || 60
  const parts = []
  // Nacht und Tagesgrenzen
  slots.forEach((s, i) => {
    if (isNight(s.at + 1800e3, lat, lon)) parts.push(`<rect class="wx-c-night" x="${left(i)}" y="0" width="${COL}" height="${H.total}"/>`)
    const v = viennaParts(s.at)
    if (v.hour === 0 || i === 0) {
      const d = new Date(Date.parse(`${v.date}T12:00:00Z`))
      if (i > 0) parts.push(`<line class="wx-c-daysep" x1="${left(i)}" x2="${left(i)}" y1="0" y2="${H.total}"/>`)
      parts.push(`<text class="wx-c-day" x="${left(i) + 4}" y="${H.day}">${WEEKDAY[d.getUTCDay()]} ${v.date.slice(8)}.${v.date.slice(5, 7)}.</text>`)
    }
    parts.push(`<text class="wx-c-hour" x="${x(i)}" y="${H.hour}" text-anchor="middle">${String(v.hour).padStart(2, '0')}</text>`)
    const k = weatherKind(s)
    if (k) parts.push(`<g transform="translate(${x(i) - 12} ${H.icon})"><title>${esc(`${clock(s.at)}–${clock(s.end)}: ${k.label}`)}</title>${iconBody(k.kind, isNight(s.at + 1800e3, lat, lon))}</g>`)
  })
  // 0 °C (Glätte)
  if (tMin < 0 && tMax > 0) parts.push(`<line class="wx-c-zero" x1="${G}" x2="${width}" y1="${yT(0).toFixed(1)}" y2="${yT(0).toFixed(1)}"/><text class="wx-c-zero-t" x="2" y="${(yT(0) + 3).toFixed(1)}">0 °C</text>`)
  // Temperatur
  const pts = slots.map((s, i) => (s.t === null ? null : [x(i), yT(s.t)])).filter(Boolean)
  const line = smoothPath(pts)
  if (line) {
    parts.push(`<path class="wx-c-tarea" d="${line}L${pts.at(-1)[0].toFixed(1)} ${H.tBottom + 4}L${pts[0][0].toFixed(1)} ${H.tBottom + 4}z"/>`)
    parts.push(`<path class="wx-c-tline" d="${line}"/>`)
  }
  // Beschriftung: jede zweite Stunde plus Höchst- und Tiefstwert
  const iMax = slots.findIndex((s) => s.t === Math.max(...ts))
  const iMin = slots.findIndex((s) => s.t === Math.min(...ts))
  slots.forEach((s, i) => {
    if (s.t === null) return
    const key = i === iMax || i === iMin
    if (i % 2 && !key) return
    parts.push(`<circle class="wx-c-tdot" cx="${x(i)}" cy="${yT(s.t).toFixed(1)}" r="${key ? 2.6 : 1.8}"/><text class="wx-c-tval${Math.round(s.t) < 0 ? ' frost' : ''}${key ? ' key' : ''}" x="${x(i)}" y="${(yT(s.t) - 6).toFixed(1)}" text-anchor="middle">${de(Math.round(s.t) || 0)}°</text>`)
  })
  // Niederschlag
  parts.push(`<line class="wx-c-base" x1="${G}" x2="${width}" y1="${H.pBottom}" y2="${H.pBottom}"/>`)
  slots.forEach((s, i) => {
    const p = s.precip || 0
    if (p < 0.05) return
    const snow = Math.min(p, s.snow || 0)
    const rain = p - snow
    const bx = left(i) + 5
    const bw = COL - 10
    if (rain > 0) parts.push(`<rect class="wx-c-rain" x="${bx}" y="${yP(p).toFixed(1)}" width="${bw}" height="${(H.pBottom - yP(rain)).toFixed(1)}" rx="2"><title>${esc(`${clock(s.at)}–${clock(s.end)}: ${de(p, 1)} mm${snow ? `, davon Schnee ca. ${de(snow, 1)} cm` : ''}`)}</title></rect>`)
    if (snow > 0) parts.push(`<rect class="wx-c-snow" x="${bx}" y="${yP(snow).toFixed(1)}" width="${bw}" height="${(H.pBottom - yP(snow)).toFixed(1)}" rx="2"><title>${esc(`${clock(s.at)}–${clock(s.end)}: Neuschnee ca. ${de(snow, 1)} cm`)}</title></rect>`)
    if (p >= 0.2) parts.push(`<text class="wx-c-pval" x="${x(i)}" y="${(yP(p) - 3).toFixed(1)}" text-anchor="middle">${de(p, p < 10 ? 1 : 0)}</text>`)
  })
  // Böen mit Windrichtung
  slots.forEach((s, i) => {
    const g = s.gust ?? s.wind
    if (g === null || g === undefined) return
    const arrow = s.windFrom !== null && s.windFrom !== undefined ? `<path class="wx-c-arrow" transform="translate(${x(i) - 11} ${H.gust - 4}) rotate(${(s.windFrom + 180) % 360})" d="M0 -4L2.6 2.4 0 1 -2.6 2.4z"/>` : ''
    parts.push(`${arrow}<text class="wx-c-gust ${g >= gustWarn ? 'warn' : ''}" x="${x(i) + 4}" y="${H.gust}" text-anchor="middle">${de(g)}</text>`)
  })
  // Schneefallgrenze: alle 3 Stunden, wenn es in der Nähe nass ist und die Grenze tief liegt
  slots.forEach((s, i) => {
    if (i % 3 || s.snowLimit === null || s.snowLimit === undefined || s.snowLimit > 2500) return
    const wetNear = slots.slice(Math.max(0, i - 2), i + 3).some((x2) => (x2.precip || 0) >= 0.1)
    if (wetNear) parts.push(`<text class="wx-c-limit" x="${x(i)}" y="${H.limit}" text-anchor="middle">${de(Math.round(s.snowLimit / 50) * 50)} m</text>`)
  })
  // jetzt
  const nowX = G + ((now - slots[0].at) / 3600e3) * COL
  if (nowX >= G && nowX <= width) parts.push(`<line class="wx-c-now" x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="${H.hour + 3}" y2="${H.pBottom}"/><text class="wx-c-now-t" x="${(nowX + 3).toFixed(1)}" y="${H.tTop - 14}">jetzt</text>`)
  const hasLimit = parts.some((p) => p.includes('wx-c-limit'))
  // Einheiten am linken Rand
  parts.push(`<rect class="wx-c-gutter" x="0" y="0" width="${G - 2}" height="${H.total}"/><text class="wx-c-unit" x="2" y="${H.tTop + 4}">°C</text><text class="wx-c-unit" x="2" y="${H.pTop + 10}">mm</text><text class="wx-c-unit" x="2" y="${H.gust}">km/h</text>${hasLimit ? `<text class="wx-c-unit" x="2" y="${H.limit}">SFG</text>` : ''}`)
  const summary = `Stundenverlauf ab ${clock(slots[0].at)}: Temperatur ${de(Math.min(...ts))} bis ${de(Math.max(...ts))} °C, Niederschlag gesamt ${de(slots.reduce((s, x2) => s + (x2.precip || 0), 0), 1)} mm`
  return `<div class="wx-chart-scroll" tabindex="0" aria-label="Stundenverlauf, waagrecht scrollbar">
    <svg class="wx-chart" width="${width}" height="${H.total}" viewBox="0 0 ${width} ${H.total}" role="img" aria-label="${esc(summary)}">${parts.join('')}</svg>
  </div>`
}

// ---------------------------------------------------------------- Tageskarten

const pill = (w) => `<span class="pill wx-${WARN_LEVEL[w.level]}" title="${esc(w.text || '')}">${esc(warningText(w))}</span>`

/** Karten je Tag (heute bis übermorgen, so weit GeoSphere rechnet). */
export function dayCards(entry, loc, dates, today) {
  const days = forecastDays(entry, dates, loc).filter((d) => d.known || d.warnings.length)
  if (!days.length) return ''
  const all = days.flatMap((d) => [d.tMin, d.tMax]).filter((v) => v !== null)
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const pos = (t) => (hi > lo ? ((t - lo) / (hi - lo)) * 100 : 50)
  return `<div class="wx-days">${days
    .map((d) => {
      const name = d.date === today ? 'Heute' : formatDate(d.date, { weekday: true }).split(' ')[0]
      const part = d.until ? `<p class="note wx-until" title="GeoSphere rechnet rund 2½ Tage voraus">Vorhersage bis ${clock(d.until)} Uhr</p>` : ''
      const bar = d.tMin !== null && d.tMax !== null ? `<div class="wx-range" aria-hidden="true"><span style="left:${pos(d.tMin).toFixed(0)}%;right:${(100 - pos(d.tMax)).toFixed(0)}%"></span></div>` : ''
      return `<article class="wx-day">
        <header><strong>${esc(name)}</strong> <span class="muted">${esc(formatDate(d.date, { weekday: false }))}</span></header>
        <div class="wx-day-main">${icon(d.kind?.kind, { size: 44, label: d.kind?.label || '' })}<div><div class="wx-temps"><span class="hi">${de(d.tMax)}°</span> <span class="lo">${de(d.tMin)}°</span></div><div class="wx-kind">${esc(d.kind?.label || '')}</div></div></div>
        ${bar}
        <dl class="wx-facts">
          <div><dt>Niederschlag</dt><dd>${d.precip ? `${de(d.precip, 1)} mm${d.wetHours ? ` · ${d.wetHours} h` : ''}` : 'trocken'}</dd></div>
          ${d.snow ? `<div><dt>Neuschnee</dt><dd>ca. ${de(d.snow, 1)} cm</dd></div>` : ''}
          <div><dt>Böen</dt><dd>${d.gust !== null ? `${de(d.gust)} km/h` : '–'}</dd></div>
          ${d.sun ? `<div><dt>Sonne</dt><dd>${clock(d.sun.rise)}–${clock(d.sun.set)}</dd></div>` : ''}
        </dl>
        ${d.warnings.length ? `<div class="wx-day-warn">${d.warnings.map(pill).join(' ')}</div>` : ''}${part}
      </article>`
    })
    .join('')}</div>`
}

// ---------------------------------------------------------------- Nowcast (nächste 3 Stunden)

const css = (c) => (c ? `rgb(${c[0]} ${c[1]} ${c[2]})` : 'transparent')

/** Streifen mit 15-Minuten-Feldern für die nächsten Stunden samt Hinweis „Regen in 20 Min.“. */
export function nowcastStrip(point, { now = Date.now() } = {}) {
  if (!point) return ''
  const hint = nowcastHint(point.steps, now)
  if (hint.state === 'unknown') return `<div class="wx-now"><p class="muted">${esc(hint.text)}</p></div>`
  const steps = point.steps.filter((s) => s.at + 15 * 60e3 > now).slice(0, 12)
  const cells = steps
    .map((s) => {
      const c = rateColor(s.rate, s.kind)
      const kind = s.kind === KIND.snow ? 'Schnee' : s.kind === KIND.sleet ? 'Schneeregen' : s.kind === KIND.freezing ? 'gefrierender Regen' : 'Regen'
      const title = `${clock(Math.max(s.at, now))}: ${c ? `${kind} ${de(s.rate, 1)} mm/h` : 'trocken'}${s.t !== null ? `, ${de(s.t, 1)} °C` : ''}`
      const h = c ? Math.max(18, Math.min(100, (s.rate / 5) * 100)) : 0
      return `<span class="wx-now-cell" title="${esc(title)}"><span style="height:${h.toFixed(0)}%;background:${css(c)}"></span></span>`
    })
    .join('')
  const marks = [0, 4, 8].filter((i) => steps[i]).map((i) => `<span style="left:${((i / steps.length) * 100).toFixed(1)}%">${i ? `+${i / 4} h` : 'jetzt'}</span>`).join('')
  const cls = hint.state === 'dry' ? 'dry' : hint.kind === KIND.snow ? 'snow' : 'wet'
  return `<div class="wx-now ${cls}"><p class="wx-now-text"><strong>${esc(hint.text)}</strong></p><div class="wx-now-bar" role="img" aria-label="${esc(Math.round(steps.length / 4) === 1 ? 'Niederschlag der nächsten Stunde, je Viertelstunde' : `Niederschlag der nächsten ${Math.round(steps.length / 4)} Stunden, je Viertelstunde`)}">${cells}</div><div class="wx-now-marks" aria-hidden="true">${marks}</div></div>`
}
