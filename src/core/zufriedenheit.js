// Kundenzufriedenheit: kurze Umfrage im Kundenbereich (kunden.php) je Runde und Link, Auswertung je Objekt und je
// Kunde, Verlauf über die Quartale, Durchschnitt je Frage, NPS, Rücklaufquote, Freitexte; Hinweise bei schlechten
// Werten (Gesamt höchstens 2 oder Rückruf erwünscht → „Kunde anrufen“, fallender Verlauf). Reine Funktionen ohne
// Browser (test/zufriedenheit.test.js); Ansicht: ui/views/zufriedenheit.js, Bericht: export/zufriedenheit-pdf.js.
//
// Datei zufriedenheit/zufriedenheit.json:
//   { settings: { rhythm: 'aus'|'quartal'|'halbjahr', days, questions: { overall, items: [{ id, text }], nps, comment },
//                 invite: { subject, text } }
//     links:   { [Link-Kennung]: { rhythm: ''|'quartal'|'halbjahr'|'aus', noInvite } }   '' = wie die Vorgabe
//     rounds:  [{ id: '2026-Q4', period, from, until, questions (Stand beim Öffnen), links: [{ id, title, objectIds }],
//                 openedAt, openedBy, closedAt, closedBy, publishedAt, error, invites: [{ linkId, to, at, by, via }] }]
//     answers: [{ id: 'kz<Kennung am Webspace>', serverId, roundId, linkId, linkTitle, objectIds, objectId, at,
//                 overall (1–5), scores: { [Frage]: 1–5 }, nps (0–10|null), comment, callback, phone, name, role,
//                 takenAt, takenBy, done: { at, by, note }|null }] }
//
// Runde = Quartal (eine je Quartal, Kennung „2026-Q4“). Wer teilnimmt, legt der Rhythmus fest: vierteljährlich jede
// Runde, halbjährlich nur, wenn der Link in der Runde davor nicht dabei war, aus nie. Geöffnet wird nur nach Klick im
// Büro; „Zu erledigen“ erinnert daran. Die Fragen der Runde werden beim Öffnen festgehalten (Auswertung bleibt
// vergleichbar, auch wenn die Fragen später geändert werden). Antworten tragen Bezeichnung und Objekte des Links mit
// (Auswertung auch, wenn der Link gesperrt oder gelöscht ist).
//
// NPS (Net Promoter Score): Anteil 9–10 („Promotoren“) minus Anteil 0–6 („Kritiker“), in Punkten von −100 bis +100.

import { addDays, lastOfMonth } from './dates.js'
import { revierName, revierSetup, reviereFor } from './reviere.js'

export const RHYTHMS = { quartal: 'vierteljährlich', halbjahr: 'halbjährlich', aus: 'aus' }
export const ITEMS_MIN = 3
export const ITEMS_MAX = 5
export const TEXT_MAX = 160
export const DAYS_DEFAULT = 28
export const QUESTION_ID = /^[a-z][a-z0-9]{1,23}$/
export const PERIOD = /^\d{4}-Q[1-4]$/

export const QUESTION_DEFAULTS = {
  overall: 'Wie zufrieden sind Sie insgesamt mit unserer Arbeit?',
  items: [
    { id: 'sauberkeit', text: 'Sauberkeit' },
    { id: 'zuverlaessig', text: 'Zuverlässigkeit und Termintreue' },
    { id: 'personal', text: 'Freundlichkeit unseres Personals' },
    { id: 'buero', text: 'Erreichbarkeit und Reaktion unseres Büros' },
  ],
  nps: 'Wie wahrscheinlich ist es, dass Sie uns weiterempfehlen?',
  comment: 'Was sollen wir besser machen, was gefällt Ihnen?',
}

/** E-Mail-Einladung: {titel}, {objekte}, {link}, {bis}, {absender}, {firma} werden ersetzt. */
export const INVITE_DEFAULTS = {
  subject: 'Kurze Umfrage: Wie zufrieden sind Sie mit uns?',
  text: [
    'Sehr geehrte Damen und Herren,',
    '',
    'wie zufrieden sind Sie mit unserer Arbeit ({objekte})? Ihre Meinung hilft uns, besser zu werden. Die Umfrage in Ihrem Kundenbereich dauert etwa zwei Minuten und ist bis {bis} offen:',
    '{link}',
    '',
    'Die Teilnahme ist freiwillig. Wünschen Sie einen Rückruf, kreuzen Sie das einfach an.',
    '',
    'Mit freundlichen Grüßen',
    '{absender}',
    '{firma}',
    '',
    'Sie möchten keine Einladungen zu Umfragen mehr? Eine kurze Antwort auf diese E-Mail genügt.',
  ].join('\n'),
}

