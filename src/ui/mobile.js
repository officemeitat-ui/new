// Bedienung auf Handy und Tablet: kompakte Kopfzeile, Leiste unten (anpassbar),
// „Mehr“-Menü mit allen Ansichten und Aktionen, Wischen zwischen Tagen,
// App installieren (Startbildschirm).

import { roleOptions } from '../core/access.js'
import { app, canEdit, closeModal, moduleOf, onModalRender, openModal, registerActions, registerModal, navSections, pinnedViews, renderModal, renderNow, saveStatusText, sectionLabel, toast, visibleViews } from './context.js'
import { ABSENCE, accountKey, defaultSlots, leisteSlots, MAX_SLOTS, moveSlot, SEC, sectionLabels, setSlot, storeChoice, viewLabels } from './leiste.js'
import { cleo } from './mascot.js'
import { seasonOutfit } from './season.js'
import { appName } from './config.js'
import { bellButton, todo } from './modals/todo.js'
import { agoText, syncState } from './sync.js'
import { quickItems } from './quick.js'
import { navIcon } from './sidebar.js'
import { esc, ICON, modalFrame, options } from './shared.js'
import { canMailView } from './mailer.js'

const phone = typeof matchMedia === 'function' ? matchMedia('(max-width: 700px)') : null
/** Schmaler Bildschirm (Handy, Tablet hochkant geteilt). */
export const isMobile = () => !!phone?.matches
export const isStandalone = () => typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true)
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

let installPrompt = null
export function watchDevice() {
  phone?.addEventListener('change', () => renderNow())
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installPrompt = e
  })
  // Wischen nach links/rechts wechselt in der Tagesliste den Tag
  let start = null
  document.addEventListener('touchstart', (e) => {
    start = e.target.closest('.m-swipe') && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null
  }, { passive: true })
  document.addEventListener('touchend', (e) => {
    if (!start) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    start = null
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return
    const days = app.cur.days
    const i = days.indexOf(app.ui.mobileDay) + (dx < 0 ? 1 : -1)
    if (days[i]) {
      app.ui.mobileDay = days[i]
      renderNow()
    }
  }, { passive: true })
  watchLongPress()
}

// ---------------------------------------------------------------- Leiste unten
// Welche Plätze gelten, rechnet leiste.js (Vorgabe der Rolle → Vorgabe des Büros aus config.json →
// eigene Wahl). Hier: Eingaben aus dem App-Zustand, Zeichnen, Dialog „Leiste unten anpassen“.
// Die eigene Wahl liegt in den Einstellungen dieses Geräts (app.ui.leiste) je Konto (accountKey).

/** Symbole der Planungs-Knöpfe wie seit jeher (16er-Raster); sonst das Symbol der Ansicht. */
const BN_ICONS = { week: ICON.calendar, coverage: ICON.users, sheet: ICON.sheet }

/** Eingaben für leiste.js: sichtbare Ansichten in der Reihenfolge des Menüs, Rollen, Büro-Vorgabe. */
function leisteInput(visible = visibleViews()) {
  const sections = navSections(visible)
  return {
    sections,
    byId: new Map(visible.map((v) => [v.id, v])),
    views: sections.flatMap((s) => s.views.map((v) => ({ id: v.id, module: moduleOf(v), section: s.id, mobile: !!v.mobile }))),
    roles: app.access?.roles || [],
    roleConfig: app.config?.access?.roles || {},
    absence: canEdit('planung'),
  }
}
const leisteKey = () => accountKey({ email: app.user?.email, previewRole: app.ui.previewRole })
const ownChoice = () => app.ui.leiste?.[leisteKey()] || null

/** Plätze der Leiste unten für die angemeldete Person (höchstens 4, dazu „Mehr“). */
export function bottomSlots(input = leisteInput()) {
  return leisteSlots({ ...input, choice: ownChoice() })
}

