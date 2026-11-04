// Niederschlag der nächsten Stunden: Nowcast und Radarbild (GeoSphere Austria,
// Data Hub, CC BY 4.0). Rein rechnend und ohne Netz testbar; das Laden macht
// src/ui/weather.js, das Zeichnen src/ui/weather-map.js.
//
// Quellen (alle 1 km):
//  - Nowcast nowcast-v1-15min-1km: jetzt bis +3 h in 15-Minuten-Schritten,
//    rr (Niederschlag je 15 min, mm), pt (Art: 1 Regen, 3 gefrierender Regen,
//    5 Schnee, 7 Schneeregen, 255 keiner), t2m (°C). Etwa alle 15 min neu,
//    erscheint mit rund einer halben Stunde Verzögerung.
//  - INCA-Analyse inca-v1-1h-1km (historical): die letzten Stunden, RR (mm je
//    Stunde) und T2M (°C) – Messungen von Radar und Stationen.
//  - Modell nwp-v2-1h-1km (C-LAEF): danach stündlich, tp (mm je Stunde) und sf (Schnee).
//
// Das Radarbild kommt als Gitter (grid, bbox) oder – wenn GeoSphere das Gitter
// nicht liefert – als Zeitreihen an einem Raster von Punkten (timeseries mit
// mehreren lat_lon). Beides wird hier auf ein gleichmäßiges Raster in Grad
// gebracht, das die Karte gestreckt über die Fläche legt.

const API = 'https://dataset.api.hub.geosphere.at/v1'
export const NOWCAST_RESOURCE = 'nowcast-v1-15min-1km'
export const INCA_RESOURCE = 'inca-v1-1h-1km'
export const MODEL_RESOURCE = 'nwp-v2-1h-1km'

/** Parameter je Quelle (wetter.php lässt genau diese zu). */
export const RADAR_SOURCES = {
  nowcast: { resource: NOWCAST_RESOURCE, mode: 'forecast', params: ['rr', 'pt'], points: ['rr', 'pt', 't2m'], step: 15 },
  inca: { resource: INCA_RESOURCE, mode: 'historical', params: ['RR', 'T2M'], step: 60 },
  modell: { resource: MODEL_RESOURCE, mode: 'forecast', params: ['tp', 'sf'], step: 60 },
}

// Österreich samt Rand (Gitter von INCA/Nowcast); größere Ausschnitte lehnt wetter.php ab
export const AUSTRIA = { s: 45.8, w: 9.0, n: 49.4, e: 17.6 }
const MAX_SPAN = { lat: 1.6, lon: 2.4 }
// so weit wird höchstens auf die Form der Karte erweitert (Datenmenge: etwa 100 × 130 Punkte)
const FIT_SPAN = { lat: 1.1, lon: 1.8 }

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const pad = (n) => String(n).padStart(2, '0')
/** Zeit für start/end der API: „JJJJ-MM-TTThh:mm“ in UTC. */
export const apiTime = (ms) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
const hourFloor = (ms) => Math.floor(ms / 3600e3) * 3600e3

/**
 * Ausschnitt für die Karte: alle Orte plus Rand, auf Österreich begrenzt und
 * nicht größer als MAX_SPAN (sonst wird die Antwort zu groß). Auf 0,05° gerundet,
 * damit der Zwischenspeicher am Webspace greift.
 */
export function radarBbox(points, { marginLat = 0.3, marginLon = 0.45, aspect = 0 } = {}) {
  const list = (points || []).filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
  if (!list.length) return null
  const lats = list.map((p) => Number(p.lat))
  const lons = list.map((p) => Number(p.lon))
  let s = Math.min(...lats) - marginLat
  let n = Math.max(...lats) + marginLat
  let w = Math.min(...lons) - marginLon
  let e = Math.max(...lons) + marginLon
  // in der Form der Karte (Breite : Höhe in Pixeln), damit sie ganz mit Daten gefüllt ist; nur erweitern
  if (aspect > 0) {
    const k = Math.cos((((s + n) / 2) * Math.PI) / 180) // Web-Mercator: 1° Länge = cos(Breite) × 1° Breite
    const ratio = ((e - w) * k) / (n - s)
    if (ratio < aspect) {
      const lon = Math.min(FIT_SPAN.lon, (aspect * (n - s)) / k)
      if (lon > e - w) [w, e] = [(w + e) / 2 - lon / 2, (w + e) / 2 + lon / 2]
    } else {
      const lat = Math.min(FIT_SPAN.lat, ((e - w) * k) / aspect)
      if (lat > n - s) [s, n] = [(s + n) / 2 - lat / 2, (s + n) / 2 + lat / 2]
    }
  }
  // zu groß: um die Mitte auf das Höchstmaß kürzen
  const shrink = (a, b, max) => {
    if (b - a <= max) return [a, b]
    const mid = (a + b) / 2
    return [mid - max / 2, mid + max / 2]
  }
  ;[s, n] = shrink(s, n, MAX_SPAN.lat)
  ;[w, e] = shrink(w, e, MAX_SPAN.lon)
  const r = (x) => Math.round(x * 20) / 20
  s = r(Math.max(AUSTRIA.s, s))
  n = r(Math.min(AUSTRIA.n, n))
  w = r(Math.max(AUSTRIA.w, w))
  e = r(Math.min(AUSTRIA.e, e))
  return n > s && e > w ? { s, w, n, e } : null
}
export const bboxText = (b) => `${b.s},${b.w},${b.n},${b.e}`

