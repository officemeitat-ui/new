// Mattenwechsel: Ankündigung an den Kunden vor dem Wechsel („Avis“) – rein rechnend, ohne Oberfläche
// (Tests: test/matten-avis.test.js). Aus einer freigegebenen Tour je Stopp eine E-Mail: Tag, Objekt, Liegeplätze und
// ein Zeitfenster aus der geplanten Ankunft (30 Minuten davor bis 90 Minuten danach, auf halbe Stunden gerundet und
// auf das Zeitfenster des Kunden begrenzt). Gesendet wird im Büro nach Klick (views/matten-planung.js), aus dem
// Postfach der angemeldeten Person; am Stopp steht danach notice { at, by, to, window, via }.
// Kunden, die keine Ankündigung wünschen, merkt sich settings.noticeOff (Kunden-IDs) in matten/matten.json.

import { isoWeekday, WEEKDAY_LONG } from './dates.js'
import { isFinal, orderedStops, placementsOf, updateStop } from './matten-fahrt.js'

const text = (v) => String(v ?? '').trim()
const isMail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text(v))
const toMin = (hhmm) => (/^\d{1,2}:\d{2}$/.test(text(hhmm)) ? Number(hhmm.split(':')[0]) * 60 + Number(hhmm.split(':')[1]) : null)
const toTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const deDate = (iso) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}`
const longDay = (iso) => `${WEEKDAY_LONG[isoWeekday(iso) - 1]}, ${deDate(iso)}`

export const NOTICE_DEFAULTS = { before: 30, after: 90, step: 30 }

/**
 * Zeitfenster für die Ankündigung: geplante Ankunft − before bis + after Minuten, auf step Minuten gerundet (Beginn ab,
 * Ende auf) und auf das Zeitfenster des Kunden (stop.window) begrenzt. null ohne geplante Ankunft.
 */
export function noticeWindow(stop, { before = NOTICE_DEFAULTS.before, after = NOTICE_DEFAULTS.after, step = NOTICE_DEFAULTS.step } = {}) {
  const a = toMin(stop?.times?.arrival)
  if (a === null) return null
  let from = Math.max(0, Math.floor((a - before) / step) * step)
  let to = Math.min(24 * 60 - 1, Math.ceil((a + after) / step) * step)
  const wf = toMin(stop?.window?.from)
  const wt = toMin(stop?.window?.to)
  if (wf !== null && wf > from && wf < to) from = wf
  if (wt !== null && wt < to && wt > from) to = wt
  return { from: toTime(from), to: toTime(to) }
}

/** E-Mail für die Ankündigung: Lieferschein-E-Mail des Kunden, sonst seine E-Mail, sonst die Kopie am Stopp; '' ohne. */
export function noticeEmail(stop, customer = null) {
  return [customer?.deliveryNoteEmail, customer?.email, stop?.customer?.deliveryNoteEmail].map(text).find(isMail) || ''
}

/** Darf diese Tour angekündigt werden? '' = ja, sonst der Grund. */
export function noticeProblem(tour, today) {
  if (!tour) return 'Tour nicht gefunden.'
  if (tour.status !== 'freigegeben') return tour.status === 'entwurf' ? 'Zuerst die Tour freigeben: angekündigt wird, was der Fahrer wirklich fährt.' : 'Die Tour ist schon unterwegs oder abgeschlossen.'
  if (today && tour.date < today) return 'Der Tag der Tour liegt in der Vergangenheit.'
  return ''
}

/**
 * Zeilen für den Dialog: je offenem Stopp { stopId, customerId, customerName, objectName, address, email, window,
 * placements [{ name, qty }], sent (notice am Stopp oder null), off (Kunde wünscht keine), selected (vorgewählt:
 * mit E-Mail, nicht „off“, noch nicht angekündigt) }.
 */
export function noticeRows({ tour, customers = [], off = [] } = {}) {
  const byId = new Map((customers || []).map((c) => [c.id, c]))
  const skip = new Set(off || [])
  return orderedStops(tour)
    .filter((s) => !isFinal(s))
    .map((s) => {
      const customerId = text(s.customer?.id)
      const email = noticeEmail(s, byId.get(customerId))
      const isOff = !!customerId && skip.has(customerId)
      return {
        stopId: s.id,
        customerId,
        customerName: text(s.customer?.name) || 'Kunde',
        objectName: text(s.objectName),
        address: text(s.address),
        email,
        window: noticeWindow(s),
        placements: placementsOf(s).map((p) => ({ name: p.placementName || 'Liegeplatz', qty: p.planned })),
        sent: s.notice || null,
        off: isOff,
        selected: !!email && !isOff && !s.notice,
      }
    })
}

/** E-Mail an den Kunden: { subject, text }. row aus noticeRows; sender (Name), company (Firma). */
export function noticeMail({ tour, row, sender = '', company = '' }) {
  const day = longDay(tour.date)
  const where = [row.objectName, row.address].filter(Boolean).join(', ')
  const when = row.window ? `Unser Fahrer kommt voraussichtlich zwischen ${row.window.from} und ${row.window.to} Uhr.` : 'Unser Fahrer kommt im Laufe des Tages.'
  const list = row.placements.filter((p) => p.qty > 0).map((p) => `– ${p.name}: ${p.qty} ${p.qty === 1 ? 'Matte' : 'Matten'}`)
  return {
    subject: `Mattenwechsel am ${day}${row.objectName ? ` – ${row.objectName}` : ''}`,
    text: [
      'Guten Tag,',
      '',
      `am ${day} tauschen wir bei Ihnen die Schmutzfangmatten${where ? `:\n${where}` : '.'}`,
      '',
      when,
      ...(list.length ? ['', 'Liegeplätze:', ...list] : []),
      '',
      'Bitte halten Sie die Liegeplätze zugänglich. Passt der Termin nicht, antworten Sie bitte auf diese E-Mail.',
      '',
      'Freundliche Grüße',
      ...[sender, company].map(text).filter(Boolean),
    ].join('\n'),
  }
}

/** Ankündigung am Stopp vermerken (Kopie der Tour): notice { at, by, to, window, via }. */
export function markNotice(tour, stopId, { to = [], window = null, at = new Date().toISOString(), by = '', via = 'graph' } = {}) {
  return updateStop(tour, stopId, (s) => ({ ...s, notice: { at, by, to: [...to], ...(window ? { window } : {}), via } }), { now: at, by, keepStatus: true, force: true })
}

/** Wie viele offene Stopps der Tour sind angekündigt? { open, sent }. */
export function noticeSummary(tour) {
  const open = orderedStops(tour).filter((s) => !isFinal(s))
  return { open: open.length, sent: open.filter((s) => s.notice).length }
}

/**
 * Neue Liste „wünscht keine Ankündigung“: abgewählte Kunden mit E-Mail kommen dazu, gewählte fallen heraus. Zeilen
 * ohne E-Mail und schon angekündigte ändern nichts.
 */
export function nextNoticeOff(off = [], rows = [], chosen = []) {
  const pick = new Set(chosen || [])
  const out = new Set(off || [])
  for (const r of rows || []) {
    if (!r.customerId || !r.email || r.sent) continue
    if (pick.has(r.stopId)) out.delete(r.customerId)
    else out.add(r.customerId)
  }
  return [...out].sort()
}
