// Kundenzufriedenheit: kurze Umfrage im Kundenbereich (kunden.php) je Runde (Quartal) und Link, Auswertung je Objekt
// und je Kunde, Verlauf über die Quartale (Diagramm wie bei den Kennzahlen), Durchschnitt je Frage, NPS, Rücklauf,
// Freitexte, Export als CSV und Bericht als PDF mit Briefkopf. Hinweise bei schlechten Werten in „Zu erledigen“ und
// beim digitalen Mitarbeiter „Fristen“ (views/disponent.js): Gesamt höchstens 2 oder Rückruf → „Kunde anrufen“
// (Öffnen, Termin), fallender Verlauf → Hinweis; Verknüpfung zu Reklamationen und Qualitätsmessung des Objekts.
//
// Webspace wie die übrigen Daten des Kundenbereichs (customer-portal.js: gleicher Schlüssel): Runden gehen mit
// aktion=umfrage hin, die Antworten holt syncAnswers ab (alle 3 Minuten, solange eine Runde läuft oder vor kurzem lief)
// und übernimmt sie nach SharePoint (zufriedenheit/zufriedenheit.json), erst danach „übernommen“ am Webspace.
// E-Mail-Einladung an die Adresse des Links nur nach Klick im Büro (Sammelversand mit Vorschau, über Microsoft 365;
// ohne 365 einzeln im E-Mail-Programm).
//
// Rechte: Vollzugriff bearbeitet (Fragen, Rhythmus, Runden, Einladungen, Antworten übernehmen und als erledigt
// vermerken) – bzw. eine eigene Rolle mit Bearbeiten, die auch den Kundenbereich bearbeitet. Objektmanagement und
// Objektleitung lesen die Auswertung ihrer Objekte (Reviere, core/zufriedenheit.js → scopeObjectIds).
// Aktionen und Dialoge: „kz-“. Rechenkern: core/zufriedenheit.js, Bericht: export/zufriedenheit-pdf.js.

import { sendMail } from '../../auth/graph-mail.js'
import { addDays, formatDate, todayISO } from '../../core/dates.js'
import { toCSV } from '../../core/reports.js'
import {
  answerFromServer,
  answerObjects,
  attention,
  customerRows,
  defaultUntil,
  dueLinks,
  emptyZufriedenheit,
  fmtAvg,
  fmtNps,
  fmtRate,
  history,
  inScope,
  INVITE_DEFAULTS,
  inviteBlocked,
  inviteMail,
  ITEMS_MAX,
  ITEMS_MIN,
  lastParticipation,
  linkConf,
  needsCall,
  newQuestionId,
  newRound,
  newServerAnswers,
  nextPeriod,
  normalizeQuestions,
  npsGroup,
  objectRows,
  openCalls,
  periodFromIndex,
  periodLabel,
  periodOf,
  periodRange,
  periodShort,
  QUESTION_DEFAULTS,
  questionsProblem,
  responseOf,
  RHYTHMS,
  rhythmOf,
  roundOf,
  roundProblem,
  roundsPayload,
  roundState,
  scopeObjectIds,
  settingsOf,
  summarize,
} from '../../core/zufriedenheit.js'
import { zufriedenheitDocument, zufriedenheitPdfName } from '../../export/zufriedenheit-pdf.js'
import { app, canEdit, closeModal, confirmStep, memo, openModal, persist, registerActions, registerModal, registerObjectHint, registerView, renderModal, renderNow, toast } from '../context.js'
import { barList, lineChart, tableView } from '../kpi-charts.js'
import { openCompose } from '../mailer.js'
import { canMail } from '../modals/send.js'
import { invalidateTodo, refreshBell, registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, checkedValues, dayAt, download, esc, ICON, menu, modalFrame, options, tabBar, val } from '../shared.js'
import { portalCall, portalEnabled, portalLinks, portalLinkUrl, portalManage, portalReady } from './customer-portal.js'

const MODULE = 'zufriedenheit'
const ICON_KZ = '<circle cx="12" cy="12" r="8.5"/><path d="M8.3 14.2c.9 1.3 2.2 2 3.7 2s2.8-.7 3.7-2"/><path d="M9.2 9.6v.6M14.8 9.6v.6"/>'
const TABS = ['uebersicht', 'kunden', 'objekte', 'antworten', 'runden']
const doc = () => {
  const d = (app.data.zufriedenheit ||= emptyZufriedenheit())
  d.settings ||= {}
  d.links ||= {}
  d.rounds ||= []
  d.answers ||= []
  return d
}
const sees = (m) => !app.access || app.access.sees(m)
/**
 * Fragen, Rhythmus, Runden, Einladungen: Schreibrecht hier und Recht auf den Kundenbereich (Vollzugriff). Ohne
 * app.readOnly: das gilt für die gerade offene Ansicht (z. B. die Woche), nicht für dieses Modul.
 */
const editable = () => canEdit(MODULE) && portalManage()
/** Antworten übernehmen: Schreibrecht hier und der Schlüssel des Kundenbereichs. */
const maySync = () => canEdit(MODULE) && portalReady()
/** Termin (Rückruf) über die Termine: auch Rollen, die hier nur lesen (Objektleitung). */
const mayAppt = () => canEdit('termine')
const nowIso = () => new Date().toISOString()
const by = () => app.user?.name || 'Browser'
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const objName = (id) => objOf(id)?.name || 'Objekt (gelöscht)'
const short = (iso) => (iso ? formatDate(String(iso).slice(0, 10), { weekday: false, year: true }) : '–')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const answerOf = (id) => doc().answers.find((a) => a.id === id)
const linkOf = (id) => portalLinks().find((l) => l.id === id)
const activeLinks = () => portalLinks().filter((l) => !l.revokedAt && l.token)
const brand = () => app.config.brand || {}
const mailOf = (link) => String(link?.email || objOf(link?.objectIds?.[0])?.proofEmail || '').trim()
const telLink = (phone) => (phone ? `<a href="tel:${esc(String(phone).replace(/[^0-9+]/g, ''))}">${esc(phone)}</a>` : '')

/** Objekte der Person (Reviere) oder null für alle. */
const scope = () => memo(app.cur, `kz-scope:${(app.user?.groups || []).join()}`, () => scopeObjectIds({ all: !app.access || !!app.access.all, groups: app.user?.groups || [], reviere: app.config?.access?.reviere || {}, objects: app.data.objects }))
const filterOf = () => ({ link: app.ui.kzLink || '', obj: app.ui.kzObj || '' })
const matches = (a, f = filterOf()) => (!f.link || a.linkId === f.link) && (!f.obj || answerObjects(a).includes(f.obj))
const linkMatches = (l, f = filterOf()) => (!f.link || l.id === f.link) && (!f.obj || (l.objectIds || []).includes(f.obj))
const titleOfLink = (id) => doc().answers.filter((a) => a.linkId === id).at(-1)?.linkTitle || linkOf(id)?.title || doc().rounds.flatMap((r) => r.links || []).find((l) => l.id === id)?.title || 'Kunde'
const scopeText = (f = filterOf()) => (f.link ? `Kunde: ${titleOfLink(f.link)}` : f.obj ? `Objekt: ${objName(f.obj)}` : scope() ? 'Ihre Objekte' : 'alle Kunden')
const attentionAt = (today = todayISO()) => memo(app.cur, `kz-attention:${today}:${editable()}`, () => attention({ doc: doc(), today, scope: scope(), links: editable() ? portalLinks() : null }))
const reasonText = (a) => [a.overall <= 2 ? `Gesamt ${a.overall} von 5` : '', a.callback ? 'Rückruf erwünscht' : ''].filter(Boolean).join(' · ')
const objText = (a) => (a.objectId ? objName(a.objectId) : (a.objectIds || []).map(objName).join(', '))

/** Auswertung im gewählten Bereich: Verlauf, letzte Runde mit Antworten und die davor, offene Rückrufe. */
function overview(today = todayISO()) {
  const f = filterOf()
  return memo(app.cur, `kz-overview:${today}:${f.link}:${f.obj}`, () => {
    const sc = scope()
    const rows = history(doc(), { today, scope: sc, filter: (a) => matches(a, f), linkFilter: (l) => linkMatches(l, f) })
    const withAnswers = rows.filter((r) => r.count)
    const lastRow = withAnswers.at(-1) || null
    const prevRow = withAnswers.at(-2) || null
    const listOf = (row) => (row ? doc().answers.filter((a) => a.roundId === row.period && inScope(a, sc) && matches(a, f)) : [])
    return {
      rows,
      lastRow,
      prevRow,
      last: lastRow ? summarize(listOf(lastRow), lastRow.round.questions) : null,
      prev: prevRow ? summarize(listOf(prevRow), prevRow.round.questions) : null,
      calls: openCalls(doc().answers, sc).filter((a) => matches(a, f)),
    }
  })
}

// ---------------------------------------------------------------- Webspace: Runden hin, Antworten zurück

const sync = { at: 0, running: false, error: '', timer: null }

