// Kundenverträge mit Fristen (Fakturierung → Verträge): Beginn, Mindestlaufzeit, Ende oder unbefristet, Kündigungsfrist zum
// Termin (Monats-, Quartals-, Jahresende, Ende des Vertragsjahres), automatische Verlängerung, Kündigung (am, von, zum,
// Grund), Erinnerungen, Vertragsvolumen und die Preisanpassung nach KV-Lohnerhöhung (Lohnkostenklausel) zusätzlich zur
// Wertsicherung nach VPI. Rein rechnend, ohne Browser (Oberfläche: ui/views/invoicing-vertraege.js, Tests:
// test/vertraege.test.js).
//
// Keine zweite Rechnungslogik: abgerechnet wird weiter über die Daueraufträge (recurring[] und runRecurring in
// core/invoicing.js). Ein Vertrag ist der rechtliche Rahmen (Laufzeit, Fristen, Klausel, Dokument, Leistungsumfang); die
// Daueraufträge hängen über recurring[].contractId daran. Ein Vertrag kann mehrere Daueraufträge haben (z. B.
// Unterhaltsreinigung monatlich und Glasreinigung quartalsweise) oder keinen (Abrechnung nach Leistungsnachweis).
// Eine Preisanpassung nach KV wird als Preisstufe am Dauerauftrag geplant (recurring[].steps, „gültig ab“); der Monatslauf
// übernimmt sie ab dem Monat – festgeschriebene Rechnungen bleiben, wie sie sind.
//
// Datenmodell in fakturierung/fakturierung.json (alle Felder optional, alte Dateien bleiben gültig):
//  contracts[]  { id, no, customerId, title, start (Beginn), minMonths (Mindestlaufzeit), end (befristet bis; leer =
//                 unbefristet), renewMonths (verlängert sich jeweils um n Monate; 0 = nein), notice { n, unit: 'monat' |
//                 'woche' | 'tag' } (Kündigungsfrist), term ('monat' | 'quartal' | 'jahr' | 'vertragsjahr': Kündigung zum
//                 Monats-, Quartals-, Jahresende bzw. Ende des Vertragsjahres; bei Verlängerung immer zum Ende der Laufzeit),
//                 remindDays (Vorlauf der Erinnerung; leer = settings.contracts.remindDays, Vorgabe 30),
//                 cancel { at (gekündigt am = Zugang), by: 'kunde' | 'wir', to (zum), reason, recordedAt, recordedBy,
//                   doneAt, doneBy (Dauerauftrag beendet, Objekt freigegeben) },
//                 contact { id, name, email, phone } (Ansprechperson), document { path, name, type, size, at, by, url?,
//                 local? } (Vertrag als PDF in SharePoint: fakturierung/vertraege/…), objectIds, taskIds, scope (Text),
//                 clause ('keine' | 'vpi' | 'kv' | 'beides'), kvShare (Lohnanteil am Preis in %), volume (Monatswert netto,
//                 nur ohne Dauerauftrag), note, history [{ at, by, text }], createdAt/By, updatedAt/By }
//  recurring[]  contractId; steps [{ id, kind: 'kv', from ('JJJJ-MM-TT' gültig ab), fromMonth, percent (KV-Erhöhung),
//                 share (Lohnanteil), change (Preisänderung in %), factor, lines [{ id, text, old, new }], note, runId, at, by,
//                 applied ('JJJJ-MM': im Monatslauf übernommen) }]; history[] dazu kind ('vpi' | 'kv') und ym
//  priceRuns[]  { id, kind: 'kv', percent, from, fromMonth, label, at, by, items [{ contractId, customerId, recurringId,
//                 stepId, title, oldNet, newNet, change, effective }], serialId }
//  settings.contracts { remindDays }

import { ADJUST_LOCK_MONTHS, INTERVALS, latestIndex, lineType, monthLabel, parseNumber, periodOf, round2, stepLines, totals } from './invoicing.js'

export const TERMS = { monat: 'Monatsende', quartal: 'Quartalsende', jahr: 'Jahresende', vertragsjahr: 'Ende des Vertragsjahres' }
export const NOTICE_UNITS = { monat: ['Monat', 'Monate'], woche: ['Woche', 'Wochen'], tag: ['Tag', 'Tage'] }
export const CLAUSES = { keine: 'keine', vpi: 'Wertsicherung nach VPI', kv: 'Lohnkostenklausel (KV-Lohn)', beides: 'VPI oder KV-Lohn (nach Wahl)' }
export const STATUS = { laeuft: 'läuft', kuendbar: 'kündbar', gekuendigt: 'gekündigt', beendet: 'beendet' }
export const CANCEL_BY = { kunde: 'vom Kunden', wir: 'von uns' }
/** „kündbar“: der späteste Tag für die Kündigung liegt in den nächsten 90 Tagen (auch Filter der Liste). */
export const KUENDBAR_DAYS = 90
/** Erinnerung: so viele Tage vor dem letzten Kündigungstag (je Vertrag oder in den Einstellungen änderbar). */
export const REMIND_DAYS = 30
/** Vorgabe für den Lohnanteil am Preis bei der Lohnkostenklausel. */
export const KV_SHARE = 80
export const LOCK_MONTHS = ADJUST_LOCK_MONTHS
const INTERVAL_MONTHS = { monat: 1, quartal: 3, halbjahr: 6, jahr: 12 }