const sectionViews = (input, id) => input.sections.find((s) => s.id === id)?.views || []
/** Voller Name eines Platzes (Dialog, Vorlesen). */
function slotName(slot, input) {
  if (slot === ABSENCE) return '+ Abwesend'
  if (slot.startsWith(SEC)) return sectionLabel(slot.slice(SEC.length))
  return input.byId.get(slot)?.label || slot
}
function slotIcon(slot, input) {
  if (slot === ABSENCE) return ICON.plus
  if (slot.startsWith(SEC)) return navIcon(sectionViews(input, slot.slice(SEC.length))[0] || {})
  const v = input.byId.get(slot)
  return BN_ICONS[slot] || v?.mobile?.icon || navIcon(v || {})
}

/**
 * Knöpfe der Leiste. preview: Vorschau im Dialog (ohne Aktionen, nicht bedienbar; target: dieser
 * Platz ist hervorgehoben). Ein Bereich ist ausgewählt, wenn die offene Ansicht darin liegt und keinen
 * eigenen Platz hat; „Mehr“, wenn die offene Ansicht in keinem Platz steckt. data-pos: Platz für
 * „lange drücken → Diesen Platz ändern“.
 */
function barItems(c, slots, input, { preview = false, target = -1 } = {}) {
  const view = app.ui.view
  const sectionNow = input.views.find((v) => v.id === view)?.section
  const direct = slots.includes(view)
  const flag = (n) => (n ? `<span class="flag error bn-badge">${n}</span>` : '')
  // voller Name, und der kurze für den Fall, dass er nicht passt (fitLabels)
  const label = ({ text, short }) => `<span class="bn-label"${short ? ` data-full="${esc(text)}" data-short="${esc(short)}"` : ''}>${esc(text)}</span>`
  const items = slots.map((slot, i) => {
    const act = (attrs) => (preview ? `tabindex="-1"${i === target ? ' data-target="true"' : ''}` : `${attrs} data-pos="${i}"`)
    if (slot === ABSENCE) return `<button class="bn-item bn-add" ${act('data-action="open-absence-new"')} aria-label="Abwesenheit eintragen"><span class="bn-plus">${ICON.plus}</span><span class="bn-label">Abwesend</span></button>`
    if (slot.startsWith(SEC)) {
      const id = slot.slice(SEC.length)
      const open = sectionViews(input, id).reduce((n, v) => n + (Number(v.badge?.(c)) || 0), 0)
      const current = !direct && sectionNow === id
      return `<button class="bn-item bn-sec" ${act(`data-action="home-section" data-sec="${esc(id)}"`)} aria-haspopup="dialog" aria-label="${esc(sectionLabel(id))}${open ? `, ${open} offen` : ''}" ${current ? 'aria-current="page"' : ''}>${slotIcon(slot, input)}${label(sectionLabels(id, sectionLabel(id)))}${flag(open)}</button>`
    }
    const v = input.byId.get(slot)
    const open = Number(v.badge?.(c)) || 0
    const names = viewLabels(v)
    const named = names.short || names.text !== v.label || open ? ` aria-label="${esc(v.label)}${open ? `, ${open} offen` : ''}"` : ''
    return `<button class="bn-item" ${act(`data-action="view" data-view="${esc(slot)}"`)}${named} ${view === slot ? 'aria-current="page"' : ''}>${slotIcon(slot, input)}${label(names)}${flag(open)}</button>`
  })
  const inBar = direct || slots.includes(SEC + sectionNow)
  return `${items.join('')}<button class="bn-item bn-more" ${preview ? 'tabindex="-1"' : 'data-action="open-more"'} ${inBar ? '' : 'aria-current="page"'}>${ICON.menu}<span class="bn-label">Mehr</span></button>`
}

/** Leiste unten (nur Handy): bis zu 4 Plätze nach Rolle oder eigener Wahl, „Mehr“ immer ganz rechts. */
export function bottomNav(c) {
  const input = leisteInput()
  return `<nav class="bottom-nav" aria-label="Navigation">${barItems(c, bottomSlots(input), input)}</nav>`
}