/** Runden an den Webspace (alle, die nicht geschlossen und nicht vorbei sind). */
async function publishRounds() {
  const today = todayISO()
  const open = doc().rounds.filter((r) => !r.closedAt && r.until >= today)
  try {
    if (!portalReady()) throw new Error('Der Kundenbereich ist aus oder noch nicht mit dem Webspace verbunden (Kundenbereich → Einstellungen).')
    await portalCall('umfrage', { body: { runden: roundsPayload(doc(), today) } })
    for (const r of open) Object.assign(r, { publishedAt: nowIso(), error: '' })
    persist()
    return true
  } catch (err) {
    for (const r of open) r.error = err.message || String(err)
    persist()
    throw err
  }
}

/**
 * Neue Antworten übernehmen (mit Bezeichnung und Objekten des Links aus der Runde) und am Webspace als übernommen
 * melden; erst gespeichert, dann gemeldet. Höchstens alle 3 Minuten und nur, solange eine Runde läuft oder vor
 * höchstens 14 Tagen endete; force: sofort. Liefert die Zahl der neuen Antworten.
 */
export async function syncAnswers({ force = false } = {}) {
  if (sync.running || !maySync()) return 0
  const today = todayISO()
  if (!force && (Date.now() - sync.at < 180e3 || !doc().rounds.some((r) => r.until >= addDays(today, -14)))) return 0
  sync.running = true
  sync.at = Date.now()
  let taken = []
  try {
    const { antworten = [] } = await portalCall('umfrage-antworten')
    for (const e of newServerAnswers(antworten, doc())) {
      const a = answerFromServer(e, { round: roundOf(doc(), e.runde), link: linkOf(e.link), by: by() })
      doc().answers.push(a)
      taken.push(a)
    }
    if (taken.length) {
      persist()
      // erst gespeichert, dann am Webspace als übernommen markieren (sonst ginge eine Antwort verloren)
      await app.service?.flush?.()
    }
    const known = new Set(doc().answers.map((a) => a.serverId))
    const mark = (Array.isArray(antworten) ? antworten : []).filter((e) => e && !e.uebernommen && known.has(String(e.id))).map((e) => String(e.id))
    if (mark.length) await portalCall('umfrage-status', { body: { uebernommen: mark } })
    sync.error = ''
    if (taken.length) {
      invalidateTodo()
      refreshBell()
      const bad = taken.filter(needsCall)
      toast(`${plural(taken.length, 'neue Antwort', 'neue Antworten')} aus der Kundenumfrage${bad.length ? `, ${bad.length} mit „Kunde anrufen“` : ''}.`)
      if (app.ui.view === MODULE) renderNow()
      else if (app.ui.modal?.type === 'todo') renderModal()
    }
  } catch (err) {
    sync.error = err.message || String(err)
    taken = []
  }
  sync.running = false
  return taken.length
}

function startPolling() {
  if (sync.timer || typeof document === 'undefined' || !document.addEventListener) return
  sync.timer = setInterval(() => syncAnswers(), 180e3)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncAnswers()
  })
}

// ---------------------------------------------------------------- Ansicht

const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
const card = ({ id, title, sub = '', body, table = '' }) => `<section class="kpi-card" data-chart="${id}"><header><div><h3>${esc(title)}</h3>${sub ? `<p class="muted small">${esc(sub)}</p>` : ''}</div></header><div class="kpi-plot">${body}</div>${table}</section>`
const narrow = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 700px)').matches

function zufriedenheitView() {
  const today = todayISO()
  const ed = editable()
  const tab = TABS.includes(app.ui.kzTab) ? app.ui.kzTab : 'uebersicht'
  const o = overview(today)
  const running = doc().rounds.find((r) => roundState(r, today) !== 'beendet')
  const head = `<div class="section-head"><div><h2>Kundenzufriedenheit</h2><p>Kurze Umfrage im Kundenbereich, je Quartal und Link: Zufriedenheit gesamt und je Frage, Weiterempfehlung (NPS), Rücklauf, Freitexte. Bei schlechten Werten oder Rückrufwunsch steht der Kunde unter „Zu erledigen“.</p></div>
    <div class="actions">${ed ? (running ? `<button class="btn primary" data-action="kz-invite-open" data-id="${esc(running.id)}">${ICON.send} Einladungen</button>` : `<button class="btn primary" data-action="kz-round-open">${ICON.plus} Runde öffnen</button>`) : ''}${menu({
      label: 'Mehr',
      single: false,
      items: [
        ed && { label: running ? 'Runde bearbeiten' : 'Runde öffnen', icon: ICON.calendar, action: 'kz-round-open', data: running ? { id: running.id } : {}, hint: 'Quartal, Zeitraum, Links' },
        ed && { label: 'Teilnahme je Link', icon: ICON.users, action: 'kz-links-open', hint: 'Rhythmus, keine Einladungen' },
        ed && { label: 'Fragen und Einstellungen', icon: ICON.gear, action: 'kz-settings-open', hint: 'Rhythmus, Fragen, Einladung' },
        maySync() && { label: 'Antworten jetzt abholen', icon: ICON.refresh, action: 'kz-sync' },
        { heading: 'Export' },
        doc().answers.length && { label: 'Antworten (CSV)', icon: ICON.download, action: 'kz-csv', mail: true },
        doc().answers.length && { label: 'Bericht als PDF', icon: ICON.download, action: 'kz-pdf', mail: true },
      ],
    })}</div></div>`
  const s = settingsOf(doc())
  const banners = [
    ed && !portalEnabled() ? `<div class="banner warn-banner"><p><strong>Der Kundenbereich ist aus.</strong> Die Umfrage erscheint dort erst, wenn er eingeschaltet und mit dem Webspace verbunden ist.</p><button class="btn" data-action="view" data-view="kundenbereich">Zum Kundenbereich</button></div>` : '',
    ed && s.rhythm === 'aus' && !Object.values(doc().links).some((x) => RHYTHMS[x?.rhythm] && x.rhythm !== 'aus') ? `<div class="banner"><p><strong>Die Umfrage ist aus.</strong> Unter „Fragen und Einstellungen“ den Rhythmus wählen (vierteljährlich oder halbjährlich). Geöffnet wird eine Runde nur nach Klick.</p><button class="btn" data-action="kz-settings-open">${ICON.gear} Einstellungen</button></div>` : '',
    sync.error && maySync() ? `<div class="banner warn-banner"><p>Antworten konnten nicht vom Webspace geholt werden: ${esc(sync.error)}</p></div>` : '',
  ].join('')
  const tabs = tabBar({
    action: 'kz-tab',
    current: tab,
    tabs: [
      { id: 'uebersicht', label: 'Übersicht', flag: o.calls.length },
      { id: 'kunden', label: 'Je Kunde' },
      { id: 'objekte', label: 'Je Objekt' },
      { id: 'antworten', label: 'Antworten' },
      { id: 'runden', label: 'Runden' },
    ],
  })
  const body = { uebersicht: overviewTab, kunden: customersTab, objekte: objectsTab, antworten: answersTab, runden: roundsTab }[tab](today, o)
  return `${head}${banners}${roundBox(today)}${tabs}${body}`
}

/** Laufende bzw. geplante Runde mit Rücklauf, sonst der Vorschlag „Runde öffnen“. */
function roundBox(today) {
  const ed = editable()
  const cur = doc().rounds.filter((r) => roundState(r, today) !== 'beendet').sort((a, b) => a.id.localeCompare(b.id))[0]
  if (cur) {
    const resp = responseOf(cur, doc().answers, scope())
    const invited = new Set((cur.invites || []).map((i) => i.linkId)).size
    const st = roundState(cur, today)
    return `<div class="banner kz-round"><p><strong>${esc(periodLabel(cur.id))}: Umfrage ${st === 'geplant' ? `ab ${short(cur.from)}` : `offen bis ${short(cur.until)}`}</strong> · ${plural(resp.invited, 'Link', 'Links')}, ${resp.answered} geantwortet (${fmtRate(resp.rate)})${ed ? ` · ${invited} per E-Mail eingeladen` : ''}${cur.error ? ` · <span class="err-text">nicht übertragen: ${esc(cur.error)}</span>` : cur.publishedAt ? '' : ' · noch nicht übertragen'}</p>
      ${ed ? `<div class="actions"><button class="btn small" data-action="kz-invite-open" data-id="${esc(cur.id)}">${ICON.send} Einladungen</button><button class="btn small" data-action="kz-round-open" data-id="${esc(cur.id)}">Bearbeiten</button></div>` : ''}</div>`
  }
  const at = attentionAt(today)
  if (ed && at.openRound) return `<div class="banner welcome kz-round"><p><strong>${esc(periodLabel(at.openRound.period))}: noch keine Umfrage.</strong> ${plural(at.openRound.count, 'Link ist', 'Links sind')} laut Rhythmus dran. Die Runde öffnet nur nach Klick; danach erscheint die Umfrage im Kundenbereich.</p><button class="btn primary" data-action="kz-round-open">${ICON.plus} Runde öffnen</button></div>`
  return ''
}

