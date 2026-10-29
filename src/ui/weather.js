// Wetterdaten im Browser: laden, im Gerät vorhalten, für Planung und Ansicht bereitstellen.
//
// Geladen wird direkt bei GeoSphere Austria. Lässt der Browser das nicht zu
// (CORS) oder ist der Dienst gesperrt, versucht es die App über wetter.php am
// eigenen Webspace (nur diese zwei Adressen, siehe wetter.php). Der letzte
// Stand bleibt im Gerät (localStorage), ohne Netz wird er weiter angezeigt.
// Wetterdaten sind keine Firmendaten: sie liegen nicht in SharePoint.

import { dayOutlook, FORECAST_PARAMS, forecastUrl, heatCheck, locationFor, metadataUrl, parseForecast, parseWarnings, pickParams, stormCheck, warningsUrl, WEATHER_DEFAULTS, winterCheck } from '../core/weather.js'
import { employedOn } from '../core/contract.js'
import { addDays, todayISO } from '../core/dates.js'
import { app, renderNow, touch } from './context.js'

const STORE = 'wetter.v1'
const MAX_AGE = 30 * 60e3
const RETRY = 5 * 60e3 // nach einem Fehler frühestens wieder

export const weatherEnabled = () => app.config?.weather !== false
export const weatherRules = () => ({ ...WEATHER_DEFAULTS, ...(app.data?.rules?.weather || {}) })
export const weatherLocations = () => {
  const list = (weatherRules().locations || []).filter((l) => Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lon)))
  return list.length ? list : WEATHER_DEFAULTS.locations
}
const locKey = (l) => `${Number(l.lat).toFixed(3)},${Number(l.lon).toFixed(3)}`

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}') || {}
  } catch {
    return {}
  }
}
function writeStore(data) {
  try {
    localStorage.setItem(STORE, JSON.stringify(data))
  } catch {
    /* voll oder gesperrt: dann nur im Arbeitsspeicher */
  }
}

/** Stand je Ort: { hours, warnings, at, source, error } */
export const weatherState = () => (app.weather = app.weather || { byLoc: readStore(), tried: {}, loading: false, error: '' })

// je Dienst: hat der direkte Weg versagt, der Umweg aber geklappt, gleich den Umweg nehmen
const viaOnly = new Set()

/** JSON direkt holen, sonst über den eigenen Webspace (wetter.php). 400/404 sind echte Antworten (kein Umweg). */
async function getJson(url, viaWebspace) {
  const host = new URL(url).host
  if (!viaOnly.has(host)) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) return { json: await res.json(), source: 'GeoSphere' }
      if (res.status === 400 || res.status === 404) throw Object.assign(new Error(`Antwort ${res.status}`), { status: res.status })
    } catch (err) {
      if (err.status) throw err
    }
  }
  const res = await fetch(viaWebspace, { cache: 'no-store' }).catch(() => null)
  if (res && (res.status === 400 || res.status === 404) && (res.headers.get('content-type') || '').includes('json')) throw Object.assign(new Error(`Antwort ${res.status}`), { status: res.status })
  if (!res?.ok || !(res.headers.get('content-type') || '').includes('json')) {
    viaOnly.delete(host)
    throw new Error(navigator.onLine === false ? 'kein Netz' : 'Wetterdienst nicht erreichbar')
  }
  viaOnly.add(host)
  return { json: await res.json(), source: 'GeoSphere über den Webspace' }
}

// Parameter, die der Datensatz zuletzt angenommen hat (bei geänderten Namen aus den Metadaten)
let knownParams = null

