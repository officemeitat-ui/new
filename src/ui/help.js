// Cleo, der Hilfe-Chat: Fenster unten rechts (am Handy über die ganze Breite, Knopf oben in der Kopfzeile), offen über alle
// Ansichten hinweg. Cleo beantwortet Fragen zu jeder Funktion aus den Hilfe-Themen
// (src/help/topics.js) – ohne KI und ohne Netz –, springt mit „Zeig es mir“ in die richtige Ansicht
// und markiert dort den passenden Knopf, startet auf Wunsch gleich die Aktion und verweist auf die
// Anleitung. Was die eigene Rolle nicht sieht, bietet Cleo nicht an. Für alles andere: Übergabe an
// den KI-Assistenten (falls eingerichtet), der die Frage gleich beantwortet.
// Dazu kennt Cleo den Betrieb (src/help/brain.js): „Wer arbeitet morgen?“, „Wo ist Anna am Freitag?“,
// „Was ist offen?“, „Wer ist krank?“, Feiertage, Schlüssel, Reklamationen, Lager – aus den Daten der App,
// nur was die eigene Rolle sieht, mit Rückfragen („und morgen?“) und Formularen schon ausgefüllt.

import { GLOSSARY, loadTopics, TOPICS } from '../help/lazy.js'
import { answer, dataExamples, rangeFor, understand } from '../help/brain.js'
import { glossary, search, smalltalk, SURE } from '../help/match.js'
import { allRoles } from '../core/access.js'
import { mondayOf, todayISO } from '../core/dates.js'
import { holidaysInRange } from '../core/holidays.js'
import { findAbsence } from '../core/rules.js'
import { ACTIONS, app, canEdit, computeRange, ensureRange, plannedWeeks, registerActions, renderModal, sectionLabel, toast, VIEWS, visibleViews } from './context.js'
import { todo } from './modals/todo.js'
import { seesReasons } from './views/absences.js'
import { appointmentsOfDay } from './views/appointments.js'
import { cleo, cleoIcon } from './mascot.js'
import { patch } from './morph.js'
import { activeSeason, seasonDeco, seasonInfo, seasonOutfit } from './season.js'
import { esc, ICON } from './shared.js'

// Pose zum Thema: Cleo zeigt das passende Werkzeug (sonst zeigt er auf die Stelle)
const TOPIC_MOODS = { wetter: 'schnee', due: 'liste', kontrolle: 'liste', report: 'liste', coverage: 'liste', matten: 'teppich', 'mw-liegeplaetze': 'teppich', 'mw-touren': 'teppich', 'mw-planung': 'teppich', objektmappe: 'wischt', objects: 'wischt', sites: 'wischt', zaehler: 'handy', zeiten: 'handy', termine: 'handy', waste: 'muell', fahrzeuge: 'haus', schluessel: 'haus', anlagen: 'liste', geraete: 'liste', vertrieb: 'daumen', posteingang: 'liste', regie: 'handy', qualitaet: 'liste', arbeitsschutz: 'liste', unterweisungen: 'idee', zufriedenheit: 'daumen', bewerber: 'daumen', eintritt: 'liste', kalkulation: 'idee', kennzahlen: 'daumen', reklamationen: 'desinfektion' }
export const topicMood = (t) => TOPIC_MOODS[t?.view] || 'zeigt'

let seenBefore = false
const H = () => (app.ui.help ||= { open: false, log: [], busy: false, mood: 'hallo', seen: seenBefore })
const visibleIds = () => new Set(visibleViews().map((v) => v.id))
const topicById = (id) => TOPICS.find((t) => t.id === id)
const viewLabel = (id) => VIEWS.find((v) => v.id === id)?.label || ''
const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const firstName = () => (app.user?.name || '').split(/[\s,]+/).find(Boolean) || ''

/** Themen, die zur Ansicht passen, dann je Bereich das erste – nur Sichtbares. */
export function suggestionsFor(view, ids) {
  const ok = (t) => !t.view || ids.has(t.view)
  const here = TOPICS.filter((t) => t.view === view && ok(t)).slice(0, 3)
  const seen = new Set(here.map((t) => t.section))
  const more = []
  for (const t of TOPICS) {
    if (!ok(t) || here.includes(t) || seen.has(t.section)) continue
    seen.add(t.section)
    more.push(t)
  }
  return [...here, ...more].slice(0, 6)
}

function chips(list) {
  return list.length ? `<div class="cleo-chips">${list.map((t) => `<button class="chip" data-action="help-topic" data-id="${esc(t.id)}">${esc(t.title)}</button>`).join('')}</div>` : ''
}

