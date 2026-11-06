// Reklamationen je Objekt: Liste (offen, erledigt, alle; je Objekt), erfassen mit Vorschlag, wer laut
// Plan dort war, Maßnahme und Frist, erledigen mit Ergebnis und „Kunde informiert“, PDF für den Kunden,
// CSV. „Zu erledigen“ meldet überfällige Reklamationen, der Einsatz-Dialog die offenen des Objekts.
// „Antwort mit KI entwerfen“ (Kürzel „kix-“, nur mit eingerichteter KI): Entwurf zum Bearbeiten, sachlich und ohne
// Schuldanerkenntnis (Prüfung in core/ki-vorschlag.js); gesendet wird nie automatisch.

import { complaintList, complaintStats, dayOf, defaultDue, hotspots, isOpen, isOverdue, KINDS, SOURCES, STATUS, whoWorked } from '../../core/complaints.js'
import { addDays, formatDate, todayISO } from '../../core/dates.js'
import { toCSV } from '../../core/reports.js'
import { complaintDocument, complaintPdfName } from '../../export/complaint-pdf.js'
import { app, canEdit, closeModal, computeRange, empName, ensureRange, openModal, persist, registerActions, registerModal, registerObjectHint, registerView, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, checkedValues, download, esc, ICON, modalFrame, options, uid, val } from '../shared.js'
import { kixBox, kixButton, kixConsent, kixFailed, kixSet } from '../kix.js'