export const SETTINGS_DEFAULTS = { rhythm: 'aus', days: DAYS_DEFAULT }

export const emptyZufriedenheit = () => ({ settings: {}, links: {}, rounds: [], answers: [] })

const clean = (s, n = TEXT_MAX) =>
  String(s ?? '')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, n)
const int = (v, min, max) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}
const round1 = (v) => (v === null ? null : Math.round(v * 100) / 100)

// ---------------------------------------------------------------- Quartale

/** Quartal eines Tages: „2026-Q4“. */
export const periodOf = (date) => `${String(date).slice(0, 4)}-Q${Math.floor((Number(String(date).slice(5, 7)) - 1) / 3) + 1}`
export const periodIndex = (p) => Number(String(p).slice(0, 4)) * 4 + Number(String(p).slice(6)) - 1
export const periodFromIndex = (i) => `${Math.floor(i / 4)}-Q${(i % 4) + 1}`
export const nextPeriod = (p) => periodFromIndex(periodIndex(p) + 1)
/** Erster und letzter Tag des Quartals. */
export function periodRange(p) {
  const y = String(p).slice(0, 4)
  const first = (Number(String(p).slice(6)) - 1) * 3 + 1
  const mm = (n) => String(n).padStart(2, '0')
  return { from: `${y}-${mm(first)}-01`, to: lastOfMonth(`${y}-${mm(first + 2)}-01`) }
}
/** „4. Quartal 2026“ bzw. kurz „Q4/26“ (Achse der Diagramme). */
export const periodLabel = (p) => `${String(p).slice(6)}. Quartal ${String(p).slice(0, 4)}`
export const periodShort = (p) => `Q${String(p).slice(6)}/${String(p).slice(2, 4)}`

// ---------------------------------------------------------------- Einstellungen und Fragen

/** Fragen prüfen: Texte gekürzt, Einzelfragen mit gültiger, eindeutiger Kennung, höchstens fünf; leer → Vorgaben. */
export function normalizeQuestions(q) {
  const items = []
  for (const x of Array.isArray(q?.items) ? q.items : []) {
    const id = String(x?.id || '')
    const text = clean(x?.text)
    if (QUESTION_ID.test(id) && text && !items.some((y) => y.id === id) && items.length < ITEMS_MAX) items.push({ id, text })
  }
  return {
    overall: clean(q?.overall) || QUESTION_DEFAULTS.overall,
    items: items.length ? items : QUESTION_DEFAULTS.items.map((x) => ({ ...x })),
    nps: clean(q?.nps) || QUESTION_DEFAULTS.nps,
    comment: clean(q?.comment) || QUESTION_DEFAULTS.comment,
  }
}

/** Fehler in den Fragen (für den Dialog) oder ''. */
export function questionsProblem(q) {
  const items = Array.isArray(q?.items) ? q.items : []
  if (!clean(q?.overall)) return 'Bitte die Frage zur Gesamtzufriedenheit ausfüllen.'
  const filled = items.filter((x) => clean(x?.text))
  if (filled.length < ITEMS_MIN || filled.length > ITEMS_MAX) return `Bitte ${ITEMS_MIN} bis ${ITEMS_MAX} Einzelfragen (jetzt ${filled.length}).`
  if (!clean(q?.nps)) return 'Bitte die Frage zur Weiterempfehlung ausfüllen.'
  return ''
}

/** Neue Kennung einer Frage (klein, ohne Sonderzeichen). */
export const newQuestionId = (random = Math.random) => `f${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`

export function settingsOf(doc) {
  const s = doc?.settings || {}
  return {
    rhythm: RHYTHMS[s.rhythm] ? s.rhythm : SETTINGS_DEFAULTS.rhythm,
    days: int(s.days, 7, 90) ?? SETTINGS_DEFAULTS.days,
    questions: normalizeQuestions(s.questions),
    invite: { subject: clean(s.invite?.subject, 200) || INVITE_DEFAULTS.subject, text: String(s.invite?.text || '').trim().slice(0, 4000) || INVITE_DEFAULTS.text },
  }
}

// ---------------------------------------------------------------- Teilnahme je Link und Runden

