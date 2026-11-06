// Bewerbungen (Personalverwaltung): Liste mit Status (neu → Kontakt → Gespräch geplant → Probearbeit → Zusage /
// Absage / zurückgezogen), Quelle (AMS, Inserat, Empfehlung, Initiativ), gewünschte Stunden und Revier, Sprachen,
// Führerschein, Verfügbarkeit, Notizen, Lebenslauf und Unterlagen in SharePoint (bewerbung/unterlagen/<Kennung>/).
// Gespräch als Outlook-Termin über „Termine“ (Dialog „appt“, ref „bew:<Kennung>“), Absage-Mail mit Vorlage über das
// Senden-Fenster der App (nur nach Klick), Zusage → mit einem Klick als Mitarbeiter:in anlegen (Stammblatt
// vorbefüllt, staff.js) und Eintritts-Checkliste starten (views/eintritt.js). „Zu erledigen“: Bewerbungen ohne
// Rückmeldung seit mehr als 7 Tagen, Löschfrist abgelehnter Bewerbungen (gelöscht wird nur nach Klick).
// Datei bewerbung/bewerbung.json (Rechenkern: core/bewerber.js). Aktionen und Dialoge mit dem Kürzel „bew-“.

import { addLog, applicantCounts, applicantProblem, CLOSED_STATUS, DEFAULT_REJECT, deleteDue, deleteMonthsOf, deletionsDue, emptyBewerbung, employeeFrom, filterApplicants, isOpen, lastActivity, OPEN_STATUS, protectedHints, rejectMail, removeApplicant, setStatus, silentApplicants, silentDaysOf, SOURCES, STATUS, STATUS_FILTERS } from '../../core/bewerber.js'
import { addDays, formatDate, isoWeekday, todayISO, WEEKDAY_LONG } from '../../core/dates.js'
import { LANGUAGES, langInfo } from '../../core/sprachen.js'
import { app, canEdit, closeModal, confirmStep, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { openCompose } from '../mailer.js'
import { registerTodo } from '../modals/todo.js'
import { availabilitySummary, checked, checkedValues, esc, ICON, menu, modalFrame, options, uid, val } from '../shared.js'
import { onAppointmentSaved } from './appointments.js'
import { openListOf, startChecklist } from './eintritt.js'
import { onEmployeeCreated } from './staff.js'

const MODULE = 'bewerber'
const ICON_BEW = '<circle cx="9.5" cy="8" r="3.5"/><path d="M3 20a6.5 6.5 0 0 1 13 0"/><path d="M18.5 8v6M15.5 11h6"/>'
const doc = () => {
  const d = (app.data.bewerbung ||= emptyBewerbung())
  d.applicants ||= []
  d.settings ||= {}
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const nowIso = () => new Date().toISOString()
const user = () => app.user?.name || 'Browser'
const byId = (id) => doc().applicants.find((a) => a.id === id)
const day = (d) => (d ? formatDate(d, { year: true }) : '–')
const short = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '–')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const STATUS_CLS = { neu: 'info', kontakt: 'info', gespraech: 'warning', probe: 'warning', zusage: 'ok', absage: 'error', zurueck: 'na' }
const fileSafe = (s) => String(s || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
const regions = () => [...new Set([...app.data.objects.map((o) => o.region), ...app.data.employees.map((e) => e.team)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'))
const langTags = (ids = []) => ids.map((id) => `<span class="tag" lang="${esc(langInfo(id).html)}" title="${esc(langInfo(id).label)}">${esc(langInfo(id).own)}</span>`).join('')
/** Gesprächstermine einer Bewerbung (Termine mit ref „bew:<Kennung>“), neueste zuerst. */
const interviews = (id) => (app.data.termine?.items || []).filter((t) => t.ref === `bew:${id}` && !t.cancelled).sort((a, b) => b.start.localeCompare(a.start))
/** Rollen ohne das Modul: keine Dialoge (die Daten lädt die App für sie ohnehin nicht). */
const mayOpen = () => !app.access || app.access.sees(MODULE) || (toast('Bewerbungen sind für dein Konto nicht freigegeben.'), false)
const statusPill = (a) => `<span class="pill ${STATUS_CLS[a.status] || ''}">${esc(STATUS[a.status] || a.status)}</span>`

// ---------------------------------------------------------------- Unterlagen (SharePoint)

// Browser-Modus: Dateien nur in diesem Fenster; mit SharePoint unter bewerbung/unterlagen/<Kennung>/ (ohne Netz
// wartet das Hochladen im Gerät, siehe storage/offline.js)
const LOCAL = new Map()

/** Foto einer Urkunde verkleinern (Handy: oft 4–8 MB): längste Seite höchstens 2000 Pixel, JPEG. PDFs bleiben. */
async function shrink(file) {
  if (!/^image\//.test(file.type) || file.size < 600e3 || typeof createImageBitmap !== 'function') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
    return blob && blob.size < file.size ? new File([blob], `${file.name.replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

/** Unterlage ablegen; liefert { path, name, type, size, at, by, url?, queued?, local? } oder null (mit Meldung). */
async function storeDoc(file, applicantId) {
  if (file.size > 15e6) {
    toast(`${file.name}: zu groß (höchstens 15 MB).`)
    return null
  }
  const f = await shrink(file)
  const ext = (f.name.match(/\.(\w{2,4})$/)?.[1] || (f.type === 'application/pdf' ? 'pdf' : 'jpg')).toLowerCase()
  const path = `bewerbung/unterlagen/${applicantId}/${todayISO()}_${uid('d').slice(-6)}_${fileSafe(file.name.replace(/\.\w{2,4}$/, '')) || 'Unterlage'}.${ext}`
  const meta = { path, name: file.name, type: f.type || 'application/octet-stream', size: f.size, at: nowIso(), by: user() }
  if (app.store?.kind !== 'sharepoint') {
    LOCAL.set(path, f)
    return { ...meta, local: true }
  }
  try {
    const up = await app.store.upload(path, f, meta.type)
    return { ...meta, ...(up?.webUrl ? { url: up.webUrl } : {}), ...(up?.queued ? { queued: true } : {}) }
  } catch (err) {
    toast(`${file.name} nicht gespeichert: ${err.message}`)
    return null
  }
}

async function openDoc(meta) {
  if (!meta) return
  const local = LOCAL.get(meta.path)
  if (local) return void window.open(URL.createObjectURL(local), '_blank', 'noopener')
  if (meta.local) return toast('Im Browser-Modus werden Unterlagen nicht gespeichert (nur im Betrieb mit SharePoint).')
  if (meta.url) return void window.open(meta.url, '_blank', 'noopener')
  try {
    const blob = await app.store.readBlob?.(meta.path)
    if (!blob) return toast(meta.queued ? 'Die Datei wartet noch im Gerät aufs Hochladen.' : 'Datei nicht gefunden.')
    window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  } catch (err) {
    toast(`Datei nicht geöffnet: ${err.message}`)
  }
}

/** Unterlage in SharePoint löschen (landet im Papierkorb der Website); Fehler zählen als „schon weg“. */
async function dropDoc(path) {
  LOCAL.delete(path)
  if (app.store?.kind !== 'sharepoint') return true
  try {
    await app.store.remove(path)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- Ansicht

function bewerberView() {
  const today = todayISO()
  const d = doc()
  const ed = editable()
  const n = applicantCounts(d.applicants, today, { silentDays: silentDaysOf(d), deleteMonths: deleteMonthsOf(d) })
  const f = { status: app.ui.bewStatus || '', source: app.ui.bewSource || '', region: app.ui.bewRegion || '', q: app.ui.bewQ || '' }
  const rows = filterApplicants(d.applicants, f)
  const silent = new Map(silentApplicants(d.applicants, today, silentDaysOf(d)).map((x) => [x.a.id, x.days]))
  const tile = (label, value, cls = '', status = '') => `<button class="stat ${cls}" data-action="bew-tile" data-status="${status}"><div class="label">${label}</div><div class="value">${value}</div></button>`
  const head = `<div class="section-head"><div><h2>Bewerbungen</h2><p>Von der Bewerbung bis zur Zusage: Status, Gespräch als Outlook-Termin, Unterlagen in SharePoint. Bei Zusage mit einem Klick als Mitarbeiter:in anlegen, die Eintritts-Checkliste startet dann von selbst.</p></div>
    <div class="actions">${ed ? `<button class="btn primary" data-action="bew-edit-open">${ICON.plus} Bewerbung erfassen</button>` : ''}${menu({
      label: 'Mehr',
      single: false,
      items: [ed && { label: 'Absage-Vorlage und Fristen', icon: ICON.gear, action: 'bew-settings-open', hint: 'Text der Absage, Löschfrist' }, (!app.access || app.access.sees('eintritt')) && { label: 'Eintritt & Austritt', icon: ICON.check, action: 'view', data: { view: 'eintritt' } }],
    })}</div></div>`
  const due = deletionsDue(d.applicants, today, deleteMonthsOf(d))
  const banner = due.length
    ? `<div class="banner warn-banner bew-delete-banner"><p><strong>Löschfrist erreicht:</strong> ${plural(due.length, 'abgelehnte oder zurückgezogene Bewerbung', 'abgelehnte oder zurückgezogene Bewerbungen')} (${deleteMonthsOf(d)} Monate nach der Entscheidung). Bitte prüfen und löschen.</p><ul class="bew-sub">${due.map((x) => `<li>${esc(x.a.name)} <span class="muted">(${esc(STATUS[x.a.status])} am ${esc(short(x.a.decidedAt))})</span> <button class="btn small" data-action="bew-edit-open" data-id="${esc(x.a.id)}">Öffnen</button></li>`).join('')}</ul></div>`
    : ''
  const filters = `<div class="filters bew-filters">
      <label class="field inline"><span>Status</span><select id="bew-f-status" data-change="bew-filter">${options(Object.entries(STATUS_FILTERS), f.status)}</select></label>
      <label class="field inline"><span>Quelle</span><select id="bew-f-source" data-change="bew-filter">${options(Object.entries(SOURCES), f.source, { empty: 'alle' })}</select></label>
      ${regions().length > 1 ? `<label class="field inline"><span>Revier</span><select id="bew-f-region" data-change="bew-filter">${options(regions().map((r) => [r, r]), f.region, { empty: 'alle' })}</select></label>` : ''}
      <label class="field inline"><span>Suche</span><input type="search" id="bew-f-q" value="${esc(f.q)}" placeholder="Name, Telefon …" data-change="bew-filter"></label>
      ${f.status || f.source || f.region || f.q ? '<button class="btn small ghost" data-action="bew-reset">Filter zurücksetzen</button>' : ''}</div>`
  const body = rows
    .map((a) => {
      const since = lastActivity(a)
      const quiet = silent.get(a.id)
      const next = interviews(a.id).find((t) => t.start.slice(0, 10) >= today)
      return `<tr><td class="clickable" data-action="bew-edit-open" data-id="${esc(a.id)}"><strong>${esc(a.name)}</strong><br><span class="muted">${esc(SOURCES[a.source] || '')}${a.sourceNote ? ` · ${esc(a.sourceNote)}` : ''}</span></td>
        <td>${statusPill(a)}${a.empId ? ' <span class="pill ok">übernommen</span>' : ''}${next ? `<br><span class="muted">Gespräch ${esc(formatDate(next.start.slice(0, 10)))} ${esc(next.start.slice(11, 16))}</span>` : ''}</td>
        <td>${a.hours ? `${esc(String(a.hours).replace('.', ','))} h/Woche` : '–'}${a.region ? `<br><span class="muted">${esc(a.region)}</span>` : ''}</td>
        <td><div class="tags">${langTags(a.langs) || '<span class="muted">–</span>'}${a.license ? '<span class="tag">Führerschein</span>' : ''}</div></td>
        <td>${esc(availabilitySummary(a)) || '<span class="muted">–</span>'}</td>
        <td>${since ? esc(short(since)) : '–'}${quiet ? `<br><span class="pill warning">seit ${quiet} Tagen ohne Rückmeldung</span>` : ''}</td>
        <td class="actions-cell"><button class="btn small" data-action="bew-edit-open" data-id="${esc(a.id)}">Öffnen</button></td></tr>`
    })
    .join('')
  return `${head}
    <div class="impact-stats tc-stats">${tile('offen', n.offen, '', '')}${tile('ohne Rückmeldung', n.still, n.still ? 'err' : '', '')}${tile('Gespräch, Probearbeit', n.gespraech, '', 'gespraech')}${tile('Zusage offen', n.zusage, '', 'zusage')}${tile('zu löschen', n.loeschen, n.loeschen ? 'err' : '', 'absage')}</div>
    ${banner}${filters}
    ${body ? `<div class="table-wrap"><table class="data bew-table"><thead><tr><th>Name</th><th>Status</th><th>Wunsch</th><th>Sprachen</th><th>Verfügbar</th><th>letzte Rückmeldung</th><th></th></tr></thead><tbody>${body}</tbody></table></div>` : `<p class="empty">${d.applicants.length ? 'Keine Bewerbung in dieser Auswahl.' : 'Noch keine Bewerbungen erfasst.'}</p>`}
    <p class="note">Personenbezogene Daten: nur erfassen, was für die Stelle nötig ist (keine Angaben zu Alter, Herkunft, Religion, Familienstand oder Gesundheit). Abgelehnte Bewerbungen nach ${deleteMonthsOf(d)} Monaten löschen; die App erinnert daran, löscht aber nur nach Klick.</p>`
}

registerView({
  id: 'bewerber',
  order: 81,
  label: 'Bewerbungen',
  group: 'stamm',
  module: MODULE,
  icon: ICON_BEW,
  noWeek: true,
  // personenbezogen: nicht über „Diese Ansicht per E-Mail“
  mail: false,
  text: 'Bewerber:innen, Gespräche, Zusage, Absage',
  badge: () => {
    const today = todayISO()
    return silentApplicants(doc().applicants, today, silentDaysOf(doc())).length + deletionsDue(doc().applicants, today, deleteMonthsOf(doc())).length
  },
  render: bewerberView,
})

// ---------------------------------------------------------------- Bewerbung (Dialog)

const FIELDS = ['name', 'phone', 'email', 'source', 'sourceNote', 'hours', 'region', 'langs', 'license', 'availability', 'start', 'notes']

function draftOf(m) {
  if (!m.draft) {
    const a = m.id ? byId(m.id) : null
    m.draft = a ? structuredClone(Object.fromEntries(FIELDS.map((k) => [k, a[k]]))) : { name: '', phone: '', email: '', source: 'inserat', sourceNote: '', hours: '', region: '', langs: ['de'], license: false, availability: {}, start: '', notes: '' }
    m.pending ||= []
  }
  return m.draft
}

function readForm() {
  const m = app.ui.modal
  const d = draftOf(m)
  if (!document.getElementById('bew-name')) return d
  const availability = {}
  for (let i = 1; i <= 7; i++) if (checked(`bew-av-on-${i}`)) availability[i] = { from: val(`bew-av-from-${i}`) || '06:00', to: val(`bew-av-to-${i}`) || '20:00' }
  const hours = val('bew-hours').trim().replace(',', '.')
  Object.assign(d, {
    name: val('bew-name').trim(),
    phone: val('bew-phone').trim(),
    email: val('bew-email').trim(),
    source: val('bew-source'),
    sourceNote: val('bew-source-note').trim(),
    hours: hours === '' ? '' : Number(hours),
    region: val('bew-region'),
    langs: checkedValues('bew-lang'),
    license: checked('bew-license'),
    availability,
    start: val('bew-start'),
    notes: val('bew-notes').trim(),
  })
  return d
}

function editModal(c, m) {
  const d = draftOf(m)
  const a = m.id ? byId(m.id) : null
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const today = todayISO()
  const hints = protectedHints(`${d.notes} ${d.sourceNote}`)
  const avail = [1, 2, 3, 4, 5, 6, 7]
    .map((i) => {
      const w = d.availability?.[i]
      return `<label class="check"><input type="checkbox" id="bew-av-on-${i}" ${w ? 'checked' : ''} ${dis}><span>${WEEKDAY_LONG[i - 1]}</span></label>
        <input type="time" id="bew-av-from-${i}" value="${esc(w?.from || '06:00')}" aria-label="${WEEKDAY_LONG[i - 1]} von" ${dis}><input type="time" id="bew-av-to-${i}" value="${esc(w?.to || '20:00')}" aria-label="${WEEKDAY_LONG[i - 1]} bis" ${dis}>`
    })
    .join('')
  const docs = [
    ...(a?.docs || []).map((x, i) => `<span class="pill bew-file"><button type="button" class="link-btn" data-action="bew-doc-open" data-id="${esc(a.id)}" data-i="${i}" title="${esc(x.name)}">${ICON.download} ${esc(x.name)}</button>${ed ? ` <button type="button" class="btn small ghost" data-action="bew-doc-del" data-id="${esc(a.id)}" data-i="${i}" aria-label="${esc(x.name)} löschen">${app.ui.confirm === `bew-ddel:${a.id}:${i}` ? 'löschen?' : ICON.close}</button>` : ''}</span>`),
    ...m.pending.map((f, i) => `<span class="pill bew-file">${ICON.upload} ${esc(f.name)} <button type="button" class="btn small ghost" data-action="bew-doc-drop" data-i="${i}" aria-label="${esc(f.name)} entfernen">${ICON.close}</button></span>`),
  ].join(' ')
  const statusBar = a
    ? `<section><h3>Status</h3><div class="seg bew-steps" role="group" aria-label="Status">${[...OPEN_STATUS, ...CLOSED_STATUS]
        .map((s) => `<button class="btn small ${a.status === s ? 'primary' : ''}" data-action="bew-status" data-id="${esc(a.id)}" data-status="${s}" aria-pressed="${a.status === s}" ${ed ? '' : 'disabled'}>${esc(STATUS[s])}</button>`)
        .join('')}</div>
      ${a.status === 'probe' ? '<p class="note">Probearbeit mit echter Arbeitsleistung ist ein Dienstverhältnis: vorher bei der ÖGK anmelden und bezahlen (unbezahltes „Schnuppern“ nur ohne Arbeitsleistung).</p>' : ''}</section>`
    : ''
  const talks = a ? interviews(a.id) : []
  const talkHtml = a
    ? `<section><h3>Gespräch</h3>${talks.length ? `<ul class="bew-sub">${talks.map((t) => `<li>${esc(day(t.start.slice(0, 10)))} ${esc(t.start.slice(11, 16))} <button class="btn small" data-action="appt-open" data-id="${esc(t.id)}">Termin öffnen</button></li>`).join('')}</ul>` : '<p class="muted">Noch kein Termin.</p>'}
      <div class="actions">${canEdit('termine') && !app.readOnly && isOpen(a) ? `<button class="btn small" data-action="bew-interview" data-id="${esc(a.id)}">${ICON.calendar} Gespräch planen (Outlook)</button>` : ''}${ed ? `<input type="text" id="bew-contact-text" class="bew-contact" placeholder="z. B. angerufen, meldet sich bis Freitag" aria-label="Kontakt vermerken"><button class="btn small" data-action="bew-contact" data-id="${esc(a.id)}">Kontakt vermerken</button>` : ''}</div></section>`
    : ''
  let decision = ''
  if (a?.status === 'zusage' && !a.empId) {
    decision = `<div class="banner bew-hire"><p><strong>Zusage:</strong> jetzt als Mitarbeiter:in anlegen. Das Stammblatt ist vorbefüllt (Name, E-Mail, Revier, Stunden, Verfügbarkeit, Sprache, Führerschein); danach startet die Eintritts-Checkliste.</p>${canEdit('stammdaten') && !app.readOnly ? `<button class="btn primary" data-action="bew-hire" data-id="${esc(a.id)}">${ICON.user} Als Mitarbeiter:in anlegen</button>` : '<p class="muted">Anlegen darf, wer die Stammdaten bearbeitet.</p>'}</div>`
  } else if (a?.empId) {
    const emp = app.data.employees.find((e) => e.id === a.empId)
    const list = openListOf(a.empId, 'eintritt')
    decision = `<p><span class="pill ok">übernommen</span> als ${esc(emp?.name || 'Mitarbeiter:in')}${list && (!app.access || app.access.sees('eintritt')) ? ` <button class="btn small" data-action="bew-goto" data-list="${esc(list.id)}">Eintritts-Checkliste</button>` : ''}</p>`
  } else if (a && ['absage', 'zurueck'].includes(a.status)) {
    const del = deleteDue(a, deleteMonthsOf(doc()))
    decision = `<p>${statusPill(a)} am ${esc(short(a.decidedAt))}${a.rejectMail ? ` · Absage-Mail ${esc(short(a.rejectMail.at.slice(0, 10)))}` : ''} · <strong>löschen ab ${esc(short(del))}</strong>${del && del <= today ? ' <span class="pill error">Löschfrist erreicht</span>' : ''}</p>`
  }
  const history = a?.log?.length
    ? `<details class="bew-log"><summary>Verlauf (${a.log.length})</summary><ul class="bew-sub">${[...a.log]
        .reverse()
        .map((l) => `<li><strong>${esc(short(l.date || l.at.slice(0, 10)))}</strong> ${l.kind === 'status' ? `Status ${esc(STATUS[l.status] || l.status)}` : l.kind === 'termin' ? 'Gespräch' : l.kind === 'mail' ? 'E-Mail' : l.kind === 'datei' ? 'Unterlage' : 'Kontakt'}${l.text ? `: ${esc(l.text)}` : ''} <span class="muted">· ${esc(l.by || '')}</span></li>`)
        .join('')}</ul></details>`
    : ''
  const confirmDel = a && app.ui.confirm === `bew-del:${a.id}`
  return modalFrame({
    title: a ? a.name : 'Bewerbung erfassen',
    subtitle: a ? `${statusPill(a)} · ${esc(SOURCES[a.source] || '')} · erfasst ${esc(short(String(a.createdAt || '').slice(0, 10)))}` : 'Kontakt, Wunsch, Verfügbarkeit, Unterlagen',
    wide: true,
    body: `${decision}${statusBar}
      <div class="form-grid">
        <label class="field"><span>Name</span><input type="text" id="bew-name" value="${esc(d.name)}" autocomplete="off" ${dis}></label>
        <label class="field"><span>Telefon</span><input type="tel" id="bew-phone" value="${esc(d.phone)}" ${dis}></label>
        <label class="field"><span>E-Mail</span><input type="email" id="bew-email" value="${esc(d.email)}" ${dis}></label>
        <label class="field"><span>Quelle</span><select id="bew-source" ${dis}>${options(Object.entries(SOURCES), d.source)}</select></label>
        <label class="field"><span>Zur Quelle (optional)</span><input type="text" id="bew-source-note" value="${esc(d.sourceNote)}" placeholder="z. B. Empfehlung von …, Inserat Nr." ${dis}></label>
        <label class="field"><span>Gewünschte Stunden je Woche</span><input type="text" inputmode="decimal" id="bew-hours" value="${esc(String(d.hours ?? '').replace('.', ','))}" placeholder="z. B. 20" ${dis}></label>
        <label class="field"><span>Revier</span><select id="bew-region" ${dis}>${options(regions().map((r) => [r, r]), d.region, { empty: '– egal –' })}</select></label>
        <label class="field"><span>Beginn frühestens</span><input type="date" id="bew-start" value="${esc(d.start)}" ${dis}></label>
        <label class="check"><input type="checkbox" id="bew-license" ${d.license ? 'checked' : ''} ${dis}><span>Führerschein B</span></label>
      </div>
      <section><h3>Sprachen</h3><div class="form-grid bew-langs">${LANGUAGES.map((l) => `<label class="check"><input type="checkbox" name="bew-lang" value="${esc(l.id)}" ${(d.langs || []).includes(l.id) ? 'checked' : ''} ${dis}><span>${esc(l.label)}</span></label>`).join('')}</div></section>
      <section><h3>Verfügbarkeit</h3><div class="avail-grid">${avail}</div></section>
      <label class="field wide"><span>Notizen</span><textarea id="bew-notes" rows="3" placeholder="z. B. Erfahrung in der Unterhaltsreinigung, gewünscht Frühdienst" ${dis}>${esc(d.notes)}</textarea></label>
      ${hints.length ? `<p class="banner warn-banner bew-protected">Hinweis: Die Notiz nennt vermutlich ${esc(hints.join(', '))}. Bitte nur Fachliches notieren (Gleichbehandlungsgesetz) und so etwas auch nicht in die Absage schreiben.</p>` : '<p class="note">Bitte nur Fachliches notieren: keine Angaben zu Alter, Herkunft, Religion, Familienstand, Schwangerschaft oder Gesundheit.</p>'}
      <section><h3>Lebenslauf und Unterlagen</h3><div class="ek-beleg-bar bew-docs">${ed ? `<label class="btn">${ICON.upload} Datei hinzufügen<input type="file" accept="application/pdf,image/*,.doc,.docx,.odt" multiple data-change="bew-doc" hidden></label>` : ''}${docs ? `<span class="bew-pending">${docs}</span>` : '<span class="muted small">Liegen in SharePoint im Ordner der Bewerbungen (nur Personalverwaltung).</span>'}</div></section>
      ${talkHtml}${history}`,
    foot: `<div class="actions">${a && ed ? `<button class="btn danger" data-action="bew-delete" data-id="${esc(a.id)}">${confirmDel ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}${a && ed && a.status !== 'zusage' && !a.empId ? `<button class="btn" data-action="bew-reject" data-id="${esc(a.id)}">${ICON.send} Absage …</button>` : ''}</div>
      <div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? '<button class="btn primary" data-action="bew-save">Speichern</button>' : ''}</div>`,
  })
}
registerModal('bew-edit', editModal, { module: MODULE })

/** Bewerbung speichern (neu oder geändert), wartende Unterlagen hochladen. Liefert die Bewerbung oder null. */
async function save({ quiet = false } = {}) {
  const m = app.ui.modal
  const d = readForm()
  const problem = applicantProblem(d)
  if (problem) {
    toast(problem)
    return null
  }
  const at = nowIso()
  let a = m.id ? byId(m.id) : null
  if (a) Object.assign(a, structuredClone(d), { changedAt: at })
  else {
    a = { id: uid('bw'), ...structuredClone(d), status: 'neu', docs: [], log: [{ at, date: todayISO(), by: user(), kind: 'status', status: 'neu', text: 'erfasst' }], decidedAt: '', rejectMail: null, empId: '', createdAt: at, createdBy: user(), changedAt: at }
    doc().applicants.push(a)
    m.id = a.id
  }
  const files = m.pending.splice(0)
  if (files.length) {
    if (!quiet) toast('Unterlagen werden gespeichert …')
    for (const f of files) {
      const meta = await storeDoc(f, a.id)
      if (meta) a.docs = [...(a.docs || []), meta]
    }
  }
  persist()
  return a
}

// ---------------------------------------------------------------- Einstellungen (Absage-Vorlage, Fristen)

function settingsModal() {
  const s = doc().settings
  return modalFrame({
    title: 'Absage-Vorlage und Fristen',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Ohne Rückmeldung melden nach (Tagen)</span><input type="number" id="bew-set-silent" min="1" max="60" value="${esc(silentDaysOf(doc()))}"></label>
        <label class="field"><span>Abgelehnte Bewerbungen löschen nach (Monaten)</span><input type="number" id="bew-set-delete" min="1" max="36" value="${esc(deleteMonthsOf(doc()))}"></label>
        <label class="field wide"><span>Betreff der Absage</span><input type="text" id="bew-set-subject" value="${esc(s.rejectSubject || DEFAULT_REJECT.subject)}"></label>
        <label class="field wide"><span>Text der Absage</span><textarea id="bew-set-text" rows="12">${esc(s.rejectText || DEFAULT_REJECT.text)}</textarea></label>
      </div>
      <p class="note">Platzhalter: {name}, {firma}, {absender}, {monate}. Die Absage bleibt neutral: keine Gründe, die mit Geschlecht, Alter, Herkunft, Religion, Behinderung oder sexueller Orientierung zu tun haben (Gleichbehandlungsgesetz). Die Löschfrist von 6 Monaten folgt der Frist für Ansprüche nach dem Gleichbehandlungsgesetz; bitte bestätigen lassen.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn" data-action="bew-settings-reset">Vorlage zurücksetzen</button><button class="btn primary" data-action="bew-settings-save">Speichern</button></div>`,
  })
}
registerModal('bew-settings', settingsModal, { module: MODULE })

// ---------------------------------------------------------------- Aktionen

/** Nächster Werktag ab einem Tag (Mo–Fr). */
function workday(date) {
  let d = date
  while (isoWeekday(d) > 5) d = addDays(d, 1)
  return d
}

registerActions({
  'bew-filter': () => {
    Object.assign(app.ui, { bewStatus: val('bew-f-status'), bewSource: val('bew-f-source'), bewRegion: document.getElementById('bew-f-region') ? val('bew-f-region') : '', bewQ: val('bew-f-q') })
    renderNow()
  },
  'bew-reset': () => {
    Object.assign(app.ui, { bewStatus: '', bewSource: '', bewRegion: '', bewQ: '' })
    renderNow()
  },
  'bew-tile': (el) => {
    Object.assign(app.ui, { bewStatus: el.dataset.status || '', bewSource: '', bewRegion: '', bewQ: '' })
    renderNow()
  },
  'bew-edit-open': (el) => mayOpen() && openModal({ type: 'bew-edit', id: el.dataset.id || '' }),
  // aus „Zu erledigen“ und vom digitalen Mitarbeiter: Ansicht und Bewerbung öffnen
  'bew-open': (el) => {
    if (!mayOpen()) return
    app.ui.view = 'bewerber'
    openModal({ type: 'bew-edit', id: el.dataset.id || '' })
    renderNow()
  },
  'bew-doc-open': (el) => openDoc(byId(el.dataset.id)?.docs?.[Number(el.dataset.i)]),
})

registerActions(
  {
    'bew-save': async () => {
      const isNew = !app.ui.modal?.id
      const a = await save()
      if (!a) return
      renderNow()
      if (isNew) {
        // gleich weiter: Status, Gespräch, Absage
        openModal({ type: 'bew-edit', id: a.id })
        return toast(`Bewerbung von ${a.name} erfasst.`)
      }
      closeModal()
      toast('Gespeichert.')
    },
    'bew-doc': async (el) => {
      const files = [...(el.files || [])]
      if (!files.length) return
      const m = app.ui.modal
      readForm()
      m.pending.push(...files)
      if (m.pending.length + (byId(m.id)?.docs?.length || 0) > 12) toast('Bitte höchstens 12 Unterlagen je Bewerbung.')
      // bestehende Bewerbung: gleich hochladen (mit den Eingaben im Dialog)
      if (m.id) {
        const a = await save({ quiet: true })
        if (a) toast(`${plural(files.length, 'Unterlage', 'Unterlagen')} gespeichert.`)
      }
      renderModal()
    },
    'bew-doc-drop': (el) => {
      readForm()
      app.ui.modal.pending.splice(Number(el.dataset.i), 1)
      renderModal()
    },
    'bew-doc-del': async (el) => {
      const a = byId(el.dataset.id)
      const i = Number(el.dataset.i)
      const meta = a?.docs?.[i]
      if (!meta) return
      readForm()
      if (!confirmStep(`bew-ddel:${a.id}:${i}`, renderModal)) return
      const ok = await dropDoc(meta.path)
      a.docs = a.docs.filter((_, k) => k !== i)
      a.log = [...(a.log || []), { at: nowIso(), date: todayISO(), by: user(), kind: 'datei', text: `${meta.name} gelöscht` }]
      persist()
      renderModal()
      renderNow()
      toast(ok ? 'Unterlage gelöscht.' : 'Aus der Bewerbung entfernt; in SharePoint bitte von Hand löschen.')
    },
    'bew-status': (el) => {
      const a = byId(el.dataset.id)
      const status = el.dataset.status
      if (!a || !STATUS[status] || a.status === status) return
      readForm()
      if (a.empId && status !== 'zusage') return toast('Schon als Mitarbeiter:in übernommen: Status bleibt „Zusage“.')
      Object.assign(a, setStatus(a, status, { date: todayISO(), at: nowIso(), by: user() }))
      persist()
      renderModal()
      renderNow()
      toast(status === 'zusage' ? 'Zusage vermerkt. Jetzt als Mitarbeiter:in anlegen.' : status === 'absage' ? `Absage vermerkt. Löschen ab ${short(deleteDue(a, deleteMonthsOf(doc())))}.` : `Status: ${STATUS[status]}.`)
    },
    'bew-contact': (el) => {
      const a = byId(el.dataset.id)
      if (!a) return
      const text = val('bew-contact-text').trim()
      readForm()
      Object.assign(a, addLog(a, { kind: 'kontakt', date: todayISO(), at: nowIso(), by: user(), text: text || 'Kontakt' }))
      if (a.status === 'neu') Object.assign(a, setStatus(a, 'kontakt', { date: todayISO(), at: nowIso(), by: user() }))
      persist()
      renderModal()
      renderNow()
      toast('Kontakt vermerkt.')
    },
    'bew-reject': (el) => {
      const a = byId(el.dataset.id)
      if (!a) return
      readForm()
      const firma = app.config.brand?.name || ''
      const mail = rejectMail(a, { settings: doc().settings, firma, absender: user(), months: deleteMonthsOf(doc()) })
      if (!a.email) return toast('Keine E-Mail-Adresse: Absage bitte telefonisch oder per Brief und den Status „Absage“ setzen.')
      const id = a.id
      openCompose({
        to: a.email,
        subject: mail.subject,
        text: mail.text,
        origin: `Bewerbung ${a.name}`,
        onSent: ({ via, to }) => {
          const x = byId(id)
          if (!x) return
          const at = nowIso()
          if (x.status !== 'absage') Object.assign(x, setStatus(x, 'absage', { date: todayISO(), at, by: user(), text: 'mit Absage-Mail' }))
          x.rejectMail = { at, by: user(), via, to }
          x.log = [...(x.log || []), { at, date: todayISO(), by: user(), kind: 'mail', text: `Absage an ${to.join(', ')}` }]
          persist()
          renderNow()
        },
      })
    },
    'bew-delete': async (el) => {
      const a = byId(el.dataset.id)
      if (!a) return
      if (!confirmStep(`bew-del:${a.id}`, renderModal)) return
      const { applicants, files } = removeApplicant(doc().applicants, a.id)
      let failed = 0
      for (const p of files) if (!(await dropDoc(p))) failed++
      doc().applicants = applicants
      // Gesprächstermine mit dem Namen aus „Termine“ nehmen (der Outlook-Termin bleibt im Kalender)
      if (canEdit('termine') && app.data.termine?.items) app.data.termine.items = app.data.termine.items.filter((t) => t.ref !== `bew:${a.id}`)
      persist()
      closeModal()
      renderNow()
      toast(`Bewerbung gelöscht${files.length ? ` mit ${plural(files.length, 'Unterlage', 'Unterlagen')} (Papierkorb der SharePoint-Website)` : ''}.${failed ? ` ${failed} in SharePoint bitte von Hand löschen.` : ''}`)
    },
    'bew-hire': async (el) => {
      if (!canEdit('stammdaten')) return toast('Mitarbeitende anlegen darf, wer die Stammdaten bearbeitet.')
      // Eingaben im Dialog zuerst speichern (z. B. Beginn gerade eingetragen)
      const a = (app.ui.modal?.type === 'bew-edit' ? await save({ quiet: true }) : null) || byId(el.dataset.id)
      if (!a) return
      openModal({ type: 'employee', id: 'new', prefill: employeeFrom(a, { skills: app.data.skills || [] }), from: `Aus der Bewerbung von ${a.name}: bitte Personalnummer, Lohngruppe und Eintritt ergänzen bzw. prüfen.`, bewId: a.id })
    },
    'bew-settings-open': () => openModal({ type: 'bew-settings' }),
    'bew-settings-reset': () => {
      document.getElementById('bew-set-subject').value = DEFAULT_REJECT.subject
      document.getElementById('bew-set-text').value = DEFAULT_REJECT.text
    },
    'bew-settings-save': () => {
      const silent = Math.round(Number(val('bew-set-silent')))
      const months = Math.round(Number(val('bew-set-delete')))
      if (!(silent >= 1 && silent <= 60)) return toast('Tage ohne Rückmeldung zwischen 1 und 60.')
      if (!(months >= 1 && months <= 36)) return toast('Löschfrist zwischen 1 und 36 Monaten.')
      const subject = val('bew-set-subject').trim()
      const text = val('bew-set-text')
      doc().settings = { ...doc().settings, silentDays: silent, deleteMonths: months, rejectSubject: subject === DEFAULT_REJECT.subject ? '' : subject, rejectText: text.trim() === DEFAULT_REJECT.text ? '' : text }
      persist()
      closeModal()
      renderNow()
      toast('Gespeichert.')
    },
  },
  { edit: MODULE },
)

// Gespräch als Outlook-Termin über „Termine“ (Dialog „appt“, Recht auf Termine)
registerActions(
  {
    'bew-interview': (el) => {
      const a = byId(el.dataset.id)
      if (!a) return
      if (app.ui.modal?.type === 'bew-edit' && editable()) readForm()
      openModal({ type: 'appt', date: workday(addDays(todayISO(), 2)), time: '10:00', minutes: 45, kind: 'bewerbung', title: `Bewerbungsgespräch ${a.name}`, ref: `bew:${a.id}` })
    },
  },
  { edit: 'termine' },
)

// Termin des Gesprächs gespeichert: Status „Gespräch geplant“, Eintrag im Verlauf
onAppointmentSaved((t) => {
  const [kind, id] = String(t.ref || '').split(':')
  const a = kind === 'bew' ? byId(id) : null
  if (!a || !canEdit(MODULE)) return
  const date = t.start.slice(0, 10)
  const text = `${formatDate(date, { year: true })} ${t.allDay ? '' : t.start.slice(11, 16)}`.trim()
  if (['neu', 'kontakt'].includes(a.status)) Object.assign(a, setStatus(a, 'gespraech', { date: todayISO(), at: nowIso(), by: user(), text: `Gespräch am ${text}` }))
  else Object.assign(a, addLog(a, { kind: 'termin', date: todayISO(), at: nowIso(), by: user(), text: `Gespräch am ${text}` }))
})

// Aus der Bewerbung angelegt (staff.js): verknüpfen, Zusage, Eintritts-Checkliste starten und öffnen
onEmployeeCreated((emp, modal) => {
  const a = modal?.bewId ? byId(modal.bewId) : null
  if (!a || !canEdit(MODULE)) return
  const at = nowIso()
  if (a.status !== 'zusage') Object.assign(a, setStatus(a, 'zusage', { date: todayISO(), at, by: user() }))
  Object.assign(a, addLog(a, { kind: 'status', date: todayISO(), at, by: user(), text: `als Mitarbeiter:in angelegt (${emp.name})` }), { empId: emp.id })
  let list = null
  if (canEdit('eintritt') && !openListOf(emp.id, 'eintritt')) list = startChecklist({ kind: 'eintritt', empId: emp.id, applicantId: a.id, date: emp.entryDate || a.start || workday(addDays(todayISO(), 7)) })
  persist()
  renderNow()
  if (list) {
    app.ui.bewKind = 'eintritt'
    openModal({ type: 'bew-list', id: list.id })
    toast(`${emp.name} angelegt, Eintritts-Checkliste gestartet (${plural(list.tasks.length, 'Aufgabe', 'Aufgaben')}).`)
  } else toast(`${emp.name} angelegt und mit der Bewerbung verknüpft.`)
})

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'bewerber',
  module: MODULE,
  title: 'Bewerbungen',
  compute: (today) => {
    const d = doc()
    const del = deletionsDue(d.applicants, today, deleteMonthsOf(d)).map((x) => ({ id: `loeschen:${x.a.id}`, kind: 'loeschen', ...x }))
    const still = silentApplicants(d.applicants, today, silentDaysOf(d)).map((x) => ({ id: `still:${x.a.id}:${x.since}`, kind: 'still', ...x }))
    return [...del, ...still]
  },
  render: (list) =>
    list
      .map((x) =>
        x.kind === 'loeschen'
          ? `<div class="todo-item"><span class="flag error">!</span><div class="todo-text"><strong>${esc(x.a.name)}</strong>: Bewerbung löschen<br><span class="muted">${esc(STATUS[x.a.status])} am ${esc(short(x.a.decidedAt))}, Löschfrist seit ${esc(short(x.due))}. Gelöscht wird erst nach Klick.</span></div><button class="btn small primary" data-action="bew-open" data-id="${esc(x.a.id)}">Öffnen</button></div>`
          : `<div class="todo-item"><span class="flag warning">${x.days}</span><div class="todo-text"><strong>${esc(x.a.name)}</strong>: seit ${x.days} Tagen ohne Rückmeldung<br><span class="muted">${esc(STATUS[x.a.status])}, zuletzt ${esc(short(x.since))} · melden oder Status setzen</span></div><button class="btn small primary" data-action="bew-open" data-id="${esc(x.a.id)}">Öffnen</button></div>`,
      )
      .join(''),
})