// ---------------------------------------------------------------- Datum (ISO-Text, UTC, ohne Zeitzone)

const pad = (n) => String(n).padStart(2, '0')
const parts = (iso) => iso.split('-').map(Number)
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const valid = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))
export const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)
export const isMonthEnd = (iso) => {
  const [y, m, d] = parts(iso)
  return d === daysIn(y, m)
}
export const monthEnd = (iso) => {
  const [y, m] = parts(iso)
  return `${y}-${pad(m)}-${pad(daysIn(y, m))}`
}
export const ymAdd = (ym, n) => {
  const [y, m] = ym.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`
}
const ymDiff = (a, b) => {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return yb * 12 + mb - (ya * 12 + ma)
}
/**
 * Gleicher Tag n Monate später (bzw. früher bei n < 0); fehlt der Tag im Zielmonat, der letzte Tag (§ 902 ABGB). Ist das
 * Datum ein Monatsletzter, ist es auch das Ergebnis (31.3. − 1 Monat = 28.2., 28.2.2027 + 12 Monate = 29.2.2028).
 */
export function shiftMonths(iso, n) {
  const [y, m, d] = parts(iso)
  const t = y * 12 + (m - 1) + n
  const ty = Math.floor(t / 12)
  const tm = (t % 12) + 1
  const last = daysIn(ty, tm)
  return `${ty}-${pad(tm)}-${pad(d === daysIn(y, m) ? last : Math.min(d, last))}`
}
/** Letzter Tag eines Zeitraums von n Monaten, der am Tag start beginnt: 1.1. + 12 → 31.12.; 15.3. + 12 → 14.3. */
export const endAfter = (start, months) => shiftMonths(addDays(start, -1), months)
const deDate = (iso) => (valid(iso) ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}` : '')
export { deDate as contractDate }

// ---------------------------------------------------------------- Fristen

const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}
/** Kündigungsfrist { n, unit }; ohne Angabe keine Frist (n = 0). */
export function noticeOf(c = {}) {
  const n = Math.round(num(c.notice?.n))
  return { n, unit: NOTICE_UNITS[c.notice?.unit] ? c.notice.unit : 'monat' }
}
export const noticeText = (notice) => (notice?.n ? `${notice.n} ${NOTICE_UNITS[notice.unit]?.[notice.n === 1 ? 0 : 1] || 'Monate'}` : 'ohne Frist')

/**
 * Spätester Tag, an dem die Kündigung beim Vertragspartner eingelangt sein muss, damit sie zum Termin wirkt: Monate –
 * gleicher Tag n Monate vorher, bei einem Monatsletzten der Monatsletzte (3 Monate zum 31.12. → 30.9.; zum 28.2. → 30.11.);
 * Wochen und Tage – so viele Tage vorher.
 */
export function latestNotice(termin, notice = { n: 0, unit: 'monat' }) {
  if (!notice?.n) return termin
  if (notice.unit === 'woche') return addDays(termin, -7 * notice.n)
  if (notice.unit === 'tag') return addDays(termin, -notice.n)
  return shiftMonths(termin, -notice.n)
}

/** Ende der Mindestlaufzeit (letzter Tag) oder '' ohne Mindestlaufzeit. */
export const minEndOf = (c = {}) => (valid(c.start) && num(c.minMonths) ? endAfter(c.start, Math.round(num(c.minMonths))) : '')

/**
 * Laufzeitmodell: 'befristet' (Ende ohne Verlängerung: endet von selbst), 'verlaengerung' (Laufzeit mit automatischer
 * Verlängerung um n Monate; gekündigt wird zum Ende der Laufzeit) oder 'unbefristet' (Kündigung zum Termin, frühestens
 * zum Ende der Mindestlaufzeit). firstEnd: Ende der ersten Laufzeit (Ende bzw. Beginn + Mindestlaufzeit, ohne beides +
 * Verlängerungszeitraum).
 */
export function modelOf(c = {}) {
  const renew = Math.round(num(c.renewMonths))
  if (renew > 0) {
    const first = valid(c.end) ? c.end : valid(c.start) ? endAfter(c.start, Math.round(num(c.minMonths)) || renew) : ''
    return { kind: 'verlaengerung', firstEnd: first, renew }
  }
  if (valid(c.end)) return { kind: 'befristet', firstEnd: c.end, renew: 0 }
  return { kind: 'unbefristet', firstEnd: '', renew: 0 }
}

/** Ende der Laufzeit k (k = 0: erste Laufzeit) beim Modell mit Verlängerung. */
const periodEnd = (model, k) => (k ? shiftMonths(model.firstEnd, k * model.renew) : model.firstEnd)