export const linkConf = (doc, linkId) => ({ rhythm: '', noInvite: false, ...(doc?.links?.[linkId] || {}) })
/** Rhythmus eines Links: eigener oder die Vorgabe. */
export const rhythmOf = (doc, linkId) => (RHYTHMS[linkConf(doc, linkId).rhythm] ? linkConf(doc, linkId).rhythm : settingsOf(doc).rhythm)

export const roundOf = (doc, period) => (doc?.rounds || []).find((r) => r.id === period) || null
/** Runde offen: nicht geschlossen und heute zwischen Beginn und Ende. */
export const isOpen = (round, today) => !!round && !round.closedAt && round.from <= today && today <= round.until
/** Zustand einer Runde: geplant, offen, beendet. */
export const roundState = (round, today) => (round.closedAt || round.until < today ? 'beendet' : round.from > today ? 'geplant' : 'offen')
export const ROUND_STATES = { geplant: 'geplant', offen: 'offen', beendet: 'beendet' }

/** Letztes Quartal vor `period`, in dem der Link in einer Runde war (Index) oder null. */
export function lastParticipation(doc, linkId, period) {
  const idx = periodIndex(period)
  let last = null
  for (const r of doc?.rounds || []) {
    const i = periodIndex(r.id)
    if (i < idx && (r.links || []).some((l) => l.id === linkId) && (last === null || i > last)) last = i
  }
  return last
}

/**
 * Links, die in einer Runde dran sind: aktiv (nicht gesperrt), Rhythmus nicht „aus“, halbjährlich nur, wenn der Link
 * im Quartal davor nicht dabei war. links: Links des Kundenbereichs ({ id, title, objectIds, token, revokedAt }).
 */
export function dueLinks({ doc, links = [], period }) {
  const idx = periodIndex(period)
  return links.filter((l) => {
    if (!l || l.revokedAt || !l.token) return false
    const r = rhythmOf(doc, l.id)
    if (r === 'aus') return false
    if (r === 'halbjahr') {
      const last = lastParticipation(doc, l.id, period)
      return last === null || idx - last >= 2
    }
    return true
  })
}

/** Ende einer neuen Runde: Beginn + Laufzeit, höchstens 90 Tage. */
export const defaultUntil = (from, days = DAYS_DEFAULT) => addDays(from, Math.max(7, Math.min(90, Number(days) || DAYS_DEFAULT)) - 1)

/** Neue Runde (Quartal), Fragen eingefroren, Links mit Bezeichnung und Objekten. */
export function newRound({ period, from, until, questions, links = [], by = '', at = new Date().toISOString() }) {
  return {
    id: period,
    period,
    from,
    until,
    questions: normalizeQuestions(questions),
    links: links.map((l) => ({ id: l.id, title: clean(l.title, 120), objectIds: [...(l.objectIds || [])] })),
    openedAt: at,
    openedBy: by,
    closedAt: null,
    closedBy: '',
    publishedAt: null,
    error: '',
    invites: [],
  }
}

/** Fehler einer Runde (Dialog) oder ''. */
export function roundProblem({ period, from, until, links = [] }, today) {
  if (!PERIOD.test(String(period || ''))) return 'Bitte das Quartal wählen.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(until || ''))) return 'Bitte Beginn und Ende eintragen.'
  if (until < from) return 'Das Ende liegt vor dem Beginn.'
  if (until < today) return 'Das Ende liegt in der Vergangenheit.'
  if (addDays(from, 90) < until) return 'Eine Runde dauert höchstens 90 Tage.'
  if (!links.length) return 'Bitte mindestens einen Link wählen.'
  return ''
}

/** Was der Webspace je Runde bekommt (aktion=umfrage): nur Runden, die nicht geschlossen und nicht vorbei sind. */
export function roundsPayload(doc, today) {
  return (doc?.rounds || [])
    .filter((r) => !r.closedAt && r.until >= today)
    .map((r) => {
      const q = normalizeQuestions(r.questions)
      return { id: r.id, von: r.from, bis: r.until, fragen: { gesamt: q.overall, einzeln: q.items.map((x) => ({ id: x.id, text: x.text })), nps: q.nps, freitext: q.comment }, links: (r.links || []).map((l) => l.id) }
    })
}

// ---------------------------------------------------------------- Antworten vom Webspace

/** Antworten vom Webspace, die noch nicht in der App sind und die niemand übernommen hat. */
export function newServerAnswers(list = [], doc) {
  const known = new Set((doc?.answers || []).map((a) => a.serverId))
  return (Array.isArray(list) ? list : []).filter((e) => e && /^[a-f0-9]{12}$/.test(String(e.id)) && !known.has(String(e.id)) && !e.uebernommen && PERIOD.test(String(e.runde || '')))
}

