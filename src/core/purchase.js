// Einkauf: Lieferanten und Eingangsrechnungen (Vorsteuer-Prüfung, Doppel-Erkennung, Freigabe, Zahlungen mit
// Skonto, offene Verbindlichkeiten, Bank-Ausgänge zuordnen, Export für die Steuerberatung, Übernahme aus
// orgaMAX). Reine Funktionen ohne Oberfläche (Oberfläche: ui/views/purchase.js, Tests: test/purchase.test.js).
// Kassenbuch: core/cashbook.js, SEPA-Überweisungen: core/sepa-transfer.js.
//
// Österreichisches Recht (Quellen in docs/RECHTSPRUEFUNG.md → Einkauf & Kasse):
//  - Vorsteuerabzug nur mit einer Rechnung nach § 11 UStG (§ 12 Abs 1 Z 1 UStG): Name und Anschrift des
//    Lieferanten und des Empfängers, Menge und handelsübliche Bezeichnung, Tag bzw. Zeitraum der Leistung,
//    Entgelt je Steuersatz, Steuersatz und Steuerbetrag, Ausstellungsdatum, fortlaufende Nummer, UID des
//    Lieferanten (über 400 € brutto), über 10.000 € brutto auch unsere UID.
//  - Kleinbetragsrechnung bis 400 € brutto (§ 11 Abs 6): Name und Anschrift des Lieferanten, Menge und
//    Bezeichnung, Tag der Leistung, Entgelt und Steuer in einer Summe, Steuersatz, Ausstellungsdatum genügen.
//  - Reverse Charge (§ 19 Abs 1a, Bauleistungen, z. B. Subunternehmer in der Reinigung): Rechnung ohne USt mit
//    Hinweis und beiden UIDs (§ 11 Abs 1a); wir schulden die Steuer und ziehen sie zugleich als Vorsteuer ab.
//  - Skonto mindert nachträglich das Entgelt; die Vorsteuer wird im Zeitraum der Zahlung berichtigt (§ 16 Abs 1).
//  - Belege 7 Jahre aufbewahren (§ 132 BAO): Eingangsrechnungen werden nicht gelöscht, eine Fehlerfassung wird
//    storniert (bleibt sichtbar, zählt nicht mehr).
//
// Datenmodell einkauf/einkauf.json (alle Felder außer id optional; Beträge in Euro, Datum als JJJJ-MM-TT):
//  suppliers[]  Lieferanten (orgaMAX: BAS_CUSTOMERS mit CONTACTTYPE 3)
//               { id, supplierNo, name (Firma), salutation, title, firstName, lastName (Ansprechpartner),
//                 street, zip, city, country (ISO, Standard AT), address (gedruckte Anschrift, nur wenn von Hand),
//                 phone, mobile, fax, email, web, contacts: [{ id, name, role, email, phone }],
//                 uid, taxNo, iban, bic, bank, paymentDays, skontoPercent, skontoDays,
//                 customerNo (unsere Kundennummer beim Lieferanten), account (Kreditorenkonto),
//                 expenseAccount (Aufwandskonto-Vorschlag), category (Kategorie-Vorschlag), vat (Steuersatz-Vorschlag),
//                 reverseCharge (rechnet mit Übergang der Steuerschuld ab), materialId (Verknüpfung zu
//                 material.suppliers[].id, siehe unten), note, active, extra { Feld: Wert }, source { system, id },
//                 createdAt }
//  invoices[]   Eingangsrechnungen (orgaMAX: MOV_PURCHINVOICES mit Positionen/Zahlungen)
//               { id, no (eigene laufende Eingangsnummer, z. B. ER-2026-0001), supplierId,
//                 supplier { name, address, uid } (Stand bei der Erfassung), number (Rechnungsnummer des Lieferanten),
//                 date (Rechnungsdatum), serviceFrom, serviceTo (Leistungsdatum bzw. -zeitraum), receivedAt,
//                 text (Menge und Bezeichnung der Leistung), groups [{ rate, net, vat }] (Netto und Vorsteuer je
//                 Steuersatz), reverseCharge, dueDate, skonto { percent, days }, category, account (Aufwandskonto),
//                 objectId (Objekt/Kostenstelle), vehicleId/vehicleLabel (Fahrzeug, Fuhrparkkosten), costCenter, orderId (Bestellung in Material & Lager), note,
//                 checks { recipient: unsere Firma und Anschrift stehen drauf, ourUid: unsere UID steht drauf,
//                          rcNote: Hinweis auf Reverse Charge steht drauf },
//                 approval { by, at } (geprüft/freigegeben), payments [{ id, date, amount, kind ('skonto' oder leer),
//                 method ('bank' | 'bar' | 'lastschrift' | 'sepa'), bank (Buchung im Kontoauszug), cash (Kassenbuch-Eintrag),
//                 sepa (Lauf), ref (Zahlung zum Skonto), note, by, at }], beleg { path, name, type, size, at, by,
//                 url (SharePoint), local (nur Browser-Vorschau) }, einvoice { format }, cancelled { at, by, reason },
//                 sepa { runId, date, amount, at } (in einer Überweisungsdatei), imported { system, at, ref }, checksum (nur
//                 übernommene), history [{ at, by, text }], createdAt, createdBy }
//               recharge: Weiterverrechnung an einen Kunden der Fakturierung (Felder und Zustände: core/recharge.js)
//  bankIgnored  { Buchungs-ID: { by, at } }  Abbuchungen im Kontoauszug (Fakturierung → Bank), die keine
//               Eingangsrechnung sind (Lohn, Steuer, Gebühren …)
//  sepaRuns[]   { id, at, by, msgId, date, invoiceIds, sum, count, name }  erzeugte Überweisungsdateien (pain.001)
//  settings     { categories [{ id, name, account, vat }], approval (Freigabe vor dem Zahlen), prefix ('ER'),
//                 digits, accounts { kreditor, skonto }, debtor { name, iban, bic } (Auftraggeberkonto für pain.001;
//                 leer: Bank aus den Einstellungen der Fakturierung) }
//
// Lieferanten aus Material & Lager: material/material.json (suppliers: Name, E-Mail, Telefon, Ansprechperson,
// Kundennummer) lesen Lager, Objektleitung und Objektservice – Bankverbindung, UID und Rechnungen gehören nicht
// dorthin. Darum bleiben beide Listen in ihren Ordnern (die SharePoint-Rechte sind der echte Schutz) und werden
// verknüpft: ein Lieferant im Einkauf trägt materialId. Übernehmen kopiert Name und Kontaktdaten, nichts wird
// gelöscht oder verschoben; Kontaktdaten lassen sich auf Wunsch in beide Richtungen angleichen.

import { cleanIban, nameScore, nameTokens } from './bank.js'
import { emptyCashbook, importCash } from './cashbook.js'
import { composeAddress, fnv1a, ibanValid, parseNumber, personLine, round2, VAT_RATES } from './invoicing.js'

export { VAT_RATES }
export const SMALL_AMOUNT = 400 // § 11 Abs 6 UStG
export const UID_LIMIT = 10000 // § 11 Abs 1 Z 3 lit i UStG: unsere UID über 10.000 € brutto

/** Kategorien mit Aufwandskonto (Vorschlag nach dem Einheitskontenrahmen; mit der Steuerberatung abstimmen). */
export const DEFAULT_CATEGORIES = [
  ['material', 'Reinigungsmittel & Material', '5300', 20],
  ['kleidung', 'Arbeitskleidung & Schutz', '5310', 20],
  ['geraete', 'Kleingeräte & Werkzeug', '5500', 20],
  ['fremd', 'Fremdleistungen (Subunternehmer)', '5700', 20],
  ['kfz', 'Fahrzeuge (Treibstoff, Service)', '7320', 20],
  ['miete', 'Miete & Leasing', '7400', 20],
  ['instand', 'Instandhaltung & Reparatur', '7200', 20],
  ['buero', 'Büro, Porto & Software', '7600', 20],
  ['telefon', 'Telefon & Internet', '7380', 20],
  ['versicherung', 'Versicherungen', '7700', 0],
  ['beratung', 'Beratung (Steuerberatung, Recht)', '7750', 20],
  ['werbung', 'Werbung', '7650', 20],
  ['reise', 'Reise & Bewirtung', '7360', 20],
  ['gebuehren', 'Gebühren & Bankspesen', '7790', 0],
  ['sonstiges', 'Sonstiger Aufwand', '7890', 20],
].map(([id, name, account, vat]) => ({ id, name, account, vat }))

export const PURCHASE_SETTINGS = { categories: DEFAULT_CATEGORIES, approval: false, prefix: 'ER', digits: 4, accounts: { kreditor: '3300', skonto: '' }, debtor: { name: '', iban: '', bic: '' } }

