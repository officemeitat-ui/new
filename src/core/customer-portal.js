// Kundenbereich: persönliche Links für Kunden bzw. Objekte (kunden.php am Webspace, ohne Anmeldung).
//
// Wie „Mein Dienstplan“ für die Mitarbeitenden: Jeder Link hat einen geheimen Code. Die App speichert
// Links und Codes in kundenbereich/kundenbereich.json (SharePoint), der Webspace kennt nur den
// Hashwert (SHA-256). Beim Übertragen bekommt der Webspace je Link nur, was dieser Link zeigen soll:
// Name und Adresse der Objekte, die nächsten Termine, die Liste der Nachweise (die PDFs gehen einzeln
// hinterher, nur wenn sie neu oder geändert sind). Reklamationen des Kunden kommen zurück wie die
// Anträge der Mitarbeitenden und werden zu Reklamationen mit Eingang „Kundenbereich“.
//
// Keine Namen von Mitarbeitenden (außer der Leistungsnachweis ist so eingestellt), keine Daten
// anderer Kunden, keine Gesundheits- oder Lohndaten. Rein rechnend, ohne Netz testbar.

import { isPeriodic, rhythmCategory } from './attention.js'
import { appointmentsBetween, dateOf, kindLabel, timeOf } from './appointments.js'
import { AUSHANG_SOURCE, complaintFromPosterReport, isPosterComplaint, isPosterReport, publicReplyOf } from './aushang.js'
import { dayOf, defaultDue } from './complaints.js'
import { addDays } from './dates.js'
import { workText } from './winterlog.js'

export const PORTAL_SOURCE = 'Kundenbereich'

/** Was ein Link zeigen kann (Standard: alles außer den Rechnungen; die brauchen die Wahl der Kunden). */
export const SHOW = {
  nachweise: 'Leistungsnachweise (PDF je Monat)',
  winter: 'Winterdienst-Nachweis (PDF, wo Winterdienst gemacht wurde)',
  leistungen: 'Nächste periodische Leistungen (z. B. Grundreinigung, Glasreinigung)',
  termine: 'Kundentermine und Objektbegehungen',
  reklamation: 'Reklamation melden und den Stand sehen',
  rechnungen: 'Rechnungen und offene Posten zeigen',
  lieferscheine: 'Mattenwechsel-Lieferscheine zeigen',
  mattenwechsel: 'Nächsten Mattenwechsel je Liegeplatz zeigen',
  zusatz: 'Zusatzleistung anfragen (z. B. Grundreinigung, Glasreinigung) und den Stand sehen',
  status: 'Stand im Objekt: zuletzt und als Nächstes gereinigt, Winterdienst, offene Meldungen',
}
/**
 * Standardmäßig aus (eigene Abschnitte im Dialog, Belege nur der gewählten Kunden der Fakturierung): Rechnungen,
 * Lieferscheine des Mattenwechsels und der nächste Mattenwechsel je Liegeplatz (core/customer-matten.js).
 */
export const SHOW_OFF = ['rechnungen', 'lieferscheine', 'mattenwechsel']
/**
 * Standardmäßig aus, aber in der Liste „Was der Link zeigt“: Zusatzleistung anfragen (core/zusatzleistungen.js) und
 * der Stand im Objekt (objectStatus). Neu dazugekommen, darum bei bestehenden Links erst, wenn das Büro es je Link
 * einschaltet.
 */
export const SHOW_DEFAULT_OFF = [...SHOW_OFF, 'zusatz', 'status']
export const showDefaults = () => Object.fromEntries(Object.keys(SHOW).map((k) => [k, !SHOW_DEFAULT_OFF.includes(k)]))

// ---------------------------------------------------------------- Mattenwechsel (Einstellung je Link)

export const NOTE_MONTHS = 13
export const NOTE_MONTH_CHOICES = [3, 6, 13, 24]
/** Lieferscheine und nächster Wechsel: Kunden der Fakturierung und Zeitraum (Standard: keine Kunden, 13 Monate). */
export const deliveryNoteSettings = (link = {}) => ({ customerIds: [], months: NOTE_MONTHS, ...(link.deliveryNotes || {}) })

/**
 * Kunden für den Mattenwechsel eines Links vorschlagen: Kunden der Fakturierung, denen Objekte des Links zugeordnet
 * sind, und Kunden mit Lieferscheinen aus dem Mattenwechsel bzw. Liegeplätzen an diesen Objekten. Liefert Kennungen
 * (meiste Treffer zuerst); nur Kunden, die es in der Fakturierung gibt.
 */
