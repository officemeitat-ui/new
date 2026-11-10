// Läufe der Fakturierung (wie in orgaMAX): Sammel-Festschreiben und Sammelversand nach dem Monatslauf,
// Mahnlauf mit Mahnsperre, Angebote nachfassen (Wiedervorlage, bald ablaufend, Angebotsquote).
// Rein rechnend, ohne Browser (Oberfläche: ui/views/invoicing-laeufe.js; Lastschrift: core/sepa.js).

import { viennaDate } from './dates.js'
import { blocking, customerName, deDate, finalize, INVOICE_KINDS, isInvoice, openItems, problems, reminderFor, round2, settingsOf, stateOf, termsById, totals } from './invoicing.js'
import { debitNoteFor, inCollection } from './sepa.js'

/** Pause zwischen zwei E-Mails: Exchange Online nimmt höchstens 30 Nachrichten je Minute an. */
export const MAIL_PAUSE_MS = 2100
export const DEFAULT_FOLLOW_UP_DAYS = 7
export const SOON_DAYS = 7

export const emailValid = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim())
/** E-Mail für den Versand: beim Beleg, sonst beim Kunden (Rechnungs-E-Mail). */
export const mailTo = (doc, customer) => String(doc?.recipient?.email || customer?.email || '').trim()

const recName = (d) => String(d.recipient?.name || '')
const addDays = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)

// ---------------------------------------------------------------- Sammel-Festschreiben

/** Reihenfolge beim Festschreiben (fortlaufende Nummern): Datum, dann Empfänger, dann Kennung. */
export const finalizeOrder = (a, b) => String(a.date).localeCompare(String(b.date)) || recName(a).localeCompare(recName(b), 'de') || String(a.id).localeCompare(String(b.id))

/**
 * Entwürfe für das Sammel-Festschreiben: filter 'lauf' = aus dem Monatslauf (Dauerauftrag, auf Wunsch nur Monat ym),
 * 'alle' = alle Rechnungs-, Storno- und Korrekturentwürfe. [{ doc, problems, errors, gross }] in Festschreib-Reihenfolge.
 * check(doc, docs) → [Meldung]: weitere Gründe gegen das Festschreiben (z. B. schon anderswo verrechnet, Mattenwechsel
 * noch nicht freigegeben), als Fehler gezählt.
 */
export function batchDrafts(docs, { filter = 'lauf', ym = '', settings = {}, check = null } = {}) {
  const s = settingsOf({ settings })
  return docs
    .filter((d) => isInvoice(d) && !d.number)
    .filter((d) => filter !== 'lauf' || (d.source?.type === 'dauerauftrag' && (!ym || String(d.source.key || '').endsWith(`:${ym}`))))
    .sort(finalizeOrder)
    .map((doc) => {
      const list = [...problems(doc, s), ...(check ? check(doc, docs) : []).map((text) => ({ level: 'error', text }))]
      return { doc, problems: list, errors: blocking(list), gross: totals(doc, s).gross }
    })
}

/**
 * Mehrere Entwürfe nacheinander festschreiben (lückenlose Nummernfolge in finalizeOrder). Hat der Kunde ein
 * SEPA-Mandat, steht die Vorabankündigung als debitText auf der Rechnung. Ein Fehler hält die übrigen nicht auf.
 * check(draft, docs) → [Meldung] prüft je Entwurf mit dem Stand davor (wie beim Einzel-Festschreiben); eine Meldung
 * hält diesen Entwurf auf. Liefert { docs, done: [festgeschriebene Belege], failed: [{ id, error }] }.
 */
export function finalizeBatch(ids, docs, settings = {}, { now = new Date().toISOString(), by = '', customersById = new Map(), terms = [], user = by, check = null } = {}) {
  const want = new Set(ids)
  let all = docs
  const done = []
  const failed = []
  for (const d of docs.filter((x) => want.has(x.id) && !x.number).sort(finalizeOrder)) {
    try {
      const clash = check ? check(d, all) : []
      if (clash.length) throw new Error(clash[0])
      const customer = customersById.get(d.customerId) || null
      const draft = withDebitNote(d, customer, settings)
      const fixed = finalize(draft, all, settings, { now, by, customer, terms: termsById(terms, d.termsId), user })
      all = all.map((x) => (x.id === d.id ? fixed : x))
      done.push(fixed)
    } catch (err) {
      failed.push({ id: d.id, error: err.message })
    }
  }
  return { docs: all, done, failed }
}

/** Entwurf mit Lastschrift-Hinweis (wenn der Kunde ein Mandat hat), sonst ohne; das Original bleibt. */
export function withDebitNote(draft, customer, settings = {}) {
  const note = debitNoteFor(draft, customer, settings)
  const out = { ...draft }
  if (note) out.debitText = note
  else delete out.debitText
  return out
}

