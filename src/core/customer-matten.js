// Mattenwechsel im Kundenbereich (kunden.php): Lieferscheine und nächster Wechsel je Liegeplatz, je Link einschaltbar.
//
// Lieferscheine: festgeschriebene, nicht stornierte Lieferscheine aus dem Mattenwechsel (Belege der Fakturierung,
// kind 'lieferschein', source.type 'matten', core/matten-lieferschein.js) der gewählten Kunden an den Objekten des Links,
// der letzten Monate. Der Webspace bekommt je Lieferschein nur Nummer, Datum, Uhrzeit, Objekt, Liegeplätze mit Matten
// und Mengen, wer unterschrieben hat (Name und Funktion bzw. „ohne Unterschrift“ mit Grund) und dasselbe PDF wie beim
// Versand (ohne Preise). Nie Preise, Beträge, Artikelnummern, Unterschrift als Bild, Fahrer oder Belege anderer Kunden.
//
// Nächster Mattenwechsel: je aktivem Liegeplatz der gewählten Kunden an den Objekten des Links nur der Tag (aus dem
// Fälligkeitsrechner core/matten-plan.js mit den Einsätzen und dem Stand der Touren wie in der Büro-Übersicht).
//
// Einstellung je Link: link.show.lieferscheine, link.show.mattenwechsel, link.deliveryNotes { customerIds, months }
// (deliveryNoteSettings in core/customer-portal.js). Rein rechnend, ohne Netz testbar (test/customer-matten.test.js).
// Oberfläche: ui/views/customer-portal.js (Dialog, Übertragen), ui/views/invoicing-online.js (PDF).

import { sinceDate } from './customer-invoices.js'
import { intact, isCancelled, lineType, parseNumber } from './invoicing.js'
import { isMattenNote } from './matten-abrechnung.js'
import { planSettings } from './matten-einsaetze.js'
import { noteFileName } from './matten-lieferschein.js'
import { nextDue } from './matten-plan.js'
import { doneOf, jobsWithTours } from './matten-uebersicht.js'

export { NOTE_MONTHS, NOTE_MONTH_CHOICES, suggestNoteCustomers } from './customer-portal.js'

/** Dateiname am Webspace: „lieferschein-LS-2026-000123.pdf“ (keine Namen in der Adresse). */
export function noteFile(d) {
  const nr = String(d?.number || '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `lieferschein-${nr || 'beleg'}.pdf`
}
/** Gleiches Muster in kunden.php (LS_MUSTER). */
export const NOTE_FILE_PATTERN = /^lieferschein-[A-Za-z0-9-]{1,40}\.pdf$/

const text = (v) => String(v ?? '').trim()
const cut = (v, n) => text(v).slice(0, n)
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const byName = (a, b) => String(a || '').localeCompare(String(b || ''), 'de', { numeric: true })

/**
 * Lieferscheine für einen Link: festgeschrieben (Nummer, Prüfsumme passt), aus dem Mattenwechsel, nicht storniert, Kunde
 * unter customerIds und Objekt unter objectIds (beides nötig: an einem Objekt können zwei Kunden Liegeplätze haben), Tag
 * in den letzten months Monaten. Neueste zuerst.
 */
export function portalNotes(docs = [], { customerIds = [], objectIds = [], months = 13, today } = {}) {
  const ids = new Set(customerIds)
  const objs = new Set(objectIds)
  if (!ids.size || !objs.size) return []
  const from = sinceDate(today, months)
  return (docs || [])
    .filter((d) => isMattenNote(d) && intact(d) && !isCancelled(d, docs) && ids.has(d.customerId) && objs.has(d.objectId) && isDate(d.date) && d.date >= from && d.date <= today)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)))
}

/** Text für die Signatur am Webspace: ändert sich nur mit dem Beleg (Prüfsumme), nicht mit Versand oder Ablage. */
export const noteSigText = (d) => JSON.stringify(['ls1', d.id, d.number, d.checksum || '', d.date || ''])

/**
 * Liegeplätze eines Lieferscheins aus seinen Positionen: Titel „Liegeplatz …“, darunter je Mattentyp Text und Menge
 * (ohne Preis), „Nicht gewechselt: …“ als Hinweis. [{ name, matten: [{ text, menge }], hinweise: [Text] }].
 */