/** Auswahl Kunde und Objekt (gilt für Übersicht und Antworten). */
function filters() {
  const sc = scope()
  const list = doc().answers.filter((a) => inScope(a, sc))
  const links = [...new Set(list.map((a) => a.linkId))].map((id) => [id, titleOfLink(id)]).sort((a, b) => a[1].localeCompare(b[1], 'de'))
  const objs = [...new Set(list.flatMap(answerObjects))].filter((id) => !sc || sc.has(id)).map((id) => [id, objName(id)]).sort((a, b) => a[1].localeCompare(b[1], 'de'))
  const f = filterOf()
  return `<div class="filters kz-filters">
      <label class="field inline"><span>Kunde</span><select id="kz-f-link" data-change="kz-filter">${options(links, f.link, { empty: 'alle' })}</select></label>
      <label class="field inline"><span>Objekt</span><select id="kz-f-obj" data-change="kz-filter">${options(objs, f.obj, { empty: 'alle' })}</select></label>
      ${f.link || f.obj ? `<button class="btn small ghost" data-action="kz-reset">Filter zurücksetzen</button>` : ''}</div>`
}

function overviewTab(today, o) {
  if (!doc().answers.some((a) => inScope(a, scope())))
    return `${filters()}<p class="empty">Noch keine Antworten${scope() ? ' zu deinen Objekten' : ''}. Sobald eine Runde offen ist und Kunden antworten, steht hier die Auswertung.</p>`
  const { rows, lastRow, prevRow, last, prev, calls } = o
  const f = filterOf()
  const comments = (last?.comments || []).slice(0, 8)
  return `${filters()}
    <div class="impact-stats tc-stats">${tile('Zufriedenheit gesamt', last ? `${fmtAvg(last.overall)} von 5` : '–', last && last.overall !== null && last.overall <= 2.5 ? 'err' : '')}${tile('Weiterempfehlung (NPS)', fmtNps(last?.nps?.score ?? null))}${tile('Rücklauf', fmtRate(lastRow?.rate ?? null))}${tile('Kunde anrufen', calls.length, calls.length ? 'warn' : '')}</div>
    <p class="note">${lastRow ? `Letzte Runde mit Antworten: ${esc(periodLabel(lastRow.period))} (${plural(lastRow.count, 'Antwort', 'Antworten')} von ${plural(lastRow.invited, 'Link', 'Links')})${prevRow ? `, davor ${esc(periodLabel(prevRow.period))}` : ''}.` : 'In diesem Bereich noch keine Antworten.'} Bereich: ${esc(scopeText(f))}.</p>
    ${callsList(calls)}
    ${charts(rows)}
    ${last ? `<div class="kpi-root kz-charts"><div class="kpi-grid">${perQuestion(last, prev, lastRow)}</div></div>` : ''}
    ${comments.length ? `<section class="kz-comments"><h3>Rückmeldungen im Freitext <span class="muted">${esc(periodLabel(lastRow.period))}</span></h3><ul class="kz-list">${comments.map((a) => `<li><div><strong>${esc(a.linkTitle || 'Kunde')}</strong> <span class="muted">${short(a.at)} · Gesamt ${a.overall} von 5</span><p class="kz-quote">„${esc(a.comment)}“</p></div><div class="kz-acts"><button class="btn small" data-action="kz-answer" data-id="${esc(a.id)}">Ansehen</button></div></li>`).join('')}</ul></section>` : ''}`
}

function callsList(calls) {
  if (!calls.length) return ''
  const appt = mayAppt()
  return `<section class="kz-calls"><h3>Kunde anrufen <span class="flag warning">${calls.length}</span></h3><ul class="kz-list">${calls
    .map(
      (a) => `<li><div><strong>${esc(a.linkTitle || 'Kunde')}</strong> <span class="muted">${esc(objText(a))} · ${short(a.at)}</span><br><span class="pill ${a.overall <= 2 ? 'error' : 'warning'}">${esc(reasonText(a))}</span>${a.phone ? ` ${telLink(a.phone)}` : ''}${a.name ? ` <span class="muted">${esc(a.name)}${a.role ? `, ${esc(a.role)}` : ''}</span>` : ''}${a.comment ? `<p class="kz-quote">„${esc(a.comment.slice(0, 200))}“</p>` : ''}</div>
      <div class="kz-acts"><button class="btn small primary" data-action="kz-answer" data-id="${esc(a.id)}">Öffnen</button>${appt ? `<button class="btn small" data-action="kz-appt" data-id="${esc(a.id)}">${ICON.calendar} Termin</button>` : ''}</div></li>`,
    )
    .join('')}</ul></section>`
}

/** Verlauf je Quartal: Zufriedenheit gesamt (1–5) und NPS (−100 bis +100), wie die Diagramme der Kennzahlen. */
function charts(rows) {
  if (!rows.some((r) => r.count)) return ''
  const W = narrow() ? 340 : 560
  const labels = rows.map((r) => periodShort(r.period))
  const titles = rows.map((r) => periodLabel(r.period))
  const table = tableView(['Quartal', 'Antworten', 'Rücklauf', 'Gesamt', 'NPS'], rows.map((r) => [periodLabel(r.period), String(r.count), fmtRate(r.rate), fmtAvg(r.overall), fmtNps(r.nps)]))
  const one = card({ id: 'kz-verlauf', title: 'Zufriedenheit je Quartal', sub: 'Durchschnitt gesamt: 1 = sehr unzufrieden, 5 = sehr zufrieden', body: lineChart({ labels, titles, series: [{ id: 'overall', label: 'Zufriedenheit gesamt', color: '--kpi-1', values: rows.map((r) => r.overall) }], fmt: (v) => `${fmtAvg(v)} von 5`, axis: (v) => fmtAvg(v).replace(',0', ''), width: W, ariaLabel: 'Zufriedenheit je Quartal', min: 1, top: 5 }), table })
  const two = rows.some((r) => r.nps !== null) ? card({ id: 'kz-nps', title: 'Weiterempfehlung (NPS) je Quartal', sub: 'Anteil 9–10 minus Anteil 0–6, von −100 bis +100', body: lineChart({ labels, titles, series: [{ id: 'nps', label: 'NPS', color: '--kpi-2', values: rows.map((r) => r.nps) }], fmt: fmtNps, axis: (v) => fmtNps(Math.round(v)), width: W, ariaLabel: 'Weiterempfehlung je Quartal', min: -100, top: 100 }) }) : ''
  return `<div class="kpi-root kz-charts"><div class="kpi-grid">${one}${two}</div></div>`
}

function perQuestion(last, prev, lastRow) {
  const rows = [{ id: 'overall', text: 'Gesamtzufriedenheit', avg: last.overall, n: last.count, prev: prev?.overall ?? null }, ...last.items.map((x) => ({ ...x, prev: prev?.items.find((y) => y.id === x.id)?.avg ?? null }))]
  const withPrev = (x) => `${fmtAvg(x.avg)}${x.prev !== null && x.prev !== undefined ? ` (${fmtAvg(x.prev)})` : ''}`
  return card({
    id: 'kz-fragen',
    title: 'Durchschnitt je Frage',
    sub: `${periodLabel(lastRow.period)}${prev ? ', in Klammern die Vorrunde' : ''}; 1 bis 5`,
    body: barList({ rows: rows.map((x) => ({ label: x.text, value: x.avg ?? 0, display: withPrev(x), extra: [['Antworten', String(x.n), '']] })), max: 5 }),
    table: tableView(['Frage', 'Durchschnitt', 'Vorrunde', 'Antworten'], rows.map((x) => [x.text, fmtAvg(x.avg), fmtAvg(x.prev), String(x.n)])),
  })
}

const trendPill = (r) => (r.falling ? '<span class="pill error">fällt</span>' : '')
const lastCell = (r) => (r.last ? `<strong>${fmtAvg(r.last.overall)}</strong> <span class="muted">${esc(periodShort(r.last.period))}</span>` : '<span class="muted">–</span>')

function customersTab(today) {
  const rows = customerRows(doc(), { today, scope: scope() })
  if (!rows.length) return '<p class="empty">Noch keine Antworten.</p>'
  return `<div class="table-wrap"><table class="data kz-table"><thead><tr><th>Kunde</th><th class="num">zuletzt</th><th class="num">davor</th><th class="num">NPS</th><th class="num">Antworten</th><th>Hinweis</th><th></th></tr></thead><tbody>${rows
    .map(
      (r) => `<tr><td class="clickable" data-action="kz-goto" data-link="${esc(r.linkId)}"><strong>${esc(r.title)}</strong><br><span class="muted">${esc(r.objectIds.map(objName).join(', '))}</span></td>
      <td class="num">${lastCell(r)}</td><td class="num">${r.prev ? fmtAvg(r.prev.overall) : '–'}</td><td class="num">${fmtNps(r.nps?.score ?? null)}</td><td class="num">${r.count}</td>
      <td>${trendPill(r)}${r.calls ? ` <span class="pill warning">${plural(r.calls, 'Rückruf', 'Rückrufe')} offen</span>` : ''}</td>
      <td class="actions-cell"><button class="btn small" data-action="kz-goto" data-link="${esc(r.linkId)}">Auswertung</button> <button class="btn small ghost" data-action="kz-pdf" data-link="${esc(r.linkId)}" title="Bericht als PDF">${ICON.download} PDF</button></td></tr>`,
    )
    .join('')}</tbody></table></div><p class="note">Ein Kunde ist ein Link des Kundenbereichs. „zuletzt“: Durchschnitt gesamt in der letzten Runde mit Antwort (1 bis 5).</p>`
}