// ---------------------------------------------------------------- Sammelversand

/** E-Mail-Text zur Rechnung mit Lastschrift: die Zeile „Betrag: …, zahlbar bis … auf IBAN“ wird zum Hinweis auf den Einzug. */
export const mailWithDebit = (text, doc) => (doc?.debitText ? String(text).replace(/^Betrag: .*$/m, doc.debitText) : text)

/**
 * Festgeschriebene Rechnungen (samt Storno und Korrektur), die noch nicht versendet sind; ids: nur diese.
 * Übernommene Altbelege (imported, im Altsystem schon versendet) zählen nicht. [{ doc, customer, to }] nach Nummer.
 */
export function sendCandidates(docs, customers = [], { ids = null } = {}) {
  const byId = new Map(customers.map((c) => [c.id, c]))
  const only = ids ? new Set(ids) : null
  return docs
    .filter((d) => INVOICE_KINDS.includes(d.kind) && d.number && !d.imported && !(d.sent || []).length && (!only || only.has(d.id)))
    .sort((a, b) => String(a.number).localeCompare(String(b.number), 'de', { numeric: true }))
    .map((doc) => {
      const customer = byId.get(doc.customerId) || null
      return { doc, customer, to: mailTo(doc, customer) }
    })
}

// ---------------------------------------------------------------- Mahnlauf

/** Aktive Mahnsperre am Beleg (vor der beim Kunden): { scope: 'beleg' | 'kunde', until, note } oder null. */
export function blockOf(doc, customer, today) {
  for (const [scope, b] of [
    ['beleg', doc?.dunningBlock],
    ['kunde', customer?.dunningBlock],
  ])
    if (b && (b.until || b.note) && (!b.until || b.until >= today)) return { scope, until: b.until || '', note: b.note || '' }
  return null
}

/**
 * Mahnlauf: alle Rechnungen mit fälliger Mahnstufe. due: zu mahnen (mit Mahnung: Stufe, Zinsen, Gebühr, Summe),
 * blocked: gesperrt („nicht mahnen bis …“), collecting: im Lastschrifteinzug (nicht mahnen).
 */
export function dunningRun(docs, customers, today, settings = {}) {
  const s = settingsOf({ settings })
  const byId = new Map((customers || []).map((c) => [c.id, c]))
  const due = []
  const blocked = []
  const collecting = []
  for (const item of openItems(docs, today, s)) {
    if (!item.next) continue
    const customer = byId.get(item.doc.customerId) || null
    const row = { ...item, customer, reminder: reminderFor(item.doc, docs, { today, settings: s }), to: mailTo(item.doc, customer) }
    const block = blockOf(item.doc, customer, today)
    if (inCollection(item.doc)) collecting.push(row)
    else if (block) blocked.push({ ...row, block })
    else due.push(row)
  }
  return { due, blocked, collecting }
}

/**
 * Zahlungserinnerungen: die erste, freundliche Stufe (ohne Zinsen und Gebühr) aus dem Mahnlauf, getrennt nach
 * „per E-Mail versandbereit“ und „ohne E-Mail-Adresse“ (die bleiben beim Mahnlauf, per Post). Mahnsperren und
 * Rechnungen im Lastschrifteinzug sind wie im Mahnlauf ausgenommen. Versendet wird nur nach Freigabe.
 * → { ready: [Zeilen wie dunningRun.due], post: [...], later: Anzahl höherer Mahnstufen }
 */
export function paymentReminders(docs, customers, today, settings = {}) {
  const { due } = dunningRun(docs, customers, today, settings)
  const first = due.filter((x) => x.reminder?.level === 0)
  return { ready: first.filter((x) => emailValid(x.to)), post: first.filter((x) => !emailValid(x.to)), later: due.length - first.length }
}

/** Alle aktiven Mahnsperren (Beleg und Kunde), auch ohne fällige Mahnung: [{ scope, id, name, until, note }]. */
export function activeBlocks(docs, customers, today) {
  const out = []
  for (const c of customers || []) if (blockOf(null, c, today)) out.push({ scope: 'kunde', id: c.id, name: customerName(c), ...c.dunningBlock })
  for (const d of docs || []) if (d.number && blockOf(d, null, today)) out.push({ scope: 'beleg', id: d.id, name: `${d.number} ${recName(d)}`.trim(), ...d.dunningBlock })
  return out
}

// ---------------------------------------------------------------- Angebote nachfassen

