// E-Mail aus der App: reine Hilfen ohne Browser (getestet in test/mail.test.js).
// Adressen lesen („Anna Berger <anna@firma.at>; b@x.at“), Betreff aus dem Dateinamen eines Exports,
// Tabellen als CSV, Aufgabe als Kalender-Erinnerung (.ics), mailto-Adresse, Größenprüfung.

import { formatDate } from './dates.js'
import { icsEvent } from './ics.js'

/** Graph schickt Anhänge im Nachrichtentext mit; darüber wird es unsicher (Grenze ca. 4 MB je Anfrage). */
export const MAIL_LIMIT = 3 * 1024 * 1024

const ADDRESS = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/

/**
 * Empfänger aus freiem Text: getrennt durch Komma, Strichpunkt oder Zeilenumbruch, gern mit Namen
 * („Anna Berger <anna@firma.at>“). Doppelte fallen weg (Groß/klein egal).
 * Ergebnis: { valid: ['anna@firma.at', …], invalid: ['anna@'] }
 */
export function parseAddresses(text = '') {
  const valid = []
  const invalid = []
  const seen = new Set()
  for (const raw of String(text).split(/[,;\n]+/)) {
    const part = raw.trim()
    if (!part) continue
    const inAngle = /<([^>]+)>/.exec(part)
    const candidate = (inAngle ? inAngle[1] : part).trim()
    const m = ADDRESS.exec(candidate)
    if (m && m[0].length === candidate.length) {
      const key = m[0].toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        valid.push(m[0])
      }
    } else invalid.push(part)
  }
  return { valid, invalid }
}

/** „Anna Berger <anna@firma.at>“ (ohne Namen nur die Adresse). */
export const formatAddress = (name, email) => (name ? `${String(name).replace(/[<>,;"]/g, '')} <${email}>` : email)

/**
 * Betreff aus einem Dateinamen: „Lagerbestand_2026-11-04.csv“ → „Lagerbestand 04.11.2026“,
 * „Kalkulation_Wohnanlage-Lehen.pdf“ → „Kalkulation Wohnanlage Lehen“.
 */
export function subjectFromFile(name = '') {
  return String(name)
    .replace(/\.[A-Za-z0-9]{2,4}$/, '')
    .replace(/(\d{4})-(\d{2})-(\d{2})/g, (_, y, m, d) => `${d}.${m}.${y}`)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Zeilen (Arrays von Zellen) als CSV wie Excel in Österreich: Strichpunkt, Anführungszeichen bei Bedarf, BOM. */
export function rowsToCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim()
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return `\ufeff${rows.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`
}

/** Gesamtgröße der Anhänge in Bytes. */
export const attachmentSize = (attachments = []) => attachments.reduce((n, a) => n + (a.blob?.size || a.size || 0), 0)

/** „1,2 MB“, „340 KB“ */
export function sizeText(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toLocaleString('de-AT', { maximumFractionDigits: 1 })} MB`
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('de-AT')} KB`
}

/** mailto-Adresse (ohne Anhänge: die lädt die App herunter). Leerzeichen als %20, nicht „+“. */
export function mailtoUrl({ to = [], cc = [], subject = '', body = '' }) {
  const q = new URLSearchParams()
  if (cc.length) q.set('cc', cc.join(','))
  if (subject) q.set('subject', subject)
  if (body) q.set('body', body.slice(0, 1800)) // E-Mail-Programme kürzen lange Adressen
  return `mailto:${to.map((a) => encodeURIComponent(a).replace(/%40/g, '@')).join(',')}${q.toString() ? `?${q.toString().replace(/\+/g, '%20')}` : ''}`
}

/**
 * Aufgabe als E-Mail: Text und Kalender-Erinnerung am Fälligkeitstag (ganztägig, Erinnerung am Vortag
 * um 9 Uhr), damit sie beim Empfänger im Kalender steht – auch ohne Microsoft 365.
 * task: { title, due?, object?, description?, from? (Name), link? }
 */
export function taskMail(task, { now = new Date(), brand = 'Cleanos App' } = {}) {
  const title = String(task.title || '').trim() || 'Aufgabe'
  const lines = [`Aufgabe: ${title}`]
  if (task.due) lines.push(`Fällig bis: ${formatDate(task.due, { year: true })}`)
  if (task.object) lines.push(`Objekt: ${task.object}`)
  if (task.description?.trim()) lines.push('', task.description.trim())
  if (task.link) lines.push('', `In der App: ${task.link}`)
  lines.push('', task.from ? `Danke und liebe Grüße\n${task.from}` : 'Danke!', '', `– gesendet aus der ${brand}`)
  const subject = `Aufgabe: ${title}${task.due ? ` (bis ${formatDate(task.due, { weekday: false })})` : ''}`
  const ics = task.due
    ? icsEvent({ uid: `aufgabe-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}@cleanos-app`, date: task.due, title: `Fällig: ${title}`, description: [task.object ? `Objekt: ${task.object}` : '', task.description || ''].filter(Boolean).join('\n'), location: task.object || '', remindHours: 15, now })
    : ''
  return { subject, text: lines.join('\n'), ics }
}

/**
 * Bericht aus einer Ansicht: Betreff „Titel – Stand“ und Text mit den Kennzahlen, die Datei(en) hängen an.
 * report: { title, subtitle?, tiles: [{ label, value }], files: ['Bericht.pdf', …] }
 */
export function reportMail({ title, subtitle = '', tiles = [], files = [], from = '', brand = 'Cleanos App' }) {
  const lines = ['Hallo,', '', `anbei ${title}${subtitle ? ` (${subtitle})` : ''}${files.length ? ` als ${files.length === 1 ? 'Anhang' : `${files.length} Anhänge`}` : ''}.`]
  if (tiles.length) lines.push('', 'Auf einen Blick:', ...tiles.slice(0, 12).map((t) => `• ${t.label}: ${t.value}`))
  lines.push('', from ? `Liebe Grüße\n${from}` : 'Liebe Grüße', '', `– gesendet aus der ${brand}`)
  return { subject: subtitle ? `${title} – ${subtitle}` : title, text: lines.join('\n') }
}

/**
 * Liste von Punkten (z. B. „Zu erledigen“) als E-Mail mit Link in die App.
 * items: ['…'] oder sections: [{ title, items }] für mehrere Abschnitte.
 */
export function listMail({ title, items = [], sections = null, link = '', from = '', brand = 'Cleanos App' }) {
  const body = [title, '']
  for (const g of (sections || [{ title: '', items }]).filter((x) => x.items.length)) {
    if (g.title) body.push(g.title)
    body.push(...g.items.map((t) => `• ${t}`), '')
  }
  if (link) body.push(`In der App: ${link}`, '')
  if (from) body.push(`Liebe Grüße\n${from}`)
  body.push(`– gesendet aus der ${brand}`)
  return { subject: title, text: body.join('\n').replace(/\n{3,}/g, '\n\n').trim() }
}
