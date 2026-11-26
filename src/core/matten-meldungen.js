// Mattenwechsel: Meldungen der Fahrer aus dem Stopp (Schaden, fehlende Matte, Beschwerde des Kunden …) und ihre
// Bearbeitung im Büro – als Reklamation anlegen (Modul Reklamationen, core/complaints.js) oder erledigt. Reine Funktionen
// ohne Oberfläche (Tests: test/matten-meldungen.test.js); Fahrer: ui/views/matten-fahrer.js, Büro:
// ui/views/matten-uebersicht.js und „Zu erledigen“ (ui/views/matten-kalender.js).
//
// Gespeichert:
//  - am Stopp der Tour (die Tour schreibt der Fahrer): stops[].reports [{ id, kind, placementId, placementName, text, at, by }]
//  - im Büro (matten/matten.json): reportsHandled { [id]: { state: 'erledigt', at, by, note? } }
//  - eine Reklamation aus der Meldung trägt ref 'mw-report:<id>' (reklamationen/reklamationen.json); wer die Reklamationen
//    liest, sieht die Meldung als „Reklamation angelegt“, sonst gilt nur reportsHandled.

import { updateStop } from './matten-fahrt.js'

export const REPORT_KINDS = {
  schaden: 'Matte beschädigt',
  fehlt: 'Matte fehlt',
  verschmutzt: 'Matte stark verschmutzt (Öl, Farbe)',
  kunde: 'Beschwerde des Kunden',
  zugang: 'Zugang oder Schlüssel',
  sonstiges: 'Sonstiges',
}
/** Art der Reklamation (core/complaints.js KINDS) je Art der Meldung. */
const COMPLAINT_KIND = { schaden: 'Schaden', fehlt: 'Schaden', verschmutzt: 'Sonstiges', kunde: 'Sonstiges', zugang: 'Schlüssel / Sicherheit', sonstiges: 'Sonstiges' }
/** Quelle der Reklamation (core/complaints.js SOURCES). */
export const REPORT_SOURCE = 'Mattenwechsel (Fahrer)'
export const REPORT_REF = 'mw-report:'
/** Ohne Text nur, wenn die Art schon alles sagt (Matte beschädigt bzw. fehlt am gewählten Liegeplatz). */
const NEEDS_TEXT = new Set(['verschmutzt', 'kunde', 'zugang', 'sonstiges'])

const text = (v) => String(v ?? '').trim()
const dmy = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '')
export const reportId = (random = (n) => crypto.getRandomValues(new Uint8Array(n))) => `mr${[...random(6)].map((b) => b.toString(16).padStart(2, '0')).join('')}`

/** Fehler der Meldung als Text oder ''. */
export function reportProblem({ kind, placementId = '', text: t = '' } = {}) {
  if (!Object.hasOwn(REPORT_KINDS, kind || '')) return 'Bitte wählen, was passiert ist.'
  if ((kind === 'schaden' || kind === 'fehlt') && !placementId && !text(t)) return 'Bitte den Liegeplatz wählen oder kurz beschreiben.'
  if (NEEDS_TEXT.has(kind) && text(t).length < 3) return 'Bitte kurz beschreiben, was los ist.'
  if (text(t).length > 1000) return 'Bitte kürzer (höchstens 1000 Zeichen).'
  return ''
}

/**
 * Meldung am Stopp (Kopie der Tour). Geht auch nach dem Abschluss des Stopps (ändert Lieferschein und Wechsel nicht).
 * { kind, placementId?, text?, id?, now, by }
 */
export function addReport(tour, stopId, { kind, placementId = '', text: t = '', id = reportId(), now = new Date().toISOString(), by = '' } = {}) {
  const problem = reportProblem({ kind, placementId, text: t })
  if (problem) throw new Error(problem)
  return updateStop(
    tour,
    stopId,
    (s) => {
      const item = (s.items || []).find((it) => it.placementId === placementId)
      if (placementId && !item) throw new Error('Liegeplatz nicht im Stopp.')
      const r = { id, kind, ...(placementId ? { placementId, placementName: text(item.placementName) } : {}), text: text(t), at: now, by }
      return { ...s, reports: [...(s.reports || []), r] }
    },
    { now, by, keepStatus: true, force: true },
  )
}

