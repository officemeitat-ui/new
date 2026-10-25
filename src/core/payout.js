// Auszahlungen eines Monats versenden: wer bekommt wie viel (gesammelt an die
// Lohnverrechnung) und je Person die eigene Aufstellung. Grundlage ist die
// Monatsabrechnung aus overtime.js; nach dem Monatsabschluss gelten die
// festgehaltenen Beträge.

import { formatDate, formatHours, MONTH_LONG } from './dates.js'
import { fileSafe } from './filename.js'
import { UE_MODES } from './overtime.js'

export const euroText = (v) => `${(v || 0).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const signedH = (min) => `${min > 0 ? '+' : min < 0 ? '−' : '±'}${formatHours(Math.abs(min))} h`
export const monthName = (month) => `${MONTH_LONG[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`

/**
 * Eine Zeile je Person mit etwas zum Auszahlen oder Buchen. `rows` = payMonth(...)
 * je Person, `closure` = data.payroll[monat] (nach dem Abschluss gelten dessen Beträge).
 */
export function payoutEntries(rows, closure = null) {
  const fixed = closure?.closedAt ? closure.rows || {} : null
  return rows
    .map((r) => {
      const stored = fixed?.[r.employee.id]
      const src = stored || r
      return {
        employee: r.employee,
        fixed: !!stored,
        wage: src.wage,
        amount: src.amount,
        taxFree: src.taxFree,
        accountDelta: src.accountDelta,
        zaBonus: src.zaBonus,
        ueMode: src.ueMode,
        lines: src.lines,
        ueHours: r.total.ue + r.total.ue11,
        mehrHours: r.total.mehr,
        mehrOpen: r.mehr.open,
        mehrOpenMin: r.mehr.openMin,
      }
    })
    .filter((e) => (fixed ? fixed[e.employee.id] : true) && (e.amount || e.accountDelta || e.zaBonus))
    .sort((a, b) => b.amount - a.amount || a.employee.name.localeCompare(b.employee.name))
}

/** Kennung des Inhalts: ändert sich, wenn sich Beträge oder Buchungen ändern („geändert seit Versand“). */
export function payoutSig(entries) {
  return (Array.isArray(entries) ? entries : [entries]).map((e) => `${e.employee.id}:${e.amount.toFixed(2)}:${e.accountDelta}:${e.lines.map((l) => l.amount.toFixed(2)).join('/')}`).join('|')
}

const lineText = (l) => `${formatHours(l.min)} h ${l.label}: ${euroText(l.amount)}`

/** Text der Sammel-E-Mail an die Lohnverrechnung: wer bekommt wie viel. */
export function payoutListText(entries, { month, status = '', sender = '', brand = '' } = {}) {
  const total = entries.reduce((s, e) => s + e.amount, 0)
  const paid = entries.filter((e) => e.amount)
  const timeOnly = entries.filter((e) => !e.amount)
  const who = (e) => `${e.employee.personnelNo ? `${e.employee.personnelNo} ` : ''}${e.employee.name}`
  return [
    'Hallo,',
    '',
    `anbei die Auszahlungen für Überstunden und Mehrarbeit im ${monthName(month)}${status ? ` (${status})` : ''}. Alle Beträge brutto.`,
    '',
    ...(paid.length ? paid.map((e) => `${who(e)}: ${euroText(e.amount)}  (${e.lines.map((l) => `${formatHours(l.min)} h ${l.label}`).join(', ')})`) : ['Diesen Monat gibt es keine Auszahlungen.']),
    '',
    `Summe: ${euroText(total)} brutto für ${paid.length} ${paid.length === 1 ? 'Person' : 'Personen'}.`,
    ...(timeOnly.length ? ['', 'Nur Zeitausgleich (keine Auszahlung):', ...timeOnly.map((e) => `${who(e)}: Zeitkonto ${signedH(e.accountDelta)}`)] : []),
    '',
    'Im Anhang die Übersicht mit Einzelaufstellung (PDF) und die Daten für den Import (CSV).',
    '',
    'Liebe Grüße',
    sender,
    brand,
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n')
    .trim()
}

/** Text der E-Mail an eine Person: ihre Auszahlung bzw. Zeitausgleich. */
export function payoutPersonText(entry, { month, sender = '', brand = '' } = {}) {
  const first = entry.employee.name.split(' ')[0]
  const out = [`Hallo ${first},`, '']
  if (entry.amount) {
    out.push(`mit der Abrechnung für ${monthName(month)} bekommst du für Überstunden und Mehrarbeit ${euroText(entry.amount)} brutto ausbezahlt:`, ...entry.lines.map((l) => `- ${lineText(l)}`), '')
  }
  if (entry.zaBonus) out.push(`Als Zeitausgleich (${UE_MODES[entry.ueMode]}) bekommst du ${formatHours(entry.zaBonus)} h Zuschlag ins Zeitkonto.`, '')
  if (entry.accountDelta) out.push(`Dein Zeitkonto ändert sich dadurch um ${signedH(entry.accountDelta)}${entry.amount && entry.accountDelta < 0 ? ' (ausbezahlte Stunden)' : ''}.`)
  if (entry.mehrOpenMin) out.push(`Noch offen im Zeitkonto: ${formatHours(entry.mehrOpenMin)} h Mehrarbeit, Ausgleich bis ${formatDate(entry.mehrOpen[0].deadline, { weekday: false, year: true })}.`)
  out.push('', 'Im Anhang die Aufstellung als PDF. Bei Fragen bitte melden.', '', 'Liebe Grüße', sender, brand)
  return out.join('\n').trim()
}

/** Adressen aus einem Eingabefeld (Komma, Strichpunkt oder Leerzeichen getrennt). */
export function parseRecipients(text) {
  return String(text || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
}

/** mailto-Link für das eigene E-Mail-Programm (ohne Anhang). */
export function mailtoUrl(to, subject, body) {
  const q = new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20')
  return `mailto:${parseRecipients(to).join(',')}?${q}`
}

/** Dateinamen. */
export const payoutFileBase = (month) => `Auszahlungen_${month}`
export const payoutPersonFile = (month, name) => `Auszahlung_${month}_${fileSafe(name)}.pdf`
