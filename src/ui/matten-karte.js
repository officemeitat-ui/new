// Karte der Touren eines Tages in der Tourenplanung (views/matten-planung.js): Betriebshof, Stopps in Fahrreihenfolge
// mit Nummer, je Tour eine Farbe und eine Linie von Stopp zu Stopp (Daten: core/matten-karte.js). Nutzt die
// Kachelkarte des Wetter-Radars (ui/weather-map.js, ohne Bibliothek) mit der Verwaltungsgrundkarte Österreich
// (basemap.at, CC BY 4.0); config.json → matten.mapTiles: 'osm' stellt auf OpenStreetMap um.

import { tourMapData } from '../core/matten-karte.js'
import { app } from './context.js'
import { esc } from './shared.js'
import { RadarMap, TILE_SOURCES } from './weather-map.js'

const BASEMAP = { url: 'https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png', attribution: 'Karte: <a href="https://basemap.at" target="_blank" rel="noopener">basemap.at</a> (CC BY 4.0)', maxZoom: 18 }
const tiles = () => (app.config?.matten?.mapTiles === 'osm' ? { ...TILE_SOURCES.osm, maxZoom: 17 } : BASEMAP)

let root = null
let map = null
let fitted = ''

/** Platzhalter mit Legende und Hinweis auf Stopps ohne Koordinaten; die Karte hängt mountTourMap danach hinein. */
export function tourMapHtml(tours, { depot = null, date = '' } = {}) {
  const data = tourMapData(tours, { depot })
  queueMicrotask(() => mountTourMap(data, date))
  if (!data.bbox) return '<section class="mw-tp-mapbox"><p class="empty">Noch nichts für die Karte: Die Stopps dieses Tages haben keine Koordinaten („Matten-Liegeplätze“ → „Mehr“ → „Koordinaten für alle fehlenden suchen“).</p></section>'
  const legend = data.legend.map((l) => `<li><i style="background:${esc(l.color)}"></i>${esc(l.label)} <span class="muted">(${l.stops} ${l.stops === 1 ? 'Stopp' : 'Stopps'}${l.placed < l.stops ? `, ${l.placed} auf der Karte` : ''})</span></li>`).join('')
  const missing = data.missing.length ? `<p class="note mw-tp-map-missing">Ohne Koordinaten und daher nicht auf der Karte: ${esc(data.missing.map((m) => `${m.n}. ${m.name}`).join(', '))}.</p>` : ''
  return `<section class="mw-tp-mapbox" aria-label="Karte der Touren">
      <div id="mw-tp-map" class="mw-tp-map" tabindex="0" aria-label="Karte mit Betriebshof und Stopps in Fahrreihenfolge. Ziehen zum Verschieben, Mausrad oder Plus und Minus zum Zoomen."></div>
      <ul class="mw-tp-legend">${legend}<li><i class="depot"></i>Betriebshof</li></ul>
      <p class="muted">Die Linie verbindet die Stopps in Fahrreihenfolge (Luftlinie); die Fahrstrecke zeigt „Route in Google Maps ansehen“ an der Tour.</p>${missing}
    </section>`
}

function mountTourMap(data, date) {
  const slot = document.getElementById('mw-tp-map')
  if (!slot || !data.bbox) return
  if (!root) {
    root = document.createElement('div')
    root.className = 'mw-tp-map-root'
    map = new RadarMap(root, { tiles: tiles() })
    map.setAttribution('')
  }
  if (root.parentElement !== slot) slot.replaceChildren(root)
  map.setPaths(data.paths)
  map.setMarks(data.marks)
  // Ausschnitt nur neu einpassen, wenn sich Tag oder Punkte geändert haben (sonst bleibt, was das Büro gezoomt hat)
  const key = `${date}|${data.marks.map((m) => `${m.lat},${m.lon}`).join(';')}`
  if (key !== fitted) {
    fitted = key
    map.fit(data.bbox, 0.9)
  } else map.draw()
}
