// Paket für die Steuerberatung (Kürzel stb-): ein Zeitraum (Monat, Quartal, Jahr) als ZIP-Datei mit den Buchungszeilen
// (Ausgangsrechnungen, Eingangsrechnungen, Kassenbuch wie die einzelnen CSV-Exporte), den Belegen, Zahlungen, offenen
// Posten und der Umsatzsteuer-Übersicht. Vorher eine Prüfliste (Entwürfe, fehlende Belege, Kassenbuch nicht
// abgeschlossen …), danach ein Übergabe-Vermerk mit Fingerabdruck je Beleg: Was sich nach der Übergabe im Zeitraum
// ändert (neu, geändert, entfallen), meldet „Zu erledigen“ als Nachreichung.
// Rein und getestet (test/steuerberatung.test.js); Oberfläche: ui/views/steuerberatung.js.
//
// Übergaben stehen in der Fakturierung: settings.stb { email, remindDay, handovers: [{ id, from, to, label, at, by,
// parts, files, sums: { ar, er, ka }, prints: { 'ar|RE-2026-0001': 'hash', … }, partial }] }.

import { cashExportRows, cashSettings, lockedUntil } from './cashbook.js'
import { MONTH_LONG } from './dates.js'
import { exportRows, fnv1a, isCancelled, openItems, round2 } from './invoicing.js'
import { invoiceProblems, needsApproval, payables, purchaseExportRows, purchaseSettings } from './purchase.js'

export const STB_PARTS = {
  ar: { label: 'Ausgangsrechnungen mit PDF', module: 'fakturierung' },
  er: { label: 'Eingangsrechnungen mit Belegen', module: 'einkauf' },
  ka: { label: 'Kassenbuch', module: 'einkauf' },
  zahlungen: { label: 'Zahlungen im Zeitraum', module: '*' },
  op: { label: 'Offene Posten zum Ende des Zeitraums', module: '*' },
  uva: { label: 'Umsatzsteuer-Übersicht (PDF)', module: '*' },
}
export const STB_REMIND_DAY = 10
const MAX_HANDOVERS = 60

