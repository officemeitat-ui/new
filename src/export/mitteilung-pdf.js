// Nachweis einer Mitteilung an Mitarbeitende als PDF (z. B. für Unterweisungen): Titel und Text auf Deutsch, Übersetzungen,
// Zeitraum, wer veröffentlicht hat, und je Person der Stand (offen, gelesen, verstanden) mit Zeitpunkt, Weg (Mein Plan
// oder App) und Erinnerung. Rechenkern: core/mitteilungen.js (proofRows).

import { formatDate } from '../core/dates.js'
import { langInfo } from '../core/sprachen.js'
import { proofRows, progress, progressText } from '../core/mitteilungen.js'
import { docShell, header, inkColors, tableLayout } from './pdf-parts.js'

// Umlaute ausgeschrieben: manche Browser verwerfen sonst den Dateinamen beim Herunterladen („download“)
const UMLAUT = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }
const fileSafe = (s) => String(s || '').replace(/[äöüÄÖÜß]/g, (c) => UMLAUT[c]).replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
const when = (iso) => (iso ? new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
const STATE = { offen: 'offen', gelesen: 'gelesen', bestaetigt: 'verstanden' }
const WEG = { handy: 'Mein Plan', app: 'App' }

/**
 * m: Mitteilung, receipts: Rückmeldungen, employees: Stammdaten, target: Empfänger als Text (z. B. „Revier/Team:
 * Flachgau“), trainingType: Art der Unterweisung (optional), brand, logo.
 */
export function messageProofDocument({ m, receipts = {}, employees = [], target = '', trainingType = null, brand = {}, logo = null, createdAt = new Date() }) {
  const colors = inkColors(brand)
  const p = progress(m, receipts)
  const rows = proofRows(m, receipts, employees)
  const confirm = m.wichtig === 'bestaetigen'
  const row = (label, value) => (value ? { text: [{ text: `${label}: `, bold: true }, value], margin: [0, 0, 0, 2] } : '')
  const langs = Object.entries(m.uebersetzt || {})
    .filter(([, u]) => String(u?.text || '').trim())
    .map(([id, u]) => `${langInfo(id).label}${u.ki ? ' (mit KI übersetzt)' : ''}`)
  const body = rows.map((r, i) => [
    String(i + 1),
    r.name,
    r.team || '',
    langInfo(r.lang).label,
    { text: STATE[r.state], bold: r.state !== 'offen' },
    when(confirm ? r.bestaetigt || r.gelesen : r.gelesen || r.bestaetigt),
    WEG[r.weg] || '',
    r.erinnert ? when(r.erinnert) : '',
  ])
  const content = [
    ...header({ title: 'Nachweis Mitteilung', subtitle: `${m.titel} · ${formatDate(m.ab, { year: true })}`, brand, logo, colors }),
    row('Titel', m.titel),
    row('Wichtigkeit', confirm ? 'Bestätigung nötig („Verstanden“)' : 'normal („Gelesen“)'),
    row('Sichtbar', `${formatDate(m.ab, { year: true })} bis ${formatDate(m.bis, { year: true })}`),
    row('Empfänger', `${target ? `${target}, ` : ''}${p.total} ${p.total === 1 ? 'Person' : 'Personen'}`),
    row('Veröffentlicht', m.veroeffentlicht ? `${when(m.veroeffentlicht.at)}${m.veroeffentlicht.by ? ` von ${m.veroeffentlicht.by}` : ''}` : 'nicht veröffentlicht (Entwurf)'),
    m.status === 'zurueckgezogen' ? row('Zurückgezogen', m.zurueckgezogen ? `${when(m.zurueckgezogen.at)}${m.zurueckgezogen.by ? ` von ${m.zurueckgezogen.by}` : ''}` : 'ja') : '',
    row('Übersetzungen', langs.length ? langs.join(', ') : 'keine (nur Deutsch)'),
    trainingType ? row('Unterweisungsnachweis', `${trainingType.name}${trainingType.law ? ` (${trainingType.law})` : ''}: „Verstanden“ wird unter Unterweisungen & Fristen eingetragen`) : '',
    m.anhang ? row('Anhang', m.anhang.name) : '',
    { text: 'Text (Deutsch)', style: 'section' },
    { table: { widths: ['*'], body: [[{ text: m.text, margin: [4, 4, 4, 4] }]] }, layout: tableLayout(colors), margin: [0, 0, 0, 8] },
    { text: `Stand: ${progressText(m, p)}${confirm && p.gelesen > p.bestaetigt ? ` (dazu ${p.gelesen - p.bestaetigt} gelesen, noch nicht verstanden)` : ''} · Abruf ${when(createdAt.toISOString())}`, style: 'section' },
    {
      table: { headerRows: 1, widths: [18, '*', 70, 62, 48, 70, 44, 66], body: [['Nr.', 'Name', 'Revier/Team', 'Sprache', 'Stand', 'Zeitpunkt', 'Weg', 'Erinnert'].map((text) => ({ text, style: 'th' })), ...body] },
      layout: tableLayout(colors),
      fontSize: 8,
    },
    { text: 'Zeitpunkte: Server des Webspace (Mein Plan, persönlicher Link der Person) bzw. Speichern in SharePoint (App, eigenes Konto). „Verstanden“ hat die Person selbst getippt; der Text stand ihr in ihrer Sprache und auf Deutsch zur Verfügung.', fontSize: 7.5, color: colors.grey, margin: [0, 8, 0, 0] },
  ]
  return docShell(content, { brand, colors, createdAt, title: `Nachweis Mitteilung ${m.titel}` })
}

export const messageProofName = (m) => `Mitteilung_${m.ab}_${fileSafe(m.titel) || 'Nachweis'}.pdf`