/**
 * Nach dem Zeichnen (Leiste, Vorschau im Dialog): Passt der volle Name nicht auf den Platz, steht der
 * kurze da („Wasserzähler“ passt bei fünf Knöpfen auf 390 px gerade, „Objektkontrolle“ wird „Kontrolle“).
 * Gemessen fett, damit der Name beim Auswählen nicht wechselt.
 */
export function fitLabels(root = document) {
  for (const el of root.querySelectorAll('.bn-label[data-short]')) {
    el.textContent = el.dataset.full
    el.style.fontWeight = '700'
    const over = el.scrollWidth > el.clientWidth + 0.5
    el.style.fontWeight = ''
    if (over) el.textContent = el.dataset.short
  }
}
// Schrift nachgeladen: neu messen
globalThis.document?.fonts?.ready?.then(() => fitLabels())

/** Was auf einen Platz kann, in Gruppen: Sonderknöpfe, Bereiche, dann die Ansichten je Abschnitt des Menüs. */
function slotChoices(input) {
  const item = (slot, name, icon) => ({ slot, name, icon })
  const special = [input.byId.has('home') && item('home', 'Übersicht', ICON.home), input.absence && item(ABSENCE, '+ Abwesend', ICON.plus)].filter(Boolean)
  const areas = input.sections.filter((s) => s.id !== 'start' && s.label).map((s) => item(SEC + s.id, s.label, navIcon(s.views[0])))
  return [
    { label: 'Sonderknöpfe', items: special },
    { label: 'Bereiche', note: 'ein Platz, öffnet die Liste des Bereichs', items: areas },
    ...input.sections.map((s) => ({ label: s.label || 'Allgemein', items: s.views.filter((v) => v.id !== 'home').map((v) => item(v.id, v.label, BN_ICONS[v.id] || navIcon(v))) })),
  ].filter((g) => g.items.length)
}

/** Auswahl für Platz pos (Dialog „Leiste unten anpassen“): leer, Sonderknöpfe, Bereiche, Ansichten; schon belegte gesperrt. */
function slotSelect(input, slots, pos) {
  const current = slots[pos] || ''
  const onlyOne = slots.length === 1 && pos === 0
  const option = ({ slot, name }) => {
    const at = slots.indexOf(slot)
    const taken = at >= 0 && at !== pos
    return `<option value="${esc(slot)}" ${slot === current ? 'selected' : ''} ${taken ? 'disabled' : ''}>${esc(name)}${slot.startsWith(SEC) ? ' (Bereich)' : ''}${taken ? ` – auf Platz ${at + 1}` : ''}</option>`
  }
  return `<select id="bn-pos-${pos}" data-change="bn-set" data-pos="${pos}"><option value="" ${current ? '' : 'selected'} ${onlyOne ? 'disabled' : ''}>– leer –</option>${slotChoices(input)
    .map((g) => `<optgroup label="${esc(g.label)}">${g.items.map(option).join('')}</optgroup>`)
    .join('')}</select>`
}

const previewBox = (c, slots, input, target = -1) => `<div class="bn-preview" aria-hidden="true" inert>${barItems(c, slots, input, { preview: true, target })}</div>`

