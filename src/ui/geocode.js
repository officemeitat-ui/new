// Koordinaten zu einer Adresse über OpenStreetMap (Nominatim). Nutzungsbedingungen: höchstens eine
// Anfrage pro Sekunde, nur für einzelne Adressen bzw. einmalig für die Objektliste.

import { nominatimUrl, parseNominatim } from '../core/geo.js'

let last = 0

/** Sucht eine Adresse; liefert { lat, lon, label } oder null. Wartet, damit höchstens 1 Anfrage je Sekunde läuft. */
export async function geocode(address) {
  const wait = last + 1100 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  last = Date.now()
  const res = await fetch(nominatimUrl(address), { headers: { Accept: 'application/json', 'Accept-Language': 'de' } })
  if (!res.ok) throw new Error(`OpenStreetMap antwortet ${res.status}`)
  return parseNominatim(await res.json())
}
