// Fahrzeit aus Adressen: Koordinaten je Objekt (von Hand oder über OpenStreetMap/Nominatim gesucht)
// und eine Schätzung aus der Entfernung. Ohne Routing-Dienst: Luftlinie × Umwegfaktor, geteilt durch
// eine Durchschnittsgeschwindigkeit, plus Zuschlag (Parken, Gehen, Laden), auf 5 Minuten aufgerundet.
// Eine eingetragene Strecke (Regeln → Fahrzeiten) geht immer vor.

export const DETOUR = 1.35 // Straße statt Luftlinie (typisch 1,2–1,4)

/** Entfernung in km (Haversine). */
export function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export const hasCoords = (o) => Number.isFinite(o?.lat) && Number.isFinite(o?.lon)

/** „47.8095, 13.055“ oder „47,8095 13,055“ → { lat, lon } (nur Österreich und Umgebung), sonst null. */
export function parseCoords(text) {
  const m = String(text || '').trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1].replace(',', '.'))
  const lon = Number(m[2].replace(',', '.'))
  return lat >= 45 && lat <= 50 && lon >= 8 && lon <= 18 ? { lat, lon } : null
}

export const coordsText = (o) => (hasCoords(o) ? `${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}` : '')

/**
 * Geschätzte Fahrzeit in Minuten zwischen zwei Objekten mit Koordinaten (sonst null).
 * Gleiche Stelle (unter 100 m): 0 Minuten.
 */
export function estimateTravel(a, b, { speedKmh = 35, baseMin = 5, detour = DETOUR } = {}) {
  if (!hasCoords(a) || !hasCoords(b)) return null
  const km = haversineKm(a, b)
  if (km < 0.1) return { minutes: 0, km: 0 }
  const road = km * detour
  const minutes = Math.ceil((baseMin + (road / Math.max(5, speedKmh)) * 60) / 5) * 5
  return { minutes, km: Math.round(road * 10) / 10 }
}

/** Adresse für die Suche (Österreich). */
export const nominatimUrl = (address) => `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=at&q=${encodeURIComponent(address)}`

/** Antwort von Nominatim → { lat, lon, label } oder null. */
export function parseNominatim(json) {
  const hit = Array.isArray(json) ? json[0] : null
  const lat = Number(hit?.lat)
  const lon = Number(hit?.lon)
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, label: String(hit.display_name || '') } : null
}
