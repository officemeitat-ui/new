// Mattenwechsel: Liegeplätze aus einer Excel-Liste lesen (eingefügter Text, Tabulator oder Strichpunkt). Reine Funktion
// ohne Oberfläche (Tests: test/matten-liste.test.js). Das Ergebnis hat die Form der Werkzeug-Datei Standorte.json
// (core/matten-import.js) und geht durch dieselbe Vorschau der Übernahme: Kunden zuordnen, Objekte je Adresse,
// Mattentypen. So lassen sich auch später neue Kunden mit vielen Liegeplätzen auf einmal anlegen.
//
// Spalten (Überschrift, Schreibweise egal): Gebiet, Kunde, Straße, PLZ, Ort, Liegeplatz, Anzahl, Größe, Farbe,
// Intervall (Wochen), Letzter Wechsel, Eigentum, Hinweis. Pflicht sind Kunde und Straße.
//   - Leere Zellen bei Gebiet und Kunde gelten wie die Zeile darüber (in Excel oft nur einmal je Block eingetragen).
//   - Eine Zeile ohne Straße und ohne Liegeplatz ist eine weitere Matte des Liegeplatzes darüber.
//   - „Straße 1, 5020 Salzburg“ in der Spalte Straße wird in Straße, PLZ und Ort zerlegt.
//   - Dieselbe Liste noch einmal einzufügen legt nichts doppelt an: die Kennung entsteht aus Kunde, Adresse und Liegeplatz.
//   - Eine Spalte „Kennung“ (z. B. aus einer von der App vorbereiteten Liste) geht vor: so passt die Liste zu schon
//     übernommenen Liegeplätzen, auch wenn sich Schreibweisen geändert haben.

export const PLACEMENT_TEMPLATE = ['Gebiet', 'Kunde', 'Straße', 'PLZ', 'Ort', 'Liegeplatz', 'Anzahl', 'Größe', 'Farbe', 'Intervall (Wochen)', 'Letzter Wechsel', 'Eigentum', 'Hinweis']

const ALIASES = {
  gebiet: ['gebiet', 'tour', 'tourrunde', 'runde', 'revier', 'region', 'tourgebiet'],
  kunde: ['kunde', 'kundenname', 'firma', 'auftraggeber', 'kundenfirma'],
  strasse: ['strasse', 'adresse', 'anschrift', 'objekt', 'liegenschaft', 'strassehausnummer', 'objektadresse'],
  plz: ['plz', 'postleitzahl'],
  ort: ['ort', 'stadt', 'gemeinde'],
  position: ['liegeplatz', 'position', 'platz', 'eingang', 'stiege', 'lage', 'bezeichnung', 'standort'],
  anzahl: ['anzahl', 'stueck', 'stk', 'menge', 'stueckzahl'],
  groesse: ['groesse', 'format', 'mass', 'masse', 'abmessung', 'mattengroesse'],
  farbe: ['farbe', 'mattenfarbe'],
  intervall: ['intervall', 'intervallwochen', 'rhythmus', 'turnus', 'wechselintervall', 'wochen'],
  letzter: ['letzterwechsel', 'letzter', 'zuletztgewechselt', 'zuletzt', 'letztertausch'],
  eigentum: ['eigentum', 'eigentuemer', 'besitz', 'eigentumder'],
  hinweis: ['hinweis', 'notiz', 'bemerkung', 'anmerkung', 'zugang'],
  kennung: ['kennung', 'liegeplatzkennung', 'liegeplatzid', 'lid'],
  pruefen: ['pruefen', 'zupruefen', 'bittepruefen', 'pruefgrund'],
}

const text = (v) => String(v ?? '').trim()
/** Überschrift vergleichbar machen: klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern. */
export const headKey = (s) =>
  text(s)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '')

const fieldOf = (head) => {
  const k = headKey(head)
  if (!k) return ''
  for (const [field, list] of Object.entries(ALIASES)) if (list.includes(k)) return field
  return ''
}

/** Kurze, stabile Kennung aus dem Inhalt (dieselbe Zeile ergibt dieselbe Kennung). */
function hash(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36).padStart(7, '0')
}
const normKey = (s) => headKey(String(s || '').replace(/stra(ss|ß)e\b/gi, 'str').replace(/str\./gi, 'str'))

