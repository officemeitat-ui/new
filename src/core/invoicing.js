// Fakturierung: Angebote, Auftragsbestätigungen, Rechnungen, Stornorechnungen und
// Rechnungskorrekturen, Daueraufträge mit Wertsicherung, offene Posten und Mahnwesen.
// Datei fakturierung/fakturierung.json (Oberfläche: ui/views/invoicing.js, PDF: export/invoice-pdf.js).
//
// Österreichisches Recht (Stand 2026, Quellen in docs/RECHTSPRUEFUNG.md → Fakturierung):
//  - Rechnungsmerkmale § 11 Abs 1 UStG: Name und Anschrift von Unternehmer und Empfänger, Menge und
//    Bezeichnung, Tag bzw. Zeitraum der Leistung, Entgelt je Steuersatz, Steuerbetrag, Ausstellungsdatum,
//    fortlaufende Nummer, UID des Ausstellers; über 10.000 € brutto auch die UID des Empfängers.
//  - Kleinbetragsrechnung bis 400 € brutto (§ 11 Abs 6): vereinfachte Angaben genügen.
//  - Reverse Charge für Bauleistungen (§ 19 Abs 1a): Reinigung von Bauwerken zählt seit 2011 dazu,
//    aber nur, wenn der Empfänger selbst üblicherweise Bauleistungen erbringt oder mit der Leistung
//    beauftragt ist (z. B. eine andere Reinigungsfirma, ein Generalunternehmer). Dann keine USt, Hinweis
//    auf die Steuerschuld des Empfängers und beide UIDs auf die Rechnung (§ 11 Abs 1a).
//  - Kleinunternehmer (§ 6 Abs 1 Z 27): nur als Einstellung, mit Hinweis statt Steuer.
//  - Einmal ausgestellte Rechnungen werden nicht geändert oder gelöscht, sondern storniert bzw.
//    korrigiert (eigene Belege mit eigener Nummer). Aufbewahrung 7 Jahre (§ 132 BAO).
//  - Mahnungen unter Unternehmern: Verzugszinsen 9,2 Prozentpunkte über dem Basiszinssatz (§ 456 UGB),
//    40 € Pauschale für Betreibungskosten (§ 458 UGB); gegenüber Verbrauchern 4 % (§ 1000 ABGB).
//
// „Gutschrift“ heißt im UStG die Abrechnung durch den Empfänger (§ 11 Abs 7). Belege des Ausstellers,
// die eine Rechnung ganz oder teilweise zurücknehmen, heißen hier Stornorechnung bzw. Rechnungskorrektur.

export const KINDS = {
  angebot: 'Angebot',
  auftrag: 'Auftragsbestätigung',
  rechnung: 'Rechnung',
  storno: 'Stornorechnung',
  korrektur: 'Rechnungskorrektur',
}
/** Belege, die Umsatz sind (Ausgangsrechnungen samt Storno und Korrektur). */
export const INVOICE_KINDS = ['rechnung', 'storno', 'korrektur']
export const isInvoice = (d) => INVOICE_KINDS.includes(d?.kind)

export const VAT_RATES = [20, 13, 10, 0]
export const UNITS = ['Pauschale', 'Monat', 'Std.', 'm²', 'Stk', 'Einsatz', 'km', 'Quartal']
export const INTERVALS = { monat: 'monatlich', quartal: 'quartalsweise', halbjahr: 'halbjährlich', jahr: 'jährlich' }
const INTERVAL_MONTHS = { monat: 1, quartal: 3, halbjahr: 6, jahr: 12 }

export const SMALL_AMOUNT = 400 // § 11 Abs 6 UStG: Kleinbetragsrechnung bis 400 € brutto
export const UID_LIMIT = 10000 // § 11 Abs 1 Z 3 lit i UStG: UID des Empfängers über 10.000 € brutto
export const B2B_INTEREST_MARGIN = 9.2 // § 456 UGB: Prozentpunkte über dem Basiszinssatz
export const CONSUMER_INTEREST = 4 // § 1000 ABGB
export const B2B_FLAT_FEE = 40 // § 458 UGB

export const RC_TEXT = 'Die Steuerschuld geht auf den Leistungsempfänger über (Reverse Charge gemäß § 19 Abs. 1a UStG, Bauleistungen).'
export const SMALL_BUSINESS_TEXT = 'Umsatzsteuerbefreit – Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG.'

export const SERIES_DEFAULTS = { rechnung: 'RE', storno: 'ST', korrektur: 'KO', angebot: 'AN', auftrag: 'AB' }

export const REMINDER_DEFAULTS = [
  { name: 'Zahlungserinnerung', days: 7, interest: false, fee: false, deadline: 7 },
  { name: '1. Mahnung', days: 14, interest: true, fee: true, deadline: 10 },
  { name: '2. Mahnung', days: 14, interest: true, fee: false, deadline: 7 },
]

export const SETTINGS_DEFAULTS = {
  sender: { name: '', address: '', uid: '', email: '', phone: '', web: '', register: '', taxNo: '' }, // taxNo: Steuernummer (Finanzamt), für die E-Rechnung ohne UID
  bank: { iban: '', bic: '', name: '' },
  paymentDays: 14,
  vat: 20,
  series: SERIES_DEFAULTS,
  start: {}, // erste Nummer je Belegart und Jahr, z. B. { 'rechnung|2026': 153 } beim Umstieg mitten im Jahr
  digits: 4,
  smallBusiness: false,
  baseRate: 1.53, // Basiszinssatz der OeNB in % (je Halbjahr prüfen)
  reminders: REMINDER_DEFAULTS,
  offerDays: 30,
  intro: 'Für unsere Leistungen erlauben wir uns zu verrechnen:',
  outro: 'Vielen Dank für den Auftrag.',
  offerIntro: 'Gerne bieten wir Ihnen an:',
  offerOutro: 'Wir freuen uns auf Ihren Auftrag.',
  accounts: { debitor: '', erloese: { 20: '4000', 13: '4013', 10: '4010', 0: '4020' }, rc: '4030', skonto: '' }, // skonto leer: Erlöskonto des Steuersatzes
  indexName: 'VPI 2020',
}

/*
 * Datenmodell fakturierung/fakturierung.json (erweitert für die Übernahme aus orgaMAX und orgaMAX-ähnliche Funktionen;
 * alle neuen Felder sind optional, alte Dateien bleiben gültig):
 *  customers[]   { id, name, customerNo, address (gedruckte Anschrift, mehrzeilig), uid, email, paymentDays, hourRate,
 *                  account, reverseCharge, consumer, note, objectIds, createdAt,
 *                  salutation, title, firstName, lastName, street, zip, city, country (ISO, Standard AT), phone, mobile,
 *                  fax, web, group, discount (%), termsId, iban, bic, deliveryAddress (mehrzeilig),
 *                  contacts: [{ id, name, role, email, phone }], extra: { Feldname: Wert } (nicht zugeordnete Felder
 *                  aus dem Import, nur zur Ansicht), source: { system, id } }
 *  articles[]    { id, name, text, unit, price, vat, articleNo, group, longText, cost (Einkauf netto), active, extra, source }
 *  textBlocks[]  { id, name, kind (Belegart aus KINDS, 'mahnung', 'mail' oder 'alle'), place ('intro' | 'outro' | 'mail' |
 *                  'reminder' | 'position'), text (mit Platzhaltern wie {Kunde}), isDefault }
 *  paymentTerms[]{ id, name, days, skontoPercent, skontoDays, text, isDefault }
 *  documents[]   wie bisher, dazu termsId, skonto { percent, days }, reference (Bestellnummer/Zeichen des Kunden),
 *                  contactName, deliveryAddress, imported { system, at, ref } (übernommener Altbeleg: Nummer, Datum und
 *                  Summen wie im Altsystem, nicht neu gerechnet), original { path, name } (Original-PDF im Archiv), extra
 *  recurring[]   wie bisher (Daueraufträge; orgaMAX: Abo-Rechnungen)
 *  settings      wie bisher, dazu numberFormats { Belegart: Vorlage mit {P} {JJJJ} {JJ} {MM} {NR} }, yearly { Belegart: bool }
 * Neue Belegfelder zählen zur Prüfsumme nur, wenn sie gesetzt sind (alte Prüfsummen bleiben gültig).
 */
export const emptyInvoicing = () => ({ settings: {}, customers: [], articles: [], documents: [], recurring: [], indexValues: {}, textBlocks: [], paymentTerms: [] })

export function settingsOf(doc = {}) {
  const s = doc.settings || {}
  return {
    ...SETTINGS_DEFAULTS,
    ...s,
    sender: { ...SETTINGS_DEFAULTS.sender, ...(s.sender || {}) },
    bank: { ...SETTINGS_DEFAULTS.bank, ...(s.bank || {}) },
    series: { ...SERIES_DEFAULTS, ...(s.series || {}) },
    accounts: { ...SETTINGS_DEFAULTS.accounts, ...(s.accounts || {}), erloese: { ...SETTINGS_DEFAULTS.accounts.erloese, ...(s.accounts?.erloese || {}) } },
    reminders: Array.isArray(s.reminders) && s.reminders.length ? s.reminders : REMINDER_DEFAULTS,
    start: s.start || {},
  }
}

// ---------------------------------------------------------------- Beträge

/** Kaufmännisch auf Cent runden (auch negative Beträge, ohne Gleitkomma-Fehler wie 1,005 → 1,00). */
export function round2(n) {
  const x = Number(n) || 0
  const sign = x < 0 ? -1 : 1
  return (sign * Math.round(Math.abs(x) * 100 + 1e-7)) / 100
}