const pad = (n) => String(n).padStart(2, '0')
const lastDay = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`
}
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}
const de = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '')

/** Zeitraum aus einer Kennung: 2026-10 (Monat), 2026-Q4 (Quartal), 2026 (Jahr). */
export function stbPeriod(id) {
  const v = String(id || '')
  let m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(v)
  if (m) return { id: v, kind: 'monat', from: `${v}-01`, to: lastDay(v), label: `${MONTH_LONG[Number(m[2]) - 1]} ${m[1]}` }
  m = /^(\d{4})-Q([1-4])$/.exec(v)
  if (m) {
    const q = Number(m[2])
    return { id: v, kind: 'quartal', from: `${m[1]}-${pad(q * 3 - 2)}-01`, to: lastDay(`${m[1]}-${pad(q * 3)}`), label: `${q}. Quartal ${m[1]}` }
  }
  m = /^(\d{4})$/.exec(v)
  if (m) return { id: v, kind: 'jahr', from: `${v}-01-01`, to: `${v}-12-31`, label: `Jahr ${v}` }
  return null
}

/** Auswahl: die letzten 13 Monate, 5 Quartale, 2 Jahre (vom Vormonat aus; der laufende Monat steht zuerst). */
export function stbChoices(today) {
  const ym = today.slice(0, 7)
  const months = Array.from({ length: 14 }, (_, i) => stbPeriod(shiftMonth(ym, -i)))
  const q = (y, n) => `${y}-Q${n}`
  const cy = Number(today.slice(0, 4))
  const cq = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1
  const quarters = Array.from({ length: 6 }, (_, i) => {
    const k = cq - i
    const y = cy + Math.floor((k - 1) / 4)
    return stbPeriod(q(y, ((((k - 1) % 4) + 4) % 4) + 1))
  })
  const years = [cy, cy - 1, cy - 2].map((y) => stbPeriod(String(y)))
  return { months, quarters, years, standard: months[1].id }
}

// ---------------------------------------------------------------- Buchungszeilen und Fingerabdruck

/** Buchungszeilen des Zeitraums je Teil (nur die Teile, die übergeben werden). */
export function stbRows({ fak = null, einkauf = null, kasse = null, objectsById = new Map() } = {}, { from, to }) {
  const out = { ar: [], er: [], ka: [] }
  if (fak) out.ar = exportRows(fak.documents || [], { from, to, settings: fak.settings, customersById: new Map((fak.customers || []).map((c) => [c.id, c])) })
  if (einkauf) out.er = purchaseExportRows(einkauf, { from, to, objectsById })
  if (kasse) out.ka = cashExportRows(kasse, { from, to })
  return out
}

/** Summen je Teil (netto, Steuer, brutto, Zeilen). */
export function stbSums(rows) {
  const sum = (list) => ({ count: list.length, net: round2(list.reduce((s, r) => s + (Number(r.net) || 0), 0)), vat: round2(list.reduce((s, r) => s + (Number(r.vat) || 0), 0)), gross: round2(list.reduce((s, r) => s + (Number(r.gross) || 0), 0)) })
  return { ar: sum(rows.ar || []), er: sum(rows.er || []), ka: sum(rows.ka || []) }
}

/** Fingerabdruck je Beleg: { 'ar|RE-2026-0001': hash } über alle Buchungszeilen des Belegs im Zeitraum. */
export function stbPrints(rows) {
  const out = {}
  for (const part of ['ar', 'er', 'ka']) {
    const by = new Map()
    for (const r of rows[part] || []) {
      const key = `${part}|${r.number}`
      if (!by.has(key)) by.set(key, [])
      by.get(key).push([r.date, r.kindLabel, r.rate, r.net, r.vat, r.gross, r.account, r.code, r.debitor || r.creditor || r.cashAccount || '', r.text])
    }
    for (const [key, list] of by) out[key] = fnv1a(JSON.stringify(list))
  }
  return out
}

const PART_NAME = { ar: 'Ausgangsrechnung', er: 'Eingangsrechnung', ka: 'Kassenbuch' }
/**
 * Änderungen seit einer Übergabe (nur die übergebenen Teile): { added, changed, removed, count, lines } – lines als
 * lesbare Zeilen („Ausgangsrechnung RE-2026-0012: neu“).
 */
export function stbChanges(handover, prints) {
  const parts = new Set((handover.parts || ['ar', 'er', 'ka']).filter((p) => ['ar', 'er', 'ka'].includes(p)))
  const old = handover.prints || {}
  const inParts = (k) => parts.has(k.split('|')[0])
  const added = Object.keys(prints).filter((k) => inParts(k) && !(k in old))
  const changed = Object.keys(prints).filter((k) => inParts(k) && k in old && old[k] !== prints[k])
  const removed = Object.keys(old).filter((k) => inParts(k) && !(k in prints))
  const text = (k, what) => `${PART_NAME[k.split('|')[0]]} ${k.slice(k.indexOf('|') + 1)}: ${what}`
  const lines = [...added.map((k) => text(k, 'neu')), ...changed.map((k) => text(k, 'geändert')), ...removed.map((k) => text(k, 'entfallen'))]
  return { added, changed, removed, count: lines.length, lines, sig: fnv1a(lines.join('\n')) }
}

// ---------------------------------------------------------------- Prüfliste

/**
 * Was vor der Übergabe erledigt sein sollte: [{ id, level: 'warn' | 'info', text, lines }]. Nichts davon sperrt das
 * Paket – die Person entscheidet.
 */
export function stbChecks({ fak = null, einkauf = null, kasse = null, bank = null } = {}, { from, to }) {
  const out = []
  const list = (arr, fn, max = 8) => [...arr.slice(0, max).map(fn), ...(arr.length > max ? [`… und ${arr.length - max} weitere`] : [])]
  if (fak) {
    const docs = fak.documents || []
    const drafts = docs.filter((d) => ['rechnung', 'storno', 'korrektur'].includes(d.kind) && !d.number && d.date >= from && d.date <= to)
    if (drafts.length) out.push({ id: 'ar-entwurf', level: 'warn', text: `${drafts.length} ${drafts.length === 1 ? 'Rechnungsentwurf' : 'Rechnungsentwürfe'} mit Datum im Zeitraum noch nicht festgeschrieben`, lines: list(drafts, (d) => `${de(d.date)} ${d.recipient?.name || ''}`.trim()) })
    const noPdf = docs.filter((d) => ['rechnung', 'storno', 'korrektur'].includes(d.kind) && d.number && d.date >= from && d.date <= to && !d.archive?.path)
    if (noPdf.length) out.push({ id: 'ar-pdf', level: 'info', text: `${noPdf.length} ${noPdf.length === 1 ? 'Rechnung' : 'Rechnungen'} ohne abgelegtes PDF: das Paket erstellt das PDF neu`, lines: list(noPdf, (d) => d.number) })
    const lsOpen = docs.filter((d) => d.kind === 'lieferschein' && d.number && d.date >= from && d.date <= to && !d.billedBy && !d.noBill)
    if (lsOpen.length && lsOpen.length <= docs.length) {
      const billedIds = new Set(docs.filter((x) => x.kind === 'rechnung' && x.number && !isCancelled(x, docs)).flatMap((x) => [x.refId, ...(x.deliveryNotes || []).map((n) => n.id)]))
      const really = lsOpen.filter((d) => !billedIds.has(d.id))
      if (really.length) out.push({ id: 'ls-offen', level: 'info', text: `${really.length} ${really.length === 1 ? 'Lieferschein' : 'Lieferscheine'} im Zeitraum noch nicht verrechnet`, lines: list(really, (d) => `${d.number} ${d.recipient?.name || ''}`.trim()) })
    }
  }
  if (einkauf) {
    const s = purchaseSettings(einkauf)
    const invs = (einkauf.invoices || []).filter((i) => !i.cancelled && i.date >= from && i.date <= to)
    const noBeleg = invs.filter((i) => !i.beleg)
    if (noBeleg.length) out.push({ id: 'er-beleg', level: 'warn', text: `${noBeleg.length} ${noBeleg.length === 1 ? 'Eingangsrechnung' : 'Eingangsrechnungen'} ohne Beleg`, lines: list(noBeleg, (i) => `${i.no || ''} ${i.supplier?.name || ''} ${i.number || ''}`.trim()) })
    const vst = invs.filter((i) => invoiceProblems(i, { suppliers: einkauf.suppliers || [], invoices: einkauf.invoices || [] }).some((p) => String(p.code).startsWith('vst')))
    if (vst.length) out.push({ id: 'er-vst', level: 'warn', text: `${vst.length} ${vst.length === 1 ? 'Eingangsrechnung erfüllt' : 'Eingangsrechnungen erfüllen'} die Rechnungsmerkmale für den Vorsteuerabzug nicht (§ 11 UStG)`, lines: list(vst, (i) => `${i.no || ''} ${i.supplier?.name || ''}`.trim()) })
    const appr = invs.filter((i) => needsApproval(i, s))
    if (appr.length) out.push({ id: 'er-freigabe', level: 'info', text: `${appr.length} ${appr.length === 1 ? 'Eingangsrechnung wartet' : 'Eingangsrechnungen warten'} auf die Freigabe`, lines: list(appr, (i) => `${i.no || ''} ${i.supplier?.name || ''}`.trim()) })
  }
  if (kasse && (kasse.entries || []).some((e) => e.date >= from && e.date <= to)) {
    const locked = lockedUntil(kasse)
    const months = []
    for (let ym = from.slice(0, 7); ym <= to.slice(0, 7); ym = shiftMonth(ym, 1)) if ((kasse.entries || []).some((e) => e.date.startsWith(ym))) months.push(ym)
    const open = months.filter((ym) => !locked || ym > locked)
    if (open.length) out.push({ id: 'ka-abschluss', level: 'warn', text: `Kassenbuch: ${open.map((ym) => `${MONTH_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`).join(', ')} noch nicht abgeschlossen`, lines: [] })
    void cashSettings
  }
  if (bank?.tx?.length) {
    const tx = bank.tx.filter((t) => t.date >= from && t.date <= to && t.status === 'offen')
    if (tx.length) out.push({ id: 'bank-offen', level: 'info', text: `${tx.length} ${tx.length === 1 ? 'Bankumsatz' : 'Bankumsätze'} im Zeitraum noch nicht zugeordnet`, lines: list(tx, (t) => `${de(t.date)} ${Number(t.amount).toFixed(2).replace('.', ',')} € ${t.name || t.text || ''}`.trim()) })
  }
  return out
}

// ---------------------------------------------------------------- Zahlungen und offene Posten

/** Zahlungen im Zeitraum: Eingänge auf Ausgangsrechnungen, Ausgänge auf Eingangsrechnungen (Skonto als eigene Art). */
export function stbPayments({ fak = null, einkauf = null } = {}, { from, to }) {
  const rows = []
  for (const d of fak?.documents || []) {
    if (d.kind !== 'rechnung' || !d.number) continue
    for (const p of d.payments || []) if (p.date >= from && p.date <= to) rows.push({ date: p.date, dir: 'Eingang', kind: p.kind === 'skonto' ? 'Skonto' : p.kind === 'ruecklastschrift' ? 'Rücklastschrift' : 'Zahlung', number: d.number, partner: d.recipient?.name || '', amount: round2(Number(p.amount) || 0), note: p.note || '' })
  }
  for (const inv of einkauf?.invoices || []) {
    if (inv.cancelled) continue
    for (const p of inv.payments || []) if (p.date >= from && p.date <= to) rows.push({ date: p.date, dir: 'Ausgang', kind: p.kind === 'skonto' ? 'Skonto' : 'Zahlung', number: inv.no || inv.number || '', partner: inv.supplier?.name || '', amount: round2(Number(p.amount) || 0), note: p.note || p.text || '' })
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.dir.localeCompare(b.dir) || String(a.number).localeCompare(String(b.number)))
}

/** Offene Forderungen und Verbindlichkeiten zum Stichtag (Ende des Zeitraums; Belege bis dahin). */
export function stbOpenItems({ fak = null, einkauf = null } = {}, { to }) {
  const rows = []
  if (fak) {
    // Zahlungen nach dem Stichtag zählen nicht: Stand am Stichtag
    const docs = (fak.documents || []).filter((d) => !d.date || d.date <= to).map((d) => ({ ...d, payments: (d.payments || []).filter((p) => !p.date || p.date <= to) }))
    for (const x of openItems(docs, to, fak.settings)) rows.push({ side: 'Forderung', number: x.doc.number, date: x.doc.date, due: x.doc.dueDate || '', partner: x.doc.recipient?.name || '', open: round2(x.open), overdueDays: x.overdueDays })
  }
  if (einkauf) {
    const invs = (einkauf.invoices || []).filter((i) => !i.date || i.date <= to).map((i) => ({ ...i, payments: (i.payments || []).filter((p) => !p.date || p.date <= to) }))
    for (const x of payables(invs, to)) rows.push({ side: 'Verbindlichkeit', number: x.inv.no || x.inv.number || '', date: x.inv.date, due: x.inv.dueDate || '', partner: x.inv.supplier?.name || '', open: round2(x.open), overdueDays: x.overdueDays })
  }
  return rows
}

/** CSV wie die anderen Exporte: Semikolon, Dezimalbeistrich, Datum TT.MM.JJJJ, CRLF. cols: [[Titel, (r) → Wert, 'num' | 'date' | '']] */
export function stbCsv(rows, cols) {
  const cell = (v) => {
    const t = String(v ?? '')
    return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const fmt = (v, kind) => (kind === 'num' ? (Number.isFinite(Number(v)) ? Number(v).toFixed(2).replace('.', ',') : '') : kind === 'date' ? de(v) : v)
  return `${[cols.map((c) => cell(c[0])).join(';'), ...rows.map((r) => cols.map(([, get, kind]) => cell(fmt(get(r), kind))).join(';'))].join('\r\n')}\r\n`
}
export const PAYMENT_COLS = [
  ['Datum', (r) => r.date, 'date'],
  ['Richtung', (r) => r.dir],
  ['Art', (r) => r.kind],
  ['Belegnummer', (r) => r.number],
  ['Kunde bzw. Lieferant', (r) => r.partner],
  ['Betrag', (r) => r.amount, 'num'],
  ['Notiz', (r) => r.note],
]
export const OPEN_COLS = [
  ['Art', (r) => r.side],
  ['Belegnummer', (r) => r.number],
  ['Belegdatum', (r) => r.date, 'date'],
  ['Fällig', (r) => r.due, 'date'],
  ['Kunde bzw. Lieferant', (r) => r.partner],
  ['Offen', (r) => r.open, 'num'],
  ['Tage überfällig', (r) => r.overdueDays || ''],
]

// ---------------------------------------------------------------- Inhalt, Übergabe, Erinnerung

export const stbZipName = (period, company = '') => `Steuerberatung_${period.id}${company ? `_${String(company).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)}` : ''}${''}.zip`

/** Inhalt.txt: Zeitraum, wer, wann, Summen, Prüfliste, Dateien mit SHA-256. */
export function stbInhalt({ period, company = '', by = '', at = '', sums, checks = [], files = [], partial = null }) {
  const eur = (n) => {
    const [i, d] = Math.abs(Number(n) || 0).toFixed(2).split('.')
    return `${Number(n) < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d} €`
  }
  const lines = [
    `Paket für die Steuerberatung${company ? ` – ${company}` : ''}`,
    `Zeitraum: ${period.label} (${de(period.from)}–${de(period.to)})`,
    `Erstellt: ${at ? new Date(at).toLocaleString('de-AT', { timeZone: 'Europe/Vienna' }) : ''}${by ? ` von ${by}` : ''}`,
    ...(partial ? ['', `Nachreichung zur Übergabe vom ${new Date(partial.at).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}: nur neue und geänderte Belege.`, ...partial.lines.map((l) => `  ${l}`)] : []),
    '',
    'Summen der Buchungszeilen (netto / Steuer / brutto, Zeilen):',
    sums?.ar?.count ? `  Ausgangsrechnungen: ${eur(sums.ar.net)} / ${eur(sums.ar.vat)} / ${eur(sums.ar.gross)}, ${sums.ar.count} Zeilen` : '',
    sums?.er?.count ? `  Eingangsrechnungen: ${eur(sums.er.net)} / ${eur(sums.er.vat)} / ${eur(sums.er.gross)}, ${sums.er.count} Zeilen` : '',
    sums?.ka?.count ? `  Kassenbuch: ${eur(sums.ka.net)} / ${eur(sums.ka.vat)} / ${eur(sums.ka.gross)}, ${sums.ka.count} Zeilen` : '',
    '',
    checks.length ? 'Hinweise aus der Prüfung vor der Übergabe:' : 'Prüfung vor der Übergabe: keine offenen Punkte.',
    ...checks.map((c) => `  - ${c.text}`),
    '',
    'CSV-Dateien: Semikolon, Dezimalbeistrich, Datum TT.MM.JJJJ, UTF-8. Kontonummern laut den Einstellungen der App (mit der Steuerberatung abgestimmt).',
    '',
    'Dateien (SHA-256):',
    ...files.map((f) => `  ${f.sha}  ${f.path}`),
  ]
  return `${lines.filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\r\n')}\r\n`
}