/** „4“, „4 Wochen“, „14-tägig“, „28 Tage“, „wöchentlich“, „monatlich“ → Wochen (ganze Zahl ab 1) oder 0. */
export function intervalWeeks(v) {
  const s = text(v).toLowerCase()
  if (!s) return 0
  if (/w(ö|oe)chentlich/.test(s) && !/\d/.test(s)) return 1
  if (/monatlich/.test(s) && !/\d/.test(s)) return 4
  const m = s.match(/(\d+(?:[.,]\d+)?)/)
  if (!m) return 0
  const n = Number(m[1].replace(',', '.'))
  if (!(n > 0)) return 0
  if (/tag|t(ä|ae)gig/.test(s)) return Math.max(1, Math.round(n / 7))
  return Math.max(1, Math.round(n))
}

/** „18.11.2026“, „18.11.26“, „2026-11-18“ → 'JJJJ-MM-TT' oder ''. */
export function listDate(v) {
  const s = text(v)
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) {
    const d = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)
    if (!d) return ''
    m = [null, d[3].length === 2 ? `20${d[3]}` : d[3], d[2].padStart(2, '0'), d[1].padStart(2, '0')]
  }
  const iso = `${m[1]}-${m[2]}-${m[3]}`
  const t = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? '' : iso
}

/** „Musterweg 1, 5020 Salzburg“ → { strasse, plz, ort }; ohne Postleitzahl bleibt alles in strasse. */
export function splitListAddress(v) {
  const s = text(v)
  const m = s.match(/^(.+?)[,;]?\s+(\d{4})\s+(.+)$/)
  return m ? { strasse: text(m[1]), plz: m[2], ort: text(m[3]) } : { strasse: s, plz: '', ort: '' }
}

/**
 * Eingefügte Liste lesen. Liefert
 *   { standorte (Form wie Standorte.json), columns (erkannte Spalten in Reihenfolge), unknown (nicht erkannte
 *     Überschriften), errors [{ line, text }], notes { rows, mats, merged, noInterval, badDates }, problem ('' oder Text,
 *     wenn gar nichts gelesen werden konnte) }.
 */