export const parseNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v ?? '').trim().replace(/\s/g, '')
  if (!s) return 0
  // 1.234,56 → 1234.56; 1.500 → 1500 (Punkt als Tausender wie in Österreich üblich); 1234.56 bleibt
  const n = /,/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : /^[-+]?\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, '')) : Number(s)
  return Number.isFinite(n) ? n : 0
}

/** Netto einer Position: Menge × Einzelpreis − Positionsrabatt. */
export const lineNet = (l) => round2(parseNumber(l.qty) * parseNumber(l.price) * (1 - parseNumber(l.discount) / 100))

/** Wird Umsatzsteuer berechnet? (nicht bei Reverse Charge und Kleinunternehmer) */
export const chargesVat = (d, settings = {}) => !d.reverseCharge && !(d.smallBusiness ?? settings.smallBusiness)

/**
 * Summen eines Belegs: { lines: [{ …, net }], subtotal, discount, net, groups: [{ rate, net, vat }], vat, gross }.
 * Belegrabatt in % wird je Steuersatz abgezogen; Steuer je Steuersatz auf die Summe gerechnet (nicht je Zeile).
 */
export function totals(d, settings = {}) {
  // ganz leere Zeilen (z. B. die letzte im Formular) zählen nicht
  const lines = (d.lines || []).filter((l) => String(l.text || '').trim() || parseNumber(l.price)).map((l) => ({ ...l, net: lineNet(l) }))
  const vatOn = chargesVat(d, settings)
  const pct = parseNumber(d.discount)
  const byRate = new Map()
  for (const l of lines) {
    const rate = vatOn ? parseNumber(l.vat ?? settings.vat ?? 20) : 0
    byRate.set(rate, round2((byRate.get(rate) || 0) + l.net))
  }
  const groups = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, sum]) => {
      const off = round2((sum * pct) / 100)
      const net = round2(sum - off)
      return { rate, subtotal: sum, discount: off, net, vat: round2((net * rate) / 100) }
    })
  const subtotal = round2(groups.reduce((s, g) => s + g.subtotal, 0))
  const discount = round2(groups.reduce((s, g) => s + g.discount, 0))
  const net = round2(groups.reduce((s, g) => s + g.net, 0))
  const vat = round2(groups.reduce((s, g) => s + g.vat, 0))
  return { lines, subtotal, discount, net, groups, vat, gross: round2(net + vat), vatOn }
}

// ---------------------------------------------------------------- Nummern

const yearOf = (d) => String(d.date || '').slice(0, 4)
const seriesKind = (kind) => kind
export const numberText = (prefix, year, n, digits = 4) => `${prefix}-${year}-${String(n).padStart(digits, '0')}`
const numberSeq = (number) => Number(String(number || '').match(/(\d+)$/)?.[1] || 0)

/** Nächste freie Nummer der Belegart im Jahr (fortlaufend, ohne Lücken über die höchste vergebene hinaus). */
export function nextNumber(docs, kind, year, settings = SETTINGS_DEFAULTS) {
  const s = { ...SETTINGS_DEFAULTS, ...settings, series: { ...SERIES_DEFAULTS, ...(settings.series || {}) } }
  const prefix = s.series[seriesKind(kind)] || SERIES_DEFAULTS[kind] || 'RE'
  const used = docs.filter((d) => d.kind === kind && d.number && yearOf(d) === String(year)).map((d) => numberSeq(d.number))
  const start = Number(s.start?.[`${kind}|${year}`]) || 1
  const n = Math.max(start, used.length ? Math.max(...used) + 1 : start)
  return { number: numberText(prefix, year, n, s.digits || 4), seq: n }
}

// ---------------------------------------------------------------- Prüfsumme

/** FNV-1a (32 Bit) über Text: erkennt nachträgliche Änderungen an einem festgeschriebenen Beleg. */
export function fnv1a(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Felder, die nach dem Festschreiben unveränderlich sind (Zahlungen, Mahnungen, Versand dürfen dazukommen). */
const FIXED_FIELDS = ['kind', 'number', 'date', 'serviceFrom', 'serviceTo', 'dueDate', 'sender', 'recipient', 'lines', 'discount', 'reverseCharge', 'smallBusiness', 'refId', 'refNumber', 'title', 'intro', 'outro', 'total']
const canonical = (v) => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v)
// später dazugekommene Felder: zählen nur, wenn gesetzt (sonst änderten sich die Prüfsummen alter Belege)
const FIXED_OPTIONAL = ['skonto', 'termsText', 'reference', 'deliveryAddress', 'imported']
export const checksumOf = (d) => fnv1a(JSON.stringify(canonical({ ...Object.fromEntries(FIXED_FIELDS.map((k) => [k, d[k] ?? null])), ...Object.fromEntries(FIXED_OPTIONAL.filter((k) => d[k] != null && d[k] !== '').map((k) => [k, d[k]])) })))
/** Festgeschriebener Beleg unverändert? (true auch für Entwürfe) */
export const intact = (d) => !d.number || !d.checksum || d.checksum === checksumOf(d)

// ---------------------------------------------------------------- Prüfen und Festschreiben

/**
 * Was vor dem Festschreiben fehlt: [{ level: 'error' | 'warn' | 'info', text }].
 * Fehler verhindern das Festschreiben.
 */
export function problems(d, settings = SETTINGS_DEFAULTS) {
  const s = settingsOf({ settings })
  const out = []
  const err = (text) => out.push({ level: 'error', text })
  const warn = (text) => out.push({ level: 'warn', text })
  const t = totals(d, s)
  const gross = Math.abs(t.gross)
  const small = gross <= SMALL_AMOUNT
  const sender = d.sender || s.sender
  const rec = d.recipient || {}
  const invoice = isInvoice(d)
  if (!sender.name || !sender.address) err('Name und Anschrift der eigenen Firma fehlen (Einstellungen → Absender).')
  if (invoice && !small && !(d.smallBusiness ?? s.smallBusiness) && !sender.uid) err('UID-Nummer der eigenen Firma fehlt (Einstellungen → Absender).')
  if (!rec.name) (small && invoice ? warn : err)('Name des Empfängers fehlt.')
  if (!rec.address) (small && invoice ? warn : err)('Anschrift des Empfängers fehlt.')
  if (!d.date) err('Datum fehlt.')
  if (invoice && !d.serviceFrom) err('Tag oder Zeitraum der Leistung fehlt (§ 11 UStG).')
  if (d.serviceFrom && d.serviceTo && d.serviceTo < d.serviceFrom) err('Leistungszeitraum: „bis“ liegt vor „von“.')
  if (!t.lines.length || !t.lines.some((l) => String(l.text || '').trim())) err('Keine Position.')
  if (t.lines.some((l) => !String(l.text || '').trim())) err('Eine Position hat keine Bezeichnung.')
  if (d.reverseCharge) {
    if (!rec.uid) err('Reverse Charge: UID-Nummer des Empfängers fehlt (§ 11 Abs. 1a UStG).')
    if (!sender.uid) err('Reverse Charge: eigene UID-Nummer fehlt.')
  } else if (invoice && gross > UID_LIMIT && !rec.consumer && !rec.uid) err('Über 10.000 € brutto: UID-Nummer des Empfängers fehlt (§ 11 Abs. 1 Z 3 lit. i UStG).')
  if (d.kind === 'rechnung' && t.gross < 0) err('Rechnung mit negativem Betrag: dafür eine Rechnungskorrektur oder Stornorechnung erstellen.')
  if (['storno', 'korrektur'].includes(d.kind) && !d.refId) err('Bezug auf die ursprüngliche Rechnung fehlt.')
  if (d.dueDate && d.date && d.dueDate < d.date) warn('Fällig vor dem Rechnungsdatum.')
  if (invoice && d.date && d.serviceFrom && d.serviceFrom > d.date) warn('Leistung liegt nach dem Rechnungsdatum (Vorausrechnung?).')
  if (invoice && small && t.gross > 0) out.push({ level: 'info', text: `Kleinbetragsrechnung (bis ${SMALL_AMOUNT} € brutto): vereinfachte Angaben genügen (§ 11 Abs. 6 UStG).` })
  return out
}

export const blocking = (list) => list.filter((p) => p.level === 'error')

/**
 * Festschreiben: Nummer vergeben, Absender und Summe einfrieren, Platzhalter in Betreff, Einleitung und Schlusstext
 * auflösen, Zahlungsbedingung mit Skonto als Text einfrieren (termsText), Prüfsumme. Wirft bei Fehlern.
 * customer: Kunde (für {Anrede}), terms: gewählte Zahlungsbedingung (für ihren Text), user: Name für {Benutzer}.
 */