/** Erster Kündigungstermin am oder nach date (ohne Rücksicht auf die Frist). */
export function terminOnOrAfter(date, term, start = '') {
  const [y, m] = parts(date)
  if (term === 'quartal') return monthEnd(`${y}-${pad(Math.ceil(m / 3) * 3)}-01`)
  if (term === 'jahr') return `${y}-12-31`
  if (term === 'vertragsjahr' && valid(start)) {
    let k = Math.max(1, Math.floor(ymDiff(start.slice(0, 7), date.slice(0, 7)) / 12))
    let t = endAfter(start, 12 * k)
    while (t > date && k > 1) t = endAfter(start, 12 * --k)
    while (t < date) t = endAfter(start, 12 * ++k)
    return t
  }
  return monthEnd(date)
}

/**
 * Nächster Kündigungstermin, zu dem eine Kündigung mit Zugang am Tag date noch wirkt:
 * { termin, latest (spätester Tag für die Kündigung), renewal (Tag, an dem sich der Vertrag sonst verlängert), model }.
 * termin = '' bei befristeten Verträgen nach dem letzten Kündigungstag (sie enden ohnehin) und ohne Beginn.
 */
export function nextTermination(c = {}, date) {
  const model = modelOf(c)
  const notice = noticeOf(c)
  const out = (termin, renewal = '') => ({ termin, latest: termin ? latestNotice(termin, notice) : '', renewal, model, notice })
  if (!valid(c.start) || !valid(date)) return out('')
  if (model.kind === 'befristet') return out(latestNotice(model.firstEnd, notice) >= date ? model.firstEnd : '')
  if (model.kind === 'verlaengerung') {
    if (!model.firstEnd) return out('')
    // rückwirkend eingegebene Verträge: ungefähr bei der laufenden Laufzeit anfangen
    let k = Math.max(0, Math.floor(ymDiff(model.firstEnd.slice(0, 7), date.slice(0, 7)) / model.renew) - 1)
    while (k > 0 && latestNotice(periodEnd(model, k - 1), notice) >= date) k--
    while (latestNotice(periodEnd(model, k), notice) < date) k++
    const t = periodEnd(model, k)
    return out(t, addDays(t, 1))
  }
  const min = minEndOf(c)
  const lower = [min || addDays(c.start, -1), date].sort().at(-1)
  let t = terminOnOrAfter(lower < c.start ? c.start : lower, c.term, c.start)
  for (let i = 0; i < 400 && latestNotice(t, notice) < date; i++) t = terminOnOrAfter(addDays(t, 1), c.term, c.start)
  return out(t)
}

/** Frühester Termin für eine Kündigung mit Zugang am Tag at (Vorschlag für „zum“). */
export const earliestEnd = (c, at) => {
  const n = nextTermination(c, at)
  return n.termin || (n.model.kind === 'befristet' ? n.model.firstEnd : '')
}

/** Vertragsende, soweit schon bekannt: gekündigt zum … bzw. Ende eines befristeten Vertrags; sonst ''. */
export const endOf = (c = {}) => (valid(c.cancel?.to) ? c.cancel.to : modelOf(c).kind === 'befristet' ? c.end : '')

/**
 * Stand am Tag today: { status: 'laeuft' | 'kuendbar' | 'gekuendigt' | 'beendet', label, termin, latest, renewal, end,
 * minEnd, model, future (beginnt erst), days (Tage bis zum letzten Kündigungstag) }.
 */
export function contractStatus(c = {}, today) {
  const end = endOf(c)
  const minEnd = minEndOf(c)
  const base = { termin: '', latest: '', renewal: '', end, minEnd, model: modelOf(c), future: false, days: null }
  if (end && end < today) return { ...base, status: 'beendet', label: `beendet am ${deDate(end)}` }
  if (valid(c.cancel?.to)) return { ...base, status: 'gekuendigt', label: `gekündigt zum ${deDate(c.cancel.to)}` }
  const n = nextTermination(c, today)
  const future = valid(c.start) && c.start > today
  const r = { ...base, termin: n.termin, latest: n.latest, renewal: n.renewal, future, days: n.latest ? daysBetween(today, n.latest) : null }
  if (base.model.kind === 'befristet') return { ...r, status: 'laeuft', label: `${future ? `beginnt am ${deDate(c.start)}, ` : ''}befristet bis ${deDate(c.end)}` }
  if (n.termin && r.days <= KUENDBAR_DAYS) return { ...r, status: 'kuendbar', label: `kündbar bis ${deDate(n.latest)}` }
  return { ...r, status: 'laeuft', label: future ? `beginnt am ${deDate(c.start)}` : 'läuft' }
}

/** „3 Monate zum Quartalsende“, „1 Monat zum Ende der Laufzeit“, „ohne Frist zum Monatsende“. */
export function noticeLabel(c = {}) {
  const m = modelOf(c)
  if (m.kind === 'befristet') return `befristet, endet ohne Kündigung`
  return `${noticeText(noticeOf(c))} zum ${m.kind === 'verlaengerung' ? 'Ende der Laufzeit' : TERMS[c.term] || TERMS.monat}`
}