/** Gleichmäßiges Raster von Punkten im Ausschnitt (für Zeitreihen statt Gitter). */
export function latticePoints(bbox, n = 12) {
  const out = []
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) out.push({ lat: Math.round((bbox.s + ((bbox.n - bbox.s) * (i + 0.5)) / n) * 1e4) / 1e4, lon: Math.round((bbox.w + ((bbox.e - bbox.w) * (j + 0.5)) / n) * 1e4) / 1e4 })
  return out
}

/** Zeitraum je Quelle: INCA die letzten 3 Stunden, Modell ab +3 h für 6 Stunden (überschneidet sich mit dem Nowcast, doppelte Bilder fallen weg). */
export function radarWindow(source, now = Date.now()) {
  if (source === 'inca') return { start: apiTime(hourFloor(now) - 3 * 3600e3), end: apiTime(hourFloor(now)) }
  if (source === 'modell') return { start: apiTime(hourFloor(now) + 3 * 3600e3), end: apiTime(hourFloor(now) + 9 * 3600e3) }
  return null
}

/** Adresse bei GeoSphere: Gitter (bbox) oder Zeitreihen an Punkten. */
export function radarUrl(source, { bbox, points = null, now = Date.now() }) {
  const src = RADAR_SOURCES[source]
  const win = radarWindow(source, now)
  const q = [`parameters=${src.params.join(',')}`]
  if (points) q.push(...points.map((p) => `lat_lon=${p.lat},${p.lon}`))
  else q.push(`bbox=${bboxText(bbox)}`)
  if (win) q.push(`start=${win.start}`, `end=${win.end}`)
  q.push('output_format=geojson')
  return `${API}/${points ? 'timeseries' : 'grid'}/${src.mode}/${src.resource}?${q.join('&')}`
}

/** Umweg über den eigenen Webspace (wetter.php baut dieselbe Adresse). */
export function radarProxyUrl(source, { bbox, lattice = 0 }) {
  return `wetter.php?art=raster&quelle=${source}&bbox=${bboxText(bbox)}${lattice ? `&raster=${lattice}` : ''}`
}

/** Nowcast an den Orten (Zeitreihe, mehrere Punkte in einer Anfrage). */
export const nowcastUrl = (locs) => `${API}/timeseries/forecast/${NOWCAST_RESOURCE}?${locs.map((l) => `lat_lon=${Number(l.lat)},${Number(l.lon)}`).join('&')}&parameters=${RADAR_SOURCES.nowcast.points.join(',')}&output_format=geojson`
export const nowcastProxyUrl = (locs) => `wetter.php?art=nowcast&punkte=${locs.map((l) => `${Number(l.lat)},${Number(l.lon)}`).join(';')}`

// ---------------------------------------------------------------- Antworten lesen

/**
 * Antwort mit Punkten (GeoJSON: timestamps, features[] mit Point und
 * properties.parameters[name].data[Zeit]) → { times, lat, lon, values: { name: Float32Array je Zeit } }.
 * Fehlende Werte werden NaN.
 */
export function parsePoints(json, params) {
  const times = (json?.timestamps || []).map((t) => Date.parse(t))
  const feats = Array.isArray(json?.features) ? json.features : null
  if (!times.length || !feats?.length || times.some((t) => !Number.isFinite(t))) throw new Error('Unerwartete Antwort (Niederschlag)')
  const n = feats.length
  const lat = new Float32Array(n)
  const lon = new Float32Array(n)
  const values = Object.fromEntries(params.map((p) => [p, times.map(() => new Float32Array(n).fill(NaN))]))
  let any = false
  feats.forEach((f, i) => {
    const c = f?.geometry?.coordinates
    lon[i] = num(c?.[0]) ?? NaN
    lat[i] = num(c?.[1]) ?? NaN
    const ps = f?.properties?.parameters || {}
    for (const p of params) {
      const data = ps[p]?.data
      if (!Array.isArray(data)) continue
      any = true
      for (let t = 0; t < times.length; t++) {
        const v = num(data[t])
        if (v !== null) values[p][t][i] = v
      }
    }
  })
  if (!any) throw new Error('Antwort ohne Niederschlagswerte')
  return { times, lat, lon, values, reference: json.reference_time ? Date.parse(json.reference_time) : null }
}

