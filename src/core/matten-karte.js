// Mattenwechsel: Daten für die Karte der Touren eines Tages – rein rechnend, ohne Oberfläche
// (Tests: test/matten-karte.test.js). Je Tour eine Farbe, die Stopps in Fahrreihenfolge mit Nummer, der Betriebshof
// und eine Linie von Stopp zu Stopp (Luftlinie – die Fahrstrecke selbst zeigt „Route in Google Maps ansehen“).
// Die Karte zeichnet ui/matten-karte.js mit der Kachelkarte des Wetter-Radars (ui/weather-map.js).

import { hasCoords } from './geo.js'
import { isFinal, orderedStops } from './matten-fahrt.js'

/** Farben der Touren (weiße Schrift darauf mit Kontrast über 4,5 : 1). */
export const TOUR_COLORS = ['#1d5fd0', '#c2410c', '#0f7b4a', '#8b2fc9', '#b4126b', '#5b6470']

const point = (o) => ({ lat: o.lat, lon: o.lon })

/**
 * tours: Touren eines Tages; depot: Betriebshof aus den Einstellungen (Rückfall, wenn die Tour keinen trägt).
 * Liefert { marks, paths, legend, missing, bbox }:
 *   marks   [{ kind: 'depot' | 'stopp', lat, lon, text (Nummer bzw. „B“), color, title, tourId?, stopId?, done? }]
 *   paths   [{ tourId, color, points: [{ lat, lon }] }] – Betriebshof → Stopps in Reihenfolge → Betriebshof
 *   legend  [{ tourId, color, label (Fahrer), stops, placed (mit Koordinaten) }]
 *   missing [{ tourId, stopId, n, name }] – Stopps ohne Koordinaten (stehen nicht auf der Karte)
 *   bbox    { n, s, w, e } mit etwas Rand oder null (nichts zu zeigen)
 */
export function tourMapData(tours = [], { depot = null } = {}) {
  const marks = []
  const paths = []
  const legend = []
  const missing = []
  const depots = new Map()
  ;(tours || []).forEach((t, i) => {
    const color = TOUR_COLORS[i % TOUR_COLORS.length]
    const home = hasCoords(t?.route?.depot) ? t.route.depot : hasCoords(depot) ? depot : null
    const line = []
    if (home) {
      line.push(point(home))
      depots.set(`${home.lat},${home.lon}`, home)
    }
    const driver = t?.driverName || 'ohne Fahrer'
    let n = 0
    let placed = 0
    for (const s of orderedStops(t)) {
      n++
      const name = s.customer?.name || s.objectName || 'Stopp'
      if (!hasCoords(s)) {
        missing.push({ tourId: t.id, stopId: s.id, n, name })
        continue
      }
      placed++
      line.push(point(s))
      marks.push({
        kind: 'stopp',
        lat: s.lat,
        lon: s.lon,
        text: String(n),
        color,
        tourId: t.id,
        stopId: s.id,
        done: isFinal(s),
        title: `${n}. ${name}${s.objectName && s.objectName !== name ? ` · ${s.objectName}` : ''}${s.times?.arrival ? `, ca. ${s.times.arrival} Uhr` : ''} (${driver})`,
      })
    }
    if (home && line.length > 1) line.push(point(home))
    if (line.length > 1) paths.push({ tourId: t.id, color, points: line })
    legend.push({ tourId: t.id, color, label: driver, stops: n, placed })
  })
  const depotMarks = [...depots.values()].map((d) => ({ kind: 'depot', lat: d.lat, lon: d.lon, text: 'B', title: `Betriebshof${d.name ? `: ${d.name}` : ''}${d.address ? `, ${d.address}` : ''}` }))
  const all = [...depotMarks, ...marks]
  return { marks: all, paths, legend, missing, bbox: bboxOf(all) }
}

/** Ausschnitt um die Punkte mit Rand (mindestens rund 400 m), null ohne Punkte. */
export function bboxOf(points = []) {
  const list = (points || []).filter(hasCoords)
  if (!list.length) return null
  const lats = list.map((p) => p.lat)
  const lons = list.map((p) => p.lon)
  const span = (min, max, least) => Math.max(max - min, least)
  const dLat = span(Math.min(...lats), Math.max(...lats), 0.004) * 0.12
  const dLon = span(Math.min(...lons), Math.max(...lons), 0.006) * 0.12
  const mid = (min, max, least) => (max - min >= least ? [min, max] : [(min + max) / 2 - least / 2, (min + max) / 2 + least / 2])
  const [s, n] = mid(Math.min(...lats), Math.max(...lats), 0.004)
  const [w, e] = mid(Math.min(...lons), Math.max(...lons), 0.006)
  return { n: n + dLat, s: s - dLat, w: w - dLon, e: e + dLon }
}