export function finalize(d, docs, settings = SETTINGS_DEFAULTS, { now = new Date().toISOString(), by = '', customer = null, terms = null, user = by } = {}) {
  if (d.number) throw new Error('Beleg ist schon festgeschrieben.')
  const s = settingsOf({ settings })
  const list = blocking(problems(d, s))
  if (list.length) throw new Error(list.map((p) => p.text).join(' '))
  const year = yearOf(d)
  const { number } = nextNumber(docs.filter((x) => x.id !== d.id), d.kind, year, s)
  const t = totals(d, s)
  const out = {
    ...d,
    number,
    status: d.kind === 'angebot' ? 'offen' : 'fest',
    sender: { ...(d.sender || s.sender) },
    smallBusiness: !!(d.smallBusiness ?? s.smallBusiness),
    total: { net: t.net, vat: t.vat, gross: t.gross, groups: t.groups.map(({ rate, net, vat }) => ({ rate, net, vat })) },
    finalizedAt: now,
    finalizedBy: by,
    history: [...(d.history || []), { at: now, by, text: `festgeschrieben als ${number}` }],
  }
  if (!(parseNumber(out.skonto?.percent) > 0) || d.kind !== 'rechnung') delete out.skonto
  // nur geänderte Texte übernehmen (Belege ohne Platzhalter bleiben Feld für Feld gleich)
  for (const [k, v] of Object.entries(resolveTexts(out, { settings: s, customer, terms, user, today: now.slice(0, 10) }))) if (v !== out[k]) out[k] = v
  out.checksum = checksumOf(out)
  return out
}

/**
 * Doppelte Nummern (zwei Personen haben gleichzeitig festgeschrieben, danach zusammengeführt):
 * Der zuerst festgeschriebene Beleg behält die Nummer; spätere, noch nicht versendete bekommen die
 * nächste freie Nummer. Schon versendete Doppelte bleiben stehen und werden gemeldet.
 * Liefert { docs, renumbered: [{ id, from, to }], conflicts: [[id, id]] }.
 */
export function resolveDuplicates(docs, settings = SETTINGS_DEFAULTS, { now = new Date().toISOString(), by = '' } = {}) {
  const groups = new Map()
  for (const d of docs) if (d.number) groups.set(`${d.kind}|${d.number}`, [...(groups.get(`${d.kind}|${d.number}`) || []), d])
  let out = docs
  const renumbered = []
  const conflicts = []
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => (a.sent?.length ? 0 : 1) - (b.sent?.length ? 0 : 1) || String(a.finalizedAt).localeCompare(String(b.finalizedAt)) || String(a.id).localeCompare(String(b.id)))
    const [, ...rest] = sorted
    for (const d of rest) {
      if (d.sent?.length) {
        conflicts.push([sorted[0].id, d.id])
        continue
      }
      const { number } = nextNumber(out, d.kind, yearOf(d), settings)
      const fixed = { ...d, number, history: [...(d.history || []), { at: now, by, text: `Nummer ${d.number} war doppelt vergeben, neu: ${number}` }] }
      fixed.checksum = checksumOf(fixed)
      out = out.map((x) => (x.id === d.id ? fixed : x))
      renumbered.push({ id: d.id, from: d.number, to: number })
    }
  }
  return { docs: out, renumbered, conflicts }
}

// ---------------------------------------------------------------- Storno, Korrektur, Umwandeln

const negLine = (l) => ({ ...l, qty: -parseNumber(l.qty) })
const copyFields = (d) => ({ customerId: d.customerId, objectId: d.objectId, recipient: { ...(d.recipient || {}) }, reverseCharge: !!d.reverseCharge, smallBusiness: d.smallBusiness, discount: d.discount || 0 })

/** Stornorechnung zu einer festgeschriebenen Rechnung (alle Positionen mit umgekehrtem Vorzeichen, als Entwurf). */
export function stornoDraft(original, { id, date, reason = '' }) {
  if (original.kind !== 'rechnung' || !original.number) throw new Error('Nur festgeschriebene Rechnungen können storniert werden.')
  return {
    id,
    kind: 'storno',
    status: 'entwurf',
    date,
    serviceFrom: original.serviceFrom,
    serviceTo: original.serviceTo,
    dueDate: date,
    ...copyFields(original),
    refId: original.id,
    refNumber: original.number,
    title: `Storno zu Rechnung ${original.number} vom ${deDate(original.date)}`,
    intro: reason ? `Grund: ${reason}` : '',
    outro: '',
    lines: (original.lines || []).map(negLine),
  }
}

/** Rechnungskorrektur (z. B. Preisminderung nach Reklamation): eine Minus-Position als Entwurf. */
export function correctionDraft(original, { id, date, text = 'Preisminderung', amount = 0, vat = 20 }) {
  if (original.kind !== 'rechnung' || !original.number) throw new Error('Nur festgeschriebene Rechnungen können korrigiert werden.')
  return {
    id,
    kind: 'korrektur',
    status: 'entwurf',
    date,
    serviceFrom: original.serviceFrom,
    serviceTo: original.serviceTo,
    dueDate: date,
    ...copyFields(original),
    discount: 0,
    refId: original.id,
    refNumber: original.number,
    title: `Korrektur zu Rechnung ${original.number} vom ${deDate(original.date)}`,
    intro: '',
    outro: '',
    lines: [{ id: `${id}-1`, text, qty: -1, unit: 'Pauschale', price: Math.abs(parseNumber(amount)), vat, discount: 0 }],
  }
}

/** Angebot → Auftragsbestätigung oder Rechnung; Auftrag → Rechnung (neuer Entwurf mit Bezug). */
export function convertDraft(source, kind, { id, date }) {
  return {
    id,
    kind,
    status: 'entwurf',
    date,
    serviceFrom: source.serviceFrom || '',
    serviceTo: source.serviceTo || '',
    ...copyFields(source),
    refId: source.id,
    refNumber: source.number || '',
    title: source.title || '',
    intro: '',
    outro: '',
    lines: (source.lines || []).map((l, i) => ({ ...l, id: `${id}-${i + 1}` })),
  }
}

export const deDate = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '')

// ---------------------------------------------------------------- Zahlungen und offene Posten

const addDaysIso = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)
export const dueDateFor = (date, days) => (date ? addDaysIso(date, Math.max(0, Number(days) || 0)) : '')

export const grossOf = (d, settings) => (d.total ? d.total.gross : totals(d, settings).gross)
export const paidOf = (d) => round2((d.payments || []).reduce((s, p) => s + parseNumber(p.amount), 0))

/** Storno- und Korrekturbelege, die sich auf eine Rechnung beziehen (nur festgeschriebene). */
export const refsOf = (d, docs) => docs.filter((x) => x.refId === d.id && x.number && ['storno', 'korrektur'].includes(x.kind))
export const isCancelled = (d, docs) => refsOf(d, docs).some((x) => x.kind === 'storno')

/**
 * Offener Betrag einer Rechnung: brutto + Korrekturen/Storno (negativ) − Zahlungen (samt vermerktem Skonto).
 * Ohne Skonto-Vermerk gilt eine Zahlung in der Skontofrist, die brutto abzüglich Skonto deckt, ebenfalls als
 * vollständig (z. B. übernommene Zahlungen): kein Rest offen.
 */
export function openAmount(d, docs, settings) {
  if (d.kind !== 'rechnung' || !d.number) return 0
  const credits = refsOf(d, docs).reduce((s, x) => s + grossOf(x, settings), 0)
  const base = round2(grossOf(d, settings) + credits)
  return round2(base - paidOf(d) - implicitSkonto(d, base, settings))
}

export const PAY_STATUS = { entwurf: 'Entwurf', offen: 'offen', ueberfaellig: 'überfällig', teilbezahlt: 'teilweise bezahlt', bezahlt: 'bezahlt', storniert: 'storniert', angenommen: 'angenommen', abgelehnt: 'abgelehnt', abgelaufen: 'abgelaufen', erledigt: 'erledigt' }

/** Zustand für die Liste. */
export function stateOf(d, docs, today, settings) {
  if (!d.number) return 'entwurf'
  if (d.kind === 'angebot') return d.status === 'angenommen' || d.status === 'abgelehnt' ? d.status : d.validUntil && d.validUntil < today ? 'abgelaufen' : 'offen'
  if (d.kind !== 'rechnung') return 'erledigt'
  if (isCancelled(d, docs)) return 'storniert'
  const open = openAmount(d, docs, settings)
  if (open <= 0.004) return 'bezahlt'
  if (d.dueDate && d.dueDate < today) return 'ueberfaellig'
  return paidOf(d) > 0 ? 'teilbezahlt' : 'offen'
}

/** Offene Posten: [{ doc, open, overdueDays, level, next, skonto }] sortiert nach Fälligkeit; skonto: { until, amount, payable } solange die Frist läuft. */
export function openItems(docs, today, settings) {
  const s = settingsOf({ settings })
  return docs
    .filter((d) => d.kind === 'rechnung' && d.number && !isCancelled(d, docs))
    .map((d) => {
      const open = openAmount(d, docs, s)
      const overdueDays = d.dueDate ? Math.max(0, daysBetween(d.dueDate, today)) : 0
      const sk = skontoAvailable(d, docs, s, today)
      return { doc: d, open, overdueDays, level: (d.reminders || []).length, next: nextReminder(d, today, s), skonto: sk ? { until: skontoOf(d, s).until, amount: sk, payable: round2(open - sk) } : null }
    })
    .filter((x) => x.open > 0.004)
    .sort((a, b) => String(a.doc.dueDate).localeCompare(String(b.doc.dueDate)))
}

/** Nächste Mahnstufe, wenn fällig: { level, step, since } oder null. */
export function nextReminder(d, today, settings) {
  const s = settingsOf({ settings })
  const done = (d.reminders || []).length
  const step = s.reminders[done]
  if (!step || !d.dueDate) return null
  const since = done ? d.reminders[done - 1].deadline || d.reminders[done - 1].date : d.dueDate
  return daysBetween(since, today) >= (Number(step.days) || 0) ? { level: done, step, since } : null
}

