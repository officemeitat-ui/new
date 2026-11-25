// Wetter für Winterdienst und Hitzeschutz: Vorhersage und amtliche Warnungen
// von GeoSphere Austria (Data Hub, CC BY 4.0, auch gewerblich nutzbar).
//
//  - Vorhersage: C-LAEF 1 km, stündlich, rund 60 Stunden (nwp-v2-1h-1km; das
//    frühere AROME-Modell nwp-v1 endet am 4.11.2026). Parameter: 2t (Temperatur),
//    tp/rain (Niederschlag), sf (Schneefall, je Stunde), 10fg (Böen), dazu für
//    die Grafik tcc (Bewölkung), sy (Wettersymbol), snowlmt (Schneefallgrenze),
//    10u/10v (Wind). tp, sf, 10fg und sy gelten für die Stunde, die zum
//    Zeitpunkt endet; Temperatur, Bewölkung und Wind für den Zeitpunkt selbst.
//    Länger als rund 2½ Tage rechnet kein freier GeoSphere-Datensatz voraus.
//  - Warnungen: je Gemeinde (Sturm, Regen, Schnee, Glatteis, Gewitter, Hitze,
//    Kälte; Stufe gelb, orange, rot).
//
// Winterdienst (§ 93 StVO): Gehsteige 6–22 Uhr räumen und bei Glätte streuen.
// Nötig, wenn ab dem Vorabend bis 22 Uhr Neuschnee kommt, Glätte droht
// (Niederschlag bei Frost) oder eine Schnee-/Glatteiswarnung gilt.
// Hitze (Hitzeschutzverordnung, seit 1.1.2026): ab Hitzewarnung gelb müssen
// für Arbeit im Freien die Maßnahmen des Hitzeschutzplans umgesetzt werden.
//
// Alles hier ist rein rechnend und ohne Netz testbar; das Laden macht
// src/ui/weather.js.

import { isLang } from './sprachen.js'
import { waNumber } from './whatsapp.js'

export const WEATHER_DEFAULTS = {
  locations: [{ name: 'Salzburg', lat: 47.8095, lon: 13.055 }],
  snowCm: 1, // Winterdienst ab so viel Neuschnee (ca. 1 mm Wasser = 1 cm Schnee)
  iceTempC: 1, // Glätte möglich: Niederschlag bei höchstens so viel Grad
  heatC: 30, // Hitze-Hinweis aus der Vorhersage, auch ohne amtliche Warnung
  gustKmh: 60, // Böen ab hier: Hinweis für Arbeit im Freien (Glas, Fassade)
  winterUntil: '06:00', // Winterdienst fertig bis (§ 93 StVO: ab 6 Uhr)
  winterMinutes: 45, // Dauer je Objekt, wenn beim Objekt nichts steht
}

export const FORECAST_RESOURCE = 'nwp-v2-1h-1km'
// Parameter-Sätze: erst alles (mit Grafik), bei Ablehnung schrittweise weniger (Namen können sich ändern)
export const FORECAST_PARAMS = [['2t', 'tp', 'sf', '10fg', 'tcc', 'sy', 'snowlmt', '10u', '10v'], ['2t', 'tp', 'sf', '10fg'], ['2t', 'tp', 'sf'], ['2t', 'tp']]
export const forecastUrl = (lat, lon, params = FORECAST_PARAMS[0]) =>
  `https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/${FORECAST_RESOURCE}?lat_lon=${lat},${lon}&parameters=${params.join(',')}`
// Welche Parameter der Datensatz hat (falls sich Namen ändern): …/metadata
export const metadataUrl = () => `https://dataset.api.hub.geosphere.at/v1/timeseries/forecast/${FORECAST_RESOURCE}/metadata`
export const warningsUrl = (lat, lon) => `https://warnungen.zamg.at/wsapp/api/getWarningsForCoords?lon=${lon}&lat=${lat}&lang=de`

export const WARN_TYPES = { 1: 'sturm', 2: 'regen', 3: 'schnee', 4: 'glatteis', 5: 'gewitter', 6: 'hitze', 7: 'kaelte' }
export const WARN_LABEL = { sturm: 'Sturm', regen: 'Starkregen', schnee: 'Schnee', glatteis: 'Glatteis', gewitter: 'Gewitter', hitze: 'Hitze', kaelte: 'Kälte' }
export const WARN_LEVEL = { 1: 'gelb', 2: 'orange', 3: 'rot' }

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const round1 = (x) => Math.round(x * 10) / 10

// ---------------------------------------------------------------- Zeit in Wien