const MODULE = 'reklamationen'
const doc = () => (app.data.reklamationen ||= { items: [] })
const items = () => doc().items || (doc().items = [])
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const objName = (id) => objOf(id)?.name || 'Objekt'
const editable = () => canEdit(MODULE) && !app.readOnly
const STATUS_CLASS = { offen: 'warning', arbeit: 'info', erledigt: 'ok' }
const nowIso = () => new Date().toISOString()
const by = () => app.user?.name || 'Browser'
const when = (iso) => (iso ? `${formatDate(iso.slice(0, 10))}${iso.length > 10 ? ` ${new Date(iso).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' })}` : ''}` : '')

function statusPill(c, today) {
  if (isOverdue(c, today)) return `<span class="pill error">überfällig seit ${esc(formatDate(c.due))}</span>`
  return `<span class="pill ${STATUS_CLASS[c.status] || ''}">${esc(STATUS[c.status] || c.status)}</span>`
}

// ---------------------------------------------------------------- Ansicht

function complaintsView() {
  const today = todayISO()
  const filter = app.ui.complaintFilter || 'offen'
  const objectId = app.ui.complaintObject || ''
  const list = complaintList(items(), { status: filter, objectId, today })
  const stats = complaintStats(items(), { from: addDays(today, -89), to: today })
  const hot = hotspots(items(), { today })
  const ed = editable()
  const rows = list
    .map(
      (c) => `<tr class="clickable" data-action="complaint-open" data-id="${esc(c.id)}"><td>${esc(when(c.received))}</td><td>${esc(objName(c.objectId))}</td><td>${esc(c.kind)}</td><td>${esc(c.text.length > 90 ? `${c.text.slice(0, 90)}…` : c.text)}</td><td>${c.due ? esc(formatDate(c.due)) : '–'}</td><td>${statusPill(c, today)}</td></tr>`,
    )
    .join('')
  const tab = (v, label) => `<button class="btn small ${filter === v ? 'primary' : ''}" data-action="complaint-filter" data-v="${v}">${label}</button>`
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const overdue = items().filter((c) => isOverdue(c, today)).length
  return `<div class="section-head"><div><h2>Reklamationen</h2><p>Beschwerden von Kunden je Objekt: wer laut Plan dort war, Maßnahme mit Frist, Ergebnis und Rückmeldung an den Kunden. PDF als Nachweis für den Kunden.</p></div>
      <div class="actions">${ed ? `<button class="btn primary" data-action="complaint-new">${ICON.plus} Reklamation erfassen</button>` : ''}<button class="btn" data-action="complaint-csv">${ICON.download} CSV</button><button class="btn" data-action="mail-export" data-of="complaint-csv" title="Als Anhang per E-Mail senden">${ICON.send} E-Mail</button></div></div>
    <div class="impact-stats tc-stats">${tile('Offen', items().filter(isOpen).length)}${tile('Überfällig', overdue, overdue ? 'err' : '')}${tile('Letzte 90 Tage', stats.total)}${tile('Erledigt nach (Tage, Schnitt)', stats.avgDays ?? '–')}</div>
    ${hot.length ? `<div class="banner warn-banner"><p><strong>Häufung:</strong> ${hot.map((x) => `${esc(objName(x.objectId))} (${x.n} in 90 Tagen)`).join(', ')}. Ursache klären, z. B. Objektkontrolle, Einschulung oder Leistungsumfang.</p></div>` : ''}
    <div class="filters">${tab('offen', 'Offen')}${tab('erledigt', 'Erledigt')}${tab('alle', 'Alle')}
      <label class="field inline"><span>Objekt</span><select id="cp-filter-obj" data-change="complaint-object">${options(app.data.objects.map((o) => [o.id, o.name]), objectId, { empty: 'alle Objekte' })}</select></label></div>
    ${rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Eingang</th><th>Objekt</th><th>Art</th><th>Beschreibung</th><th>Frist</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">${filter === 'offen' ? 'Keine offenen Reklamationen.' : 'Keine Reklamationen.'}</p>`}`
}

registerView({
  id: 'reklamationen',
  order: 72,
  label: 'Reklamationen',
  group: 'service',
  module: MODULE,
  noWeek: true,
  text: 'Beschwerden je Objekt',
  badge: () => items().filter((c) => isOverdue(c, todayISO())).length,
  render: complaintsView,
})

// ---------------------------------------------------------------- Dialog

function draft() {
  const m = app.ui.modal
  if (!m.draft) {
    const existing = m.id ? items().find((c) => c.id === m.id) : null
    const today = todayISO()
    m.draft = existing ? structuredClone(existing) : { id: '', objectId: m.objectId || app.ui.complaintObject || '', date: m.date || today, received: nowIso(), source: SOURCES[0], kind: KINDS[0], text: '', contact: '', employees: [], measure: '', due: defaultDue(KINDS[0], today), status: 'offen', result: '', informed: false, history: [] }
  }
  return m.draft
}

function readForm() {
  const d = draft()
  if (!document.getElementById('cp-text')) return d
  const kind = val('cp-kind')
  if (kind !== d.kind && (!d.id || !d.due || d.due === defaultDue(d.kind, dayOf(d.received)))) d.due = defaultDue(kind, dayOf(d.received))
  else d.due = val('cp-due')
  const reply = document.getElementById('kix-rek-text')
  if (reply && app.ui.modal.kixAntwort) app.ui.modal.kixAntwort.text = reply.value
  Object.assign(d, { objectId: val('cp-obj'), date: val('cp-date'), source: val('cp-source'), kind, text: val('cp-text').trim(), contact: val('cp-contact').trim(), measure: val('cp-measure').trim(), status: val('cp-status') || d.status, result: val('cp-result').trim(), informed: checked('cp-informed'), employees: checkedValues('cp-emp') })
  return d
}

/** Aus dem Kundenbereich: Hinweis, dass der Kunde Status und Ergebnis sieht, und sein Foto (SharePoint oder noch am Webspace). */
function portalNote(d) {
  if (!d.portal && !d.photos?.length) return ''
  const photos = (d.photos || []).map((p) => (p.url ? `<a class="btn small" href="${esc(p.url)}" target="_blank" rel="noopener">${ICON.camera || ''} Foto in SharePoint öffnen</a>` : p.datei ? `<div data-kb-photo><button class="btn small" data-action="kb-photo" data-file="${esc(p.datei)}">${ICON.camera || ''} Foto vom Kunden laden</button></div>` : '')).join(' ')
  return `<div class="note">${d.portal ? 'Gemeldet über den <strong>Kundenbereich</strong>: Der Kunde sieht dort den Status und, wenn erledigt, das Ergebnis.' : ''}${photos ? `<p>${photos}</p>` : ''}</div>`
}

function complaintModal() {
  const d = draft()
  const ed = editable()
  // wer laut Plan am Tag (und am Vortag) im Objekt war
  let worked = []
  try {
    if (d.objectId && d.date) {
      const r = computeRange(addDays(d.date, -1), d.date)
      worked = whoWorked({ instances: r.instances, state: r.state, objectId: d.objectId, date: d.date })
    }
  } catch {
    worked = []
  }
  const people = [...new Set([...worked.map((w) => w.empId), ...d.employees])]
  const plan = people.length
    ? people.map((id) => `<label class="check"><input type="checkbox" name="cp-emp" value="${esc(id)}" ${d.employees.includes(id) ? 'checked' : ''} ${ed ? '' : 'disabled'}><span>${esc(empName(id))}${worked.filter((w) => w.empId === id).map((w) => ` <span class="muted">· ${esc(formatDate(w.date))} ${esc(w.time)}${w.label ? ` ${esc(w.label)}` : ''}</span>`).join('')}</span></label>`).join('')
    : '<p class="muted">Laut Plan niemand an diesem Tag oder am Vortag (oder die Woche ist noch nicht geladen).</p>'
  const dis = ed ? '' : 'disabled'
  return modalFrame({
    title: d.id ? `Reklamation ${objName(d.objectId)}` : 'Reklamation erfassen',
    subtitle: d.id ? `Eingang ${esc(when(d.received))} · ${esc(STATUS[d.status])}` : '',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Objekt</span><select id="cp-obj" data-change="complaint-redraw" ${dis}>${options(app.data.objects.map((o) => [o.id, o.name]), d.objectId, { empty: '– wählen –' })}</select></label>
        <label class="field"><span>Betrifft den (Tag des Mangels)</span><input type="date" id="cp-date" value="${esc(d.date)}" data-change="complaint-redraw" ${dis}></label>
        <label class="field"><span>Eingang über</span><select id="cp-source" ${dis}>${options(SOURCES.map((s) => [s, s]), d.source)}</select></label>
        <label class="field"><span>Art</span><select id="cp-kind" data-change="complaint-redraw" ${dis}>${options(KINDS.map((k) => [k, k]), d.kind)}</select></label>
        <label class="field wide"><span>Beschreibung (was genau, wo im Objekt)</span><textarea id="cp-text" rows="3" ${dis}>${esc(d.text)}</textarea></label>
        <label class="field"><span>Ansprechperson beim Kunden</span><input type="text" id="cp-contact" value="${esc(d.contact)}" placeholder="Name, Telefon" ${dis}></label>
      </div>
      ${portalNote(d)}
      <section><h3>Laut Plan dort</h3><div class="form-grid">${plan}</div><p class="note">Nur zur Klärung intern; im PDF für den Kunden stehen keine Namen.</p></section>
      <section><h3>Maßnahme</h3><div class="form-grid">
        <label class="field wide"><span>Was wird getan (z. B. Nachreinigung, Gespräch, Einschulung)</span><textarea id="cp-measure" rows="2" ${dis}>${esc(d.measure)}</textarea></label>
        <label class="field"><span>Frist</span><input type="date" id="cp-due" value="${esc(d.due || '')}" ${dis}></label>
        <label class="field"><span>Status</span><select id="cp-status" ${dis}>${options(Object.entries(STATUS), d.status)}</select></label>
        <label class="field wide"><span>Ergebnis / Rückmeldung an den Kunden</span><textarea id="cp-result" rows="2" ${dis}>${esc(d.result)}</textarea></label>
        <label class="check"><input type="checkbox" id="cp-informed" ${d.informed ? 'checked' : ''} ${dis}><span>Kunde informiert</span></label>
      </div>${ed ? replyHtml() : ''}</section>
      ${d.history?.length ? `<section><h3>Verlauf</h3><ul class="tc-list">${d.history.map((h) => `<li>${esc(when(h.at))} ${esc(h.by || '')}: ${esc(h.text)}</li>`).join('')}</ul></section>` : ''}`,
    foot: `${d.id ? `<span class="actions"><button class="btn" data-action="complaint-pdf" data-id="${esc(d.id)}">${ICON.download} PDF für den Kunden</button><button class="btn" data-action="mail-export" data-of="complaint-pdf" data-id="${esc(d.id)}" title="Als Anhang per E-Mail senden">${ICON.send} E-Mail</button></span>` : '<span></span>'}
      <div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? `${d.id && d.status !== 'erledigt' ? `<button class="btn" data-action="complaint-save" data-done="1">Erledigt</button>` : ''}<button class="btn primary" data-action="complaint-save">Speichern</button>` : ''}</div>`,
  })
}

