// Zulagen je Tätigkeit (Überstunden & Auszahlung → Export → „Zulagen“, core/zulagen.js): Liste mit Vorschau für den
// Monat (wer bekommt welche Zulage), Bearbeiten (Name, Lohnart, je Stunde bzw. je Einsatz, Betrag, gilt für Leistungen,
// Objekte, Stichwort, nur Sonderleistungen). Gespeichert in lohn/zeitkonto.json (allowances); im Export fürs
// Lohnprogramm je Zulage eine Zeile (modals/payroll-export.js). Nur wer Löhne sieht.

import { ALLOWANCE_MODES, allowanceProblem, allowancesTotal, newAllowance } from '../../core/zulagen.js'
import { app, canEdit, closeModal, confirmStep, currentMonth, openModal, persist, registerActions, registerModal, renderModal, seesAccount, toast } from '../context.js'
import { checked, esc, euro, ICON, modalFrame, options, uid, val } from '../shared.js'
import { payroll } from '../views/overtime.js'
import { monthAllowances } from './payroll-export.js'

const MODULE = 'auswertung'
const list = () => (app.data.allowances ||= [])
const editable = () => canEdit(MODULE) && !app.readOnly && seesAccount()
const NO_RIGHT = 'Zulagen sieht nur, wer Löhne sehen darf (Lohnverrechnung, Vollzugriff).'
const num = (v) => String(v ?? '').replace('.', ',')
const objName = (id) => (app.data.objects || []).find((o) => o.id === id)?.name || 'Objekt'
const taskOf = (id) => (app.data.tasks || []).find((t) => t.id === id)

/** Kurztext, wofür die Zulage gilt. */
function scopeText(a) {
  const parts = []
  if ((a.taskIds || []).length) parts.push(a.taskIds.length === 1 ? `${taskOf(a.taskIds[0])?.label || 'Leistung'} (${objName(taskOf(a.taskIds[0])?.objectId)})` : `${a.taskIds.length} Leistungen`)
  if ((a.objectIds || []).length) parts.push(a.objectIds.length === 1 ? `alle Leistungen in ${objName(a.objectIds[0])}` : `${a.objectIds.length} Objekte`)
  if (String(a.keyword || '').trim()) parts.push(`Bezeichnung enthält „${a.keyword.trim()}“`)
  const s = parts.join(' oder ') || 'alle Sonderleistungen'
  return a.onlySpecial && parts.length ? `${s} (nur Sonderleistungen)` : s
}