export const emptyPurchase = () => ({ suppliers: [], invoices: [], bankIgnored: {}, sepaRuns: [], settings: {} })

export function purchaseSettings(doc = {}) {
  const s = doc.settings || {}
  return {
    ...PURCHASE_SETTINGS,
    ...s,
    categories: Array.isArray(s.categories) && s.categories.length ? s.categories : DEFAULT_CATEGORIES,
    accounts: { ...PURCHASE_SETTINGS.accounts, ...(s.accounts || {}) },
    debtor: { ...PURCHASE_SETTINGS.debtor, ...(s.debtor || {}) },
  }
}

const addDaysIso = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)
const lower = (s) => String(s ?? '').trim().toLowerCase()
const fmt = (n) => `${round2(n).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

// ---------------------------------------------------------------- Lieferanten

/** Anzeigename: Firma, sonst Person. */
export const supplierName = (s = {}) => s.name || personLine(s) || ''

/** Anschrift (mehrzeilig) aus den Einzelfeldern wie bei den Kunden der Fakturierung. */
export const supplierAddress = (s = {}) => composeAddress(s)

/** Nächste Lieferantennummer (70001, 70002, …; wie die Kundennummern, aber eigener Bereich). */
export function nextSupplierNo(suppliers = []) {
  const nums = suppliers.map((s) => Number(s.supplierNo)).filter((n) => Number.isFinite(n) && n > 0)
  return String(nums.length ? Math.max(...nums) + 1 : 70001)
}

/** UID formal prüfen (EU-Format, Österreich ATU + 8 Ziffern). Ohne Gültigkeitsabfrage (MIAS/FinanzOnline). */
export function uidValid(uid) {
  const s = String(uid || '').replace(/\s+/g, '').toUpperCase()
  if (!s) return false
  if (s.startsWith('AT')) return /^ATU\d{8}$/.test(s)
  return /^(EL|GR|[A-Z]{2})[0-9A-Z+*]{2,13}$/.test(s)
}

/** Suche über alle Felder des Lieferanten; mehrere Wörter: alle müssen vorkommen. */
export function supplierMatches(s, query) {
  const q = lower(query)
  if (!q) return true
  const hay = [s.name, s.supplierNo, s.firstName, s.lastName, s.street, s.zip, s.city, s.phone, s.mobile, s.email, s.uid, s.iban, s.customerNo, s.note, ...(s.contacts || []).flatMap((p) => [p.name, p.email, p.phone])]
    .map(lower)
    .join(' \n ')
  return q.split(/\s+/).every((w) => hay.includes(w))
}

/** Lieferant prüfen: [{ level, text }]. */
export function supplierProblems(s = {}) {
  const out = []
  if (!supplierName(s)) out.push({ level: 'error', text: 'Firma oder Name fehlt.' })
  if (s.iban && !ibanValid(s.iban)) out.push({ level: 'error', text: 'Die IBAN ist ungültig (Prüfziffer).' })
  if (s.uid && !uidValid(s.uid)) out.push({ level: 'warning', text: 'Die UID hat nicht das übliche Format (z. B. ATU12345678).' })
  if (s.reverseCharge && !s.uid) out.push({ level: 'error', text: 'Reverse Charge nur mit UID des Lieferanten.' })
  if (s.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email)) out.push({ level: 'warning', text: 'Die E-Mail-Adresse sieht nicht richtig aus.' })
  return out
}

/** Gleicher Name (dieselben Wörter, ohne Rechtsform und Groß-/Kleinschreibung)? */
export const sameName = (a, b) => {
  const x = [...new Set(nameTokens(a))].sort().join(' ')
  return !!x && x === [...new Set(nameTokens(b))].sort().join(' ')
}

/** Gleicher Lieferant? Nummer, Quelle (z. B. orgaMAX-ID), UID oder sehr ähnlicher Name. */
export function findSupplier(suppliers = [], probe = {}) {
  const no = String(probe.supplierNo || '').trim()
  if (no) {
    const hit = suppliers.find((s) => String(s.supplierNo || '').trim() === no)
    if (hit) return hit
  }
  if (probe.source?.id) {
    const hit = suppliers.find((s) => s.source?.system === probe.source.system && String(s.source.id) === String(probe.source.id))
    if (hit) return hit
  }
  const uid = String(probe.uid || '').replace(/\s+/g, '').toUpperCase()
  if (uid) {
    const hit = suppliers.find((s) => String(s.uid || '').replace(/\s+/g, '').toUpperCase() === uid)
    if (hit) return hit
  }
  const iban = cleanIban(probe.iban)
  if (iban) {
    const hit = suppliers.find((s) => cleanIban(s.iban) === iban)
    if (hit) return hit
  }
  const name = supplierName(probe)
  if (!name) return null
  const same = suppliers.filter((s) => sameName(name, supplierName(s)))
  return same.length === 1 ? same[0] : null
}

// ---------------------------------------------------------------- Verknüpfung mit Material & Lager

/**
 * Lieferanten aus Material & Lager ohne Verknüpfung: [{ material, match }] – match ist ein Lieferant des Einkaufs
 * mit (fast) gleichem Namen oder gleicher Kundennummer (zum Verknüpfen), sonst null (zum Übernehmen).
 */
export function materialLinks(purchaseSuppliers = [], materialSuppliers = []) {
  const linked = new Set(purchaseSuppliers.map((s) => s.materialId).filter(Boolean))
  return materialSuppliers
    .filter((m) => !linked.has(m.id))
    .map((m) => {
      const free = purchaseSuppliers.filter((s) => !s.materialId)
      const match = free.find((s) => nameScore(m.name, supplierName(s)) >= 0.8) || (m.customerNo ? free.find((s) => s.customerNo && s.customerNo === m.customerNo) : null) || null
      return { material: m, match }
    })
}

/** Neuer Lieferant im Einkauf aus einem Lieferanten von Material & Lager (Kontaktdaten kopiert, verknüpft). */
export function supplierFromMaterial(m, { id, supplierNo, now = new Date().toISOString() }) {
  return { id, supplierNo, name: m.name || '', email: m.email || '', phone: m.phone || '', customerNo: m.customerNo || '', contacts: m.contact ? [{ id: `${id}-k1`, name: m.contact, role: 'Bestellungen', email: m.email || '', phone: m.phone || '' }] : [], note: m.note || '', materialId: m.id, country: 'AT', active: true, createdAt: now }
}

/** Kontaktdaten für Material & Lager aus dem Lieferanten des Einkaufs (nur, was dort Felder hat). */
export const materialFields = (s) => ({ name: supplierName(s), email: s.email || '', phone: s.phone || s.mobile || '', customerNo: s.customerNo || '', contact: s.contacts?.[0]?.name || personLine(s) || '' })

// ---------------------------------------------------------------- Eingangsrechnungen: Beträge

/** Summen: { groups, net, vat, gross, rcVat } – rcVat: geschuldete Steuer bei Reverse Charge (zugleich Vorsteuer). */
export function invoiceTotals(inv = {}) {
  const groups = (inv.groups || [])
    .map((g) => ({ rate: parseNumber(g.rate), net: round2(parseNumber(g.net)), vat: inv.reverseCharge ? 0 : round2(parseNumber(g.vat)) }))
    .filter((g) => g.net || g.vat)
  const net = round2(groups.reduce((s, g) => s + g.net, 0))
  const vat = round2(groups.reduce((s, g) => s + g.vat, 0))
  const rcVat = inv.reverseCharge ? round2(groups.reduce((s, g) => s + (g.net * (g.rate || 20)) / 100, 0)) : 0
  return { groups, net, vat, gross: round2(net + vat), rcVat }
}

/** Steuer zu einem Netto (für das Formular: Vorsteuer vorschlagen). */
export const vatFor = (net, rate) => round2((parseNumber(net) * parseNumber(rate)) / 100)

/** Aus einem Bruttobetrag Netto und Steuer (Kassenbeleg: nur brutto bekannt). */
export function splitGross(gross, rate) {
  const g = round2(parseNumber(gross))
  const net = round2(g / (1 + parseNumber(rate) / 100))
  return { net, vat: round2(g - net), gross: g }
}

export const grossOfInvoice = (inv) => invoiceTotals(inv).gross
export const paidOfInvoice = (inv) => round2((inv.payments || []).reduce((s, p) => s + parseNumber(p.amount), 0))
export const skontoTakenOf = (inv) => round2((inv.payments || []).filter((p) => p.kind === 'skonto').reduce((s, p) => s + parseNumber(p.amount), 0))

/** Offener Betrag (brutto − Zahlungen samt Skonto); stornierte Erfassung: 0. */
export function openOf(inv) {
  if (inv.cancelled) return 0
  return round2(grossOfInvoice(inv) - paidOfInvoice(inv))
}

/** Skonto laut Rechnung: { percent, days, until, amount, base } oder null. */
export function skontoOfInvoice(inv) {
  const pct = parseNumber(inv.skonto?.percent)
  if (!(pct > 0) || !inv.date) return null
  const days = Math.max(0, Number(inv.skonto?.days) || 0)
  const base = grossOfInvoice(inv)
  return { percent: pct, days, until: addDaysIso(inv.date, days), base, amount: round2((base * pct) / 100) }
}

/** Skonto, das bei Zahlung am Tag date noch abgezogen werden darf (0: Frist vorbei, schon vermerkt, storniert). */
export function skontoAvailableOn(inv, date) {
  const sk = skontoOfInvoice(inv)
  if (!sk || !date || date > sk.until || inv.cancelled) return 0
  if ((inv.payments || []).some((p) => p.kind === 'skonto')) return 0
  return sk.base > 0 ? sk.amount : 0
}

/**
 * Zahlungseinträge zu einer Zahlung: liegt sie in der Skontofrist und fehlt danach höchstens das Skonto
 * (1 Cent Spielraum), wird der Rest als Skonto vermerkt (eigener Eintrag kind 'skonto', ref = Zahlung).
 */
export function purchasePaymentEntries(inv, payment, { newId = () => Math.random().toString(36).slice(2, 10) } = {}) {
  const entry = { ...payment, id: payment.id || newId(), amount: round2(parseNumber(payment.amount)) }
  const sk = skontoAvailableOn(inv, entry.date)
  if (!sk) return [entry]
  const rest = round2(openOf(inv) - entry.amount)
  if (!(rest > 0.004 && rest <= sk + 0.01)) return [entry]
  const extra = Object.fromEntries(['method', 'bank', 'cash', 'sepa', 'by', 'at'].filter((k) => entry[k]).map((k) => [k, entry[k]]))
  return [entry, { id: newId(), date: entry.date, amount: rest, kind: 'skonto', ref: entry.id, note: `Skonto ${String(skontoOfInvoice(inv).percent).replace('.', ',')} % (Zahlung in der Skontofrist)`, ...extra }]
}

/** Zahlung samt zugehörigem Skonto entfernen (z. B. Kassenbuchung storniert, Bankzuordnung gelöst). */
export function removePayment(inv, test, { by = '', at = new Date().toISOString(), text = 'Zahlung entfernt' } = {}) {
  const gone = (inv.payments || []).filter(test)
  if (!gone.length) return false
  const ids = new Set(gone.map((p) => p.id))
  inv.payments = inv.payments.filter((p) => !ids.has(p.id) && !ids.has(p.ref))
  inv.history = [...(inv.history || []), { at, by, text }]
  return true
}

export const PAY_STATE = { offen: 'offen', teilbezahlt: 'teilweise bezahlt', bezahlt: 'bezahlt', ueberfaellig: 'überfällig', storniert: 'storniert' }

/** Zahlstatus: offen, teilbezahlt, bezahlt, ueberfaellig oder storniert. */
export function purchaseState(inv, today) {
  if (inv.cancelled) return 'storniert'
  const open = openOf(inv)
  if (open <= 0.004) return 'bezahlt'
  if (inv.dueDate && inv.dueDate < today) return 'ueberfaellig'
  return paidOfInvoice(inv) > 0.004 ? 'teilbezahlt' : 'offen'
}

/** Fälligkeit aus Rechnungsdatum und Zahlungsziel (Tage). */
export const dueFor = (date, days) => (date ? addDaysIso(date, Math.max(0, Number(days) || 0)) : '')

/**
 * Offene Verbindlichkeiten nach Fälligkeit: [{ inv, open, deadline, skonto, overdueDays, daysLeft }].
 * deadline: Ende der Skontofrist, solange Skonto möglich ist, sonst die Fälligkeit. skonto: { until, amount, payable }.
 */
export function payables(invoices = [], today) {
  return invoices
    .filter((inv) => !inv.cancelled)
    .map((inv) => {
      const open = openOf(inv)
      const sk = skontoAvailableOn(inv, today)
      const skonto = sk ? { until: skontoOfInvoice(inv).until, amount: sk, payable: round2(open - sk) } : null
      const deadline = skonto ? skonto.until : inv.dueDate || inv.date || ''
      return { inv, open, deadline, skonto, overdueDays: inv.dueDate && inv.dueDate < today ? daysBetween(inv.dueDate, today) : 0, daysLeft: deadline ? daysBetween(today, deadline) : null }
    })
    .filter((x) => x.open > 0.004)
    .sort((a, b) => String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')) || String(a.inv.date).localeCompare(String(b.inv.date)))
}

/** Was in den nächsten days Tagen zu zahlen ist (Fälligkeit oder Ende der Skontofrist), samt Überfälligem. */
export const duePayables = (invoices, today, days = 3) => payables(invoices, today).filter((x) => x.deadline && x.deadline <= addDaysIso(today, days))

/** Fällig in der Woche von today (Mo–So) und bis dahin Überfälliges. */
export function dueThisWeek(invoices, today) {
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7
  const sunday = addDaysIso(today, 6 - dow)
  return payables(invoices, today).filter((x) => x.deadline && x.deadline <= sunday)
}

// ---------------------------------------------------------------- Prüfung: Pflichtangaben, Doppel

/** Rechnungsnummer vergleichbar machen: Großbuchstaben, ohne Trennzeichen, ohne führende Nullen je Zahl. */
export const normalizeNumber = (no) =>
  String(no || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, '')))
    .join('')

const sameSupplier = (a, b, suppliers) => {
  if (a.supplierId && b.supplierId) return a.supplierId === b.supplierId
  const name = (x) => x.supplier?.name || supplierName(suppliers.find((s) => s.id === x.supplierId) || {})
  return sameName(name(a), name(b))
}

/**
 * Doppelt erfasst? { same: [Rechnungen mit gleichem Lieferanten und gleicher Nummer], similar: [gleicher Lieferant,
 * Datum und Betrag, ohne Nummer] }. Stornierte Erfassungen zählen nicht.
 */
export function findDuplicates(invoices = [], inv, suppliers = []) {
  const others = invoices.filter((x) => x.id !== inv.id && !x.cancelled && sameSupplier(x, inv, suppliers))
  const key = normalizeNumber(inv.number)
  const same = key ? others.filter((x) => normalizeNumber(x.number) === key) : []
  const gross = grossOfInvoice(inv)
  const similar = others.filter((x) => !same.includes(x) && x.date === inv.date && Math.abs(grossOfInvoice(x) - gross) < 0.005 && gross > 0)
  return { same, similar }
}

/**
 * Prüfung einer Eingangsrechnung: [{ level: 'error' | 'warning' | 'info', code, text }].
 * Fehler verhindern das Speichern. Warnungen mit code 'vst…' gefährden den Vorsteuerabzug (§ 12 Abs 1 Z 1 UStG).
 */
export function invoiceProblems(inv = {}, { suppliers = [], invoices = [] } = {}) {
  const out = []
  const add = (level, code, text) => out.push({ level, code, text })
  const supplier = suppliers.find((s) => s.id === inv.supplierId) || null
  const t = invoiceTotals(inv)
  if (!inv.supplierId && !inv.supplier?.name) add('error', 'lieferant', 'Lieferant fehlt.')
  if (!inv.date) add('error', 'datum', 'Rechnungsdatum fehlt.')
  if (!(t.gross > 0) && !(t.net > 0)) add('error', 'betrag', 'Betrag fehlt (Netto je Steuersatz).')
  if (inv.date && inv.dueDate && inv.dueDate < inv.date) add('error', 'faellig', 'Die Fälligkeit liegt vor dem Rechnungsdatum.')
  const dup = findDuplicates(invoices, inv, suppliers)
  if (dup.same.length) add('error', 'doppelt', `Schon erfasst: ${dup.same.map((x) => `${x.no || ''} Nr. ${x.number} vom ${deDateShort(x.date)}`.trim()).join(', ')}`)
  if (dup.similar.length) add('warning', 'aehnlich', `Möglicherweise doppelt: gleicher Lieferant, gleiches Datum und gleicher Betrag (${dup.similar.map((x) => x.no || x.number || '').filter(Boolean).join(', ') || 'ohne Nummer'})`)

  // Vorsteuerabzug: Merkmale nach § 11 UStG
  const name = inv.supplier?.name || supplierName(supplier || {})
  const address = inv.supplier?.address || (supplier ? supplierAddress(supplier) : '')
  const uid = inv.supplier?.uid || supplier?.uid || ''
  const small = t.gross <= SMALL_AMOUNT && !inv.reverseCharge
  if (!name || !address) add('warning', 'vst-anschrift', 'Name und Anschrift des Lieferanten fehlen.')
  if (!String(inv.text || '').trim()) add('warning', 'vst-leistung', 'Menge und Bezeichnung der Leistung fehlen.')
  if (!inv.serviceFrom) add('warning', 'vst-leistungsdatum', 'Tag bzw. Zeitraum der Leistung fehlt.')
  for (const g of t.groups) {
    if (!VAT_RATES.includes(g.rate)) add('warning', 'vst-satz', `Steuersatz ${g.rate} % ist in Österreich nicht üblich.`)
    if (!inv.reverseCharge && g.rate > 0 && Math.abs(g.vat - vatFor(g.net, g.rate)) > 0.05 + g.net * 0.0005) add('warning', 'vst-betrag', `Vorsteuer ${fmt(g.vat)} passt nicht zu ${g.rate} % von ${fmt(g.net)} (${fmt(vatFor(g.net, g.rate))}).`)
  }
  if (!small) {
    if (!String(inv.number || '').trim()) add('warning', 'vst-nummer', 'Rechnungsnummer fehlt.')
    if (!uid) add('warning', 'vst-uid', 'UID des Lieferanten fehlt (Pflicht über 400 € brutto).')
    else if (!uidValid(uid)) add('warning', 'vst-uid', `UID des Lieferanten „${uid}“ hat nicht das übliche Format.`)
    if (!inv.checks?.recipient) add('warning', 'vst-empfaenger', 'Bitte prüfen: Stehen unser Firmenname und unsere Anschrift auf der Rechnung?')
  }
  if (t.gross > UID_LIMIT && !inv.checks?.ourUid) add('warning', 'vst-unsere-uid', 'Über 10.000 € brutto muss unsere UID auf der Rechnung stehen.')
  if (inv.reverseCharge) {
    if (!inv.checks?.ourUid) add('warning', 'vst-unsere-uid', 'Reverse Charge: unsere UID muss auf der Rechnung stehen.')
    if (!inv.checks?.rcNote) add('warning', 'vst-rc-hinweis', 'Reverse Charge: Hinweis auf den Übergang der Steuerschuld fehlt.')
    if ((inv.groups || []).some((g) => parseNumber(g.vat))) add('warning', 'vst-rc-ust', 'Reverse Charge: die Rechnung darf keine Umsatzsteuer ausweisen.')
  }
  if (small && t.gross > 0) add('info', 'klein', 'Kleinbetragsrechnung (bis 400 € brutto): vereinfachte Angaben genügen.')
  return out
}

const deDateShort = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '')

/** Vorsteuerabzug ohne Bedenken? (keine Warnung zu den Merkmalen nach § 11 UStG) */
export const vatDeductible = (problems) => !problems.some((p) => p.code.startsWith('vst'))

// ---------------------------------------------------------------- Nummern, Erfassung, Freigabe

/** Nächste eigene Eingangsnummer im Jahr: ER-2026-0001 (fortlaufend, für Ablage und Export). */
export function nextInvoiceNo(invoices = [], year, settings = PURCHASE_SETTINGS) {
  const prefix = settings.prefix || 'ER'
  const re = new RegExp(`^${prefix.replace(/[^A-Za-z0-9]/g, '')}-${year}-0*(\\d+)$`)
  const used = invoices.map((x) => Number(String(x.no || '').match(re)?.[1] || 0)).filter(Boolean)
  return `${prefix}-${year}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(Number(settings.digits) || 4, '0')}`
}

/** Darf die Erfassung noch geändert werden? Nicht nach Freigabe, Zahlung oder Storno. */
export const invoiceEditable = (inv) => !inv.cancelled && !inv.approval && !(inv.payments || []).length

/** Für die Zahlung gesperrt (Freigabe verlangt, aber noch nicht erteilt)? */
export const needsApproval = (inv, settings) => !!settings?.approval && !inv.approval && !inv.cancelled

/** Pfad des Belegs in SharePoint: einkauf/belege/JAHR/ER-2026-0001_Lieferant_Nummer.pdf */
export function belegPath(inv, ext = 'pdf', supplier = null) {
  const safe = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const year = String(inv.date || inv.receivedAt || '').slice(0, 4) || 'ohne-Jahr'
  const name = [inv.no || inv.id, safe(inv.supplier?.name || supplierName(supplier || {})), safe(inv.number)].filter(Boolean).join('_')
  return `einkauf/belege/${year}/${name}.${String(ext || 'pdf').toLowerCase()}`
}

// ---------------------------------------------------------------- E-Rechnung (ZUGFeRD/XRechnung) → Erfassung

/**
 * Felder einer Eingangsrechnung aus einer gelesenen E-Rechnung (core/fak-import.js → parseEInvoice):
 * { draft, supplier (vorhandener oder null), newSupplier (Vorschlag, wenn unbekannt), notes [] }.
 */
export function draftFromEInvoice(e, { suppliers = [] } = {}) {
  const seller = e.seller || {}
  const probe = { name: seller.name, uid: seller.uid, supplierNo: '' }
  const supplier = findSupplier(suppliers, probe)
  const groups = (e.total?.groups?.length ? e.total.groups : [{ rate: 20, net: e.total?.net || 0, vat: e.total?.vat || 0 }]).map((g) => ({ rate: Number(g.rate) || 0, net: round2(g.net), vat: round2(g.vat) }))
  const notes = []
  if (e.kind === 'korrektur') notes.push('Gutschrift/Rechnungskorrektur des Lieferanten: Beträge negativ erfasst.')
  if (e.currency && e.currency !== 'EUR') notes.push(`Währung ${e.currency}: Beträge bitte in Euro umrechnen.`)
  const sign = e.kind === 'korrektur' && grossOf(groups) > 0 ? -1 : 1
  const text = (e.lines || [])
    .slice(0, 6)
    .map((l) => [l.qty ? `${String(l.qty).replace('.', ',')} ${l.unit || ''}`.trim() : '', l.text].filter(Boolean).join(' '))
    .join('; ')
  const skonto = /(\d+(?:[.,]\d+)?)\s*%\s*skonto/i.exec(e.termsText || '')
  const skDays = /(\d+)\s*tage?n?\b[^.]*skonto|skonto[^.]*?(\d+)\s*tage?n?/i.exec(e.termsText || '')
  const draft = {
    supplierId: supplier?.id || '',
    supplier: { name: seller.name || '', address: composeAddress({ street: seller.street, zip: seller.zip, city: seller.city, country: seller.country || 'AT' }), uid: seller.uid || '' },
    number: e.number || '',
    date: e.date || '',
    serviceFrom: e.serviceFrom || e.date || '',
    serviceTo: e.serviceTo || e.serviceFrom || '',
    dueDate: e.dueDate || '',
    text: text.slice(0, 300),
    groups: groups.map((g) => ({ ...g, net: round2(sign * g.net), vat: round2(sign * g.vat) })),
    reverseCharge: !!e.reverseCharge,
    note: [e.reference ? `Bestellung/Zeichen: ${e.reference}` : '', e.refNumber ? `bezieht sich auf ${e.refNumber}` : ''].filter(Boolean).join(' · '),
    checks: { recipient: !!e.buyer?.name, ourUid: !!e.buyer?.uid, rcNote: !!e.reverseCharge },
    einvoice: { format: e.format },
    ...(skonto ? { skonto: { percent: parseNumber(skonto[1]), days: Number(skDays?.[1] || skDays?.[2]) || 0 } } : {}),
  }
  const newSupplier = supplier ? null : { name: seller.name || '', street: seller.street || '', zip: seller.zip || '', city: seller.city || '', country: seller.country || 'AT', uid: seller.uid || '', email: seller.email || '', phone: seller.phone || '', contacts: seller.contact ? [{ name: seller.contact, role: '', email: seller.email || '', phone: seller.phone || '' }] : [] }
  if (e.total?.gross && Math.abs(grossOf(draft.groups) - sign * e.total.gross) > 0.02) notes.push(`Summe der Steuersätze (${fmt(grossOf(draft.groups))}) weicht vom Rechnungsbetrag (${fmt(e.total.gross)}) ab.`)
  return { draft, supplier, newSupplier, notes }
}
const grossOf = (groups) => round2(groups.reduce((s, g) => s + (Number(g.net) || 0) + (Number(g.vat) || 0), 0))

// ---------------------------------------------------------------- Bank: Abbuchungen zuordnen

/** Abbuchung schon einer Eingangsrechnung zugeordnet? Zahlungen mit bank = Buchungs-ID. */
export function allocatedDebits(invoices = []) {
  const map = new Map()
  for (const inv of invoices) for (const p of inv.payments || []) if (p.bank && p.kind !== 'skonto') map.set(p.bank, [...(map.get(p.bank) || []), { invoiceId: inv.id, amount: p.amount }])
  return map
}

/** Abbuchungen aus dem Kontoauszug (Fakturierung → bank.tx), die noch keiner Eingangsrechnung zugeordnet und nicht ignoriert sind. */
export function openDebits(tx = [], doc = {}) {
  const used = allocatedDebits(doc.invoices || [])
  const ignored = doc.bankIgnored || {}
  return tx.filter((t) => t.amount < 0 && !t.reversal && !used.has(t.id) && !ignored[t.id]).sort((a, b) => String(b.date).localeCompare(String(a.date)))
}

const cents = (n) => Math.round(round2(n) * 100)
const sameAmount = (a, b) => Math.abs(cents(a) - cents(b)) <= 1

/**
 * Vorschlag für eine Abbuchung (Betrag negativ): { level ('sicher' | 'wahrscheinlich' | 'unsicher' | null),
 * allocations [{ invoiceId, amount }], reasons [] }. Sucht über Rechnungsnummer des Lieferanten im Text,
 * IBAN bzw. Name des Lieferanten und Betrag (auch abzüglich Skonto).
 */
export function suggestDebit(tx, { invoices = [], suppliers = [] } = {}) {
  const amount = round2(-tx.amount)
  if (!(amount > 0)) return { level: null, allocations: [], reasons: ['Kein Ausgang.'] }
  const open = invoices
    .filter((inv) => !inv.cancelled)
    .map((inv) => {
      const o = openOf(inv)
      return { inv, open: o, due: round2(o - skontoAvailableOn(inv, tx.date)) }
    })
    .filter((x) => x.open > 0.004)
  const text = `${tx.reference || ''} ${tx.text || ''}`
  const squashed = normalizeNumber(text)
  // 1. Rechnungsnummer des Lieferanten (oder unsere Eingangsnummer) im Verwendungszweck
  const named = open.filter((x) => {
    const n = normalizeNumber(x.inv.number)
    const ours = normalizeNumber(x.inv.no)
    return (n.length >= 4 && squashed.includes(n)) || (ours.length >= 6 && squashed.includes(ours))
  })
  const fits = (x) => sameAmount(x.open, amount) || sameAmount(x.due, amount)
  const take = (list, reasons, level) => ({ level, allocations: list.map((x) => ({ invoiceId: x.inv.id, amount: list.length === 1 ? amount : sameAmount(x.due, x.open) ? x.open : x.due })), reasons })
  if (named.length === 1) {
    const x = named[0]
    if (sameAmount(x.open, amount)) return take([x], [`Rechnungsnummer ${x.inv.number} im Verwendungszweck`, 'Betrag stimmt mit dem offenen Betrag'], 'sicher')
    if (sameAmount(x.due, amount)) return take([x], [`Rechnungsnummer ${x.inv.number} im Verwendungszweck`, `Betrag = offen abzüglich Skonto (${fmt(x.open - x.due)})`], 'sicher')
    return take([x], [`Rechnungsnummer ${x.inv.number} im Verwendungszweck`, amount < x.open ? `Teilzahlung: ${fmt(amount)} von ${fmt(x.open)}` : `Betrag ${fmt(amount)} höher als offen (${fmt(x.open)})`], 'wahrscheinlich')
  }
  if (named.length > 1) {
    const sum = round2(named.reduce((s, x) => s + x.open, 0))
    if (sameAmount(sum, amount)) return { level: 'sicher', allocations: named.map((x) => ({ invoiceId: x.inv.id, amount: x.open })), reasons: [`Rechnungsnummern ${named.map((x) => x.inv.number).join(', ')} im Verwendungszweck`, 'Betrag = Summe der offenen Beträge'] }
  }
  // 2. Lieferant über IBAN oder Namen
  const iban = cleanIban(tx.iban)
  const byIban = iban ? suppliers.filter((s) => cleanIban(s.iban) === iban) : []
  const byName = suppliers.filter((s) => nameScore(tx.name || tx.text, supplierName(s)) >= 0.6)
  const sup = byIban[0] || (byName.length === 1 ? byName[0] : null)
  const how = byIban[0] ? `IBAN von ${supplierName(byIban[0])}` : sup ? `Name passt zu ${supplierName(sup)}` : ''
  const pool = sup ? open.filter((x) => x.inv.supplierId === sup.id) : []
  if (pool.length) {
    const exact = pool.filter(fits)
    if (exact.length === 1) return take(exact, [how, `Betrag stimmt mit ${exact[0].inv.number || exact[0].inv.no}${sameAmount(exact[0].open, amount) ? '' : ' abzüglich Skonto'}`], byIban[0] ? 'sicher' : 'wahrscheinlich')
    if (exact.length > 1) return take([exact[0]], [how, `${exact.length} Rechnungen mit diesem Betrag: die älteste vorgeschlagen`], 'wahrscheinlich')
    return { level: 'unsicher', allocations: [], reasons: [how, 'Betrag passt zu keiner offenen Rechnung des Lieferanten'] }
  }
  // 3. nur der Betrag
  const exact = open.filter(fits)
  if (exact.length === 1) return take(exact, [`Nur der Betrag passt zu ${exact[0].inv.number || exact[0].inv.no} (${exact[0].inv.supplier?.name || ''}); Empfänger prüfen`], 'unsicher')
  return { level: null, allocations: [], reasons: [exact.length > 1 ? `${exact.length} offene Rechnungen mit diesem Betrag: bitte von Hand wählen` : 'Keine passende offene Eingangsrechnung'] }
}

/**
 * Abbuchung zuordnen: je Rechnung eine Zahlung (Datum der Bank, Verweis auf die Buchung, ggf. Skonto). Prüft,
 * dass die Beträge den Ausgang ergeben. Gibt die betroffenen Rechnungen zurück.
 */
export function applyDebit(tx, allocations, invoices, { by = '', at = new Date().toISOString(), newId } = {}) {
  const amount = round2(-tx.amount)
  const sum = round2(allocations.reduce((s, a) => s + parseNumber(a.amount), 0))
  if (!allocations.length) throw new Error('Keine Rechnung gewählt.')
  if (!sameAmount(sum, amount)) throw new Error(`Die Beträge (${fmt(sum)}) ergeben nicht den Ausgang (${fmt(amount)}).`)
  const targets = allocations.map((a) => invoices.find((x) => x.id === a.invoiceId))
  if (targets.some((x) => !x || x.cancelled)) throw new Error('Rechnung nicht gefunden oder storniert.')
  return allocations.map((a, i) => {
    const inv = targets[i]
    const entries = purchasePaymentEntries(inv, { date: tx.date, amount: round2(parseNumber(a.amount)), method: tx.text && /lastschrift|einzug|sepa-?ls/i.test(tx.text) ? 'lastschrift' : 'bank', bank: tx.id, note: `Bank${tx.name ? `: ${tx.name}` : ''}`, by, at }, { newId })
    inv.payments = [...(inv.payments || []), ...entries]
    inv.history = [...(inv.history || []), { at, by, text: `Zahlung ${fmt(a.amount)} vom ${deDateShort(tx.date)} (Bankabgleich)${entries[1] ? `, Skonto ${fmt(entries[1].amount)}` : ''}` }]
    return inv
  })
}

/** Zuordnung einer Abbuchung lösen. */
export function undoDebit(txId, invoices, opts = {}) {
  let n = 0
  for (const inv of invoices) if (removePayment(inv, (p) => p.bank === txId, { ...opts, text: 'Zahlung aus dem Bankabgleich wieder entfernt' })) n++
  return n
}

// ---------------------------------------------------------------- Überweisungen (SEPA pain.001)

/**
 * Zahlungen für die Überweisungsdatei aus ausgewählten Rechnungen: Betrag mit Skonto, solange die Frist am
 * Ausführungstag läuft, sonst der offene Betrag; IBAN/BIC des Lieferanten; Verwendungszweck mit Rechnungsnummer
 * und unserer Kundennummer. Liefert { payments: [{ id, invoiceId, name, iban, bic, amount, skonto, text, ref }], problems: [] }.
 */
export function transferPayments(invoiceIds = [], doc = {}, date, settings = purchaseSettings(doc)) {
  const supById = new Map((doc.suppliers || []).map((s) => [s.id, s]))
  const payments = []
  const problems = []
  for (const id of invoiceIds) {
    const inv = (doc.invoices || []).find((x) => x.id === id)
    if (!inv) continue
    const label = `${inv.supplier?.name || ''} ${inv.number || inv.no}`.trim()
    if (inv.cancelled) {
      problems.push(`${label}: storniert.`)
      continue
    }
    if (needsApproval(inv, settings)) {
      problems.push(`${label}: noch nicht freigegeben.`)
      continue
    }
    const open = openOf(inv)
    if (!(open > 0.004)) {
      problems.push(`${label}: schon bezahlt.`)
      continue
    }
    const sup = supById.get(inv.supplierId) || {}
    const sk = skontoAvailableOn(inv, date)
    const amount = round2(open - sk)
    if (!sup.iban) problems.push(`${label}: beim Lieferanten fehlt die IBAN.`)
    const text = ['Rechnung', inv.number || inv.no, sup.customerNo ? `Kd-Nr. ${sup.customerNo}` : '', sk ? `abzgl. ${String(skontoOfInvoice(inv).percent).replace('.', ',')} % Skonto` : ''].filter(Boolean).join(' ')
    payments.push({ id: inv.id, invoiceId: inv.id, name: supplierName(sup) || inv.supplier?.name || '', iban: sup.iban || '', bic: sup.bic || '', amount, skonto: sk, text, ref: inv.no || inv.id })
  }
  return { payments, problems }
}

/** Überweisungslauf vermerken (Datei erzeugt, noch nicht bezahlt): bei jeder Rechnung sepa { runId, date, amount }. */
export function markTransferRun(doc, run, payments) {
  doc.sepaRuns = [...(doc.sepaRuns || []), run]
  for (const p of payments) {
    const inv = (doc.invoices || []).find((x) => x.id === p.invoiceId)
    if (!inv) continue
    inv.sepa = { runId: run.id, date: run.date, amount: p.amount, at: run.at }
    inv.history = [...(inv.history || []), { at: run.at, by: run.by, text: `Überweisung ${fmt(p.amount)} zum ${deDateShort(run.date)} in der Überweisungsdatei` }]
  }
}

/** Überweisungslauf als bezahlt buchen (wenn die Bank ihn ausgeführt hat): je Rechnung eine Zahlung, ggf. mit Skonto. */
export function bookTransferRun(doc, runId, { by = '', at = new Date().toISOString(), newId } = {}) {
  const run = (doc.sepaRuns || []).find((r) => r.id === runId)
  if (!run) throw new Error('Überweisungslauf nicht gefunden.')
  let n = 0
  for (const inv of doc.invoices || []) {
    if (inv.sepa?.runId !== runId || inv.cancelled || (inv.payments || []).some((p) => p.sepa === runId)) continue
    if (!(openOf(inv) > 0.004)) continue
    const entries = purchasePaymentEntries(inv, { date: run.date, amount: inv.sepa.amount, method: 'sepa', sepa: runId, note: 'Überweisung (Sammelauftrag)', by, at }, { newId })
    inv.payments = [...(inv.payments || []), ...entries]
    inv.history = [...(inv.history || []), { at, by, text: `als bezahlt gebucht (Überweisung vom ${deDateShort(run.date)})${entries[1] ? `, Skonto ${fmt(entries[1].amount)}` : ''}` }]
    n++
  }
  run.booked = { at, by }
  return n
}

// ---------------------------------------------------------------- Auswertung

/** Ausgaben (netto) je Monat und Kategorie im Jahr: { months: [{ month, net, vat, gross, count }], categories: [{ category, name, net }] }. */
export function spendingByMonth(invoices = [], year, settings = PURCHASE_SETTINGS) {
  const cats = new Map((settings.categories || DEFAULT_CATEGORIES).map((c) => [c.id, c.name]))
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, net: 0, vat: 0, gross: 0, count: 0 }))
  const byCat = new Map()
  for (const inv of invoices) {
    if (inv.cancelled || !String(inv.date || '').startsWith(String(year))) continue
    const t = invoiceTotals(inv)
    const m = months[Number(inv.date.slice(5, 7)) - 1]
    m.net = round2(m.net + t.net)
    m.vat = round2(m.vat + t.vat)
    m.gross = round2(m.gross + t.gross)
    m.count++
    const key = inv.category || ''
    byCat.set(key, round2((byCat.get(key) || 0) + t.net))
  }
  const categories = [...byCat].map(([category, net]) => ({ category, name: cats.get(category) || (category ? category : 'ohne Kategorie'), net })).sort((a, b) => b.net - a.net)
  return { months, categories }
}

/** Kennzahlen für Übersicht und Startseite: { open, openCount, overdue, overdueCount, week, weekCount, skontoChance }. */
export function payablesSummary(invoices = [], today) {
  const list = payables(invoices, today)
  const week = dueThisWeek(invoices, today)
  const overdue = list.filter((x) => x.overdueDays > 0)
  const sum = (l, f = (x) => x.open) => round2(l.reduce((s, x) => s + f(x), 0))
  return { open: sum(list), openCount: list.length, overdue: sum(overdue), overdueCount: overdue.length, week: sum(week, (x) => (x.skonto ? x.skonto.payable : x.open)), weekCount: week.length, skontoChance: sum(list.filter((x) => x.skonto), (x) => x.skonto.amount) }
}

// ---------------------------------------------------------------- Export für die Steuerberatung (CSV, BMD/RZL)

/** Spalten wie beim Export der Fakturierung (core/invoicing.js → EXPORT_COLUMNS), Konto ist hier der Kreditor. */
export const PURCHASE_EXPORT_COLUMNS = {
  belegnr: ['Belegnummer', (r) => r.number],
  belegdatum: ['Belegdatum', (r, f) => f.date(r.date)],
  belegart: ['Belegart', (r) => r.kindLabel],
  konto: ['Konto (Kreditor)', (r) => r.creditor],
  gegenkonto: ['Gegenkonto (Aufwand)', (r) => r.account],
  lieferant: ['Lieferant', (r) => r.supplier],
  uid: ['UID Lieferant', (r) => r.uid],
  rechnungsnr: ['Rechnungsnummer Lieferant', (r) => r.extNumber],
  steuersatz: ['Steuersatz', (r, f) => f.num(r.rate)],
  steuercode: ['Steuercode', (r) => r.code],
  netto: ['Netto', (r, f) => f.num(r.net)],
  steuer: ['Vorsteuer', (r, f) => f.num(r.vat)],
  brutto: ['Brutto', (r, f) => f.num(r.gross)],
  leistung: ['Leistungszeitraum', (r, f) => [f.date(r.serviceFrom), r.serviceTo && r.serviceTo !== r.serviceFrom ? f.date(r.serviceTo) : ''].filter(Boolean).join('–')],
  faellig: ['Fällig', (r, f) => f.date(r.dueDate)],
  kostenstelle: ['Kostenstelle', (r) => r.costCenter],
  text: ['Text', (r) => r.text],
}
export const PURCHASE_EXPORT_DEFAULT = ['belegnr', 'belegdatum', 'belegart', 'konto', 'gegenkonto', 'lieferant', 'uid', 'rechnungsnr', 'steuersatz', 'steuercode', 'netto', 'steuer', 'brutto', 'leistung', 'kostenstelle', 'text']

/** Skontobetrag (brutto) anteilig auf die Steuersätze aufteilen: [{ rate, gross, net, vat }]. */
export function skontoSplitPurchase(inv, amount) {
  const t = invoiceTotals(inv)
  const g2 = t.groups.map((g) => round2(g.net + g.vat))
  const all = round2(g2.reduce((a, b) => a + b, 0))
  if (!t.groups.length || !all) return []
  let rest = round2(amount)
  return t.groups
    .map((g, i) => {
      const part = i === t.groups.length - 1 ? rest : round2((amount * g2[i]) / all)
      rest = round2(rest - part)
      const net = round2(part / (1 + (g.vat ? g.rate : 0) / 100))
      return { rate: g.rate, gross: part, net, vat: round2(part - net) }
    })
    .filter((x) => x.gross)
}

/**
 * Buchungszeilen: je Eingangsrechnung und Steuersatz eine Zeile (Belegart ER, Rechnungsdatum im Zeitraum), dazu
 * Skonto-Abzüge mit Zahlungsdatum im Zeitraum (Belegart SK, negativ: Vorsteuer berichtigen, § 16 Abs 1 UStG).
 * Reverse Charge: Steuercode RC19-1a, Vorsteuer = geschuldete Steuer. Stornierte Erfassungen fehlen.
 */
export function purchaseExportRows(doc = {}, { from, to, objectsById = new Map() } = {}) {
  const s = purchaseSettings(doc)
  const supById = new Map((doc.suppliers || []).map((x) => [x.id, x]))
  const catById = new Map(s.categories.map((c) => [c.id, c]))
  const rows = []
  for (const inv of doc.invoices || []) {
    if (inv.cancelled) continue
    const sup = supById.get(inv.supplierId) || {}
    const base = {
      creditor: sup.account || sup.supplierNo || s.accounts.kreditor || '',
      account: inv.account || catById.get(inv.category)?.account || sup.expenseAccount || '',
      supplier: inv.supplier?.name || supplierName(sup),
      uid: inv.supplier?.uid || sup.uid || '',
      extNumber: inv.number || '',
      code: inv.reverseCharge ? 'RC19-1a' : '',
      serviceFrom: inv.serviceFrom,
      serviceTo: inv.serviceTo,
      dueDate: inv.dueDate,
      costCenter: inv.costCenter || objectsById.get(inv.objectId)?.name || inv.vehicleLabel || '',
    }
    const t = invoiceTotals(inv)
    if (inv.date >= from && inv.date <= to)
      for (const g of t.groups) {
        const vat = inv.reverseCharge ? round2((g.net * (g.rate || 20)) / 100) : g.vat
        rows.push({ ...base, number: inv.no || inv.number, date: inv.date, kindLabel: 'ER', rate: g.rate, net: g.net, vat, gross: round2(g.net + g.vat), text: ['Eingangsrechnung', inv.number, base.supplier, inv.text ? `– ${String(inv.text).slice(0, 60)}` : ''].filter(Boolean).join(' ') })
      }
    for (const p of (inv.payments || []).filter((x) => x.kind === 'skonto' && x.date >= from && x.date <= to))
      for (const g of skontoSplitPurchase(inv, parseNumber(p.amount)))
        rows.push({ ...base, account: s.accounts.skonto || base.account, number: inv.no || inv.number, date: p.date, kindLabel: 'SK', rate: g.rate, net: -g.net, vat: -g.vat, gross: -g.gross, text: `Skonto zu ${inv.number || inv.no} ${base.supplier}`.trim() })
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.number).localeCompare(String(b.number)))
}

/** CSV wie der Export der Fakturierung: Semikolon, Dezimalbeistrich, Datum TT.MM.JJJJ, CRLF. */
export function toCsv(rows, columnsDef, columns, { sep = ';', decimal = ',', header = true } = {}) {
  const f = {
    num: (n) => (n === '' || n == null ? '' : Number.isFinite(Number(n)) ? Number(n).toFixed(2).replace('.', decimal) : ''),
    date: (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : ''),
  }
  const cell = (v) => {
    const t = String(v ?? '')
    return t.includes(sep) || t.includes('"') || /\r|\n/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const cols = columns.filter((c) => columnsDef[c])
  const lines = rows.map((r) => cols.map((c) => cell(columnsDef[c][1](r, f))).join(sep))
  if (header) lines.unshift(cols.map((c) => cell(columnsDef[c][0])).join(sep))
  return `${lines.join('\r\n')}\r\n`
}

export const purchaseCsv = (rows, columns = PURCHASE_EXPORT_DEFAULT) => toCsv(rows, PURCHASE_EXPORT_COLUMNS, columns)

// ---------------------------------------------------------------- Übernahme (orgaMAX und andere)

/** Prüfsumme über die Erfassung (für übernommene Altbelege: erkennt spätere Änderungen). */
export const purchaseChecksum = (inv) => fnv1a(JSON.stringify([inv.supplierId, inv.number, inv.date, inv.groups, inv.reverseCharge || false]))

const mergeEmpty = (target, source, skip = []) => {
  let n = 0
  for (const [k, v] of Object.entries(source)) {
    if (skip.includes(k) || v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue
    if (target[k] === undefined || target[k] === null || target[k] === '' || (Array.isArray(target[k]) && !target[k].length)) {
      target[k] = v
      n++
    }
  }
  return n
}

/**
 * Daten aus orgaMAX (oder einem anderen Programm) einspielen – idempotent: eine zweite Übernahme legt nichts doppelt an.
 *
 *  data      App-Daten { einkauf, kasse } (werden ergänzt; fehlen sie, werden sie angelegt)
 *  suppliers [{ supplierNo, name, …Felder wie oben…, source: { system, id } }]
 *            gleiche Lieferantennummer, Quelle, UID oder IBAN: nur leere Felder ergänzen; gleiche Nummer mit anderem
 *            Namen wird gemeldet und nicht zusammengelegt
 *  invoices  [{ supplierNo | supplierRef (Quelle des Lieferanten) | supplierName, number, date, serviceFrom, serviceTo,
 *              groups | { net, vat, rate } | gross, dueDate, skonto, category, account, text, note, payments,
 *              source: { system, id } }]
 *            gleiche Quelle oder gleicher Lieferant mit gleicher Rechnungsnummer: übersprungen
 *  cash      Kassenbuch-Einträge [{ date, kind ('einnahme' | 'ausgabe'), amount, text, rate, vat, account, receipt,
 *              source: { system, id } | no }] → core/cashbook.js importCash (fortlaufend nummeriert)
 * Liefert { added: { suppliers, invoices, cash }, updated: { suppliers }, skipped: [{ type, ref, reason }], warnings: [] }.
 */
export function mergePurchaseImport(data, { suppliers = [], invoices = [], cash = [] } = {}, { newId = () => Math.random().toString(36).slice(2, 10), now = new Date().toISOString(), by = 'Übernahme', system = 'orgaMAX' } = {}) {
  data.einkauf ||= emptyPurchase()
  const doc = data.einkauf
  for (const k of ['suppliers', 'invoices', 'sepaRuns']) doc[k] ||= []
  doc.bankIgnored ||= {}
  doc.settings ||= {}
  const report = { added: { suppliers: 0, invoices: 0, cash: 0 }, updated: { suppliers: 0 }, skipped: [], warnings: [] }
  const renumbered = new Map() // Nummer aus dem Altsystem → neu angelegter Lieferant (Nummer war in der App schon vergeben)
  const bySource = new Map() // Quelle (interne ID im Altsystem) → Lieferant in der App, auch wenn er schon vorher da war
  const remember = (source, sup) => source && bySource.set(source.id, sup)
  const refOf = (x) => (x.source?.id != null ? { system: x.source.system || system, id: String(x.source.id) } : null)

  for (const raw of suppliers) {
    const source = refOf(raw)
    const probe = { ...raw, source }
    const name = supplierName(raw)
    if (!name && !raw.supplierNo) {
      report.skipped.push({ type: 'lieferant', ref: source?.id || '', reason: 'ohne Name und Nummer' })
      continue
    }
    const hit = findSupplier(doc.suppliers, probe)
    if (hit) {
      if (raw.supplierNo && hit.supplierNo === String(raw.supplierNo) && name && nameScore(name, supplierName(hit)) < 0.6) {
        // gleiche Nummer, anderer Lieferant: nicht zusammenlegen, sondern mit neuer Nummer anlegen (Rechnungen hängen daran);
        // bei einer zweiten Übernahme wird dieser über die alte Nummer (importedNo) wiedergefunden
        const before = doc.suppliers.find((x) => x.importedNo === String(raw.supplierNo) && nameScore(name, supplierName(x)) >= 0.6)
        if (before) {
          renumbered.set(String(raw.supplierNo), before)
          remember(source, before)
          if (mergeEmpty(before, { ...raw, source }, ['id', 'supplierNo', 'importedNo'])) report.updated.suppliers++
          continue
        }
        const fresh = { ...raw, id: newId(), supplierNo: nextSupplierNo(doc.suppliers), importedNo: String(raw.supplierNo), country: raw.country || 'AT', source: source || { system }, note: [raw.note, `Lieferantennummer in ${system}: ${raw.supplierNo}`].filter(Boolean).join(' · '), createdAt: now }
        if (fresh.uid) fresh.uid = String(fresh.uid).replace(/\s+/g, '').toUpperCase()
        if (fresh.iban) fresh.iban = cleanIban(fresh.iban)
        doc.suppliers.push(fresh)
        renumbered.set(String(raw.supplierNo), fresh)
        remember(source, fresh)
        report.added.suppliers++
        report.warnings.push(`Lieferantennummer ${raw.supplierNo}: „${name}“ heißt in der App „${supplierName(hit)}“ – als eigener Lieferant Nr. ${fresh.supplierNo} angelegt.`)
        continue
      }
      remember(source, hit)
      if (mergeEmpty(hit, { ...raw, source }, ['id', 'supplierNo'])) report.updated.suppliers++
      continue
    }
    const s = { ...raw, id: newId(), supplierNo: String(raw.supplierNo || nextSupplierNo(doc.suppliers)), country: raw.country || 'AT', source: source || { system }, createdAt: now }
    if (s.uid) s.uid = String(s.uid).replace(/\s+/g, '').toUpperCase()
    if (s.iban) s.iban = cleanIban(s.iban)
    doc.suppliers.push(s)
    remember(source, s)
    report.added.suppliers++
  }

  const supplierFor = (x) =>
    (x.supplierRef && bySource.get(String(x.supplierRef))) ||
    (x.supplierRef && doc.suppliers.find((s) => s.source && String(s.source.id) === String(x.supplierRef))) ||
    (x.supplierNo && renumbered.get(String(x.supplierNo))) ||
    (x.supplierNo && doc.suppliers.find((s) => String(s.supplierNo) === String(x.supplierNo))) ||
    (x.supplierName && findSupplier(doc.suppliers, { name: x.supplierName })) ||
    null
  for (const raw of invoices) {
    const source = refOf(raw)
    if (source && doc.invoices.some((x) => x.imported?.system === source.system && String(x.imported.ref) === source.id)) {
      report.skipped.push({ type: 'rechnung', ref: source.id, reason: 'schon übernommen' })
      continue
    }
    let sup = supplierFor(raw)
    if (!sup && raw.supplierName) {
      sup = { id: newId(), supplierNo: nextSupplierNo(doc.suppliers), name: raw.supplierName, country: 'AT', source: { system }, createdAt: now }
      doc.suppliers.push(sup)
      report.added.suppliers++
    }
    if (!sup) {
      report.skipped.push({ type: 'rechnung', ref: raw.number || source?.id || '', reason: 'Lieferant unbekannt' })
      continue
    }
    const groups = raw.groups?.length
      ? raw.groups.map((g) => ({ rate: parseNumber(g.rate), net: round2(parseNumber(g.net)), vat: round2(parseNumber(g.vat)) }))
      : raw.net != null || raw.gross != null
        ? [raw.net != null ? { rate: parseNumber(raw.rate ?? 20), net: round2(parseNumber(raw.net)), vat: round2(raw.vat != null ? parseNumber(raw.vat) : vatFor(raw.net, raw.rate ?? 20)) } : { rate: parseNumber(raw.rate ?? 20), ...splitGross(raw.gross, raw.rate ?? 20) }].map(({ rate, net, vat }) => ({ rate, net, vat }))
        : []
    const inv = {
      id: newId(),
      supplierId: sup.id,
      supplier: { name: supplierName(sup), address: supplierAddress(sup), uid: sup.uid || '' },
      number: String(raw.number || ''),
      date: raw.date || '',
      serviceFrom: raw.serviceFrom || raw.date || '',
      serviceTo: raw.serviceTo || raw.serviceFrom || raw.date || '',
      receivedAt: raw.receivedAt || raw.date || '',
      text: raw.text || '',
      groups,
      reverseCharge: !!raw.reverseCharge,
      dueDate: raw.dueDate || dueFor(raw.date, sup.paymentDays ?? 14),
      ...(raw.skonto ? { skonto: { percent: parseNumber(raw.skonto.percent), days: Number(raw.skonto.days) || 0 } } : {}),
      category: raw.category || sup.category || '',
      account: raw.account || sup.expenseAccount || '',
      note: raw.note || '',
      checks: { recipient: true, ourUid: true, rcNote: !!raw.reverseCharge },
      payments: (raw.payments || []).map((p) => ({ id: newId(), date: p.date, amount: round2(parseNumber(p.amount)), ...(p.kind ? { kind: p.kind } : {}), method: p.method || 'bank', note: p.note || `übernommen aus ${system}`, by, at: now })),
      imported: { system: source?.system || system, at: now, ref: source?.id || String(raw.number || '') },
      history: [{ at: now, by, text: `übernommen aus ${source?.system || system}` }],
      createdAt: now,
      createdBy: by,
    }
    if (findDuplicates(doc.invoices, inv, doc.suppliers).same.length) {
      report.skipped.push({ type: 'rechnung', ref: inv.number, reason: 'gleicher Lieferant und Nummer schon erfasst' })
      continue
    }
    inv.no = raw.no || nextInvoiceNo(doc.invoices, String(inv.date || now).slice(0, 4), purchaseSettings(doc))
    inv.checksum = purchaseChecksum(inv)
    doc.invoices.push(inv)
    report.added.invoices++
  }

  if (cash.length) {
    data.kasse ||= emptyCashbook()
    const r = importCash(data.kasse, cash, { newId, now, by, system })
    report.added.cash = r.added
    report.skipped.push(...r.skipped.map((x) => ({ type: 'kasse', ...x })))
    report.warnings.push(...r.warnings)
  }
  return report
}

// ---------------------------------------------------------------- Abgleich mit der Bestellung (Material & Lager)

/** Toleranz beim Abgleich: 2 % des Werts, mindestens 5 € (Rundung, Fracht, Kleinmengen). */
export const ORDER_TOLERANCE = { pct: 2, abs: 5 }
const orderValue = (order, field) => round2((order?.lines || []).reduce((s, l) => s + parseNumber(field(l)) * parseNumber(l.price), 0))
const tolerance = (base) => Math.max(ORDER_TOLERANCE.abs, (Math.abs(base) * ORDER_TOLERANCE.pct) / 100)
const eur = (n) => `${round2(n).toFixed(2).replace('.', ',')} €`

/**
 * Eingangsrechnung gegen ihre Bestellung (inv.orderId → material.orders): { order, ordered, received, invoiced, others,
 * othersNet, basis, diff, level ('ok' | 'info' | 'warn'), notes [{ level, text }] } oder null ohne Verknüpfung.
 * Verglichen wird die Summe aller Rechnungen zur Bestellung (netto) mit dem Wert der gelieferten Ware (Wareneingang ×
 * Preis der Bestellung), solange nichts geliefert ist mit dem Bestellwert. Rechnungen haben keine Positionen: der
 * Vergleich geht über den Nettobetrag.
 */
export function orderMatch(inv, { orders = [], invoices = [] } = {}) {
  if (!inv?.orderId) return null
  const order = orders.find((o) => o.id === inv.orderId)
  if (!order) return { order: null, level: 'warn', notes: [{ level: 'warn', text: 'Die verknüpfte Bestellung gibt es nicht mehr (oder Material & Lager ist für diese Rolle nicht lesbar).' }] }
  const ordered = orderValue(order, (l) => l.qty)
  const received = orderValue(order, (l) => l.received || 0)
  const invoiced = invoiceTotals(inv).net
  const others = invoices.filter((x) => x.id !== inv.id && !x.cancelled && x.orderId === inv.orderId)
  const othersNet = round2(others.reduce((s, x) => s + invoiceTotals(x).net, 0))
  const basis = received > 0.004 ? received : ordered
  const total = round2(invoiced + othersNet)
  const diff = round2(total - basis)
  const tol = tolerance(basis)
  const notes = []
  if (order.status === 'storniert') notes.push({ level: 'warn', text: `Die Bestellung ${order.no || ''} ist storniert.`.replace('  ', ' ') })
  if (received <= 0.004) notes.push({ level: 'info', text: `Wareneingang noch nicht gebucht – verglichen mit dem Bestellwert ${eur(ordered)}.` })
  else if (received < ordered - 0.004) notes.push({ level: 'info', text: `Erst teilweise geliefert: ${eur(received)} von ${eur(ordered)}.` })
  if (others.length) notes.push({ level: 'info', text: `Zur selben Bestellung ${others.length === 1 ? 'gibt es schon die Rechnung' : `gibt es schon ${others.length} Rechnungen`} ${others.map((x) => x.no || x.number).join(', ')} über ${eur(othersNet)}.` })
  if (diff > tol) notes.push({ level: 'warn', text: `${others.length ? 'Die Rechnungen liegen zusammen' : 'Die Rechnung liegt'} ${eur(diff)} über dem Wert ${received > 0.004 ? 'der gelieferten Ware' : 'der Bestellung'} (${eur(basis)}). Preise, Mengen und eine mögliche Doppelverrechnung prüfen.` })
  else if (diff < -tol) notes.push({ level: 'info', text: `${eur(-diff)} unter dem Wert ${received > 0.004 ? 'der gelieferten Ware' : 'der Bestellung'} – Teilrechnung oder Gutschrift?` })
  const level = notes.some((n) => n.level === 'warn') ? 'warn' : diff < -tol || received <= 0.004 ? 'info' : 'ok'
  return { order, ordered, received, invoiced, others, othersNet, basis, diff, level, notes }
}

/**
 * Passende Bestellung für eine noch nicht verknüpfte Eingangsrechnung: offene bzw. gelieferte Bestellungen beim
 * verknüpften Lieferanten (suppliers[].materialId), noch ohne Rechnung, deren Lieferwert (sonst Bestellwert) innerhalb der
 * Toleranz zum Nettobetrag liegt; die nächstliegende. null, wenn keine passt.
 */
export function suggestOrder(inv, { orders = [], suppliers = [], invoices = [] } = {}) {
  if (!inv || inv.orderId || inv.cancelled) return null
  const sup = suppliers.find((s) => s.id === inv.supplierId)
  if (!sup?.materialId) return null
  const used = new Set(invoices.filter((x) => !x.cancelled && x.orderId).map((x) => x.orderId))
  const net = invoiceTotals(inv).net
  let best = null
  for (const o of orders) {
    if (o.supplierId !== sup.materialId || used.has(o.id) || !['bestellt', 'teilweise', 'geliefert'].includes(o.status)) continue
    const received = orderValue(o, (l) => l.received || 0)
    const base = received > 0.004 ? received : orderValue(o, (l) => l.qty)
    const d = Math.abs(base - net)
    if (d <= tolerance(base) && (!best || d < best.d)) best = { order: o, value: base, d }
  }
  return best ? { order: best.order, value: best.value } : null
}