registerModal('complaint', complaintModal, { module: MODULE })

/** Antwort an den Kunden mit KI entwerfen: Knopf, Hinweis/Fortschritt, Entwurf zum Bearbeiten (nie automatisch gesendet). */
function replyHtml() {
  const a = app.ui.modal?.kixAntwort
  const button = kixButton('<p class="kix-diktat-bar"><button type="button" class="btn kix-btn" data-action="kix-rek">Antwort mit KI entwerfen</button><span class="muted small">Entwurf zum Bearbeiten, sachlich und ohne Schuldanerkenntnis</span></p>')
  if (!a) return `${button}${kixBox('rek')}`
  return `${button}${kixBox('rek')}<div class="kix-draft">
      <label class="field wide"><span><span class="kix-tag">KI</span> Entwurf der Antwort${a.betreff ? ` – Betreff: ${esc(a.betreff)}` : ''}</span><textarea id="kix-rek-text" rows="8">${esc(a.text)}</textarea></label>
      ${a.warnings.length ? `<p class="warn-text">Bitte prüfen, klingt nach Zusage oder Schuldanerkenntnis: ${esc(a.warnings.join(', '))}.</p>` : ''}
      <p class="note">Vorschlag der KI: lesen, anpassen, dann selbst senden (z. B. als E-Mail) oder in die Rückmeldung übernehmen. Nichts wird automatisch verschickt.</p>
      <div class="actions"><button type="button" class="btn small" data-action="kix-rek-copy">Kopieren</button><button type="button" class="btn small" data-action="kix-rek-take">In „Rückmeldung an den Kunden“ übernehmen</button></div></div>`
}

