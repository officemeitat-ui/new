// Wetter für Winterdienst und Hitzeschutz: Vorhersage und amtliche Warnungen
// von GeoSphere Austria (Data Hub, CC BY 4.0, auch gewerblich nutzbar).
//
//  - Vorhersage: C-LAEF 1 km, stündlich, rund 60 Stunden (nwp-v2-1h-1km; das
//    frühere AROME-Modell nwp-v1 endet am 4.11.2026). Parameter: 2t (Temperatur),
//    tp/rain (Niederschlag), sf (Schneefall, je Stunde), 10fg (Böen).
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
// Parameter-Sätze: erst alles, bei Ablehnung schrittweise weniger (Namen können sich ändern)
export const FORECAST_PARAMS = [['2t', 'tp', 'sf', '10fg'], ['2t', 'tp', 'sf'], ['2t', 'tp']]
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
    // Summen seit Modellstart (alte Namen *_acc): in Werte je Stunde umrechnen
    if (/_acc$/.test(name)) data = data.map((v, i) => (v === null ? null : Math.max(0, v - (i && data[i - 1] !== null ? data[i - 1] : 0))))
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
  return times.map((ts, i) => ({
    at: Date.parse(ts),
    t: t?.[i] ?? null,
    precip: precip?.[i] ?? null,
    snow: snow?.[i] ?? null, // mm Wasser je Stunde ≈ cm Neuschnee
    gust: gust?.[i] ?? null,
  })).filter((h) => Number.isFinite(h.at))
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
  pauseHours: 8, // ein Ort meldet sich höchstens so oft neu (außer die Warnstufe steigt)
  quietFrom: '', // Ruhezeit (optional), Warnung orange/rot weckt trotzdem
  quietTo: '',
  sender: '', // Absender der E-Mails (z. B. winterdienst@firma.at)
  emailLevel1: false, // Stufe 1 zusätzlich per E-Mail (nachts weckt die nicht)
  officeEmails: '', // Stufe 2: weitere E-Mail-Adressen, mit Komma getrennt
  places: {}, // je Ort: { active, level1: [Personen], level2: [Personen] }
  topics: {}, // je Person und fürs Büro („office“): ntfy-Thema
}

/** Personen, die an einem Ort Winterdienst haben (Teams der Objekte), und die Objekte selbst. */
export function winterAt(place, objects, locations) {
  const here = (objects || []).filter((o) => o.winter?.active && locationFor(o, locations)?.name === place.name)
  return { objects: here, team: [...new Set(here.flatMap((o) => o.winter.team || []))] }
}

/** Einstellungen eines Orts, ohne eigene Auswahl: Stufe 1 = Winterdienst-Teams der Objekte dort. */
export function alarmPlace(alarm, place, objects, locations) {
  const own = alarm?.places?.[place.name]
  return { active: own ? own.active !== false : true, level1: own?.level1 ?? winterAt(place, objects, locations).team, level2: own?.level2 ?? [], rotate: !!own?.rotate }
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
export function alarmFile({ alarm, locations, objects, employees, address }) {
  const a = { ...ALARM_DEFAULTS, ...alarm }
  const person = (id, withEmail) => {
    const e = employees.find((x) => x.id === id)
    if (!e) return null
    const out = { name: e.name }
    if (a.topics?.[id]) out.ntfy = a.topics[id]
    if (withEmail && e.email) out.email = e.email
    return out.ntfy || out.email ? out : null
  }
  const office = [
    ...(a.topics?.office ? [{ name: 'Büro', ntfy: a.topics.office }] : []),
    ...String(a.officeEmails || '').split(/[,;\s]+/).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).map((email) => ({ name: 'Büro', email })),
  ]
  const orte = (locations || [])
    .map((loc) => ({ loc, set: alarmPlace(a, loc, objects, locations) }))
    .filter(({ set }) => set.active)
    .map(({ loc, set }) => ({
      name: loc.name,
      lat: Number(loc.lat),
      lon: Number(loc.lon),
      // mit Kennung und Adresse: das Protokoll am Handy ordnet die Einträge dem Objekt zu
      objekte: winterAt(loc, objects, locations).objects.map((o) => ({ id: o.id, name: o.name, adresse: o.address || '' })),
      ...(set.rotate && set.level1.length > 1 ? { wechsel: 'woche' } : {}),
      stufe1: set.level1.map((id) => person(id, a.emailLevel1)).filter(Boolean),
      stufe2: [...set.level2.map((id) => person(id, true)).filter(Boolean), ...office],
    }))
  return {
    version: 1,
    schluessel: a.key,
    pruefschluessel: a.cronKey,
    adresse: address,
    ntfy: a.ntfy || ALARM_DEFAULTS.ntfy,
    absender: a.sender || '',
    regeln: { vorlaufStunden: Number(a.leadHours), schneeCm: Number(a.snowCm), pauseStunden: Number(a.pauseHours), eskalationMinuten: Number(a.escalateMin), ruheVon: a.quietFrom || '', ruheBis: a.quietTo || '', ruheAusnahmeStufe: 2 },
    orte,
  }
}

/** Was am Alarm noch fehlt (für die Anzeige): Orte ohne Stufe 1, Personen ohne Handy-Thema. */
export function alarmProblems(file) {
  const out = []
  for (const o of file.orte) {
    if (!o.stufe1.length) out.push(`${o.name}: niemand in Stufe 1`)
    else if (!o.stufe1.some((p) => p.ntfy)) out.push(`${o.name}: Stufe 1 ohne Handy (ntfy)`)
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