/** „1.1.2026 – unbefristet, mind. 12 Monate“, „1.1.2026 – 31.12.2026, verlängert sich um 12 Monate“. */
export function termLabel(c = {}) {
  const m = modelOf(c)
  const min = Math.round(num(c.minMonths))
  const parts2 = [`${deDate(c.start) || '?'} – ${valid(c.end) ? deDate(c.end) : m.kind === 'verlaengerung' ? `${deDate(m.firstEnd)}` : 'unbefristet'}`]
  if (m.kind === 'unbefristet' && min) parts2.push(`mind. ${min} Monate`)
  if (m.kind === 'verlaengerung') parts2.push(`verlängert sich um ${m.renew} Monate`)
  return parts2.join(', ')
}

/**
 * Eingaben prüfen: [{ field, text, level: 'error' | 'warn' }]. Fehler verhindern das Speichern (Kunde, Beginn, Ende
 * nicht vor Beginn, Zahlen ≥ 0, Kündigung mit Datum und Termin), Warnungen nicht (Mindestlaufzeit über das Ende hinaus,
 * Kündigung nicht fristgerecht).
 */
export function contractProblems(c = {}) {
  const out = []
  const err = (field, text) => out.push({ field, text, level: 'error' })
  const warn = (field, text) => out.push({ field, text, level: 'warn' })
  if (!c.customerId) err('customer', 'Bitte einen Kunden wählen.')
  if (!valid(c.start)) err('start', 'Bitte den Beginn eintragen.')
  if (valid(c.end) && valid(c.start) && c.end < c.start) err('end', 'Das Ende liegt vor dem Beginn.')
  for (const [field, v, label] of [['min', c.minMonths, 'Mindestlaufzeit'], ['renew', c.renewMonths, 'Verlängerung'], ['notice', c.notice?.n, 'Kündigungsfrist'], ['remind', c.remindDays, 'Vorlauf'], ['share', c.kvShare, 'Lohnanteil']]) {
    const s = String(v ?? '').trim()
    if (s && !(Number(s.replace(',', '.')) >= 0)) err(field, `${label}: bitte eine Zahl ab 0.`)
  }
  if (num(c.kvShare) > 100) err('share', 'Lohnanteil: höchstens 100 %.')
  const min = minEndOf(c)
  if (valid(c.end) && min && min > c.end) warn('min', `Die Mindestlaufzeit (bis ${deDate(min)}) reicht über das Ende hinaus.`)
  if (c.cancel) {
    if (!valid(c.cancel.at)) err('cancel-at', 'Kündigung: Datum des Eingangs fehlt.')
    if (!valid(c.cancel.to)) err('cancel-to', 'Kündigung: „zum“ fehlt.')
    else if (valid(c.cancel.at)) {
      if (c.cancel.to < c.cancel.at) err('cancel-to', 'Kündigung: „zum“ liegt vor dem Eingang.')
      const first = earliestEnd(c, c.cancel.at)
      if (first && c.cancel.to < first) warn('cancel-to', `Nicht fristgerecht: frühestens zum ${deDate(first)}. Früher nur einvernehmlich oder aus wichtigem Grund.`)
    }
  }
  return out
}

/** Nächste freie Vertragsnummer „V-2026-001“. */
export function nextContractNo(contracts = [], year) {
  const re = new RegExp(`^V-${year}-(\\d+)$`)
  const max = Math.max(0, ...contracts.map((c) => Number(re.exec(String(c.no || ''))?.[1] || 0)))
  return `V-${year}-${String(max + 1).padStart(3, '0')}`
}

// ---------------------------------------------------------------- Daueraufträge, Volumen

/** Daueraufträge eines Vertrags. */
export const contractRecs = (doc = {}, id) => (doc.recurring || []).filter((r) => id && r.contractId === id)

/** Netto je Abrechnung eines Dauerauftrags (mit Rabatt), wie auf der Rechnung. */
export const recNet = (rec, settings = {}) => totals({ lines: rec.lines || [], discount: rec.discount || 0 }, settings).net
/** Netto je Monat (quartalsweise ÷ 3 …). */
export const recMonthly = (rec, settings = {}) => round2(recNet(rec, settings) / (INTERVAL_MONTHS[rec.interval] || 1))

const recRuns = (rec, ym) => rec.active !== false && rec.startMonth && rec.startMonth <= ym && (!rec.endMonth || rec.endMonth >= ym)

/** Preise eines Dauerauftrags im Monat ym: noch nicht übernommene Preisstufen mit „gültig ab“ bis ym eingerechnet. */
export function recLinesAt(rec, ym) {
  let lines = rec.lines || []
  for (const st of rec.steps || []) if (!st.applied && st.fromMonth && st.fromMonth <= ym) lines = stepLines(lines, st)
  return lines
}

/** Vertrag im Monat ym in Kraft (Beginn bis Ende, soweit bekannt). */
export const contractActiveIn = (c, ym) => valid(c.start) && c.start.slice(0, 7) <= ym && (!endOf(c) || endOf(c).slice(0, 7) >= ym)