/** Verzugszinsen: Betrag × Satz × Tage / 365. Satz: Unternehmer Basiszins + 9,2; Verbraucher 4 %. */
export function lateInterest({ amount, from, to, baseRate = SETTINGS_DEFAULTS.baseRate, consumer = false }) {
  const days = from && to ? Math.max(0, daysBetween(from, to)) : 0
  const rate = consumer ? CONSUMER_INTEREST : round2(Number(baseRate) + B2B_INTEREST_MARGIN)
  return { days, rate, amount: round2((Math.max(0, amount) * rate * days) / 36500) }
}

/**
 * Mahnung für eine Rechnung: { level, name, open, interest: { days, rate, amount }, fee, total, deadline }.
 * Die 40-€-Pauschale (§ 458 UGB) nur unter Unternehmern und nur einmal je Forderung.
 */
export function reminderFor(d, docs, { today, settings, level = (d.reminders || []).length }) {
  const s = settingsOf({ settings })
  const step = s.reminders[Math.min(level, s.reminders.length - 1)]
  const open = openAmount(d, docs, s)
  const consumer = !!d.recipient?.consumer
  const interest = step.interest ? lateInterest({ amount: open, from: d.dueDate, to: today, baseRate: s.baseRate, consumer }) : { days: 0, rate: 0, amount: 0 }
  const feeCharged = (d.reminders || []).some((r) => r.fee > 0)
  const fee = step.fee && !consumer && !feeCharged ? B2B_FLAT_FEE : 0
  return { level, name: step.name, open, interest, fee, total: round2(open + interest.amount + fee), deadline: addDaysIso(today, Number(step.deadline) || 7) }
}

// ---------------------------------------------------------------- Daueraufträge und Wertsicherung