/** Übergabe vermerken (höchstens 60, älteste zuerst weg); liefert den Eintrag. */
export function stbRecord(settings, entry) {
  const stb = (settings.stb ||= {})
  stb.handovers = [...(stb.handovers || []), entry].slice(-MAX_HANDOVERS)
  return entry
}

/** Letzte Übergabe, die den Zeitraum ganz abdeckt (nicht die Nachreichungen allein). */
export const stbLastHandover = (settings, period) =>
  [...(settings?.stb?.handovers || [])].filter((h) => h.from === period.from && h.to === period.to).sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1) || null

/** Fingerabdruck nach einer Nachreichung: die alte Übergabe plus die nachgereichten Belege (entfallene weg). */
export function stbMergePrints(base, prints, changes) {
  const out = { ...(base || {}) }
  for (const k of [...changes.added, ...changes.changed]) out[k] = prints[k]
  for (const k of changes.removed) delete out[k]
  return out
}

/**
 * Erinnerung: ab Tag remindDay des Folgemonats, wenn der Vormonat noch nicht übergeben ist (auch nicht als Teil eines
 * Quartals oder Jahres). Nur, wenn schon einmal übergeben wurde (wer das Paket nicht nutzt, bekommt nichts).
 */
export function stbReminder(settings, today) {
  const stb = settings?.stb || {}
  const list = stb.handovers || []
  if (!list.length || stb.remindDay === 0) return null
  const day = Number(stb.remindDay) || STB_REMIND_DAY
  if (Number(today.slice(8, 10)) < day) return null
  const prev = stbPeriod(shiftMonth(today.slice(0, 7), -1))
  if (list.some((h) => h.from <= prev.from && h.to >= prev.to)) return null
  // nur Quartalszahler: Erinnerung erst nach dem Quartal
  const quarterly = list.every((h) => stbPeriod(h.id || '')?.kind === 'quartal' || (h.from.slice(5, 7) !== h.to.slice(5, 7) && h.from.slice(0, 4) === h.to.slice(0, 4)))
  if (quarterly && !['03', '06', '09', '12'].includes(prev.id.slice(5, 7))) return null
  return quarterly ? stbPeriod(`${prev.id.slice(0, 4)}-Q${Math.floor((Number(prev.id.slice(5, 7)) - 1) / 3) + 1}`) : prev
}
