// Diagramme für die Kennzahlen: Inline-SVG bzw. HTML ohne Bibliothek.
// Regeln (Gestaltung): dünne Marken (Linie 2 px, Säule/Balken höchstens 24 px, 4 px gerundetes
// Datenende, eckig an der Grundlinie), Gitter als Haarlinie, eine Achse, 2 px Lücke zwischen
// gestapelten Segmenten, Punkte mit Ring in der Flächenfarbe, Legende ab zwei Reihen, Text immer in
// Textfarben (nie in der Reihenfarbe). Werte sind zusätzlich als Tabelle erreichbar (tableView).
// Farben kommen aus CSS-Variablen (.kpi-root in styles.css), hell und dunkel getrennt gewählt.
//
// Hover/Fokus: jede Säule bzw. jede x-Stelle hat eine unsichtbare Trefferfläche (.kpi-hit) mit
// data-tip (JSON). Ein Listener je Dokument zeigt den Tooltip; Namen werden per textContent gesetzt.

import { esc } from './shared.js'

const fmt0 = (n) => String(Math.round(n))

/** Schöne Obergrenze und Teilung für die y-Achse (0 bis max, 3–5 Linien). */
export function niceScale(max, ticks = 4, { integer = false } = {}) {
  if (!(max > 0)) return { max: 1, step: 1, ticks: [0, 1] }
  const raw = max / ticks
  const pow = 10 ** Math.floor(Math.log10(raw))
  let step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) || 10 * pow
  if (integer) step = Math.max(1, Math.round(step))
  const top = Math.ceil(max / step) * step
  const list = []
  for (let v = 0; v <= top + step / 2; v += step) list.push(Math.round(v * 1e6) / 1e6)
  return { max: top, step, ticks: list }
}

const tipAttr = (title, rows) => `data-tip="${esc(JSON.stringify({ t: title, r: rows }))}"`

/** Beschriftungen auf der x-Achse nach Platz (rund 56 px je Beschriftung); die letzte immer. */
const labelEvery = (n, w) => Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 56))))

/**
 * Linien (1–3 Reihen, gleiche Einheit): series [{ id, label, color (CSS-Variable), values[] }].
 * labels: x-Beschriftungen (kurz), titles: Tooltip-Überschriften je x, fmt(v) → Text, axis(v) → Text.
 * min: Untergrenze der y-Achse (Standard 0), z. B. 80 für Prozentwerte nahe 100 (Qualitätskennzahl).
 */
export function lineChart({ labels, titles = labels, series, fmt = fmt0, axis = fmt, unit = 1, integer = false, width = 560, height = 200, ariaLabel = '', min = 0 }) {
  const pad = { l: 46, r: 14, t: 14, b: 26 }
  const w = width - pad.l - pad.r
  const h = height - pad.t - pad.b
  const n = labels.length
  const max = Math.max(0, ...series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined)))
  // Teilung in der Anzeige-Einheit (z. B. Stunden statt Minuten), damit die Achse runde Werte zeigt
  const sc = niceScale((max - min) / unit, 4, { integer })
  const x = (i) => pad.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w)
  // mit Untergrenze: Werte darunter liegen auf der Achse (ohne Untergrenze wie bisher)
  const y = (v) => pad.t + h - ((min ? Math.max(0, v - min) : v) / unit / sc.max) * h
  const grid = sc.ticks.map((t) => `<line class="${t === 0 ? 'kpi-axis' : 'kpi-grid'}" x1="${pad.l}" x2="${width - pad.r}" y1="${y(min + t * unit)}" y2="${y(min + t * unit)}"/><text class="kpi-tick" x="${pad.l - 6}" y="${y(min + t * unit) + 4}" text-anchor="end">${esc(axis(min + t * unit))}</text>`).join('')
  const every = labelEvery(n, w)
  const xl = labels.map((l, i) => ((i % every === 0 && n - 1 - i >= every) || i === n - 1 ? `<text class="kpi-tick" x="${x(i)}" y="${height - 8}" text-anchor="middle">${esc(l)}</text>` : '')).join('')
  const lines = series
    .map((s) => {
      const pts = s.values.map((v, i) => (v === null || v === undefined ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean)
      const last = s.values.length - 1
      const lv = s.values[last]
      return `<polyline class="kpi-line" style="stroke:var(${s.color})" points="${pts.join(' ')}"/>${lv !== null && lv !== undefined ? `<circle class="kpi-dot" cx="${x(last)}" cy="${y(lv)}" r="4" style="fill:var(${s.color})"/>` : ''}`
    })
    .join('')
  const band = n <= 1 ? w : w / (n - 1)
  const hits = labels
    .map((_, i) => {
      const rows = series.map((s) => [s.label, s.values[i] === null || s.values[i] === undefined ? '–' : fmt(s.values[i]), s.color])
      return `<rect class="kpi-hit" tabindex="0" x="${Math.max(pad.l - band / 2, x(i) - band / 2)}" y="${pad.t}" width="${band}" height="${h}" data-x="${x(i)}" ${tipAttr(titles[i], rows)} aria-label="${esc(`${titles[i]}: ${rows.map((r) => `${r[0]} ${r[1]}`).join(', ')}`)}"/>`
    })
    .join('')
  return `<svg class="kpi-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(ariaLabel)}">${grid}${xl}${lines}<line class="kpi-cross" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + h}" visibility="hidden"/>${hits}</svg>`
}