export function suggestNoteCustomers({ customers = [], docs = [], placements = [], objectIds = [] } = {}) {
  const objs = new Set(objectIds)
  const hits = new Map()
  const add = (id) => id && hits.set(id, (hits.get(id) || 0) + 1)
  for (const c of customers || []) if (c?.active !== false && (c.objectIds || []).some((id) => objs.has(id))) add(c.id)
  for (const d of docs || []) if (d?.kind === 'lieferschein' && d.source?.type === 'matten' && objs.has(d.objectId)) add(d.customerId)
  for (const p of placements || []) if (p?.active !== false && objs.has(p.objectId)) add(p.customerId)
  const known = new Set((customers || []).map((c) => c?.id))
  return [...hits.entries()].filter(([id]) => known.has(id)).sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

/** Arten, die der Kunde wählen kann (gleiche Liste in kunden.php). */
export const CUSTOMER_KINDS = ['Reinigung mangelhaft', 'Leistung nicht erbracht', 'Schaden', 'Sonstiges']
/** Termine, die der Kunde sieht: Kundentermin und Objektbegehung (keine Qualitätskontrollen, nichts Internes). */
export const CUSTOMER_APPOINTMENTS = ['kunde', 'begehung']
/** Status in der App → am Webspace (kunden.php zeigt „eingegangen“, „in Arbeit“, „erledigt“). */
export const SERVER_STATUS = { offen: 'eingegangen', arbeit: 'arbeit', erledigt: 'erledigt' }

export const MONTH_CHOICES = [3, 6, 12, 24]
export const SETTINGS_DEFAULTS = { enabled: false, key: '', officeTopic: '', officeEmails: '', sender: '', phone: '', email: '', privacyUrl: '', releaseDay: 5 }

/** Link für den Kunden. Im Link steht nur der Code, nichts über den Kunden. */
export const customerLink = (address, token) => `${String(address).replace(/\/?$/, '/')}kunden.php?k=${encodeURIComponent(token)}`

/** Kennung eines Links (Ablage am Webspace), z. B. „kb3f9a1c07d2“. */
export function newLinkId(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return `kb${[...random(5)].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

export const isActive = (link) => !!link && !link.revokedAt && !!link.token

/**
 * Monate mit Nachweis, neueste zuerst: abgeschlossene Monate, der Vormonat erst ab releaseDay
 * (Zeit zum Prüfen im Leistungsnachweis), höchstens count Monate.
 */
export function releasedMonths({ today, count = 12, releaseDay = 5 }) {
  const [y, m, d] = today.split('-').map(Number)
  let idx = y * 12 + (m - 1) - (d >= releaseDay ? 1 : 2)
  const out = []
  for (let i = 0; i < Math.max(0, count); i++, idx--) out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`)
  return out
}

/** Dateiname am Webspace: „2026-10-leistung-1.pdf“ (1 = erstes Objekt des Links). Keine Namen in der Adresse. */
export const fileName = (month, kind, nr) => `${month}-${kind}-${nr}.pdf`
export const FILE_PATTERN = /^\d{4}-\d{2}-(leistung|winter)-\d{1,3}\.pdf$/

/**
 * Nächste periodische Leistungen der Objekte (nicht wöchentliche: 14-tägig, monatlich, quartalsweise,
 * einmalig …), ohne entfallene. Keine Namen von Mitarbeitenden.
 */
