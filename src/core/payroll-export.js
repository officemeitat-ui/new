// Export für die Lohnverrechnung (BMD, RZL u. a.): Bewegungsdaten je Person und Lohnart als
// Textdatei (CSV). Die Lohnart-Nummern legt jede Lohnverrechnung selbst fest; das Importformat wird
// in BMD bzw. RZL passend zu dieser Datei angelegt (Spaltenreihenfolge, Trennzeichen, Dezimalzeichen).
// Deshalb ist hier alles einstellbar; Vorgabe: Personalnummer;Lohnart;Menge;Satz;Von;Bis;Text.
//
// Quellen der Werte: Überstunden & Auszahlung (payMonth: Normalstunden, Mehrarbeit, Überstunden je
// Tageszeit, Zuschlagsstunden) und die Monatsauswertung (monthReport: Urlaub, Krankenstand, Feiertag,
// Fahrzeit). Mengen in Stunden (2 Nachkommastellen) bzw. Tagen.

import { lastOfMonth } from './dates.js'

const h = (min) => Math.round(((min || 0) / 60) * 100) / 100
const sumOf = (r, type, classes) => classes.reduce((s, c) => s + (r.hours?.[type]?.[c] || 0), 0)
const ALL = ['tag', 'nacht', 'sonntag', 'sonntagnacht', 'feiertag']
const paid = (r) => (r.ueMode || 'auszahlen') === 'auszahlen'

/** Kennzahlen: [Schlüssel, Bezeichnung, Einheit, Wert(otRow, reportRow)]. */
export const WAGE_KEYS = [
  ['normal', 'Normalstunden', 'h', (r) => h(r.total?.normal)],
  ['mehr', 'Mehrarbeit ausbezahlt (Zuschlag 25 %)', 'h', (r) => h(r.mehr?.paid)],
  // Überstunden nur, wenn sie ausbezahlt werden; bei Zeitausgleich 1:1,5 gehen sie ins Zeitkonto
  ['ue.tag', 'Überstunden Tag (50 %)', 'h', (r) => paid(r) && h(r.hours?.ue?.tag)],
  ['ue.nacht', 'Überstunden Nacht (100 %)', 'h', (r) => paid(r) && h(r.hours?.ue?.nacht)],
  ['ue.sonntag', 'Überstunden Sonntag', 'h', (r) => paid(r) && h(r.hours?.ue?.sonntag)],
  ['ue.sonntagnacht', 'Überstunden Sonntag Nacht', 'h', (r) => paid(r) && h(r.hours?.ue?.sonntagnacht)],
  ['ue.feiertag', 'Überstunden Feiertag', 'h', (r) => paid(r) && h(r.hours?.ue?.feiertag)],
  ['ue11', 'Überstunden 11./12. Stunde', 'h', (r) => paid(r) && h(sumOf(r, 'ue11', ALL))],
  // „Zeitausgleich 1:1 + Zuschlag in Geld“: nur der Zuschlag wird ausbezahlt
  ['ueZuschlag', 'Überstunden: nur Zuschlag (Grundstunde als Zeitausgleich)', 'h', (r) => (r.ueMode === 'mix' ? h(sumOf(r, 'ue', ALL) + sumOf(r, 'ue11', ALL)) : 0)],
  ['nacht', 'Nachtzuschlag (Stunden, normal und Mehrarbeit)', 'h', (r) => h(sumOf(r, 'normal', ['nacht']) + sumOf(r, 'mehr', ['nacht']))],
  ['sonntag', 'Sonntagszuschlag (Stunden, normal und Mehrarbeit)', 'h', (r) => h(sumOf(r, 'normal', ['sonntag', 'sonntagnacht']) + sumOf(r, 'mehr', ['sonntag', 'sonntagnacht']))],
  ['feiertagsarbeit', 'Feiertagsarbeit (Stunden, normal und Mehrarbeit)', 'h', (r) => h(sumOf(r, 'normal', ['feiertag']) + sumOf(r, 'mehr', ['feiertag']))],
  ['feiertag', 'Feiertag angerechnet (Feiertagsentgelt)', 'h', (r, m) => h(m?.holidayCredit)],
  ['urlaubTage', 'Urlaub (Arbeitstage)', 'Tage', (r, m) => m?.vacationDays || 0],
  ['urlaub', 'Urlaub angerechnet', 'h', (r, m) => h(m?.vacationCredit)],
  ['krankTage', 'Krankenstand (Arbeitstage)', 'Tage', (r, m) => m?.sickDays || 0],
  ['krank', 'Krankenstand angerechnet', 'h', (r, m) => h(m?.sickCredit)],
  ['fahrzeit', 'Fahrzeit', 'h', (r, m) => h(m?.travel)],
]