/**
 * Säulen, einzeln oder gestapelt (bis 3 Reihen): series [{ id, label, color, values[] }].
 * Gestapelt: 2 px Lücke zwischen den Segmenten, oberes Segment mit gerundeter Kappe.
 * labelLast: Wert über der letzten Säule (nur bei einer Reihe).
 */
export function columnChart({ labels, titles = labels, series, fmt = fmt0, axis = fmt, unit = 1, integer = false, width = 560, height = 200, labelLast = true, ariaLabel = '' }) {
  const pad = { l: 46, r: 10, t: 18, b: 26 }
  const w = width - pad.l - pad.r
  const h = height - pad.t - pad.b
  const n = labels.length
  const totals = labels.map((_, i) => series.reduce((s, x) => s + Math.max(0, x.values[i] || 0), 0))
  const sc = niceScale(Math.max(0, ...totals) / unit, 4, { integer })
  const band = w / Math.max(1, n)
  const colW = Math.min(24, band * 0.62)
  const y = (v) => pad.t + h - (v / unit / sc.max) * h
  const grid = sc.ticks.map((t) => `<line class="${t === 0 ? 'kpi-axis' : 'kpi-grid'}" x1="${pad.l}" x2="${width - pad.r}" y1="${y(t * unit)}" y2="${y(t * unit)}"/><text class="kpi-tick" x="${pad.l - 6}" y="${y(t * unit) + 4}" text-anchor="end">${esc(axis(t * unit))}</text>`).join('')
  const every = labelEvery(n, w)
  const cols = labels
    .map((l, i) => {
      const cx = pad.l + band * i + band / 2
      const x0 = cx - colW / 2
      let base = pad.t + h
      const segs = []
      const visible = series.map((s, k) => [s, k, Math.max(0, s.values[i] || 0)]).filter(([, , v]) => v > 0)
      visible.forEach(([s, , v], j) => {
        const top = j === visible.length - 1
        const gap = j > 0 ? 2 : 0
        const hh = Math.max(0, (v / unit / sc.max) * h - gap)
        const yTop = base - gap - hh
        if (hh <= 0.5) {
          base -= gap + hh
          return
        }
        const r = top ? Math.min(4, hh, colW / 2) : 0
        // eckig unten, gerundet oben (nur das oberste Segment)
        const d = r ? `M${x0},${base - gap}V${yTop + r}Q${x0},${yTop} ${x0 + r},${yTop}H${x0 + colW - r}Q${x0 + colW},${yTop} ${x0 + colW},${yTop + r}V${base - gap}Z` : `M${x0},${base - gap}V${yTop}H${x0 + colW}V${base - gap}Z`
        segs.push(`<path class="kpi-col" d="${d}" style="fill:var(${s.color})"/>`)
        base = yTop
      })
      const rows = series.map((s) => [s.label, fmt(s.values[i] || 0), s.color])
      const label = (i % every === 0 && n - 1 - i >= every) || i === n - 1 ? `<text class="kpi-tick" x="${cx}" y="${height - 8}" text-anchor="middle">${esc(l)}</text>` : ''
      const cap = labelLast && series.length === 1 && i === n - 1 && totals[i] > 0 ? `<text class="kpi-cap" x="${cx}" y="${y(totals[i]) - 5}" text-anchor="middle">${esc(fmt(totals[i]))}</text>` : ''
      return `${segs.join('')}${cap}${label}<rect class="kpi-hit" tabindex="0" x="${pad.l + band * i}" y="${pad.t}" width="${band}" height="${h}" ${tipAttr(titles[i], series.length > 1 ? [...rows, ['Summe', fmt(totals[i]), '']] : rows)} aria-label="${esc(`${titles[i]}: ${rows.map((r) => `${r[0]} ${r[1]}`).join(', ')}`)}"/>`
    })
    .join('')
  return `<svg class="kpi-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(ariaLabel)}">${grid}${cols}</svg>`
}