/**
 * Antwort vom Webspace → Antwort der App. Werte geprüft und begrenzt (nur Fragen der Runde), Bezeichnung und
 * Objekte des Links aus der Runde. Die Kennung folgt aus der Webspace-Kennung (zwei Geräte legen dieselbe an).
 */
export function answerFromServer(e, { round = null, link = null, by = '', now = new Date().toISOString() } = {}) {
  const q = normalizeQuestions(round?.questions)
  const fromRound = (round?.links || []).find((l) => l.id === e.link) || null
  const objectIds = [...(fromRound?.objectIds || link?.objectIds || [])]
  const objectId = e.objekt && objectIds.includes(String(e.objekt.id || '')) ? String(e.objekt.id) : ''
  const scores = {}
  for (const item of q.items) {
    const v = int(e.werte?.[item.id], 1, 5)
    if (v !== null) scores[item.id] = v
  }
  return {
    id: `kz${String(e.id)}`,
    serverId: String(e.id),
    roundId: String(e.runde),
    linkId: String(e.link || ''),
    linkTitle: clean(fromRound?.title || link?.title || '', 120),
    objectIds,
    objectId,
    at: Number(e.zeit) ? new Date(Number(e.zeit) * 1000).toISOString() : now,
    overall: int(e.gesamt, 1, 5) ?? 3,
    scores,
    nps: int(e.nps, 0, 10),
    comment: clean(e.text, 2000),
    callback: !!e.rueckruf,
    phone: clean(e.telefon, 40),
    name: clean(e.name, 80),
    role: clean(e.funktion, 80),
    takenAt: now,
    takenBy: by,
    done: null,
  }
}

// ---------------------------------------------------------------- Auswertung

const mean = (list) => (list.length ? list.reduce((s, x) => s + x, 0) / list.length : null)

/** NPS aus Werten 0–10: { score (−100…100), promoters, passives, detractors, n } oder null ohne Werte. */
export function npsOf(values = []) {
  const v = values.filter((x) => Number.isInteger(x) && x >= 0 && x <= 10)
  if (!v.length) return null
  const promoters = v.filter((x) => x >= 9).length
  const detractors = v.filter((x) => x <= 6).length
  return { score: Math.round(((promoters - detractors) / v.length) * 100), promoters, passives: v.length - promoters - detractors, detractors, n: v.length }
}
export const npsGroup = (v) => (v === null || v === undefined ? '' : v >= 9 ? 'Promotor' : v >= 7 ? 'passiv' : 'Kritiker')

/** Objekte, auf die sich eine Antwort bezieht: das gewählte, sonst alle des Links. */
export const answerObjects = (a) => (a?.objectId ? [a.objectId] : a?.objectIds || [])
/** Antwort im Bereich der Person (scope: Set der Objekte, null = alle). */
export const inScope = (a, scope) => !scope || answerObjects(a).some((id) => scope.has(id))
/** Link einer Runde im Bereich der Person. */
export const linkInScope = (l, scope) => !scope || (l.objectIds || []).some((id) => scope.has(id))

/**
 * Kennzahlen zu Antworten: Anzahl, Durchschnitt gesamt und je Frage (Fragen aus questions, ältere Fragen dazu, wenn
 * es Werte gibt), NPS, Rückrufe, Freitexte (neueste zuerst).
 */
export function summarize(answers = [], questions = null) {
  const q = normalizeQuestions(questions)
  const ids = [...q.items.map((x) => x.id)]
  for (const a of answers) for (const id of Object.keys(a.scores || {})) if (!ids.includes(id)) ids.push(id)
  const textOf = (id) => q.items.find((x) => x.id === id)?.text || id
  return {
    count: answers.length,
    overall: round1(mean(answers.map((a) => a.overall).filter((x) => Number.isInteger(x)))),
    items: ids.map((id) => {
      const vals = answers.map((a) => a.scores?.[id]).filter((x) => Number.isInteger(x))
      return { id, text: textOf(id), avg: round1(mean(vals)), n: vals.length }
    }).filter((x) => x.n || q.items.some((y) => y.id === x.id)),
    nps: npsOf(answers.map((a) => a.nps)),
    callbacks: answers.filter((a) => a.callback).length,
    comments: answers.filter((a) => a.comment).sort((a, b) => String(b.at).localeCompare(String(a.at))),
  }
}

