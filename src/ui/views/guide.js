// Anleitung: alle Funktionen der App zum Nachlesen, nach Bereichen wie im Menü, mit Suche,
// „Zeig es mir“ und Begriffen. Inhalt aus denselben Hilfe-Themen wie Cleo (src/help/topics.js),
// nur was die eigene Rolle sieht. Drucken ergibt ein sauberes PDF (Seitenleiste, Knöpfe und Cleo
// fallen weg). Dieselben Themen erzeugen docs/ANLEITUNG.md (npm run anleitung).

import { GLOSSARY, TOPICS } from '../../help/topics.js'
import { search } from '../../help/match.js'
import { app, NAV_SECTIONS, registerActions, registerView, renderNow, VIEWS, visibleViews } from '../context.js'
import { cleo } from '../mascot.js'
import { seasonOutfit } from '../season.js'
import { esc, ICON } from '../shared.js'

export const CHAPTERS = [...NAV_SECTIONS.map(([id, label]) => [id, label || 'Start & Übersicht']), ['allgemein', 'Bedienung & Allgemeines']]
const BOOK = '<path d="M4 4.5h6.5A2.5 2.5 0 0 1 13 7v13a2 2 0 0 0-2-2H4zM20 4.5h-6.5A2.5 2.5 0 0 0 11 7v13a2 2 0 0 1 2-2h7z"/><path d="M15.5 9h2.5M15.5 12h2.5"/>'

const viewLabel = (id) => VIEWS.find((v) => v.id === id)?.label || ''

/** Sichtbare Themen nach Kapitel (Suche: nach Treffer sortiert, ohne Kapitel). */
export function guideTopics(query = '', ids = new Set(visibleViews().map((v) => v.id))) {
  const ok = (t) => !t.view || ids.has(t.view)
  if (query.trim()) return [['treffer', 'Treffer', search(TOPICS, query, { limit: 40, visible: (v) => ids.has(v) }).map((x) => x.topic)]]
  return CHAPTERS.map(([id, label]) => [id, label, TOPICS.filter((t) => t.section === id && ok(t))]).filter(([, , list]) => list.length)
}

function article(t) {
  return `<article class="guide-topic" id="hilfe-${esc(t.id)}">
    <h4>${esc(t.title)}${t.view && viewLabel(t.view) ? ` <span class="guide-where">${esc(viewLabel(t.view))}</span>` : ''}</h4>
    <p>${esc(t.answer)}</p>
    ${t.steps?.length ? `<ol>${t.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${t.tips?.length ? `<ul class="guide-tips">${t.tips.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    ${t.roles ? `<p class="muted guide-roles">${esc(t.roles)}</p>` : ''}
    ${t.view ? `<p class="guide-acts"><button class="btn small" data-action="help-go" data-id="${esc(t.id)}">${ICON.right} Zeig es mir</button></p>` : ''}
  </article>`
}

function guideView() {
  const q = app.ui.guideQ || ''
  const chapters = guideTopics(q)
  const count = chapters.reduce((n, [, , l]) => n + l.length, 0)
  if (app.ui.guideTopic) {
    const id = app.ui.guideTopic
    app.ui.guideTopic = ''
    setTimeout(() => jump(id), 60)
  }
  const toc = q ? '' : `<nav class="guide-toc" aria-label="Kapitel">${chapters.map(([id, label, list]) => `<a href="#kap-${id}" data-action="guide-chapter" data-id="${id}">${esc(label)} <span class="muted">${list.length}</span></a>`).join('')}<a href="#kap-begriffe" data-action="guide-chapter" data-id="begriffe">Begriffe <span class="muted">${GLOSSARY.length}</span></a></nav>`
  return `<div class="guide">
    <header class="guide-head"><span class="guide-cleo">${cleo({ mood: 'liste', size: 92, outfit: seasonOutfit() })}</span>
      <div><h2>Anleitung</h2><p>Alle Funktionen der Cleanos App, kurz erklärt und Schritt für Schritt. Lieber fragen? Cleo unten rechts antwortet sofort – auch ohne Internet.</p></div>
      <div class="actions"><button class="btn" data-action="guide-print">${ICON.print} Drucken / PDF</button><button class="btn primary" data-action="help-open">Cleo fragen</button></div></header>
    <div class="guide-search"><input type="search" id="guide-q" value="${esc(q)}" placeholder="Suchen, z. B. Urlaub, Rechnung, Schnee, Wasserzähler" aria-label="In der Anleitung suchen" data-input="guide-search"><span class="muted">${count} ${count === 1 ? 'Thema' : 'Themen'}</span></div>
    ${toc}
    ${chapters.map(([id, label, list]) => `<section class="guide-chapter" id="kap-${id}"><h3>${esc(label)}</h3>${list.length ? list.map(article).join('') : '<p class="empty">Nichts gefunden. Andere Wörter probieren oder Cleo fragen.</p>'}</section>`).join('')}
    ${q ? '' : `<section class="guide-chapter" id="kap-begriffe"><h3>Begriffe</h3><dl class="guide-glossary">${GLOSSARY.map((g) => `<div><dt>${esc(g.term)}</dt><dd>${esc(g.text)}</dd></div>`).join('')}</dl></section>`}
  </div>`
}

function jump(id) {
  const el = document.getElementById(`hilfe-${id}`)
  if (!el) return
  el.scrollIntoView({ block: 'start' })
  el.classList.add('cleo-spot')
  setTimeout(() => el.classList.remove('cleo-spot'), 2600)
}

registerView({ id: 'anleitung', order: 3, label: 'Anleitung', group: 'start', section: 'start', module: '*', noWeek: true, icon: BOOK, text: 'Hilfe: alle Funktionen erklärt, Cleo fragen', render: guideView })

registerActions({
  'guide-search': (el) => {
    app.ui.guideQ = el.value
    renderNow()
  },
  'guide-chapter': (el, e) => {
    e?.preventDefault?.()
    document.getElementById(`kap-${el.dataset.id}`)?.scrollIntoView({ block: 'start' })
  },
  'guide-jump': (el) => jump(el?.dataset?.id || ''),
  'guide-print': () => {
    app.ui.guideQ = ''
    renderNow()
    setTimeout(() => window.print(), 50)
  },
})