/** Dialog „Leiste unten anpassen“: Vorschau, vier Plätze mit je einer Auswahl und Pfeilen, zurück zur Vorgabe. */
function leisteModal(c) {
  const input = leisteInput()
  const slots = bottomSlots(input)
  const base = defaultSlots(input)
  const custom = !!ownChoice()
  const rows = Array.from({ length: MAX_SLOTS }, (_, i) => {
    const slot = slots[i]
    const name = slot ? esc(slotName(slot, input)) : ''
    const arrows = slot
      ? `<button type="button" id="bn-mv-${esc(slot)}-l" class="btn icon bn-up" data-action="bn-move" data-slot="${esc(slot)}" data-delta="-1" aria-label="${name} weiter nach links" ${i === 0 ? 'disabled' : ''}>${ICON.caret}</button><button type="button" id="bn-mv-${esc(slot)}-r" class="btn icon" data-action="bn-move" data-slot="${esc(slot)}" data-delta="1" aria-label="${name} weiter nach rechts" ${i === slots.length - 1 ? 'disabled' : ''}>${ICON.caret}</button>`
      : ''
    return `<li class="bn-row ${slot ? '' : 'empty'}"><span class="m-row-icon" aria-hidden="true">${slot ? slotIcon(slot, input) : ''}</span><span class="bn-row-main"><label for="bn-pos-${i}">Platz ${i + 1}</label>${slotSelect(input, slots, i)}</span><span class="bn-row-acts">${arrows}</span></li>`
  }).join('')
  const who = app.access && !app.access.all ? app.access.label : 'deine Rolle'
  return modalFrame({
    title: 'Leiste unten anpassen',
    subtitle: app.user ? 'Gilt auf diesem Gerät für dein Konto' : 'Gilt auf diesem Gerät für diese Rolle',
    body: `<div class="bn-preview-wrap"><p class="bn-preview-head">Vorschau ${custom ? '<span class="pill info">angepasst</span>' : '<span class="pill ok">Vorgabe</span>'}</p>${previewBox(c, slots, input)}</div>
      ${isMobile() ? '' : '<p class="note">Die Leiste gibt es am Handy (und bei schmalem Fenster). Was du hier einstellst, gilt nur auf diesem Gerät.</p>'}
      <section class="bn-places"><h3>Plätze <small class="muted">von links nach rechts, „Mehr“ bleibt ganz rechts</small></h3><ol class="bn-rows">${rows}</ol>
        <p class="note">Jeden Platz einzeln tauschen: Ansicht, Bereich (z. B. Finanzen) oder Sonderknopf wählen, „leer“ für weniger Plätze. In der Leiste geht es auch direkt: einen Platz lange drücken.</p>
        <p class="note">Vorgabe für ${esc(who)}: ${base.map((s) => esc(slotName(s, input))).join(', ')}.</p></section>`,
    foot: `<button class="btn" data-action="bn-reset" ${custom ? '' : 'disabled'}>Auf Vorgabe zurücksetzen</button><div class="actions"><button class="btn primary" data-action="close-modal">Fertig</button></div>`,
  })
}

/** „Diesen Platz ändern“ (lange drücken in der Leiste): dieselbe Auswahl für genau einen Platz. */
function slotModal(c, m) {
  const input = leisteInput()
  const slots = bottomSlots(input)
  const pos = Math.min(Number(m.pos) || 0, slots.length)
  const current = slots[pos]
  const chip = ({ slot, name, icon }) => {
    const at = slots.indexOf(slot)
    const taken = at >= 0 && at !== pos
    return `<button type="button" class="bn-chip" data-action="bn-set" data-pos="${pos}" data-slot="${esc(slot)}" aria-pressed="${slot === current}" ${taken ? 'disabled' : ''}>${slot === current ? ICON.check : icon}<span>${esc(name)}${taken ? ` <small>Platz ${at + 1}</small>` : ''}</span></button>`
  }
  const groups = slotChoices(input)
    .map((g) => `<h4>${esc(g.label)}${g.note ? ` <small class="muted">${esc(g.note)}</small>` : ''}</h4><div class="bn-chips">${g.items.map(chip).join('')}</div>`)
    .join('')
  return modalFrame({
    title: 'Diesen Platz ändern',
    subtitle: `Platz ${pos + 1} von links${current ? ` · jetzt „${esc(slotName(current, input))}“` : ''}`,
    body: `<div class="bn-preview-wrap">${previewBox(c, slots, input, pos)}</div>
      <section class="bn-pick">${groups}
        ${current ? `<h4>Weniger Plätze</h4><div class="bn-chips"><button type="button" class="bn-chip" data-action="bn-set" data-pos="${pos}" data-slot="" ${slots.length === 1 ? 'disabled' : ''}>${ICON.close}<span>Platz leeren</span></button></div>` : ''}
      </section>`,
    foot: `<button class="btn" data-action="bn-edit">${ICON.list} Ganze Leiste anpassen</button><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button></div>`,
  })
}