export function parsePlacementTable(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n')
  const out = { standorte: [], columns: [], unknown: [], errors: [], notes: { rows: 0, mats: 0, merged: 0, noInterval: 0, badDates: 0 }, problem: '' }
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : ';'
  const cells = (l) => l.split(sep).map(text)
  // Überschrift: die erste der ersten 10 Zeilen mit Kunde oder Straße und mindestens zwei bekannten Spalten
  let headAt = -1
  let fields = []
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const f = cells(lines[i]).map(fieldOf)
    if (f.filter(Boolean).length >= 2 && (f.includes('kunde') || f.includes('strasse'))) {
      headAt = i
      fields = f
      break
    }
  }
  if (headAt < 0) {
    out.problem = lines.some((l) => text(l)) ? 'Keine Überschrift erkannt. Die erste Zeile braucht mindestens „Kunde“ und „Straße“ („Vorlage kopieren“ zeigt alle Spalten).' : 'Bitte die Liste aus Excel einfügen.'
    return out
  }
  const heads = cells(lines[headAt])
  out.columns = [...new Set(fields.filter(Boolean))]
  out.unknown = heads.filter((h, i) => h && !fields[i])
  if (!fields.includes('kunde') || !fields.includes('strasse')) {
    out.problem = `Die Spalte „${fields.includes('kunde') ? 'Straße' : 'Kunde'}“ fehlt.`
    return out
  }
  const byId = new Map()
  let prev = null
  let carry = { gebiet: '', kunde: '' }
  for (let i = headAt + 1; i < lines.length; i++) {
    if (!text(lines[i])) continue
    const c = cells(lines[i])
    const row = {}
    fields.forEach((f, k) => {
      if (f && !row[f]) row[f] = c[k] || ''
    })
    if (!Object.values(row).some(Boolean)) continue
    out.notes.rows++
    const mat = row.groesse || row.farbe || row.anzahl ? { anzahl: Math.max(1, Math.round(Number(String(row.anzahl || '').replace(',', '.').match(/[\d.]+/)?.[0]) || 1)), farbe: row.farbe || '', groesse: row.groesse || '', eigentum: /kunde/i.test(row.eigentum || '') ? 'kunde' : 'wir' } : null
    // weitere Matte des Liegeplatzes darüber
    if (!row.strasse && !row.position && !row.kunde && prev && mat) {
      prev.matten.push(mat)
      out.notes.mats++
      continue
    }
    const gebiet = row.gebiet || carry.gebiet
    const kunde = row.kunde || carry.kunde
    // neuer Kunde ohne Gebiet: das Gebiet des vorigen Blocks gilt nur innerhalb desselben Kunden weiter
    carry = { gebiet: row.kunde && !row.gebiet && row.kunde !== carry.kunde ? '' : gebiet, kunde }
    const addr = row.strasse ? splitListAddress(row.strasse) : prev && kunde === prev.kunde ? { strasse: prev.strasse, plz: prev.plz, ort: prev.ort } : { strasse: '', plz: '', ort: '' }
    const s = {
      gebiet: carry.gebiet,
      kunde,
      strasse: addr.strasse,
      plz: row.plz || addr.plz,
      ort: row.ort || addr.ort,
      position: row.position || 'Eingang',
    }
    if (!s.kunde || !s.strasse) {
      out.errors.push({ line: i + 1, text: !s.kunde ? 'Kunde fehlt' : 'Straße fehlt' })
      prev = null
      continue
    }
    const id = row.kennung || `L-x${hash([normKey(s.kunde), normKey(s.strasse), s.plz, normKey(s.ort), normKey(s.position)].join('|'))}`
    let rec = byId.get(id)
    if (rec) out.notes.merged++
    else {
      rec = { id, ...s, matten: [], aktiv: true, quelle: 'Excel-Liste' }
      const weeks = intervalWeeks(row.intervall)
      if (weeks) rec.intervallWochen = weeks
      else out.notes.noInterval++
      if (row.letzter) {
        const d = listDate(row.letzter)
        if (d) rec.letzterWechsel = d
        else {
          out.notes.badDates++
          out.errors.push({ line: i + 1, text: `Datum „${row.letzter}“ nicht lesbar (z. B. 18.11.2026); der Liegeplatz kommt ohne letzten Wechsel` })
        }
      }
      if (row.hinweis) rec.hinweis = row.hinweis
      // Spalte „Prüfen“: der Liegeplatz kommt als „zu prüfen“ markiert herüber, mit dem Text als Grund
      if (row.pruefen) Object.assign(rec, { pruefen: true, pruefGrund: row.pruefen })
      byId.set(id, rec)
      out.standorte.push(rec)
    }
    if (mat) {
      rec.matten.push(mat)
      out.notes.mats++
    }
    prev = rec
  }
  if (!out.standorte.length && !out.problem) out.problem = out.errors.length ? 'Keine Zeile konnte gelesen werden.' : 'Unter der Überschrift steht keine Zeile.'
  return out
}

/** Zusammenfassung für die Anzeige: „12 Liegeplätze mit 15 Matten-Zeilen aus 16 Zeilen“. */
export function listSummary(r) {
  const n = r.standorte.length
  const parts = [`${n} ${n === 1 ? 'Liegeplatz' : 'Liegeplätze'} mit ${r.notes.mats} ${r.notes.mats === 1 ? 'Matten-Zeile' : 'Matten-Zeilen'} aus ${r.notes.rows} ${r.notes.rows === 1 ? 'Zeile' : 'Zeilen'}`]
  const customers = new Set(r.standorte.map((s) => normKey(s.kunde))).size
  const areas = new Set(r.standorte.map((s) => s.gebiet).filter(Boolean)).size
  parts.push(`${customers} ${customers === 1 ? 'Kunde' : 'Kunden'}${areas ? `, ${areas} ${areas === 1 ? 'Gebiet' : 'Gebiete'}` : ''}`)
  if (r.notes.noInterval) parts.push(`${r.notes.noInterval} ohne Intervall (4 Wochen angenommen)`)
  const last = r.standorte.filter((s) => s.letzterWechsel).length
  if (last) parts.push(`${last} mit letztem Wechsel`)
  const noMat = r.standorte.filter((s) => !s.matten.length).length
  if (noMat) parts.push(`${noMat} ohne Matte`)
  return parts.join(' · ')
}