/**
 * Waagrechte Balken (HTML): rows [{ label, value, display, sub?, view? }], eine Farbe.
 * ref: Bezugswert (z. B. 1 = 100 % Vertrag) als Haarlinie. diverging: negative Werte nach links.
 */
export function barList({ rows, color = '--kpi-1', ref = null, diverging = false, max = null, refLabel = '' }) {
  if (!rows.length) return '<p class="muted small">Keine Daten im Zeitraum.</p>'
  const top = max ?? Math.max(ref || 0, ...rows.map((r) => Math.abs(r.value)))
  const pct = (v) => (top ? (Math.abs(v) / top) * 100 : 0)
  return `<ul class="kpi-bars ${diverging ? 'diverging' : ''}">${rows
    .map((r) => {
      const neg = diverging && r.value < 0
      const tip = tipAttr(r.label, [[r.tipLabel || '', r.display, neg ? '--kpi-neg' : diverging ? '--kpi-pos' : color], ...(r.extra || [])])
      // ein Wert 0 zeichnet nichts
      const bar = Math.abs(r.value) > 1e-9 ? `<span class="kpi-bar ${neg ? 'neg' : ''}" style="width:${diverging ? pct(r.value) / 2 : pct(r.value)}%;background:var(${neg ? '--kpi-neg' : diverging ? '--kpi-pos' : color})"></span>` : ''
      return `<li class="kpi-hit-row kpi-hit" tabindex="0" ${tip}><span class="kpi-bar-label" title="${esc(r.label)}">${esc(r.label)}${r.sub ? ` <small class="muted">${esc(r.sub)}</small>` : ''}</span><span class="kpi-track">${ref ? `<span class="kpi-ref" style="left:${pct(ref)}%" title="${esc(refLabel)}"></span>` : ''}${bar}</span><span class="kpi-bar-value">${esc(r.display)}</span></li>`
    })
    .join('')}</ul>`
}

/** Kleiner Verlauf für eine Kachel: dünne Linie in der Nebenfarbe, letzter Punkt in der Hauptfarbe. */
export function sparkline(values, { width = 96, height = 28 } = {}) {
  const v = values.map((x) => (Number.isFinite(x) ? x : null))
  const nums = v.filter((x) => x !== null)
  if (nums.length < 2) return ''
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const span = max - min || 1
  const x = (i) => 2 + (i / (v.length - 1)) * (width - 6)
  const y = (val) => height - 3 - ((val - min) / span) * (height - 6)
  const pts = v.map((val, i) => (val === null ? null : `${x(i).toFixed(1)},${y(val).toFixed(1)}`)).filter(Boolean)
  const li = v.length - 1
  return `<svg class="kpi-spark" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline points="${pts.join(' ')}"/>${v[li] !== null ? `<circle cx="${x(li)}" cy="${y(v[li])}" r="3"/>` : ''}</svg>`
}