/** Eigene Wahl speichern (gleich der Vorgabe: Eintrag weg), Leiste und Dialog neu zeichnen. */
function saveLeiste(list) {
  app.ui.leiste = storeChoice(app.ui.leiste, leisteKey(), list, defaultSlots(leisteInput()))
  app.savePrefs?.()
  renderNow()
  renderModal()
}

/**
 * Lange drücken (oder Rechtsklick) auf einen Platz der Leiste öffnet „Diesen Platz ändern“; der
 * Klick danach öffnet dann nicht auch noch die Ansicht. Kurz tippen bleibt wie immer.
 */
function watchLongPress() {
  let timer = null
  let start = null
  let fired = false // lange gedrückt, Finger noch unten
  let swallowUntil = 0
  const open = (pos) => {
    if (app.ui.modal?.type === 'bn-slot' && app.ui.modal.pos === pos) return
    navigator.vibrate?.(15)
    openModal({ type: 'bn-slot', pos })
  }
  const cancel = () => {
    clearTimeout(timer)
    timer = null
  }
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('.bottom-nav [data-pos]')
    cancel()
    fired = false
    if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return
    start = { x: e.clientX, y: e.clientY }
    timer = setTimeout(() => {
      timer = null
      fired = true
      open(Number(el.dataset.pos))
    }, 550)
  })
  document.addEventListener('pointermove', (e) => {
    if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) cancel()
  })
  const up = (e) => {
    cancel()
    // nach dem Loslassen kommt (je nach Gerät) noch ein Klick: der öffnet nicht die Ansicht
    if (fired && e.type === 'pointerup') swallowUntil = Date.now() + 400
    fired = false
  }
  document.addEventListener('pointerup', up, true)
  document.addEventListener('pointercancel', up, true)
  document.addEventListener('scroll', cancel, true)
  // Rechtsklick (PC) und lange drücken unter Android (Kontextmenü)
  document.addEventListener('contextmenu', (e) => {
    const el = e.target.closest?.('.bottom-nav [data-pos]')
    if (!el) return
    e.preventDefault()
    cancel()
    open(Number(el.dataset.pos))
  })
  window.addEventListener('click', (e) => {
    if (Date.now() > swallowUntil) return
    swallowUntil = 0
    e.preventDefault()
    e.stopPropagation()
  }, true)
}

/** Browser-Modus: Ansicht einer Rolle ausprobieren (z. B. „so sieht es die Objektleitung“). */
export function roleSwitch() {
  if (app.config.storage === 'sharepoint') return ''
  return `<label class="role-switch" title="Vorschau: was eine Rolle sieht und ändern darf"><span>Ansicht als</span><select data-change="preview-role">${options(roleOptions(app.config.access), app.ui.previewRole || 'disposition')}</select></label>`
}

/** Kopfzeile fürs Handy: Logo, Woche, Cleo, Glocke (den KI-Assistenten gibt es im Menü und bei Cleo). */
export function mobileTopbar(c, { brand, week, year, range, status, title = null }) {
  return `<header class="topbar m-topbar"><div class="topbar-inner wrap">
    ${brand}
    ${title ? `<div class="weeknav"><span class="kw">${esc(title.label)}<small>${title.sub}</small></span></div>` : `<div class="weeknav">
      <button class="btn icon" data-action="nav" data-delta="-7" aria-label="Vorige Woche">${ICON.left}</button>
      <button class="kw link-btn" data-action="nav-today" title="Zur aktuellen Woche">KW ${week}<small>${range} · ${status}</small></button>
      <button class="btn icon" data-action="nav" data-delta="7" aria-label="Nächste Woche">${ICON.right}</button>
    </div>`}
    <button class="m-cleo" data-action="help-toggle" aria-label="Cleo fragen" title="Cleo fragen">${cleo({ mood: 'hallo', size: 34, anim: false, outfit: seasonOutfit() })}</button>
    ${bellButton()}
  </div></header>`
}

