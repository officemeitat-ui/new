// Geräte & Maschinen aus einer Excel-Liste einfügen (Tabulator wie aus Excel, sonst Strichpunkt), erste Zeile = Überschriften.
// Reine Funktion ohne Browser (test/geraete-import.test.js); Oberfläche: ui/views/geraete.js („Aus Excel einfügen“).
//
// Spalten (Schreibweise egal): Bezeichnung (Pflicht), Art, Hersteller, Modell, Seriennummer, Inventarnummer, Kaufdatum,
// Preis, Standort, Notiz. Ohne Spalte „Art“ wird sie aus der Bezeichnung erraten (z. B. „Kärcher HD 5/15“ → Hochdruckreiniger).
// Schon vorhandene Geräte (gleiche Inventarnummer oder gleiche Bezeichnung samt Seriennummer) kommen nicht doppelt.

import { tableDate } from './trainings.js'

const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const COLS = {
  name: ['bezeichnung', 'name', 'gerat', 'geraet', 'maschine', 'gegenstand', 'inventar', 'beschreibung'],
  type: ['art', 'typ', 'kategorie', 'geratetyp', 'geraeteart', 'gruppe'],
  maker: ['hersteller', 'marke', 'fabrikat'],
  model: ['modell', 'type', 'modellbezeichnung'],
  serial: ['seriennummer', 'serie', 'sn', 'seriennr', 'fabriksnummer'],
  no: ['inventarnummer', 'inventarnr', 'nr', 'nummer', 'invnr'],
  boughtOn: ['kaufdatum', 'gekauftam', 'anschaffung', 'anschaffungsdatum', 'datum'],
  price: ['preis', 'kaufpreis', 'anschaffungswert', 'wert', 'netto'],
  place: ['standort', 'ort', 'lagerort', 'objekt'],
  note: ['notiz', 'bemerkung', 'hinweis', 'anmerkung'],
}
// Art aus der Bezeichnung (Schlüsselwörter → Kennung aus GERAETE_ARTEN)
const GUESS = [
  [/scheuersaug|schrubb|wetrok|reinigungsmaschine|scheuerautomat/i, 'scheuersaug'],
  [/einscheib|nanodisc|poliermaschine/i, 'einscheibe'],
  [/hochdruck|\bhd\s*\d|kärcher hd|karcher hd/i, 'hochdruck'],
  [/sauger|staubsaug|nass.*trocken|nt\s*\d/i, 'sauger'],
  [/sprüh.*extrak|extraktion|teppich|polster|numatic/i, 'teppich'],
  [/kehr/i, 'kehr'],
  [/leiter|tritt/i, 'leiter'],
  [/akku|ladeger/i, 'akku'],
  [/kabel|trommel/i, 'kabel'],
  [/schnee|streu|fräse|fraese|schild/i, 'winter'],
]
export const guessType = (name) => GUESS.find(([re]) => re.test(String(name || '').replace(/_/g, ' ')))?.[1] || 'sonstige'

const money = (v) => {
  const s = String(v ?? '').replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  const n = Number(s)
  return s && Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/**
 * Text → { items: [{ name, typeId, maker, model, serial, no, boughtOn, price, place, note }], skipped: [Text], errors: [Text] }.
 * types: Arten der Datei (id, name) für die Spalte „Art“ (Name oder Kennung); existing: vorhandene Geräte.
 */
export function parseDeviceTable(text, { types = [], existing = [] } = {}) {
  const lines = String(text ?? '').replace(/\r/g, '').split('\n').filter((l) => l.trim())
  const out = { items: [], skipped: [], errors: [] }
  if (lines.length < 2) {
    out.errors.push('Bitte die Überschriften mit einfügen (erste Zeile, z. B. Bezeichnung, Hersteller, Seriennummer).')
    return out
  }
  const sep = lines[0].includes('\t') ? '\t' : ';'
  const head = lines[0].split(sep).map(norm)
  const ix = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]))
  if (ix.name < 0) {
    out.errors.push('Spalte „Bezeichnung“ fehlt in der Überschrift.')
    return out
  }
  const typeOf = (v) => {
    const k = norm(v)
    return k ? types.find((t) => norm(t.id) === k || norm(t.name) === k)?.id || '' : ''
  }
  const seenNo = new Set(existing.map((x) => norm(x.no)).filter(Boolean))
  const seenKey = new Set(existing.map((x) => `${norm(x.name)}|${norm(x.serial)}`))
  for (const line of lines.slice(1)) {
    const c = line.split(sep).map((x) => x.trim().replace(/^"(.*)"$/, '$1'))
    const get = (k) => (ix[k] >= 0 ? c[ix[k]] || '' : '')
    const name = get('name').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!name) continue
    const no = get('no')
    const serial = get('serial')
    if ((no && seenNo.has(norm(no))) || seenKey.has(`${norm(name)}|${norm(serial)}`)) {
      out.skipped.push(name)
      continue
    }
    if (no) seenNo.add(norm(no))
    seenKey.add(`${norm(name)}|${norm(serial)}`)
    out.items.push({ name, typeId: typeOf(get('type')) || guessType(name), maker: get('maker'), model: get('model'), serial, no, boughtOn: tableDate(get('boughtOn')), price: money(get('price')), place: get('place'), note: get('note') })
  }
  return out
}