function answerHtml(t) {
  const act = t.action && ACTIONS[t.action.action]
  const rel = (t.related || []).map(topicById).filter((x) => x && (!x.view || visibleIds().has(x.view)))
  return `<div class="cleo-answer"><strong class="cleo-title">${esc(t.title)}</strong>
    <p>${esc(t.answer)}</p>
    ${t.steps?.length ? `<ol>${t.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${t.tips?.length ? `<p class="cleo-tip"><b>Tipp:</b> ${esc(t.tips[0])}</p>` : ''}
    <div class="cleo-acts">
      ${t.view ? `<button class="btn small primary" data-action="help-go" data-id="${esc(t.id)}">${ICON.right} ${t.view === app.ui.view ? 'Zeig mir wo' : `Zeig es mir${viewLabel(t.view) ? `: ${esc(viewLabel(t.view))}` : ''}`}</button>` : ''}
      ${act ? `<button class="btn small" data-action="help-do" data-id="${esc(t.id)}">${esc(t.action.label)}</button>` : ''}
      <button class="btn small ghost" data-action="help-guide" data-id="${esc(t.id)}">In der Anleitung</button>
    </div>
    ${rel.length ? `<p class="cleo-more">Passt auch:</p>${chips(rel.slice(0, 3))}` : ''}</div>`
}

function push(entry) {
  const h = H()
  h.log.push(entry)
  if (h.log.length > 40) h.log.splice(0, h.log.length - 40)
  if (entry.mood) h.mood = entry.mood
}

/** Antwort auf eine Frage (ohne Zeichnen). Gibt den Eintrag zurück (für Tests). */
export function respond(text) {
  const ids = visibleIds()
  const talk = smalltalk(text)
  if (talk) return push({ from: 'cleo', mood: talk.mood, html: `<p>${esc(talk.text)}</p>` })
  const all = search(TOPICS, text, { limit: 4, view: app.ui.view })
  const hits = all.filter((x) => !x.topic.view || ids.has(x.topic.view))
  const term = glossary(GLOSSARY, text)
  if (term && (!hits.length || hits[0].score < SURE + 2)) return push({ from: 'cleo', mood: 'froh', html: `<div class="cleo-answer"><strong class="cleo-title">${esc(term.term)}</strong><p>${esc(term.text)}</p></div>${chips(hits.slice(0, 2).map((x) => x.topic))}` })
  if (hits.length && hits[0].score >= SURE) {
    const others = hits.slice(1).filter((x) => x.score >= hits[0].score * 0.7).map((x) => x.topic)
    return push({ from: 'cleo', mood: topicMood(hits[0].topic), topic: hits[0].topic.id, html: answerHtml(hits[0].topic) + (others.length ? `<p class="cleo-more">Oder meinst du:</p>${chips(others)}` : '') })
  }
  if (all.length && all[0].score >= SURE && !hits.length) return push({ from: 'cleo', mood: 'hoppla', html: `<p>Das gehört zu „${esc(viewLabel(all[0].topic.view) || all[0].topic.title)}“ – da lässt mich deine Rolle nicht rein. Frag bitte das Büro, wenn du den Bereich brauchst.</p>` })
  // Unsicher oder nichts gefunden: ist die KI eingerichtet, beantwortet sie die Frage (Cleo mit KI, unten)
  if (KI.ok === true && kiConsented()) return askKi(text)
  if (hits.length) {
    push({ from: 'cleo', mood: 'denkt', html: `<p>Meinst du eines davon?</p>${chips(hits.map((x) => x.topic))}` })
    return offerKi(text)
  }
  const ai = ACTIONS['ai-open'] && KI.ok !== true ? `<div class="cleo-acts"><button class="btn small" data-action="help-ai" data-q="${esc(text)}">${cleoIcon()} KI-Assistent fragen</button></div>` : ''
  push({ from: 'cleo', mood: 'hoppla', html: `<p>Hoppla – da hat sogar mein Heldenblick nichts gefunden. Versuch es mit anderen Worten (z. B. „Urlaub eintragen“, „Rechnung schreiben“, „Wer arbeitet morgen?“) oder schau in die Anleitung.</p>${ai}${askChips(examples().slice(0, 2))}${chips(suggestionsFor(app.ui.view, ids).slice(0, 3))}` })
  return offerKi(text)
}

// ---------------------------------------------------------------- Cleo mit KI

// Findet Cleo in den Hilfethemen nichts Sicheres, fragt sie die KI – nur wenn der KI-Assistent am Webspace eingerichtet
// ist (ki.php, günstiges Modell für die Hilfe) und die Person einmal je Gerät zugestimmt hat (die Frage geht an
// Anthropic). Anfrage und Auswertung: core/cleo-ki.js. Grundlage sind nur Hilfethemen, die die Rolle sehen darf.
const KI = { ok: null, at: 0, pending: null }
const KI_CONSENT = 'cleanos-cleo-ki'
const kiConsented = () => {
  try {
    return localStorage.getItem(KI_CONSENT) === '1'
  } catch {
    return false
  }
}
/** Ist der KI-Assistent eingerichtet und eingeschaltet? (gemerkt; „nein“ wird nach 5 Minuten neu gefragt) */
export function cleoKiCheck() {
  if (app.config?.assistant === false) return Promise.resolve(false)
  if (KI.ok === true || (KI.ok === false && Date.now() - KI.at < 300e3)) return Promise.resolve(KI.ok)
  KI.pending ||= import('../ai/agent.js')
    .then((m) => m.kiRequest('status'))
    .then((st) => !!st?.aktiv, () => false)
    .then((ok) => {
      Object.assign(KI, { ok, at: Date.now(), pending: null })
      return ok
    })
  return KI.pending
}

/** Nach dem Einrichten: gleich neu nachsehen (nicht erst nach 5 Minuten). */
export const resetCleoKi = () => Object.assign(KI, { ok: null, at: 0, pending: null })

/** Noch nicht zugestimmt: einmal fragen, ob Cleo die KI fragen darf. */
function offerKi(text) {
  if (KI.ok !== true || kiConsented()) return
  push({ from: 'cleo', mood: 'denkt', html: `<p>Soll ich die KI fragen? Dafür geht deine Frage an die KI von Anthropic (Claude) – bitte keine Namen, Adressen oder Gesundheitsdaten eintippen.</p><div class="cleo-acts"><button class="btn small primary" data-action="help-ki" data-q="${esc(text)}">${cleoIcon()} Ja, mit KI beantworten</button></div>` })
}

/** Passende Hilfethemen für die KI: Treffer zur Frage, dann Themen des Bereichs – nur Sichtbares. */
function kiTopics(q, ids) {
  const found = search(TOPICS, q, { limit: 6, view: app.ui.view, visible: (v) => ids.has(v) }).map((x) => x.topic)
  return [...found, ...suggestionsFor(app.ui.view, ids).filter((t) => !found.includes(t))].slice(0, 6)
}

const roleLabel = () => {
  const roles = allRoles(app.config?.access || {})
  return (app.access?.roles || []).map((r) => roles[r]?.label || r).join(', ') || (app.access ? '' : 'alle Bereiche')
}

/** Etwas Markdown der KI: Absätze, Listen, **fett** (nach dem Escapen). */
function kiHtml(text) {
  let html = ''
  let list = ''
  for (const raw of esc(text).split('\n')) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    const item = /^\s*(?:[-*•]|(\d+)\.)\s+(.*)$/.exec(line)
    if (item) {
      const tag = item[1] ? 'ol' : 'ul'
      if (list !== tag) html += `${list ? `</${list}>` : ''}<${tag}>`
      list = tag
      html += `<li>${item[2]}</li>`
      continue
    }
    if (list) html += `</${list}>`
    list = ''
    if (line.trim()) html += `<p>${line}</p>`
  }
  return html + (list ? `</${list}>` : '')
}

/** Frage an die KI; Cleo zeigt „ich frag kurz“ und ersetzt es durch die Antwort. */
export async function askKi(q) {
  const h = H()
  const ids = visibleIds()
  const entry = { from: 'cleo', mood: 'denkt', html: '<p class="cleo-ki-wait">Gute Frage – ich frag kurz die KI …</p>' }
  push(entry)
  h.scroll = true
  renderHelp()
  const topics = kiTopics(q, ids)
  try {
    const [{ cleoKiRequest, parseCleoAnswer }, { kiSend }] = await Promise.all([import('../core/cleo-ki.js'), import('../ai/client.js')])
    const { max_tokens: maxTokens, ...params } = cleoKiRequest({ question: q, topics, role: roleLabel(), view: viewLabel(app.ui.view), areas: visibleViews().map((v) => v.label) })
    const res = parseCleoAnswer(await kiSend(params, { maxTokens, purpose: 'hilfe' }), topics.map((t) => t.id))
    const more = res.topicIds.map(topicById).filter(Boolean)
    const ai = ACTIONS['ai-open'] ? `<button class="btn small ghost" data-action="help-ai" data-q="${esc(q)}">${cleoIcon()} Im KI-Assistenten nachsehen</button>` : ''
    Object.assign(entry, {
      mood: 'froh',
      html: `<div class="cleo-answer cleo-ki">${kiHtml(res.text) || '<p>Dazu habe ich leider nichts gefunden.</p>'}<p class="cleo-ki-note">Antwort der KI aus der Hilfe – bitte kurz prüfen.</p>${more.length ? `<p class="cleo-more">Mehr dazu:</p>${chips(more)}` : ''}${ai ? `<div class="cleo-acts">${ai}</div>` : ''}</div>`,
    })
  } catch (err) {
    const hits = search(TOPICS, q, { limit: 3, view: app.ui.view, visible: (v) => ids.has(v) })
    Object.assign(entry, { mood: 'hoppla', html: `<p>Die KI antwortet gerade nicht${err?.message ? `: ${esc(String(err.message).replace(/[.!\s]+$/, ''))}` : ''}.</p>${hits.length ? `<p class="cleo-more">Vielleicht hilft das:</p>${chips(hits.map((x) => x.topic))}` : ''}` })
  }
  h.scroll = true
  renderHelp()
  return entry
}

// ---------------------------------------------------------------- Cleo kennt den Betrieb

const phone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches
const sees = (m) => !app.access || app.access.sees(m)
const activeEmployees = () => (app.data?.employees || []).filter((e) => !e.exitDate || e.exitDate >= todayISO())

/** Was die eigene Rolle sehen und tun darf (für Cleos Antworten aus den Daten). */
export function abilities() {
  const ids = visibleIds()
  return {
    plan: sees('planung'),
    planEdit: canEdit('planung'),
    coverage: ids.has('coverage'),
    absences: sees('planung') || sees('auswertung') || sees('stammdaten'),
    reasons: !!app.data && seesReasons(),
    absenceView: ids.has('absences'),
    staff: sees('planung') || sees('stammdaten'),
    keys: sees('schluessel'),
    complaints: sees('reklamationen'),
    material: sees('material'),
  }
}

/** Frage aus den Daten beantworten (null = keine Datenfrage → Hilfe-Themen). */
export async function dataAnswer(text) {
  if (!app.data) return null
  const h = H()
  const today = todayISO()
  const u = understand(text, { today, employees: activeEmployees(), objects: app.data.objects || [], last: h.last })
  if (!u) return null
  const w = rangeFor(u, today) || { from: today, to: today }
  try {
    await ensureRange(w.from, w.to)
  } catch {
    /* ohne Verbindung: was im Gerät ist */
  }
  const r = computeRange(w.from, w.to)
  const planned = plannedWeeks()
  const res = answer(u, {
    today,
    can: abilities(),
    instances: r.instances,
    state: r.state,
    ctx: r.ctx,
    absences: app.data.absences || [],
    absenceOf: (id, date) => findAbsence(r.ctx, id, date),
    isPlanned: (monday) => planned.has(monday),
    holidays: (a, b) => holidaysInRange(a, b, app.data.extraFreeDays),
    employees: activeEmployees(),
    objects: app.data.objects || [],
    keys: app.data.schluessel?.keys || [],
    complaints: app.data.reklamationen?.items || [],
    material: app.data.material || null,
    wishes: u.kind === 'wishes' ? Object.values(app.data.wishes || {}) : [],
    todoCount: u.kind === 'summary' ? todo().count : 0,
    appointments: u.kind === 'summary' && visibleIds().has('termine') ? appointmentsOfDay(w.from).map(({ a, allDay }) => ({ time: allDay ? '' : a.start.slice(11, 16), title: a.title })) : [],
  })
  if (!res) return null
  h.last = u
  return res
}

/** Beispiel-Fragen mit echten Namen (Chips im Gruß). */
function examples() {
  const emp = activeEmployees()[0]
  const obj = (app.data?.objects || [])[0]
  return dataExamples(abilities(), { person: emp?.name.split(/[\s,]+/)[0] || '', object: obj?.name || '' })
}
const askChips = (list) => (list.length ? `<div class="cleo-chips">${list.map((q) => `<button class="chip" data-action="help-ask" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : '')

function greet() {
  const h = H()
  if (h.log.length) return
  const name = firstName()
  const season = seasonInfo(activeSeason())
  const ex = examples().slice(0, 3)
  push({ from: 'cleo', mood: 'hallo', html: `<p>Hallo${name ? ` ${esc(name)}` : ''}! Ich bin <b>Cleo, der Sauberheld</b> der Cleanos App. Keine Frage bleibt bei mir liegen: Frag einfach in deinen Worten – wie etwas geht oder was im Betrieb los ist.</p>${ex.length ? `<p class="cleo-more">Ich kenne auch euren Plan, zum Beispiel:</p>${askChips(ex)}` : ''}${season ? `<p class="cleo-tip">${esc(season.hello)}</p>` : ''}` })
}

function panel() {
  const h = H()
  const ids = visibleIds()
  const here = viewLabel(app.ui.view)
  const log = h.log
    .map((m) => (m.from === 'me' ? `<div class="msg me"><p>${esc(m.text)}</p></div>` : `<div class="msg cleo">${m.html}</div>`))
    .join('')
  return `<section class="cleo-panel" role="dialog" aria-label="Cleo, Hilfe zur App">
    <header class="cleo-head${activeSeason() ? ' season-host' : ''}">${seasonDeco(activeSeason(), 'panel')}<span class="cleo-avatar">${cleo({ mood: h.busy ? 'denkt' : h.mood, size: 46, outfit: seasonOutfit() })}</span><div><strong>Cleo</strong><small>${h.busy ? 'Heldenhirn arbeitet …' : 'Sauberheld · kennt die App und euren Plan'}</small></div>
      <button class="btn icon ghost" data-action="help-guide" title="Ganze Anleitung" aria-label="Ganze Anleitung">${ICON.list}</button>
      <button class="btn icon ghost" data-action="help-close" aria-label="Schließen" title="Schließen (Esc)">${ICON.close}</button></header>
    <div class="cleo-log" aria-live="polite">${log}${h.busy ? '<div class="msg cleo typing"><span></span><span></span><span></span></div>' : ''}</div>
    <div class="cleo-suggest">${here ? `<span class="muted">Zu „${esc(here)}“ und mehr:</span>` : ''}${chips(suggestionsFor(app.ui.view, ids))}</div>
    <div class="cleo-input"><input id="cleo-q" type="text" autocomplete="off" placeholder="Frag mich, z. B. „Urlaub eintragen“" aria-label="Frage an Cleo"><button class="btn primary icon" data-action="help-send" aria-label="Senden" title="Senden">${ICON.send}</button></div>
  </section>`
}

function root() {
  let el = document.getElementById('help-root')
  if (!el) {
    el = document.createElement('div')
    el.id = 'help-root'
    document.body.append(el)
  }
  return el
}

/** Fenster und Knopf zeichnen (nach jedem Zeichnen der App und bei Änderungen im Chat). */
export function renderHelp() {
  if (typeof document === 'undefined' || !app.ui) return
  const h = H()
  const show = !!app.config && visibleViews().length > 0
  const el = root()
  if (!show) return patch(el, '')
  const tip = h.open ? '' : !h.seen ? '<span class="cleo-bubble" aria-hidden="true">Fragen? Sauberheld hilft!</span>' : firstVisit(h) ? `<span class="cleo-bubble" aria-hidden="true">Neu in „${esc(viewLabel(app.ui.view))}“? Ich erklär’s dir!</span>` : ''
  patch(el, `${h.open ? panel() : ''}<button class="cleo-fab ${h.open ? 'open' : ''}" data-action="help-toggle" aria-expanded="${h.open}" aria-label="${h.open ? 'Cleo schließen' : 'Cleo fragen: Hilfe zur App'}" title="Cleo fragen (F1)">${cleo({ mood: h.open ? 'froh' : 'hallo', size: 58, outfit: seasonOutfit() })}</button>${tip}`)
  const log = el.querySelector('.cleo-log')
  if (log && h.scroll) {
    // lange Antwort (z. B. Liste aus dem Plan): ab ihrem Anfang zeigen, sonst ans Ende
    const msg = log.lastElementChild
    log.scrollTop = msg && msg.offsetHeight > log.clientHeight - 24 ? msg.offsetTop - log.offsetTop - 8 : log.scrollHeight
    h.scroll = false
  }
}

// Erster Besuch einer Ansicht (je Gerät): Cleo bietet kurz Hilfe dazu an
let visited = null
function firstVisit(h) {
  const v = app.ui.view
  if (!v || v === 'home' || !TOPICS.some((t) => t.view === v)) return false
  if (!visited) {
    try {
      visited = new Set(JSON.parse(localStorage.getItem('cleanos-cleo-ansichten') || '[]'))
    } catch {
      visited = new Set()
    }
  }
  if (h.tipView === v) return Date.now() < h.tipUntil
  if (visited.has(v)) return false
  visited.add(v)
  try {
    localStorage.setItem('cleanos-cleo-ansichten', JSON.stringify([...visited]))
  } catch {
    /* privat */
  }
  h.tipView = v
  h.tipUntil = Date.now() + 6000
  setTimeout(renderHelp, 6100)
  return true
}

export function openHelp(question = '') {
  const h = H()
  h.open = true
  h.seen = true
  try {
    localStorage.setItem('cleanos-cleo-gesehen', '1')
  } catch {
    /* privat */
  }
  greet()
  h.scroll = true
  renderHelp()
  // Themen kommen nach dem Start (help/lazy.js): noch nicht da, dann gleich laden und Vorschläge nachzeichnen
  if (!TOPICS.length) loadTopics().then(renderHelp, () => {})
  // Cleo mit KI: im Hintergrund nachsehen, ob der KI-Assistent eingerichtet ist
  if (typeof fetch === 'function') cleoKiCheck().catch(() => {})
  if (question) ask(question)
  else setTimeout(() => document.getElementById('cleo-q')?.focus({ preventScroll: true }), 30)
}

function ask(text) {
  const q = String(text || '').trim()
  if (!q) return
  const h = H()
  push({ from: 'me', text: q })
  h.busy = true
  h.scroll = true
  renderHelp()
  // erst antworten, wenn die Themen geladen sind (help/lazy.js; meist längst geschehen)
  const started = Date.now()
  loadTopics()
    .catch(() => {})
    .then(() => dataAnswer(q).catch(() => null))
    .then((data) => setTimeout(
      () => {
        h.busy = false
        if (data) push({ from: 'cleo', mood: data.mood, html: data.html })
        else {
          h.last = null
          respond(q)
        }
        h.scroll = true
        renderHelp()
        if (!phone()) document.getElementById('cleo-q')?.focus({ preventScroll: true })
      },
      calm() ? 0 : Math.max(0, 320 - (Date.now() - started)),
    ))
}

/** Selektor einer Zielangabe: ein Aktionsname (Knopf mit dieser Aktion) oder ein eigener CSS-Selektor. */
export const spotSelector = (spot) => (!spot ? '' : /^[.#[]/.test(spot) ? spot : `[data-action="${spot}"]`)

/** Das äußerste zugeklappte Menü, in dem ein Element steckt (sein Inhalt ist dann nicht zu sehen), sonst null. */
function closedMenu(x) {
  let found = null
  for (let d = x.parentElement?.closest('details'); d; d = d.parentElement?.closest('details')) if (!d.open && !d.querySelector(':scope > summary')?.contains(x)) found = d
  return found
}

/**
 * Wohin Cleo für ein Thema zeigt: { el, level }. Stufe 2 ist der Knopf selbst, Stufe 1 der Knopf des zugeklappten
 * Menüs, in dem er steckt. Zuerst der Knopf der Aktion des Themas, sonst seine eigene Zielangabe „spot“ (für Themen,
 * deren Aktion in der Ansicht keinen Knopf hat, z. B. ein Reiter oder eine Spalte). Gibt das Thema der Aktion Daten
 * mit (Art, Modus), zählt nur der Knopf mit genau diesen, dann einer ohne Angabe – nie einer mit anderen: sonst
 * zeigte Cleo beim Thema „Angebot“ auf den Knopf „Rechnung“.
 */
export function spotTarget(t, root = document) {
  const find = (sel) => (sel ? [...root.querySelectorAll(`#app ${sel}`)] : [])
  const data = Object.entries(t.action?.data || {})
  const own = find(spotSelector(t.action?.action))
  const exact = (x) => data.every(([k, v]) => x.dataset[k] === String(v))
  const groups = data.length ? [own.filter(exact), own.filter((x) => !exact(x) && data.every(([k, v]) => x.dataset[k] === undefined || x.dataset[k] === String(v)))] : [own]
  for (const all of [...groups, find(spotSelector(t.spot))]) {
    const open = all.find((x) => x.offsetParent && !closedMenu(x))
    if (open) return { el: open, level: 2 }
    const menu = all.map((x) => closedMenu(x)?.querySelector(':scope > summary')).find((x) => x?.offsetParent)
    if (menu) return { el: menu, level: 1 }
  }
  return labelTarget(t, root)
}

const spotNorm = (s) => s.replace(/[▾▼…+]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** Beschriftungen in „…“ aus den ersten zwei Schritten eines Themas: dort steht, womit man beginnt. */
export const stepLabels = (t) => [...new Set((t.steps || []).slice(0, 2).flatMap((s) => [...s.matchAll(/„([^“]{2,40})“/g)].map((m) => spotNorm(m[1]))))].filter((l) => l.length >= 2)

/** Beschriftung eines Knopfs ohne Zähler, Zusatzzeile, Tastenkürzel und Pfeil. */
function buttonLabel(x) {
  let s = ''
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) s += c.nodeValue
      else if (c.nodeType === 1 && !c.matches('small, kbd, svg, .flag, .caret, .pill, .badge')) walk(c)
    }
  }
  walk(x)
  return spotNorm(s)
}

/**
 * Themen ohne eigenen Knopf: das erste Bedienelement der Ansicht, das so heißt wie in den Schritten genannt
 * („Sperrzeit hinzufügen“, „Belege ▾“). Ist es ein Menü und nennen die Schritte danach einen Eintrag darin,
 * zeigt Cleo erst auf das Menü (Stufe 1) und nach dem Aufklappen auf den Eintrag.
 */
function labelTarget(t, root = document) {
  const labels = stepLabels(t)
  if (!labels.length) return null
  const named = (scope, label) => [...scope.querySelectorAll('button, summary, a.btn')].filter((x) => x.textContent.toLowerCase().includes(label) && buttonLabel(x) === label)
  const main = root.querySelector('#app main')
  if (!main) return null
  for (let i = 0; i < labels.length; i++) {
    const el = named(main, labels[i]).find((x) => x.offsetParent && !closedMenu(x))
    if (!el) continue
    const menu = el.tagName === 'SUMMARY' ? el.parentElement : null
    const inner = menu && labels.slice(i + 1).map((l) => named(menu, l).find((x) => x !== el)).find(Boolean)
    if (!inner) return { el, level: 2 }
    return menu.open && inner.offsetParent ? { el: inner, level: 2 } : { el, level: 1 }
  }
  return null
}

/** Knopf der Aktion in der Ansicht kurz hervorheben (Cleo „zeigt“ darauf). */
function spotlight(t) {
  const wanted = !!(t.action?.action || t.spot || stepLabels(t).length)
  // Die Ansicht kann noch laden (Bereiche werden erst bei Bedarf geholt) und zeichnet danach neu: bis zu 3 s nach
  // der Stelle suchen und die Markierung halten – auch über ein Neuzeichnen hinweg (sonst zeigte Cleo auf nichts
  // mehr, sobald die Ansicht kurz nach dem Sprung noch einmal zeichnet). Steckt der Knopf in einem zugeklappten
  // Menü, zeigt Cleo auf das Menü und bleibt länger dort; klappt man es auf, wandert die Markierung auf den Knopf.
  let tries = 0
  let since = 0
  let marked = null
  let level = -1
  let moved = false
  // ein neues „Zeig es mir“ löst das vorige ab, sonst blieben zwei Stellen markiert
  const run = ++spotRun
  const tick = () => {
    if (run !== spotRun) return void marked?.classList.remove('cleo-spot')
    const hit = spotTarget(t)
    // ohne Knopf nach zwei Versuchen die Überschrift der Ansicht; taucht der Knopf später auf, wandert die Markierung
    const target = hit?.el || (level < 1 && (!wanted || tries >= 2) ? document.querySelector('#app main h2, #app main .section-head') : null)
    const now = hit?.level || 0
    tries++
    // Neuzeichnen ersetzt den Knopf oder lässt ihn stehen und setzt nur seine Klassen zurück: beides auffangen
    if (target && (target !== marked || !target.classList.contains('cleo-spot'))) {
      if (marked !== target) marked?.classList.remove('cleo-spot')
      if (!since || now > level) {
        since = Date.now()
        target.scrollIntoView?.({ block: 'center', behavior: calm() ? 'auto' : 'smooth' })
      }
      target.classList.add('cleo-spot')
      marked = target
      level = Math.max(level, now)
    }
    // Liegt Cleos Fenster über der Stelle (am Handy fast immer), klappt es zu; der erste Schritt bleibt als Hinweis stehen
    if (marked && !moved && Date.now() - since > 420 && H().open && hiddenByPanel(marked)) {
      moved = true
      since = Date.now()
      H().open = false
      renderHelp()
      toast(`${viewLabel(t.view) ? `${viewLabel(t.view)}: ` : ''}${t.steps?.[0] || t.title}`)
    }
    if (since ? Date.now() - since < (level === 1 ? 7000 : 2600) : tries <= 25) return setTimeout(tick, 120)
    marked?.classList.remove('cleo-spot')
  }
  setTimeout(tick, 120)
}
let spotRun = 0

/** Verdeckt Cleos Fenster die Mitte dieses Elements? */
function hiddenByPanel(el) {
  const panel = document.querySelector('#help-root .cleo-panel')
  if (!panel) return false
  const r = el.getBoundingClientRect()
  const p = panel.getBoundingClientRect()
  const x = r.left + r.width / 2
  const y = r.top + r.height / 2
  return x > p.left && x < p.right && y > p.top && y < p.bottom
}

const go = (view) => {
  if (!view || view === app.ui.view) return
  const el = document.createElement('button')
  el.dataset.view = view
  ACTIONS.view?.(el)
}

registerActions({
  'help-toggle': () => {
    const h = H()
    if (h.open) {
      h.open = false
      renderHelp()
    } else openHelp()
  },
  'help-open': (el) => openHelp(el?.dataset?.q || ''),
  'help-close': () => {
    H().open = false
    renderHelp()
  },
  'help-send': () => {
    const input = document.getElementById('cleo-q')
    const q = input?.value || ''
    if (input) input.value = ''
    ask(q)
  },
  'help-topic': (el) => {
    const t = topicById(el.dataset.id)
    if (!t) return
    push({ from: 'me', text: t.title })
    push({ from: 'cleo', mood: topicMood(t), topic: t.id, html: answerHtml(t) })
    H().scroll = true
    renderHelp()
  },
  'help-go': (el) => {
    const t = topicById(el.dataset.id)
    if (!t) return
    go(t.view)
    push({ from: 'cleo', mood: 'fliegt', html: `<p>Schwupp, schon da${viewLabel(t.view) ? `: <b>${esc(viewLabel(t.view))}</b>` : ''}${t.view ? ` (${esc(sectionLabel(VIEWS.find((v) => v.id === t.view)?.section || '') || 'Start')})` : ''}. ${t.steps?.[0] ? esc(t.steps[0]) : ''}</p>` })
    H().scroll = true
    renderHelp()
    spotlight(t)
  },
  'help-do': (el) => {
    const t = topicById(el.dataset.id)
    if (!t?.action || !ACTIONS[t.action.action]) return
    go(t.view)
    setTimeout(() => {
      const b = document.createElement('button')
      for (const [k, v] of Object.entries(t.action.data || {})) b.dataset[k] = v
      ACTIONS[t.action.action](b)
    }, 60)
  },
  'help-guide': (el) => {
    app.ui.guideTopic = el?.dataset?.id || ''
    if (app.ui.view === 'anleitung') {
      ACTIONS['guide-jump']?.(el)
      return
    }
    go('anleitung')
  },
  'help-ai': (el) => {
    H().open = false
    renderHelp()
    // KI-Assistent beantwortet die Frage gleich (ist er nicht eingerichtet: Frage steht im Feld)
    if (ACTIONS['ai-ask']) return ACTIONS['ai-ask'](el)
    ACTIONS['ai-open']?.()
    if (app.ui.modal?.type === 'assistant') {
      app.ui.modal.prefill = el.dataset.q || ''
      renderModal()
    }
  },
  'help-ask': (el) => ask(el.dataset.q || ''),
  // Cleo mit KI: einmal je Gerät zugestimmt, dann die Frage gleich an die KI
  'help-ki': (el) => {
    try {
      localStorage.setItem(KI_CONSENT, '1')
    } catch {
      /* privat: gilt für dieses Mal */
    }
    const q = el?.dataset?.q || ''
    if (q) askKi(q)
  },
  // Knöpfe in Cleos Antworten: Aktion der App ausführen (am Handy macht Cleo dafür Platz)
  'help-run': (el) => {
    const run = el.dataset.run
    const b = document.createElement('button')
    for (const [k, v] of Object.entries(el.dataset)) if (k !== 'action' && k !== 'run') b.dataset[k] = v
    if (phone()) {
      H().open = false
      renderHelp()
    }
    if (run === 'goto-day') {
      const date = b.dataset.date
      app.ui.monday = mondayOf(date)
      app.ui.timelineDay = date
      app.ui.mobileDay = date
      b.dataset.view = phone() ? 'week' : 'timeline'
      return ACTIONS.view?.(b)
    }
    ACTIONS[run]?.(b)
  },
})

if (typeof document !== 'undefined') {
  try {
    seenBefore = !!localStorage.getItem('cleanos-cleo-gesehen')
  } catch {
    /* privat */
  }
  document.addEventListener('keydown', (e) => {
    if (!app.ui) return
    if (e.key === 'F1') {
      e.preventDefault()
      return H().open ? document.getElementById('cleo-q')?.focus() : openHelp()
    }
    if (e.target?.id === 'cleo-q' && e.key === 'Enter') {
      e.preventDefault()
      ACTIONS['help-send']()
    } else if (e.key === 'Escape' && H().open && e.target?.closest?.('#help-root')) {
      H().open = false
      renderHelp()
      document.querySelector('.cleo-fab')?.focus()
    }
  })
  // Blase „Fragen? Ich helfe dir!“ nach ein paar Sekunden weg
  setTimeout(() => {
    if (app.ui && !H().seen) {
      H().seen = true
      renderHelp()
    }
  }, 9000)
}