/** Rücklauf einer Runde: Links in der Runde (im Bereich) und wie viele davon geantwortet haben. */
export function responseOf(round, answers = [], scope = null) {
  const links = (round?.links || []).filter((l) => linkInScope(l, scope))
  const answered = new Set(answers.filter((a) => a.roundId === round?.id && links.some((l) => l.id === a.linkId)).map((a) => a.linkId))
  return { invited: links.length, answered: answered.size, rate: links.length ? answered.size / links.length : null }
}

/**
 * Verlauf je Runde (ältere zuerst, höchstens `max`, nur begonnene): { period, round, count, overall, nps, items,
 * invited, answered, rate }. filter(a): welche Antworten zählen (z. B. ein Objekt), scope: Bereich der Person.
 */
export function history(doc, { today, filter = () => true, scope = null, max = 8, linkFilter = null } = {}) {
  const rounds = (doc?.rounds || []).filter((r) => r.from <= today).sort((a, b) => periodIndex(a.id) - periodIndex(b.id)).slice(-max)
  return rounds.map((r) => {
    const list = (doc.answers || []).filter((a) => a.roundId === r.id && inScope(a, scope) && filter(a))
    const s = summarize(list, r.questions)
    const sub = linkFilter ? { ...r, links: (r.links || []).filter(linkFilter) } : r
    const resp = responseOf(sub, doc.answers || [], scope)
    return { period: r.id, round: r, count: s.count, overall: s.overall, nps: s.nps ? s.nps.score : null, items: Object.fromEntries(s.items.map((x) => [x.id, x.avg])), ...resp }
  })
}

/**
 * Fallender Verlauf: die letzte Runde mindestens 1 Punkt unter der davor, oder drei Runden nacheinander schlechter
 * (zusammen mindestens 0,5 Punkte). values: Durchschnitt je Runde (ältere zuerst, Runden ohne Antwort null).
 */
export function isFalling(values = []) {
  const v = values.filter((x) => x !== null && x !== undefined)
  if (v.length < 2) return false
  const [a, b] = v.slice(-2)
  if (a - b >= 1 - 1e-9) return true
  if (v.length < 3) return false
  const [x, y, z] = v.slice(-3)
  return x > y && y > z && x - z >= 0.5 - 1e-9
}

/** Kunde anrufen: Gesamt höchstens 2 oder Rückruf erwünscht. */
export const needsCall = (a) => !!a && (a.overall <= 2 || !!a.callback)
export const openCalls = (answers = [], scope = null) => answers.filter((a) => needsCall(a) && !a.done && inScope(a, scope)).sort((x, y) => String(y.at).localeCompare(String(x.at)))

/** Zeilen je Kunde (Link): letzte Runde mit Antwort, die davor, Verlauf, NPS über alle Runden, Anzahl. */
export function customerRows(doc, { today, scope = null } = {}) {
  const ids = [...new Set((doc?.answers || []).filter((a) => inScope(a, scope)).map((a) => a.linkId))]
  return ids
    .map((linkId) => {
      const list = (doc.answers || []).filter((a) => a.linkId === linkId && inScope(a, scope))
      const h = history(doc, { today, scope, filter: (a) => a.linkId === linkId, linkFilter: (l) => l.id === linkId })
      const vals = h.map((x) => x.overall)
      const withAnswer = h.filter((x) => x.count)
      const title = list.slice().sort((x, y) => String(y.at).localeCompare(String(x.at)))[0]?.linkTitle || 'Kunde'
      return { linkId, title, objectIds: [...new Set(list.flatMap((a) => a.objectIds || []))], count: list.length, last: withAnswer.at(-1) || null, prev: withAnswer.at(-2) || null, values: vals, falling: isFalling(vals), nps: npsOf(list.map((a) => a.nps)), calls: openCalls(list).length }
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'de'))
}