const ymAdd = (ym, n) => {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`
}
const ymDiff = (a, b) => {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return yb * 12 + mb - (ya * 12 + ma)
}
const lastDay = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/** Abrechnungszeitraum eines Dauerauftrags, der im Monat ym beginnt (oder null, wenn ym kein Abrechnungsmonat ist). */
export function periodOf(rec, ym) {
  const step = INTERVAL_MONTHS[rec.interval] || 1
  if (!rec.startMonth || ym < rec.startMonth || (rec.endMonth && ym > rec.endMonth)) return null
  if (ymDiff(rec.startMonth, ym) % step) return null
  const end = ymAdd(ym, step - 1)
  return { from: `${ym}-01`, to: lastDay(rec.endMonth && end > rec.endMonth ? rec.endMonth : end), ym }
}

/**
 * Wertsicherung: Veränderung der Indexzahl gegenüber der Basis. Erst ab der Schwelle (z. B. 3 %) wird
 * angepasst, dann um die ganze Veränderung; die neue Zahl ist dann die Basis für die nächste Anpassung.
 * onlyUp: nur Erhöhungen (manche Verträge).
 */
export function indexAdjustment({ price, baseValue, currentValue, threshold = 3, onlyUp = false }) {
  const b = Number(baseValue)
  const c = Number(currentValue)
  if (!(b > 0) || !(c > 0)) return { change: 0, applies: false, price: round2(price), factor: 1 }
  const change = round2((c / b - 1) * 100)
  const applies = Math.abs(change) >= Number(threshold || 0) - 1e-9 && change !== 0 && !(onlyUp && change < 0)
  return { change, applies, factor: c / b, price: applies ? round2(price * (c / b)) : round2(price) }
}

/** Letzte eingetragene Indexzahl bis einschließlich Monat ym: { ym, value } oder null. */
export function latestIndex(values = {}, ym) {
  const keys = Object.keys(values).filter((k) => k <= ym && Number(values[k]) > 0).sort()
  return keys.length ? { ym: keys.at(-1), value: Number(values[keys.at(-1)]) } : null
}

/**
 * Monatslauf: für jeden aktiven Dauerauftrag mit Abrechnung im Monat ym einen Rechnungsentwurf
 * (nicht doppelt: Quelle „rec:<id>:<ym>“). Wertsicherung wird vorher geprüft und in den Auftrag
 * übernommen. Liefert { documents, recurring, created, adjusted }.
 */
export function runRecurring(doc, ym, { today, newId, by = '', customersById = new Map() }) {
  const s = settingsOf(doc)
  const texts = defaultTexts('rechnung', s, doc.textBlocks)
  let documents = [...(doc.documents || [])]
  const have = new Set(documents.map((d) => d.source?.key).filter(Boolean))
  const created = []
  const adjusted = []
  const recurring = (doc.recurring || []).map((rec) => {
    if (rec.active === false) return rec
    const period = periodOf(rec, ym)
    const key = `rec:${rec.id}:${ym}`
    if (!period || have.has(key)) return rec
    let next = rec
    const idx = rec.index
    let note = ''
    if (idx?.active && Number(idx.baseValue) > 0) {
      const cur = latestIndex(doc.indexValues, ymAdd(ym, -1))
      if (cur && cur.ym !== idx.baseMonth) {
        const lines = (rec.lines || []).map((l) => ({ ...l }))
        const first = indexAdjustment({ price: 1, baseValue: idx.baseValue, currentValue: cur.value, threshold: idx.threshold ?? 3, onlyUp: !!idx.onlyUp })
        if (first.applies) {
          for (const l of lines) l.price = indexAdjustment({ price: parseNumber(l.price), baseValue: idx.baseValue, currentValue: cur.value, threshold: idx.threshold ?? 3, onlyUp: !!idx.onlyUp }).price
          note = `Wertsicherung ${s.indexName}: ${String(idx.baseValue).replace('.', ',')} → ${String(cur.value).replace('.', ',')} (${first.change > 0 ? '+' : ''}${String(first.change).replace('.', ',')} %)`
          next = { ...rec, lines, index: { ...idx, baseValue: cur.value, baseMonth: cur.ym }, history: [...(rec.history || []), { at: today, by, text: note }] }
          adjusted.push({ id: rec.id, change: first.change, from: idx.baseValue, to: cur.value })
        }
      }
    }
    const customer = customersById.get(next.customerId)
    const id = newId()
    const terms = termsSetup(customer, doc.paymentTerms, s)
    const draft = {
      id,
      kind: 'rechnung',
      status: 'entwurf',
      date: today,
      serviceFrom: period.from,
      serviceTo: period.to,
      customerId: next.customerId,
      objectId: next.objectId || '',
      recipient: customer ? recipientOf(customer) : {},
      reverseCharge: !!customer?.reverseCharge,
      dueDate: dueDateFor(today, terms.days),
      ...(terms.termsId ? { termsId: terms.termsId } : {}),
      ...(terms.skonto ? { skonto: terms.skonto } : {}),
      ...(customer?.deliveryAddress ? { deliveryAddress: customer.deliveryAddress } : {}),
      discount: next.discount || 0,
      title: `${next.title || 'Unterhaltsreinigung'} ${periodLabel(period)}`,
      intro: texts.intro,
      outro: [note, texts.outro].filter(Boolean).join('\n'),
      lines: (next.lines || []).map((l, i) => ({ ...l, id: `${id}-${i + 1}` })),
      source: { type: 'dauerauftrag', key, recurringId: rec.id },
      createdAt: today,
      createdBy: by,
    }
    documents = [...documents, draft]
    have.add(key)
    created.push(draft)
    return { ...next, lastRun: ym }
  })
  return { documents, recurring, created, adjusted }
}

const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
export const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
export function periodLabel({ from, to }) {
  if (!from) return ''
  const a = from.slice(0, 7)
  const b = (to || from).slice(0, 7)
  if (a === b && from.endsWith('-01') && to === lastDay(a)) return monthLabel(a)
  if (from.endsWith('-01') && to === lastDay(b)) return `${MONTHS[Number(a.slice(5)) - 1]}${a.slice(0, 4) === b.slice(0, 4) ? '' : ` ${a.slice(0, 4)}`} – ${monthLabel(b)}`
  return from === to || !to ? deDate(from) : `${deDate(from)} – ${deDate(to)}`
}

// ---------------------------------------------------------------- Kunden

const COUNTRY_NAMES = { AT: 'Österreich', DE: 'Deutschland', CH: 'Schweiz', IT: 'Italien', SI: 'Slowenien', HU: 'Ungarn', CZ: 'Tschechien', SK: 'Slowakei', LI: 'Liechtenstein' }

/** Person bzw. Firma als Zeile: „Firma“, sonst „Titel Vorname Nachname“. */
export const personLine = (c = {}) => [c.title, c.firstName, c.lastName].map((x) => String(x || '').trim()).filter(Boolean).join(' ')

/**
 * Gedruckte Anschrift (mehrzeilig) aus den Einzelfeldern: Firma, z. H. Person, Straße, PLZ Ort, Land (nur außerhalb
 * Österreichs). Ist „address“ von Hand gesetzt, gilt diese.
 */
export function composeAddress(c = {}) {
  if (String(c.address || '').trim()) return String(c.address).trim()
  const person = personLine(c)
  const country = String(c.country || 'AT').trim().toUpperCase()
  const lines = [
    person && c.name && person !== c.name ? `z. H. ${[c.salutation, person].filter(Boolean).join(' ')}` : '',
    c.street,
    [c.zip, c.city].map((x) => String(x || '').trim()).filter(Boolean).join(' '),
    country && country !== 'AT' ? COUNTRY_NAMES[country] || country : '',
  ]
  return lines.map((x) => String(x || '').trim()).filter(Boolean).join('\n')
}

/** Empfänger-Angaben für den Beleg (Momentaufnahme beim Erstellen). */
export const recipientOf = (c = {}) => ({ name: c.name || personLine(c) || '', address: composeAddress(c), uid: c.uid || '', email: c.email || '', customerNo: c.customerNo || '', consumer: !!c.consumer })

export function customerForObject(doc, objectId) {
  return (doc.customers || []).find((c) => (c.objectIds || []).includes(objectId)) || null
}

/** Nächste Kundennummer (10001, 10002, …). */
export function nextCustomerNo(customers = []) {
  const nums = customers.map((c) => Number(c.customerNo)).filter((n) => Number.isFinite(n) && n > 0)
  return String(nums.length ? Math.max(...nums) + 1 : 10001)
}

// ---------------------------------------------------------------- Übernahme aus anderen Modulen

/**
 * Positionen aus dem Leistungsnachweis eines Objekts: regelmäßige Einsätze als Stunden (oder als
 * Monatspauschale, wenn monthly gesetzt ist), Sonderleistungen einzeln mit Datum.
 * proof: core/proof.js → proofFor(); rate: € je Stunde netto.
 */
export function linesFromProof({ proof, objectName = '', month, rate = 0, monthly = 0, vat = 20, newId }) {
  const done = proof.rows.filter((r) => r.status === 'erbracht' || r.status === 'bestaetigt')
  const regular = done.filter((r) => r.category !== 'sonder')
  const special = done.filter((r) => r.category === 'sonder')
  const hours = (list) => round2(list.reduce((s, r) => s + r.planMinutes, 0) / 60)
  const lines = []
  if (regular.length) {
    lines.push(
      monthly
        ? { id: newId(), text: `Unterhaltsreinigung ${objectName} ${monthLabel(month)} lt. Leistungsnachweis (${regular.length} Einsätze)`, qty: 1, unit: 'Monat', price: round2(monthly), vat, discount: 0 }
        : { id: newId(), text: `Unterhaltsreinigung ${objectName} ${monthLabel(month)} lt. Leistungsnachweis (${regular.length} Einsätze)`, qty: hours(regular), unit: 'Std.', price: round2(rate), vat, discount: 0 },
    )
  }
  for (const r of special) lines.push({ id: newId(), text: `${r.label || 'Sonderleistung'} am ${deDate(r.date)}`, qty: round2(r.planMinutes / 60), unit: 'Std.', price: round2(rate), vat, discount: 0 })
  return lines
}

// ---------------------------------------------------------------- Auswertung

/** Umsatz netto und brutto je Monat eines Jahres (festgeschriebene Rechnungen, Storno und Korrekturen). */
export function revenueByMonth(docs, year, settings) {
  const out = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, net: 0, gross: 0, count: 0 }))
  for (const d of docs) {
    if (!isInvoice(d) || !d.number || yearOf(d) !== String(year)) continue
    const m = out[Number(d.date.slice(5, 7)) - 1]
    const t = d.total || totals(d, settings)
    m.net = round2(m.net + t.net)
    m.gross = round2(m.gross + t.gross)
    if (d.kind === 'rechnung') m.count++
  }
  return out
}

export function revenueByCustomer(docs, year, settings) {
  const map = new Map()
  for (const d of docs) {
    if (!isInvoice(d) || !d.number || yearOf(d) !== String(year)) continue
    const key = d.customerId || d.recipient?.name || '–'
    const cur = map.get(key) || { customerId: d.customerId, name: d.recipient?.name || '–', net: 0, open: 0, count: 0 }
    cur.net = round2(cur.net + (d.total || totals(d, settings)).net)
    cur.open = round2(cur.open + openAmount(d, docs, settings))
    if (d.kind === 'rechnung') cur.count++
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => b.net - a.net)
}

// ---------------------------------------------------------------- Export für die Steuerberatung

export const EXPORT_COLUMNS = {
  belegnr: ['Belegnummer', (r) => r.number],
  belegdatum: ['Belegdatum', (r, f) => f.date(r.date)],
  belegart: ['Belegart', (r) => r.kindLabel],
  konto: ['Konto (Debitor)', (r) => r.debitor],
  gegenkonto: ['Gegenkonto (Erlöse)', (r) => r.account],
  kunde: ['Kunde', (r) => r.customer],
  uid: ['UID Kunde', (r) => r.uid],
  steuersatz: ['Steuersatz', (r, f) => f.num(r.rate)],
  steuercode: ['Steuercode', (r) => r.code],
  netto: ['Netto', (r, f) => f.num(r.net)],
  steuer: ['Steuer', (r, f) => f.num(r.vat)],
  brutto: ['Brutto', (r, f) => f.num(r.gross)],
  leistung: ['Leistungszeitraum', (r, f) => [f.date(r.serviceFrom), r.serviceTo && r.serviceTo !== r.serviceFrom ? f.date(r.serviceTo) : ''].filter(Boolean).join('–')],
  faellig: ['Fällig', (r, f) => f.date(r.dueDate)],
  text: ['Text', (r) => r.text],
}
export const EXPORT_DEFAULT_COLUMNS = ['belegnr', 'belegdatum', 'belegart', 'konto', 'gegenkonto', 'kunde', 'uid', 'steuersatz', 'steuercode', 'netto', 'steuer', 'brutto', 'leistung', 'text']

/**
 * Zeilen je Beleg und Steuersatz (BMD/RZL: eine Buchungszeile je Steuersatz). Dazu Skonto-Abzüge mit
 * Zahlungsdatum im Zeitraum (Belegart SK, negativ, je Steuersatz anteilig: Skonto mindert nachträglich das
 * Entgelt und damit die Umsatzsteuer, § 16 Abs. 1 UStG).
 */
export function exportRows(docs, { from, to, settings, customersById = new Map() }) {
  const s = settingsOf({ settings })
  const rows = []
  for (const d of docs) {
    if (d.kind !== 'rechnung' || !d.number) continue
    for (const p of (d.payments || []).filter((x) => x.kind === 'skonto' && x.date >= from && x.date <= to)) {
      const c = customersById.get(d.customerId)
      for (const g of skontoSplit(d, parseNumber(p.amount), s)) {
        rows.push({
          number: d.number,
          date: p.date,
          kindLabel: 'SK',
          debitor: c?.account || c?.customerNo || s.accounts.debitor || '',
          account: s.accounts.skonto || (d.reverseCharge ? s.accounts.rc : s.accounts.erloese[g.rate] ?? ''),
          customer: d.recipient?.name || '',
          uid: d.recipient?.uid || '',
          rate: g.rate,
          code: d.reverseCharge ? 'RC19-1a' : d.smallBusiness ? 'KU' : '',
          net: -g.net,
          vat: -g.vat,
          gross: -g.gross,
          serviceFrom: d.serviceFrom,
          serviceTo: d.serviceTo,
          dueDate: d.dueDate,
          text: `Skonto zu ${d.number} ${d.recipient?.name || ''}`.trim(),
        })
      }
    }
  }
  for (const d of docs) {
    if (!isInvoice(d) || !d.number || d.date < from || d.date > to) continue
    const t = d.total || totals(d, s)
    const c = customersById.get(d.customerId)
    for (const g of t.groups) {
      rows.push({
        number: d.number,
        date: d.date,
        kindLabel: d.kind === 'rechnung' ? 'AR' : 'GU',
        debitor: c?.account || c?.customerNo || s.accounts.debitor || '',
        account: d.reverseCharge ? s.accounts.rc : s.accounts.erloese[g.rate] ?? '',
        customer: d.recipient?.name || '',
        uid: d.recipient?.uid || '',
        rate: g.rate,
        // Steuercode: RC = Reverse Charge Bauleistung, KU = Kleinunternehmer, sonst leer (Normalsteuer)
        code: d.reverseCharge ? 'RC19-1a' : d.smallBusiness ? 'KU' : '',
        net: g.net,
        vat: g.vat,
        gross: round2(g.net + g.vat),
        serviceFrom: d.serviceFrom,
        serviceTo: d.serviceTo,
        dueDate: d.dueDate,
        text: [KINDS[d.kind], d.refNumber ? `zu ${d.refNumber}` : '', d.recipient?.name].filter(Boolean).join(' '),
      })
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))
}

export function exportCsv(rows, { columns = EXPORT_DEFAULT_COLUMNS, sep = ';', decimal = ',', header = true } = {}) {
  const f = {
    num: (n) => (Number.isFinite(Number(n)) ? Number(n).toFixed(2).replace('.', decimal) : ''),
    date: (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : ''),
  }
  const cell = (v) => {
    const s = String(v ?? '')
    return s.includes(sep) || s.includes('"') || /\r|\n/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const cols = columns.filter((c) => EXPORT_COLUMNS[c])
  const lines = rows.map((r) => cols.map((c) => cell(EXPORT_COLUMNS[c][1](r, f))).join(sep))
  if (header) lines.unshift(cols.map((c) => cell(EXPORT_COLUMNS[c][0])).join(sep))
  return `${lines.join('\r\n')}\r\n`
}

// ---------------------------------------------------------------- Zahlschein (EPC-QR-Code)

/** IBAN prüfen (Länge, Prüfziffer mod 97). */
export function ibanValid(iban) {
  const s = String(iban || '').replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false
  if (s.startsWith('AT') && s.length !== 20) return false
  const moved = `${s.slice(4)}${s.slice(0, 4)}`.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55))
  let rest = 0
  for (const ch of moved) rest = (rest * 10 + Number(ch)) % 97
  return rest === 1
}

export const formatIban = (iban) => String(iban || '').replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim()

/**
 * Inhalt des EPC-QR-Codes (Stuzza/EPC069-12, Version 002, UTF-8): Banking-Apps übernehmen
 * Empfänger, IBAN, Betrag und Verwendungszweck. Ohne gültige IBAN: null.
 */
export function epcPayload({ name, iban, bic = '', amount, text = '' }) {
  const ib = String(iban || '').replace(/\s+/g, '').toUpperCase()
  if (!ibanValid(ib) || !name) return null
  const a = round2(amount)
  const lines = ['BCD', '002', '1', 'SCT', String(bic || '').replace(/\s+/g, '').toUpperCase(), String(name).slice(0, 70), ib, a >= 0.01 && a <= 999999999.99 ? `EUR${a.toFixed(2)}` : '', '', '', String(text).slice(0, 140)]
  while (lines.length && lines.at(-1) === '') lines.pop()
  return lines.join('\n')
}

// ---------------------------------------------------------------- Texte

/** E-Mail-Text zum Beleg (ohne eigenen Textbaustein). greeting: Anrede ohne Beistrich, z. B. aus greetingOf(Kunde). */
export function invoiceMailText({ doc, company = '', sender = '', gross, iban = '', greeting = DEFAULT_GREETING }) {
  const kind = KINDS[doc.kind] || 'Beleg'
  const amount = Number(gross ?? doc.total?.gross ?? 0).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
  const lines = [`${greeting || DEFAULT_GREETING},`, '', `anbei erhalten Sie ${doc.kind === 'angebot' ? 'unser' : 'unsere'} ${kind} ${doc.number || ''}${doc.title ? ` (${doc.title})` : ''} als PDF.`]
  if (doc.kind === 'rechnung') lines.push(`Betrag: ${amount}${doc.dueDate ? `, zahlbar bis ${deDate(doc.dueDate)}` : ''}${iban ? ` auf ${formatIban(iban)}` : ''}.`)
  if (doc.kind === 'angebot' && doc.validUntil) lines.push(`Das Angebot gilt bis ${deDate(doc.validUntil)}.`)
  lines.push('', 'Mit freundlichen Grüßen', sender, company)
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim()
}

export function reminderMailText({ doc, reminder, company = '', sender = '', greeting = DEFAULT_GREETING }) {
  const amount = (n) => Number(n).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
  return [
    `${greeting || DEFAULT_GREETING},`,
    '',
    reminder.level === 0
      ? `zu unserer Rechnung ${doc.number} vom ${deDate(doc.date)} konnten wir noch keinen Zahlungseingang feststellen. Vielleicht ist sie Ihnen entgangen.`
      : `trotz unserer Erinnerung ist unsere Rechnung ${doc.number} vom ${deDate(doc.date)} noch offen.`,
    `Offen: ${amount(reminder.open)}${reminder.interest.amount ? `, Verzugszinsen ${amount(reminder.interest.amount)}` : ''}${reminder.fee ? `, Pauschale ${amount(reminder.fee)}` : ''}. Bitte überweisen Sie ${amount(reminder.total)} bis ${deDate(reminder.deadline)}.`,
    'Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.',
    '',
    'Mit freundlichen Grüßen',
    sender,
    company,
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n')
    .trim()
}

const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '')
export const docFileName = (d) => `${KINDS[d.kind] || 'Beleg'}_${d.number || `Entwurf-${fileSafe(d.id)}`}${d.recipient?.name ? `_${fileSafe(d.recipient.name)}` : ''}.pdf`.replace(/Rechnungskorrektur|Stornorechnung|Auftragsbestätigung/, (m) => ({ Rechnungskorrektur: 'Korrektur', Stornorechnung: 'Storno', Auftragsbestätigung: 'Auftrag' })[m])
export const reminderFileName = (d, level) => `Mahnung${level + 1}_${d.number}${d.recipient?.name ? `_${fileSafe(d.recipient.name)}` : ''}.pdf`
/** Ablage in SharePoint (App-Ordner): fakturierung/belege/2026/RE-2026-0001.pdf */
export const archivePath = (d, name = docFileName(d)) => `fakturierung/belege/${yearOf(d) || 'ohne-Jahr'}/${name}`

// ---------------------------------------------------------------- Platzhalter (Textbausteine, Belegtexte, E-Mail, Mahnung)

export const DEFAULT_GREETING = 'Sehr geehrte Damen und Herren'

/** Platzhalter für Texte: [Name, Erklärung]. Geschrieben als {Name}; Groß-/Kleinschreibung egal, „ae“ statt „ä“ geht auch. */
export const PLACEHOLDERS = [
  ['Anrede', 'z. B. „Sehr geehrter Herr Maier“ (aus Anrede und Nachname des Kunden), sonst „Sehr geehrte Damen und Herren“'],
  ['Kunde', 'Name des Kunden'],
  ['Ansprechpartner', 'beim Beleg gewählter Ansprechpartner'],
  ['Kundennummer', 'Kundennummer'],
  ['Belegart', 'Rechnung, Angebot …'],
  ['Belegnummer', 'z. B. RE-2026-0001 (erst beim Festschreiben)'],
  ['Datum', 'Belegdatum'],
  ['Fällig', 'Fälligkeit (Datum)'],
  ['Betrag', 'Gesamtbetrag brutto'],
  ['Offen', 'offener Betrag (Mahnung)'],
  ['Zeitraum', 'Leistungszeitraum, z. B. „Oktober 2026“'],
  ['Objekt', 'Objekt'],
  ['Betreff', 'Betreff des Belegs'],
  ['Referenz', 'Ihre Bestellnummer/Zeichen'],
  ['Skonto', 'z. B. „2 % Skonto (€ 23,52) bei Zahlung bis 12.11.2026“'],
  ['Zahlungsbedingung', 'ganzer Text der Zahlungsbedingung'],
  ['Gültig', 'Angebot gültig bis'],
  ['Mahnstufe', 'Name der Mahnstufe'],
  ['Frist', 'neue Zahlungsfrist der Mahnung'],
  ['Firma', 'eigener Firmenname'],
  ['Benutzer', 'Name der angemeldeten Person'],
  ['IBAN', 'eigene IBAN'],
  ['Heute', 'heutiges Datum'],
]

const phKey = (s) => String(s).trim().toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[\s_-]+/g, '')
const PH_KEYS = new Set(PLACEHOLDERS.map(([k]) => phKey(k)))
const eurAt = (n) => Number(n || 0).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
const pctText = (n) => String(round2(n)).replace('.', ',')

/**
 * Platzhalter wie {Kunde} oder {Fällig} durch die Werte aus ctx ersetzen ({ Kunde: '…', 'Fällig': '…' }).
 * Unbekannte Platzhalter bleiben stehen (sie fallen beim Lesen auf); ein bekannter ohne Wert wird leer.
 */
export function fillPlaceholders(text, ctx = {}) {
  const s = String(text ?? '')
  if (!s.includes('{')) return s
  const map = new Map(Object.entries(ctx).map(([k, v]) => [phKey(k), v]))
  return s.replace(/\{([^{}\n]{1,40})\}/g, (m, name) => {
    const k = phKey(name)
    return map.has(k) && map.get(k) != null ? String(map.get(k)) : m
  })
}

/** Platzhalter im Text, die es nicht gibt (Tippfehler): ['{Kundee}']. */
export const unknownPlaceholders = (text) => [...String(text ?? '').matchAll(/\{([^{}\n]{1,40})\}/g)].filter((m) => !PH_KEYS.has(phKey(m[1]))).map((m) => m[0])

/** Briefanrede ohne Beistrich: „Sehr geehrter Herr Dr. Maier“, „Sehr geehrte Frau Huber“, sonst „Sehr geehrte Damen und Herren“. */
export function greetingOf(c = {}) {
  const sal = String(c?.salutation || '').trim().toLowerCase().replace(/\.$/, '')
  const last = String(c?.lastName || '').trim()
  const name = [String(c?.title || '').trim(), last].filter(Boolean).join(' ')
  if (last && ['herr', 'herrn', 'hr'].includes(sal)) return `Sehr geehrter Herr ${name}`
  if (last && ['frau', 'fr'].includes(sal)) return `Sehr geehrte Frau ${name}`
  if (last && sal === 'familie') return `Sehr geehrte Familie ${last}`
  return DEFAULT_GREETING
}

/** Werte aller Platzhalter für einen Beleg (customer für {Anrede}, reminder/open für Mahnungen). */
export function placeholderContext({ doc = {}, customer = null, settings = {}, user = '', reminder = null, open = null, today = '', terms = null } = {}) {
  const s = settingsOf({ settings })
  const t = doc.total || totals(doc, s)
  const sk = skontoOf(doc, s)
  const ctx = {
    Anrede: greetingOf(customer || {}),
    Kunde: doc.recipient?.name || customerName(customer || {}),
    Ansprechpartner: doc.contactName || '',
    Kundennummer: doc.recipient?.customerNo || customer?.customerNo || '',
    Belegart: KINDS[doc.kind] || '',
    Belegnummer: doc.number || '',
    Datum: deDate(doc.date),
    'Fällig': deDate(doc.dueDate),
    Betrag: eurAt(t.gross),
    Offen: open == null ? '' : eurAt(open),
    Zeitraum: doc.serviceFrom ? periodLabel({ from: doc.serviceFrom, to: doc.serviceTo || doc.serviceFrom }) : '',
    Objekt: doc.objectName || '',
    Betreff: doc.title || '',
    Referenz: doc.reference || '',
    Skonto: sk ? `${pctText(sk.percent)} % Skonto (${eurAt(sk.amount)}) bei Zahlung bis ${deDate(sk.until)}` : '',
    'Gültig': deDate(doc.validUntil),
    Mahnstufe: reminder?.name || '',
    Frist: reminder?.deadline ? deDate(reminder.deadline) : '',
    Firma: s.sender.name,
    Benutzer: user,
    IBAN: formatIban(s.bank.iban),
    Heute: deDate(today),
  }
  ctx.Zahlungsbedingung = doc.termsText || termsTextOf(doc, s, terms, ctx)
  return ctx
}

/**
 * Betreff, Einleitung und Schlusstext mit aufgelösten Platzhaltern, bei Rechnungen dazu der Text der
 * Zahlungsbedingung (termsText, nur mit Skonto oder eigenem Text). Für das Festschreiben und die Vorschau.
 */
export function resolveTexts(doc, { settings = {}, customer = null, terms = null, user = '', today = '' } = {}) {
  const s = settingsOf({ settings })
  const ctx = placeholderContext({ doc, customer, settings: s, user, today, terms })
  const out = {}
  for (const k of ['title', 'intro', 'outro']) if (typeof doc[k] === 'string') out[k] = fillPlaceholders(doc[k], ctx)
  if (doc.kind === 'rechnung' && !doc.termsText) {
    const tt = termsTextOf(doc, s, terms, ctx)
    if (tt) out.termsText = tt
  }
  return out
}

// ---------------------------------------------------------------- Textbausteine

export const TEXT_PLACES = { intro: 'Einleitung', outro: 'Schlusstext', mail: 'E-Mail-Text', reminder: 'Mahnungstext', position: 'Positionstext' }
export const TEXT_KINDS = { ...KINDS, mahnung: 'Mahnung', alle: 'alle Belegarten' }
const placeOf = (b) => b.place || 'intro'

/** Textbausteine für eine Belegart und Stelle: eigene Belegart vor „alle“, Standard zuerst, dann nach Name. */
export function blocksFor(blocks = [], kind, place) {
  const general = (b) => !b.kind || b.kind === 'alle' || (place === 'mail' && b.kind === 'mail')
  const fits = (b) => placeOf(b) === place && (b.kind === kind || (kind in KINDS && general(b)))
  return (blocks || []).filter(fits).sort((a, b) => (b.kind === kind) - (a.kind === kind) || (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || String(a.name).localeCompare(String(b.name), 'de'))
}

/** Standard-Textbaustein (isDefault) für Belegart und Stelle, eigene Belegart vor „alle“; sonst null. */
export const defaultBlock = (blocks, kind, place) => blocksFor(blocks, kind, place).find((b) => b.isDefault) || null

/** Einleitung und Schlusstext für einen neuen Beleg: Standard-Textbaustein, sonst die Texte aus den Einstellungen. */
export function defaultTexts(kind, settings = {}, blocks = []) {
  const s = settingsOf({ settings })
  const offer = kind === 'angebot'
  return { intro: defaultBlock(blocks, kind, 'intro')?.text ?? (offer ? s.offerIntro : s.intro), outro: defaultBlock(blocks, kind, 'outro')?.text ?? (offer ? s.offerOutro : s.outro) }
}

// ---------------------------------------------------------------- Zahlungsbedingungen und Skonto

export const termsById = (list = [], id) => (id ? (list || []).find((t) => t.id === id) || null : null)
export const defaultTerms = (list = []) => (list || []).find((t) => t.isDefault) || null
export const skontoOfTerms = (t) => (t && parseNumber(t.skontoPercent) > 0 ? { percent: parseNumber(t.skontoPercent), days: Math.max(0, Number(t.skontoDays) || 0) } : null)
const hasDays = (v) => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v))

/** Kurzbeschreibung einer Zahlungsbedingung: „14 Tage netto, 7 Tage 2 % Skonto“. */
export function termsLabel(t) {
  if (!t) return ''
  const sk = skontoOfTerms(t)
  const days = Number(t.days) || 0
  return [days ? `${days} Tage netto` : 'sofort netto', sk ? `${sk.days} Tage ${pctText(sk.percent)} % Skonto` : ''].filter(Boolean).join(', ')
}

/**
 * Zahlungsbedingung für einen neuen Beleg: die des Kunden (termsId), sonst die Standard-Bedingung.
 * Zahlungsziel: Bedingung des Kunden, sonst Zahlungsziel beim Kunden, sonst Standard-Bedingung, sonst Einstellungen.
 * Liefert { termsId, days, skonto: { percent, days } | null }.
 */
export function termsSetup(customer, list = [], settings = {}) {
  const s = settingsOf({ settings })
  const own = termsById(list, customer?.termsId)
  const t = own || defaultTerms(list)
  const days = own && hasDays(own.days) ? Number(own.days) : hasDays(customer?.paymentDays) ? Number(customer.paymentDays) : t && hasDays(t.days) ? Number(t.days) : Number(s.paymentDays) || 0
  return { termsId: t?.id || '', days, skonto: skontoOfTerms(t) }
}

/** Skonto einer Rechnung: { percent, days, until, base (brutto), amount, payable } oder null. */
export function skontoOf(d, settings) {
  const p = parseNumber(d?.skonto?.percent)
  if (!(p > 0) || d.kind !== 'rechnung' || !d.date) return null
  const base = grossOf(d, settings)
  if (!(base > 0)) return null
  const days = Math.max(0, Number(d.skonto.days) || 0)
  const amount = round2((base * p) / 100)
  return { percent: p, days, until: addDaysIso(d.date, days), base, amount, payable: round2(base - amount) }
}

/**
 * Text der Zahlungsbedingung auf der Rechnung, mit Betrag und Datum:
 * „Zahlbar binnen 14 Tagen netto (bis 17.11.2026), bei Zahlung binnen 7 Tagen (bis 10.11.2026) 2 % Skonto (€ 23,52), …“.
 * Ein eigener Text der Bedingung (terms.text) geht vor; ohne Platzhalter wird das Skonto mit Betrag angehängt.
 * Ohne Skonto und ohne eigenen Text: leer (dann gilt der übliche Satz „ohne Abzug“).
 */
export function termsTextOf(d, settings, terms = null, ctx = null) {
  if (d.termsText) return d.termsText
  if (d.kind !== 'rechnung') return ''
  const sk = skontoOf(d, settings)
  const custom = String(terms?.text || '').trim()
  if (!sk && !custom) return ''
  const due = d.dueDate && d.date ? daysBetween(d.date, d.dueDate) : null
  const net = due ? `binnen ${due} Tagen netto (bis ${deDate(d.dueDate)})` : due === 0 ? 'sofort netto' : 'netto'
  if (!custom) return `Zahlbar ${net}, bei Zahlung binnen ${sk.days} Tagen (bis ${deDate(sk.until)}) ${pctText(sk.percent)} % Skonto (${eurAt(sk.amount)}), Zahlbetrag dann ${eurAt(sk.payable)}.`
  const c = ctx || { 'Fällig': deDate(d.dueDate), Betrag: eurAt(grossOf(d, settings)), Skonto: sk ? `${pctText(sk.percent)} % Skonto (${eurAt(sk.amount)}) bei Zahlung bis ${deDate(sk.until)}` : '' }
  const filled = fillPlaceholders(custom, { ...c, Zahlungsbedingung: '' })
  if (!sk || /\{/.test(custom)) return filled
  return `${filled.replace(/[.\s]+$/, '')} (${pctText(sk.percent)} % Skonto ${eurAt(sk.amount)} bei Zahlung bis ${deDate(sk.until)}, Zahlbetrag dann ${eurAt(sk.payable)}).`
}

/** Vermerkter Skontoabzug (Zahlungseinträge mit kind 'skonto'). */
export const skontoTaken = (d) => round2((d.payments || []).filter((p) => p.kind === 'skonto').reduce((s, p) => s + parseNumber(p.amount), 0))
/** Bezahlt ohne Skonto (Geldeingänge). */
export const cashPaidOf = (d) => round2(paidOf(d) - skontoTaken(d))

/** Ohne Vermerk: Zahlungen in der Skontofrist decken brutto abzüglich Skonto → der Rest gilt als Skonto. */
function implicitSkonto(d, base, settings) {
  const pays = d.payments || []
  if (!pays.length || pays.some((p) => p.kind === 'skonto') || !(base > 0)) return 0
  const sk = skontoOf(d, settings)
  if (!sk) return 0
  const amount = round2((base * sk.percent) / 100)
  const inTime = round2(pays.filter((p) => p.date && p.date <= sk.until).reduce((s, p) => s + parseNumber(p.amount), 0))
  const rest = round2(base - paidOf(d))
  return inTime >= base - amount - 0.01 && rest > 0.004 && rest <= amount + 0.01 ? rest : 0
}

/**
 * Skonto, das bei einer Zahlung am Tag date noch abgezogen werden darf (auf brutto samt Korrekturen);
 * 0, wenn die Frist vorbei, das Skonto schon vermerkt oder die Rechnung storniert ist.
 */
export function skontoAvailable(d, docs, settings, date) {
  const sk = skontoOf(d, settings)
  if (!sk || !date || date > sk.until || !d.number || isCancelled(d, docs)) return 0
  if ((d.payments || []).some((p) => p.kind === 'skonto')) return 0
  const base = round2(sk.base + refsOf(d, docs).reduce((s, x) => s + grossOf(x, settings), 0))
  return base > 0 ? round2((base * sk.percent) / 100) : 0
}

/**
 * Zahlungseinträge für eine Zahlung: liegt sie in der Skontofrist und fehlt danach höchstens das Skonto
 * (1 Cent Spielraum), wird der Rest als Skonto vermerkt (eigener Eintrag kind 'skonto', ref = Zahlung).
 * Liefert [Zahlung] oder [Zahlung, Skonto].
 */
export function paymentEntries(d, docs, settings, payment, { newId = () => Math.random().toString(36).slice(2, 10) } = {}) {
  const entry = { ...payment, id: payment.id || newId(), amount: round2(parseNumber(payment.amount)) }
  const sk = skontoAvailable(d, docs, settings, entry.date)
  if (!sk) return [entry]
  const rest = round2(openAmount(d, docs, settings) - entry.amount)
  if (!(rest > 0.004 && rest <= sk + 0.01)) return [entry]
  const extra = Object.fromEntries(['bank', 'by', 'at'].filter((k) => entry[k]).map((k) => [k, entry[k]]))
  return [entry, { id: newId(), date: entry.date, amount: rest, kind: 'skonto', ref: entry.id, note: `Skonto ${pctText(skontoOf(d, settings).percent)} % (Zahlung in der Skontofrist)`, ...extra }]
}

/**
 * Skontobetrag (brutto) auf die Steuersätze der Rechnung aufteilen (anteilig nach brutto, Rest auf den letzten):
 * [{ rate, gross, net, vat }]. Grundlage für die Korrektur der Umsatzsteuer.
 */
export function skontoSplit(d, amount, settings) {
  const groups = (d.total || totals(d, settings)).groups || []
  const g2 = groups.map((g) => round2(g.net + g.vat))
  const all = round2(g2.reduce((a, b) => a + b, 0))
  if (!groups.length || !all) return []
  let rest = round2(amount)
  return groups
    .map((g, i) => {
      const part = i === groups.length - 1 ? rest : round2((amount * g2[i]) / all)
      rest = round2(rest - part)
      const net = round2(part / (1 + (g.vat ? g.rate : 0) / 100))
      return { rate: g.rate, gross: part, net, vat: round2(part - net) }
    })
    .filter((x) => x.gross)
}

// ---------------------------------------------------------------- Kunden: Suche, Verlauf

/** Anzeigename: Firma, sonst Person. */
export const customerName = (c = {}) => c.name || personLine(c) || ''

/** Suche über alle Felder des Kunden (auch Ansprechpartner und übernommene Felder); mehrere Wörter: alle müssen vorkommen. */
export function customerMatches(c, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return true
  const fields = [c.name, c.customerNo, c.salutation, c.title, c.firstName, c.lastName, c.street, c.zip, c.city, c.country, c.address, c.phone, c.mobile, c.fax, c.web, c.email, c.uid, c.iban, c.group, c.note, c.deliveryAddress]
  const hay = [...fields, ...(c.contacts || []).flatMap((p) => [p.name, p.role, p.email, p.phone]), ...Object.entries(c.extra || {}).flat()].map((v) => String(v ?? '').toLowerCase()).join(' \n ')
  return q.split(/\s+/).every((w) => hay.includes(w))
}

/** Ort für die Kundenliste: Feld „Ort“, sonst aus der Anschrift gelesen. */
export const customerCity = (c = {}) => c.city || parseAddress(c.address).city || ''

/**
 * Verlauf eines Kunden: alle Belege (neueste zuerst) mit Zustand, Summen und offenem Betrag, Umsatz netto
 * je Jahr (festgeschriebene Rechnungen samt Storno und Korrektur) und die Summe offen.
 */
export function customerHistory(docs, customerId, { today, settings } = {}) {
  const rows = docs
    .filter((d) => customerId && d.customerId === customerId)
    .map((d) => {
      const t = d.total || totals(d, settings)
      return { doc: d, state: stateOf(d, docs, today, settings), net: t.net, gross: t.gross, open: d.kind === 'rechnung' && d.number ? openAmount(d, docs, settings) : 0 }
    })
    .sort((a, b) => String(b.doc.date).localeCompare(String(a.doc.date)) || String(b.doc.number || '').localeCompare(String(a.doc.number || '')))
  const years = new Map()
  for (const r of rows) {
    if (!isInvoice(r.doc) || !r.doc.number) continue
    const y = yearOf(r.doc)
    const cur = years.get(y) || { year: y, net: 0, count: 0 }
    cur.net = round2(cur.net + r.net)
    if (r.doc.kind === 'rechnung') cur.count++
    years.set(y, cur)
  }
  return { rows, years: [...years.values()].sort((a, b) => b.year.localeCompare(a.year)), open: round2(rows.reduce((a, r) => a + Math.max(0, r.open), 0)) }
}

// ---------------------------------------------------------------- Artikel

export const articleActive = (a) => a?.active !== false
export const articleLabel = (a) => [a.articleNo, a.name].filter(Boolean).join(' – ')

/** Rohertrag: Verkauf netto − Einkauf netto, in € und % vom Verkauf; null ohne Einkaufspreis. */
export function articleMargin(a) {
  const price = parseNumber(a.price)
  if (a.cost === '' || a.cost === null || a.cost === undefined || !(price > 0)) return null
  const amount = round2(price - parseNumber(a.cost))
  return { amount, percent: round2((amount / price) * 100) }
}

/** Artikel zur Eingabe (Artikelnummer, „Nr. – Name“ oder Name; sonst eindeutiger Teil des Namens), nur aktive. */
export function findArticle(articles = [], query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return null
  const list = articles.filter(articleActive)
  const exact = list.find((a) => String(a.articleNo || '').toLowerCase() === q) || list.find((a) => articleLabel(a).toLowerCase() === q) || list.find((a) => String(a.name || '').toLowerCase() === q)
  if (exact) return exact
  const part = list.filter((a) => `${a.articleNo || ''} ${a.name || ''}`.toLowerCase().includes(q))
  return part.length === 1 ? part[0] : null
}

/** Position aus einem Artikel: Bezeichnung (mit Zusatz), Langtext und Artikelnummer, Menge 1. */
export const lineFromArticle = (a, { id, vat = 20 } = {}) => ({
  id,
  text: [a.name, a.text].filter(Boolean).join(' – '),
  ...(a.longText ? { longText: a.longText } : {}),
  ...(a.articleNo ? { articleNo: a.articleNo } : {}),
  qty: 1,
  unit: a.unit || 'Pauschale',
  price: parseNumber(a.price),
  vat: a.vat ?? vat,
  discount: 0,
})

// ---------------------------------------------------------------- Anschrift zerlegen (für die E-Rechnung)

export { COUNTRY_NAMES }
const COUNTRY_BY_NAME = new Map([...Object.entries(COUNTRY_NAMES).map(([k, v]) => [v.toLowerCase(), k]), ['austria', 'AT'], ['germany', 'DE'], ['switzerland', 'CH'], ['italy', 'IT'], ['italia', 'IT'], ['slovenija', 'SI'], ['magyarország', 'HU'], ['česko', 'CZ'], ['slovensko', 'SK']])
const PREFIX_COUNTRY = { A: 'AT', AT: 'AT', D: 'DE', DE: 'DE', CH: 'CH', I: 'IT', IT: 'IT', SLO: 'SI', SI: 'SI', H: 'HU', HU: 'HU', CZ: 'CZ', SK: 'SK', FL: 'LI', LI: 'LI' }

/**
 * Mehrzeilige Anschrift in Felder zerlegen: { street, zip, city, country (ISO), attention (z. H.), extra[] }.
 * Erkennt „5020 Salzburg“, „A-5020 Salzburg“, „D-80331 München“, ein Land in der letzten Zeile und
 * einzeilige Anschriften mit Beistrich („Ringstraße 3, 5020 Salzburg“). Ohne Land: AT.
 */
export function parseAddress(text = '') {
  let lines = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  if (lines.length === 1 && lines[0].includes(',')) lines = lines[0].split(',').map((s) => s.trim()).filter(Boolean)
  const zipRe = /^(?:([A-Za-z]{1,3})\s*[-–]\s*)?(\d{4,5})\s+(.+)$/
  const zi = lines.findIndex((l) => zipRe.test(l))
  const out = { street: '', zip: '', city: '', country: 'AT', attention: '', extra: [] }
  const before = zi >= 0 ? lines.slice(0, zi) : lines
  const after = zi >= 0 ? lines.slice(zi + 1) : []
  if (zi >= 0) {
    const [, prefix, zip, city] = lines[zi].match(zipRe)
    out.zip = zip
    out.city = city
    if (prefix && PREFIX_COUNTRY[prefix.toUpperCase()]) out.country = PREFIX_COUNTRY[prefix.toUpperCase()]
  }
  for (const l of after) {
    const code = COUNTRY_BY_NAME.get(l.toLowerCase()) || (/^[A-Z]{2}$/.test(l) ? l : '')
    if (code) out.country = code
    else out.extra.push(l)
  }
  const rest = []
  const att = /^(z\.\s*h\.?|zh\.?|attn\.?|zu handen)\s*/i
  for (const l of before) {
    if (att.test(l)) out.attention = l.replace(att, '').trim()
    else rest.push(l)
  }
  // die Straße ist die letzte Zeile vor PLZ und Ort, davor stehen Zusätze (z. B. ein zweiter Name)
  out.street = rest.length ? rest.at(-1) : ''
  out.extra = [...rest.slice(0, -1), ...out.extra]
  return out
}