// Art des Niederschlags (Raster): 0 keiner, 1 Regen, 2 Schnee, 3 Schneeregen, 4 gefrierender Regen
export const KIND = { none: 0, rain: 1, snow: 2, sleet: 3, freezing: 4 }
const PT = { 1: KIND.rain, 3: KIND.freezing, 5: KIND.snow, 7: KIND.sleet, 255: KIND.none }
const kindFromTemp = (t) => (Number.isFinite(t) ? (t <= 0.5 ? KIND.snow : t <= 1.5 ? KIND.sleet : KIND.rain) : KIND.rain)

/** Nowcast an den Orten → je Ort Schritte [{ at, rate (mm/h), kind, t }]. */
export function parseNowcast(json) {
  const p = parsePoints(json, RADAR_SOURCES.nowcast.points)
  const out = []
  for (let i = 0; i < p.lat.length; i++) {
    out.push({
      lat: p.lat[i],
      lon: p.lon[i],
      steps: p.times.map((at, t) => {
        const rr = p.values.rr[t][i]
        const pt = p.values.pt[t][i]
        const temp = p.values.t2m[t][i]
        const rate = Number.isFinite(rr) ? Math.max(0, rr) * 4 : null
        let kind = Number.isFinite(pt) && PT[Math.round(pt)] !== undefined ? PT[Math.round(pt)] : rate ? kindFromTemp(temp) : KIND.none
        if (rate !== null && rate < WET && kind !== KIND.none && !Number.isFinite(pt)) kind = KIND.none
        return { at, rate, kind, t: Number.isFinite(temp) ? Math.round(temp * 10) / 10 : null }
      }),
    })
  }
  return { reference: p.reference, points: out }
}

const WET = 0.1 // ab so viel mm/h gilt es als Niederschlag

const KIND_WORD = { [KIND.rain]: 'Regen', [KIND.snow]: 'Schneefall', [KIND.sleet]: 'Schneeregen', [KIND.freezing]: 'gefrierender Regen' }
/** Stärke wie bei Wetterdiensten: Regen leicht < 2,5 mm/h, mäßig < 7,6; Schnee leicht < 1, mäßig < 2,5 (mm Wasser). */
export function intensity(rate, kind) {
  if (!rate || rate < WET) return ''
  const [a, b] = kind === KIND.snow ? [1, 2.5] : [2.5, 7.6]
  return rate < a ? 'leicht' : rate < b ? 'mäßig' : 'stark'
}
const clock = (ms) => new Date(ms).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' })
const round5 = (min) => Math.max(5, Math.round(min / 5) * 5)

/**
 * Hinweis für die nächsten Stunden an einem Ort aus den Nowcast-Schritten:
 * { state: 'now'|'soon'|'dry'|'unknown', kind, inMinutes, untilMinutes, text, short }.
 * Schritte, die schon vorbei sind (Nowcast erscheint verspätet), zählen nicht.
 */
