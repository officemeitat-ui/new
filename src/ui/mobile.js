// Bedienung auf Handy und Tablet: kompakte Kopfzeile, Leiste unten,
// „Mehr“-Menü mit allen Ansichten und Aktionen, Wischen zwischen Tagen,
// App installieren (Startbildschirm).

import { roleOptions } from '../core/access.js'
import { app, canEdit, openModal, registerActions, registerModal, navSections, pinnedViews, renderModal, renderNow, saveStatusText, visibleViews } from './context.js'
import { assistantButton } from './assistant.js'
import { bellButton, todo } from './modals/todo.js'
import { esc, ICON, modalFrame, options } from './shared.js'

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
}

/** Leiste unten (nur Handy). Ohne Dienstplan-Recht: die Ansichten der eigenen Module. */
export function bottomNav(c) {
  const views = visibleViews()
  const item = (view, icon, label, badge = 0) =>
    `<button class="bn-item" data-action="view" data-view="${view}" ${app.ui.view === view ? 'aria-current="page"' : ''}>${icon}<span>${label}</span>${badge ? `<span class="flag error bn-badge">${badge}</span>` : ''}</button>`
  let main = ['week', 'coverage', 'sheet']
  let items
  if (views.some((v) => v.id === 'week')) {
    const open = views.find((v) => v.id === 'coverage')?.badge?.(c) || 0
    items = [
      item('week', ICON.calendar, 'Woche'),
      item('coverage', ICON.users, 'Vertretung', open),
      canEdit('planung') ? `<button class="bn-item bn-add" data-action="open-absence-new" aria-label="Abwesenheit eintragen"><span class="bn-plus">${ICON.plus}</span><span>Abwesend</span></button>` : '',
      item('sheet', ICON.sheet, 'Zettel'),
    ]
  } else {
    const own = [...views.filter((v) => v.mobile), ...views.filter((v) => !v.mobile)].slice(0, 4)
    main = own.map((v) => v.id)
    items = own.map((v) => item(v.id, v.mobile?.icon || ICON.sheet, esc(v.mobile?.label || v.label), v.badge?.(c) || 0))
  }
  return `<nav class="bottom-nav" aria-label="Navigation">
    ${items.join('')}
    <button class="bn-item" data-action="open-more" ${main.includes(app.ui.view) ? '' : 'aria-current="page"'}>${ICON.menu}<span>Mehr</span></button>
  </nav>`
}

/** Browser-Modus: Ansicht einer Rolle ausprobieren (z. B. „so sieht es die Objektleitung“). */
export function roleSwitch() {
  if (app.config.storage === 'sharepoint') return ''
  return `<label class="role-switch" title="Vorschau: was eine Rolle sieht und ändern darf"><span>Ansicht als</span><select data-change="preview-role">${options(roleOptions(app.config.access), app.ui.previewRole || 'disposition')}</select></label>`
}

/** Kopfzeile fürs Handy: Logo, Woche, Glocke. */
export function mobileTopbar(c, { brand, week, year, range, status, title = null }) {
  return `<header class="topbar m-topbar"><div class="topbar-inner wrap">
    ${brand}
    ${title ? `<div class="weeknav"><span class="kw">${esc(title.label)}<small>${title.sub}</small></span></div>` : `<div class="weeknav">
      <button class="btn icon" data-action="nav" data-delta="-7" aria-label="Vorige Woche">${ICON.left}</button>
      <button class="kw link-btn" data-action="nav-today" title="Zur aktuellen Woche">KW ${week}<small>${range} · ${status}</small></button>
      <button class="btn icon" data-action="nav" data-delta="7" aria-label="Nächste Woche">${ICON.right}</button>
    </div>`}
    ${assistantButton({ compact: true })}
    ${bellButton()}
  </div></header>`
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
    plan && ['open-absence-new', `${ICON.plus} Abwesenheit eintragen`, ''],
  ].filter(Boolean)
  const visible = visibleViews()
  const pinned = pinnedViews(visible)
  const sections = [...(pinned.length ? [{ id: 'pinned', label: 'Angeheftet', views: pinned }] : []), ...navSections(visible)]
  const views = sections.map(({ label, views: items }) => {
    return `<section><h3>${label || 'Start'}</h3><div class="more-grid">${items
      .map((v) => {
        const badge = v.badge?.(c)
        return `<button class="more-item" data-action="view" data-view="${v.id}" ${app.ui.view === v.id ? 'aria-current="page"' : ''}>${esc(v.label)}${badge ? ` <span class="flag error">${badge}</span>` : ''}</button>`
      })
      .join('')}</div></section>`
  }).join('')
  const install = isStandalone()
    ? '<p class="note">Als App installiert.</p>'
    : installPrompt
      ? `<button class="btn primary" data-action="install-app">${ICON.download} Als App installieren</button><p class="note">Danach startet sie wie eine App vom Startbildschirm, ohne Browserleiste.</p>`
      : isIOS()
        ? '<p class="note"><strong>Als App installieren:</strong> In Safari unten auf „Teilen“ tippen, dann „Zum Home-Bildschirm“.</p>'
        : '<p class="note"><strong>Als App installieren:</strong> Im Browser-Menü „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen.</p>'
  return modalFrame({
    title: 'Menü',
    subtitle: `${esc(app.config.brand.name)} · ${esc(app.config.brand.product)}`,
    body: `<button class="more-search" data-action="open-search">${ICON.search}<span>Bereich, Person, Objekt suchen …</span></button>
      <section><h3>Aktionen</h3><div class="more-actions two">${actions.map(([action, label, cls]) => `<button class="btn ${cls}" data-action="${action}">${label}</button>`).join('')}</div></section>
      ${views}
      <section><h3>Konto & Daten</h3>
        <p class="note">${saveStatusText(app.service.status)}${app.user ? ` · ${esc(app.user.name)}` : ''}${app.access && !app.access.all ? ` · ${esc(app.access.label)}` : ''}</p>
        ${app.user ? '' : roleSwitch()}
        <div class="more-actions"><button class="btn" data-action="theme-open">${ICON.palette} Darstellung</button>${!app.access || app.access.all ? '<button class="btn" data-action="open-data">Daten & Sicherung</button>' : ''}${app.signOut ? '<button class="btn" data-action="sign-out">Abmelden</button>' : ''}</div>
      </section>
      <section><h3>App</h3>${install}</section>`,
  })
}

registerModal('more', moreModal)

registerActions({
  'open-more': () => openModal({ type: 'more' }),
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
