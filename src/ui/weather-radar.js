// Niederschlagsradar in der Ansicht „Wetter & Winterdienst“: Karte mit den
// letzten Stunden, dem Nowcast (jetzt bis +3 h) und dem Modell danach,
// Zeitregler mit Abspielen und darunter ein Streifen, wann es im Ausschnitt
// nass ist.
//
// Die App zeichnet bei jeder Änderung die ganze Seite neu. Die Karte lebt
// deshalb außerhalb davon (ein Element für die ganze Sitzung) und wird nach
// jedem Zeichnen in ihren Platzhalter gehängt. Geladen wird nur, solange der
// Platzhalter auf der Seite ist; danach laufen weder Zeitgeber noch Anfragen.

import { frameStats, LEGEND } from '../core/nowcast.js'
import { app } from './context.js'
import { esc } from './shared.js'
import { loadRadar, radarMarks, weatherState } from './weather.js'
import { RadarMap } from './weather-map.js'

const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const clock = (ms) => new Date(ms).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' })
const dayOf = (ms) => WEEKDAY[new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'Europe/Vienna' })).getDay()]
const SOURCE = { past: 'Messung (INCA)', now: 'Nowcast', nowcast: 'Nowcast', model: 'Modell (C-LAEF)' }

let root = null
let map = null
let index = -1
let shownAt = 0 // Daten-Stand, den die Bedienleiste gerade zeigt
let play = null
let ticker = null
let fitted = false

// Form der Karte (Breite : Höhe), damit der geladene Ausschnitt sie füllt
const aspect = () => (map ? map.size.w / map.size.h : 0)

/** Platzhalter für die Ansicht. */
export const radarSlot = () => '<div class="wx-radar-slot"></div>'

function relative(f, now) {
  const min = Math.round((f.at - now) / 60e3)
  if (f.kind === 'now' || f.current || Math.abs(min) < 8) return 'jetzt'
  if (min < 0) return min > -55 ? `vor ${-min} Min.` : `vor ${Math.round(-min / 60)} Std.`
  return min < 55 ? `in ${min} Min.` : `in ${(min / 60).toLocaleString('de-AT', { maximumFractionDigits: 1 })} Std.`
}

function legendHtml() {
  const chips = (list) => list.map((c) => `<span class="wx-leg-chip" style="background:${c.color}" title="ab ${String(c.min).replace('.', ',')} mm/h"></span>`).join('')
  return `<div class="wx-legend" aria-label="Legende">
    <span class="wx-leg"><span class="wx-leg-label">Regen</span>${chips(LEGEND.rain)}<span class="muted">0,1 … 50 mm/h</span></span>
    <span class="wx-leg"><span class="wx-leg-label">Schnee</span>${chips(LEGEND.snow)}</span>
    <span class="wx-leg"><span class="wx-leg-chip" style="background:${LEGEND.sleet}"></span>Schneeregen</span>
    <span class="wx-leg"><span class="wx-leg-chip" style="background:${LEGEND.freezing}"></span>gefrierend</span>
  </div>`
}

function build() {
  root = document.createElement('div')
  root.className = 'wx-radar'
  root.innerHTML = `<div class="wx-radar-map" tabindex="0" aria-label="Karte mit Niederschlagsradar. Ziehen zum Verschieben, Mausrad oder Plus/Minus zum Zoomen."></div>
    <div class="wx-radar-bar">
      <button type="button" class="btn small wx-play" aria-label="Abspielen">▶</button>
      <input type="range" class="wx-slider" min="0" max="0" value="0" aria-label="Zeitpunkt des Radarbilds">
      <button type="button" class="btn small ghost wx-now-btn">Jetzt</button>
      <span class="wx-frame-label" aria-live="polite"></span>
    </div>
    <div class="wx-hist" role="group" aria-label="Wann es im Ausschnitt nass ist"></div>
    ${legendHtml()}
    <p class="note wx-radar-status"></p>`
  const tiles = app.config?.weatherMap?.tiles || 'osm'
  map = new RadarMap(root.querySelector('.wx-radar-map'), { tiles })
  map.setAttribution('Niederschlag: <a href="https://data.hub.geosphere.at" target="_blank" rel="noopener">GeoSphere Austria</a> (CC BY 4.0)')
  root.querySelector('.wx-slider').addEventListener('input', (e) => select(Number(e.target.value)))
  root.querySelector('.wx-play').addEventListener('click', togglePlay)
  root.querySelector('.wx-now-btn').addEventListener('click', () => {
    stopPlay()
    select(currentIndex())
  })
  root.querySelector('.wx-hist').addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]')
    if (!b) return
    stopPlay()
    select(Number(b.dataset.i))
  })
}

const frames = () => weatherState().radar?.frames || []
function currentIndex() {
  const list = frames()
  const now = Date.now()
  const i = list.findIndex((f) => f.kind === 'now' || f.current)
  if (i >= 0) return i
  const past = list.filter((f) => f.at <= now)
  return past.length ? list.indexOf(past.at(-1)) : 0
}

