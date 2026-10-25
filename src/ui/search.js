// Schnellsuche (Strg+K oder Lupe): Ansichten, Mitarbeitende, Objekte,
// Zählstellen, Fahrzeuge und Kontrollen in einem Feld. Zeigt nur, was die Rolle sehen darf.

import { ACTIONS, app, closeModal, openModal, registerActions, registerModal, renderModal, renderNow, visibleViews } from './context.js'
import { esc, ICON, modalFrame } from './shared.js'

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const sees = (m) => !app.access || app.access.sees(m)

function results(q) {
  const n = norm(q.trim())
  if (!n) return []
  const hit = (...texts) => texts.some((t) => norm(t).includes(n))
  const out = []
  for (const v of visibleViews()) if (hit(v.label)) out.push({ group: 'Ansicht', label: v.label, action: 'view', data: { view: v.id } })
  if (sees('planung') || sees('stammdaten'))
    for (const e of app.data.employees) if (hit(e.name, e.personnelNo, e.team)) out.push({ group: 'Mitarbeitende', label: e.name, sub: [e.personnelNo, e.team].filter(Boolean).join(' · '), action: sees('planung') ? 'open-person' : 'emp-edit', data: sees('planung') ? { emp: e.id } : { id: e.id } })
  for (const o of app.data.objects) {
    const m = app.data.mappe?.objects?.[o.id] || {}
    if (!hit(o.name, o.short, o.address, m.customer, m.customerNo, m.objectNo)) continue
    const action = sees('objektmappe') ? 'mp-open' : sees('stammdaten') ? 'search-goto-sites' : null
    if (action) out.push({ group: 'Objekte', label: o.name, sub: [o.address, m.customer].filter(Boolean).join(' · '), action, data: { id: o.id } })
  }
  if (sees('zaehler'))
    for (const m of app.data.zaehler?.meters || []) if (hit(m.number, m.location, m.objektNr)) out.push({ group: 'Zählstellen', label: m.location || m.number, sub: `Nr. ${m.number} · ${app.data.objects.find((o) => o.id === m.objectId)?.name || ''}`, action: 'search-meter', data: { id: m.id } })
  if (sees('fahrzeuge'))
    for (const v of app.data.fahrzeuge?.vehicles || []) {
      const driver = app.data.employees.find((e) => e.id === v.driverId)?.name || ''
      if (hit(v.plate, v.plate?.replace(/[\s-]/g, ''), v.label, driver)) out.push({ group: 'Fahrzeuge', label: v.plate, sub: [v.label, driver].filter(Boolean).join(' · '), action: 'veh-edit-open', data: { id: v.id } })
    }
  if (sees('kontrolle'))
    for (const k of app.data.kontrolle?.inspections || []) {
      const o = app.data.objects.find((x) => x.id === k.objectId)
      if (hit(o?.name, k.date, k.inspector, k.kind)) out.push({ group: 'Kontrollen', label: `${o?.name || ''} · ${k.date.split('-').reverse().join('.')}`, sub: [k.kind, k.summary?.overall, k.status].filter(Boolean).join(' · '), action: 'ins-open', data: { id: k.id } })
    }
  return out.slice(0, 40)
}

function searchModal(c, m) {
  const list = results(m.q || '')
  const sel = Math.min(m.sel || 0, Math.max(0, list.length - 1))
  let group = ''
  const items = list
    .map((r, i) => {
      const head = r.group !== group ? `<li class="search-group">${esc((group = r.group))}</li>` : ''
      return `${head}<li><button type="button" class="search-hit ${i === sel ? 'sel' : ''}" data-action="search-go" data-i="${i}"><strong>${esc(r.label)}</strong>${r.sub ? ` <span class="muted">${esc(r.sub)}</span>` : ''}</button></li>`
    })
    .join('')
  return modalFrame({
    title: 'Suchen',
    body: `<label class="search-field">${ICON.search}<input type="search" id="search-q" value="${esc(m.q || '')}" placeholder="Person, Objekt, Kunde, Zählernummer, Kennzeichen, Ansicht …" autocomplete="off" data-input="search-q"></label>
      <ul class="search-list" role="listbox">${items || (m.q ? '<li class="muted">Nichts gefunden.</li>' : '<li class="muted">Tippen zum Suchen. Pfeiltasten und Enter wählen.</li>')}</ul>`,
  })
}

registerModal('search', searchModal)

function go(r) {
  if (!r) return
  closeModal()
  const el = document.createElement('button')
  for (const [k, v] of Object.entries(r.data)) el.dataset[k] = v
  ACTIONS[r.action]?.(el)
}

function openSearch() {
  openModal({ type: 'search', q: '' })
  document.getElementById('search-q')?.focus()
}

registerActions({
  'open-search': openSearch,
  'search-q': (el) => {
    app.ui.modal.q = el.value
    app.ui.modal.sel = 0
    const pos = el.selectionStart
    renderModal()
    const input = document.getElementById('search-q')
    input?.focus()
    input?.setSelectionRange(pos, pos)
  },
  'search-go': (el) => go(results(app.ui.modal.q || '')[Number(el.dataset.i)]),
  'search-meter': (el) => {
    app.ui.view = 'zaehler'
    renderNow()
    ACTIONS['meter-open']?.(el)
  },
  'search-goto-sites': () => {
    app.ui.view = 'sites'
    renderNow()
  },
})

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    openSearch()
    return
  }
  if (app.ui.modal?.type !== 'search') return
  const list = results(app.ui.modal.q || '')
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    app.ui.modal.sel = Math.max(0, Math.min(list.length - 1, (app.ui.modal.sel || 0) + (e.key === 'ArrowDown' ? 1 : -1)))
    for (const [i, b] of [...document.querySelectorAll('.search-hit')].entries()) b.classList.toggle('sel', i === app.ui.modal.sel)
    document.querySelector('.search-hit.sel')?.scrollIntoView({ block: 'nearest' })
  } else if (e.key === 'Enter' && e.target.id === 'search-q') {
    e.preventDefault()
    go(list[app.ui.modal.sel || 0])
  }
})

export const searchButton = () => `<button class="btn icon" data-action="open-search" title="Suchen (Strg+K)" aria-label="Suchen">${ICON.search}</button>`