/** Legende (ab zwei Reihen): Linien als Strich, Säulen als Feld. */
export const legend = (series, kind = 'line') => (series.length < 2 ? '' : `<div class="kpi-legend">${series.map((s) => `<span><i class="kpi-key ${kind}" style="--c:var(${s.color})"></i>${esc(s.label)}</span>`).join('')}</div>`)

/** Tabelle zu einem Diagramm (immer erreichbar, auch ohne Hover). */
export function tableView(head, rows) {
  return `<details class="kpi-table"><summary>Als Tabelle</summary><div class="table-wrap"><table class="data"><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`
}

// ---------------------------------------------------------------- Tooltip (ein Listener für alle Diagramme)

function showTip(hit, clientX, clientY) {
  const card = hit.closest('.kpi-card')
  if (!card) return
  let tip = card.querySelector('.kpi-tip')
  if (!tip) {
    tip = document.createElement('div')
    tip.className = 'kpi-tip'
    tip.setAttribute('role', 'status')
    card.append(tip)
  }
  let data
  try {
    data = JSON.parse(hit.dataset.tip || '{}')
  } catch {
    return
  }
  tip.replaceChildren()
  const head = document.createElement('div')
  head.className = 'kpi-tip-title'
  head.textContent = data.t || ''
  tip.append(head)
  for (const [label, value, color] of data.r || []) {
    const row = document.createElement('div')
    row.className = 'kpi-tip-row'
    if (color) {
      const key = document.createElement('i')
      key.className = 'kpi-key line'
      key.style.setProperty('--c', `var(${color})`)
      row.append(key)
    }
    const v = document.createElement('strong')
    v.textContent = value
    row.append(v)
    if (label) {
      const l = document.createElement('span')
      l.textContent = label
      row.append(l)
    }
    tip.append(row)
  }
  const box = card.getBoundingClientRect()
  const hb = hit.getBoundingClientRect()
  const px = (clientX ?? hb.left + hb.width / 2) - box.left
  const py = (clientY ?? hb.top) - box.top
  tip.hidden = false
  const tw = tip.offsetWidth
  tip.style.left = `${Math.max(4, Math.min(box.width - tw - 4, px + 12 > box.width - tw - 4 ? px - tw - 12 : px + 12))}px`
  tip.style.top = `${Math.max(4, py - tip.offsetHeight - 8)}px`
  // Fadenkreuz bei Linien
  const svg = hit.ownerSVGElement
  const cross = svg?.querySelector('.kpi-cross')
  if (cross && hit.dataset.x) {
    cross.setAttribute('x1', hit.dataset.x)
    cross.setAttribute('x2', hit.dataset.x)
    cross.setAttribute('visibility', 'visible')
  }
  card.querySelectorAll('.kpi-hit.on').forEach((el) => el !== hit && el.classList.remove('on'))
  hit.classList.add('on')
}

function hideTip(card) {
  if (!card) return
  const tip = card.querySelector('.kpi-tip')
  if (tip) tip.hidden = true
  card.querySelectorAll('.kpi-cross').forEach((c) => c.setAttribute('visibility', 'hidden'))
  card.querySelectorAll('.kpi-hit.on').forEach((el) => el.classList.remove('on'))
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointermove', (e) => {
    const hit = e.target.closest?.('.kpi-hit')
    if (hit) showTip(hit, e.clientX, e.clientY)
  })
  document.addEventListener('pointerout', (e) => {
    const hit = e.target.closest?.('.kpi-hit')
    if (hit && !hit.contains(e.relatedTarget)) hideTip(hit.closest('.kpi-card'))
  })
  document.addEventListener('focusin', (e) => {
    const hit = e.target.closest?.('.kpi-hit')
    if (hit) showTip(hit)
  })
  document.addEventListener('focusout', (e) => {
    const hit = e.target.closest?.('.kpi-hit')
    if (hit) hideTip(hit.closest('.kpi-card'))
  })
}