function objectsTab(today) {
  const rows = objectRows(doc(), { today, scope: scope(), objects: app.data.objects })
  if (!rows.length) return '<p class="empty">Noch keine Antworten.</p>'
  const qm = sees('qualitaet')
  const rek = sees('reklamationen')
  const openRek = (id) => (rek ? (app.data.reklamationen?.items || []).filter((c) => c.objectId === id && c.status !== 'erledigt').length : 0)
  return `<div class="table-wrap"><table class="data kz-table"><thead><tr><th>Objekt</th><th class="num">zuletzt</th><th class="num">davor</th><th class="num">NPS</th><th class="num">Antworten</th><th>Hinweis</th><th></th></tr></thead><tbody>${rows
    .map((r) => {
      const n = openRek(r.objectId)
      return `<tr><td class="clickable" data-action="kz-goto" data-obj="${esc(r.objectId)}"><strong>${esc(r.name)}</strong>${r.region ? `<br><span class="muted">${esc(r.region)}</span>` : ''}</td>
      <td class="num">${lastCell(r)}</td><td class="num">${r.prev ? fmtAvg(r.prev.overall) : '–'}</td><td class="num">${fmtNps(r.nps?.score ?? null)}</td><td class="num">${r.count}</td>
      <td>${trendPill(r)}${r.calls ? ` <span class="pill warning">${plural(r.calls, 'Rückruf', 'Rückrufe')} offen</span>` : ''}</td>
      <td class="actions-cell"><button class="btn small" data-action="kz-goto" data-obj="${esc(r.objectId)}">Auswertung</button>${rek ? ` <button class="btn small ghost" data-action="kz-complaints" data-obj="${esc(r.objectId)}">Reklamationen${n ? ` <span class="flag warning">${n}</span>` : ''}</button>` : ''}${qm ? ` <button class="btn small ghost" data-action="qm-goto" data-obj="${esc(r.objectId)}">Qualität</button>` : ''}</td></tr>`
    })
    .join('')}</tbody></table></div><p class="note">Eine Antwort zählt für das Objekt, das der Kunde gewählt hat, sonst für alle Objekte seines Links.</p>`
}

function answersTab() {
  const sc = scope()
  const round = app.ui.kzRound || ''
  const list = doc()
    .answers.filter((a) => inScope(a, sc) && matches(a) && (!round || a.roundId === round))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
  const rounds = [...new Set(doc().answers.map((a) => a.roundId))].sort().reverse()
  const rows = list
    .slice(0, 300)
    .map(
      (a) => `<tr><td class="clickable" data-action="kz-answer" data-id="${esc(a.id)}"><strong>${short(a.at)}</strong><br><span class="muted">${esc(periodShort(a.roundId))}</span></td>
      <td>${esc(a.linkTitle || 'Kunde')}<br><span class="muted">${esc(objText(a))}</span></td>
      <td class="num">${a.overall} von 5</td><td class="num">${a.nps === null || a.nps === undefined ? '–' : a.nps}</td>
      <td>${needsCall(a) ? (a.done ? '<span class="pill ok">erledigt</span>' : `<span class="pill ${a.overall <= 2 ? 'error' : 'warning'}">${esc(reasonText(a))}</span>`) : ''}</td>
      <td class="kz-cut">${a.comment ? esc(a.comment.slice(0, 120)) : '<span class="muted">–</span>'}</td>
      <td class="actions-cell"><button class="btn small" data-action="kz-answer" data-id="${esc(a.id)}">Öffnen</button></td></tr>`,
    )
    .join('')
  return `${filters()}<div class="filters kz-filters"><label class="field inline"><span>Runde</span><select id="kz-f-round" data-change="kz-filter">${options(rounds.map((r) => [r, periodLabel(r)]), round, { empty: 'alle' })}</select></label></div>
    ${rows ? `<div class="table-wrap"><table class="data kz-table"><thead><tr><th>Eingang</th><th>Kunde</th><th class="num">Gesamt</th><th class="num">Empfehlung</th><th>Hinweis</th><th>Freitext</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine Antworten in dieser Auswahl.</p>'}`
}

function roundsTab(today) {
  const ed = editable()
  const sc = scope()
  const list = [...doc().rounds].sort((a, b) => b.id.localeCompare(a.id))
  if (!list.length) return `<p class="empty">Noch keine Runde.${ed ? ' Mit „Runde öffnen“ beginnen.' : ''}</p>`
  const STATE_CLS = { geplant: 'info', offen: 'ok', beendet: '' }
  return `<div class="table-wrap"><table class="data kz-table"><thead><tr><th>Quartal</th><th>Zeitraum</th><th>Stand</th><th class="num">Rücklauf</th><th class="num">Gesamt</th><th class="num">NPS</th><th></th></tr></thead><tbody>${list
    .map((r) => {
      const st = roundState(r, today)
      const resp = responseOf(r, doc().answers, sc)
      const s = summarize(doc().answers.filter((a) => a.roundId === r.id && inScope(a, sc)), r.questions)
      return `<tr><td><strong>${esc(periodLabel(r.id))}</strong><br><span class="muted">${plural(resp.invited, 'Link', 'Links')}${ed && r.invites?.length ? `, ${new Set(r.invites.map((i) => i.linkId)).size} eingeladen` : ''}</span></td>
      <td>${short(r.from)} bis ${short(r.until)}${r.closedAt ? `<br><span class="muted">geschlossen ${short(r.closedAt)}</span>` : ''}</td>
      <td><span class="pill ${STATE_CLS[st]}">${esc(st)}</span>${r.error && st !== 'beendet' ? `<br><span class="err-text">${esc(r.error)}</span>` : ''}</td>
      <td class="num">${resp.answered} von ${resp.invited}<br><span class="muted">${fmtRate(resp.rate)}</span></td><td class="num">${fmtAvg(s.overall)}</td><td class="num">${fmtNps(s.nps?.score ?? null)}</td>
      <td class="actions-cell">${ed ? `<button class="btn small" data-action="kz-round-open" data-id="${esc(r.id)}">Bearbeiten</button>${st !== 'beendet' ? ` <button class="btn small" data-action="kz-invite-open" data-id="${esc(r.id)}">Einladungen</button>` : ''}` : ''}</td></tr>`
    })
    .join('')}</tbody></table></div>`
}

registerView({
  id: 'zufriedenheit',
  order: 75,
  label: 'Kundenzufriedenheit',
  group: 'service',
  module: MODULE,
  icon: ICON_KZ,
  noWeek: true,
  text: 'Umfrage im Kundenbereich: Zufriedenheit, NPS, Verlauf je Quartal',
  badge: () => attentionAt().calls.length,
  render: zufriedenheitView,
})

// ---------------------------------------------------------------- Antwort ansehen