/** Zeilen je Objekt: wie je Kunde, eine Antwort zählt für das gewählte Objekt bzw. alle Objekte des Links. */
export function objectRows(doc, { today, scope = null, objects = [] } = {}) {
  const ids = [...new Set((doc?.answers || []).flatMap(answerObjects))].filter((id) => !scope || scope.has(id))
  const nameOf = (id) => objects.find((o) => o.id === id)?.name || 'Objekt (gelöscht)'
  return ids
    .map((objectId) => {
      const has = (a) => answerObjects(a).includes(objectId)
      const list = (doc.answers || []).filter(has)
      const h = history(doc, { today, filter: has, linkFilter: (l) => (l.objectIds || []).includes(objectId) })
      const vals = h.map((x) => x.overall)
      const withAnswer = h.filter((x) => x.count)
      return { objectId, name: nameOf(objectId), region: objects.find((o) => o.id === objectId)?.region || '', count: list.length, last: withAnswer.at(-1) || null, prev: withAnswer.at(-2) || null, values: vals, falling: isFalling(vals), nps: npsOf(list.map((a) => a.nps)), calls: openCalls(list).length }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/**
 * Handlungsbedarf: Kunden anrufen (offen), Kunden mit fallendem Verlauf, und ob eine neue Runde zu öffnen ist
 * (Rhythmus an, im Quartal noch keine Runde, keine offen, mindestens ein Link dran). links: Links des Kundenbereichs
 * (nur für den Vorschlag „Runde öffnen“).
 */
export function attention({ doc, today, scope = null, links = null }) {
  const calls = openCalls(doc?.answers || [], scope)
  const falling = customerRows(doc, { today, scope }).filter((r) => r.falling)
  let openRound = null
  if (links) {
    const period = periodOf(today)
    const running = (doc?.rounds || []).some((r) => !r.closedAt && r.until >= today)
    if (!roundOf(doc, period) && !running) {
      const due = dueLinks({ doc, links, period })
      if (due.length) openRound = { period, count: due.length }
    }
  }
  return { calls, falling, openRound }
}

/** Antworten, die (vom Webspace) zu einer Runde und einem Link schon da sind. */
export const answered = (doc, roundId, linkId) => (doc?.answers || []).some((a) => a.roundId === roundId && a.linkId === linkId)

// ---------------------------------------------------------------- Bereich der Person („ihre Objekte“)

/**
 * Objekte, die eine Person sieht (Set) oder null für alle: Vollzugriff alle; sonst, wenn die Reviere eingerichtet
 * sind (config.json → access.reviere, jedes Revier mit Gruppe), nur Objekte der eigenen Reviere; ohne Reviere alle.
 */
export function scopeObjectIds({ all = false, groups = [], reviere = {}, objects = [] } = {}) {
  if (all || !revierSetup({ reviere, objects }).active) return null
  const mine = new Set(reviereFor({ groups, reviere, objects }).map(revierName))
  return new Set(objects.filter((o) => o.region && mine.has(revierName(o.region))).map((o) => o.id))
}

// ---------------------------------------------------------------- Einladung

/** E-Mail-Einladung aus der Vorlage: Platzhalter ersetzt, Leerzeilen zusammengefasst. */
export function inviteMail({ template = INVITE_DEFAULTS, title = '', objects = [], url = '', until = '', sender = '', company = '' }) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(until) ? `${until.slice(8, 10)}.${until.slice(5, 7)}.${until.slice(0, 4)}` : until
  const values = { titel: title, objekte: objects.join(', ') || title, link: url, bis: date, absender: sender, firma: company }
  const fill = (s) => String(s || '').replace(/\{(titel|objekte|link|bis|absender|firma)\}/g, (_, k) => values[k] ?? '')
  const text = fill(template.text || INVITE_DEFAULTS.text)
    .split('\n')
    .filter((x, i, all) => x.trim() !== '' || (i > 0 && all[i - 1].trim() !== ''))
    .join('\n')
    .trim()
  return { subject: fill(template.subject || INVITE_DEFAULTS.subject).trim(), text: text.includes(url) || !url ? text : `${text}\n\n${url}` }
}

/** Kann der Link eingeladen werden? → '' oder Grund (keine Adresse, keine Einladungen gewünscht). */
export function inviteBlocked(doc, link, email) {
  if (linkConf(doc, link?.id).noInvite) return 'keine Einladungen gewünscht'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim())) return 'keine E-Mail-Adresse beim Link'
  return ''
}

/** Zahl mit einer Nachkommastelle (Komma), z. B. 4,3; ohne Wert „–“. */
export const fmtAvg = (v) => (v === null || v === undefined ? '–' : (Math.round(v * 10) / 10).toFixed(1).replace('.', ','))
/** NPS mit Vorzeichen, z. B. „+40“, „−10“, „0“. */
export const fmtNps = (v) => (v === null || v === undefined ? '–' : v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0')
export const fmtRate = (v) => (v === null || v === undefined ? '–' : `${Math.round(v * 100)} %`)