function listModal(c, m) {
  if (!seesAccount()) return modalFrame({ title: 'Zulagen', body: `<p>${esc(NO_RIGHT)}</p>`, foot: '<button class="btn" data-action="close-modal">Schließen</button>' })
  const ed = editable()
  // Monat der Vorschau: der aus „Überstunden & Auszahlung“, auch nach Bearbeiten und Zurück
  const month = m.month || app.ui.zulMonth || currentMonth()
  app.ui.zulMonth = month
  const rows = list()
    .map((a) => {
      const ask = app.ui.confirm === `zul-del:${a.id}`
      return `<tr class="${a.active === false ? 'muted' : ''}"><td><strong>${esc(a.name)}</strong>${a.active === false ? ' <span class="pill">aus</span>' : ''}<br><span class="muted">${esc(scopeText(a))}</span></td><td>${esc(a.wageType || '–')}</td><td class="num">${esc(euro(Number(String(a.rate).replace(',', '.')) || 0))} ${esc(ALLOWANCE_MODES[a.mode] || '')}</td>
        <td class="actions-cell">${ed ? `<button class="btn small" data-action="zul-edit" data-id="${esc(a.id)}">Bearbeiten</button> <button class="btn small ghost" data-action="zul-del" data-id="${esc(a.id)}">${ask ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</td></tr>`
    })
    .join('')
  // Vorschau: wer bekommt im Monat welche Zulage
  let preview = ''
  if (list().some((a) => a.active !== false)) {
    const p = payroll(month)
    const zul = monthAllowances(p.range, month)
    const lines = [...zul.entries()]
      .map(([empId, zs]) => ({ name: p.range.ctx.employeesById.get(empId)?.name || '', zs }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
      .map(({ name, zs }) => `<tr><td>${esc(name)}</td><td>${zs.map((z) => `${esc(z.name)}: ${esc(num(z.menge))} ${z.einheit === 'h' ? 'h' : z.menge === 1 ? 'Einsatz' : 'Einsätze'}`).join('<br>')}</td><td class="num">${esc(euro(allowancesTotal(zs)))}</td></tr>`)
      .join('')
    preview = `<h3>Im Monat ${esc(month.slice(5, 7))}/${esc(month.slice(0, 4))} laut Plan</h3>${lines ? `<div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th>Zulagen</th><th class="num">Summe</th></tr></thead><tbody>${lines}</tbody></table></div>` : '<p class="muted">In diesem Monat hat niemand einen Einsatz, für den eine Zulage gilt.</p>'}${p.missing.length ? '<p class="note">Noch nicht eingeteilte Wochen fehlen in der Vorschau.</p>' : ''}`
  }
  return modalFrame({
    title: 'Zulagen je Tätigkeit',
    wide: true,
    body: `<p class="note">Zulagen für bestimmte Arbeiten, z. B. Schmutzzulage bei der Grundreinigung oder Erschwerniszulage für Glasreinigung außen: je Stunde oder je Einsatz, für gewählte Leistungen, ganze Objekte oder alles mit einem Stichwort in der Bezeichnung. Die App rechnet je Person aus den gearbeiteten Einsätzen laut Plan und schreibt sie in den Export fürs Lohnprogramm (je Zulage eine Lohnart). Höhe und Anspruch laut Kollektivvertrag bzw. Vereinbarung legt ihr fest.</p>
      ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Zulage</th><th>Lohnart</th><th class="num">Betrag</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Noch keine Zulage.</p>'}
      ${preview}`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions">${ed ? `<button class="btn primary" data-action="zul-edit">${ICON.plus} Neue Zulage</button>` : ''}</div>`,
  })
}
registerModal('zul-list', listModal, { module: MODULE })

function draftOf(m) {
  if (!m.draft) {
    const a = m.id ? list().find((x) => x.id === m.id) : null
    m.draft = a ? structuredClone(a) : newAllowance({ id: uid('zul'), now: new Date().toISOString(), by: app.user?.name || 'Browser' })
  }
  return m.draft
}

function readForm(m) {
  const d = draftOf(m)
  if (!document.getElementById('zul-name')) return d
  Object.assign(d, { name: val('zul-name').trim(), wageType: val('zul-wt').trim(), mode: val('zul-mode'), rate: val('zul-rate').trim(), keyword: val('zul-kw').trim(), onlySpecial: checked('zul-special'), active: checked('zul-active') })
  // Häkchen der gerade gezeigten Liste übernehmen (gefilterte, nicht gezeigte bleiben)
  const shownTasks = [...document.querySelectorAll('input[name="zul-task"]')]
  const keep = new Set((d.taskIds || []).filter((id) => !shownTasks.some((x) => x.value === id)))
  for (const x of shownTasks) if (x.checked) keep.add(x.value)
  d.taskIds = [...keep]
  d.objectIds = [...document.querySelectorAll('input[name="zul-obj"]:checked')].map((x) => x.value)
  m.q = val('zul-q')
  return d
}

function editModal(c, m) {
  if (!editable()) return modalFrame({ title: 'Zulage', body: `<p>${esc(NO_RIGHT)}</p>`, foot: '<button class="btn" data-action="close-modal">Schließen</button>' })
  const d = draftOf(m)
  const q = String(m.q || '').trim().toLowerCase()
  const objects = [...(app.data.objects || [])].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const tasks = (app.data.tasks || []).filter((t) => !q || `${t.label} ${objName(t.objectId)}`.toLowerCase().includes(q))
  const sel = new Set(d.taskIds || [])
  const byObj = objects
    .map((o) => ({ o, ts: tasks.filter((t) => t.objectId === o.id) }))
    .filter((x) => x.ts.length)
    .map(({ o, ts }) => `<div class="zul-obj"><strong>${esc(o.name)}</strong>${ts.map((t) => `<label class="check"><input type="checkbox" name="zul-task" value="${esc(t.id)}" ${sel.has(t.id) ? 'checked' : ''}><span>${esc(t.label)}${t.category === 'sonder' ? ' <span class="muted">(Sonderleistung)</span>' : ''}</span></label>`).join('')}</div>`)
    .join('')
  const objSel = new Set(d.objectIds || [])
  return modalFrame({
    title: d.createdAt && list().some((x) => x.id === d.id) ? 'Zulage bearbeiten' : 'Neue Zulage',
    wide: true,
    body: `<div class="form-grid">
        <label class="field wide"><span>Name</span><input type="text" id="zul-name" value="${esc(d.name)}" placeholder="z. B. Schmutzzulage Grundreinigung"></label>
        <label class="field"><span>Lohnart (Nummer im Lohnprogramm)</span><input type="text" id="zul-wt" value="${esc(d.wageType)}" placeholder="z. B. 310"></label>
        <label class="field"><span>Gerechnet</span><select id="zul-mode">${options(Object.entries(ALLOWANCE_MODES), d.mode)}</select></label>
        <label class="field"><span>Betrag (€)</span><input type="text" inputmode="decimal" id="zul-rate" value="${esc(num(d.rate))}" placeholder="z. B. 1,20"></label>
        <label class="check"><input type="checkbox" id="zul-active" ${d.active !== false ? 'checked' : ''}><span>aktiv</span></label>
      </div>
      <h3>Gilt für</h3>
      <div class="form-grid">
        <label class="field wide"><span>Stichwort in der Bezeichnung der Leistung (optional)</span><input type="text" id="zul-kw" value="${esc(d.keyword)}" placeholder="z. B. Glas, Grundreinigung"></label>
        <label class="check wide"><input type="checkbox" id="zul-special" ${d.onlySpecial ? 'checked' : ''}><span>nur Sonderleistungen</span></label>
      </div>
      <details ${(d.objectIds || []).length ? 'open' : ''}><summary>Ganze Objekte (${objSel.size} gewählt)</summary><div class="zul-objs">${objects.map((o) => `<label class="check"><input type="checkbox" name="zul-obj" value="${esc(o.id)}" ${objSel.has(o.id) ? 'checked' : ''}><span>${esc(o.name)}</span></label>`).join('')}</div></details>
      <details ${(d.taskIds || []).length || q ? 'open' : ''}><summary>Einzelne Leistungen (${sel.size} gewählt)</summary>
        <label class="field"><span>Suchen</span><input type="search" id="zul-q" value="${esc(m.q || '')}" data-input="zul-search" placeholder="Leistung oder Objekt"></label>
        <div class="zul-tasks">${byObj || '<p class="muted">Keine Leistung gefunden.</p>'}</div></details>
      <p class="note">Eine Zulage gilt, wenn eines davon zutrifft (gewählte Leistung, gewähltes Objekt oder Stichwort). Gezählt werden gearbeitete Einsätze laut Plan; Urlaub und Krankenstand zählen nicht.</p>`,
    foot: `<button class="btn" data-action="zul-open">Zurück</button><div class="actions"><button class="btn primary" data-action="zul-save">Speichern</button></div>`,
  })
}
registerModal('zul-edit', editModal, { module: MODULE })

registerActions({
  'zul-open': (el) => {
    if (!seesAccount()) return toast(NO_RIGHT)
    if (el?.dataset?.month) app.ui.zulMonth = el.dataset.month
    openModal({ type: 'zul-list', month: el?.dataset?.month || app.ui.zulMonth || '' })
  },
})

registerActions(
  {
    'zul-edit': (el) => (editable() ? openModal({ type: 'zul-edit', id: el?.dataset?.id || '' }) : toast(NO_RIGHT)),
    'zul-search': () => {
      const m = app.ui.modal
      if (m?.type !== 'zul-edit') return
      readForm(m)
      renderModal()
      const el = document.getElementById('zul-q')
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    },
    'zul-save': () => {
      if (!editable()) return toast(NO_RIGHT)
      const m = app.ui.modal
      const d = readForm(m)
      const problem = allowanceProblem(d)
      if (problem) return toast(problem)
      const now = new Date().toISOString()
      const entry = { ...d, rate: Number(String(d.rate).replace(',', '.')), updatedAt: now, updatedBy: app.user?.name || 'Browser' }
      const all = list()
      const i = all.findIndex((x) => x.id === entry.id)
      if (i >= 0) all[i] = entry
      else all.push(entry)
      persist()
      openModal({ type: 'zul-list' })
      toast(`Zulage „${entry.name}“ gespeichert.${entry.wageType ? '' : ' Ohne Lohnart kommt sie nicht in den Export – bitte die Lohnart eintragen.'}`)
    },
    'zul-del': (el) => {
      if (!confirmStep(`zul-del:${el.dataset.id}`, renderModal)) return
      app.data.allowances = list().filter((x) => x.id !== el.dataset.id)
      persist()
      renderModal()
    },
    'zul-close': () => closeModal(),
  },
  { edit: MODULE },
)