export function upcomingServices({ instances = [], tasks = [], objectIds = [], from, to, objectsById = new Map() }) {
  const tasksById = new Map(tasks.map((t) => [t.id, t]))
  const ids = new Set(objectIds)
  return instances
    .filter((i) => ids.has(i.objectId) && i.status !== 'cancelled' && i.date >= from && i.date <= to && isPeriodic(tasksById.get(i.taskId)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
    .map((i) => ({
      datum: i.date,
      zeit: `${i.startTime}–${i.endTime}`,
      titel: i.label || 'Leistung',
      art: 'leistung',
      objekt: objectsById.get(i.objectId)?.name || '',
      hinweis: [rhythmCategory(tasksById.get(i.taskId)), i.status === 'moved' ? (i.reason === 'holiday' ? 'wegen Feiertag verschoben' : 'verschoben') : ''].filter(Boolean).join(', '),
    }))
}

/** Kundentermine und Objektbegehungen der Objekte (nicht abgesagt), mit Art und Titel, ohne Notizen und Teilnehmende. */
export function customerAppointments(items = [], { objectIds = [], from, to, objectsById = new Map() }) {
  const ids = new Set(objectIds)
  return appointmentsBetween(items, from, to)
    .filter((a) => ids.has(a.objectId) && CUSTOMER_APPOINTMENTS.includes(a.kind) && dateOf(a.start) >= from)
    .map((a) => ({
      datum: dateOf(a.start),
      zeit: a.allDay ? 'ganztägig' : `${timeOf(a.start)}–${timeOf(a.end)}`,
      titel: String(a.title || kindLabel(a.kind)).slice(0, 120),
      art: 'termin',
      objekt: objectsById.get(a.objectId)?.name || '',
      hinweis: kindLabel(a.kind),
    }))
}

/** Termine für den Link: Leistungen und Termine zusammen, nach Tag und Uhrzeit, höchstens max. */
export function upcomingDates({ services = [], appointments = [], max = 25 }) {
  const start = (x) => (x.zeit === 'ganztägig' ? '00:00' : x.zeit.slice(0, 5))
  return [...services, ...appointments].sort((a, b) => a.datum.localeCompare(b.datum) || start(a).localeCompare(start(b))).slice(0, max)
}

/** Text für die Signatur (immer gleiche Reihenfolge der Schlüssel). */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`
  return JSON.stringify(value ?? null)
}

/**
 * Was der Webspace für einen Link speichert (aktion=speichern). termine/nachweise null = nicht
 * geändert (die Rolle darf den Plan nicht lesen): der Webspace behält den letzten Stand. rechnungen
 * ebenso (null: die Rolle sieht die Fakturierung nicht); zeigt der Link keine, immer [] (dort gelöscht).
 * lieferscheine (null: ohne Recht auf die Fakturierung) und mattenwechsel (null: ohne Recht auf den
 * Mattenwechsel) genauso.
 */
export function linkPayload({ link, hash, objectsById = new Map(), termine = null, nachweise = null, rechnungen = null, lieferscheine = null, mattenwechsel = null, status = null }) {
  const show = { ...showDefaults(), ...(link.show || {}) }
  return {
    id: link.id,
    hash,
    titel: String(link.title || '').slice(0, 120),
    objekte: (link.objectIds || []).map((id, i) => {
      const o = objectsById.get(id) || {}
      return { nr: i + 1, id, name: String(o.name || 'Objekt').slice(0, 120), adresse: String(o.address || '').slice(0, 160) }
    }),
    zeige: show,
    termine: termine === null ? null : termine.filter((t) => (t.art === 'leistung' ? show.leistungen : show.termine)),
    nachweise: nachweise === null ? null : nachweise.filter((n) => (n.art === 'winter' ? show.winter : show.nachweise)),
    rechnungen: !show.rechnungen ? [] : rechnungen,
    rechnungenMonate: Math.max(1, Math.min(36, Number(link.invoices?.months) || 13)),
    lieferscheine: !show.lieferscheine ? [] : lieferscheine,
    lieferscheineMonate: Math.max(1, Math.min(36, Number(link.deliveryNotes?.months) || NOTE_MONTHS)),
    mattenwechsel: !show.mattenwechsel ? [] : mattenwechsel,
    status: !show.status ? [] : status,
  }
}

// ---------------------------------------------------------------- Stand im Objekt (Schalter „status“)

/** Tage zurück und voraus, die der Stand an Einsätzen mitnimmt (die Seite rechnet „zuletzt“, „jetzt“, „als Nächstes“ selbst). */
export const STATUS_BACK = 14
export const STATUS_AHEAD = 21
/** Meldungen dieser Wege zeigt der Stand (Aushang: Meldungen der Leute im Haus); interne und aus Kontrollen nie. */
const STATUS_SOURCES = [PORTAL_SOURCE, AUSHANG_SOURCE, 'Kunde (Telefon)', 'Kunde (E-Mail)', 'Kunde (vor Ort)']

/**
 * Stand je Objekt für den Kundenbereich, ohne Namen von Mitarbeitenden und ohne Text der Meldungen:
 * - einsaetze: nicht entfallene Einsätze der letzten STATUS_BACK und nächsten STATUS_AHEAD Tage (Tag, von, bis,
 *   Leistung; bestaetigt, wenn im Objekt gestempelt oder die Checkliste fertig ist) – höchstens 5 vorbei, 8 kommend;
 * - winter: letzter Eintrag im Winterdienst-Protokoll der letzten 7 Tage (Tag, Uhrzeit, was gemacht wurde);
 * - meldungen: offene Reklamationen am Objekt von Kunden und vom Aushang (Tag, Art, Stand), erledigt30: in den letzten
 *   30 Tagen erledigte. complaints null (Rolle sieht die Reklamationen nicht): meldungen und erledigt30 null.
 * today: Tag in Wien; confirmed: Set der Einsatz-Schlüssel mit Stempelung oder fertiger Checkliste.
 */
export function objectStatus({ objectIds = [], instances = [], today, confirmed = new Set(), winterlog = {}, complaints = null, objectsById = new Map() }) {
  const from = addDays(today, -STATUS_BACK)
  const to = addDays(today, STATUS_AHEAD)
  const winterFrom = addDays(today, -7)
  const since = addDays(today, -30)
  return objectIds.map((id) => {
    const own = instances.filter((i) => i.objectId === id && i.status !== 'cancelled' && i.date >= from && i.date <= to).sort((a, b) => a.start - b.start)
    const row = (i) => ({ datum: i.date, von: i.startTime, bis: i.endTime, titel: String(i.label || 'Reinigung').slice(0, 80), ...(confirmed.has(i.key) ? { bestaetigt: true } : {}) })
    const past = own.filter((i) => i.date < today).slice(-5)
    const coming = own.filter((i) => i.date >= today).slice(0, 8)
    const w = Object.values(winterlog || {})
      .filter((e) => e?.objectId === id && !e.test && e.date >= winterFrom && e.date <= today && e.at)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .at(-1)
    const at = w ? new Date(w.at) : null
    const uhr = at && Number.isFinite(at.getTime()) ? new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }).format(at) : ''
    const mine = complaints === null ? null : complaints.filter((c) => c.objectId === id && STATUS_SOURCES.includes(c.source))
    return {
      id,
      objekt: String(objectsById.get(id)?.name || 'Objekt').slice(0, 120),
      einsaetze: [...past, ...coming].map(row),
      winter: w ? { datum: w.date, uhr, was: workText(w) || 'Winterdienst' } : null,
      meldungen:
        mine === null
          ? null
          : mine
              .filter((c) => c.status !== 'erledigt')
              .sort((a, b) => String(a.received || a.date).localeCompare(String(b.received || b.date)))
              .slice(0, 10)
              .map((c) => ({ datum: dayOf(c.received || c.date), art: String(c.kind || 'Meldung').slice(0, 60), stand: c.status === 'arbeit' ? 'arbeit' : 'eingegangen' })),
      erledigt30: mine === null ? null : mine.filter((c) => c.status === 'erledigt' && dayOf(c.doneAt || c.received || c.date) >= since).length,
    }
  })
}

/** Einsätze mit Stempelung (Kommen) oder fertiger Checkliste: Set der Einsatz-Schlüssel. */
export function confirmedKeys({ stamps = {}, checks = {} } = {}) {
  const out = new Set()
  for (const s of Object.values(stamps || {})) if (s?.instKey && s.in) out.add(s.instKey)
  for (const c of Object.values(checks || {})) if (c?.instKey && c.finished) out.add(c.instKey)
  return out
}

/** Kontakt aus der Meldung in einer Zeile: „Maria Huber, 0662 123456, maria@example.com“. */
export const contactText = (k = {}) => [k.name, k.telefon, k.email].map((x) => String(x || '').trim()).filter(Boolean).join(', ')

/**
 * Meldung vom Webspace → Reklamation der App (Eingang „Kundenbereich“; vom Aushang im Objekt: „Aushang (QR)“,
 * core/aushang.js). Die Kennung folgt aus der Meldung, damit zwei Geräte, die gleichzeitig übernehmen, dieselbe
 * Reklamation anlegen.
 */
export function complaintFromReport(m, { link = null, now = new Date().toISOString() } = {}) {
  if (isPosterReport(m)) return complaintFromPosterReport(m, { now })
  const kind = CUSTOMER_KINDS.includes(m.art) ? m.art : 'Sonstiges'
  const received = Number(m.erstellt) ? new Date(Number(m.erstellt) * 1000).toISOString() : now
  const day = /^\d{4}-\d{2}-\d{2}$/.test(m.datum || '') ? m.datum : received.slice(0, 10)
  return {
    id: `rk${String(m.id).replace(/[^a-f0-9]/g, '')}`,
    objectId: String(m.objektId || ''),
    date: day,
    received,
    source: PORTAL_SOURCE,
    kind,
    text: String(m.text || '').slice(0, 2000),
    contact: contactText(m.kontakt),
    employees: [],
    measure: '',
    due: defaultDue(kind, received.slice(0, 10)),
    status: 'offen',
    result: '',
    informed: false,
    by: PORTAL_SOURCE,
    history: [{ at: received, by: PORTAL_SOURCE, text: `gemeldet über den Kundenbereich${link?.title ? ` (${link.title})` : ''}` }],
    portal: { id: String(m.id), link: String(m.link || link?.id || ''), sent: 'eingegangen|' },
  }
}

/**
 * Was der Kunde sieht: Status und, wenn erledigt, das Ergebnis (Rückmeldung an den Kunden). Die Maßnahme bleibt intern.
 * Vom Aushang (öffentlich): nie das Ergebnis, nur die eigens eingetragene öffentliche Antwort.
 */
export function reportStatus(c) {
  const status = SERVER_STATUS[c.status] || 'eingegangen'
  if (isPosterComplaint(c)) return { id: c.portal?.id, status, antwort: publicReplyOf(c) }
  return { id: c.portal?.id, status, antwort: status === 'erledigt' ? String(c.result || '').slice(0, 1000) : '' }
}
const statusSig = (s) => `${s.status}|${s.antwort}`

/** Reklamationen aus dem Kundenbereich, deren Stand der Webspace noch nicht kennt. */
export function statusUpdates(items = []) {
  return items.filter((c) => c.portal?.id && statusSig(reportStatus(c)) !== c.portal.sent).map(reportStatus)
}
export const markSent = (c) => ({ ...c, portal: { ...c.portal, sent: statusSig(reportStatus(c)) } })

/** Neue Meldungen vom Webspace (noch nicht in der App und von niemandem übernommen). */
export function newReports(reports = [], items = []) {
  const known = new Set(items.map((c) => c.portal?.id).filter(Boolean))
  return reports.filter((m) => m && /^[a-f0-9]{12}$/.test(String(m.id)) && !known.has(String(m.id)) && !m.uebernommen)
}

/** E-Mail an den Kunden mit dem Link (Sie-Form). */
export function linkMail({ link, url, company = '', sender = '', phone = '' }) {
  const show = { ...showDefaults(), ...(link.show || {}) }
  const what = [show.nachweise && 'die monatlichen Leistungsnachweise als PDF', show.winter && 'den Winterdienst-Nachweis', (show.leistungen || show.termine) && 'die nächsten Termine in Ihrem Objekt', show.mattenwechsel && 'den nächsten Mattenwechsel', show.lieferscheine && 'die Lieferscheine zum Mattenwechsel als PDF', show.rechnungen && 'Ihre Rechnungen und offenen Posten als PDF', show.reklamation && 'die Möglichkeit, eine Reklamation direkt zu melden und den Stand zu verfolgen', show.zusatz && 'die Möglichkeit, Zusatzleistungen wie eine Grundreinigung oder Glasreinigung anzufragen'].filter(Boolean)
  const list = what.length > 1 ? `${what.slice(0, -1).join(', ')} und ${what.at(-1)}` : what[0] || 'Informationen zu Ihrem Objekt'
  return {
    subject: `Ihr Kundenbereich${company ? ` bei ${company}` : ''}${link.title ? `: ${link.title}` : ''}`,
    text: [
      'Sehr geehrte Damen und Herren,',
      '',
      `ab sofort finden Sie unter diesem persönlichen Link ${list}:`,
      url,
      '',
      'Eine Anmeldung ist nicht nötig. Bitte geben Sie den Link nur an Personen weiter, die ihn brauchen; er wirkt wie ein Passwort. Ist er in falsche Hände geraten, schicken wir Ihnen gerne einen neuen.',
      '',
      phone ? `Bei Fragen erreichen Sie uns unter ${phone}.` : 'Bei Fragen melden Sie sich gerne.',
      '',
      'Mit freundlichen Grüßen',
      sender,
      company,
    ]
      .filter((x, i, all) => x !== '' || all[i - 1] !== '')
      .join('\n')
      .trim(),
  }
}

/** Kurzer Stand eines Links für die Liste in der App. */
export function linkState(link) {
  if (link.revokedAt) return { key: 'gesperrt', label: 'gesperrt' }
  if (link.error) return { key: 'fehler', label: 'nicht übertragen' }
  if (!link.publishedAt) return { key: 'neu', label: 'noch nicht übertragen' }
  return { key: 'aktiv', label: 'aktiv' }
}