export function notePlaces(doc) {
  const out = []
  let cur = null
  const group = (name) => {
    cur = { name, matten: [], hinweise: [] }
    out.push(cur)
    return cur
  }
  for (const l of doc?.lines || []) {
    const type = lineType(l)
    if (type === 'title') group(cut(String(l.text || '').replace(/^Liegeplatz\s+/, ''), 120) || 'Liegeplatz')
    else if (type === 'item') {
      const qty = Math.max(0, Math.round(parseNumber(l.qty)))
      ;(cur || group('Liegeplatz')).matten.push({ text: cut(l.text, 120) || 'Matte', menge: qty })
    } else if (type === 'text' && text(l.text)) (cur || group('Liegeplatz')).hinweise.push(cut(l.text, 160))
  }
  return out.filter((p) => p.matten.length || p.hinweise.length).slice(0, 30)
}

/** Wer bestätigt hat: { name, funktion } bzw. { ohne: true, grund } (ohne Bild der Unterschrift). */
export function noteSigner(doc) {
  const r = doc?.receipt
  if (!r) return null
  if (r.unsigned || !text(r.name)) return { ohne: true, grund: cut(r.reason, 120) || 'ohne Angabe' }
  return { name: cut(r.name, 80), funktion: cut(r.role, 60) }
}

/**
 * Was der Webspace je Lieferschein speichert (aktion=speichern, Liste „lieferscheine“). Keine Preise, keine Beträge,
 * keine Artikelnummern, kein Fahrer, keine Unterschrift als Bild: die stehen (außer den Preisen) im PDF.
 */
export function noteEntry(d, { sig = '' } = {}) {
  const time = text(d?.source?.time)
  return {
    datei: noteFile(d),
    nummer: cut(d.number, 40),
    datum: d.date || '',
    zeit: /^\d{2}:\d{2}$/.test(time) ? time : '',
    objekt: cut(d.objectName, 120),
    liegeplaetze: notePlaces(d),
    unterschrift: noteSigner(d),
    name: noteFileName(d),
    sig,
  }
}

/**
 * Nächster Mattenwechsel je Liegeplatz für einen Link: aktive Liegeplätze der Kunden customerIds an den Objekten
 * objectIds, je der Tag laut Fälligkeitsrechner (gespeicherte Einsätze mit dem Stand der Touren, bestätigte Wechsel,
 * Pausen, Betriebsurlaub). Nur der Tag, keine Uhrzeit, kein Fahrer; ohne Termin (Pause ohne Ende) nicht dabei.
 * doc: matten/matten.json; tours: gelesene Touren (sonst nur die gespeicherten Einsätze). Nach Tag, Objekt, Liegeplatz.
 */
export function nextExchanges({ doc, jobs = [], tours = [], customerIds = [], objectIds = [], today, objectsById = new Map() } = {}) {
  const ids = new Set(customerIds)
  const objs = new Set(objectIds)
  if (!ids.size || !objs.size || !isDate(today)) return []
  const placements = doc?.placements || []
  const { closures, skip } = planSettings(doc)
  const eff = jobsWithTours(jobs || [], tours || [])
  const done = doneOf(placements, tours || [])
  const objName = (id) => (objectsById instanceof Map ? objectsById.get(id)?.name : objectsById?.[id]?.name) || ''
  return placements
    .filter((p) => p?.id && p.active !== false && ids.has(p.customerId) && objs.has(p.objectId))
    .map((p) => ({ p, next: nextDue(p, { done, jobs: eff, closures, skip, today }) }))
    .filter((x) => isDate(x.next?.date))
    .map(({ p, next }) => ({ datum: next.date, objekt: cut(objName(p.objectId), 120), liegeplatz: cut(`${text(p.name) || 'Liegeplatz'}${text(p.floor) ? ` (${text(p.floor)})` : ''}`, 120) }))
    .sort((a, b) => a.datum.localeCompare(b.datum) || byName(a.objekt, b.objekt) || byName(a.liegeplatz, b.liegeplatz))
    .slice(0, 100)
}