/**
 * Wiedervorlage eines Angebots: eigene (followUp.date) oder „X Tage nach Versand“ (settings.offerFollowUpDays).
 * { date, note, done, auto } oder null.
 */
export function followUpOf(doc, settings = {}) {
  if (doc?.kind !== 'angebot' || !doc.number) return null
  const f = doc.followUp || {}
  if (f.date) return { date: f.date, note: f.note || '', done: !!f.doneAt, auto: false }
  // Tag in Wien (nicht UTC): nach Mitternacht versendet bzw. erledigt ist schon der neue Tag
  const day = (at) => (at ? viennaDate(at) || String(at).slice(0, 10) : '')
  if (f.doneAt) return { date: day(f.doneAt), note: f.note || '', done: true, auto: false }
  const days = Number(settings.offerFollowUpDays ?? DEFAULT_FOLLOW_UP_DAYS)
  const sent = (doc.sent || []).map((x) => day(x.at)).filter(Boolean).sort()[0]
  if (!(days > 0) || !sent) return null
  return { date: addDays(sent, days), note: '', done: false, auto: true }
}

/**
 * Für „Zu erledigen“ und die Übersicht: fällige Wiedervorlagen offener Angebote und Angebote, die in den nächsten
 * soonDays Tagen ablaufen. { followUps: [{ doc, date, note, auto, overdue }], expiring: [{ doc, days }] }.
 */
export function offerTasks(docs, today, settings = {}, { soonDays = SOON_DAYS } = {}) {
  const s = settingsOf({ settings })
  const open = docs.filter((d) => d.kind === 'angebot' && d.number && stateOf(d, docs, today, s) === 'offen')
  const followUps = open
    .map((doc) => ({ doc, f: followUpOf(doc, s) }))
    .filter((x) => x.f && !x.f.done && x.f.date <= today)
    .map(({ doc, f }) => ({ doc, date: f.date, note: f.note, auto: f.auto, overdue: daysBetween(f.date, today) }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const expiring = open
    .filter((d) => d.validUntil && d.validUntil >= today && daysBetween(today, d.validUntil) <= soonDays)
    .map((doc) => ({ doc, days: daysBetween(today, doc.validUntil) }))
    .sort((a, b) => a.days - b.days)
  return { followUps, expiring }
}

/**
 * Angebotsquote eines Jahres (nach Angebotsdatum): Anzahl und Summe netto je Zustand (angenommen, abgelehnt,
 * abgelaufen, offen) und die Quote: angenommen von den entschiedenen (angenommen, abgelehnt, abgelaufen),
 * nach Anzahl und nach Wert.
 */
export function offerStats(docs, year, today, settings = {}) {
  const s = settingsOf({ settings })
  const states = ['angenommen', 'abgelehnt', 'abgelaufen', 'offen']
  const by = Object.fromEntries(states.map((k) => [k, { count: 0, net: 0 }]))
  for (const d of docs) {
    if (d.kind !== 'angebot' || !d.number || String(d.date).slice(0, 4) !== String(year)) continue
    const st = stateOf(d, docs, today, s)
    if (!by[st]) continue
    by[st].count++
    by[st].net = round2(by[st].net + (d.total || totals(d, s)).net)
  }
  const count = states.reduce((a, k) => a + by[k].count, 0)
  const net = round2(states.reduce((a, k) => a + by[k].net, 0))
  const decided = by.angenommen.count + by.abgelehnt.count + by.abgelaufen.count
  const decidedNet = by.angenommen.net + by.abgelehnt.net + by.abgelaufen.net
  return {
    year: String(year),
    count,
    net,
    byState: by,
    rate: decided ? round2((by.angenommen.count / decided) * 100) : null,
    rateNet: decidedNet > 0 ? round2((by.angenommen.net / decidedNet) * 100) : null,
  }
}

/** Nachfass-E-Mail ohne eigenen Textbaustein. greeting: Anrede ohne Beistrich. */
export function followUpMailText({ doc, greeting = 'Sehr geehrte Damen und Herren', sender = '', company = '' }) {
  return [
    `${greeting},`,
    '',
    `vor kurzem haben wir Ihnen unser Angebot ${doc.number} vom ${deDate(doc.date)}${doc.title ? ` (${doc.title})` : ''} geschickt. Haben Sie noch Fragen dazu, oder sollen wir etwas anpassen?`,
    doc.validUntil ? `Das Angebot gilt bis ${deDate(doc.validUntil)}. Wir freuen uns auf Ihre Rückmeldung.` : 'Wir freuen uns auf Ihre Rückmeldung.',
    '',
    'Mit freundlichen Grüßen',
    sender,
    company,
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n')
    .trim()
}
