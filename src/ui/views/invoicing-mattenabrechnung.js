// Fakturierung → „Läufe ▾“ → „Mattenwechsel abrechnen“ (P14, docs/MATTENWECHSEL-PLAN.md): Rechnungsentwürfe aus den
// Lieferscheinen des Mattenwechsels mit Vorschau je Kunde (Zeitraum Vorgabe Vormonat, quartalsweise Kunden mit dem Lauf des
// letzten Quartalsmonats), je gewechselter Matte (Einzel oder Sammel, eingefrorene Preise) oder Pauschale je Monat.
// „Entwürfe erstellen“ legt nur Entwürfe an – nie festschreiben oder senden; danach der gewohnte Weg der Fakturierung
// mit den Schritten Geprüft → Freigegeben → Ausgestellt (festgeschrieben) am Entwurf und Korrekturen im Verlauf.
// Rechenkern: core/matten-abrechnung.js. Wer die Fakturierung bearbeitet, darf abrechnen (die Buchhaltung braucht den
// Mattenwechsel nicht: alle Daten stehen in den Lieferscheinen). Aktionen und Dialoge mit dem Kürzel „mwr-“.

import { formatDate, todayISO } from '../../core/dates.js'
import { emptyInvoicing, monthLabel, round2, settingsOf, totals } from '../../core/invoicing.js'
import { addMonths, billingText, createDrafts, markChecked, markReleased, needsReview, planRun, prevMonth, REVIEW_STEPS, reviewStep, runTask, suggestOn, trackChanges, undoReview } from '../../core/matten-abrechnung.js'
import { app, canEdit, closeModal, memo, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { checked, esc, euro, modalFrame, options, uid, val } from '../shared.js'

const MODULE = 'fakturierung'
/** Aus invoicing.js (dort gesetzt): Formular des Entwurfs lesen und den Entwurf speichern (mit Verlauf). */
export const mattenRunHooks = { readForm: null, storeDraft: null }

const F = () => {
  const d = (app.data.fakturierung ||= emptyInvoicing())
  d.documents ||= []
  d.settings ||= {}
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const by = () => app.user?.name || 'Browser'
const nowIso = () => new Date().toISOString()
const money = (n) => euro(round2(n))
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const day = (iso) => (iso ? formatDate(String(iso).slice(0, 10), { weekday: false, year: true }) : '')
const docOf = (id) => F().documents.find((d) => d.id === id)

/** Namen, die die App ohne die Lieferscheine kennt: Objekte und (wenn lesbar) Liegeplätze des Mattenwechsels. */
function knownNames() {
  const objects = Object.fromEntries((app.data.objects || []).filter((o) => o?.id && o.name).map((o) => [o.id, o.name]))
  const placements = Object.fromEntries((Array.isArray(app.data.matten?.placements) ? app.data.matten.placements : []).filter((p) => p?.id && p.name).map((p) => [p.id, `${p.name}${p.floor ? ` (${p.floor})` : ''}`]))
  return { objects, placements }
}

const planOf = (c, ym, older) => memo(c, `mwr:plan:${ym}:${older ? 1 : 0}`, () => planRun(F(), { ym, today: todayISO(), includeOlder: older, names: knownNames(), date: todayISO() }))

// ---------------------------------------------------------------- Menüpunkt, Liste, Entwurf

/** Eintrag im Menü „Läufe“ der Fakturierung. */
export const mattenRunMenuItem = () => ({ label: 'Mattenwechsel abrechnen', action: 'mwr-open', hint: 'Rechnungsentwürfe aus den Lieferscheinen' })

const STEP_CLASS = { entwurf: '', geprueft: 'info', freigegeben: 'ok', ausgestellt: 'ok' }
/** Kleines Schild in der Rechnungsliste: Schritt eines Entwurfs aus dem Mattenwechsel. */
export function mattenBadge(x) {
  if (!needsReview(x) || x.number) return ''
  const step = reviewStep(x)
  return ` <span class="pill ${STEP_CLASS[step]}" title="Mattenwechsel: ${esc(REVIEW_STEPS[step])}">${step === 'entwurf' ? 'zu prüfen' : esc(REVIEW_STEPS[step].toLowerCase())}</span>`
}

/** Korrekturen an einem Entwurf aus dem Lauf protokollieren (Verlauf; Prüfung zurücksetzen). before: gespeicherter Stand. */
export const trackMatten = (before, after) => trackChanges(before, after, { at: nowIso(), by: by() })

/** Schritte am Entwurf bzw. am festgeschriebenen Beleg: Entwurf → Geprüft → Freigegeben → Ausgestellt, mit Verlauf. */
export function reviewPanel(x) {
  if (!needsReview(x)) return ''
  const step = reviewStep(x)
  const order = ['entwurf', 'geprueft', 'freigegeben', 'ausgestellt']
  const at = order.indexOf(step)
  const who = { geprueft: x.review?.checkedAt ? `${x.review.checkedBy || ''} ${day(x.review.checkedAt)}` : '', freigegeben: x.review?.releasedAt ? `${x.review.releasedBy || ''} ${day(x.review.releasedAt)}` : '', ausgestellt: x.number ? `${x.number}` : '' }
  const steps = order
    .map((k, i) => `<li class="mwr-step ${i < at ? 'done' : i === at ? 'cur' : ''}" ${i === at ? 'aria-current="step"' : ''}><span class="mwr-dot" aria-hidden="true">${i <= at ? '✓' : i + 1}</span><span><strong>${REVIEW_STEPS[k]}</strong>${who[k] ? `<br><small>${esc(who[k].trim())}</small>` : ''}</span></li>`)
    .join('')
  const s = x.source || {}
  const info = `Aus dem Mattenwechsel: ${esc(s.period?.label || '')} · ${esc(billingText(s))}${s.notes?.length ? ` · ${plural(s.notes.length, 'Lieferschein', 'Lieferscheine')}` : ''}`
  const ed = editable() && !x.number
  const buttons = !ed
    ? ''
    : step === 'entwurf'
      ? '<button class="btn small primary" data-action="mwr-check">Als geprüft markieren</button>'
      : step === 'geprueft'
        ? '<button class="btn small primary" data-action="mwr-release">Freigeben</button><button class="btn small" data-action="mwr-undo">Prüfung zurücknehmen</button>'
        : '<button class="btn small" data-action="mwr-undo">Freigabe zurücknehmen</button>'
  const history = (x.history || []).slice(-8).reverse().map((h) => `<li>${esc(day(h.at))}${h.by ? ` ${esc(h.by)}` : ''}: ${esc(h.text)}</li>`).join('')
  const next = x.number ? '' : step === 'freigegeben' ? 'Freigegeben: jetzt festschreiben (einzeln oder unter „Läufe“ → „Festschreiben und senden“).' : step === 'geprueft' ? 'Geprüft: zum Festschreiben noch freigeben.' : 'Beträge und Angaben prüfen; Korrekturen stehen im Verlauf.'
  return `<section class="mwr-review" aria-label="Mattenwechsel: Prüfen und Freigeben"><p class="muted">${info}</p><ol class="mwr-steps">${steps}</ol>
    ${next || buttons ? `<div class="mwr-review-acts">${next ? `<span class="muted">${esc(next)}</span>` : ''}${buttons}</div>` : ''}
    ${history ? `<details><summary>Verlauf</summary><ul class="muted mwr-history">${history}</ul></details>` : ''}</section>`
}

// ---------------------------------------------------------------- Dialog: Lauf mit Vorschau

const LEVEL_CLASS = { error: 'err-text', warn: 'warn-text', info: 'muted' }
const draftsText = (p) => {
  const ready = p.drafts.filter((d) => !d.errors.length)
  if (!p.drafts.length) return '–'
  const kind = p.drafts[0].kind
  const label = kind === 'pauschale' ? `Pauschale (${p.months.map(monthLabel).join(', ')})` : kind === 'einzel' ? plural(ready.length, 'Einzelrechnung', 'Einzelrechnungen') : 'Sammelrechnung'
  return ready.length ? label : `gesperrt${p.drafts.length > 1 ? ` (${p.drafts.length})` : ''}`
}
const notesText = (list) => (list.length ? `${plural(list.length, 'Lieferschein', 'Lieferscheine')}<br><span class="muted">${esc(list.slice(0, 4).map((n) => `${n.number} (${day(n.date)})`).join(', '))}${list.length > 4 ? ' …' : ''}</span>` : '<span class="muted">keine</span>')

function runModal(c, m) {
  const today = todayISO()
  m.ym ||= prevMonth(today)
  m.older ??= true
  const r = planOf(c, m.ym, m.older)
  m.sel ||= Object.fromEntries(r.todo.filter((p) => p.ready).map((p) => [p.key, true]))
  const chosen = r.todo.filter((p) => p.ready && m.sel[p.key])
  const drafts = chosen.reduce((s, p) => s + p.ready, 0)
  const net = round2(chosen.reduce((s, p) => s + p.net, 0))
  const blocked = r.todo.filter((p) => !p.ready && p.drafts.length)
  const ed = editable()
  const months = Array.from({ length: 14 }, (_, i) => addMonths(today.slice(0, 7), -i))
  const rows = r.todo
    .map((p) => {
      const box = p.ready && ed ? `<input type="checkbox" data-change="mwr-pick" data-key="${esc(p.key)}" ${m.sel[p.key] ? 'checked' : ''} aria-label="${esc(`${p.name} abrechnen`)}">` : ''
      const hints = p.hints.length ? `<ul class="mwr-hints">${p.hints.map((h) => `<li class="${LEVEL_CLASS[h.level]}">${esc(h.text)}</li>`).join('')}</ul>` : '<span class="ok-text">in Ordnung</span>'
      const list = p.pending.length && !p.notes.length ? p.pending : p.notes
      return `<tr class="mwr-row ${p.ready ? '' : 'mwr-off'}"><td class="mwr-box">${box}</td>
        <td><strong>${esc(p.name)}</strong>${p.customerNo ? ` <span class="muted">(${esc(p.customerNo)})</span>` : ''}</td>
        <td>${esc(billingText(p))}</td><td>${esc(p.period.label)}</td><td>${notesText(list)}</td><td>${esc(draftsText(p))}</td>
        <td class="num">${p.ready ? `<strong>${money(p.net)}</strong>` : '–'}</td><td class="mwr-hint-cell">${hints}</td></tr>`
    })
    .join('')
  const done = r.done.length
    ? `<details class="mwr-done"><summary>Schon abgerechnet (${r.done.length})</summary><ul>${r.done.map((p) => `<li><strong>${esc(p.name)}</strong>: ${esc(p.billed.map((b) => `${b.text} → ${b.number || 'Entwurf'}`).join(', '))}</li>`).join('')}</ul></details>`
    : ''
  const open = F().documents.filter((x) => needsReview(x) && !x.number).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  const openList = open.length
    ? `<h3>Entwürfe aus dem Mattenwechsel (${open.length})</h3><div class="table-wrap"><table class="data mwr-open"><thead><tr><th>Empfänger</th><th>Betreff</th><th>Schritt</th><th class="num">netto</th><th></th></tr></thead><tbody>${open
        .map((x) => `<tr><td>${esc(x.recipient?.name || '')}</td><td>${esc(x.title || '')}</td><td><span class="pill ${STEP_CLASS[reviewStep(x)]}">${esc(REVIEW_STEPS[reviewStep(x)])}</span></td><td class="num">${money(totals(x, settingsOf(F())).net)}</td><td class="actions-cell"><button class="btn small" data-action="fak-open" data-id="${esc(x.id)}">Öffnen</button></td></tr>`)
        .join('')}</tbody></table></div>`
    : ''
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  return modalFrame({
    title: 'Mattenwechsel abrechnen',
    subtitle: 'Rechnungsentwürfe aus den Lieferscheinen',
    wide: true,
    body: `<div class="filters mwr-filters"><label class="field inline"><span>Monat</span><select id="mwr-ym" data-change="mwr-month">${options(months.map((k) => [k, monthLabel(k)]), m.ym)}</select></label>
        <label class="check"><input type="checkbox" id="mwr-older" data-change="mwr-opts" ${m.older ? 'checked' : ''}><span>ältere offene Lieferscheine mitnehmen</span></label>
        <label class="check"><input type="checkbox" id="mwr-suggest" data-change="mwr-suggest" ${suggestOn(F().settings) ? 'checked' : ''} ${ed ? '' : 'disabled'}><span>am Monatsersten vorschlagen (Zu erledigen)</span></label></div>
      <div class="impact-stats mwr-stats">${tile('Kunden bereit', chosen.length)}${tile('Entwürfe', drafts)}${tile('Summe netto', money(net))}${tile('Gesperrt', blocked.length, blocked.length ? 'err' : '')}</div>
      ${rows ? `<div class="table-wrap"><table class="data mwr-table"><thead><tr><th></th><th>Kunde</th><th>Abrechnung</th><th>Zeitraum</th><th>Lieferscheine</th><th>Entwurf</th><th class="num">netto</th><th>Hinweise</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">Für ${esc(monthLabel(m.ym))} ist nichts mehr abzurechnen.</p>`}
      ${done}${openList}
      <p class="note">Je gewechselter Matte gelten die Preise aus den Lieferscheinen (beim Wechsel eingefroren); Pauschalen kommen aus dem Kundenblatt → Mattenwechsel, die Lieferscheine hängen als Nachweis ohne Stückpreise an. Erstellt werden nur Entwürfe: prüfen, freigeben und festschreiben wie gewohnt. Ein Lieferschein und ein Pauschal-Monat werden nie doppelt verrechnet; Entwurf löschen oder Storno gibt sie frei.</p>`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${ed ? `<button class="btn primary" data-action="mwr-create" ${drafts && !m.busy ? '' : 'disabled'}>Entwürfe erstellen (${drafts})</button>` : ''}</div>`,
  })
}
registerModal('mwr-run', runModal, { module: MODULE })

// ---------------------------------------------------------------- Zu erledigen (Buchhaltung, Vollzugriff)

/** Vorschlag am Monatsersten (Einstellung settings.mattenRun.suggest): Lauf für den Vormonat. */
export const runTaskNow = (today = todayISO()) => (app.data?.fakturierung ? memo(app.cur, `mwr:task:${today}`, () => runTask(F(), { today })) : null)

registerTodo({
  id: 'fakturierung-matten',
  module: MODULE,
  title: 'Mattenwechsel abrechnen',
  compute: (today) => {
    const t = runTaskNow(today)
    return t ? [{ id: `${t.ym}:${t.keys.join(',')}`, ...t }] : []
  },
  render: (items) =>
    items
      .map((x) => `<div class="todo-item"><span class="flag warning">${x.count}</span><div class="todo-text"><strong>Mattenwechsel abrechnen: ${plural(x.count, 'Kunde', 'Kunden')}</strong><br><span class="muted">Lieferscheine ${esc(monthLabel(x.ym))}: ${plural(x.drafts, 'Rechnungsentwurf', 'Rechnungsentwürfe')} bereit (${money(x.net)} netto). Erstellt wird erst nach deiner Prüfung, nichts wird gesendet.</span></div><button class="btn small primary" data-action="mwr-open" data-ym="${esc(x.ym)}">Öffnen</button></div>`)
      .join(''),
})

// ---------------------------------------------------------------- Aktionen

/** Entwurf im offenen Formular: lesen, Korrekturen protokollieren, speichern; liefert den gespeicherten Stand. */
function storeOpenDraft() {
  const m = app.ui.modal
  if (m?.type !== 'fak-edit' || !mattenRunHooks.readForm) return null
  const x = mattenRunHooks.readForm(m)
  return mattenRunHooks.storeDraft(x)
}

function setReview(fn, message) {
  const m = app.ui.modal
  const saved = storeOpenDraft()
  if (!saved) return
  try {
    const next = fn(saved)
    mattenRunHooks.storeDraft(next, { raw: true })
    m.draft = structuredClone(next)
    persist()
    renderModal()
    renderNow()
    toast(message)
  } catch (err) {
    toast(err.message)
  }
}

registerActions(
  {
    'mwr-open': (el) => {
      const ym = /^\d{4}-\d{2}$/.test(el?.dataset?.ym || '') ? el.dataset.ym : prevMonth(todayISO())
      app.ui.view = 'fakturierung'
      closeModal()
      renderNow()
      openModal({ type: 'mwr-run', ym })
    },
    'mwr-month': () => {
      const m = app.ui.modal
      m.ym = val('mwr-ym') || m.ym
      m.sel = null
      renderModal()
    },
    'mwr-opts': () => {
      const m = app.ui.modal
      m.older = checked('mwr-older')
      m.sel = null
      renderModal()
    },
    'mwr-pick': (el) => {
      const m = app.ui.modal
      m.sel ||= {}
      m.sel[el.dataset.key] = el.checked
      renderModal()
    },
    'mwr-suggest': () => {
      const d = F()
      const on = checked('mwr-suggest')
      d.settings.mattenRun = { ...(d.settings.mattenRun || {}), suggest: on }
      persist()
      renderModal()
      toast(on ? 'Am Monatsersten erscheint „Mattenwechsel abrechnen“ in „Zu erledigen“ und beim digitalen Mitarbeiter Buchhaltung.' : 'Kein Vorschlag am Monatsersten.')
    },
    'mwr-create': async (el) => {
      const m = app.ui.modal
      if (m?.type !== 'mwr-run' || m.busy) return
      const keys = Object.entries(m.sel || {})
        .filter(([, on]) => on)
        .map(([k]) => k)
      if (!keys.length) return toast('Bitte mindestens einen Kunden wählen.')
      m.busy = true
      el.disabled = true
      try {
        // erst den Stand der anderen holen: was inzwischen anderswo im Entwurf steht, kommt nicht noch einmal
        await app.service?.flush?.().catch(() => {})
        await app.service?.refresh?.().catch(() => [])
        const d = F()
        const today = todayISO()
        const r = createDrafts(d, { ym: m.ym, today, date: today, includeOlder: m.older, names: knownNames(), keys, newId: () => uid('f'), now: nowIso(), by: by() })
        d.documents.push(...r.drafts)
        if (r.drafts.length) persist()
        await app.service?.flush?.().catch(() => {})
        m.sel = null
        m.busy = false
        if (app.ui.modal === m) renderModal()
        renderNow()
        toast(`${plural(r.drafts.length, 'Rechnungsentwurf', 'Rechnungsentwürfe')} erstellt${r.skipped.length ? `, ${r.skipped.length} gesperrt (${r.skipped[0].name}: ${r.skipped[0].reason})` : ''}. Bitte prüfen, freigeben und festschreiben.`)
      } catch (err) {
        m.busy = false
        if (app.ui.modal === m) renderModal()
        toast(`Nicht erstellt: ${err.message}`)
      }
    },
    'mwr-check': () => setReview((x) => markChecked(x, { at: nowIso(), by: by() }), 'Als geprüft markiert. Jetzt freigeben.'),
    'mwr-release': () => setReview((x) => markReleased(x, { at: nowIso(), by: by() }), 'Freigegeben. Jetzt festschreiben.'),
    'mwr-undo': () => setReview((x) => undoReview(x, { at: nowIso(), by: by() }), 'Zurückgenommen: wieder Entwurf.'),
  },
  { edit: MODULE },
)