const VIENNA = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** Datum und Stunde in Wien für einen Zeitpunkt: { date: 'JJJJ-MM-TT', hour, minute }. */
export function viennaParts(when) {
  const p = Object.fromEntries(VIENNA.formatToParts(new Date(when)).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) }
}
/** Zeitpunkt (ms) für Datum + Uhrzeit in Wien (Sommer-/Winterzeit beachtet). */
export function viennaTime(date, time = '00:00') {
  const [h, m] = time.split(':').map(Number)
  const guess = Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`)
  // Versatz Wien → UTC an diesem Tag ermitteln (1 oder 2 Stunden)
  for (const offset of [1, 2, 0]) {
    const t = guess - offset * 3600e3
    const v = viennaParts(t)
    if (v.date === date && v.hour === h && v.minute === m) return t
  }
  return guess - 3600e3
}

// ---------------------------------------------------------------- Vorhersage

// Namen je Größe, in dieser Reihenfolge bevorzugt (wetter.php lässt genau diese zu)
export const PARAM_ALIASES = {
  t: ['2t', 't2m'],
  precip: ['tp', 'rain', 'rr', 'rr_acc', 'rain_acc'],
  snow: ['sf', 'snow', 'snow_acc'],
  gust: ['10fg', 'fg10'],
  cloud: ['tcc'],
  symbol: ['sy'],
  snowLimit: ['snowlmt'],
  u: ['10u'],
  v: ['10v'],
}

/** Aus den Metadaten des Datensatzes die passenden Parameter wählen; ohne Temperatur und Niederschlag: null. */
export function pickParams(meta) {
  const list = Array.isArray(meta?.parameters) ? meta.parameters : Object.values(meta?.parameters || {})
  const names = new Set(list.map((p) => (typeof p === 'string' ? p : p?.name)).filter(Boolean))
  const pick = (kind) => PARAM_ALIASES[kind].find((n) => names.has(n))
  const out = ['t', 'precip', 'snow', 'gust'].map(pick)
  return out[0] && out[1] ? out.filter(Boolean) : null
}

function series(parameters, kind) {
  for (const name of PARAM_ALIASES[kind]) {
    const p = parameters?.[name]
    if (!p || !Array.isArray(p.data)) continue
    let data = p.data.map(num)
    // Summen seit Modellstart (alte Namen *_acc): in Werte je Stunde umrechnen (nach einer Lücke ab dem letzten bekannten Stand)
    if (/_acc$/.test(name)) {
      let prev = 0
      data = data.map((v) => {
        if (v === null) return null
        const step = Math.max(0, v - prev)
        prev = v
        return step
      })
    }
    const unit = String(p.unit || '')
    if (kind === 't' && (unit === 'K' || data.some((v) => v !== null && v > 150))) data = data.map((v) => (v === null ? null : v - 273.15))
    if (kind === 'gust' && !/km/.test(unit)) data = data.map((v) => (v === null ? null : v * 3.6)) // m/s → km/h
    // Meter Wasser (m) statt mm/kg m-2: in mm
    if ((kind === 'precip' || kind === 'snow') && /^m$/.test(unit)) data = data.map((v) => (v === null ? null : v * 1000))
    return data
  }
  return null
}

/**
 * Antwort der Data-Hub-Zeitreihe (GeoJSON) → Stunden [{ at (ms), t °C, precip mm, snow cm, gust km/h }].
 * Fehlende Werte bleiben null.
 */
export function parseForecast(json) {
  const times = json?.timestamps
  const params = json?.features?.[0]?.properties?.parameters
  if (!Array.isArray(times) || !params) throw new Error('Unerwartete Antwort der Wettervorhersage')
  const t = series(params, 't')
  const precip = series(params, 'precip')
  const snow = series(params, 'snow')
  const gust = series(params, 'gust')
  // für die Grafik; nur wenn vorhanden (ältere Antworten und der Umweg ohne diese Parameter bleiben gleich)
  const extra = { cloud: series(params, 'cloud'), symbol: series(params, 'symbol'), snowLimit: series(params, 'snowLimit') }
  const u = series(params, 'u')
  const v = series(params, 'v')
  return times
    .map((ts, i) => {
      const h = {
        at: Date.parse(ts),
        t: t?.[i] ?? null,
        precip: precip?.[i] ?? null,
        snow: snow?.[i] ?? null, // mm Wasser je Stunde ≈ cm Neuschnee
        gust: gust?.[i] ?? null,
      }
      for (const [k, list] of Object.entries(extra)) if (list) h[k] = list[i] ?? null
      if (u && v && u[i] !== null && v[i] !== null) {
        h.wind = round1(Math.hypot(u[i], v[i]) * 3.6) // km/h
        h.windFrom = Math.round((Math.atan2(-u[i], -v[i]) * 180) / Math.PI + 360) % 360 // Richtung, aus der der Wind kommt (0 = Nord)
      }
      return h
    })
    .filter((h) => Number.isFinite(h.at))
}

// ---------------------------------------------------------------- Wettersymbol (sy) und Sonne

// Tabelle der Wettersymbole von GeoSphere (dataset-api-docs#30), gruppiert für die Anzeige.
// kind: clear, partly, cloudy, overcast, fog, rain, heavyrain, sleet, snow, shower, snowshower, thunder
const SYMBOL_TABLE = [
  [[1], 'clear', 'Wolkenlos'],
  [[2], 'clear', 'Heiter'],
  [[3], 'partly', 'Wolkig'],
  [[4], 'cloudy', 'Stark bewölkt'],
  [[5], 'overcast', 'Bedeckt'],
  [[6], 'fog', 'Bodennebel'],
  [[7], 'fog', 'Hochnebel'],
  [[8], 'rain', 'Leichter Regen'],
  [[9], 'rain', 'Mäßiger Regen'],
  [[10], 'heavyrain', 'Starker Regen'],
  [[11, 12, 13], 'sleet', 'Schneeregen'],
  [[14], 'snow', 'Leichter Schneefall'],
  [[15], 'snow', 'Mäßiger Schneefall'],
  [[16], 'snow', 'Starker Schneefall'],
  [[17, 18], 'shower', 'Regenschauer'],
  [[19], 'heavyrain', 'Starker Regenschauer'],
  [[20, 21, 22], 'sleet', 'Schneeregenschauer'],
  [[23, 24], 'snowshower', 'Schneeschauer'],
  [[25], 'snow', 'Starker Schneeschauer'],
  [[26, 27], 'thunder', 'Gewitter'],
  [[28], 'thunder', 'Starkes Gewitter'],
  [[29, 30, 31, 32], 'thunder', 'Gewitter mit Schneeregen oder Schnee'],
]
const SYMBOLS = new Map(SYMBOL_TABLE.flatMap(([codes, kind, label]) => codes.map((c) => [c, { code: c, kind, label }])))
// Rangfolge für „das Wetter des Tages“: was man draußen am meisten merkt
export const KIND_RANK = ['clear', 'partly', 'cloudy', 'overcast', 'fog', 'shower', 'rain', 'snowshower', 'sleet', 'heavyrain', 'snow', 'thunder']

/**
 * Wetter einer Stunde: aus dem Symbol von GeoSphere, sonst aus Bewölkung und
 * Niederschlag. { kind, label } oder null (nichts bekannt).
 */
export function weatherKind(h) {
  const sy = h?.symbol !== null && h?.symbol !== undefined ? SYMBOLS.get(Math.round(h.symbol)) : null
  if (sy) return { kind: sy.kind, label: sy.label }
  const p = h?.precip
  if (p !== null && p !== undefined && p >= 0.1) {
    const share = h.snow ? Math.min(1, h.snow / p) : 0
    if (share >= 0.7) return { kind: 'snow', label: p >= 2.5 ? 'Starker Schneefall' : 'Schneefall' }
    if (share >= 0.2) return { kind: 'sleet', label: 'Schneeregen' }
    return p >= 4 ? { kind: 'heavyrain', label: 'Starker Regen' } : { kind: 'rain', label: p >= 1 ? 'Regen' : 'Leichter Regen' }
  }
  const c = h?.cloud
  if (c === null || c === undefined) return p === 0 ? { kind: 'clear', label: 'Trocken' } : null
  if (c < 20) return { kind: 'clear', label: 'Heiter' }
  if (c < 55) return { kind: 'partly', label: 'Wolkig' }
  if (c < 85) return { kind: 'cloudy', label: 'Stark bewölkt' }
  return { kind: 'overcast', label: 'Bedeckt' }
}

const RAD = Math.PI / 180
/**
 * Sonnenaufgang und -untergang (ms) an einem Tag und Ort (Näherung nach NOAA,
 * auf wenige Minuten genau). Polarnacht/-tag kommen in Österreich nicht vor.
 */
export function sunTimes(date, lat, lon) {
  const noon = Date.parse(`${date}T12:00:00Z`)
  const n = Math.round(noon / 86400e3 + 2440587.5 - 2451545.0)
  const jStar = n - lon / 360
  const m = (357.5291 + 0.98560028 * jStar) % 360
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD)
  const lambda = (m + c + 180 + 102.9372) % 360
  const transit = 2451545.0 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD)
  const decl = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD))
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) / (Math.cos(lat * RAD) * Math.cos(decl))
  const w = Math.acos(Math.max(-1, Math.min(1, cosW))) / RAD
  const toMs = (j) => Math.round((j - 2440587.5) * 86400e3)
  return { rise: toMs(transit - w / 360), set: toMs(transit + w / 360) }
}

/** Nacht zu einem Zeitpunkt (Sonne unter dem Horizont)? */
export function isNight(at, lat, lon) {
  const { date } = viennaParts(at)
  const { rise, set } = sunTimes(date, lat, lon)
  return at < rise || at >= set
}

/**
 * Stunden für die Grafik: je Stunde [at, at+1h) Temperatur, Bewölkung und
 * Wind zu Beginn, Niederschlag, Schnee, Böen und Symbol der Stunde (stehen bei
 * GeoSphere am Ende der Stunde). Ab `from` (ms, auf die Stunde abgerundet), höchstens `count` Stunden.
 */
export function hourSlots(hours = [], { from = Date.now(), count = 48 } = {}) {
  const start = Math.floor(from / 3600e3) * 3600e3
  const byAt = new Map(hours.map((h) => [h.at, h]))
  const out = []
  for (const h of hours) {
    if (h.at < start || out.length >= count) continue
    const next = byAt.get(h.at + 3600e3)
    if (!next) break
    out.push({
      at: h.at,
      end: next.at,
      t: h.t,
      cloud: h.cloud ?? null,
      wind: h.wind ?? null,
      windFrom: h.windFrom ?? null,
      snowLimit: h.snowLimit ?? null,
      precip: next.precip,
      snow: next.snow,
      gust: next.gust,
      symbol: next.symbol ?? null,
    })
  }
  return out
}

/**
 * Tage für die Vorhersage-Karten: je Tag Min/Max, Summen, Böen, Warnungen,
 * Wetter des Tages (7–19 Uhr, das Merklichste), Regenstunden, Sonnenzeiten.
 */
export function forecastDays(entry, dates, loc) {
  const slots = hourSlots(entry?.hours || [], { from: 0, count: 1000 })
  return dates.map((date) => {
    const o = dayOutlook(entry || {}, date)
    const from = viennaTime(date, '00:00')
    const day = slots.filter((s) => s.at >= from && s.at < from + 24 * 3600e3)
    const daytime = day.filter((s) => {
      const h = viennaParts(s.at).hour
      return h >= 7 && h < 19
    })
    let best = null
    for (const s of daytime.length ? daytime : day) {
      const k = weatherKind(s)
      if (k && (!best || KIND_RANK.indexOf(k.kind) > KIND_RANK.indexOf(best.kind))) best = k
    }
    const sun = loc ? sunTimes(date, Number(loc.lat), Number(loc.lon)) : null
    // Vorhersage endet vor Tagesende (letzter Tag): bis wann
    const last = day.at(-1)
    const until = last && last.end < from + 23 * 3600e3 ? last.end : null
    return { ...o, kind: best, wetHours: day.filter((s) => (s.precip || 0) >= 0.1).length, hoursKnown: day.length, until, sun }
  })
}

// ---------------------------------------------------------------- Warnungen

/** „31.10.2026 18:00“ (Wien) → ms */
function parseLocal(text) {
  const m = String(text || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/)
  return m ? viennaTime(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, `${m[4].padStart(2, '0')}:${m[5]}`) : null
}

/** Antwort der Warn-API (getWarningsForCoords) → [{ type, level, start, end, text }], nur gelb und höher. */
export function parseWarnings(json) {
  const list = json?.properties?.warnings || json?.warnings || []
  return list
    .map((w) => {
      const p = w?.properties || w || {}
      const raw = p.rawinfo || {}
      const type = WARN_TYPES[Number(p.warntypid ?? raw.wtype)]
      const level = Number(p.warnstufeid ?? raw.wlevel)
      const start = num(raw.start) !== null ? num(raw.start) * 1000 : parseLocal(p.begin)
      const end = num(raw.end) !== null ? num(raw.end) * 1000 : parseLocal(p.end)
      const text = String(p.text || p.meteotext || p.auswirkungen || '').trim()
      return { type, level, start, end, text }
    })
    .filter((w) => w.type && w.level >= 1 && w.level <= 3 && Number.isFinite(w.start) && Number.isFinite(w.end))
    .sort((a, b) => a.start - b.start)
}

export const warningText = (w) => `${WARN_LABEL[w.type]}warnung ${WARN_LEVEL[w.level]}`

// ---------------------------------------------------------------- Auswertung

const overlaps = (w, from, to) => w.start < to && w.end > from

/** Ein Tag (Wien): Temperaturen, Niederschlag, Neuschnee, Böen, gültige Warnungen. */
export function dayOutlook({ hours = [], warnings = [] }, date) {
  const from = viennaTime(date, '00:00')
  const to = from + 24 * 3600e3
  const hs = hours.filter((h) => h.at >= from && h.at < to)
  const ts = hs.map((h) => h.t).filter((v) => v !== null)
  const sum = (k) => round1(hs.reduce((s, h) => s + (h[k] || 0), 0))
  const gusts = hs.map((h) => h.gust).filter((v) => v !== null)
  return {
    date,
    known: hs.length > 0,
    tMin: ts.length ? round1(Math.min(...ts)) : null,
    tMax: ts.length ? round1(Math.max(...ts)) : null,
    precip: sum('precip'),
    snow: sum('snow'),
    gust: gusts.length ? Math.round(Math.max(...gusts)) : null,
    warnings: warnings.filter((w) => overlaps(w, from, to)),
  }
}

/**
 * Winterdienst für den Morgen von `date` nötig? Zeitraum: Vortag 16 Uhr bis
 * `date` 22 Uhr (§ 93 StVO: geräumt und gestreut 6–22 Uhr).
 * Liefert { needed, reasons[], snow, ice, warning }.
 */
export function winterCheck({ hours = [], warnings = [] }, date, cfg = WEATHER_DEFAULTS) {
  const c = { ...WEATHER_DEFAULTS, ...cfg }
  const from = viennaTime(date, '00:00') - 8 * 3600e3
  const to = viennaTime(date, '22:00')
  const hs = hours.filter((h) => h.at >= from && h.at < to)
  const snow = round1(hs.reduce((s, h) => s + (h.snow || 0), 0))
  const iceHour = hs.find((h) => h.t !== null && h.t <= c.iceTempC && (h.precip || 0) >= 0.1 && !(h.snow > 0))
  const official = warnings.filter((w) => (w.type === 'schnee' || w.type === 'glatteis') && overlaps(w, from, to))
  const reasons = []
  if (snow >= c.snowCm) reasons.push(`Neuschnee ca. ${String(snow).replace('.', ',')} cm`)
  if (iceHour) reasons.push(`Glätte möglich (${String(round1(iceHour.t)).replace('.', ',')} °C mit Niederschlag)`)
  for (const w of official) reasons.push(warningText(w))
  return { needed: reasons.length > 0, reasons, snow, ice: !!iceHour, warning: official[0] || null, known: hs.length > 0 || official.length > 0 }
}

/** Hitze an einem Tag: amtliche Warnung (Hitzeschutzverordnung) oder Vorhersage ab `heatC`. */
export function heatCheck(outlook, cfg = WEATHER_DEFAULTS) {
  const c = { ...WEATHER_DEFAULTS, ...cfg }
  const warning = outlook.warnings.filter((w) => w.type === 'hitze').sort((a, b) => b.level - a.level)[0] || null
  return { warning, hot: !!warning || (outlook.tMax !== null && outlook.tMax >= c.heatC), tMax: outlook.tMax }
}

/** Sturm/Gewitter an einem Tag: Warnung oder Böen ab `gustKmh` (Arbeit in der Höhe, Glas, Fassade). */
export function stormCheck(outlook, cfg = WEATHER_DEFAULTS) {
  const c = { ...WEATHER_DEFAULTS, ...cfg }
  const warning = outlook.warnings.filter((w) => w.type === 'sturm' || w.type === 'gewitter').sort((a, b) => b.level - a.level)[0] || null
  return { warning, windy: !!warning || (outlook.gust !== null && outlook.gust >= c.gustKmh), gust: outlook.gust }
}

/** Ort für ein Objekt: eigens gewählter Ort, sonst Ort mit dem Namen des Reviers, sonst der erste Ort. */
export function locationFor(object, locations = WEATHER_DEFAULTS.locations) {
  const list = (locations || []).filter((l) => Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lon)))
  const named = (name) => {
    const n = String(name || '').trim().toLowerCase()
    return n ? list.find((l) => String(l.name || '').trim().toLowerCase() === n) : null
  }
  return named(object?.weatherPlace) || named(object?.region) || list[0] || null
}

// Orte im Land Salzburg (Ortsmitte, gerundet): „Hallein“ genügt, die Koordinaten kommen von hier
export const PLACES = [
  ['Salzburg', 47.8095, 13.055], ['Hallein', 47.6833, 13.097], ['Obertrum am See', 47.9372, 13.0767], ['Seekirchen am Wallersee', 47.8983, 13.1286],
  ['Wals-Siezenheim', 47.7833, 12.9667], ['Grödig', 47.7383, 13.0372], ['Anif', 47.7461, 13.0656], ['Elsbethen', 47.7683, 13.0806],
  ['Bergheim', 47.8333, 13.0333], ['Hallwang', 47.85, 13.0833], ['Eugendorf', 47.8667, 13.1333], ['Koppl', 47.8072, 13.1544],
  ['Thalgau', 47.8333, 13.25], ['Neumarkt am Wallersee', 47.9453, 13.2233], ['Straßwalchen', 47.98, 13.2583], ['Mattsee', 47.9667, 13.1],
  ['Oberndorf bei Salzburg', 47.9447, 12.9411], ['Anthering', 47.8833, 13.0083], ['Puch bei Hallein', 47.7139, 13.0919], ['Oberalm', 47.7, 13.1],
  ['Kuchl', 47.6264, 13.1475], ['Golling an der Salzach', 47.5958, 13.1658], ['Abtenau', 47.5636, 13.3456], ['Fuschl am See', 47.7972, 13.3],
  ['St. Gilgen', 47.7667, 13.3667], ['Bischofshofen', 47.4167, 13.2167], ['St. Johann im Pongau', 47.35, 13.2], ['Radstadt', 47.3833, 13.45],
  ['Zell am See', 47.3256, 12.7969], ['Saalfelden', 47.4269, 12.8483], ['Tamsweg', 47.1281, 13.8108],
].map(([name, lat, lon]) => ({ name, lat, lon }))

/** Ort aus der Liste: genauer Name oder Anfang („Obertrum“ → Obertrum am See), ohne Groß/klein. */
export function findPlace(name) {
  const n = String(name || '').trim().toLowerCase()
  if (!n) return null
  return PLACES.find((p) => p.name.toLowerCase() === n) || PLACES.find((p) => p.name.toLowerCase().startsWith(`${n} `)) || null
}

// ---------------------------------------------------------------- Schnee-Alarm (wetter-alarm.php)

export const ALARM_DEFAULTS = {
  enabled: false,
  ntfy: 'https://ntfy.sh', // Push-Dienst; eigener ntfy-Server möglich
  leadHours: 3, // so weit voraus wecken (Schneefall in den nächsten Stunden)
  snowCm: 0.3, // Schneefall ab so viel je Stunde
  escalateMin: 15, // ohne „Bin wach“ nach so vielen Minuten an Stufe 2
  repeatMin: 3, // bis jemand bestätigt: Push alle so viele Minuten wiederholen (0 = aus; der Cronjob muss so oft laufen)
  repeats: 5, // höchstens so oft wiederholen
  blick: '', // Code der Übersicht „Winterdienst auf einen Blick“ (wetter-alarm.php?aktion=blick&k=…) fürs Haupt-Gerät
  confirmToOffice: true, // Büro-Handy (Stufe 2) bekommt einen Push, sobald jemand „Bin wach“ tippt
  pauseHours: 8, // ein Ort meldet sich höchstens so oft neu (außer die Warnstufe steigt)
  quietFrom: '', // Ruhezeit (optional), Warnung orange/rot weckt trotzdem
  quietTo: '',
  sender: '', // Absender der E-Mails (z. B. winterdienst@firma.at)
  emailLevel1: false, // Stufe 1 zusätzlich per E-Mail (nachts weckt die nicht)
  officeEmails: '', // Stufe 2: weitere E-Mail-Adressen, mit Komma getrennt
  places: {}, // je Ort: { active, level1: [Personen], level2: [Personen] }
  topics: {}, // je Person und fürs Büro („office“): ntfy-Thema
  whatsapp: {}, // je Person: true = zusätzlich per WhatsApp (Nummer aus dem Stammblatt; braucht die Schnittstelle von Meta am Webspace)
  officeWhatsapp: '', // Stufe 2: weitere Nummern für WhatsApp, mit Komma getrennt
  sms: {}, // je Person: true = zusätzlich per SMS (Nummer aus dem Stammblatt; braucht einen SMS-Dienst am Webspace)
  officeSms: '', // Stufe 2: weitere Nummern für SMS, mit Komma getrennt
}

/** Wege für SMS, die der Webspace kennt (webspace-lib.php SMS_ANBIETER), in derselben Reihenfolge. */
export const SMS_PROVIDERS = { handy: 'eigenes Android-Handy (SMS Gateway)', seven: 'seven.io (SMS-Dienst)' }

/**
 * Link zur Seite „Handy einrichten“ (wetter-alarm.php?aktion=handy): App ntfy laden, Thema mit einem Tipp abonnieren,
 * Einstellungen für die Nacht, Probe. In der Sprache der Person (außer Deutsch mit &sprache=).
 */
export const alarmSetupLink = (address, topic, lang = 'de') => `${String(address).replace(/\/?$/, '/')}wetter-alarm.php?aktion=handy&t=${encodeURIComponent(topic)}${lang && lang !== 'de' && isLang(lang) ? `&sprache=${lang}` : ''}`

const SETUP_TEXTS = {
  de: { betreff: 'Winterdienst: Schnee-Alarm aufs Handy', text: 'Hallo {name},\n\nfür den Schnee-Alarm im Winterdienst bitte dein Handy einrichten. Das dauert ein paar Minuten und kostet nichts. Einfach diesen Link öffnen und die Schritte machen:\n{link}\n\nZum Schluss eine Probe schicken und auf „Bin wach“ tippen. Danke!', blatt: 'Handy für den Schnee-Alarm einrichten', scan: 'Mit der Kamera des Handys scannen und die Schritte machen.', geheim: 'Nur für diese Person. Nicht aufhängen.' },
  bks: { betreff: 'Zimska služba: alarm za snijeg na telefonu', text: 'Zdravo, {name},\n\nza alarm za snijeg u zimskoj službi podesi svoj telefon. Traje nekoliko minuta i ništa ne košta. Otvori ovaj link i uradi korake:\n{link}\n\nNa kraju pošalji probu i dodirni „Budan/na sam“. Hvala!', blatt: 'Podesi telefon za alarm za snijeg', scan: 'Skeniraj kamerom telefona i uradi korake.', geheim: 'Samo za ovu osobu. Ne kačiti na zid.' },
  ro: { betreff: 'Deszăpezire: alarma de zăpadă pe telefon', text: 'Bună, {name},\n\npentru alarma de zăpadă te rugăm să îți configurezi telefonul. Durează câteva minute și nu costă nimic. Deschide acest link și urmează pașii:\n{link}\n\nLa final trimite o probă și atinge „Sunt treaz”. Mulțumim!', blatt: 'Configurează telefonul pentru alarma de zăpadă', scan: 'Scanează cu camera telefonului și urmează pașii.', geheim: 'Doar pentru această persoană. Nu se afișează.' },
  tr: { betreff: 'Kış hizmeti: telefonda kar alarmı', text: 'Merhaba {name},\n\nkış hizmetindeki kar alarmı için lütfen telefonunu ayarla. Birkaç dakika sürer ve ücretsizdir. Bu bağlantıyı aç ve adımları yap:\n{link}\n\nSonunda bir deneme gönder ve “Uyanığım”a dokun. Teşekkürler!', blatt: 'Telefonu kar alarmı için ayarla', scan: 'Telefonun kamerasıyla tara ve adımları yap.', geheim: 'Sadece bu kişi için. Asma.' },
  hu: { betreff: 'Téli szolgálat: hóriasztás a telefonon', text: 'Szia {name}!\n\nKérjük, állítsd be a telefonodat a téli szolgálat hóriasztásához. Néhány percig tart, és ingyenes. Nyisd meg ezt a linket, és kövesd a lépéseket:\n{link}\n\nA végén küldj egy próbát, és koppints az „Ébren vagyok” gombra. Köszönjük!', blatt: 'Telefon beállítása a hóriasztáshoz', scan: 'Olvasd be a telefon kamerájával, és kövesd a lépéseket.', geheim: 'Csak ennek a személynek. Ne tedd ki.' },
  en: { betreff: 'Winter service: snow alarm on your phone', text: 'Hello {name},\n\nplease set up your phone for the snow alarm of the winter service. It takes a few minutes and costs nothing. Open this link and follow the steps:\n{link}\n\nAt the end send a test and tap “I am awake”. Thank you!', blatt: 'Set up your phone for the snow alarm', scan: 'Scan with the phone camera and follow the steps.', geheim: 'For this person only. Do not put up.' },
}
export const SETUP_LANGS = Object.keys(SETUP_TEXTS)

/** Einladung „Handy einrichten“ in der Sprache der Person: { subject, text } und die Zeilen fürs Blatt (sheet). */
export function alarmInvite(lang, { name, link }) {
  const t = SETUP_TEXTS[isLang(lang) && SETUP_TEXTS[lang] ? lang : 'de']
  const fill = (x) => x.replace(/\{(\w+)\}/g, (m, k) => (k === 'name' ? String(name || '').split(' ')[0] : k === 'link' ? link : m))
  return { subject: t.betreff, text: fill(t.text), sheet: { title: t.blatt, scan: t.scan, secret: t.geheim } }
}

/**
 * Stand der Handys aus dem Stand des Webspace (handys: Thema → { bestaetigt, probe }): ready (bestätigt), waiting (Probe
 * nach der letzten Bestätigung, noch offen) oder never. at: Zeitpunkt (Unix-Sekunden).
 */
export function phoneState(handys, topic) {
  const h = (handys || {})[topic]
  if (!h) return { state: 'never', at: null }
  if (h.probe && (!h.bestaetigt || h.probe > h.bestaetigt)) return { state: 'waiting', at: h.probe, confirmed: h.bestaetigt || null }
  return h.bestaetigt ? { state: 'ready', at: h.bestaetigt } : { state: 'never', at: null }
}

/**
 * Vorlage für den automatischen WhatsApp-Versand, so legt man sie bei Meta an (WhatsApp-Manager → Nachrichtenvorlagen):
 * zwei Variablen im Text ({{1}} Überschrift, {{2}} Text) und ein Knopf „Website besuchen“, dessen Adresse mit einer
 * Variable endet. Der feste Text lässt sich frei ändern, solange die Variablen bleiben.
 */
export const WHATSAPP_TEMPLATE = {
  name: 'winterdienst_alarm',
  language: 'de',
  version: 'v25.0',
  body: 'Winterdienst-Meldung: {{1}} – {{2}} (automatische Nachricht)',
  button: 'Bin wach',
  samples: ['Winterdienst Salzburg', 'Schneefall ab 04:00 Uhr, ca. 6 cm in 12 h. Objekte: Wohnanlage Lehen. Bitte mit „Bin wach“ bestätigen.', 'a1b2c3d4e5f6a1b2c3d4e5f6'],
}

/** Link zur Übersicht „Winterdienst auf einen Blick“ (ohne Anmeldung, mit dem Code) oder ''. */
export const overviewLink = (address, code) => (/^[a-f0-9]{24}$/.test(code || '') ? `${String(address).replace(/\/?$/, '/')}wetter-alarm.php?aktion=blick&k=${code}` : '')

/** Adresse des Knopfs der Vorlage (endet mit der Variable {{1}}, dort setzt der Server den Bestätigungs-Code ein). */
export const whatsappButtonUrl = (address) => `${String(address).replace(/\/?$/, '/')}wetter-alarm.php?aktion=wach&t={{1}}`

/** Nummern aus einem Feld (Komma, Strichpunkt oder Zeilen) für WhatsApp bzw. SMS: nur brauchbare, jede einmal. */
export const whatsappNumbers = (text) => [...new Set(String(text || '').split(/[,;\n]+/).map((x) => waNumber(x)).filter(Boolean))]

/** Personen, die an einem Ort Winterdienst haben (Teams der Objekte), und die Objekte selbst. */
export function winterAt(place, objects, locations) {
  const here = (objects || []).filter((o) => o.winter?.active && locationFor(o, locations)?.name === place.name)
  return { objects: here, team: [...new Set(here.flatMap((o) => o.winter.team || []))] }
}

/** Einstellungen eines Orts, ohne eigene Auswahl: Stufe 1 = Winterdienst-Teams der Objekte dort. */
export function alarmPlace(alarm, place, objects, locations) {
  const own = alarm?.places?.[place.name]
  const at = winterAt(place, objects, locations)
  // ohne eigene Einstellung: nur Orte mit Winterdienst-Objekten (sonst nächtliche Alarme an niemanden)
  const active = own ? own.active !== false : at.objects.length > 0
  return {
    active,
    level1: own?.level1 ?? at.team,
    level2: own?.level2 ?? [],
    rotate: !!own?.rotate,
    // nur, wenn für den Ort eingestellt: welche Lage weckt, wer welche Alarme bekommt, eigene Regeln
    ...(own?.types ? { types: { ...own.types } } : {}),
    ...(own?.bei && Object.keys(own.bei).length ? { bei: { ...own.bei } } : {}),
    ...(own?.rules && Object.keys(own.rules).length ? { rules: { ...own.rules } } : {}),
  }
}

/** Was an einem Ort wecken kann: Schneefall, Glätte, Warnung von GeoSphere (Schnee, Glatteis). */
export const ALARM_TYPES = { schnee: 'Schneefall', glaette: 'Glätte', warnung: 'Warnung von GeoSphere' }
/** Ort, an dem keine Lage angehakt ist (weckt nie). */
export const noTypes = (set) => !!set?.types && Object.keys(ALARM_TYPES).every((k) => set.types[k] === false)

/** Ausgetreten (Austritt vor heute): der Server weckt sie nicht mehr. */
export const leftCompany = (e, today) => !!(e?.exitDate && e.exitDate < today)

/**
 * Wer am Webspace geweckt bzw. geprüft werden kann: Personen aus Stufe 1 und 2 der eingeschalteten Orte (mit mindestens
 * einer Lage), ohne Ausgetretene. Wie alarmFile, für Einladungen, Proben und die Liste „Handy geprüft“.
 */
export function alarmPeople(alarm, locations, objects, employees, today) {
  const ids = new Set()
  if (alarm?.enabled === false) return ids
  for (const loc of locations || []) {
    const set = alarmPlace(alarm, loc, objects, locations)
    if (!set.active || noTypes(set)) continue
    for (const id of [...set.level1, ...set.level2]) {
      const e = (employees || []).find((x) => x.id === id)
      if (e && !leftCompany(e, today)) ids.add(id)
    }
  }
  return ids
}
/** Welche Alarme eine Person an einem Ort bekommt (leer: alle). */
export const ALARM_FOR = { '': 'alle Alarme', schnee: 'nur Schnee (Räumen)', glaette: 'nur Glätte (Streuen)' }

/** Eigene Regeln eines Orts → Schlüssel des Webspace (nur gesetzte, gültige Werte). */
export function placeRules(rules = {}) {
  const out = {}
  const num = (v, min, max) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.min(max, Math.max(min, Number(v))))
  const time = (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null)
  if (num(rules.leadHours, 1, 12) !== null) out.vorlaufStunden = num(rules.leadHours, 1, 12)
  if (num(rules.snowCm, 0.1, 10) !== null) out.schneeCm = num(rules.snowCm, 0.1, 10)
  if (num(rules.escalateMin, 5, 240) !== null) out.eskalationMinuten = Math.round(num(rules.escalateMin, 5, 240))
  if (time(rules.quietFrom) && time(rules.quietTo)) Object.assign(out, { ruheVon: rules.quietFrom, ruheBis: rules.quietTo })
  return out
}

/**
 * Wöchentlicher Wechsel der Bereitschaft: wer in der Woche von `date` dran ist
 * (Index in Stufe 1). Wechsel montags 0 Uhr, fortlaufend über den Jahreswechsel
 * (wetter-alarm.php rechnet gleich).
 */
export function onCallIndex(date, count) {
  if (!count) return -1
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400e3)
  return (((Math.floor((days + 3) / 7)) % count) + count) % count
}

/**
 * Einstellungen für den Server (privat/wetter-alarm.json): Orte mit Koordinaten,
 * je Stufe die Personen mit ntfy-Thema und E-Mail, Regeln, Schlüssel.
 */
export function alarmFile({ alarm, locations, objects, employees, address, absences = [], today = viennaParts(Date.now()).date }) {
  // Abwesenheiten der nächsten 60 Tage je Person (der Server weckt niemanden, der krank oder auf Urlaub ist)
  const until = new Date(Date.parse(`${today}T12:00:00Z`) + 60 * 86400e3).toISOString().slice(0, 10)
  const away = (id) => absences.filter((a) => a.employeeId === id && a.to >= today && a.from <= until).map((a) => [a.from, a.to])
  const a = { ...ALARM_DEFAULTS, ...alarm }
  const person = (id, withEmail, bei = '') => {
    const e = employees.find((x) => x.id === id)
    // ausgeschieden (Austritt vorbei): nicht mehr wecken, auch wenn noch im Winterteam eingetragen
    if (!e || (e.exitDate && e.exitDate < today)) return null
    const out = { name: e.name }
    if (a.topics?.[id]) out.ntfy = a.topics[id]
    if (withEmail && e.email) out.email = e.email
    // SMS und WhatsApp von selbst (SMS-Dienst bzw. Schnittstelle von Meta am Webspace): nur wer angehakt ist, Nummer aus dem Stammblatt
    if (a.sms?.[id] && waNumber(e.phone)) out.sms = waNumber(e.phone)
    if (a.whatsapp?.[id] && waNumber(e.phone)) out.whatsapp = waNumber(e.phone)
    // Sprache aus dem Stammblatt: Knöpfe der Push-Nachricht, Seiten „Bin wach“ und Protokoll (wetter-alarm.php)
    if (e.lang && e.lang !== 'de') out.sprache = e.lang
    // welche Alarme die Person an diesem Ort bekommt (nur Stufe 1): schnee = Räumen, glaette = Streuen
    if (bei === 'schnee' || bei === 'glaette') out.bei = bei
    const off = away(id)
    if (off.length) out.abwesend = off
    return out.ntfy || out.email || out.sms || out.whatsapp ? out : null
  }
  const office = [
    ...(a.topics?.office ? [{ name: 'Büro', ntfy: a.topics.office }] : []),
    ...String(a.officeEmails || '').split(/[,;\s]+/).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).map((email) => ({ name: 'Büro', email })),
    ...whatsappNumbers(a.officeSms).map((sms) => ({ name: 'Büro', sms })),
    ...whatsappNumbers(a.officeWhatsapp).map((whatsapp) => ({ name: 'Büro', whatsapp })),
  ]
  // ausgeschaltet (Häkchen „Schnee-Alarm ein“ weg): keine Orte, der Server weckt niemanden mehr (Fahrer-Links bleiben)
  const off = alarm?.enabled === false
  const orte = (off ? [] : locations || [])
    .map((loc) => ({ loc, set: alarmPlace(a, loc, objects, locations) }))
    // ein Ort ohne angehakte Lage weckt nie: wie ausgeschaltet
    .filter(({ set }) => set.active && !noTypes(set))
    .map(({ loc, set }) => ({
      name: loc.name,
      lat: Number(loc.lat),
      lon: Number(loc.lon),
      // mit Kennung und Adresse: das Protokoll am Handy ordnet die Einträge dem Objekt zu
      objekte: winterAt(loc, objects, locations).objects.map((o) => ({ id: o.id, name: o.name, adresse: o.address || '' })),
      ...(set.rotate && set.level1.length > 1 ? { wechsel: 'woche' } : {}),
      ...(set.types && Object.keys(ALARM_TYPES).some((k) => set.types[k] === false) ? { arten: Object.keys(ALARM_TYPES).filter((k) => set.types[k] !== false) } : {}),
      ...(Object.keys(placeRules(set.rules)).length ? { regeln: placeRules(set.rules) } : {}),
      stufe1: set.level1.map((id) => person(id, a.emailLevel1, set.rotate ? '' : set.bei?.[id])).filter(Boolean),
      stufe2: [...set.level2.map((id) => person(id, true)).filter(Boolean), ...office],
    }))
  // dauerhafte Protokoll-Links der Fahrer (ohne Alarm) und alle Objekte mit Winterdienst für deren Formular
  const fahrer = alarmDrivers(a, employees, today).filter((d) => !d.gone).map((d) => ({ code: d.code, name: d.name, ...(d.lang && d.lang !== 'de' ? { sprache: d.lang } : {}) }))
  const ortOf = new Map()
  for (const loc of locations || []) for (const o of winterAt(loc, objects, locations).objects) if (!ortOf.has(o.id)) ortOf.set(o.id, loc.name)
  const winterObjekte = (objects || [])
    .filter((o) => o.winter?.active && o.active !== false)
    .map((o) => ({ id: o.id, name: o.name, adresse: o.address || '', ort: ortOf.get(o.id) || '' }))
    .sort((x, y) => x.ort.localeCompare(y.ort, 'de') || x.name.localeCompare(y.name, 'de'))
  return {
    version: 1,
    schluessel: a.key,
    pruefschluessel: a.cronKey,
    adresse: address,
    ntfy: a.ntfy || ALARM_DEFAULTS.ntfy,
    absender: a.sender || '',
    regeln: { vorlaufStunden: Number(a.leadHours), schneeCm: Number(a.snowCm), pauseStunden: Number(a.pauseHours), eskalationMinuten: Number(a.escalateMin), ruheVon: a.quietFrom || '', ruheBis: a.quietTo || '', ruheAusnahmeStufe: 2, wiederholenMinuten: Math.max(0, Number(a.repeatMin ?? ALARM_DEFAULTS.repeatMin) || 0), wiederholungen: Math.max(0, Math.round(Number(a.repeats ?? ALARM_DEFAULTS.repeats) || 0)) },
    orte,
    // Übersicht fürs Haupt-Gerät und Push ans Büro bei jeder Bestätigung
    ...(/^[a-f0-9]{24}$/.test(a.blick || '') ? { blick: a.blick } : {}),
    ...(a.confirmToOffice !== false ? { bestaetigungAnBuero: true } : {}),
    // nur mit Fahrern: ohne sie bleibt die Datei, wie sie war
    ...(fahrer.length ? { fahrer, winterObjekte } : {}),
  }
}

export const DRIVER_CODE = /^[a-f0-9]{24}$/

/**
 * Fahrer mit dauerhaftem Protokoll-Link (alarm.drivers: [{ id, code, name, employeeId? }]): gültige Einträge mit
 * Name (aus dem Stammblatt, wenn verknüpft), Sprache und „gone“ (ausgeschieden: der Link gilt am Webspace nicht mehr).
 */
export function alarmDrivers(alarm, employees = [], today = viennaParts(Date.now()).date) {
  const seen = new Set()
  const out = []
  for (const d of alarm?.drivers || []) {
    if (!d || !DRIVER_CODE.test(d.code || '') || seen.has(d.code)) continue
    const e = d.employeeId ? (employees || []).find((x) => x.id === d.employeeId) : null
    const name = String(e?.name || d.name || '').trim()
    if (!name) continue
    seen.add(d.code)
    out.push({ id: d.id || d.code, code: d.code, name, employeeId: e ? e.id : '', lang: e?.lang || '', phone: e?.phone || '', gone: !!(e?.exitDate && e.exitDate < today) })
  }
  return out
}

/** Adresse des Protokolls am Handy für einen Fahrer. */
export const driverLink = (address, code) => `${String(address || '').replace(/\/?$/, '/')}wetter-alarm.php?aktion=protokoll&f=${code}`

/** Was am Alarm noch fehlt (für die Anzeige): Orte ohne Stufe 1, Personen ohne Handy-Thema. */
export function alarmProblems(file) {
  const out = []
  for (const o of file.orte) {
    if (!o.stufe1.length) out.push(`${o.name}: niemand in Stufe 1`)
    else if (!o.stufe1.some((p) => p.ntfy || p.sms || p.whatsapp)) out.push(`${o.name}: Stufe 1 ohne Handy (ntfy, SMS oder WhatsApp)`)
  }
  if (!file.orte.length) out.push('kein Ort eingeschaltet')
  return out
}

// ---------------------------------------------------------------- Winterdienst-Einsätze

/** Uhrzeit ± Minuten als „HH:MM“ (0–24 Uhr). */
const shift = (time, minutes) => {
  const [h, m] = time.split(':').map(Number)
  const t = Math.max(0, Math.min(24 * 60, h * 60 + m + minutes))
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/**
 * Winterdienst-Einsätze aus den angelegten Aufrufen (data.winter: „Datum|Objekt“ → { reason, … }).
 * Je Objekt mit Winterdienst ein Einsatz, fertig bis `winter.until` (Standard 6 Uhr).
 * make(task, date) wie bei buildInstances.
 */
export function applyWinter(instances, { objects, winter = {}, make, weatherRules = {} }) {
  const c = { ...WEATHER_DEFAULTS, ...weatherRules }
  const byId = new Map(objects.map((o) => [o.id, o]))
  for (const [key, call] of Object.entries(winter)) {
    const [date, objectId] = key.split('|')
    const object = byId.get(objectId)
    if (!object?.winter?.active || call?.cancelled) continue
    const until = /^\d{2}:\d{2}$/.test(object.winter.until || '') ? object.winter.until : c.winterUntil
    const minutes = Number(object.winter.minutes) > 0 ? Number(object.winter.minutes) : c.winterMinutes
    const task = {
      id: `winter-${objectId}`,
      objectId,
      label: 'Winterdienst: räumen und streuen',
      category: 'winter',
      recurrence: { type: 'once', date },
      start: shift(until, -minutes),
      end: until,
      staff: Math.max(1, Number(object.winter.staff) || 1),
      regulars: (object.winter.team || []).slice(),
      skills: [],
      holidayRule: 'findet_statt',
      outdoor: true,
    }
    const inst = make(task, date)
    inst.winterReason = call?.reason || ''
    instances.push(inst)
  }
  return instances
}