async function loadLocation(loc) {
  const { lat, lon } = loc
  const ask = (params) => getJson(forecastUrl(lat, lon, params), `wetter.php?art=vorhersage&lat=${lat}&lon=${lon}&parameter=${params.join(',')}`)
  const forecast = (async () => {
    let last
    for (const params of knownParams ? [knownParams] : FORECAST_PARAMS) {
      try {
        const r = await ask(params)
        knownParams = params
        return { hours: parseForecast(r.json), source: r.source }
      } catch (err) {
        last = err
        if (err.status !== 400) throw err // nur bei abgelehnten Parametern weiter versuchen
      }
    }
    // alle abgelehnt: Namen aus den Metadaten des Datensatzes nehmen
    const meta = await getJson(metadataUrl(), 'wetter.php?art=metadaten').catch(() => null)
    const params = pickParams(meta?.json)
    if (!params) throw last
    const r = await ask(params)
    knownParams = params
    return { hours: parseForecast(r.json), source: r.source }
  })()
  const warnings = getJson(warningsUrl(lat, lon), `wetter.php?art=warnungen&lat=${lat}&lon=${lon}`)
    .then((r) => parseWarnings(r.json))
    .catch((err) => (err.status === 404 ? [] : Promise.reject(err))) // außerhalb einer Gemeinde: keine Warnungen
  const [f, w] = await Promise.allSettled([forecast, warnings])
  if (f.status === 'rejected' && w.status === 'rejected') throw f.reason
  return {
    hours: f.status === 'fulfilled' ? f.value.hours : [],
    warnings: w.status === 'fulfilled' ? w.value : [],
    source: f.status === 'fulfilled' ? f.value.source : 'GeoSphere (nur Warnungen)',
    partial: f.status === 'rejected' ? 'Vorhersage fehlt' : w.status === 'rejected' ? 'Warnungen fehlen' : '',
    at: Date.now(),
  }
}

let running = null
/** Wetter für alle Orte laden, wenn älter als 30 min (force: sofort). */
export function refreshWeather({ force = false } = {}) {
  if (!weatherEnabled()) return Promise.resolve()
  if (running) return running
  const st = weatherState()
  const now = Date.now()
  const stale = (l) => !st.byLoc[locKey(l)] || now - (st.byLoc[locKey(l)].at || 0) > MAX_AGE
  const due = weatherLocations().filter((l) => force || (stale(l) && now - (st.tried[locKey(l)] || 0) > RETRY))
  if (!due.length) return Promise.resolve()
  st.loading = true
  running = (async () => {
    const errors = new Map() // Meldung → Orte
    for (const loc of due) {
      st.tried[locKey(loc)] = Date.now()
      try {
        st.byLoc[locKey(loc)] = { ...(await loadLocation(loc)), name: loc.name }
      } catch (err) {
        const msg = err.message || String(err)
        errors.set(msg, [...(errors.get(msg) || []), loc.name])
      }
    }
    st.error = [...errors].map(([msg, names]) => (names.length === due.length && due.length > 1 ? `${msg} (alle Orte)` : `${names.join(', ')}: ${msg}`)).join(' · ')
    writeStore(st.byLoc)
  })().finally(() => {
    st.loading = false
    running = null
    touch() // Planung neu prüfen (Hitze, Sturm)
    renderNow()
  })
  return running
}

/** Wetter für ein Objekt an einem Tag (für die Prüfregel „Wetter“): { outlook, heat, storm, loc } oder null. */
export function weatherFor(objectId, date) {
  if (!weatherEnabled()) return null
  const object = app.data?.objects?.find((o) => o.id === objectId)
  const loc = locationFor(object, weatherLocations())
  const entry = loc && weatherState().byLoc[locKey(loc)]
  if (!entry) return null
  const outlook = dayOutlook(entry, date)
  if (!outlook.known && !outlook.warnings.length) return null
  const cfg = weatherRules()
  return { outlook, heat: heatCheck(outlook, cfg), storm: stormCheck(outlook, cfg), loc }
}