/** Vertragsvolumen netto je Monat: Summe der Daueraufträge (je Monat umgerechnet), ohne Dauerauftrag der Monatswert. */
export function contractVolume(doc = {}, c, ym, settings = {}) {
  if (!contractActiveIn(c, ym)) return 0
  const recs = contractRecs(doc, c.id)
  if (!recs.length) return round2(num(c.volume))
  return round2(recs.filter((r) => recRuns(r, ym)).reduce((s, r) => s + recMonthly({ ...r, lines: recLinesAt(r, ym) }, settings), 0))
}

/**
 * Kennzahlen: je Monat Vertragsvolumen netto, Verträge in Kraft, eingegangene Kündigungen (nach Datum des Eingangs; vom
 * Kunden bzw. von uns) und Vertragsenden; dazu die Verträge, die in den nächsten 90 Tagen enden.
 * months: [{ key: 'JJJJ-MM' }]. Liefert null ohne Verträge.
 */
export function contractKpi(doc = {}, months = [], today, settings = {}) {
  const list = doc.contracts || []
  if (!list.length) return null
  const rows = months.map((m) => {
    const ym = m.key
    const cancelled = list.filter((c) => valid(c.cancel?.at) && c.cancel.at.slice(0, 7) === ym)
    return {
      key: ym,
      volume: round2(list.reduce((s, c) => s + contractVolume(doc, c, ym, settings), 0)),
      active: list.filter((c) => contractActiveIn(c, ym)).length,
      cancelled: cancelled.length,
      byCustomer: cancelled.filter((c) => c.cancel.by !== 'wir').length,
      byUs: cancelled.filter((c) => c.cancel.by === 'wir').length,
      ended: list.filter((c) => endOf(c) && endOf(c).slice(0, 7) === ym).length,
    }
  })
  const limit = addDays(today, KUENDBAR_DAYS)
  const ending = list
    .filter((c) => endOf(c) && endOf(c) >= today && endOf(c) <= limit)
    .map((c) => ({ id: c.id, title: c.title, customerId: c.customerId, end: endOf(c), volume: contractVolume(doc, c, endOf(c).slice(0, 7), settings) }))
    .sort((a, b) => a.end.localeCompare(b.end))
  return { months: rows, ending, total: list.length }
}

// ---------------------------------------------------------------- Erinnerungen („Zu erledigen“, digitaler Mitarbeiter)

/** Vorlauf in Tagen oder null (leer, keine Zahl). */
const leadOf = (v) => (String(v ?? '').trim() !== '' && Number(v) >= 0 ? Math.round(Number(v)) : null)

/**
 * Erinnerungen am Tag today, nur zum Öffnen:
 *  - 'frist': Vertrag mit Verlängerung – „verlängert sich am …, kündbar bis …“; unbefristet nur vor dem ersten Termin nach
 *    der Mindestlaufzeit. Ab Vorlauf (Vorgabe 30 Tage) vor dem letzten Kündigungstag bis zu diesem Tag.
 *  - 'endet': befristeter Vertrag ohne Verlängerung, ab Vorlauf vor dem Ende.
 *  - 'gekuendigt': „Gekündigt zum …: Dauerauftrag endet, Objekt freigeben?“ ab Vorlauf vor dem Ende bis „erledigt“; sofort,
 *    wenn ein Dauerauftrag des Vertrags noch über das Ende hinaus läuft.
 * [{ id, kind, contractId, customerId, title, date, text, recs }], dringendste zuerst.
 */