export const COLUMNS = {
  pnr: ['Personalnummer', (l) => l.pnr],
  name: ['Name', (l) => l.name],
  lohnart: ['Lohnart', (l) => l.lohnart],
  menge: ['Menge', (l, f) => f.num(l.menge)],
  einheit: ['Einheit', (l) => l.einheit],
  satz: ['Satz', (l, f) => (l.satz ? f.num(l.satz) : '')],
  betrag: ['Betrag', (l, f) => (l.satz ? f.num(Math.round(l.menge * l.satz * 100) / 100) : '')],
  von: ['Von', (l, f) => f.date(l.von)],
  bis: ['Bis', (l, f) => f.date(l.bis)],
  monat: ['Monat', (l, f) => f.month(l.von)],
  text: ['Text', (l) => l.text],
}

export const EXPORT_DEFAULTS = { wageTypes: {}, columns: ['pnr', 'lohnart', 'menge', 'satz', 'von', 'bis', 'text'], header: true, sep: ';', decimal: ',', dateFormat: 'dd.mm.yyyy', rateOn: true }

/**
 * Zeilen für den Monat: je Person und Kennzahl mit Lohnart und Menge ≠ 0.
 * otRows: Zeilen aus Überstunden & Auszahlung, report: Monatsauswertung (je Person).
 */
export function exportLines({ month, otRows, report = [], settings }) {
  const s = { ...EXPORT_DEFAULTS, ...settings }
  const byEmp = new Map(report.map((m) => [m.employee.id, m]))
  const von = `${month}-01`
  const bis = lastOfMonth(von)
  const lines = []
  for (const r of otRows) {
    const m = byEmp.get(r.employee.id)
    for (const [key, label, einheit, value] of WAGE_KEYS) {
      const lohnart = String(s.wageTypes?.[key] || '').trim()
      const menge = value(r, m)
      if (!lohnart || !menge) continue
      lines.push({ pnr: r.employee.personnelNo || '', name: r.employee.name, empId: r.employee.id, key, lohnart, menge, einheit, satz: s.rateOn && einheit === 'h' && r.wage > 0 ? Math.round(r.wage * 100) / 100 : 0, von, bis, text: label })
    }
  }
  return lines
}

/** Summen je Kennzahl im Monat (auch ohne Lohnart), für die Zuordnung im Dialog. */
export function keyTotals({ otRows, report = [] }) {
  const byEmp = new Map(report.map((m) => [m.employee.id, m]))
  return Object.fromEntries(WAGE_KEYS.map(([key, , , value]) => [key, Math.round(otRows.reduce((s, r) => s + value(r, byEmp.get(r.employee.id)), 0) * 100) / 100]))
}

/** Hinweise vor dem Export: fehlende Personalnummern, Werte ohne Lohnart. */
export function exportProblems({ lines, totals, settings }) {
  const s = { ...EXPORT_DEFAULTS, ...settings }
  const out = []
  const noPnr = [...new Set(lines.filter((l) => !l.pnr).map((l) => l.name))]
  if (noPnr.length) out.push(`Ohne Personalnummer (Zeilen sind so nicht importierbar): ${noPnr.join(', ')}`)
  const unmapped = WAGE_KEYS.filter(([key]) => totals[key] && !String(s.wageTypes?.[key] || '').trim()).map(([, label, unit]) => `${label} (${String(totals[WAGE_KEYS.find((k) => k[1] === label)[0]]).replace('.', ',')} ${unit})`)
  if (unmapped.length) out.push(`Ohne Lohnart, daher nicht in der Datei: ${unmapped.join('; ')}`)
  if (!s.columns.includes('pnr') || !s.columns.includes('lohnart') || !s.columns.includes('menge')) out.push('Die Spalten Personalnummer, Lohnart und Menge sollten in der Datei sein.')
  return out
}

/** Datei als Text (UTF-8 mit BOM, Zeilenende CRLF wie unter Windows üblich). */
export function exportText(lines, settings) {
  const s = { ...EXPORT_DEFAULTS, ...settings }
  const sep = s.sep === 'tab' ? '\t' : s.sep
  const f = {
    num: (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2)).replace('.', s.decimal),
    date: (d) => (s.dateFormat === 'yyyy-mm-dd' ? d : s.dateFormat === 'mm/yyyy' ? `${d.slice(5, 7)}/${d.slice(0, 4)}` : `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`),
    month: (d) => `${d.slice(5, 7)}.${d.slice(0, 4)}`,
  }
  const cell = (v) => {
    const t = String(v ?? '')
    return t.includes(sep) || t.includes('"') || /[\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const cols = s.columns.filter((c) => COLUMNS[c])
  const rows = lines.map((l) => cols.map((c) => cell(COLUMNS[c][1](l, f))).join(sep))
  return `﻿${[...(s.header ? [cols.map((c) => cell(COLUMNS[c][0])).join(sep)] : []), ...rows].join('\r\n')}\r\n`
}

export const exportFileName = (month) => `Lohn-Bewegungsdaten_${month}.csv`
