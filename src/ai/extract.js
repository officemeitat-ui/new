// KI beim Erfassen: Beleg lesen (Eingangsrechnung), Diktat in Felder (Regiebericht), Antwort auf eine
// Reklamation entwerfen, Mahntext verbessern, Sicherheitsdatenblatt lesen. Je eine Anfrage über ki.php
// (src/ai/client.js), Anfrage und Prüfung der Antwort in core/ki-vorschlag.js (dort getestet).
//
// send(params, { maxTokens }) → Text der Antwort: im Browser die Anfrage über ki.php, in Tests eine Attrappe.
// Ergebnisse sind Vorschläge: geprüft, aber erst die Person übernimmt und speichert sie.

import {
  antwortRequest,
  belegRequest,
  checkAntwort,
  checkBeleg,
  checkDiktat,
  checkFacts,
  checkSdb,
  diktatRequest,
  KI_LIMITS,
  mahnTextRequest,
  parseKiJson,
  pdfPageCount,
  sdbRequest,
  textFacts,
} from '../core/ki-vorschlag.js'

const defaultSend = async (params, opts) => (await import('./client.js')).kiSend(params, opts)

/**
 * Eingangsrechnung lesen. file: { kind: 'image' | 'pdf', mediaType, data (base64) }, ours: { name, uid } der eigenen
 * Firma. Liefert checkBeleg(): { ok, fields, supplier, recipient, problems }.
 */
export async function readBeleg(file, { ours = {}, today = '', send = defaultSend } = {}) {
  const raw = await send(belegRequest(file, { ours, today }), { maxTokens: 16000 })
  return checkBeleg(parseKiJson(raw, 'Die Antwort der KI zum Beleg'), { today, ours })
}

/** Diktat in die Felder des Regieberichts: checkDiktat() mit Zuordnung zu Personen und Lager-Artikeln. */
export async function readDiktat(dictation, { today = '', employees = [], articles = [], send = defaultSend } = {}) {
  if (!String(dictation || '').trim()) throw new Error('Bitte zuerst sprechen oder den Bericht tippen.')
  const raw = await send(diktatRequest(dictation, { today }), { maxTokens: 8000 })
  return checkDiktat(parseKiJson(raw, 'Die Antwort der KI zum Diktat'), { today, employees, articles })
}

/** Antwort auf eine Reklamation entwerfen: { betreff, text, warnings } (Entwurf, nie automatisch gesendet). */
export async function draftComplaintReply(complaint, { send = defaultSend } = {}) {
  if (!String(complaint?.text || '').trim()) throw new Error('Bitte zuerst die Reklamation beschreiben.')
  const raw = await send(antwortRequest(complaint), { maxTokens: 8000 })
  return checkAntwort(parseKiJson(raw, 'Die Antwort der KI'))
}

/**
 * Mahntext verbessern: { text, check: { ok, missing, added } }. facts: Angaben aus den Daten (Rechnungsnummer,
 * Beträge, Frist), die im Text unverändert bleiben müssen. Ist check.ok falsch, darf der Text nicht übernommen werden.
 */
export async function improveReminderText(original, { stage = '', facts = [], send = defaultSend } = {}) {
  if (!String(original || '').trim()) throw new Error('Der Text ist leer.')
  const keep = textFacts(original, facts.filter((f) => String(original).includes(f)))
  const raw = await send(mahnTextRequest(original, { stage, facts: keep }), { maxTokens: 8000 })
  const data = parseKiJson(raw, 'Die Antwort der KI')
  const text = String(data.text || '').trim()
  return { text, check: checkFacts(original, text, facts) }
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * Sicherheitsdatenblatt (PDF als base64) lesen → { produkt, hersteller, signalwort, ghs: ['GHS05', …], hSaetze: [],
 * pSaetze: [], fassung, hinweise: [{ level, text }] }. Prüft vorher Format, Größe und Seitenzahl, danach das
 * Ergebnis (Codes, Signalwort, Gegenproben). Wirft mit lesbarer Meldung.
 */
export async function extractSdb(pdfBase64, { send = defaultSend } = {}) {
  const data = String(pdfBase64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (!data || !B64.test(data)) throw new Error('Kein PDF übergeben.')
  if (!data.startsWith('JVBER')) throw new Error('Die Datei ist kein PDF.')
  const bytes = Math.floor((data.length * 3) / 4)
  if (bytes > KI_LIMITS.pdfBytes) throw new Error(`Das Sicherheitsdatenblatt ist zu groß für die KI (höchstens ${Math.round(KI_LIMITS.pdfBytes / 1048576)} MB).`)
  const pages = pdfPageCount(atob(data))
  if (pages > KI_LIMITS.sdbPages) throw new Error(`Das PDF hat ${pages} Seiten; für die KI höchstens ${KI_LIMITS.sdbPages}.`)
  const raw = await send(sdbRequest(data), { maxTokens: 16000 })
  return checkSdb(parseKiJson(raw, 'Die Antwort der KI zum Sicherheitsdatenblatt'))
}