export function contractReminders(doc = {}, today, { remindDays } = {}) {
  const lead0 = leadOf(remindDays) ?? leadOf(doc.settings?.contracts?.remindDays) ?? REMIND_DAYS
  const out = []
  for (const c of doc.contracts || []) {
    if (!valid(c.start)) continue
    const lead = leadOf(c.remindDays) ?? lead0
    const name = c.title || c.no || 'ohne Bezeichnung'
    if (c.cancel?.to) {
      if (c.cancel.doneAt) continue
      const end = c.cancel.to
      const lastYm = end.slice(0, 7)
      const recs = contractRecs(doc, c.id).filter((r) => r.active !== false)
      const running = recs.filter((r) => !r.endMonth || r.endMonth > lastYm)
      if (!running.length && today < addDays(end, -lead)) continue
      const recText = recs.length ? (running.length ? `Dauerauftrag läuft noch über ${monthLabel(lastYm)} hinaus` : `Dauerauftrag endet mit ${monthLabel(lastYm)}`) : 'kein Dauerauftrag'
      out.push({ id: `gekuendigt:${c.id}:${end}:${running.length}`, kind: 'gekuendigt', contractId: c.id, customerId: c.customerId, title: name, date: end, running: running.length, text: `Gekündigt zum ${deDate(end)}: Dauerauftrag endet, Objekt freigeben?`, detail: recText })
      continue
    }
    const st = contractStatus(c, today)
    if (st.status === 'beendet') continue
    if (st.model.kind === 'befristet') {
      if (today >= addDays(c.end, -lead) && today <= c.end) out.push({ id: `endet:${c.id}:${c.end}`, kind: 'endet', contractId: c.id, customerId: c.customerId, title: name, date: c.end, text: `Vertrag ${name} endet am ${deDate(c.end)} (befristet)`, detail: 'verlängern oder Dauerauftrag beenden' })
      continue
    }
    if (!st.latest || today < addDays(st.latest, -lead) || today > st.latest) continue
    if (st.model.kind === 'verlaengerung') {
      out.push({ id: `frist:${c.id}:${st.latest}`, kind: 'frist', contractId: c.id, customerId: c.customerId, title: name, date: st.latest, text: `Vertrag ${name} verlängert sich am ${deDate(st.renewal)}, kündbar bis ${deDate(st.latest)}`, detail: `um ${st.model.renew} Monate, sonst Kündigung ${noticeText(noticeOf(c))} vor dem ${deDate(st.termin)}` })
      continue
    }
    // unbefristet: nur der erste Termin nach der Mindestlaufzeit (danach jederzeit zum Termin kündbar)
    const min = minEndOf(c)
    if (!min) continue
    const first = terminOnOrAfter(min, c.term, c.start)
    if (st.termin !== first) continue
    out.push({ id: `frist:${c.id}:${st.latest}`, kind: 'frist', contractId: c.id, customerId: c.customerId, title: name, date: st.latest, text: `Vertrag ${name}: Mindestlaufzeit endet am ${deDate(min)}, kündbar bis ${deDate(st.latest)}`, detail: `zum ${deDate(st.termin)}, danach läuft er unbefristet weiter` })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Daueraufträge zum Vertragsende beenden: letzter Abrechnungsmonat = Monat des Endes (nur, wo sie länger liefen).
 * Liefert { recurring, changed: [ids], partial } – partial: Ende ist kein Monatsletzter (letzten Monat im Entwurf anteilig).
 */
export function endRecurring(recurring = [], contractId, end) {
  const ym = end.slice(0, 7)
  const changed = []
  const next = recurring.map((r) => {
    if (r.contractId !== contractId || r.active === false || (r.endMonth && r.endMonth <= ym)) return r
    changed.push(r.id)
    return { ...r, endMonth: ym }
  })
  return { recurring: next, changed, partial: !isMonthEnd(end) }
}

// ---------------------------------------------------------------- Preisanpassung nach KV-Lohnerhöhung (Lohnkostenklausel)

/** Preisänderung in %: KV-Erhöhung × Lohnanteil (4,5 % × 80 % = 3,6 %). */
export const kvChange = (percent, share = KV_SHARE) => round2((parseNumber(percent) * parseNumber(share)) / 100)
/** Erster Abrechnungsmonat ab „gültig ab“: der Monat, wenn es der Erste ist, sonst der nächste (nie rückwirkend). */
export const fromMonthOf = (date) => (date.slice(8, 10) === '01' ? date.slice(0, 7) : ymAdd(date.slice(0, 7), 1))

export { stepLines }

/** Letzte Wertsicherung nach VPI im Verlauf des Dauerauftrags: { ym, text } oder null (alte Einträge am Text erkannt). */
export function lastVpi(rec = {}) {
  const list = (rec.history || []).filter((h) => h.kind === 'vpi' || (!h.kind && /^Wertsicherung/.test(String(h.text || ''))))
  const h = list.at(-1)
  return h ? { ym: h.ym || String(h.at || '').slice(0, 7), text: h.text, change: h.change } : null
}

const kvMonth = (st) => st.applied || st.fromMonth

/**
 * Vorschau des Laufs „Preisanpassung“: je Vertrag mit Lohnkostenklausel (kv oder beides) die Daueraufträge mit altem und
 * neuem Preis, dem ersten Abrechnungsmonat mit neuem Preis und Gründen, warum etwas nicht angepasst wird.
 * { fromMonth, rows: [{ contract, customerId, name, share, change, recs: [{ rec, oldNet, newNet, lines, effective, billed,
 * drafts, blocked, hints }], ready }], skipped: [{ contract, reason }] }
 */
export function planKvRun(doc = {}, { percent, from, today, settings = {}, names = {} } = {}) {
  const p = parseNumber(percent)
  if (!(p > 0) || !valid(from)) return { fromMonth: '', rows: [], skipped: [] }
  const fromMonth = fromMonthOf(from)
  const docs = doc.documents || []
  const have = new Map()
  for (const d of docs) if (d.source?.type === 'dauerauftrag' && d.source.key) have.set(d.source.key, d)
  const rows = []
  const skipped = []
  for (const c of doc.contracts || []) {
    const name = names[c.customerId] || ''
    if (!['kv', 'beides'].includes(c.clause)) {
      if (c.clause === 'vpi') skipped.push({ contract: c, name, reason: 'Wertsicherung nach VPI: passt der Monatslauf an' })
      continue
    }
    const end = endOf(c)
    if (end && end < `${fromMonth}-01`) {
      skipped.push({ contract: c, name, reason: `endet am ${deDate(end)}, vor der Anpassung` })
      continue
    }
    const recs = contractRecs(doc, c.id).filter((r) => r.active !== false)
    if (!recs.length) {
      skipped.push({ contract: c, name, reason: 'ohne Dauerauftrag: Preis von Hand anpassen' })
      continue
    }
    const share = String(c.kvShare ?? '').trim() === '' ? KV_SHARE : parseNumber(c.kvShare)
    const change = kvChange(p, share)
    const factor = 1 + change / 100
    const out = recs.map((rec) => {
      const hints = []
      let blocked = ''
      if (rec.endMonth && rec.endMonth < fromMonth) blocked = `endet mit ${monthLabel(rec.endMonth)}`
      // erster Abrechnungsmonat ab „gültig ab“ ohne Beleg (festgeschriebene Rechnungen bleiben, Entwürfe mit altem Preis)
      const billed = []
      const drafts = []
      let effective = ''
      for (let ym = fromMonth, i = 0; i < 48 && !effective; ym = ymAdd(ym, 1), i++) {
        if (rec.endMonth && ym > rec.endMonth) break
        if (!periodOf(rec, ym)) continue
        const d = have.get(`rec:${rec.id}:${ym}`)
        if (!d) effective = ym
        else (d.number ? billed : drafts).push(ym)
      }
      if (!effective && !blocked) blocked = 'keine Abrechnung mehr ab diesem Monat'
      if (billed.length) hints.push(`schon festgeschrieben: ${billed.map(monthLabel).join(', ')} (bleibt unverändert)`)
      if (drafts.length) hints.push(`Entwurf mit altem Preis: ${drafts.map(monthLabel).join(', ')} – löschen und Monatslauf neu, sonst neuer Preis erst ab ${effective ? monthLabel(effective) : '–'}`)
      // keine Doppelanpassung im selben Zeitraum (12 Monate): weder zweimal KV noch KV und VPI
      const window = (ym) => ym > ymAdd(fromMonth, -LOCK_MONTHS) && ym < ymAdd(fromMonth, LOCK_MONTHS)
      const kv = (rec.steps || []).find((st) => st.kind === 'kv' && window(kvMonth(st)))
      if (kv) blocked ||= `schon nach KV angepasst ab ${monthLabel(kvMonth(kv))}`
      const vpiOn = c.clause === 'beides' || rec.index?.active
      const vpi = vpiOn ? lastVpi(rec) : null
      if (vpi && vpi.ym > ymAdd(fromMonth, -LOCK_MONTHS) && vpi.ym <= fromMonth) blocked ||= `Wertsicherung nach VPI im ${monthLabel(vpi.ym)}: keine zweite Anpassung innerhalb von ${LOCK_MONTHS} Monaten`
      if (rec.index?.active && !blocked) {
        if (c.clause === 'kv') hints.push('Dauerauftrag hat auch Wertsicherung nach VPI: gilt wie „nach Wahl“')
        const cur = latestIndex(doc.indexValues, ymAdd(fromMonth, -1))
        const base = Number(rec.index.baseValue)
        const diff = cur && base > 0 ? round2((cur.value / base - 1) * 100) : 0
        hints.push(`VPI-Anpassung entfällt bis ${monthLabel(ymAdd(fromMonth, LOCK_MONTHS - 1))}${cur ? `; neue Basis ${String(cur.value).replace('.', ',')} (${monthLabel(cur.ym)}${diff ? `, bisher ${diff > 0 ? '+' : ''}${String(diff).replace('.', ',')} %` : ''})` : ''}`)
      }
      const oldNet = recNet(rec, settings)
      const lines = (rec.lines || []).filter((l) => lineType(l) === 'item' && parseNumber(l.price)).map((l) => ({ id: l.id, text: l.text || '', old: round2(parseNumber(l.price)), new: round2(parseNumber(l.price) * factor) }))
      if (!lines.length) blocked ||= 'keine Position mit Preis'
      const newNet = recNet({ ...rec, lines: stepLines(rec.lines || [], { factor, lines }) }, settings)
      return { rec, oldNet, newNet, lines, effective, billed, drafts, blocked, hints, interval: INTERVALS[rec.interval] || 'monatlich' }
    })
    rows.push({ contract: c, customerId: c.customerId, name, share, change, factor, recs: out, ready: out.some((x) => !x.blocked) })
  }
  return { fromMonth, percent: p, from, rows, skipped }
}

/**
 * Lauf übernehmen: für die gewählten Verträge (ids) je Dauerauftrag ohne Sperre eine Preisstufe „gültig ab“ (steps[]),
 * dazu der Lauf (priceRuns[]) und ein Eintrag im Verlauf der Verträge. Festgeschriebene Rechnungen bleiben unverändert;
 * der Monatslauf übernimmt die Preise ab dem Monat. Liefert { recurring, contracts, run, count }.
 */
export function applyKvRun(doc = {}, plan, ids, { runId, at, by = '', newId, label = '' } = {}) {
  const want = new Set(ids)
  const items = []
  const steps = new Map()
  for (const row of plan.rows) {
    if (!want.has(row.contract.id)) continue
    for (const x of row.recs) {
      if (x.blocked) continue
      const note = `Preisanpassung nach Lohnkostenklausel: KV-Erhöhung ${pct(plan.percent)} × Lohnanteil ${pct(row.share)} = +${pct(row.change)} ab ${monthLabel(plan.fromMonth)}.`
      const step = { id: newId(), kind: 'kv', from: plan.from, fromMonth: plan.fromMonth, percent: plan.percent, share: row.share, change: row.change, factor: row.factor, lines: x.lines, note, runId, at, by }
      steps.set(x.rec.id, [...(steps.get(x.rec.id) || []), step])
      items.push({ contractId: row.contract.id, customerId: row.customerId, recurringId: x.rec.id, stepId: step.id, title: x.rec.title || row.contract.title || '', interval: x.interval, oldNet: x.oldNet, newNet: x.newNet, change: row.change, share: row.share, effective: x.effective })
    }
  }
  const recurring = (doc.recurring || []).map((r) => (steps.has(r.id) ? { ...r, steps: [...(r.steps || []), ...steps.get(r.id)] } : r))
  const touched = new Set(items.map((i) => i.contractId))
  const contracts = (doc.contracts || []).map((c) => (touched.has(c.id) ? { ...c, history: [...(c.history || []), { at, by, text: `Preisanpassung KV-Lohn +${pct(items.find((i) => i.contractId === c.id).change)} ab ${monthLabel(plan.fromMonth)} geplant` }] } : c))
  const run = { id: runId, kind: 'kv', percent: plan.percent, from: plan.from, fromMonth: plan.fromMonth, label: label || `KV-Erhöhung ${pct(plan.percent)} ab ${deDate(plan.from)}`, at, by, items }
  return { recurring, contracts, run, count: items.length }
}

/** Lauf zurücknehmen: noch nicht im Monatslauf übernommene Preisstufen des Laufs entfernen. { recurring, removed, kept } */
export function undoKvRun(doc = {}, runId) {
  let removed = 0
  let kept = 0
  const recurring = (doc.recurring || []).map((r) => {
    const mine = (r.steps || []).filter((st) => st.runId === runId)
    if (!mine.length) return r
    kept += mine.filter((st) => st.applied).length
    removed += mine.filter((st) => !st.applied).length
    return { ...r, steps: r.steps.filter((st) => st.runId !== runId || st.applied) }
  })
  return { recurring, removed, kept }
}

const pct = (n) => `${String(round2(n)).replace('.', ',')} %`
const eur = (n) => Number(n || 0).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })

/** Musterschreiben (Serienbrief) zur Preisanpassung: Betreff und Text mit Platzhaltern je Kunde (letterValues). */
export const KV_LETTER = {
  subject: 'Preisanpassung ab {Gültig ab}',
  text: '{Anrede},\n\nmit {Gültig ab} steigen die Löhne laut Kollektivvertrag für die Denkmal-, Fassaden- und Gebäudereinigung um {KV-Erhöhung}. Nach der Lohnkostenklausel unseres Vertrags ({Vertrag}) passen wir den Preis im Ausmaß des Lohnanteils von {Lohnanteil} an, das sind {Erhöhung}.\n\nAb {Gültig ab} gelten diese Preise (netto, zuzüglich Umsatzsteuer):\n{Preise}\n\nRechnungen für frühere Zeiträume bleiben unverändert. Für Fragen sind wir gerne für Sie da.\n\nMit freundlichen Grüßen\n\n{Benutzer}\n{Firma}',
}
/** Platzhalter des Musterschreibens (zusätzlich zu denen der Briefe). */
export const KV_PLACEHOLDERS = [
  ['Gültig ab', 'Datum der Preisanpassung'],
  ['KV-Erhöhung', 'Erhöhung der KV-Löhne in %'],
  ['Lohnanteil', 'Lohnanteil am Preis laut Vertrag'],
  ['Erhöhung', 'Preisänderung in %'],
  ['Preise', 'je Leistung alter und neuer Preis'],
  ['Vertrag', 'Vertragsbezeichnung bzw. -nummer'],
]

