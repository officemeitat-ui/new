// Cleo, der Hilfe-Chat: Fenster unten rechts (am Handy über die ganze Breite), offen über alle
// Ansichten hinweg. Cleo beantwortet Fragen zu jeder Funktion aus den Hilfe-Themen
// (src/help/topics.js) – ohne KI und ohne Netz –, springt mit „Zeig es mir“ in die richtige Ansicht
// und markiert dort den passenden Knopf, startet auf Wunsch gleich die Aktion und verweist auf die
// Anleitung. Was die eigene Rolle nicht sieht, bietet Cleo nicht an. Für alles andere: Übergabe an
// den KI-Assistenten (falls eingerichtet), mit der Frage schon eingetragen.

import { GLOSSARY, TOPICS } from '../help/topics.js'
import { glossary, search, smalltalk, SURE } from '../help/match.js'
import { ACTIONS, app, registerActions, renderModal, sectionLabel, VIEWS, visibleViews } from './context.js'
import { cleo, cleoIcon } from './mascot.js'
import { patch } from './morph.js'
import { esc, ICON } from './shared.js'

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
    return push({ from: 'cleo', mood: 'zeigt', topic: hits[0].topic.id, html: answerHtml(hits[0].topic) + (others.length ? `<p class="cleo-more">Oder meinst du:</p>${chips(others)}` : '') })
  }
  if (all.length && all[0].score >= SURE && !hits.length) return push({ from: 'cleo', mood: 'hoppla', html: `<p>Das gehört zu „${esc(viewLabel(all[0].topic.view) || all[0].topic.title)}“ – diesen Bereich sieht deine Rolle nicht. Frag bitte das Büro, wenn du ihn brauchst.</p>` })
  if (hits.length) return push({ from: 'cleo', mood: 'denkt', html: `<p>Meinst du eines davon?</p>${chips(hits.map((x) => x.topic))}` })
  const ai = ACTIONS['ai-open'] ? `<div class="cleo-acts"><button class="btn small" data-action="help-ai" data-q="${esc(text)}">${cleoIcon()} KI-Assistent fragen</button></div>` : ''
  return push({ from: 'cleo', mood: 'hoppla', html: `<p>Dazu finde ich nichts. Versuch es mit anderen Worten (z. B. „Urlaub eintragen“, „Rechnung schreiben“, „Schnee“) oder schau in die Anleitung.</p>${ai}${chips(suggestionsFor(app.ui.view, ids).slice(0, 4))}` })
}

function greet() {
  const h = H()
  if (h.log.length) return
  const name = firstName()
  push({ from: 'cleo', mood: 'hallo', html: `<p>Hallo${name ? ` ${esc(name)}` : ''}! Ich bin <b>Cleo</b> und kenne jede Funktion der App. Frag mich einfach in deinen Worten – oder tipp auf ein Thema.</p>` })
}

function panel() {
  const h = H()
  const ids = visibleIds()
  const here = viewLabel(app.ui.view)
  const log = h.log
    .map((m) => (m.from === 'me' ? `<div class="msg me"><p>${esc(m.text)}</p></div>` : `<div class="msg cleo">${m.html}</div>`))
    .join('')
  return `<section class="cleo-panel" role="dialog" aria-label="Cleo, Hilfe zur App">
    <header class="cleo-head"><span class="cleo-avatar">${cleo({ mood: h.busy ? 'denkt' : h.mood, size: 46 })}</span><div><strong>Cleo</strong><small>${h.busy ? 'überlegt …' : 'kennt jede Funktion der App'}</small></div>
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
  const tip = h.open ? '' : !h.seen ? '<span class="cleo-bubble" aria-hidden="true">Fragen? Ich helfe dir!</span>' : firstVisit(h) ? `<span class="cleo-bubble" aria-hidden="true">Neu in „${esc(viewLabel(app.ui.view))}“? Frag mich!</span>` : ''
  patch(el, `${h.open ? panel() : ''}<button class="cleo-fab ${h.open ? 'open' : ''}" data-action="help-toggle" aria-expanded="${h.open}" aria-label="${h.open ? 'Cleo schließen' : 'Cleo fragen: Hilfe zur App'}" title="Cleo fragen (F1)">${cleo({ mood: h.open ? 'froh' : 'hallo', size: 58 })}</button>${tip}`)
  const log = el.querySelector('.cleo-log')
  if (log && h.scroll) {
    log.scrollTop = log.scrollHeight
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
  setTimeout(
    () => {
      h.busy = false
      respond(q)
      h.scroll = true
      renderHelp()
      document.getElementById('cleo-q')?.focus({ preventScroll: true })
    },
    calm() ? 0 : 320,
  )
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
    push({ from: 'cleo', mood: 'zeigt', topic: t.id, html: answerHtml(t) })
    H().scroll = true
    renderHelp()
  },
  'help-go': (el) => {
    const t = topicById(el.dataset.id)
    if (!t) return
    go(t.view)
    push({ from: 'cleo', mood: 'zeigt', html: `<p>Hier ist es${viewLabel(t.view) ? `: <b>${esc(viewLabel(t.view))}</b>` : ''}${t.view ? ` (${esc(sectionLabel(VIEWS.find((v) => v.id === t.view)?.section || '') || 'Start')})` : ''}. ${t.steps?.[0] ? esc(t.steps[0]) : ''}</p>` })
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
    ACTIONS['ai-open']?.()
    if (app.ui.modal?.type === 'assistant') {
      app.ui.modal.prefill = el.dataset.q || ''
      renderModal()
    }
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
