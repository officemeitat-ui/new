// Schnellfunktionen: „+ Neu“ in der Kopfleiste (Termin, Abwesenheit, Zeit nachtragen, Reklamation,
// Material, Rechnung …), dieselben Befehle in „Springen zu …“ und Tastenkürzel (Übersicht mit „?“).
// Jede Funktion erscheint nur, wenn die Rolle in dem Bereich ändern darf.

import { ACTIONS, app, canEdit, closeModal, mayEdit, openModal, registerActions, registerModal, visibleViews } from './context.js'
import { esc, ICON, modalFrame } from './shared.js'

/** { id, label, key?, module, action, data?, words } – module '*' = jede Rolle, die überhaupt etwas sieht */
export const QUICK = [
  { id: 'termin', label: 'Termin', key: 't', module: 'termine', action: 'appt-new', words: 'kalender outlook besprechung begehung meeting einladen' },
  { id: 'abwesenheit', label: 'Abwesenheit (Urlaub, Krankenstand)', key: 'a', module: 'planung', action: 'open-absence-new', words: 'urlaub krank krankenstand zeitausgleich' },
  { id: 'zeit', label: 'Zeit nachtragen', key: 'z', module: 'planung', action: 'tc-edit-open', words: 'zeiterfassung stempeln vergessen kommen gehen' },
  { id: 'reklamation', label: 'Reklamation', key: 'r', module: 'reklamationen', action: 'complaint-new', words: 'beschwerde mangel kunde' },
  { id: 'pruefung', label: 'Prüfung erfassen (Anlage)', module: 'anlagen', action: 'anl-check-open', words: 'anlage prüffrist feuerlöscher rauchmelder spielplatz lift wartung hausbetreuung' },
  { id: 'regie', label: 'Regiebericht (Sonderleistung)', module: 'regie', action: 'reg-new', words: 'regie regiestunden sonderleistung grundreinigung wasserschaden zusatzarbeiten unterschrift kunde auftrag' },
  { id: 'material', label: 'Material anfordern', key: 'm', module: 'material', action: 'mat-request-new', words: 'lager bestellen reinigungsmittel' },
  { id: 'rechnung', label: 'Rechnung', key: 'f', module: 'fakturierung', action: 'fak-new', data: { kind: 'rechnung' }, words: 'faktura fakturieren verrechnen' },
  { id: 'angebot', label: 'Angebot', module: 'fakturierung', action: 'fak-new', data: { kind: 'angebot' }, words: 'offert kostenvoranschlag' },
  { id: 'aufgabe', label: 'Aufgabe per E-Mail', key: 'e', module: '*', action: 'mail-task-new', words: 'aufgabe auftrag mail email senden erinnerung weiterleiten delegieren' },
  { id: 'leistung', label: 'Leistung im Reinigungsplan', module: 'stammdaten', action: 'task-edit', data: { id: 'new' }, words: 'reinigungsplan objekt leistung' },
  { id: 'assistent', label: 'KI-Assistent fragen', key: 'k', module: '*', action: 'ai-open', words: 'ki assistent frage hilfe' },
]

/** Funktionen, die die angemeldete Person nutzen darf. */
export function quickItems() {
  const anyView = visibleViews().length > 0
  return QUICK.filter((q) => ACTIONS[q.action] && (q.module === '*' ? anyView : canEdit(q.module) && mayEdit(q.module)))
}

/** Aktion ausführen wie ein Klick (mit data-Feldern). */
export function runQuick(q) {
  const el = document.createElement('button')
  for (const [k, v] of Object.entries(q.data || {})) el.dataset[k] = v
  ACTIONS[q.action]?.(el)
}

/** „+ Neu“ für die Kopfleiste (Desktop). */
export function quickButton() {
  const items = quickItems()
  if (!items.length) return ''
  return `<details class="menu-wrap quick-wrap"><summary class="btn" title="Schnell anlegen (Taste N)">${ICON.plus}<span class="quick-label">Neu</span></summary><div class="menu" role="menu">${items
    .map((q) => `<button class="btn" data-action="quick-run" data-id="${q.id}" role="menuitem">${esc(q.label)}${q.key ? `<kbd>${q.key.toUpperCase()}</kbd>` : ''}</button>`)
    .join('')}<button class="btn muted-btn" data-action="quick-keys">Alle Tastenkürzel <kbd>?</kbd></button></div></details>`
}