function answerModal(c, m) {
  const a = answerOf(m.id)
  if (!a) return modalFrame({ title: 'Antwort', body: '<p class="empty">Diese Antwort gibt es nicht mehr.</p>', foot: '<button class="btn" data-action="close-modal">Schließen</button>' })
  const q = normalizeQuestions(roundOf(doc(), a.roundId)?.questions)
  const ids = [...new Set([...q.items.map((x) => x.id), ...Object.keys(a.scores || {})])]
  const textOf = (id) => q.items.find((x) => x.id === id)?.text || id
  const obj = a.objectId || a.objectIds?.[0] || ''
  const qmConf = sees('qualitaet') && obj && (app.data.qualitaet?.objects || []).some((x) => x.objectId === obj)
  const rek = sees('reklamationen') && obj ? (app.data.reklamationen?.items || []).filter((x) => answerObjects(a).includes(x.objectId) && x.status !== 'erledigt').length : 0
  const doneBox = needsCall(a)
    ? a.done
      ? `<div class="banner kz-done"><p><strong>Erledigt</strong> am ${short(a.done.at)} von ${esc(a.done.by)}${a.done.note ? `: ${esc(a.done.note)}` : ''}</p>${canEdit(MODULE) ? `<button class="btn small" data-action="kz-undone" data-id="${esc(a.id)}">Wieder offen</button>` : ''}</div>`
      : `<div class="banner warn-banner kz-done"><p><strong>Kunde anrufen:</strong> ${esc(reasonText(a))}${a.phone ? `, Telefon ${telLink(a.phone)}` : ''}. Nach dem Gespräch hier vermerken, was besprochen wurde.</p>${
          canEdit(MODULE) ? `<label class="field wide"><span>Notiz zum Gespräch</span><textarea id="kz-done-note" rows="2" maxlength="500" placeholder="z. B. mit Frau Huber gesprochen, Nachreinigung vereinbart"></textarea></label><button class="btn small primary" data-action="kz-done" data-id="${esc(a.id)}">${ICON.check} Als erledigt vermerken</button>` : '<p class="muted">Als erledigt vermerkt das Büro.</p>'
        }</div>`
    : ''
  const value = (v) => (v === null || v === undefined ? '<span class="muted">keine Angabe</span>' : `${v} von 5`)
  return modalFrame({
    title: `Antwort: ${a.linkTitle || 'Kunde'}`,
    subtitle: `${esc(periodLabel(a.roundId))} · eingegangen ${short(a.at)}`,
    wide: true,
    body: `${doneBox}
      <dl class="kz-values">
        <dt>Objekt</dt><dd>${esc(objText(a) || '–')}${a.objectId ? '' : (a.objectIds || []).length > 1 ? ' <span class="muted">(alle Objekte des Links)</span>' : ''}</dd>
        <dt>${esc(q.overall)}</dt><dd><strong>${a.overall} von 5</strong></dd>
        ${ids.map((id) => `<dt>${esc(textOf(id))}</dt><dd>${value(a.scores?.[id])}</dd>`).join('')}
        <dt>${esc(q.nps)}</dt><dd>${a.nps === null || a.nps === undefined ? '<span class="muted">keine Angabe</span>' : `${a.nps} von 10 <span class="muted">(${esc(npsGroup(a.nps))})</span>`}</dd>
        <dt>${esc(q.comment)}</dt><dd>${a.comment ? `<span class="kz-pre">${esc(a.comment)}</span>` : '<span class="muted">–</span>'}</dd>
        <dt>Rückruf</dt><dd>${a.callback ? `erwünscht${a.phone ? `: ${telLink(a.phone)}` : ''}` : 'nein'}</dd>
        <dt>Von</dt><dd>${a.name ? esc(a.name) : '<span class="muted">ohne Namen</span>'}${a.role ? `, ${esc(a.role)}` : ''}</dd>
      </dl>
      <p class="note">Name, Funktion und Telefon hat der Kunde freiwillig angegeben; nur für die Rückmeldung verwenden.</p>`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${sees('reklamationen') && obj ? `<button class="btn" data-action="kz-complaints" data-obj="${esc(obj)}">Reklamationen${rek ? ` <span class="flag warning">${rek}</span>` : ''}</button>` : ''}${qmConf ? `<button class="btn" data-action="qm-goto" data-obj="${esc(obj)}">Qualitätsmessung</button>` : ''}${mayAppt() ? `<button class="btn primary" data-action="kz-appt" data-id="${esc(a.id)}">${ICON.calendar} Termin</button>` : ''}</div>`,
  })
}
registerModal('kz-answer', answerModal, { module: MODULE })

// ---------------------------------------------------------------- Fragen und Einstellungen

function settingsDraft(m) {
  if (!m.draft) {
    const s = settingsOf(doc())
    const stored = doc().settings
    m.draft = { rhythm: stored.rhythm && RHYTHMS[stored.rhythm] ? stored.rhythm : 'quartal', days: s.days, questions: structuredClone(s.questions), invite: { ...s.invite } }
  }
  return m.draft
}

function readSettings() {
  const d = settingsDraft(app.ui.modal)
  if (!document.getElementById('kz-rhythm')) return d
  d.rhythm = val('kz-rhythm')
  d.days = Math.max(7, Math.min(90, Number(val('kz-days')) || 28))
  d.questions.overall = val('kz-q-overall')
  d.questions.items = d.questions.items.map((x, i) => ({ id: x.id, text: val(`kz-q-${i}`) }))
  d.questions.nps = val('kz-q-nps')
  d.questions.comment = val('kz-q-comment')
  d.invite = { subject: val('kz-inv-subject'), text: val('kz-inv-text') }
  return d
}

function settingsModal(c, m) {
  const d = settingsDraft(m)
  const q = d.questions
  return modalFrame({
    title: 'Kundenzufriedenheit: Fragen und Einstellungen',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Rhythmus (Vorgabe für alle Links)</span><select id="kz-rhythm">${options(Object.entries(RHYTHMS), d.rhythm)}</select></label>
        <label class="field"><span>Eine Runde ist offen (Tage)</span><input type="number" id="kz-days" min="7" max="90" value="${esc(d.days)}"></label>
      </div>
      <p class="note">Vierteljährlich: jede Runde (eine je Quartal); halbjährlich: jede zweite. Je Link änderbar unter „Teilnahme je Link“. Eine Runde öffnet nur nach Klick im Büro.</p>
      <h3>Fragen</h3>
      <div class="form-grid kz-questions">
        <label class="field wide"><span>Gesamtzufriedenheit (1 bis 5 Sterne, Pflicht)</span><input type="text" id="kz-q-overall" maxlength="160" value="${esc(q.overall)}"></label>
        ${q.items.map((x, i) => `<div class="field wide kz-q-row"><label for="kz-q-${i}">Einzelfrage ${i + 1} (1 bis 5 Sterne)</label><span class="kz-q-line"><input type="text" id="kz-q-${i}" maxlength="160" value="${esc(x.text)}"><button type="button" class="btn small ghost icon" data-action="kz-q-del" data-i="${i}" aria-label="Einzelfrage ${i + 1} entfernen" title="Entfernen" ${q.items.length <= ITEMS_MIN ? 'disabled' : ''}>${ICON.trash}</button></span></div>`).join('')}
        ${q.items.length < ITEMS_MAX ? `<p class="wide"><button type="button" class="btn small" data-action="kz-q-add">${ICON.plus} Einzelfrage</button></p>` : ''}
        <label class="field wide"><span>Weiterempfehlung (0 bis 10, ergibt den NPS)</span><input type="text" id="kz-q-nps" maxlength="160" value="${esc(q.nps)}"></label>
        <label class="field wide"><span>Freitext</span><input type="text" id="kz-q-comment" maxlength="160" value="${esc(q.comment)}"></label>
      </div>
      <p class="note">${ITEMS_MIN} bis ${ITEMS_MAX} Einzelfragen. Geänderte Fragen gelten ab der nächsten Runde; laufende Runden behalten ihre Fragen (die Auswertung bleibt vergleichbar).</p>
      <h3>E-Mail-Einladung</h3>
      <div class="form-grid">
        <label class="field wide"><span>Betreff</span><input type="text" id="kz-inv-subject" maxlength="200" value="${esc(d.invite.subject)}"></label>
        <label class="field wide"><span>Text ({titel}, {objekte}, {link}, {bis}, {absender}, {firma} werden ersetzt)</span><textarea id="kz-inv-text" rows="10">${esc(d.invite.text)}</textarea></label>
      </div>
      <p class="note">Nur an Bestandskunden, nur nach Klick, mit Hinweis zum Abbestellen. Ob die Einladung als Werbung gilt, ist offen (Rechtsprüfung Punkt 33).</p>`,
    foot: `<button class="btn" data-action="kz-settings-reset">Vorgaben wiederherstellen</button><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="kz-settings-save">Speichern</button></div>`,
  })
}
registerModal('kz-settings', settingsModal, { module: MODULE })

// ---------------------------------------------------------------- Teilnahme je Link

