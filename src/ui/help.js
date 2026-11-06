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
import { mondayOf, todayISO } from '../core/dates.js'
import { holidaysInRange } from '../core/holidays.js'
import { findAbsence } from '../core/rules.js'
import { ACTIONS, app, canEdit, computeRange, ensureRange, plannedWeeks, registerActions, renderModal, sectionLabel, VIEWS, visibleViews } from './context.js'
import { todo } from './modals/todo.js'
import { seesReasons } from './views/absences.js'
import { appointmentsOfDay } from './views/appointments.js'
import { cleo, cleoIcon } from './mascot.js'
import { patch } from './morph.js'
import { activeSeason, seasonDeco, seasonInfo, seasonOutfit } from './season.js'
import { esc, ICON } from './shared.js'

// Pose zum Thema: Cleo zeigt das passende Werkzeug (sonst zeigt er auf die Stelle)
const TOPIC_MOODS = { wetter: 'schnee', due: 'liste', kontrolle: 'liste', report: 'liste', coverage: 'liste', matten: 'teppich', objektmappe: 'wischt', objects: 'wischt', sites: 'wischt', zaehler: 'handy', zeiten: 'handy', termine: 'handy', waste: 'muell', fahrzeuge: 'haus', schluessel: 'haus', anlagen: 'liste', regie: 'handy', qualitaet: 'liste', arbeitsschutz: 'liste', unterweisungen: 'idee', kalkulation: 'idee', kennzahlen: 'daumen', reklamationen: 'desinfektion' }
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
  if (hits.length) return push({ from: 'cleo', mood: 'denkt', html: `<p>Meinst du eines davon?</p>${chips(hits.map((x) => x.topic))}` })
  const ai = ACTIONS['ai-open'] ? `<div class="cleo-acts"><button class="btn small" data-action="help-ai" data-q="${esc(text)}">${cleoIcon()} KI-Assistent fragen</button></div>` : ''
  return push({ from: 'cleo', mood: 'hoppla', html: `<p>Hoppla – da hat sogar mein Heldenblick nichts gefunden. Versuch es mit anderen Worten (z. B. „Urlaub eintragen“, „Rechnung schreiben“, „Wer arbeitet morgen?“) oder schau in die Anleitung.</p>${ai}${askChips(examples().slice(0, 2))}${chips(suggestionsFor(app.ui.view, ids).slice(0, 3))}` })
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

/** Knopf der Aktion in der Ansicht kurz hervorheben (Cleo „zeigt“ darauf). */
function spotlight(t) {
  const sel = t.action?.action ? `[data-action="${t.action.action}"]` : ''
  setTimeout(() => {
    const el = sel && [...document.querySelectorAll(`#app ${sel}`)].find((x) => x.offsetParent)
    const target = el || document.querySelector('#app main h2, #app main .section-head')
    if (!target) return
    target.scrollIntoView?.({ block: 'center', behavior: calm() ? 'auto' : 'smooth' })
    target.classList.add('cleo-spot')
    setTimeout(() => target.classList.remove('cleo-spot'), 2600)
  }, 120)
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
