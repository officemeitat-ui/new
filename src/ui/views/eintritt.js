// Eintritt & Austritt (Personalverwaltung, Lohnverrechnung): Checkliste je Person mit Frist, erledigt von/am und
// Fortschritt. Eintritt: Anmeldung bei der ÖGK (nur als Aufgabe, kein Versand), Dienstvertrag/Dienstzettel, Daten für
// die Lohnverrechnung, Pflicht-Unterweisungen (verknüpft mit „Unterweisungen & Fristen“), Betriebsanweisungen,
// Schlüssel (verknüpft mit dem Schlüsselbuch: Ausgabe mit Quittung), Dienstkleidung (Größen, Ausgabe aus dem Lager),
// Einschulung im Objekt (Termin unter „Termine“ – so sieht ihn auch die Objektleitung), Link „Plan am Handy“, Sprache
// am Handy. Austritt: offene Schlüssel, Dienstkleidung zurück, Abmeldung bei der ÖGK, Zeitkonto und Resturlaub
// (nur anzeigen, nichts wird ausbezahlt), Link deaktivieren, betroffene Einsätze nach dem Austritt (die Planung
// entscheidet), Dienstzeugnis. Vorlagen änderbar. Datei eintritt/eintritt.json (Rechenkern: core/bewerber.js).
// Bewerbungen: views/bewerber.js. Aktionen und Dialoge mit dem Kürzel „bew-“.

import { AUSTRITT_DEFAULTS, addTask, checklistAttention, EINTRITT_DEFAULTS, emptyEintritt, futureWork, keyCheck, linkedOf, markDone, markOpen, moveList, nextTask, payrollGaps, payrollText, progress, startList, TASK_TYPES, taskState, templateOf, trainingCheck } from '../../core/bewerber.js'
import { addDays, formatDate, formatHours, mondayOf, todayISO } from '../../core/dates.js'
import { mergeRules } from '../../core/rules.js'
import { timeAccount, vacationSummary } from '../../core/reports.js'
import { LANGUAGES, langLabel, langOf, linkMessage } from '../../core/sprachen.js'
import { newCode, personalLink, sha256Hex } from '../../core/staffplan.js'
import { app, canEdit, closeModal, computeRange, confirmStep, ensureRange, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, seesAbsenceReasons, seesAccount, toast, visibleViews } from '../context.js'
import { eintrittContext } from '../eintritt-ctx.js'
import { openCompose } from '../mailer.js'
import { registerTodo } from '../modals/todo.js'
import { portalSettings, sendWeeks } from '../staffplan.js'
import { checked, dayAt, esc, euro, ICON, menu, modalFrame, options, tabBar, uid, val } from '../shared.js'
import { onAppointmentSaved } from './appointments.js'