// ---------------------------------------------------------------- Menü „Mehr“: Bereiche zum Aufklappen

/** Ab so vielen Einträgen klappen die Bereiche zu (Vollzugriff sieht über 60); wenige bleiben offen. */
const COLLAPSE_FROM = 16
const collapsible = (count) => count >= COLLAPSE_FROM
/** Untergruppen in einem Bereich: viele zusammengehörige Einträge unter einem eigenen Kopf. */
const SUBGROUPS = [{ id: 'matten', label: 'Mattenwechsel', match: (v) => v.id === 'matten' || String(v.id).startsWith('mw-') }]
const subgroupOf = (v) => SUBGROUPS.find((g) => g.match(v)) || null
/** Offen: der Bereich (bzw. die Untergruppe) der offenen Ansicht, und was die Person aufgeklappt hat. */
function menuOpen(key, items) {
  if (items.some((v) => v.id === app.ui.view)) return true
  return (app.ui.menuOpen || []).includes(key)
}
const allOpen = (sections) => sections.filter((s) => s.label && s.id !== 'pinned').every((s) => menuOpen(s.id, s.views))
const badgeSum = (c, items) => items.reduce((n, v) => n + (Number(v.badge?.(c)) || 0), 0)

function menuRow(c, v) {
  const badge = v.badge?.(c)
  return `<button class="m-row more-item" data-action="view" data-view="${v.id}" ${app.ui.view === v.id ? 'aria-current="page"' : ''}><span class="m-row-icon">${navIcon(v)}</span><span class="m-row-label">${esc(v.label)}</span>${badge ? `<span class="flag error">${badge}</span>` : ''}${ICON.right}</button>`
}

/** Kopf eines Bereichs bzw. einer Untergruppe: Symbol, Name, Anzahl, Zähler (zugeklappt), Pfeil. */
function menuHead(c, { key, label, items, open, sub = false }) {
  const n = badgeSum(c, items)
  return `<button class="m-row m-sec-head${sub ? ' m-sub-head' : ''}" data-action="m-sec-toggle" data-sec="${esc(key)}" aria-expanded="${open}"><span class="m-row-icon">${navIcon(items[0] || {})}</span><span class="m-row-label"><strong>${esc(label)}</strong><small class="muted">${items.length} ${items.length === 1 ? 'Eintrag' : 'Einträge'}</small></span>${!open && n ? `<span class="flag error">${n}</span>` : ''}<span class="m-sec-caret">${ICON.caret}</span></button>`
}

/** Einträge eines Bereichs, Untergruppen (z. B. Mattenwechsel) als eigener Kopf zum Aufklappen. */
function menuItems(c, items, fold) {
  const out = []
  const done = new Set()
  for (const v of items) {
    const g = fold ? subgroupOf(v) : null
    if (!g) {
      out.push(menuRow(c, v))
      continue
    }
    if (done.has(g.id)) continue
    done.add(g.id)
    const list = items.filter((x) => subgroupOf(x) === g)
    if (list.length < 3) {
      out.push(...list.map((x) => menuRow(c, x)))
      continue
    }
    const key = `sub:${g.id}`
    const open = menuOpen(key, list)
    out.push(menuHead(c, { key, label: g.label, items: list, open, sub: true }))
    if (open) out.push(`<div class="m-sub">${list.map((x) => menuRow(c, x)).join('')}</div>`)
  }
  return out.join('')
}

/**
 * Bereiche des Menüs. Bei vielen Einträgen (Vollzugriff) ist jeder Bereich zugeklappt, außer dem der
 * offenen Ansicht; „Start“ und „Angeheftet“ bleiben immer offen. Bei wenigen Einträgen alles offen.
 */