function save(d, { done = false } = {}) {
  if (!d.objectId) return toast('Bitte das Objekt wählen.')
  if (!d.text) return toast('Bitte beschreiben, worum es geht.')
  if (done && !d.result) return toast('Zum Erledigen bitte das Ergebnis eintragen (was getan wurde).')
  const list = items()
  const old = d.id ? list.find((c) => c.id === d.id) : null
  const history = [...(old?.history || [])]
  const entry = { ...d }
  if (done) entry.status = 'erledigt'
  if (!old) {
    entry.id = uid('r')
    entry.by = by()
    history.push({ at: nowIso(), by: by(), text: `erfasst (${entry.kind}, ${entry.source})` })
  } else {
    if (old.status !== entry.status) history.push({ at: nowIso(), by: by(), text: `Status: ${STATUS[entry.status]}` })
    if (old.measure !== entry.measure && entry.measure) history.push({ at: nowIso(), by: by(), text: `Maßnahme: ${entry.measure}` })
    if (!old.informed && entry.informed) history.push({ at: nowIso(), by: by(), text: 'Kunde informiert' })
  }
  entry.doneAt = entry.status === 'erledigt' ? old?.doneAt || nowIso() : null
  entry.history = history
  doc().items = old ? list.map((c) => (c.id === old.id ? entry : c)) : [...list, entry]
  persist()
  closeModal()
  renderNow()
  toast(old ? (done ? 'Reklamation erledigt.' : 'Gespeichert.') : `Reklamation erfasst, Frist ${formatDate(entry.due)}.`)
}

const csvColumns = [
  ['Eingang', (c) => when(c.received)],
  ['Objekt', (c) => objName(c.objectId)],
  ['Betrifft den', (c) => c.date],
  ['Quelle', (c) => c.source],
  ['Art', (c) => c.kind],
  ['Beschreibung', (c) => c.text],
  ['Maßnahme', (c) => c.measure],
  ['Frist', (c) => c.due || ''],
  ['Status', (c) => STATUS[c.status]],
  ['Erledigt am', (c) => (c.doneAt ? dayOf(c.doneAt) : '')],
  ['Ergebnis', (c) => c.result],
  ['Kunde informiert', (c) => (c.informed ? 'ja' : 'nein')],
]