const MODULE = 'eintritt'
const ICON_EIN = '<path d="M4 4.5h10.5v15H4z"/><path d="M7 9h4.5M7 12.5h4.5M7 16h2.5"/><path d="m14.5 15.5 2 2 4-4.5"/>'
const doc = () => {
  const d = (app.data.eintritt ||= emptyEintritt())
  d.lists ||= []
  d.templates ||= {}
  d.settings ||= {}
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const empOf = (id) => app.data.employees.find((e) => e.id === id)
const empName = (id) => empOf(id)?.name || 'Person'
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const listOf = (id) => doc().lists.find((l) => l.id === id)
const sees = (m) => !app.access || app.access.sees(m)
const short = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const day = (d) => (d ? formatDate(d, { year: true }) : '–')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const KIND_TEXT = { eintritt: 'Eintritt', austritt: 'Austritt' }
const DATE_TEXT = { eintritt: 'erster Arbeitstag', austritt: 'letzter Arbeitstag' }
const STATE_CLS = { erledigt: 'ok', ueberfaellig: 'error', faellig: 'warning', offen: '' }
const STATE_TEXT = { erledigt: 'erledigt', ueberfaellig: 'überfällig', faellig: 'fällig', offen: 'offen' }
const address = () => new URL('.', location.href).href
const product = () => app.config.brand?.app || app.config.brand?.name || 'Dienstplan'
const mayStamm = () => (canEdit('stammdaten') || canEdit('planung')) && !app.readOnly

/** Frist als Text: „überfällig seit …“, „bis …“. */
function dueText(task, state) {
  if (state === 'erledigt') return ''
  if (state === 'ueberfaellig') return `überfällig seit ${day(task.due)}`
  return `bis ${day(task.due)}`
}

/** Checkliste starten (auch aus der Bewerbung, views/bewerber.js): neue Liste in der Datei. */
export function startChecklist({ kind, empId, date, applicantId = '' }) {
  const list = startList({ kind, empId, applicantId, date, template: templateOf(doc(), kind), newId: () => uid('el'), at: nowIso(), by: user() })
  doc().lists.push(list)
  return list
}

/** Checkliste dieser Person (nicht abgeschlossen), sonst null. */
export const openListOf = (empId, kind) => doc().lists.find((l) => l.empId === empId && l.kind === kind && !l.closedAt) || null

const ctxNow = () => eintrittContext(todayISO())
/** Rollen ohne das Modul: keine Dialoge (die Daten lädt die App für sie ohnehin nicht). */
const mayOpen = () => !app.access || app.access.sees(MODULE) || (toast('Eintritt & Austritt ist für dein Konto nicht freigegeben.'), false)
const progressBar = (p) => `<div class="bew-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}" aria-label="Fortschritt"><span style="width:${p.pct}%"></span></div><span class="bew-progress-text">${p.done} von ${p.total} erledigt</span>`

// ---------------------------------------------------------------- Ansicht

function eintrittView() {
  const ctx = ctxNow()
  const ed = editable()
  const kind = app.ui.bewKind === 'austritt' ? 'austritt' : 'eintritt'
  const all = doc().lists
  const showClosed = !!app.ui.bewClosed
  const att = checklistAttention(all, ctx)
  const count = (k) => all.filter((l) => l.kind === k && !l.closedAt).length
  const urgent = (k) => att.filter((g) => g.list.kind === k && g.urgent).length
  const tabs = tabBar({
    action: 'bew-kind',
    current: kind,
    tabs: [
      { id: 'eintritt', label: 'Eintritt', flag: urgent('eintritt') || count('eintritt') },
      { id: 'austritt', label: 'Austritt', flag: urgent('austritt') || count('austritt') },
    ],
  })
  const head = `<div class="section-head"><div><h2>Eintritt &amp; Austritt</h2><p>Checkliste je Person: jede Aufgabe mit Frist, wer sie wann erledigt hat und Fortschritt. Unterweisungen, Schlüssel, Plan am Handy und Einsätze sind verknüpft und gelten von selbst als erledigt, wenn die Daten es zeigen.</p></div>
    <div class="actions">${ed ? `<button class="btn primary" data-action="bew-start-open" data-kind="${kind}">${ICON.plus} ${kind === 'austritt' ? 'Austritt anlegen' : 'Eintritt starten'}</button>` : ''}${menu({
      label: 'Mehr',
      single: false,
      items: [ed && { label: 'Vorlagen der Checklisten', icon: ICON.gear, action: 'bew-tpl-open', hint: 'Aufgaben und Fristen, Lohnverrechnung' }, sees('bewerber') && { label: 'Bewerbungen', icon: ICON.users, action: 'view', data: { view: 'bewerber' } }],
    })}</div></div>`
  const lists = all.filter((l) => l.kind === kind && (showClosed || !l.closedAt)).sort((a, b) => Number(!!a.closedAt) - Number(!!b.closedAt) || a.date.localeCompare(b.date))
  const cards = lists
    .map((l) => {
      const p = progress(l, ctx)
      const next = nextTask(l, ctx)
      const st = next ? taskState(next, ctx.today, linkedOf(next, l, ctx)) : 'erledigt'
      const emp = empOf(l.empId)
      return `<article class="bew-card ${l.closedAt ? 'closed' : ''}">
        <header><h3><button class="link-btn" data-action="bew-list-open" data-id="${esc(l.id)}">${esc(emp?.name || 'Person')}</button></h3><span class="muted">${esc(DATE_TEXT[l.kind])}: ${esc(day(l.date))}${emp?.team ? ` · ${esc(emp.team)}` : ''}</span></header>
        <div class="bew-prog">${progressBar(p)}</div>
        <p class="bew-next">${l.closedAt ? `<span class="pill ok">abgeschlossen ${esc(short(dayAt(l.closedAt)))}</span>` : next ? `<span class="pill ${STATE_CLS[st]}">${esc(STATE_TEXT[st])}</span> ${esc(next.title)} <span class="muted">${esc(dueText(next, st))}</span>` : '<span class="pill ok">alles erledigt</span>'}</p>
        <div class="actions"><button class="btn small primary" data-action="bew-list-open" data-id="${esc(l.id)}">Öffnen</button></div>
      </article>`
    })
    .join('')
  const closedCount = all.filter((l) => l.kind === kind && l.closedAt).length
  return `${head}${tabs}
    <div class="filters">${closedCount ? `<label class="check"><input type="checkbox" id="bew-closed" ${showClosed ? 'checked' : ''} data-change="bew-closed"><span>auch abgeschlossene (${closedCount})</span></label>` : ''}</div>
    ${cards ? `<div class="bew-cards">${cards}</div>` : `<p class="empty">${kind === 'austritt' ? 'Kein Austritt angelegt.' : 'Keine Eintritts-Checkliste offen. Sie startet auch von selbst, wenn eine Bewerbung als Mitarbeiter:in übernommen wird.'}</p>`}
    <p class="note">Die Aufgaben sind Vorschläge ohne Gewähr, keine Rechtsauskunft (Fristen der ÖGK, Dienstzettel, Unterweisung): bitte mit der Lohnverrechnung abstimmen. Die App meldet nichts an die ÖGK und zahlt nichts aus.</p>`
}

registerView({
  id: 'eintritt',
  order: 82,
  label: 'Eintritt & Austritt',
  group: 'stamm',
  module: MODULE,
  icon: ICON_EIN,
  noWeek: true,
  text: 'Checklisten: Anmeldung, Unterweisung, Schlüssel, Abmeldung',
  badge: () => checklistAttention(doc().lists, ctxNow()).filter((g) => g.urgent).length,
  render: eintrittView,
})

// ---------------------------------------------------------------- Checkliste (Dialog)

/** Was die Aufgabe je Art zusätzlich zeigt (Verknüpfungen, Knöpfe in andere Bereiche). */
function taskPanel(t, l, ctx, ed) {
  const emp = empOf(l.empId)
  if (!emp) return ''
  const btn = (action, label, data = {}, cls = 'small') => `<button class="btn ${cls}" data-action="${action}"${Object.entries(data)
    .map(([k, v]) => ` data-${k}="${esc(v)}"`)
    .join('')}>${label}</button>`
  if (t.type === 'lohn') {
    const wage = seesAccount()
    const gaps = payrollGaps(emp, { wage })
    return `<p>${gaps.length ? `Im Stammblatt fehlt: <strong>${esc(gaps.join(', '))}</strong>.` : `Stammblatt vollständig (Personalnummer, Eintritt, Wochenstunden${wage ? ', Lohngruppe' : ''}).`}${wage ? '' : ' Lohngruppe und Stundenlohn trägt die Lohnverrechnung ein.'}${t.data?.sent ? ` <span class="pill ok">an die Lohnverrechnung ${esc(short(dayAt(t.data.sent.at)))}</span>` : ''}</p>
      <div class="actions">${canEdit('stammdaten') && !app.readOnly ? btn('emp-edit', 'Stammblatt öffnen', { id: emp.id }) : ''}${ed ? btn('bew-payroll-mail', `${ICON.send} An die Lohnverrechnung`, { list: l.id, task: t.id }) : ''}</div>`
  }
  if (t.type === 'zeitkonto') {
    const parts = []
    if (seesAccount()) parts.push(`Zeitkonto (veröffentlichte Wochen bis ${esc(short(l.date))}): <strong>${timeText(timeAccount(emp, app.data.published || {}, mondayOf(l.date), app.data.payroll || {}))}</strong>`)
    else parts.push('Zeitkonto: sieht die Lohnverrechnung.')
    if (seesAbsenceReasons()) {
      const v = vacationSummary(emp, app.data.absences || [], Number(l.date.slice(0, 4)), app.data.extraFreeDays)
      parts.push(`Urlaub ${esc(l.date.slice(0, 4))}: Anspruch ${v.entitlement}, verplant ${v.used}, <strong>Rest ${v.rest} Tage</strong> (ganzjährig, vor Aliquotierung)`)
    }
    return `<p>${parts.join('<br>')}</p><p class="muted">Nur Anzeige: Resturlaub (Ersatzleistung), Zeitguthaben und Überstunden rechnet die Lohnverrechnung ab; die App zahlt nichts aus.</p>
      <div class="actions">${sees('auswertung') ? btn('bew-overtime', 'Überstunden &amp; Auszahlung', { month: l.date.slice(0, 7) }) : ''}${ed ? btn('bew-payroll-mail', `${ICON.send} An die Lohnverrechnung`, { list: l.id, task: t.id }) : ''}</div>`
  }
  if (t.type === 'unterweisung') {
    const r = trainingCheck(ctx.trainings, emp, ctx.today)
    if (!r) return '<p class="muted">Unterweisungen sieht, wer „Unterweisungen &amp; Fristen“ öffnen darf.</p>'
    const may = canEdit('unterweisungen') && !app.readOnly
    const rows = r.required.map((x) => `<li><span class="pill ${x.state === 'ok' ? 'ok' : x.state === 'bald' ? 'warning' : 'error'}">${x.state === 'fehlt' ? 'fehlt' : x.state === 'abgelaufen' ? 'abgelaufen' : `am ${esc(short(x.record.date))}`}</span> ${esc(x.type.name)}${x.type.law ? ` <span class="muted">${esc(x.type.law)}</span>` : ''} ${may && x.state !== 'ok' ? btn('tr-record-open', 'Eintragen', { emp: emp.id, type: x.type.id, 'back-type': 'bew-list', 'back-id': l.id }) : ''}</li>`)
    // nach dem Eintragen wieder diese Checkliste (back-type/back-id, trainings.js)
    return `<ul class="bew-sub">${rows.join('')}</ul>${may ? `<div class="actions">${btn('tr-session-open', 'Unterweisung durchführen (mit Unterschrift)', { type: r.required.find((x) => x.state !== 'ok')?.type.id || '', 'back-type': 'bew-list', 'back-id': l.id })}</div>` : ''}`
  }
  if (t.type === 'arbeitsschutz') {
    const v = visibleViews().find((x) => x.id === 'arbeitsschutz')
    return `<p class="muted">Betriebsanweisungen zu den Reinigungsmitteln im Objekt besprechen (Sicherheitsdatenblätter, Schutzhandschuhe, Dosierung).</p>${v ? `<div class="actions">${btn('view', `${esc(v.label)} öffnen`, { view: v.id })}</div>` : ''}`
  }
  if (t.type === 'schluessel' || t.type === 'schluessel-rueck') {
    const r = keyCheck(ctx.keys, emp.id)
    if (!r) return '<p class="muted">Schlüssel sieht, wer das Schlüsselbuch öffnen darf.</p>'
    const may = canEdit('schluessel') && !app.readOnly
    const held = r.held.map((k) => `<li>${esc(objOf(k.objectId)?.name || 'Objekt')}: ${esc(k.label)}${k.since ? ` <span class="muted">seit ${esc(short(k.since))}</span>` : ''}</li>`).join('')
    const einObj = l.tasks.find((x) => x.type === 'einschulung')?.data?.objectId || ''
    if (t.type === 'schluessel')
      return `${held ? `<ul class="bew-sub">${held}</ul>` : ''}<div class="actions">${may ? btn('key-move-open', 'Schlüssel ausgeben (Quittung)', { mode: 'ausgabe', emp: emp.id, obj: einObj }) : ''}${r.held.length ? btn('keys-person-pdf', `${ICON.download} Liste der Schlüssel`, { emp: emp.id }) : ''}</div>`
    return `${held ? `<p><strong>Offen im Schlüsselbuch:</strong></p><ul class="bew-sub">${held}</ul>` : '<p>Keine Schlüssel offen.</p>'}${r.held.length && may ? `<div class="actions">${btn('key-move-open', 'Rückgabe eintragen', { mode: 'rueckgabe', emp: emp.id })}</div>` : ''}`
  }
  if (t.type === 'kleidung' || t.type === 'kleidung-rueck') {
    const issued = sees('material') ? (app.data.material?.moves || []).filter((m) => m.kind === 'ausgabe' && m.employeeId === emp.id) : null
    const art = (id) => (app.data.material?.articles || []).find((a) => a.id === id)?.name || 'Artikel'
    const list = issued?.length ? `<ul class="bew-sub">${issued.map((m) => `<li>${esc(short(m.date))}: ${esc(String(-Number(m.qty)).replace('.', ','))} × ${esc(art(m.articleId))}</li>`).join('')}</ul>` : ''
    if (t.type === 'kleidung-rueck') return `${list ? `<p><strong>Ausgegeben (Lager):</strong></p>${list}` : '<p class="muted">Keine Ausgabe an die Person im Lager gebucht.</p>'}<p class="muted">Dienstkleidung, Handy, Geräte zurücknehmen; Rückgabe ins Lager unter „Material &amp; Lager“.</p>`
    const s = t.data?.sizes || {}
    const dis = ed ? '' : 'disabled'
    return `<div class="form-grid bew-sizes">
        <label class="field"><span>Oberteil</span><input type="text" id="bew-size-top-${esc(t.id)}" value="${esc(s.top || '')}" placeholder="z. B. M" data-change="bew-size" data-list="${esc(l.id)}" data-task="${esc(t.id)}" ${dis}></label>
        <label class="field"><span>Hose</span><input type="text" id="bew-size-bottom-${esc(t.id)}" value="${esc(s.bottom || '')}" placeholder="z. B. 40" data-change="bew-size" data-list="${esc(l.id)}" data-task="${esc(t.id)}" ${dis}></label>
        <label class="field"><span>Schuhe</span><input type="text" id="bew-size-shoes-${esc(t.id)}" value="${esc(s.shoes || '')}" placeholder="z. B. 39" data-change="bew-size" data-list="${esc(l.id)}" data-task="${esc(t.id)}" ${dis}></label>
      </div>${list}${canEdit('material') && !app.readOnly ? `<div class="actions">${btn('mat-book-open', 'Ausgabe aus dem Lager buchen', { mode: 'ausgabe', emp: emp.id })}</div>` : ''}`
  }
  if (t.type === 'einschulung') {
    const d = t.data || {}
    const appt = (app.data.termine?.items || []).find((a) => a.ref === `bew-ein:${l.id}:${t.id}` && !a.cancelled)
    const dis = ed ? '' : 'disabled'
    const people = app.data.employees.filter((e) => e.id !== emp.id && (!e.exitDate || e.exitDate >= ctx.today)).sort((a, b) => a.name.localeCompare(b.name, 'de'))
    const objects = app.data.objects.filter((o) => !o.inactive).sort((a, b) => a.name.localeCompare(b.name, 'de'))
    return `<div class="form-grid bew-ein">
        <label class="field"><span>Objekt</span><select id="bew-ein-obj" data-change="bew-ein-set" data-list="${esc(l.id)}" data-task="${esc(t.id)}" ${dis}>${options(objects.map((o) => [o.id, `${o.name}${o.region ? ` (${o.region})` : ''}`]), d.objectId || '', { empty: '– Objekt –' })}</select></label>
        <label class="field"><span>Wer schult ein</span><select id="bew-ein-by" data-change="bew-ein-set" data-list="${esc(l.id)}" data-task="${esc(t.id)}" ${dis}>${options(people.map((e) => [e.id, e.name]), d.trainerId || '', { empty: '– Person –' })}</select></label>
        <label class="field"><span>Datum</span><input type="date" id="bew-ein-date" value="${esc(d.date || l.date)}" data-change="bew-ein-set" data-list="${esc(l.id)}" data-task="${esc(t.id)}" ${dis}></label>
        <label class="field"><span>Uhrzeit</span><input type="time" id="bew-ein-time" value="${esc(d.time || '08:00')}" data-change="bew-ein-set" data-list="${esc(l.id)}" data-task="${esc(t.id)}" ${dis}></label>
      </div>
      ${appt ? `<p><span class="pill ok">Termin</span> ${esc(day(appt.start.slice(0, 10)))} ${esc(appt.start.slice(11, 16))} <button class="btn small" data-action="appt-open" data-id="${esc(appt.id)}">Termin öffnen</button></p>` : ''}
      <div class="actions">${canEdit('termine') && !app.readOnly ? btn('bew-ein-appt', `${ICON.calendar} ${appt ? 'Weiteren Termin anlegen' : 'Termin anlegen (Outlook)'}`, { list: l.id, task: t.id }) : ''}</div>
      <p class="muted">Der Termin steht unter „Termine“ mit Objekt und beiden Personen: so sieht ihn auch die Objektleitung. Mit „Erledigt“ wird das Objekt im Stammblatt unter „Eingeschult in Objekten“ ergänzt.</p>`
  }
  if (t.type === 'handy' || t.type === 'handy-aus') {
    const p = portalSettings()
    const code = p.codes?.[emp.id]
    if (t.type === 'handy-aus') {
      if (!code) return '<p>Kein Link mehr gültig.</p>'
      const ready = ctx.today > l.date
      return `<p>Der persönliche Link ist noch gültig.${p.remove?.length ? ' Bereits entfernte Links werden beim nächsten Übertragen am Webspace gelöscht.' : ''}</p>${mayStamm() ? `<div class="actions"><button class="btn small" data-action="bew-handy-off" data-list="${esc(l.id)}" ${ready ? '' : `disabled title="ab dem Tag nach dem letzten Arbeitstag"`}>Link deaktivieren</button>${ready ? '' : ` <span class="muted">ab ${esc(day(addDays(l.date, 1)))}</span>`}</div>` : ''}`
    }
    if (!p.enabled) return `<p class="muted">Plan am Handy ist ausgeschaltet (Mitarbeitende → Mehr → Plan am Handy).</p>${canEdit('planung') && !app.readOnly ? `<div class="actions">${btn('portal-open', 'Plan am Handy öffnen')}</div>` : ''}`
    if (!code) return `<p>Noch kein persönlicher Link.</p>${mayStamm() ? `<div class="actions">${btn('bew-handy-code', 'Link erzeugen', { list: l.id })}</div>` : ''}`
    const { subject, text } = linkMessage(langOf(emp), { name: emp.name.split(' ')[0], product: product(), link: personalLink(address(), code), topic: p.topics?.[emp.id] || '' })
    const mail = emp.email ? `mailto:${encodeURIComponent(emp.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` : ''
    return `<p>Link vorhanden (Sprache: ${esc(langLabel(langOf(emp)))}). Er gilt, sobald die Pläne übertragen sind (beim Veröffentlichen oder unter „Plan am Handy“).</p>
      <div class="actions">${btn('bew-copy', `${ICON.copy} Link kopieren`, { text: personalLink(address(), code) })}<a class="btn small" href="https://wa.me/?text=${esc(encodeURIComponent(text))}" target="_blank" rel="noopener">WhatsApp</a>${mail ? `<a class="btn small" href="${esc(mail)}">E-Mail</a>` : ''}${canEdit('planung') && !app.readOnly ? btn('bew-handy-send', 'Jetzt übertragen') : ''}</div>`
  }
  if (t.type === 'sprache') {
    const may = mayStamm()
    return `<div class="form-grid"><label class="field"><span>Sprache am Handy</span><select id="bew-lang-${esc(t.id)}" ${may && !t.done ? '' : 'disabled'}>${options(LANGUAGES.map((x) => [x.id, langLabel(x.id)]), langOf(emp))}</select></label></div>${may && !t.done ? `<div class="actions">${btn('bew-lang', 'Übernehmen', { list: l.id, task: t.id }, 'small primary')}</div>` : ''}`
  }
  if (t.type === 'einsaetze') {
    if (!ctx.assignments) return '<p class="muted">Die betroffenen Einsätze sieht, wer die Einsatzplanung sieht. Bitte der Planung Bescheid geben.</p>'
    const r = futureWork({ assignments: ctx.assignments, planTasks: ctx.planTasks, empId: emp.id, after: l.date })
    const range = r.shifts.length ? computeRange(r.shifts[0].date, r.shifts.at(-1).date) : null
    const shift = (s) => {
      const inst = range?.state.instByKey.get(s.key)
      return `<li>${esc(day(s.date))}${inst ? ` ${esc(inst.startTime)}–${esc(inst.endTime)} ${esc(objOf(inst.objectId)?.name || '')}${inst.label ? ` · ${esc(inst.label)}` : ''}` : ''} <button class="btn small" data-action="bew-week" data-date="${esc(s.date)}">Woche öffnen</button></li>`
    }
    const reg = r.regular.map((x) => `<li>${esc(objOf(x.objectId)?.name || 'Objekt')}: ${esc(x.label || '')} ${canEdit('stammdaten') && !app.readOnly ? `<button class="btn small" data-action="task-edit" data-id="${esc(x.id)}">Leistung öffnen</button>` : ''}</li>`)
    return `${r.shifts.length ? `<p><strong>Eingeteilt nach dem Austritt</strong> (geladene Wochen bis ${esc(short(addDays(l.date, 42)))}):</p><ul class="bew-sub">${r.shifts.slice(0, 20).map(shift).join('')}</ul>${r.shifts.length > 20 ? `<p class="muted">… und ${r.shifts.length - 20} weitere</p>` : ''}` : '<p>Keine Einsätze nach dem Austritt in den geladenen Wochen.</p>'}
      ${reg.length ? `<p><strong>Stammkraft in</strong> (für die Zeit nach dem Austritt neu besetzen):</p><ul class="bew-sub">${reg.join('')}</ul>` : ''}
      <p class="muted">Nur ein Hinweis: Die Planung entscheidet, wer übernimmt. Nach dem Austritt meldet der Prüfbericht jeden Einsatz der Person als Fehler.</p>`
  }
  return ''
}

const timeText = (min) => `${min > 0 ? '+' : min < 0 ? '−' : '±'}${formatHours(Math.abs(min))} h`

function listModal(c, m) {
  const l = listOf(m.id)
  if (!l) return ''
  const ctx = ctxNow()
  const ed = editable()
  const emp = empOf(l.empId)
  // Austritt: Wochen nach dem letzten Arbeitstag laden (betroffene Einsätze), einmal je Dialog
  if (l.kind === 'austritt' && ctx.assignments && !m.loaded) {
    m.loaded = true
    ensureRange(addDays(l.date, 1), addDays(l.date, 42))
      .then(() => app.ui.modal === m && renderModal())
      .catch(() => {})
  }
  const p = progress(l, ctx)
  const tasks = [...l.tasks].sort((a, b) => (a.due || '').localeCompare(b.due || ''))
  const items = tasks
    .map((t) => {
      const linked = linkedOf(t, l, ctx)
      const st = taskState(t, ctx.today, linked)
      const doneText = t.done ? `erledigt am ${esc(short(t.done.date))}${t.done.by ? ` von ${esc(t.done.by)}` : ''}` : linked?.done ? `verknüpft: ${esc(linked.text)}${linked.date ? ` (${esc(short(linked.date))}${linked.by ? `, ${esc(linked.by)}` : ''})` : ''}` : ''
      const hint = !t.done && linked && !linked.done ? `<span class="bew-hint">${esc(linked.text)}</span>` : ''
      const acts = ed ? (t.done ? `<button class="btn small ghost" data-action="bew-task-undo" data-list="${esc(l.id)}" data-task="${esc(t.id)}">Wieder öffnen</button>` : `<button class="btn small ${linked?.done ? '' : 'primary'}" data-action="bew-task-done" data-list="${esc(l.id)}" data-task="${esc(t.id)}">${linked?.done ? 'Bestätigen' : 'Erledigt'}</button>`) : ''
      const panel = st === 'erledigt' && t.type !== 'einschulung' ? '' : taskPanel(t, l, ctx, ed)
      return `<li class="bew-task ${st}" data-task="${esc(t.id)}">
        <div class="bew-task-head"><span class="pill ${STATE_CLS[st]}">${esc(STATE_TEXT[st])}</span><div class="bew-task-title"><strong>${esc(t.title)}</strong>${t.note ? ` <span class="muted">· ${esc(t.note)}</span>` : ''}<br><span class="muted">${esc(dueText(t, st) || `Frist ${short(t.due)}`)}${doneText ? ` · ${doneText}` : ''}</span>${hint ? `<br>${hint}` : ''}</div><div class="bew-task-acts">${acts}</div></div>
        ${panel ? `<div class="bew-task-body">${panel}</div>` : ''}
        ${ed ? `<label class="field bew-task-note"><span>Notiz</span><input type="text" id="bew-note-${esc(t.id)}" value="${esc(t.data?.note || '')}" data-change="bew-task-note" data-list="${esc(l.id)}" data-task="${esc(t.id)}" placeholder="optional"></label>` : t.data?.note ? `<p class="muted">${esc(t.data.note)}</p>` : ''}
      </li>`
    })
    .join('')
  const confirmDel = app.ui.confirm === `bew-ldel:${l.id}`
  return modalFrame({
    title: `${KIND_TEXT[l.kind]}: ${emp?.name || 'Person'}`,
    subtitle: `${esc(DATE_TEXT[l.kind])} ${esc(day(l.date))}${l.closedAt ? ' · abgeschlossen' : ''}`,
    wide: true,
    body: `<div class="bew-prog">${progressBar(p)}</div>
      ${!emp ? '<p class="banner warn-banner">Die Person gibt es in den Stammdaten nicht mehr.</p>' : ''}
      <ul class="bew-tasks">${items}</ul>
      ${ed && !l.closedAt ? `<details class="bew-more"><summary>Aufgabe ergänzen oder Datum ändern</summary>
        <div class="form-grid">
          <label class="field"><span>Eigene Aufgabe</span><input type="text" id="bew-add-title" placeholder="z. B. Arbeitserlaubnis vorlegen lassen"></label>
          <label class="field"><span>Frist</span><input type="date" id="bew-add-due" value="${esc(l.date)}"></label>
        </div><div class="actions"><button class="btn small" data-action="bew-task-add" data-list="${esc(l.id)}">${ICON.plus} Aufgabe</button></div>
        <div class="form-grid"><label class="field"><span>${esc(DATE_TEXT[l.kind])}</span><input type="date" id="bew-list-date" value="${esc(l.date)}"></label></div>
        <div class="actions"><button class="btn small" data-action="bew-list-date" data-list="${esc(l.id)}">Datum ändern (offene Fristen wandern mit)</button></div>
      </details>` : ''}`,
    foot: `<div class="actions">${ed ? `<button class="btn danger" data-action="bew-list-delete" data-id="${esc(l.id)}">${confirmDel ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</div>
      <div class="actions"><button class="btn" data-action="close-modal">Schließen</button>${ed && !l.closedAt ? `<button class="btn ${p.done === p.total ? 'primary' : ''}" data-action="bew-list-close" data-id="${esc(l.id)}">Abschließen</button>` : ''}${ed && l.closedAt ? `<button class="btn" data-action="bew-list-reopen" data-id="${esc(l.id)}">Wieder öffnen</button>` : ''}</div>`,
  })
}
registerModal('bew-list', listModal, { module: MODULE })

// ---------------------------------------------------------------- Checkliste starten

function startModal(c, m) {
  const kind = m.kind === 'austritt' ? 'austritt' : 'eintritt'
  const today = todayISO()
  const people = app.data.employees.filter((e) => (kind === 'austritt' ? !e.exitDate || e.exitDate >= addDays(today, -30) : !e.exitDate || e.exitDate >= today)).sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const emp = empOf(m.empId)
  const date = m.date || (kind === 'austritt' ? emp?.exitDate || '' : emp?.entryDate || addDays(mondayOf(today), 7))
  const stamm = canEdit('stammdaten')
  const running = m.empId ? openListOf(m.empId, kind) : null
  return modalFrame({
    title: kind === 'austritt' ? 'Austritt anlegen' : 'Eintritt starten',
    subtitle: kind === 'austritt' ? 'Checkliste zum Austritt' : 'Checkliste zum Eintritt',
    body: `<div class="form-grid">
        <label class="field"><span>Person</span><select id="bew-start-emp" data-change="bew-start-redraw">${options(people.map((e) => [e.id, e.name]), m.empId || '', { empty: '– Person –' })}</select></label>
        <label class="field"><span>${esc(DATE_TEXT[kind])}</span><input type="date" id="bew-start-date" value="${esc(date)}"></label>
        ${stamm ? `<label class="check wide"><input type="checkbox" id="bew-start-stamm" ${m.stamm === false ? '' : 'checked'}><span>${kind === 'austritt' ? 'Austritt (letzter Arbeitstag)' : 'Eintritt'} im Stammblatt eintragen</span></label>` : `<p class="note wide">${kind === 'austritt' ? 'Den Austritt' : 'Den Eintritt'} im Stammblatt trägt das Büro ein.</p>`}
      </div>
      ${running ? `<p class="banner warn-banner">Für diese Person läuft schon eine Checkliste (${esc(day(running.date))}).</p>` : ''}
      <p class="note">Aufgaben laut Vorlage (unter „Mehr“ → „Vorlagen der Checklisten“ änderbar); die Fristen rechnen ab diesem Tag.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="bew-start-save" data-kind="${kind}">${kind === 'austritt' ? 'Austritt anlegen' : 'Eintritt starten'}</button></div>`,
  })
}
registerModal('bew-start', startModal, { module: MODULE })

// ---------------------------------------------------------------- Vorlagen

function tplModal() {
  const m = app.ui.modal
  m.rows ||= { eintritt: structuredClone(templateOf(doc(), 'eintritt')), austritt: structuredClone(templateOf(doc(), 'austritt')) }
  m.payroll ??= doc().settings.payrollEmail || ''
  const section = (kind) => `<section><h3>${esc(KIND_TEXT[kind])} <span class="muted">(Frist in Tagen ab dem ${esc(DATE_TEXT[kind])}, −1 = Vortag)</span></h3>
      <div class="table-wrap"><table class="data bew-tpl"><thead><tr><th>Aufgabe</th><th>Art</th><th>Frist (Tage)</th><th></th></tr></thead><tbody>${m.rows[kind]
        .map(
          (t, i) => `<tr><td><input type="text" id="bew-tpl-${kind}-title-${i}" value="${esc(t.title)}" aria-label="Aufgabe"></td><td>${esc(TASK_TYPES[t.type]?.label || 'eigene Aufgabe')}</td>
            <td><input type="number" id="bew-tpl-${kind}-off-${i}" value="${esc(t.offset ?? 0)}" min="-90" max="180" class="num-input" aria-label="Frist in Tagen"></td>
            <td><label class="check"><input type="checkbox" id="bew-tpl-${kind}-on-${i}" ${t.active !== false ? 'checked' : ''}><span>aktiv</span></label>${t.type === 'frei' ? ` <button class="btn small ghost" data-action="bew-tpl-del" data-kind="${kind}" data-i="${i}" aria-label="Aufgabe entfernen">${ICON.trash}</button>` : ''}</td></tr>`,
        )
        .join('')}</tbody></table></div>
      <p><button class="btn small" data-action="bew-tpl-add" data-kind="${kind}">${ICON.plus} Eigene Aufgabe</button></p></section>`
  return modalFrame({
    title: 'Vorlagen der Checklisten',
    subtitle: 'gilt für neue Checklisten',
    wide: true,
    body: `${section('eintritt')}${section('austritt')}
      <div class="form-grid"><label class="field"><span>E-Mail der Lohnverrechnung (für „An die Lohnverrechnung“)</span><input type="email" id="bew-tpl-payroll" value="${esc(m.payroll)}" placeholder="z. B. lohn@steuerberatung.example"></label></div>
      <p class="note">Fristen sind Vorschläge ohne Gewähr: Anmeldung bei der ÖGK vor Arbeitsbeginn, Abmeldung binnen 7 Tagen nach dem Ende (bitte mit der Lohnverrechnung bestätigen). Laufende Checklisten bleiben, wie sie sind.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn" data-action="bew-tpl-reset">Vorgaben</button><button class="btn primary" data-action="bew-tpl-save">Speichern</button></div>`,
  })
}
registerModal('bew-tpl', tplModal, { module: MODULE })

function readTpl() {
  const m = app.ui.modal
  for (const kind of ['eintritt', 'austritt'])
    m.rows[kind] = m.rows[kind].map((t, i) => (document.getElementById(`bew-tpl-${kind}-title-${i}`) ? { ...t, title: val(`bew-tpl-${kind}-title-${i}`).trim(), offset: Math.round(Number(val(`bew-tpl-${kind}-off-${i}`)) || 0), active: checked(`bew-tpl-${kind}-on-${i}`) } : t))
  if (document.getElementById('bew-tpl-payroll')) m.payroll = val('bew-tpl-payroll').trim()
  return m
}

// ---------------------------------------------------------------- Aktionen

const taskOf = (listId, taskId) => listOf(listId)?.tasks.find((t) => t.id === taskId) || null
function updateTask(listId, taskId, fn) {
  const l = listOf(listId)
  if (!l) return null
  l.tasks = l.tasks.map((t) => (t.id === taskId ? fn(t) : t))
  return l.tasks.find((t) => t.id === taskId)
}

/** Alle veröffentlichten Wochen ab der Vorwoche an den Webspace (wie „Speichern und übertragen“). */
async function transmit() {
  const from = addDays(mondayOf(todayISO()), -7)
  const mondays = Object.keys(app.data.published || {}).filter((x) => x >= from).sort()
  if (mondays.length) await ensureRange(mondays[0], addDays(mondays.at(-1), 6))
  return sendWeeks(mondays)
}

function payrollMail(l, t) {
  const emp = empOf(l.empId)
  if (!emp) return
  const { wages } = mergeRules(app.data.rules)
  const wage = emp.hourlyWage ? `Stundenlohn: ${euro(emp.hourlyWage)}` : emp.wageGroup ? `Lohngruppe ${emp.wageGroup} (KV ${euro(wages[emp.wageGroup] || 0)})` : ''
  const firma = app.config.brand?.name || ''
  const text = payrollText(emp, { kind: l.kind, date: day(l.date), firma, absender: user(), wage: seesAccount() || !app.access ? wage : '' })
  openCompose({
    to: doc().settings.payrollEmail || '',
    subject: `${KIND_TEXT[l.kind]} ${emp.name} am ${day(l.date)}`,
    text,
    origin: `${KIND_TEXT[l.kind]}: ${emp.name}`,
    onSent: ({ via, to }) => {
      updateTask(l.id, t.id, (x) => ({ ...x, data: { ...(x.data || {}), sent: { at: nowIso(), by: user(), via, to } } }))
      persist()
      renderNow()
    },
  })
}

registerActions({
  'bew-kind': (el) => {
    app.ui.bewKind = el.dataset.v
    renderNow()
  },
  'bew-closed': () => {
    app.ui.bewClosed = checked('bew-closed')
    renderNow()
  },
  'bew-list-open': (el) => mayOpen() && openModal({ type: 'bew-list', id: el.dataset.id }),
  // aus „Zu erledigen“, vom digitalen Mitarbeiter und aus der Bewerbung: Ansicht und Checkliste öffnen
  'bew-goto': (el) => {
    if (!mayOpen()) return
    const l = listOf(el.dataset.list)
    if (!l) return toast('Checkliste nicht gefunden.')
    Object.assign(app.ui, { view: 'eintritt', bewKind: l.kind })
    openModal({ type: 'bew-list', id: l.id })
    renderNow()
  },
  'bew-start-redraw': () => {
    const m = app.ui.modal
    Object.assign(m, { empId: val('bew-start-emp'), date: '', stamm: document.getElementById('bew-start-stamm') ? checked('bew-start-stamm') : m.stamm })
    renderModal()
  },
  'bew-copy': async (el) => {
    try {
      await navigator.clipboard.writeText(el.dataset.text)
      toast('Link kopiert.')
    } catch {
      toast(el.dataset.text)
    }
  },
  'bew-week': (el) => {
    Object.assign(app.ui, { view: 'week', monday: mondayOf(el.dataset.date) })
    closeModal()
    renderNow()
  },
  'bew-overtime': (el) => {
    Object.assign(app.ui, { view: 'overtime', month: el.dataset.month })
    closeModal()
    renderNow()
  },
})

registerActions(
  {
    'bew-start-open': (el) => openModal({ type: 'bew-start', kind: el.dataset.kind || 'eintritt', empId: el.dataset.emp || '' }),
    'bew-start-save': (el) => {
      const kind = el.dataset.kind === 'austritt' ? 'austritt' : 'eintritt'
      const empId = val('bew-start-emp')
      const date = val('bew-start-date')
      const emp = empOf(empId)
      if (!emp) return toast('Bitte die Person wählen.')
      if (!date) return toast(`Bitte den ${DATE_TEXT[kind]} eintragen.`)
      if (kind === 'austritt' && emp.entryDate && date < emp.entryDate) return toast('Der Austritt liegt vor dem Eintritt.')
      if (openListOf(empId, kind)) return toast('Für diese Person läuft schon eine Checkliste. Bitte die bestehende öffnen.')
      if (checked('bew-start-stamm') && canEdit('stammdaten')) {
        app.data.employees = app.data.employees.map((e) => (e.id === empId ? { ...e, ...(kind === 'austritt' ? { exitDate: date } : { entryDate: date }) } : e))
      }
      const list = startChecklist({ kind, empId, date })
      persist()
      app.ui.bewKind = kind
      openModal({ type: 'bew-list', id: list.id })
      renderNow()
      toast(`${KIND_TEXT[kind]}-Checkliste für ${emp.name} angelegt (${plural(list.tasks.length, 'Aufgabe', 'Aufgaben')}).`)
    },
    'bew-task-done': (el) => {
      const l = listOf(el.dataset.list)
      const t = taskOf(el.dataset.list, el.dataset.task)
      if (!l || !t) return
      updateTask(l.id, t.id, (x) => markDone(x, { date: todayISO(), by: user(), at: nowIso() }))
      // Einschulung erledigt: Objekt im Stammblatt unter „Eingeschult in Objekten“
      let extra = ''
      const obj = t.type === 'einschulung' ? t.data?.objectId : ''
      if (obj && canEdit('stammdaten')) {
        const emp = empOf(l.empId)
        if (emp && !(emp.trained || []).includes(obj)) {
          app.data.employees = app.data.employees.map((e) => (e.id === emp.id ? { ...e, trained: [...(e.trained || []), obj] } : e))
          extra = ` ${objOf(obj)?.name || 'Objekt'} im Stammblatt als eingeschult vermerkt.`
        }
      }
      persist()
      renderModal()
      renderNow()
      const p = progress(listOf(l.id), ctxNow())
      toast(`Erledigt (${p.done} von ${p.total}).${extra}`)
    },
    'bew-task-undo': (el) => {
      updateTask(el.dataset.list, el.dataset.task, markOpen)
      persist()
      renderModal()
      renderNow()
    },
    'bew-task-note': (el) => {
      updateTask(el.dataset.list, el.dataset.task, (t) => ({ ...t, data: { ...(t.data || {}), note: val(`bew-note-${el.dataset.task}`).trim() } }))
      persist()
    },
    'bew-task-add': (el) => {
      const l = listOf(el.dataset.list)
      const title = val('bew-add-title').trim()
      const due = val('bew-add-due')
      if (!l) return
      if (!title || !due) return toast('Bitte Aufgabe und Frist eintragen.')
      Object.assign(l, addTask(l, { title, due, newId: () => uid('et') }))
      persist()
      renderModal()
      renderNow()
    },
    'bew-list-date': (el) => {
      const l = listOf(el.dataset.list)
      const date = val('bew-list-date')
      if (!l || !date) return
      Object.assign(l, moveList(l, date))
      persist()
      renderModal()
      renderNow()
      toast(`Datum geändert: offene Fristen ab ${day(date)} neu gerechnet. Das Stammblatt bleibt unverändert.`)
    },
    'bew-list-close': (el) => {
      const l = listOf(el.dataset.id)
      if (!l) return
      const p = progress(l, ctxNow())
      if (p.done < p.total && !confirmStep(`bew-lclose:${l.id}`, renderModal)) return toast(`Noch ${p.total - p.done} offen. Zum Abschließen trotzdem noch einmal klicken.`)
      l.closedAt = nowIso()
      persist()
      closeModal()
      renderNow()
      toast('Checkliste abgeschlossen.')
    },
    'bew-list-reopen': (el) => {
      const l = listOf(el.dataset.id)
      if (!l) return
      l.closedAt = ''
      persist()
      renderModal()
      renderNow()
    },
    'bew-list-delete': (el) => {
      if (!confirmStep(`bew-ldel:${el.dataset.id}`, renderModal)) return
      doc().lists = doc().lists.filter((l) => l.id !== el.dataset.id)
      persist()
      closeModal()
      renderNow()
      toast('Checkliste gelöscht.')
    },
    'bew-payroll-mail': (el) => {
      const l = listOf(el.dataset.list)
      const t = taskOf(el.dataset.list, el.dataset.task)
      if (l && t) payrollMail(l, t)
    },
    'bew-size': (el) => {
      const id = el.dataset.task
      const sizes = { top: val(`bew-size-top-${id}`).trim(), bottom: val(`bew-size-bottom-${id}`).trim(), shoes: val(`bew-size-shoes-${id}`).trim() }
      updateTask(el.dataset.list, id, (t) => ({ ...t, data: { ...(t.data || {}), sizes } }))
      persist()
    },
    'bew-ein-set': (el) => {
      const data = { objectId: val('bew-ein-obj'), trainerId: val('bew-ein-by'), date: val('bew-ein-date'), time: val('bew-ein-time') }
      updateTask(el.dataset.list, el.dataset.task, (t) => ({ ...t, data: { ...(t.data || {}), ...data } }))
      persist()
    },
    'bew-lang': (el) => {
      const l = listOf(el.dataset.list)
      const t = taskOf(el.dataset.list, el.dataset.task)
      if (!l || !t) return
      if (!mayStamm()) return toast('Die Sprache im Stammblatt ändert, wer die Stammdaten bearbeiten darf.')
      const lang = val(`bew-lang-${t.id}`) || 'de'
      app.data.employees = app.data.employees.map((e) => {
        if (e.id !== l.empId) return e
        const out = { ...e, lang }
        if (lang === 'de') delete out.lang
        return out
      })
      updateTask(l.id, t.id, (x) => markDone({ ...x, data: { ...(x.data || {}), lang } }, { date: todayISO(), by: user(), at: nowIso() }))
      persist()
      renderModal()
      renderNow()
      toast(`Sprache am Handy: ${langLabel(lang)}.`)
    },
    'bew-handy-code': (el) => {
      const l = listOf(el.dataset.list)
      if (!l || !mayStamm()) return
      const p = portalSettings()
      if (!p.enabled) return toast('Plan am Handy ist ausgeschaltet.')
      if (p.codes?.[l.empId]) return renderModal()
      app.data.rules = { ...(app.data.rules || {}), portal: { ...p, codes: { ...(p.codes || {}), [l.empId]: newCode() } } }
      persist()
      renderModal()
      toast('Link erzeugt. Er gilt, sobald die Pläne übertragen sind (beim Veröffentlichen oder „Jetzt übertragen“).')
    },
    'bew-handy-off': async (el) => {
      const l = listOf(el.dataset.list)
      if (!l || !mayStamm()) return
      const p = portalSettings()
      const code = p.codes?.[l.empId]
      if (!code) return renderModal()
      if (todayISO() <= l.date) return toast(`Erst nach dem letzten Arbeitstag (ab ${day(addDays(l.date, 1))}).`)
      const hash = await sha256Hex(code)
      const codes = { ...(p.codes || {}) }
      const topics = { ...(p.topics || {}) }
      delete codes[l.empId]
      delete topics[l.empId]
      app.data.rules = { ...(app.data.rules || {}), portal: { ...p, codes, topics, remove: [...new Set([...(p.remove || []), hash])] } }
      persist()
      renderModal()
      renderNow()
      if (p.enabled && p.key && canEdit('planung')) {
        try {
          await transmit()
          return toast('Link deaktiviert und am Webspace gelöscht.')
        } catch (err) {
          return toast(`Link deaktiviert; am Webspace wird er beim nächsten Übertragen gelöscht (${err.message}).`)
        }
      }
      toast('Link deaktiviert; am Webspace wird er beim nächsten Übertragen gelöscht.')
    },
    'bew-tpl-open': () => openModal({ type: 'bew-tpl' }),
    'bew-tpl-add': (el) => {
      const m = readTpl()
      m.rows[el.dataset.kind].push({ id: uid('et'), type: 'frei', title: 'Neue Aufgabe', offset: 0, note: '', active: true })
      renderModal()
    },
    'bew-tpl-del': (el) => {
      const m = readTpl()
      m.rows[el.dataset.kind] = m.rows[el.dataset.kind].filter((_, i) => i !== Number(el.dataset.i))
      renderModal()
    },
    'bew-tpl-reset': () => {
      const m = app.ui.modal
      m.rows = { eintritt: structuredClone(EINTRITT_DEFAULTS), austritt: structuredClone(AUSTRITT_DEFAULTS) }
      renderModal()
    },
    'bew-tpl-save': () => {
      const m = readTpl()
      if ([...m.rows.eintritt, ...m.rows.austritt].some((t) => !t.title)) return toast('Jede Aufgabe braucht einen Titel.')
      if (m.payroll && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.payroll)) return toast('Die E-Mail der Lohnverrechnung ist nicht gültig.')
      doc().templates = { eintritt: m.rows.eintritt, austritt: m.rows.austritt }
      doc().settings = { ...doc().settings, payrollEmail: m.payroll }
      persist()
      closeModal()
      renderNow()
      toast('Vorlagen gespeichert. Sie gelten für neue Checklisten.')
    },
  },
  { edit: MODULE },
)

// Plan am Handy übertragen (wie in „Plan am Handy“: nur, wer die Planung bearbeitet)
registerActions(
  {
    'bew-handy-send': async () => {
      try {
        const r = await transmit()
        toast(r ? `Übertragen: Pläne für ${r.personen} ${r.personen === 1 ? 'Person' : 'Personen'}.` : 'Plan am Handy ist ausgeschaltet.')
      } catch (err) {
        toast(`Nicht übertragen: ${err.message}`)
      }
    },
  },
  { edit: 'planung' },
)

// Einschulung als Termin über „Termine“ (Dialog „appt“, Recht auf Termine): mit Objekt und beiden Personen
registerActions(
  {
    'bew-ein-appt': (el) => {
      const l = listOf(el.dataset.list)
      const t = taskOf(el.dataset.list, el.dataset.task)
      if (!l || !t) return
      const d = { objectId: val('bew-ein-obj') || t.data?.objectId || '', trainerId: val('bew-ein-by') || t.data?.trainerId || '', date: val('bew-ein-date') || t.data?.date || l.date, time: val('bew-ein-time') || t.data?.time || '08:00' }
      if (editable()) updateTask(l.id, t.id, (x) => ({ ...x, data: { ...(x.data || {}), ...d } }))
      if (!d.objectId) return toast('Bitte zuerst das Objekt wählen.')
      const emp = empOf(l.empId)
      openModal({ type: 'appt', date: d.date, time: d.time, minutes: 120, kind: 'schulung', title: `Einschulung ${emp?.name || ''} in ${objOf(d.objectId)?.name || 'Objekt'}`.trim(), objectId: d.objectId, employeeIds: [l.empId, d.trainerId].filter(Boolean), note: 'Einschulung: Zugang und Schlüssel, Alarmanlage, Abläufe, Reinigungsmittel und Betriebsanweisungen im Objekt.', ref: `bew-ein:${l.id}:${t.id}` })
    },
  },
  { edit: 'termine' },
)

// Termin der Einschulung gespeichert: Datum, Objekt und wer einschult an der Aufgabe vermerken
onAppointmentSaved((a) => {
  const [kind, listId, taskId] = String(a.ref || '').split(':')
  if (kind !== 'bew-ein' || !listOf(listId) || !canEdit(MODULE)) return
  const trainer = (a.employeeIds || []).find((id) => id !== listOf(listId).empId) || ''
  updateTask(listId, taskId, (t) => ({ ...t, data: { ...(t.data || {}), termId: a.id, objectId: a.objectId || t.data?.objectId || '', trainerId: trainer || t.data?.trainerId || '', date: a.start.slice(0, 10), time: a.start.slice(11, 16) } }))
})

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'eintritt',
  module: MODULE,
  title: 'Eintritt & Austritt',
  compute: (today) => checklistAttention(doc().lists, eintrittContext(today)).map((g) => ({ ...g, id: `${g.list.id}:${g.tasks.map((x) => `${x.task.id}-${x.state}`).join(',')}` })),
  render: (list) =>
    list
      .map((g) => {
        const lines = g.tasks.map((x) => `${x.task.title}: ${x.state === 'ueberfaellig' ? `überfällig seit ${short(x.task.due)}` : `bis ${short(x.task.due)}`}`)
        return `<div class="todo-item"><span class="flag ${g.urgent ? 'error' : 'warning'}">${g.tasks.length}</span><div class="todo-text"><strong>${esc(KIND_TEXT[g.list.kind])} ${esc(g.emp?.name || 'Person')}</strong> <span class="muted">(${esc(DATE_TEXT[g.list.kind])} ${esc(short(g.list.date))})</span><br><span class="muted">${esc(lines.slice(0, 4).join(' · '))}${lines.length > 4 ? ' …' : ''}</span></div><button class="btn small primary" data-action="bew-goto" data-list="${esc(g.list.id)}">Öffnen</button></div>`
      })
      .join(''),
})