export function nowcastHint(steps, now = Date.now()) {
  const list = (steps || []).filter((s) => s.at + 15 * 60e3 > now && s.rate !== null)
  if (!list.length) return { state: 'unknown', text: 'Kein Nowcast verfügbar', short: '' }
  const wet = (s) => s.rate >= WET && s.kind !== KIND.none
  const horizon = Math.round((list.at(-1).at + 15 * 60e3 - now) / 60e3)
  const first = list.find(wet)
  const hours = Math.max(1, Math.round(horizon / 60))
  if (!first) return { state: 'dry', inMinutes: null, horizonMinutes: horizon, text: hours === 1 ? 'Trocken in der nächsten Stunde' : `Trocken in den nächsten ${hours} Stunden`, short: 'trocken' }
  const startIdx = list.indexOf(first)
  let endIdx = startIdx
  while (endIdx + 1 < list.length && wet(list[endIdx + 1])) endIdx++
  const run = list.slice(startIdx, endIdx + 1)
  const peak = run.reduce((m, s) => (s.rate > m.rate ? s : m), run[0])
  // häufigste Art im Abschnitt (Schnee vor Regen, wenn gleich oft)
  const counts = new Map()
  for (const s of run) counts.set(s.kind, (counts.get(s.kind) || 0) + 1)
  const kind = [...counts].sort((a, b) => b[1] - a[1] || (b[0] === KIND.snow) - (a[0] === KIND.snow))[0][0]
  const word = KIND_WORD[kind] || 'Niederschlag'
  const strength = intensity(peak.rate, kind)
  const label = `${strength ? `${strength === 'stark' ? 'Starker' : strength === 'mäßig' ? 'Mäßiger' : 'Leichter'} ` : ''}${word}`
  const endsAt = endIdx + 1 < list.length ? list[endIdx + 1].at : null
  if (first.at <= now) {
    const until = endsAt ? `, hört ca. ${clock(endsAt)} auf` : `, hält mindestens bis ${clock(list.at(-1).at + 15 * 60e3)} an`
    return { state: 'now', kind, inMinutes: 0, untilMinutes: endsAt ? Math.round((endsAt - now) / 60e3) : null, peak: peak.rate, text: `Jetzt ${label.replace(/^(Leichter|Mäßiger|Starker) /, (m) => m.toLowerCase())}${until}`, short: `jetzt ${word}` }
  }
  const inMin = round5((first.at - now) / 60e3)
  return { state: 'soon', kind, inMinutes: inMin, untilMinutes: endsAt ? Math.round((endsAt - now) / 60e3) : null, peak: peak.rate, text: `${label} ab ca. ${clock(first.at)} (in ${inMin} Min.)`, short: `${word} in ${inMin} Min.` }
}

// ---------------------------------------------------------------- Radarbild

/** Raster in Grad aus Punkten: Zelle je Punkt, Lücken (Lambert-Gitter) mit Nachbarn gefüllt. */
export function rasterFor(points, { bbox, cellLat, cellLon }) {
  const w = Math.max(1, Math.round((bbox.e - bbox.w) / cellLon))
  const h = Math.max(1, Math.round((bbox.n - bbox.s) / cellLat))
  const index = new Int32Array(w * h).fill(-1)
  for (let i = 0; i < points.lat.length; i++) {
    const x = Math.floor((points.lon[i] - bbox.w) / cellLon)
    const y = Math.floor((bbox.n - points.lat[i]) / cellLat)
    if (x >= 0 && x < w && y >= 0 && y < h) index[y * w + x] = i
  }
  // Lücken: nächster gefüllter Nachbar (1 Zelle), sonst bleibt leer
  const filled = index.slice()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (index[y * w + x] >= 0) continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const xx = x + dx
        const yy = y + dy
        if (xx >= 0 && xx < w && yy >= 0 && yy < h && index[yy * w + xx] >= 0) {
          filled[y * w + x] = index[yy * w + xx]
          break
        }
      }
    }
  return { w, h, index: filled, bbox }
}

/**
 * Bilder des Radars aus den drei Quellen (je { points, lattice } oder null):
 * vergangene Stunden (INCA), jetzt bis +3 h (Nowcast), danach Modell.
 * Liefert [{ at, kind: 'past'|'now'|'nowcast'|'model', source, rate: Float32Array (mm/h), type: Uint8Array, raster }].
 */
