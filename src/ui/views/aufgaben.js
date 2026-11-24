// Interne Aufgaben: wer macht was bis wann (Rechenkern core/aufgaben.js). Ansicht „Aufgaben“ mit den Reitern Meine,
// Alle offenen, Überfällig, Erledigt, Alle und einer Suche; Dialog zum Anlegen und Ändern (Titel, Notiz, Objekt,
// zuständig, fällig am, dringend, Status, Kommentare, Verlauf); „Erledigt“ mit einem Klick; E-Mail an die zuständige
// Person; „Zu erledigen“ meldet eigene überfällige, bald fällige und neue Aufgaben. Ablage aufgaben/aufgaben.json,
// alle Rollen mit dem Bereich „Aufgaben“ lesen und schreiben dieselbe Datei. Kürzel der Aktionen und Dialoge: „aufg-“.

import { addComment, assigneeChoices, createTask, dueText, emptyAufgaben, FILTERS, isMine, isOpen, isOverdue, normalizeTask, PRIORITY, setStatus, STATUS, taskAlerts, taskMail, taskProblem, taskRows, taskSummary, updateTask, upgradeAufgaben } from '../../core/aufgaben.js'
import { formatDate, todayISO } from '../../core/dates.js'
import { app, canEdit, closeModal, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { openCompose } from '../mailer.js'
import { invalidateTodo, registerTodo } from '../modals/todo.js'
import { checked, esc, ICON, modalFrame, options, tabBar, uid, val } from '../shared.js'

const MODULE = 'aufgaben'
const VIEW = 'aufgaben'
const ICON_AUFG = '<rect x="4" y="4.5" width="16" height="16" rx="2.5"/><path d="M8 3v3M16 3v3"/><path d="m8.5 13 2.4 2.4 4.6-5"/>'

const doc = () => upgradeAufgaben((app.data.aufgaben ||= emptyAufgaben()))
const items = () => doc().items
const taskOf = (id) => items().find((t) => t.id === id) || null
const me = () => ({ name: app.user?.name || 'Browser', email: app.user?.email || '' })
const stamp = () => ({ now: new Date().toISOString(), by: me().name })
const editable = () => canEdit(MODULE) && !app.readOnly
const objName = (id) => (id ? (app.data.objects || []).find((o) => o.id === id)?.name || '' : '')
const short = (iso) => (iso ? formatDate(iso, { weekday: false, year: true }) : '')
const atText = (iso) => (iso ? new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

const filter = () => (Object.hasOwn(FILTERS, app.ui.aufgFilter) ? app.ui.aufgFilter : 'meine')

function duePill(t, today) {
  const txt = dueText(t, today)
  if (!txt) return ''
  const cls = !isOpen(t) ? 'na' : isOverdue(t, today) ? 'error' : /heute|morgen/.test(txt) ? 'warning' : 'info'
  return `<span class="pill ${cls}">${esc(txt)}</span>`
}

function row(t, today, ed) {
  const who = t.assignee ? esc(t.assignee.name) : '<span class="muted">niemand</span>'
  const obj = objName(t.objectId)
  const done = !isOpen(t)
  const quick = ed
    ? done
      ? `<button class="btn small ghost" data-action="aufg-status" data-id="${esc(t.id)}" data-v="offen">Wieder öffnen</button>`
      : `${t.status === 'offen' ? `<button class="btn small" data-action="aufg-status" data-id="${esc(t.id)}" data-v="in-arbeit">In Arbeit</button>` : ''}<button class="btn small primary" data-action="aufg-status" data-id="${esc(t.id)}" data-v="erledigt">${ICON.check} Erledigt</button>`
    : ''
  return `<li class="aufg-row ${done ? 'done' : ''}" data-id="${esc(t.id)}">
      <button type="button" class="aufg-main" data-action="aufg-open" data-id="${esc(t.id)}">
        <span class="aufg-title">${esc(t.title)}</span>
        <span class="aufg-meta">${who}${obj ? ` · ${esc(obj)}` : ''}${done && t.doneAt ? ` · erledigt am ${esc(short(t.doneAt.slice(0, 10)))}${t.doneBy ? ` von ${esc(t.doneBy)}` : ''}` : ''}</span>
      </button>
      <span class="aufg-pills">${t.priority === 'hoch' && !done ? '<span class="pill error">dringend</span>' : ''}${t.status === 'in-arbeit' ? '<span class="pill info">in Arbeit</span>' : ''}${duePill(t, today)}</span>
      <span class="aufg-acts">${quick}</span>
    </li>`
}

function aufgabenView() {
  const today = todayISO()
  const ed = editable()
  const sum = taskSummary(items(), { me: me(), today })
  const f = filter()
  const q = app.ui.aufgQuery || ''
  const rows = taskRows(items(), { filter: f, me: me(), today, query: q, objectName: objName })
  const tabs = [
    { id: 'meine', label: 'Meine', flag: sum.mine },
    { id: 'offen', label: 'Alle offenen', flag: sum.open },
    { id: 'ueberfaellig', label: 'Überfällig', flag: sum.overdue },
    { id: 'erledigt', label: 'Erledigt' },
    { id: 'alle', label: 'Alle' },
  ]
  const empty = !items().length
    ? `<div class="banner welcome"><p><strong>Noch keine Aufgaben.</strong> Hier hältst du fest, wer im Büro was bis wann erledigt: Angebot nachfassen, Schlüssel nachmachen lassen, Lieferanten anrufen. Die zuständige Person sieht ihre Aufgaben beim Öffnen der App unter „Zu erledigen“.</p>${ed ? `<button class="btn primary" data-action="aufg-new">${ICON.plus} Erste Aufgabe anlegen</button>` : ''}</div>`
    : !rows.length
      ? `<p class="empty">${q ? 'Keine Aufgabe passt zur Suche.' : f === 'meine' ? 'Für dich ist nichts offen.' : f === 'ueberfaellig' ? 'Nichts überfällig.' : f === 'erledigt' ? 'Noch nichts erledigt.' : 'Keine offenen Aufgaben.'}</p>`
      : ''
  return `<div class="section-head"><div><h2>Aufgaben</h2><p>Wer macht was bis wann: Aufgaben anlegen, jemandem zuweisen und abhaken. Eigene überfällige und bald fällige Aufgaben stehen auch unter „Zu erledigen“.</p></div>
      <div class="actions">${ed ? `<button class="btn primary" data-action="aufg-new">${ICON.plus} Neue Aufgabe</button>` : ''}</div></div>
    ${sum.unassigned && f !== 'meine' ? `<p class="note">${sum.unassigned === 1 ? 'Eine offene Aufgabe hat' : `${sum.unassigned} offene Aufgaben haben`} noch niemanden, der zuständig ist.</p>` : ''}
    <div class="aufg-bar">${tabBar({ action: 'aufg-filter', current: f, tabs })}
      <label class="field inline aufg-search"><span class="visually-hidden">Aufgaben durchsuchen</span><input type="search" id="aufg-q" value="${esc(q)}" placeholder="Suchen …" data-input="aufg-query" autocomplete="off"></label></div>
    ${empty}
    ${rows.length ? `<ul class="aufg-list">${rows.map((t) => row(t, today, ed)).join('')}</ul>` : ''}`
}

registerView({
  id: 'aufgaben',
  order: 0.5,
  label: 'Aufgaben',
  group: 'start',
  module: MODULE,
  icon: ICON_AUFG,
  noWeek: true,
  text: 'Interne Aufgaben: wer macht was bis wann, zuweisen, abhaken',
  badge: () => taskSummary(items(), { me: me(), today: todayISO() }).mine,
  render: aufgabenView,
})

// ---------------------------------------------------------------- Dialog

function draftOf(m) {
  if (!m.draft) {
    const t = m.id ? taskOf(m.id) : null
    m.draft = t ? { title: t.title, note: t.note || '', objectId: t.objectId || '', assigneeName: t.assignee?.name || '', assigneeEmail: t.assignee?.email || '', due: t.due || '', priority: t.priority || 'normal', status: t.status || 'offen' } : { title: m.title || '', note: '', objectId: m.objectId || '', assigneeName: me().name, assigneeEmail: me().email, due: '', priority: 'normal', status: 'offen' }
  }
  return m.draft
}

function readDraft() {
  const m = app.ui.modal
  if (m?.type !== 'aufgabe') return null
  const d = draftOf(m)
  if (!document.getElementById('aufg-title')) return d
  d.title = val('aufg-title')
  d.note = val('aufg-note')
  d.objectId = val('aufg-object')
  const name = val('aufg-who').trim()
  // E-Mail bleibt nur, solange der Name zur bekannten Person passt
  const known = assigneeChoices(items(), { employees: app.data.employees || [], me: me() }).find((c) => c.name.toLowerCase() === name.toLowerCase())
  d.assigneeEmail = known?.email || (name.toLowerCase() === (d.assigneeName || '').toLowerCase() ? d.assigneeEmail : '')
  d.assigneeName = name
  d.rawDue = val('aufg-due')
  d.due = d.rawDue
  d.priority = checked('aufg-prio') ? 'hoch' : 'normal'
  if (document.getElementById('aufg-status')) d.status = val('aufg-status')
  d.comment = val('aufg-comment')
  return d
}

function aufgabeModal(c, m) {
  const t = m.id ? taskOf(m.id) : null
  if (m.id && !t) return modalFrame({ title: 'Aufgabe', body: '<p>Diese Aufgabe gibt es nicht mehr.</p>', foot: '<div class="actions"><button class="btn" data-action="close-modal">Schließen</button></div>' })
  const d = draftOf(m)
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const today = todayISO()
  const people = assigneeChoices(items(), { employees: app.data.employees || [], me: me() })
  const objects = (app.data.objects || []).filter((o) => o.active !== false || o.id === d.objectId).map((o) => [o.id, o.name])
  const log = t
    ? (t.log || [])
        .slice()
        .reverse()
        .map((l) => `<li class="${l.comment ? 'comment' : ''}"><span class="muted">${esc(atText(l.at))}${l.by ? ` · ${esc(l.by)}` : ''}</span><br>${esc(l.text)}</li>`)
        .join('')
    : ''
  const confirmDel = t && app.ui.confirm === `aufg-del:${t.id}`
  return modalFrame({
    title: t ? 'Aufgabe' : 'Neue Aufgabe',
    subtitle: t ? esc([STATUS[t.status], dueText(t, today)].filter(Boolean).join(' · ')) : '',
    body: `<div class="form-grid">
        <label class="field wide"><span>Was ist zu tun?</span><input type="text" id="aufg-title" value="${esc(d.title)}" maxlength="200" placeholder="z. B. Angebot Wohnanlage Lehen nachfassen" autocomplete="off" ${dis}></label>
        <label class="field"><span>Zuständig</span><input type="text" id="aufg-who" list="aufg-people" value="${esc(d.assigneeName)}" placeholder="Name (leer = noch niemand)" autocomplete="off" ${dis}><datalist id="aufg-people">${people.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist></label>
        <label class="field"><span>Fällig am</span><input type="date" id="aufg-due" value="${esc(d.due)}" ${dis}></label>
        <label class="field"><span>Objekt (optional)</span><select id="aufg-object" ${dis}>${options(objects, d.objectId, { empty: '– kein Objekt –' })}</select></label>
        ${t ? `<label class="field"><span>Status</span><select id="aufg-status" ${dis}>${options(Object.entries(STATUS), d.status)}</select></label>` : ''}
        <label class="check wide"><input type="checkbox" id="aufg-prio" ${d.priority === 'hoch' ? 'checked' : ''} ${dis}><span>${esc(PRIORITY.hoch)} (steht in der Liste oben und rot markiert)</span></label>
        <label class="field wide"><span>Notiz (optional)</span><textarea id="aufg-note" rows="3" placeholder="Einzelheiten, Telefonnummer, was schon versucht wurde" ${dis}>${esc(d.note)}</textarea></label>
        ${t && ed ? `<label class="field wide"><span>Kommentar hinzufügen</span><input type="text" id="aufg-comment" value="${esc(d.comment || '')}" placeholder="z. B. Kunde meldet sich am Donnerstag" autocomplete="off"></label>` : ''}
      </div>
      <p class="note">Aufgaben sehen alle im Büro, die den Bereich „Aufgaben“ haben. Bitte nichts Vertrauliches hineinschreiben (Lohn, Krankheit).</p>
      ${log ? `<h3>Verlauf</h3><ul class="aufg-log">${log}</ul>` : ''}`,
    foot: `<div class="actions">${t && ed ? `<button class="btn danger" data-action="aufg-delete" data-id="${esc(t.id)}">${confirmDel ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}${t && t.assignee ? `<button class="btn" data-action="aufg-mail" data-id="${esc(t.id)}">${ICON.send} Per E-Mail senden</button>` : ''}</div>
      <div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? '<button class="btn primary" data-action="aufg-save">Speichern</button>' : ''}</div>`,
  })
}
registerModal('aufgabe', aufgabeModal, { module: MODULE })

function save() {
  const m = app.ui.modal
  const d = readDraft()
  if (!d) return
  const problem = taskProblem(d, { rawDue: d.rawDue })
  if (problem) return toast(problem)
  const fields = normalizeTask(d)
  if (m.id) {
    const t = taskOf(m.id)
    if (!t) return closeModal()
    let next = updateTask(t, fields, stamp())
    next = addComment(next, d.comment, stamp())
    doc().items = items().map((x) => (x.id === t.id ? next : x))
  } else {
    doc().items = [...items(), createTask(fields, { ...stamp(), newId: () => uid('au') })]
    // neu angelegt für jemand anderen: im Reiter „Alle offenen“ zeigen, sonst sähe man sie nicht
    if (!isMine({ assignee: fields.assignee }, me()) && filter() === 'meine') app.ui.aufgFilter = 'offen'
  }
  persist()
  invalidateTodo()
  closeModal()
  renderNow()
  toast(m.id ? 'Aufgabe gespeichert.' : 'Aufgabe angelegt.')
}

// ---------------------------------------------------------------- Aktionen

registerActions({
  // aus „Zu erledigen“, der Startseite und dem Menü „Neu“
  'aufg-goto': (el) => {
    if (Object.hasOwn(FILTERS, el?.dataset?.filter)) app.ui.aufgFilter = el.dataset.filter
    app.ui.view = VIEW
    closeModal()
    renderNow()
  },
  'aufg-filter': (el) => {
    app.ui.aufgFilter = el.dataset.v || 'meine'
    renderNow()
  },
  'aufg-query': (el) => {
    app.ui.aufgQuery = el.value
    renderNow()
    const input = document.getElementById('aufg-q')
    if (input) {
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }
  },
  'aufg-open': (el) => openModal({ type: 'aufgabe', id: el.dataset.id }),
  'aufg-mail': (el) => {
    const t = taskOf(el.dataset.id)
    if (!t) return
    const mail = taskMail(t, { objectName: objName(t.objectId), sender: me().name, today: todayISO() })
    openCompose({ to: t.assignee?.email || '', subject: mail.subject, text: mail.text, origin: 'Aufgabe' })
  },
})

registerActions(
  {
    'aufg-new': (el) => openModal({ type: 'aufgabe', id: '', objectId: el?.dataset?.obj || '', title: el?.dataset?.title || '' }),
    'aufg-save': () => save(),
    'aufg-status': (el) => {
      const t = taskOf(el.dataset.id)
      if (!t || !Object.hasOwn(STATUS, el.dataset.v)) return
      doc().items = items().map((x) => (x.id === t.id ? setStatus(t, el.dataset.v, stamp()) : x))
      persist()
      invalidateTodo()
      renderNow()
      toast(el.dataset.v === 'erledigt' ? 'Erledigt.' : el.dataset.v === 'in-arbeit' ? 'In Arbeit.' : 'Wieder offen.')
    },
    'aufg-delete': (el) => {
      const t = taskOf(el.dataset.id)
      if (!t) return closeModal()
      const key = `aufg-del:${t.id}`
      if (app.ui.confirm !== key) {
        readDraft()
        app.ui.confirm = key
        return renderModal()
      }
      app.ui.confirm = null
      doc().items = items().filter((x) => x.id !== t.id)
      persist()
      invalidateTodo()
      closeModal()
      renderNow()
      toast('Aufgabe gelöscht.')
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'aufgaben',
  module: MODULE,
  title: 'Aufgaben',
  compute: (today) => taskAlerts(items(), { me: me(), today }),
  render: (list) =>
    list
      .slice(0, 8)
      .map((a) => `<div class="todo-item"><span class="flag ${/überfällig/.test(a.why) ? 'error' : 'warning'}">!</span><div class="todo-text"><strong>${esc(a.task.title)}</strong><br><span class="muted">${esc(a.why)}${objName(a.task.objectId) ? ` · ${esc(objName(a.task.objectId))}` : ''}</span></div><button class="btn small primary" data-action="aufg-open" data-id="${esc(a.task.id)}">Öffnen</button></div>`)
      .join('') + (list.length > 8 ? `<div class="todo-item"><div class="todo-text muted">und ${list.length - 8} weitere unter „Aufgaben“</div><button class="btn small" data-action="aufg-goto" data-filter="meine">Alle zeigen</button></div>` : ''),
})
