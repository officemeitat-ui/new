// Mein Dienstplan: was die Mitarbeitenden am Handy sehen (mein-plan.php am Webspace).
//
// Jede Person bekommt einen persönlichen Code (Link ohne Anmeldung). Die App speichert die
// Codes bei den Regeln (rules.portal.codes), der Webspace kennt nur deren Hashwert (SHA-256).
// Beim Veröffentlichen geht je Person die Woche als kleine JSON-Datei an den Webspace:
// Einsätze mit Zeit, Objekt, Adresse und Hinweisen, Abwesenheit, Feiertag, Stunden und
// Zeitkonto. Anträge (Urlaub, Zeitausgleich, Pflegefreistellung, Krankmeldung) kommen zurück.
//
// Einsatzbörse: offene Einsätze gehen an alle, die sie laut Regeln übernehmen dürfen (dieselbe
// Prüfung wie bei „Vorschlagen“: eingeschult, verfügbar, Ruhezeit, Höchstarbeitszeit, keine
// Abwesenheit). „Ich übernehme“ kommt als Meldung (art „Einsatz“) zurück; eingeteilt wird im Büro.

import { employedInWeek } from './contract.js'
import { addDays, isoWeek } from './dates.js'
import { evaluateCandidate } from './scheduler.js'

export const REQUEST_TYPES = ['Urlaub', 'Zeitausgleich', 'Pflegefreistellung', 'Krankenstand']
export const PORTAL_DEFAULTS = { enabled: false, exchange: true, timeclock: false, alarmMin: 20, key: '', cronKey: '', codes: {}, topics: {}, oldHashes: {}, objectTokens: {}, officeTopic: '', officeEmails: '', sender: '' }

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789' // ohne 0/O, 1/l/I

/** Neuer persönlicher Code: 20 Zeichen aus Buchstaben und Ziffern (rund 117 Bit). */
export function newCode(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const bytes = random(40)
  let code = ''
  for (const b of bytes) {
    if (b >= 228) continue // 228 = 4 × 57: gleich verteilt
    code += ALPHABET[b % ALPHABET.length]
    if (code.length === 20) return code
  }
  return code + newCode(random).slice(code.length)
}

/** SHA-256 als Hex (so speichert der Webspace die Codes). */
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Link für eine Person. */
export const personalLink = (address, code) => `${address.replace(/\/?$/, '/')}mein-plan.php?p=${encodeURIComponent(code)}`

/** Wer in dieser Woche einen Plan bekommt: beschäftigt und mit Code. */
export const portalEmployees = (employees, codes, monday) => employees.filter((e) => codes[e.id] && employedInWeek(e, monday))

const plainText = (text) => String(text || '').replace(/^Objekt: /, '')
const dash = (time) => String(time || '').replace(' - ', '–')

/**
 * Woche einer Person für das Handy aus dem Wochenzettel (buildTimesheet).
 * Minuten wie im Wochenzettel (ist, soll, Zeitkonto).
 */
export function staffWeek(ts, { objectsById = new Map(), account = null } = {}) {
  const line = (l) => {
    const obj = objectsById.get(l.inst?.objectId)
    const notizen = [...(l.notes || [])]
    if (l.kind === 'work' && l.travel > 0) notizen.push(`danach ${l.travel} min Fahrt${l.trip?.to ? ` zu ${objectsById.get(l.trip.to.objectId)?.name || 'nächstem Einsatz'}` : ''}`)
    return {
      id: l.inst?.key || '',
      objektId: l.inst?.objectId || '',
      beginn: l.inst?.startTime || '',
      zeit: dash(l.time),
      objekt: obj?.name || plainText(l.text).split(' – ')[0],
      leistung: l.inst?.label || '',
      adresse: obj?.address || '',
      notizen,
      ...(l.kind === 'missed' ? { entfaellt: true } : {}),
    }
  }
  return {
    kw: isoWeek(ts.monday).week,
    von: ts.monday,
    bis: addDays(ts.monday, 6),
    tage: ts.days.map((d) => ({
      datum: d.date,
      eintraege: d.lines.map(line),
      ...(d.holiday ? { feiertag: d.holiday.name } : {}),
      ...(d.absence ? { abwesend: d.absence.type } : {}),
    })),
    summe: { ist: ts.totals.ist, soll: ts.totals.soll },
    konto: account,
  }
}

/** Übertragung für den Webspace (aktion=speichern): Personen mit Hash, Wochen je Hash. */
export function savePayload(entries) {
  const personen = new Map()
  const wochen = {}
  for (const { hash, name, ntfy, monday, week } of entries) {
    personen.set(hash, { hash, name, ntfy: ntfy || '' })
    ;(wochen[hash] ||= {})[monday] = week
  }
  return { personen: [...personen.values()], wochen }
}