export function radarFrames({ inca = null, nowcast = null, modell = null }, { bbox, now = Date.now() }) {
  const frames = []
  const add = (src, at, kind, rateOf, typeOf) => {
    const n = src.points.lat.length
    const rate = new Float32Array(n)
    const type = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const r = rateOf(i)
      rate[i] = Number.isFinite(r) ? Math.max(0, r) : 0
      type[i] = rate[i] >= WET ? typeOf(i) : KIND.none
    }
    frames.push({ at, kind, source: src.name, rate, type, raster: src.raster })
  }
  const prep = (src, name) => {
    if (!src) return null
    const cell = src.lattice ? { cellLat: (bbox.n - bbox.s) / src.lattice, cellLon: (bbox.e - bbox.w) / src.lattice } : { cellLat: 1 / 111.2, cellLon: 1 / (111.2 * Math.cos((((bbox.s + bbox.n) / 2) * Math.PI) / 180)) }
    return { ...src, name, raster: rasterFor(src.points, { bbox, ...cell }) }
  }
  const nc = prep(nowcast, 'Nowcast')
  const firstNowcast = nc ? nc.points.times.find((t) => t + 15 * 60e3 > now) : null
  const pi = prep(inca, 'INCA')
  if (pi) {
    pi.points.times.forEach((at, t) => {
      if (at > now || (firstNowcast && at >= firstNowcast)) return
      const v = pi.points.values
      add(pi, at, 'past', (i) => v.RR[t][i], (i) => kindFromTemp(v.T2M[t][i]))
    })
  }
  if (nc) {
    const v = nc.points.values
    nc.points.times.forEach((at, t) => {
      if (at + 15 * 60e3 <= now) return
      add(nc, at, at <= now ? 'now' : 'nowcast', (i) => v.rr[t][i] * 4, (i) => {
        const pt = v.pt[t][i]
        return Number.isFinite(pt) && PT[Math.round(pt)] ? PT[Math.round(pt)] : KIND.rain
      })
    })
  }
  const lastShown = frames.length ? frames.at(-1).at : now
  const pm = prep(modell, 'Modell')
  if (pm) {
    const v = pm.points.values
    pm.points.times.forEach((at, t) => {
      if (at <= lastShown + 30 * 60e3) return
      add(pm, at, 'model', (i) => v.tp[t][i], (i) => {
        const share = v.tp[t][i] > 0 && Number.isFinite(v.sf[t][i]) ? v.sf[t][i] / v.tp[t][i] : 0
        return share >= 0.7 ? KIND.snow : share >= 0.2 ? KIND.sleet : KIND.rain
      })
    })
  }
  frames.sort((a, b) => a.at - b.at)
  // „jetzt“: das Bild, das gerade gilt
  if (!frames.some((f) => f.kind === 'now') && frames.length) {
    const cur = frames.filter((f) => f.at <= now).at(-1)
    if (cur) cur.current = true
  }
  return frames
}

// Farben wie bei Radar-Apps: Regen hellblau → blau → grün → gelb → rot → violett, Schnee lila, gefrierend pink
const RAIN_SCALE = [
  [0.1, [130, 200, 255, 150]],
  [0.5, [70, 160, 245, 185]],
  [1, [30, 110, 225, 205]],
  [2, [20, 170, 80, 215]],
  [5, [240, 205, 0, 225]],
  [10, [255, 135, 0, 235]],
  [20, [225, 30, 30, 240]],
  [50, [170, 20, 150, 245]],
]
const SNOW_SCALE = [
  [0.1, [215, 205, 255, 165]],
  [0.5, [185, 160, 255, 195]],
  [1, [150, 115, 245, 215]],
  [2.5, [120, 70, 225, 230]],
  [5, [90, 30, 190, 240]],
]
const SLEET = [255, 120, 200, 210]
const FREEZING = [240, 40, 140, 235]

/** Farbe [r, g, b, a] für Stärke (mm/h) und Art; keiner: null. */
export function rateColor(rate, type) {
  if (!rate || rate < WET || !type) return null
  if (type === KIND.freezing) return FREEZING
  if (type === KIND.sleet) return SLEET
  const scale = type === KIND.snow ? SNOW_SCALE : RAIN_SCALE
  let c = scale[0][1]
  for (const [min, col] of scale) if (rate >= min) c = col
  return c
}

/** Legende für die Karte. */
export const LEGEND = {
  rain: RAIN_SCALE.map(([min, c]) => ({ min, color: `rgb(${c[0]} ${c[1]} ${c[2]})` })),
  snow: SNOW_SCALE.map(([min, c]) => ({ min, color: `rgb(${c[0]} ${c[1]} ${c[2]})` })),
  sleet: `rgb(${SLEET.slice(0, 3).join(' ')})`,
  freezing: `rgb(${FREEZING.slice(0, 3).join(' ')})`,
}

/** RGBA-Pixel eines Bilds (für ein Canvas in Rastergröße). */
export function framePixels(frame) {
  const { w, h, index } = frame.raster
  const px = new Uint8ClampedArray(w * h * 4)
  for (let k = 0; k < w * h; k++) {
    const i = index[k]
    if (i < 0) continue
    const c = rateColor(frame.rate[i], frame.type[i])
    if (!c) continue
    px[k * 4] = c[0]
    px[k * 4 + 1] = c[1]
    px[k * 4 + 2] = c[2]
    px[k * 4 + 3] = c[3]
  }
  return px
}

/** Höchster Wert und Anteil nasser Fläche eines Bilds (für die Beschriftung). */
export function frameStats(frame) {
  let max = 0
  let wet = 0
  let snow = 0
  for (let i = 0; i < frame.rate.length; i++) {
    if (frame.rate[i] >= WET && frame.type[i]) {
      wet++
      if (frame.type[i] === KIND.snow) snow++
      if (frame.rate[i] > max) max = frame.rate[i]
    }
  }
  return { max: Math.round(max * 10) / 10, wetShare: frame.rate.length ? wet / frame.rate.length : 0, snowShare: wet ? snow / wet : 0 }
}