function menuSections(c, sections, count) {
  const fold = collapsible(count)
  return sections
    .map(({ id, label, views: items }) => {
      if (!fold || !label || id === 'pinned') return `<section class="m-sec"><h3>${esc(label || 'Start')}</h3><div class="m-list">${menuItems(c, items, fold)}</div></section>`
      const open = menuOpen(id, items)
      return `<section class="m-sec m-fold${open ? ' open' : ''}"><div class="m-list">${menuHead(c, { key: id, label, items, open })}${open ? `<div class="m-sec-body">${menuItems(c, items, fold)}</div>` : ''}</div></section>`
    })
    .join('')
}

function moreModal(c) {
  const count = todo().count
  const plan = canEdit('planung')
  const actions = [
    plan && ['plan', `${ICON.bolt} Woche planen`, 'primary'],
    plan && ['replan', 'Neu planen', ''],
    plan && ['open-publish', `${ICON.send} Veröffentlichen`, ''],
    plan && ['open-send', `${ICON.send} An Mitarbeitende versenden`, ''],
    ['open-todo', `${ICON.bell} Zu erledigen${count ? ` <span class="flag error">${count}</span>` : ''}`, ''],
    ['ai-open', 'KI-Assistent', ''],
    quickItems().some((q) => q.id !== 'abwesenheit') && ['quick-open', `${ICON.plus} Neu anlegen …`, ''],
    plan && ['open-absence-new', `${ICON.plus} Abwesenheit eintragen`, ''],
    // wie „⋯ → Diese Ansicht per E-Mail“ am PC (das „⋯“ gibt es am Handy nicht)
    canMailView() && ['mail-view', `${ICON.send} Diese Ansicht per E-Mail`, ''],
    (!app.access || app.access.all) && ['mail-reports-open', `${ICON.calendar} Berichte automatisch`, ''],
  ].filter(Boolean)
  const visible = visibleViews()
  const pinned = pinnedViews(visible)
  const sections = [...(pinned.length ? [{ id: 'pinned', label: 'Angeheftet', views: pinned }] : []), ...navSections(visible)]
  const views = menuSections(c, sections, visible.length)
  const install = isStandalone()
    ? '<p class="note">Als App installiert.</p>'
    : installPrompt
      ? `<button class="btn primary" data-action="install-app">${ICON.download} Als App installieren</button><p class="note">Danach startet sie wie eine App vom Startbildschirm, ohne Browserleiste.</p>`
      : isIOS()
        ? '<p class="note"><strong>Als App installieren:</strong> In Safari unten auf „Teilen“ tippen, dann „Zum Home-Bildschirm“.</p>'
        : '<p class="note"><strong>Als App installieren:</strong> Im Browser-Menü „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen.</p>'
  return modalFrame({
    title: 'Menü',
    subtitle: esc(appName(app.config.brand)), // wie in der Seitenleiste („Cleanos App“)
    body: `<button class="more-search" data-action="open-search">${ICON.search}<span>Bereich, Person, Objekt suchen …</span></button>
      <div class="more-tools"><button class="btn small" data-action="bn-edit">${ICON.list} Leiste unten anpassen</button>${collapsible(visible.length) ? `<button class="btn small ghost" data-action="m-sec-all" data-open="${allOpen(sections) ? '0' : '1'}">${allOpen(sections) ? 'Alle zuklappen' : 'Alle aufklappen'}</button>` : ''}</div>
      ${views}
      <section><h3>Aktionen</h3><div class="more-actions two compact">${actions.map(([action, label, cls]) => `<button class="btn ${cls}" data-action="${action}">${label}</button>`).join('')}</div></section>
      <section><h3>Konto & Daten</h3>
        <p class="note">${saveStatusText(app.service.status)}${app.user ? ` · ${esc(app.user.name)}` : ''}${app.access && !app.access.all ? ` · ${esc(app.access.label)}` : ''}</p>
        ${app.user ? '' : roleSwitch()}
        <p class="note">Zuletzt abgeglichen ${esc(agoText(syncState.lastAt))}.</p>
        <div class="more-actions"><button class="btn" data-action="sync-now">${ICON.refresh} Jetzt abgleichen</button><button class="btn" data-action="theme-open">${ICON.palette} Darstellung</button><button class="btn" data-action="bn-edit">${ICON.list} Leiste unten anpassen</button>${!app.access || app.access.all ? '<button class="btn" data-action="open-data">Daten & Sicherung</button>' : ''}${app.signOut ? '<button class="btn" data-action="sign-out">Abmelden</button>' : ''}</div>
      </section>
      <section><h3>App</h3>${install}</section>`,
  })
}