/** Meldung zurücknehmen (nur am offenen Stopp; danach bleibt sie für das Büro stehen). */
export function removeReport(tour, stopId, id, opts = {}) {
  return updateStop(tour, stopId, (s) => ({ ...s, reports: (s.reports || []).filter((r) => r.id !== id) }), { ...opts, keepStatus: true })
}

/** Fotos des Liegeplatzes im Stopp (für die Meldung im Büro). */
const photosOf = (stop, placementId) => (placementId ? (stop.items || []).filter((it) => it.placementId === placementId).flatMap((it) => it.photos || []) : (stop.items || []).flatMap((it) => it.photos || []))

/**
 * Alle Meldungen der Touren, neueste zuerst: [{ id, tourId, date, driverName, stopId, customerId, customerName, objectId,
 * objectName, address, placementId, placementName, kind, kindLabel, text, at, by, photos }].
 */
export function reportsOf(tours = []) {
  const out = []
  for (const t of tours || []) {
    for (const s of t?.stops || []) {
      for (const r of s.reports || []) {
        out.push({
          id: r.id,
          tourId: t.id,
          date: t.date || '',
          driverName: t.driverName || '',
          stopId: s.id,
          customerId: s.customer?.id || '',
          customerName: s.customer?.name || '',
          objectId: s.objectId || '',
          objectName: s.objectName || '',
          address: s.address || '',
          placementId: r.placementId || '',
          placementName: r.placementName || '',
          kind: r.kind,
          kindLabel: REPORT_KINDS[r.kind] || r.kind,
          text: r.text || '',
          at: r.at || '',
          by: r.by || '',
          photos: photosOf(s, r.placementId),
        })
      }
    }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.id.localeCompare(b.id))
}

/**
 * Stand einer Meldung: { state: 'offen' | 'reklamation' | 'erledigt', complaintId?, complaintStatus?, at?, by? }.
 * complaints: Reklamationen (null = nicht lesbar); handled: reportsHandled aus matten.json.
 */
export function reportState(report, { handled = {}, complaints = null } = {}) {
  const c = (complaints || []).find((x) => x?.ref === `${REPORT_REF}${report.id}`)
  if (c) return { state: 'reklamation', complaintId: c.id, complaintStatus: c.status || 'offen' }
  const h = handled?.[report.id]
  if (h?.state === 'erledigt') return { state: 'erledigt', at: h.at || '', by: h.by || '', ...(h.note ? { note: h.note } : {}) }
  return { state: 'offen' }
}

/** Offene Meldungen (weder Reklamation noch erledigt), neueste zuerst. */
export const openReports = (tours, opts = {}) => reportsOf(tours).filter((r) => reportState(r, opts).state === 'offen')

/** Meldung im Büro erledigt (Kopie von reportsHandled). */
export function markReportDone(handled = {}, id, { now = new Date().toISOString(), by = '', note = '' } = {}) {
  return { ...(handled || {}), [id]: { state: 'erledigt', at: now, by, ...(text(note) ? { note: text(note) } : {}) } }
}

/** „Erledigt“ zurücknehmen (Kopie). */
export function reopenReport(handled = {}, id) {
  const next = { ...(handled || {}) }
  delete next[id]
  return next
}

/** Vorlage für die Reklamation aus einer Meldung (Modul Reklamationen): Objekt, Tag, Quelle, Art, Text, ref. */
export function complaintDraft(report) {
  const where = report.placementName ? ` (${report.placementName})` : ''
  const detail = report.text ? `: ${report.text}` : ''
  const who = [report.by || report.driverName ? `gemeldet von ${report.by || report.driverName}` : '', report.date ? `Mattenwechsel am ${dmy(report.date)}` : ''].filter(Boolean).join(', ')
  return {
    objectId: report.objectId || '',
    date: report.date || '',
    source: REPORT_SOURCE,
    kind: COMPLAINT_KIND[report.kind] || 'Sonstiges',
    text: `${report.kindLabel || REPORT_KINDS[report.kind] || 'Meldung'}${where}${detail}${who ? ` (${who})` : ''}`,
    contact: report.customerName || '',
    ref: `${REPORT_REF}${report.id}`,
  }
}