/** Werte der Platzhalter je Kunde für das Musterschreiben: { [customerId]: { 'Gültig ab', 'KV-Erhöhung', … } }. */
export function letterValues(run, contracts = []) {
  const byId = new Map(contracts.map((c) => [c.id, c]))
  const out = {}
  for (const it of run?.items || []) {
    const v = (out[it.customerId] ||= { items: [], shares: new Set(), changes: new Set(), contracts: new Set() })
    v.items.push(it)
    v.shares.add(pct(it.share))
    v.changes.add(`+${pct(it.change)}`)
    const c = byId.get(it.contractId)
    v.contracts.add([c?.title, c?.no].filter(Boolean).join(', ') || 'Reinigungsvertrag')
  }
  return Object.fromEntries(
    Object.entries(out).map(([id, v]) => [
      id,
      {
        'Gültig ab': deDate(run.from),
        'KV-Erhöhung': pct(run.percent),
        Lohnanteil: [...v.shares].join(' bzw. '),
        'Erhöhung': [...v.changes].join(' bzw. '),
        Vertrag: [...v.contracts].join('; '),
        Preise: v.items.map((it) => `– ${it.title}: bisher ${eur(it.oldNet)}, neu ${eur(it.newNet)} ${it.interval === 'monatlich' ? 'je Monat' : `(${it.interval})`}`).join('\n'),
      },
    ]),
  )
}