registerModal('more', moreModal)
registerModal('bn-edit', leisteModal)
registerModal('bn-slot', slotModal)

// Dialog neu gezeichnet: Namen in der Vorschau einpassen, Fokus bleibt auf der Auswahl bzw. dem Pfeil
// (Tastatur, Bildschirmleser), auch wenn der Platz gewandert ist
let refocus = null
onModalRender(($modal) => {
  fitLabels($modal)
  if (!refocus) return
  const el = document.getElementById(refocus)
  refocus = null
  ;(el && !el.disabled ? el : el?.parentElement?.querySelector('button:not([disabled])'))?.focus({ preventScroll: true })
})

registerActions({
  'open-more': () => openModal({ type: 'more' }),
  // Bereich bzw. Untergruppe im Menü auf- oder zuklappen (gemerkt auf diesem Gerät)
  'm-sec-toggle': (el) => {
    const key = el.dataset.sec
    const list = new Set(app.ui.menuOpen || [])
    if (list.has(key)) list.delete(key)
    else list.add(key)
    app.ui.menuOpen = [...list]
    app.savePrefs?.()
    renderModal()
  },
  'm-sec-all': (el) => {
    const visible = visibleViews()
    const keys = navSections(visible).filter((s) => s.label).map((s) => s.id)
    app.ui.menuOpen = el.dataset.open === '1' ? [...keys, ...SUBGROUPS.map((g) => `sub:${g.id}`)] : []
    app.savePrefs?.()
    renderModal()
  },
  // Leiste unten anpassen (eigene Wahl je Gerät und Konto)
  'bn-edit': () => openModal({ type: 'bn-edit' }),
  // Platz setzen: Auswahl im Dialog (value) oder Knopf in „Diesen Platz ändern“ (data-slot)
  'bn-set': (el) => {
    const input = leisteInput()
    const slots = bottomSlots(input)
    const pos = Number(el.dataset.pos)
    const slot = el.dataset.slot ?? el.value
    const next = setSlot(slots, pos, slot)
    const taken = slot ? slots.indexOf(slot) : -1
    if (!next.length || (taken >= 0 && taken !== pos)) {
      renderModal() // Auswahl wieder auf den gespeicherten Stand
      return toast(next.length ? `„${slotName(slot, input)}“ steht schon auf Platz ${taken + 1}.` : 'Mindestens ein Platz bleibt in der Leiste.')
    }
    refocus = el.id || null
    saveLeiste(next)
    if (app.ui.modal?.type === 'bn-slot') {
      closeModal()
      toast(slot ? `Platz ${Math.min(pos, slots.length) + 1}: ${slotName(slot, input)}` : `Platz ${pos + 1} geleert.`)
    }
  },
  'bn-move': (el) => {
    refocus = el.id || null
    saveLeiste(moveSlot(bottomSlots(), el.dataset.slot, Number(el.dataset.delta)))
  },
  'bn-reset': () => {
    saveLeiste(null)
    toast('Leiste unten: wieder die Vorgabe.')
  },
  'install-app': async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    await installPrompt.userChoice.catch(() => null)
    installPrompt = null
    renderModal()
  },
  'm-day': (el) => {
    app.ui.mobileDay = el.dataset.date
    renderNow()
  },
})