/** Je Ort die Tage heute bis übermorgen und der Winterdienst-Bedarf. */
export function weatherOverview(today = todayISO()) {
  const cfg = weatherRules()
  const st = weatherState()
  const days = [today, addDays(today, 1), addDays(today, 2)]
  return weatherLocations().map((loc) => {
    const entry = st.byLoc[locKey(loc)] || null
    const here = (app.data?.objects || []).filter((o) => locationFor(o, weatherLocations()) === loc)
    const objects = here.filter((o) => o.winter?.active)
    const ids = new Set(here.map((o) => o.id))
    return {
      loc,
      entry,
      objects,
      // Leistungen im Freien in diesem Revier (für die Hinweise bei Hitze und Sturm)
      outdoor: (app.data?.tasks || []).filter((t) => t.outdoor && ids.has(t.objectId)).length,
      days: days.map((date) => {
        const outlook = entry ? dayOutlook(entry, date) : null
        return {
          date,
          outlook,
          winter: entry ? winterCheck(entry, date, cfg) : null,
          heat: outlook ? heatCheck(outlook, cfg) : null,
          storm: outlook ? stormCheck(outlook, cfg) : null,
          objects,
          called: objects.filter((o) => app.data.winter?.[`${date}|${o.id}`] && !app.data.winter[`${date}|${o.id}`].cancelled),
        }
      }),
    }
  })
}

// Für die Prüfregel „Wetter“ (context.js setzt ctx.weather, ohne Kreis-Import)
app.weatherLookup = weatherFor

let timer = null
/** Nach dem Start: laden, alle 30 min und wenn das Netz zurückkommt (nur wer die Einsatzplanung sieht). */
export function startWeather() {
  if (!weatherEnabled() || timer || (app.access && !app.access.sees('planung'))) return
  refreshWeather()
  timer = setInterval(() => refreshWeather(), MAX_AGE)
  window.addEventListener('online', () => refreshWeather())
}

/** Offene Winterdienst-Tage (nötig, aber noch nicht angelegt): für Glocke und Übersicht. */
export function winterOpen(today = todayISO()) {
  if (!weatherEnabled()) return []
  const out = []
  for (const row of weatherOverview(today)) {
    for (const d of row.days) {
      if (!d.winter?.needed || !d.objects.length) continue
      const missing = d.objects.filter((o) => !d.called.includes(o))
      if (missing.length) out.push({ date: d.date, loc: row.loc, reasons: d.winter.reasons, objects: missing })
    }
  }
  return out
}

/** Winterdienst für einen Tag anlegen: je Objekt ein Einsatz, das Winterdienst-Team gleich eingeteilt. */
export function createWinterCalls(date, objects, reason) {
  const { data } = app
  data.winter = data.winter || {}
  data.assignments = data.assignments || {}
  let n = 0
  for (const o of objects) {
    const key = `${date}|${o.id}`
    if (data.winter[key] && !data.winter[key].cancelled) continue
    data.winter[key] = { reason, by: app.user?.name || 'Browser', at: new Date().toISOString() }
    const instKey = `${date}|winter-${o.id}`
    // Team in der eingetragenen Reihenfolge; wer an dem Tag nicht beschäftigt oder abwesend ist, wird übersprungen
    const away = (id) => (data.absences || []).some((a) => a.employeeId === id && date >= a.from && date <= a.to)
    const team = (o.winter?.team || []).filter((id) => {
      const e = data.employees.find((x) => x.id === id)
      return e && employedOn(e, date) && !away(id)
    })
    if (team.length && !(data.assignments[instKey] || []).length) data.assignments[instKey] = team.slice(0, Math.max(1, Number(o.winter.staff) || 1)).map((employeeId) => ({ employeeId }))
    n++
  }
  return n
}

/** Angelegten Winterdienst wieder absagen (z. B. Schnee blieb aus). */
export function cancelWinterCall(date, objectId) {
  const { data } = app
  delete data.winter?.[`${date}|${objectId}`]
  delete data.assignments?.[`${date}|winter-${objectId}`]
}