function select(i) {
  const list = frames()
  if (!list.length) return
  index = Math.max(0, Math.min(list.length - 1, i))
  const f = list[index]
  map.show(f)
  root.querySelector('.wx-slider').value = String(index)
  const st = frameStats(f)
  const what = st.wetShare < 0.002 ? 'trocken im Ausschnitt' : `${st.snowShare > 0.5 ? 'Schnee' : 'Niederschlag'} auf ${Math.max(1, Math.round(st.wetShare * 100))} % der Fläche, bis ${String(st.max).replace('.', ',')} mm/h`
  root.querySelector('.wx-frame-label').innerHTML = `<strong>${dayOf(f.at)} ${clock(f.at)}</strong> · ${esc(relative(f, Date.now()))} · <span class="muted">${esc(SOURCE[f.kind] || '')}</span><br><span class="muted">${esc(what)}</span>`
  for (const el of root.querySelectorAll('.wx-hist [data-i]')) el.classList.toggle('on', Number(el.dataset.i) === index)
}

function togglePlay() {
  if (play) return stopPlay()
  const btn = root.querySelector('.wx-play')
  btn.textContent = '❚❚'
  btn.setAttribute('aria-label', 'Anhalten')
  let wait = 0
  play = setInterval(() => {
    const list = frames()
    if (!list.length || !document.contains(root)) return stopPlay()
    if (index >= list.length - 1) {
      // am Ende kurz stehen bleiben, dann von vorn
      if (++wait < 3) return
      wait = 0
      return select(0)
    }
    select(index + 1)
  }, 650)
}

function stopPlay() {
  clearInterval(play)
  play = null
  const btn = root?.querySelector('.wx-play')
  if (btn) {
    btn.textContent = '▶'
    btn.setAttribute('aria-label', 'Abspielen')
  }
}

/** Bedienleiste und Streifen an neue Daten anpassen. */
function refreshControls() {
  const radar = weatherState().radar || {}
  const list = frames()
  const status = root.querySelector('.wx-radar-status')
  root.classList.toggle('empty', !list.length)
  if (radar.loading && !list.length) status.textContent = 'Radar wird geladen …'
  else if (radar.error && !list.length) status.innerHTML = `<span class="err-text">${esc(radar.error)}</span> Die Vorhersage oben gilt weiter.`
  else
    status.innerHTML = [
      radar.at ? `Stand ${clock(radar.at)}` : '',
      radar.lattice ? 'grobes Raster (ca. 6 km)' : 'Raster 1 km',
      radar.partial ? esc(radar.partial) : '',
      radar.error ? `<span class="err-text">${esc(radar.error)}</span>` : '',
      'Vergangene Stunden: INCA-Analyse (Radar und Stationen), nächste 3 Stunden: Nowcast, danach Modell.',
    ]
      .filter(Boolean)
      .join(' · ')
  if (radar.at === shownAt) return
  shownAt = radar.at
  const slider = root.querySelector('.wx-slider')
  slider.max = String(Math.max(0, list.length - 1))
  const cur = currentIndex()
  root.querySelector('.wx-hist').innerHTML = list
    .map((f, i) => {
      const st = frameStats(f)
      const h = st.wetShare < 0.002 ? 0 : Math.max(10, Math.min(100, Math.sqrt(st.wetShare) * 160))
      const snow = st.snowShare > 0.5
      const title = `${dayOf(f.at)} ${clock(f.at)} (${SOURCE[f.kind]}): ${h ? `${Math.max(1, Math.round(st.wetShare * 100))} % nass${snow ? ', Schnee' : ''}` : 'trocken'}`
      return `<button type="button" class="wx-hist-bar ${f.kind} ${i === cur ? 'cur' : ''}" data-i="${i}" title="${esc(title)}" aria-label="${esc(title)}"><span style="height:${h.toFixed(0)}%" class="${snow ? 'snow' : ''}"></span></button>`
    })
    .join('')
  if (radar.bbox && !fitted) {
    map.fit(radar.bbox)
    fitted = true
  }
  map.setMarks(radarMarks())
  select(index >= 0 && index < list.length && play ? index : cur)
}

/** Nach dem Zeichnen der Ansicht: Karte einhängen, Daten laden, Zeitgeber starten. */
export function mountRadar() {
  const slot = document.querySelector('.wx-radar-slot')
  if (!slot) return stopRadar()
  if (!root) build()
  if (root.parentElement !== slot) slot.append(root)
  map.draw()
  refreshControls()
  loadRadar({ aspect: aspect(), onDone: () => root && document.contains(root) && refreshControls() })
  if (!ticker)
    ticker = setInterval(() => {
      if (!root || !document.contains(root)) return stopRadar()
      loadRadar({ aspect: aspect(), onDone: () => document.contains(root) && refreshControls() }) // lädt nur, wenn älter als 10 min
    }, 60e3)
}

/** Ansicht verlassen: nichts mehr laden, nicht mehr abspielen. */
export function stopRadar() {
  clearInterval(ticker)
  ticker = null
  stopPlay()
}

/** Neu laden (Knopf „Aktualisieren“). */
export function reloadRadar() {
  if (!root) return
  fitted = false
  loadRadar({ force: true, aspect: aspect(), onDone: () => document.contains(root) && refreshControls() })
  refreshControls()
}