/** Befehle für „Springen zu …“ (search.js). */
export function quickResults(match) {
  return quickItems()
    .filter((q) => match(`neu ${q.label}`, q.words))
    .map((q) => ({ group: 'Neu anlegen', label: q.label, sub: q.key ? `Taste ${q.key.toUpperCase()}` : '', action: 'quick-run', data: { id: q.id } }))
}

const KEYS = [
  ['N', '„+ Neu“ öffnen'],
  ...QUICK.filter((q) => q.key).map((q) => [q.key.toUpperCase(), `Neu: ${q.label}`]),
  ['/', 'Springen zu … (Suche)'],
  ['Strg + K', 'Springen zu … (Suche)'],
  ['Strg + J', 'KI-Assistent'],
  ['F1', 'Cleo fragen (Hilfe zu jeder Funktion)'],
  ['← / →', 'vorige / nächste Woche'],
  ['H', 'heute (diese Woche)'],
  ['Strg + Z', 'Rückgängig (Planung)'],
  ['Esc', 'Dialog oder Menü schließen'],
  ['?', 'diese Übersicht'],
]

registerModal('quick-keys', () =>
  modalFrame({
    title: 'Tastenkürzel',
    subtitle: 'Gelten, wenn nicht gerade in einem Feld getippt wird',
    body: `<table class="data keys-table"><tbody>${KEYS.map(([k, t]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(t)}</td></tr>`).join('')}</tbody></table>
      <p class="note">Was angezeigt wird, hängt von der Rolle ab: Funktionen ohne Recht fehlen.</p>`,
  }),
)

registerModal('quick-menu', () => {
  const items = quickItems()
  return modalFrame({
    title: 'Neu anlegen',
    body: `<div class="quick-grid">${items.map((q) => `<button class="more-item quick-item" data-action="quick-run" data-id="${q.id}">${esc(q.label)}${q.key ? ` <kbd>${q.key.toUpperCase()}</kbd>` : ''}</button>`).join('')}</div>`,
  })
})

registerActions({
  'quick-run': (el) => {
    const q = QUICK.find((x) => x.id === el.dataset.id)
    for (const d of document.querySelectorAll('details.quick-wrap[open]')) d.open = false
    if (!q) return
    if (app.ui.modal?.type === 'quick-menu') closeModal()
    runQuick(q)
  },
  'quick-keys': () => {
    for (const d of document.querySelectorAll('details.quick-wrap[open]')) d.open = false
    openModal({ type: 'quick-keys' })
  },
  'quick-open': () => openModal({ type: 'quick-menu' }),
})

// ---------------------------------------------------------------- Tastenkürzel

const typing = (t) => /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || '') || t?.isContentEditable

if (typeof document !== 'undefined')
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || e.defaultPrevented) return
    if (app.ui.modal && e.key !== '?') return
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    if (key === '?') {
      e.preventDefault()
      return openModal({ type: 'quick-keys' })
    }
    if (key === '/') {
      e.preventDefault()
      return ACTIONS['open-search']?.()
    }
    if (key === 'n') {
      const d = document.querySelector('details.quick-wrap')
      e.preventDefault()
      if (d) {
        d.open = true
        d.querySelector('.menu .btn')?.focus()
      } else openModal({ type: 'quick-menu' })
      return
    }
    const q = quickItems().find((x) => x.key === key)
    if (q) {
      e.preventDefault()
      return runQuick(q)
    }
    // Woche blättern (Ansichten mit Wochenwahl)
    const view = visibleViews().find((v) => v.id === app.ui.view)
    if (view && !view.noWeek && document.querySelector('.weeknav, .m-weeknav, [data-action="nav"]')) {
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        e.preventDefault()
        const el = document.createElement('button')
        el.dataset.delta = key === 'ArrowLeft' ? '-7' : '7'
        return ACTIONS.nav?.(el)
      }
      if (key === 'h') {
        e.preventDefault()
        return ACTIONS['nav-today']?.()
      }
    }
  })