/** Einstellungen für privat/mitarbeiter.json (nur, was der Webspace braucht). */
export function portalFile({ portal, address, ntfy, employees = [], objects = [] }) {
  const buero = []
  if (portal.officeTopic) buero.push({ name: 'Büro-Handy', ntfy: portal.officeTopic })
  for (const email of String(portal.officeEmails || '').split(/[,;\s]+/).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) buero.push({ name: employees.find((e) => e.email === email)?.name || 'Büro', email })
  const file = { version: 1, schluessel: portal.key, adresse: address, ntfy, absender: portal.sender || '', buero }
  // Zeiterfassung: Code je Objekt (steht im QR-Aushang), Prüfschlüssel für den Cronjob
  if (portal.timeclock) {
    const byId = new Map(objects.map((o) => [o.id, o]))
    file.zeiterfassung = { alarmMinuten: Math.max(0, Math.round(Number(portal.alarmMin) || 0)), pruefschluessel: portal.cronKey || '', objekte: Object.fromEntries(Object.entries(portal.objectTokens || {}).filter(([id]) => byId.has(id)).map(([id, token]) => [token, { id, name: byId.get(id).name }])) }
  }
  return file
}

/** Hashwert → Person (aktuelle Codes und ersetzte Links, damit offene Anträge zuordenbar bleiben). */
export async function hashIndex(portal) {
  const index = new Map(Object.entries(portal.oldHashes || {}))
  for (const [empId, code] of Object.entries(portal.codes || {})) index.set(await sha256Hex(code), empId)
  return index
}

const validRequest = (a) => (REQUEST_TYPES.includes(a.art) || ((a.art === 'Einsatz' || a.art === 'Abgabe') && typeof a.einsatz === 'string' && a.einsatz.startsWith(`${a.von}|`))) && /^\d{4}-\d{2}-\d{2}$/.test(a.von) && /^\d{4}-\d{2}-\d{2}$/.test(a.bis)

/** Offene Anträge und Meldungen mit Person, älteste zuerst. */
export function openRequests(list, index) {
  return (list || [])
    .filter((a) => a.status === 'offen' && validRequest(a))
    .map((a) => ({ ...a, employeeId: index.get(a.hash) || null }))
    .sort((a, b) => a.erstellt - b.erstellt)
}

/** Text einer Anfrage, z. B. „Krankmeldung ab Mo 02.11. bis Mi 04.11.“ */
export function requestText(a, formatDate) {
  if (a.art === 'Einsatz') return `übernimmt Einsatz ${formatDate(a.von)} ${a.text || ''}`.trim()
  if (a.art === 'Abgabe') return `möchte abgeben: ${formatDate(a.von)} ${a.text || ''}`.trim()
  const range = a.von === a.bis ? formatDate(a.von) : `${formatDate(a.von)} – ${formatDate(a.bis)}`
  if (a.art === 'Krankenstand') return `Krankmeldung ab ${formatDate(a.von)}${a.bis !== a.von ? `, voraussichtlich bis ${formatDate(a.bis)}` : ''}`
  return `${a.art} ${range}`
}

// ---------------------------------------------------------------- Einsatzbörse

/** Zum Abgeben angeboten: eine eingeteilte Person hat „offered“ (bleibt eingeteilt, bis jemand übernimmt). */
export const offeredBy = (state, key) => state.assigned(key).find((a) => a.offered) || null

/**
 * Einsätze für die Börse von from bis to, frühestens ab notBefore (Minuten): nicht abgesagt und
 * entweder zu wenig Personen oder von jemandem zum Abgeben angeboten.
 */
export function openShifts(instances, state, { from, to, notBefore = -Infinity }) {
  return instances
    .filter((i) => i.status !== 'cancelled' && i.date >= from && i.date <= to && i.start >= notBefore && (state.count(i.key) < (i.staff || 1) || offeredBy(state, i.key)))
    .sort((a, b) => a.start - b.start)
}

/** Angebot fürs Handy. */
export function offerOf(inst, objectsById = new Map()) {
  const obj = objectsById.get(inst.objectId)
  return { id: inst.key, datum: inst.date, zeit: `${inst.startTime}–${inst.endTime}`, objekt: obj?.name || 'Objekt', leistung: inst.label || '', adresse: obj?.address || '', minuten: inst.net }
}

/**
 * Wer welche offenen Einsätze übernehmen dürfte: Map Person → Angebote (höchstens max je Person).
 * Dieselbe Prüfung wie bei den Vorschlägen; Stammkräfte, die abwesend sind, fallen dabei heraus.
 */
export function shiftOffers({ ctx, state, instances, from, to, notBefore, employees, objectsById = new Map(), evaluate = evaluateCandidate, max = 20 }) {
  const out = new Map()
  for (const inst of openShifts(instances, state, { from, to, notBefore })) {
    for (const emp of employees) {
      if (state.has(emp.id, inst.key) || (out.get(emp.id)?.length || 0) >= max) continue
      if (!evaluate(ctx, state, emp, inst).allowed) continue
      if (!out.has(emp.id)) out.set(emp.id, [])
      const swap = state.count(inst.key) >= (inst.staff || 1) && offeredBy(state, inst.key)
      out.get(emp.id).push({ ...offerOf(inst, objectsById), ...(swap ? { tausch: true } : {}) })
    }
  }
  return out
}