function linksModal() {
  const s = settingsOf(doc())
  const list = activeLinks().sort((a, b) => String(a.title).localeCompare(String(b.title), 'de'))
  const rows = list
    .map((l) => {
      const conf = linkConf(doc(), l.id)
      return `<tr><td><strong>${esc(l.title || 'ohne Bezeichnung')}</strong><br><span class="muted">${esc((l.objectIds || []).map(objName).join(', '))}</span></td>
        <td>${mailOf(l) ? esc(mailOf(l)) : '<span class="muted">keine Adresse</span>'}</td>
        <td><select id="kz-l-r-${esc(l.id)}" aria-label="Rhythmus ${esc(l.title || '')}">${options([['', `wie Vorgabe (${RHYTHMS[s.rhythm]})`], ...Object.entries(RHYTHMS)], conf.rhythm || '')}</select></td>
        <td><label class="check"><input type="checkbox" id="kz-l-n-${esc(l.id)}" ${conf.noInvite ? 'checked' : ''}><span>keine Einladungen</span></label></td></tr>`
    })
    .join('')
  return modalFrame({
    title: 'Kundenzufriedenheit: Teilnahme je Link',
    wide: true,
    body: rows
      ? `<div class="table-wrap"><table class="data kz-table"><thead><tr><th>Link</th><th>E-Mail (Kundenbereich)</th><th>Rhythmus</th><th>Einladung</th></tr></thead><tbody>${rows}</tbody></table></div><p class="note">„keine Einladungen“: der Kunde wünscht keine E-Mails zur Umfrage; die Umfrage erscheint trotzdem in seinem Kundenbereich. Die E-Mail-Adresse steht beim Link (Kundenbereich → Bearbeiten).</p>`
      : '<p class="empty">Noch keine Links im Kundenbereich.</p>',
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button>${rows ? '<button class="btn primary" data-action="kz-links-save">Speichern</button>' : ''}`,
  })
}
registerModal('kz-links', linksModal, { module: MODULE })

// ---------------------------------------------------------------- Runde öffnen und bearbeiten

function roundDraft(m) {
  if (!m.draft) {
    const today = todayISO()
    const r = m.id ? roundOf(doc(), m.id) : null
    if (r) m.draft = { id: r.id, period: r.id, from: r.from, until: r.until, linkIds: (r.links || []).map((l) => l.id) }
    else {
      // laufendes Quartal; hat es schon eine Runde, das nächste (vorbereiten)
      const period = roundOf(doc(), periodOf(today)) ? nextPeriod(periodOf(today)) : periodOf(today)
      const from = period === periodOf(today) ? today : periodRange(period).from
      m.draft = { id: '', period, from, until: defaultUntil(from, settingsOf(doc()).days), linkIds: dueLinks({ doc: doc(), links: activeLinks(), period }).map((l) => l.id) }
    }
  }
  return m.draft
}

function readRound() {
  const d = roundDraft(app.ui.modal)
  if (!document.getElementById('kz-r-from')) return d
  if (!d.id && document.getElementById('kz-r-period')) {
    const p = val('kz-r-period')
    if (p !== d.period) {
      d.period = p
      d.linkIds = dueLinks({ doc: doc(), links: activeLinks(), period: p }).map((l) => l.id)
    } else d.linkIds = checkedValues('kz-r-link')
  } else d.linkIds = checkedValues('kz-r-link')
  d.from = val('kz-r-from')
  d.until = val('kz-r-until')
  return d
}

function roundModal(c, m) {
  const d = roundDraft(m)
  const today = todayISO()
  const existing = d.id ? roundOf(doc(), d.id) : null
  const s = settingsOf(doc())
  const due = new Set(dueLinks({ doc: doc(), links: activeLinks(), period: d.period }).map((l) => l.id))
  const list = [...activeLinks(), ...(existing?.links || []).filter((l) => !activeLinks().some((x) => x.id === l.id))].sort((a, b) => String(a.title).localeCompare(String(b.title), 'de'))
  const periods = [periodOf(today), nextPeriod(periodOf(today))]
  const st = existing ? roundState(existing, today) : ''
  const q = normalizeQuestions(existing ? existing.questions : s.questions)
  const lastText = (id) => {
    const i = lastParticipation(doc(), id, d.period)
    return i === null ? 'noch nie' : `zuletzt ${periodShort(periodFromIndex(i))}`
  }
  return modalFrame({
    title: existing ? `Runde ${periodLabel(d.id)} bearbeiten` : 'Umfrage-Runde öffnen',
    subtitle: existing ? `Stand: ${st}` : '',
    wide: true,
    body: `<div class="form-grid">
        ${existing ? '' : `<label class="field"><span>Quartal</span><select id="kz-r-period" data-change="kz-round-redraw">${options(periods.map((p) => [p, `${periodLabel(p)}${roundOf(doc(), p) ? ' (gibt es schon)' : ''}`]), d.period)}</select></label>`}
        <label class="field"><span>Offen ab</span><input type="date" id="kz-r-from" value="${esc(d.from)}"></label>
        <label class="field"><span>Offen bis</span><input type="date" id="kz-r-until" value="${esc(d.until)}"></label>
      </div>
      <h3>Links <span class="muted" id="kz-r-count">${d.linkIds.length} gewählt</span></h3>
      ${list.length ? `<div class="check-grid kz-links">${list
        .map((l) => {
          const full = linkOf(l.id)
          return `<label class="check"><input type="checkbox" name="kz-r-link" value="${esc(l.id)}" data-change="kz-round-count" ${d.linkIds.includes(l.id) ? 'checked' : ''}><span>${esc(l.title || 'ohne Bezeichnung')} <span class="muted">${esc(RHYTHMS[rhythmOf(doc(), l.id)])}, ${esc(lastText(l.id))}</span>${due.has(l.id) ? ' <span class="pill info">dran</span>' : ''}${full && !full.publishedAt ? ' <span class="pill warning">noch nicht übertragen</span>' : ''}${full?.revokedAt ? ' <span class="pill">gesperrt</span>' : ''}</span></label>`
        })
        .join('')}</div>` : '<p class="empty">Noch keine Links im Kundenbereich.</p>'}
      <details class="kz-preview"><summary>Fragen dieser Runde</summary><ol><li>${esc(q.overall)} <span class="muted">(1 bis 5, Pflicht)</span></li>${q.items.map((x) => `<li>${esc(x.text)} <span class="muted">(1 bis 5)</span></li>`).join('')}<li>${esc(q.nps)} <span class="muted">(0 bis 10)</span></li><li>${esc(q.comment)} <span class="muted">(Freitext)</span></li><li>Rückruf erwünscht, Name und Funktion <span class="muted">(freiwillig)</span></li></ol></details>
      <p class="note">${existing ? 'Die Fragen bleiben, wie sie beim Öffnen waren. ' : 'Die Fragen werden beim Öffnen festgehalten (änderbar unter „Fragen und Einstellungen“). '}Solange die Runde offen ist, sieht jeder gewählte Link die Umfrage in seinem Kundenbereich; eine Antwort je Link. „Speichern und übertragen“ schickt die Runde an den Webspace.</p>`,
    foot: `<div class="actions">${existing && st !== 'beendet' ? '<button class="btn danger" data-action="kz-round-close">Runde schließen</button>' : ''}${existing && existing.closedAt ? '<button class="btn" data-action="kz-round-reopen">Wieder öffnen</button>' : ''}</div><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="kz-round-save">${existing ? 'Speichern und übertragen' : 'Öffnen und übertragen'}</button></div>`,
  })
}
registerModal('kz-round', roundModal, { module: MODULE })

// ---------------------------------------------------------------- Einladungen

function inviteRows(r) {
  return (r.links || []).map((l) => {
    const link = linkOf(l.id)
    const email = mailOf(link)
    const blocked = !link || link.revokedAt ? 'Link gesperrt' : inviteBlocked(doc(), link, email)
    const done = doc().answers.some((a) => a.roundId === r.id && a.linkId === l.id)
    const sent = (r.invites || []).filter((i) => i.linkId === l.id).at(-1)
    return { l, link, email, blocked, done, sent }
  })
}

function inviteText(r, row) {
  const s = settingsOf(doc())
  return inviteMail({ template: s.invite, title: row.link?.title || row.l.title, objects: (row.link?.objectIds || row.l.objectIds || []).map(objName), url: `${portalLinkUrl(row.link)}#umfrage`, until: r.until, sender: app.user?.name || '', company: brand().name || '' })
}

function inviteModal(c, m) {
  const r = roundOf(doc(), m.id)
  if (!r) return modalFrame({ title: 'Einladungen', body: '<p class="empty">Diese Runde gibt es nicht mehr.</p>', foot: '<button class="btn" data-action="close-modal">Schließen</button>' })
  const rows = inviteRows(r)
  m.picked ||= rows.filter((x) => !x.blocked && !x.done && !x.sent).map((x) => x.l.id)
  const graph = canMail()
  const preview = rows.find((x) => x.l.id === (m.preview || m.picked[0])) || rows.find((x) => !x.blocked)
  const mail = preview && !preview.blocked ? inviteText(r, preview) : null
  const list = rows
    .map((x) => {
      const state = x.blocked ? `<span class="muted">${esc(x.blocked)}</span>` : x.done ? '<span class="pill ok">hat geantwortet</span>' : x.sent ? `<span class="pill info">eingeladen ${short(x.sent.at)}</span>` : ''
      return `<li class="kz-inv-row"><label class="check"><input type="checkbox" name="kz-inv" value="${esc(x.l.id)}" data-change="kz-invite-pick" ${m.picked.includes(x.l.id) ? 'checked' : ''} ${x.blocked ? 'disabled' : ''}><span><strong>${esc(x.link?.title || x.l.title || 'Kunde')}</strong> <span class="muted">${esc(x.email || '')}</span> ${state}</span></label>
        <span class="kz-acts">${!x.blocked ? `<button type="button" class="btn small ghost" data-action="kz-invite-pick" data-preview="${esc(x.l.id)}">Vorschau</button>` : ''}${!x.blocked && !graph ? `<button type="button" class="btn small" data-action="kz-invite-one" data-link="${esc(x.l.id)}">${ICON.send} E-Mail</button>` : ''}</span></li>`
    })
    .join('')
  return modalFrame({
    title: `Einladungen: ${periodLabel(r.id)}`,
    subtitle: `Umfrage offen bis ${short(r.until)}`,
    wide: true,
    body: `<ul class="kz-inv">${list}</ul>
      ${mail ? `<h3>Vorschau <span class="muted">${esc(preview.link?.title || '')} · ${esc(preview.email)}</span></h3><div class="kz-mail"><p><strong>${esc(mail.subject)}</strong></p><pre class="kz-pre">${esc(mail.text)}</pre></div>` : ''}
      <p class="note">Jede E-Mail geht einzeln an die Adresse des Links (keine anderen Empfänger sichtbar), nur nach Klick. Text unter „Fragen und Einstellungen“. ${graph ? 'Versand aus deinem Microsoft-365-Postfach.' : 'Ohne Microsoft 365: je Kunde „E-Mail“ öffnet das E-Mail-Programm.'}</p>`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button>${graph ? `<button class="btn primary" data-action="kz-invite-send" ${m.picked.length ? '' : 'disabled'}>${ICON.send} An ${plural(m.picked.length, 'Kunden', 'Kunden')} senden</button>` : ''}`,
  })
}
registerModal('kz-invite', inviteModal, { module: MODULE })

function noteInvite(r, linkId, to, via) {
  const cur = roundOf(doc(), r.id)
  if (!cur) return
  cur.invites = [...(cur.invites || []), { linkId, to, at: nowIso(), by: by(), via }]
  persist()
}

// ---------------------------------------------------------------- Export

function csvColumns(list) {
  const qs = new Map()
  for (const r of [...doc().rounds].sort((a, b) => a.id.localeCompare(b.id))) for (const x of normalizeQuestions(r.questions).items) qs.set(x.id, x.text)
  for (const a of list) for (const id of Object.keys(a.scores || {})) if (!qs.has(id)) qs.set(id, id)
  return [
    ['Eingang', (a) => dayAt(a.at)],
    ['Quartal', (a) => a.roundId],
    ['Kunde', (a) => a.linkTitle || ''],
    ['Objekt', (a) => objText(a)],
    ['Gesamt (1-5)', (a) => a.overall],
    ...[...qs].map(([id, text]) => [`${text} (1-5)`, (a) => a.scores?.[id] ?? '']),
    ['Weiterempfehlung (0-10)', (a) => a.nps ?? ''],
    ['NPS-Gruppe', (a) => npsGroup(a.nps)],
    ['Rückruf', (a) => (a.callback ? 'ja' : '')],
    ['Telefon', (a) => a.phone || ''],
    ['Name', (a) => a.name || ''],
    ['Funktion', (a) => a.role || ''],
    ['Freitext', (a) => a.comment || ''],
    ['erledigt', (a) => (a.done ? `${dayAt(a.done.at)} ${a.done.by}${a.done.note ? `: ${a.done.note}` : ''}` : '')],
  ]
}

async function reportPdf(f) {
  const prevUi = { link: app.ui.kzLink, obj: app.ui.kzObj }
  Object.assign(app.ui, { kzLink: f.link, kzObj: f.obj })
  try {
    const o = overview()
    const name = scopeText(f)
    const pdf = zufriedenheitDocument({ scope: name, rows: o.rows.filter((r) => r.count || r.invited), last: o.last, prev: o.prev, lastRow: o.lastRow, comments: o.last?.comments || [], brand: brand(), logo: await loadLogo().catch(() => null) })
    return { name: zufriedenheitPdfName(name.replace(/^(Kunde|Objekt): /, ''), todayISO()), blob: await pdfBlob(pdf) }
  } finally {
    Object.assign(app.ui, { kzLink: prevUi.link, kzObj: prevUi.obj })
  }
}

/** Nächster Werktag (Mo–Fr) ab morgen. */
function nextWorkday(today = todayISO()) {
  let d = addDays(today, 1)
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = addDays(d, 1)
  return d
}

// ---------------------------------------------------------------- Aktionen

registerActions({
  'kz-tab': (el) => {
    app.ui.kzTab = el.dataset.v
    renderNow()
  },
  'kz-filter': () => {
    app.ui.kzLink = val('kz-f-link')
    app.ui.kzObj = val('kz-f-obj')
    if (document.getElementById('kz-f-round')) app.ui.kzRound = val('kz-f-round')
    renderNow()
  },
  'kz-reset': () => {
    Object.assign(app.ui, { kzLink: '', kzObj: '', kzRound: '' })
    renderNow()
  },
  // von „Zu erledigen“, dem digitalen Mitarbeiter, der Suche und den Tabellen: Auswertung eines Kunden bzw. Objekts
  'kz-goto': (el) => {
    Object.assign(app.ui, { view: MODULE, kzTab: 'uebersicht', kzLink: el.dataset.link || '', kzObj: el.dataset.obj || '', kzRound: '' })
    if (app.ui.modal) closeModal()
    renderNow()
  },
  'kz-answer': (el) => openModal({ type: 'kz-answer', id: el.dataset.id }),
  'kz-complaints': (el) => {
    Object.assign(app.ui, { view: 'reklamationen', complaintObject: el.dataset.obj || '', complaintFilter: 'alle' })
    if (app.ui.modal) closeModal()
    renderNow()
  },
  'kz-csv': () => {
    const sc = scope()
    const list = doc()
      .answers.filter((a) => inScope(a, sc) && matches(a))
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    download(`Kundenzufriedenheit_${todayISO()}.csv`, new Blob([`﻿${toCSV(list, csvColumns(list))}`], { type: 'text/csv;charset=utf-8' }))
  },
  'kz-pdf': async (el) => {
    try {
      const f = el?.dataset?.link || el?.dataset?.obj ? { link: el.dataset.link || '', obj: el.dataset.obj || '' } : filterOf()
      const { name, blob } = await reportPdf(f)
      download(name, blob)
    } catch (err) {
      toast(`Bericht nicht erstellt: ${err.message}`)
    }
  },
  'kz-sync': async () => {
    const n = await syncAnswers({ force: true })
    toast(sync.error ? `Nicht abgeholt: ${sync.error}` : n ? `${plural(n, 'neue Antwort', 'neue Antworten')} übernommen.` : 'Keine neuen Antworten.')
    renderNow()
  },
})

// Termin (Rückruf) über die Termine: Dialog „appt“, Recht auf Termine
registerActions(
  {
    'kz-appt': (el) => {
      const a = answerOf(el.dataset.id)
      if (!a) return
      openModal({ type: 'appt', date: nextWorkday(), time: '09:00', minutes: 15, kind: 'kunde', title: `Rückruf Kundenumfrage: ${a.linkTitle || 'Kunde'}`, objectId: a.objectId || a.objectIds?.[0] || '' })
    },
  },
  { edit: 'termine' },
)

registerActions(
  {
    'kz-done': (el) => {
      const a = answerOf(el.dataset.id)
      if (!a) return
      a.done = { at: nowIso(), by: by(), note: val('kz-done-note').trim().slice(0, 500) }
      persist()
      invalidateTodo()
      refreshBell()
      closeModal()
      renderNow()
      toast(`Vermerkt: ${a.linkTitle || 'Kunde'} angerufen.`)
    },
    'kz-undone': (el) => {
      const a = answerOf(el.dataset.id)
      if (!a) return
      a.done = null
      persist()
      invalidateTodo()
      refreshBell()
      renderModal()
      renderNow()
    },
    'kz-settings-open': () => (editable() ? openModal({ type: 'kz-settings' }) : toast('Fragen und Rhythmus ändert das Büro (Vollzugriff).')),
    'kz-q-add': () => {
      const d = readSettings()
      if (d.questions.items.length < ITEMS_MAX) d.questions.items.push({ id: newQuestionId(), text: '' })
      renderModal()
    },
    'kz-q-del': (el) => {
      const d = readSettings()
      if (d.questions.items.length > ITEMS_MIN) d.questions.items.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'kz-settings-reset': () => {
      const d = readSettings()
      d.questions = structuredClone(QUESTION_DEFAULTS)
      d.invite = { ...INVITE_DEFAULTS }
      renderModal()
      toast('Fragen und Einladung auf die Vorgaben gesetzt. Mit „Speichern“ übernehmen.')
    },
    'kz-settings-save': () => {
      const d = readSettings()
      const items = d.questions.items.filter((x) => x.text.trim())
      const problem = questionsProblem({ ...d.questions, items })
      if (problem) return toast(problem)
      doc().settings = { ...doc().settings, rhythm: d.rhythm, days: d.days, questions: normalizeQuestions({ ...d.questions, items }), invite: { subject: d.invite.subject.trim(), text: d.invite.text.trim() }, changedAt: nowIso(), changedBy: by() }
      persist()
      closeModal()
      invalidateTodo()
      renderNow()
      toast('Gespeichert. Neue Fragen gelten ab der nächsten Runde.')
    },
    'kz-links-open': () => (editable() ? openModal({ type: 'kz-links' }) : toast('Die Teilnahme legt das Büro fest (Vollzugriff).')),
    'kz-links-save': () => {
      const out = {}
      for (const l of activeLinks()) {
        const rhythm = document.getElementById(`kz-l-r-${l.id}`) ? val(`kz-l-r-${l.id}`) : linkConf(doc(), l.id).rhythm
        const noInvite = document.getElementById(`kz-l-n-${l.id}`) ? checked(`kz-l-n-${l.id}`) : linkConf(doc(), l.id).noInvite
        if (rhythm || noInvite) out[l.id] = { ...(RHYTHMS[rhythm] ? { rhythm } : {}), ...(noInvite ? { noInvite: true } : {}) }
      }
      // gesperrte Links behalten ihre Angaben (kommen sie wieder, gilt das Alte)
      for (const [id, v] of Object.entries(doc().links)) if (!activeLinks().some((l) => l.id === id)) out[id] = v
      doc().links = out
      persist()
      closeModal()
      invalidateTodo()
      renderNow()
      toast('Teilnahme gespeichert.')
    },
    'kz-round-open': (el) => (editable() ? openModal({ type: 'kz-round', id: el?.dataset?.id || '' }) : toast('Runden öffnet das Büro (Vollzugriff).')),
    'kz-round-redraw': () => {
      readRound()
      renderModal()
    },
    'kz-round-count': () => {
      const el = document.getElementById('kz-r-count')
      if (el) el.textContent = `${document.querySelectorAll('input[name="kz-r-link"]:checked').length} gewählt`
    },
    'kz-round-save': async (el) => {
      const d = readRound()
      const today = todayISO()
      const existing = d.id ? roundOf(doc(), d.id) : null
      if (!existing && roundOf(doc(), d.period)) return toast(`Für ${periodLabel(d.period)} gibt es schon eine Runde: unter „Runden“ bearbeiten.`)
      const links = d.linkIds.map((id) => linkOf(id) || existing?.links?.find((l) => l.id === id)).filter(Boolean)
      const problem = roundProblem({ period: d.period, from: d.from, until: d.until, links }, today)
      if (problem) return toast(problem)
      if (existing) Object.assign(existing, { from: d.from, until: d.until, links: links.map((l) => ({ id: l.id, title: String(l.title || '').slice(0, 120), objectIds: [...(l.objectIds || [])] })), changedAt: nowIso(), changedBy: by() })
      else doc().rounds.push(newRound({ period: d.period, from: d.from, until: d.until, questions: settingsOf(doc()).questions, links, by: by() }))
      persist()
      closeModal()
      invalidateTodo()
      renderNow()
      el.disabled = true
      try {
        await publishRounds()
        toast(`${existing ? 'Gespeichert' : 'Runde geöffnet'} und übertragen: ${periodLabel(d.period)}, ${plural(links.length, 'Link', 'Links')}, offen bis ${short(d.until)}.`)
      } catch (err) {
        toast(`Gespeichert, aber nicht übertragen: ${err.message}`)
      }
      renderNow()
    },
    'kz-round-close': async () => {
      const d = readRound()
      const r = roundOf(doc(), d.id)
      if (!r) return
      if (!confirmStep(`kz-close-${r.id}`, renderModal)) return toast(`Runde ${periodLabel(r.id)} schließen? Die Umfrage verschwindet aus dem Kundenbereich. Zum Bestätigen noch einmal klicken.`)
      Object.assign(r, { closedAt: nowIso(), closedBy: by() })
      persist()
      closeModal()
      renderNow()
      try {
        await publishRounds()
        toast(`Runde ${periodLabel(r.id)} geschlossen.`)
      } catch (err) {
        toast(`Geschlossen, aber am Webspace noch nicht entfernt: ${err.message}`)
      }
      renderNow()
    },
    'kz-round-reopen': async () => {
      const d = readRound()
      const r = roundOf(doc(), d.id)
      if (!r) return
      const today = todayISO()
      Object.assign(r, { closedAt: null, closedBy: '', until: r.until < today ? defaultUntil(today, 14) : r.until })
      persist()
      closeModal()
      renderNow()
      try {
        await publishRounds()
        toast(`Runde ${periodLabel(r.id)} wieder offen bis ${short(r.until)}.`)
      } catch (err) {
        toast(`Wieder offen, aber nicht übertragen: ${err.message}`)
      }
      renderNow()
    },
    'kz-invite-open': (el) => (editable() ? openModal({ type: 'kz-invite', id: el.dataset.id }) : toast('Einladungen schickt das Büro (Vollzugriff).')),
    'kz-invite-pick': (el) => {
      const m = app.ui.modal
      if (m?.type !== 'kz-invite') return
      if (el.dataset.preview) m.preview = el.dataset.preview
      else m.picked = checkedValues('kz-inv')
      renderModal()
    },
    'kz-invite-one': (el) => {
      const m = app.ui.modal
      const r = roundOf(doc(), m?.id)
      const row = r && inviteRows(r).find((x) => x.l.id === el.dataset.link)
      if (!row || row.blocked) return
      const mail = inviteText(r, row)
      openCompose({ to: row.email, subject: mail.subject, text: mail.text, origin: `Kundenumfrage ${periodLabel(r.id)}: ${row.link?.title || ''}`, onSent: ({ via, to }) => noteInvite(r, row.l.id, to.join(', '), via) })
    },
    'kz-invite-send': async (el) => {
      const m = app.ui.modal
      const r = roundOf(doc(), m?.id)
      if (!r) return
      const rows = inviteRows(r).filter((x) => m.picked.includes(x.l.id) && !x.blocked)
      if (!rows.length) return toast('Bitte mindestens einen Kunden wählen.')
      if (!canMail()) return toast('Senden aus der App geht nur mit Microsoft 365; sonst je Kunde „E-Mail“.')
      if (!confirmStep(`kz-invite-${r.id}`, renderModal)) return toast(`Einladung an ${plural(rows.length, 'Kunden', 'Kunden')} senden (je eine E-Mail)? Zum Bestätigen noch einmal klicken.`)
      el.disabled = true
      let ok = 0
      const failed = []
      for (const row of rows) {
        try {
          const mail = inviteText(r, row)
          await sendMail(app.auth.getToken, { to: row.email, subject: mail.subject, text: mail.text }, { from: app.config.mail?.from || '' })
          noteInvite(r, row.l.id, row.email, 'graph')
          ok++
        } catch (err) {
          failed.push(`${row.link?.title || row.l.title}: ${err.message}`)
        }
      }
      closeModal()
      renderNow()
      toast(`${plural(ok, 'Einladung', 'Einladungen')} gesendet${failed.length ? `; nicht gesendet: ${failed.join('; ')}` : ''}.`)
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Zu erledigen, Hinweis zum Objekt

registerTodo({
  id: 'zufriedenheit',
  module: MODULE,
  title: 'Kundenzufriedenheit',
  compute: (today) => {
    if (maySync()) {
      startPolling()
      syncAnswers()
    }
    const at = attentionAt(today)
    return [
      ...at.calls.map((a) => ({ id: `call:${a.id}`, kind: 'call', a })),
      ...at.falling.map((r) => ({ id: `fall:${r.linkId}:${r.last?.period || ''}`, kind: 'fall', r })),
      ...(at.openRound ? [{ id: `round:${at.openRound.period}`, kind: 'round', ...at.openRound }] : []),
    ]
  },
  render: (list) =>
    list
      .map((x) => {
        if (x.kind === 'call') {
          const a = x.a
          return `<div class="todo-item"><span class="flag error">!</span><div class="todo-text"><strong>Kunde anrufen: ${esc(a.linkTitle || 'Kunde')}</strong><br><span class="muted">${esc(reasonText(a))}${a.phone ? `, ${esc(a.phone)}` : ''} · ${esc(objText(a))} · ${short(a.at)}</span></div><div class="todo-acts"><button class="btn small primary" data-action="kz-answer" data-id="${esc(a.id)}">Öffnen</button>${mayAppt() ? ` <button class="btn small ghost" data-action="kz-appt" data-id="${esc(a.id)}">Termin</button>` : ''}</div></div>`
        }
        if (x.kind === 'fall') {
          const r = x.r
          return `<div class="todo-item"><span class="flag warning">!</span><div class="todo-text"><strong>${esc(r.title)}: Zufriedenheit fällt</strong><br><span class="muted">${esc(r.values.filter((v) => v !== null).slice(-3).map(fmtAvg).join(' → '))} von 5</span></div><button class="btn small primary" data-action="kz-goto" data-link="${esc(r.linkId)}">Öffnen</button></div>`
        }
        return `<div class="todo-item"><span class="flag">!</span><div class="todo-text"><strong>Umfrage-Runde ${esc(periodLabel(x.period))} öffnen</strong><br><span class="muted">${plural(x.count, 'Link ist', 'Links sind')} laut Rhythmus dran</span></div><button class="btn small primary" data-action="kz-round-open">Runde öffnen</button></div>`
      })
      .join(''),
})

registerObjectHint({
  module: MODULE,
  html: (objectId) => {
    const calls = attentionAt().calls.filter((a) => answerObjects(a).includes(objectId))
    if (!calls.length) return ''
    return `<strong>Kundenzufriedenheit</strong>: ${esc(reasonText(calls[0]))} (${esc(calls[0].linkTitle || 'Kunde')}, ${short(calls[0].at)}) <button class="btn small" data-action="kz-answer" data-id="${esc(calls[0].id)}">Ansehen</button>`
  },
})