registerActions({
  'complaint-filter': (el) => {
    app.ui.complaintFilter = el.dataset.v
    renderNow()
  },
  'complaint-object': () => {
    app.ui.complaintObject = val('cp-filter-obj')
    renderNow()
  },
  'complaint-open': (el) => openModal({ type: 'complaint', id: el.dataset.id }),
  'complaint-redraw': async () => {
    const d = readForm()
    if (d.date) await ensureRange(addDays(d.date, -1), d.date).catch(() => {})
    renderModal()
  },
  'complaint-pdf': async (el) => {
    const c = items().find((x) => x.id === el.dataset.id)
    if (!c) return
    const obj = objOf(c.objectId) || {}
    download(complaintPdfName(c, obj.name || ''), await pdfBlob(complaintDocument({ complaint: c, object: obj, brand: app.config.brand, logo: await loadLogo().catch(() => null) })))
  },
  'complaint-csv': () => download(`Reklamationen_${todayISO()}.csv`, new Blob([`﻿${toCSV(complaintList(items(), { status: 'alle', today: todayISO() }), csvColumns)}`], { type: 'text/csv;charset=utf-8' })),
})

registerActions(
  {
    'complaint-new': async (el) => {
      if (el.dataset.date) await ensureRange(addDays(el.dataset.date, -1), el.dataset.date).catch(() => {})
      openModal({ type: 'complaint', objectId: el.dataset.obj || '', date: el.dataset.date || '' })
    },
    'complaint-save': (el) => save(readForm(), { done: !!el.dataset.done }),
    'kix-rek': async (el) => {
      const m = app.ui.modal
      if (m?.type !== 'complaint' || m.kix?.rek?.busy) return
      const d = readForm()
      if (!d.text) return toast('Bitte zuerst beschreiben, worum es geht.')
      if (!el?.dataset?.consent && !kixConsent('rek', 'Die Beschreibung der Reklamation mit Objekt, Maßnahme und Ergebnis (ohne Namen von Mitarbeitenden)', { action: 'kix-rek' })) return
      kixSet('rek', { busy: 'Die KI entwirft die Antwort …' })
      try {
        const { draftComplaintReply } = await import('../../ai/extract.js')
        const res = await draftComplaintReply({ objectName: objName(d.objectId), kind: d.kind, date: d.date, text: d.text, measure: d.measure, due: d.due, status: STATUS[d.status] || d.status, result: d.result })
        if (app.ui.modal !== m) return
        readForm()
        m.kixAntwort = res
        m.kix = { ...m.kix, rek: {} }
        renderModal()
        document.getElementById('kix-rek-text')?.focus({ preventScroll: true })
      } catch (err) {
        if (app.ui.modal === m) kixSet('rek', { error: kixFailed(err) })
      }
    },
    'kix-rek-copy': async () => {
      const t = val('kix-rek-text')
      try {
        await navigator.clipboard.writeText(t)
        toast('Entwurf kopiert.')
      } catch {
        document.getElementById('kix-rek-text')?.select()
        toast('Bitte markieren und kopieren (Strg+C).')
      }
    },
    'kix-rek-take': () => {
      const m = app.ui.modal
      const d = readForm()
      const t = val('kix-rek-text').trim()
      if (!t) return
      d.result = d.result ? `${d.result}\n\n${t}` : t
      m.kixAntwort = null
      renderModal()
      toast('In „Rückmeldung an den Kunden“ übernommen. Bitte prüfen und speichern.')
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Zu erledigen, Objekt-Hinweis

registerTodo({
  id: 'reklamationen',
  module: MODULE,
  title: 'Reklamationen',
  compute: (today) => items().filter((c) => isOverdue(c, today)).map((c) => ({ ...c, id: `${c.id}:${c.due}` })),
  render: (list) =>
    list
      .map((c) => `<div class="todo-item"><span class="flag error">!</span><div class="todo-text"><strong>${esc(objName(c.objectId))}</strong>: ${esc(c.kind)}, Frist ${esc(formatDate(c.due))} vorbei<br><span class="muted">${esc(c.text.slice(0, 120))}</span></div><button class="btn small primary" data-action="complaint-open" data-id="${esc(c.id.split(':')[0])}">Öffnen</button></div>`)
      .join(''),
})

registerObjectHint({
  module: MODULE,
  html: (objectId) => {
    const open = items().filter((c) => c.objectId === objectId && isOpen(c))
    return open.length ? `<strong>${open.length} offene ${open.length === 1 ? 'Reklamation' : 'Reklamationen'}</strong>: ${open.map((c) => esc(c.kind)).join(', ')} <button class="btn small" data-action="complaint-open" data-id="${esc(open[0].id)}">Ansehen</button>` : ''
  },
})
