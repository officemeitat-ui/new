// Mitarbeiterakte (Verwaltung, Modul „akte“): je Person Vermerke (aus der Qualitätsmessung mit „gereinigt von“ oder von
// Hand mit Fotos), offen fürs Mitarbeitergespräch; ab 3 offenen Vermerken erinnert „Zu erledigen“. Gespräch mit
// Ergebnis, Vereinbarung und Protokoll (PDF). Datei mitarbeiterakte/akte.json, Dateien je Person unter
// mitarbeiterakte/<Name>_<ID>/ (SharePoint). Rechenkern: core/mitarbeiterakte.js, PDF: export/akte-pdf.js.

import { todayISO, formatDate } from '../../core/dates.js'
import { AKTE_DEFAULTS, AKTE_KINDS, akteSettings, emptyAkte, entriesFromMeasurement, entriesOf, folderOf, openEntries, purge, recordTalk, summary, talksDue } from '../../core/mitarbeiterakte.js'
import { DEFECT_DEFAULTS } from '../../core/qualitaet.js'
import { entryDocument, entryPdfName, talkDocument, talkPdfName } from '../../export/akte-pdf.js'
import { app, canEdit, closeModal, confirmStep, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checkedValues, download, esc, ICON, menu, modalFrame, options, uid, val } from '../shared.js'
import { openFile, storeFile } from './anlagen.js'

const MODULE = 'akte'
const ICON_AKTE = '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h5"/>'
const doc = () => {
  const d = (app.data.akte ||= emptyAkte())
  d.entries ||= []
  d.talks ||= []
  d.settings ||= {}
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const empOf = (id) => app.data.employees.find((e) => e.id === id)
const objName = (id) => app.data.objects.find((o) => o.id === id)?.name || ''
const nowIso = () => new Date().toISOString()
const by = () => app.user?.name || 'Browser'
const short = (d) => (d ? formatDate(d, { weekday: false, year: true }) : '')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const active = () => app.data.employees.filter((e) => !e.exitDate || e.exitDate >= todayISO()).sort((a, b) => a.name.localeCompare(b.name, 'de'))
const S = { importedAt: 0, purgedDay: '' }

/** Fehlerarten der Qualitätsmessung (Namen für den Text des Vermerks). */
const defectNames = () => Object.fromEntries([...DEFECT_DEFAULTS, ...(app.data.qualitaet?.settings?.defectTypes || [])].map((x) => [x.id, x.name]))

/** Datei lesen (Fotos der Messung fürs PDF): nur im Betrieb mit SharePoint. */
async function blobOf(meta) {
  if (!meta || meta.local || app.store?.kind !== 'sharepoint') return null
  return app.store.readBlob?.(meta.path).catch(() => null) ?? null
}
async function dataUrl(blob) {
  if (!blob) return null
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer())
  const type = head[0] === 0xff && head[1] === 0xd8 ? 'image/jpeg' : head[0] === 0x89 && head[1] === 0x50 ? 'image/png' : ''
  if (!type) return null
  return new Promise((resolve) => Object.assign(new FileReader(), { onload: (e) => resolve(e.target.result), onerror: () => resolve(null) }).readAsDataURL(new Blob([blob], { type })))
}

async function entryPdf(entry) {
  const photos = new Map()
  for (const p of entry.photos || []) {
    const url = await dataUrl(await blobOf(p))
    if (url) photos.set(p.path, url)
  }
  return pdfBlob(entryDocument({ entry, emp: empOf(entry.empId) || {}, objectName: objName(entry.objectId), photos, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) }))
}

/** Vermerk als PDF in den Ordner der Person (SharePoint) legen; liefert die Datei oder null. */
async function storeEntryPdf(entry) {
  const emp = empOf(entry.empId)
  if (!emp) return null
  const blob = await entryPdf(entry)
  const meta = await storeFile(new File([blob], entryPdfName(entry, emp), { type: 'application/pdf' }), `${folderOf(emp)}/${entry.date}_vermerk_${entry.id}`)
  const cur = doc().entries.find((e) => e.id === entry.id)
  if (meta && cur) {
    cur.pdf = meta
    persist()
  }
  return meta
}

/**
 * Vermerke aus fertigen Qualitätsmessungen übernehmen (Räume mit Mangel und „gereinigt von“), dann je Vermerk das PDF mit
 * den Fotos in den Ordner der Person. Höchstens alle 2 Minuten; liefert die Zahl der neuen Vermerke.
 */
export async function importFromQuality({ force = false } = {}) {
  const q = app.data.qualitaet
  if (!q || !editable() || (!force && Date.now() - S.importedAt < 120e3)) return 0
  S.importedAt = Date.now()
  const added = []
  for (const m of q.measurements || []) {
    if (m.status !== 'fertig') continue
    for (const e of entriesFromMeasurement(m, { doc: doc(), objectName: objName(m.objectId), defectNames: defectNames() })) {
      const entry = { id: uid('v'), ...e, by: m.by || m.user || '', at: m.finishedAt || nowIso(), talkId: '', pdf: null }
      doc().entries.push(entry)
      added.push(entry)
    }
  }
  if (!added.length) return 0
  persist()
  for (const e of added) await storeEntryPdf(e).catch(() => null)
  if (app.ui.view === 'akte' && !app.ui.modal) renderNow()
  return added.length
}

/** Einmal am Tag: besprochene Vermerke nach der Aufbewahrungsfrist entfernen (samt ihren Dateien in SharePoint). */
async function purgeOld() {
  const today = todayISO()
  if (!editable() || S.purgedDay === today) return
  S.purgedDay = today
  const gone = purge(doc(), today)
  if (!gone.entries.length && !gone.talks.length) return
  persist()
  if (app.store?.kind === 'sharepoint') for (const f of [...gone.entries.flatMap((e) => [e.pdf, ...(e.source ? [] : e.photos || [])]), ...gone.talks.map((t) => t.pdf)].filter(Boolean)) await app.store.remove?.(f.path).catch(() => null)
}

// ---------------------------------------------------------------- Ansicht

function akteView() {
  importFromQuality()
  purgeOld()
  const today = todayISO()
  const ed = editable()
  const due = talksDue(doc(), app.data.employees, today)
  const q = String(app.ui.akSearch || '').trim().toLowerCase()
  const rows = active()
    .map((emp) => ({ emp, s: summary(doc(), emp.id) }))
    .filter((r) => (!app.ui.akOnly || r.s.total) && (!q || r.emp.name.toLowerCase().includes(q)))
    .sort((a, b) => b.s.open - a.s.open || a.emp.name.localeCompare(b.emp.name, 'de'))
  const { limit } = akteSettings(doc())
  const body = rows
    .map(({ emp, s }) => `<tr><td><button class="link-btn" data-action="ak-open" data-emp="${esc(emp.id)}"><strong>${esc(emp.name)}</strong></button>${emp.team ? `<br><span class="muted">${esc(emp.team)}</span>` : ''}</td>
      <td>${s.open ? `<span class="pill ${s.open >= limit ? 'error' : 'warning'}">${s.open} offen</span>` : '<span class="muted">–</span>'}</td><td class="num">${s.total || ''}</td><td>${esc(short(s.last))}</td><td>${esc(short(s.lastTalk))}</td>
      <td class="actions-cell"><button class="btn small" data-action="ak-open" data-emp="${esc(emp.id)}">Akte öffnen</button></td></tr>`)
    .join('')
  return `<div class="section-head"><div><h2>Mitarbeiterakte</h2><p>Vermerke je Person, z. B. aus der Objektkontrolle (Qualitätsmessung: „gereinigt von“) mit Foto und Bericht, fürs Mitarbeitergespräch. Ab ${limit} offenen Vermerken erinnert „Zu erledigen“ an das Gespräch.</p></div>
      <div class="actions">${ed ? `<button class="btn primary" data-action="ak-entry-open">${ICON.plus} Vermerk eintragen</button>` : ''}${menu({ label: 'Mehr', single: false, items: [ed && { label: 'Einstellungen', icon: ICON.gear, action: 'ak-settings-open', hint: `ab ${limit} Vermerken erinnern, aufbewahren` }, ed && { label: 'Aus der Qualitätsmessung übernehmen', icon: ICON.refresh, action: 'ak-import', hint: '„gereinigt von“ bei Mängeln' }] })}</div></div>
    ${due.length ? `<div class="banner warn-banner"><p><strong>Mitarbeitergespräch fällig:</strong> ${due.map((x) => `<button class="link-btn" data-action="ak-talk-open" data-emp="${esc(x.emp.id)}">${esc(x.emp.name)} (${x.entries.length})</button>`).join(', ')}</p></div>` : ''}
    <div class="filters"><label class="field inline"><span>Suche</span><input type="search" id="ak-search" value="${esc(app.ui.akSearch || '')}" data-input="ak-search" placeholder="Name"></label>
      <label class="check"><input type="checkbox" id="ak-only" ${app.ui.akOnly ? 'checked' : ''} data-change="ak-only"><span>nur mit Vermerken</span></label></div>
    ${body ? `<div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th>fürs Gespräch</th><th class="num">Vermerke</th><th>letzter Vermerk</th><th>letztes Gespräch</th><th></th></tr></thead><tbody>${body}</tbody></table></div>` : '<p class="empty">Niemand in dieser Auswahl.</p>'}
    <p class="note">Nur wer die Personalverwaltung sieht, liest die Akte. Die Person hat ein Recht auf Auskunft; besprochene Vermerke fallen nach ${akteSettings(doc()).keepMonths} Monaten weg. Dateien liegen in SharePoint im Ordner „mitarbeiterakte“ je Person.</p>`
}

registerView({
  id: 'akte',
  order: 207,
  label: 'Mitarbeiterakte',
  group: 'stamm',
  module: MODULE,
  icon: ICON_AKTE,
  noWeek: true,
  text: 'Vermerke, Objektkontrolle, Mitarbeitergespräch',
  badge: () => talksDue(doc(), app.data.employees, todayISO()).length,
  render: akteView,
})

// ---------------------------------------------------------------- Akte einer Person

const fileBtn = (meta, label, data) => (meta ? `<button type="button" class="btn small ghost" data-action="ak-file" ${data}>${ICON.camera} ${esc(label)}</button>` : '')

function personModal(c, m) {
  const emp = empOf(m.empId)
  if (!emp) return modalFrame({ title: 'Mitarbeiterakte', body: '<p>Diese Person gibt es nicht mehr.</p>', foot: '<button class="btn" data-action="close-modal">Schließen</button>' })
  const ed = editable()
  const s = summary(doc(), emp.id)
  const talkOf = (id) => doc().talks.find((t) => t.id === id)
  const entries = entriesOf(doc(), emp.id)
    .map((e) => {
      const t = e.talkId ? talkOf(e.talkId) : null
      const photos = (e.photos || []).map((p, i) => fileBtn(p, `Foto ${i + 1}`, `data-id="${esc(e.id)}" data-f="photo" data-i="${i}"`)).join(' ')
      return `<li class="ak-entry"><div><strong>${esc(short(e.date))}</strong> <span class="pill ${AKTE_KINDS[e.kind]?.counts === false ? 'ok' : t ? '' : 'warning'}">${esc(AKTE_KINDS[e.kind]?.label || e.kind)}</span>${e.objectId ? ` · ${esc(objName(e.objectId))}` : ''} ${t ? `<span class="muted">besprochen am ${esc(short(t.date))}</span>` : AKTE_KINDS[e.kind]?.counts === false ? '' : '<span class="muted">offen fürs Gespräch</span>'}</div>
        <div>${esc(e.title || '')}</div>${e.text ? `<div class="muted ak-text">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
        <div class="actions-row">${photos} ${fileBtn(e.report, 'Bericht der Messung', `data-id="${esc(e.id)}" data-f="report"`)} <button type="button" class="btn small" data-action="ak-entry-pdf" data-id="${esc(e.id)}">Vermerk (PDF)</button>${ed && !e.talkId ? ` <button type="button" class="btn small ghost" data-action="ak-entry-del" data-id="${esc(e.id)}">${app.ui.confirm === `ak-del:${e.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}</div></li>`
    })
    .join('')
  const talks = doc()
    .talks.filter((t) => t.empId === emp.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => `<li><strong>${esc(short(t.date))}</strong> · ${plural(t.entryIds.length, 'Vermerk', 'Vermerke')} · ${esc(t.by || '')}${t.note ? `<div>${esc(t.note)}</div>` : ''}${t.agreed ? `<div class="muted">Vereinbart: ${esc(t.agreed)}</div>` : ''} <button type="button" class="btn small" data-action="ak-talk-pdf" data-id="${esc(t.id)}">Protokoll (PDF)</button></li>`)
    .join('')
  return modalFrame({
    title: `Mitarbeiterakte: ${emp.name}`,
    subtitle: `${plural(s.total, 'Vermerk', 'Vermerke')}${s.open ? `, ${s.open} offen fürs Gespräch` : ''}${s.lastTalk ? ` · letztes Gespräch ${short(s.lastTalk)}` : ''}`,
    wide: true,
    body: `${ed ? `<p><button class="btn" data-action="ak-entry-open" data-emp="${esc(emp.id)}">${ICON.plus} Vermerk eintragen</button> ${s.open ? `<button class="btn primary" data-action="ak-talk-open" data-emp="${esc(emp.id)}">Mitarbeitergespräch führen</button>` : ''}</p>` : ''}
      <section><h3>Vermerke</h3>${entries ? `<ul class="tc-list ak-list">${entries}</ul>` : '<p class="muted">Noch keine Vermerke.</p>'}</section>
      ${talks ? `<section><h3>Gespräche</h3><ul class="tc-list">${talks}</ul></section>` : ''}`,
    foot: '<button class="btn" data-action="close-modal">Schließen</button>',
  })
}
registerModal('ak-person', personModal, { module: MODULE })

// ---------------------------------------------------------------- Vermerk eintragen

function entryModal(c, m) {
  m.date ||= todayISO()
  m.kind ||= 'qualitaet'
  return modalFrame({
    title: 'Vermerk eintragen',
    body: `<div class="form-grid">
        <label class="field"><span>Person</span><select id="ak-emp">${options(active().map((e) => [e.id, e.name]), m.empId || '', { empty: '– Person –' })}</select></label>
        <label class="field"><span>Datum</span><input type="date" id="ak-date" value="${esc(m.date)}"></label>
        <label class="field"><span>Art</span><select id="ak-kind">${options(Object.entries(AKTE_KINDS).map(([k, x]) => [k, x.label]), m.kind)}</select></label>
        <label class="field"><span>Objekt (optional)</span><select id="ak-obj">${options(app.data.objects.map((o) => [o.id, o.name]).sort((a, b) => a[1].localeCompare(b[1], 'de')), m.objectId || '', { empty: '– ohne Objekt –' })}</select></label>
        <label class="field wide"><span>Kurz</span><input type="text" id="ak-title" value="${esc(m.title || '')}" placeholder="z. B. Sanitär nicht ordentlich gereinigt"></label>
        <label class="field wide"><span>Was war los?</span><textarea id="ak-text" rows="4" placeholder="Was wurde festgestellt, wo genau, was wurde schon gesagt">${esc(m.text || '')}</textarea></label>
        <label class="field wide"><span>Fotos (optional)</span><input type="file" id="ak-photos" accept="image/*" capture="environment" multiple></label>
      </div>
      <p class="note">Sachlich festhalten, was festgestellt wurde. Der Vermerk kommt mit Fotos als PDF in den Ordner der Person (SharePoint) und ist offen fürs nächste Mitarbeitergespräch (Lob und Notiz zählen nicht mit).</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="ak-entry-save">Eintragen</button></div>`,
  })
}
registerModal('ak-entry', entryModal, { module: MODULE })

// ---------------------------------------------------------------- Gespräch

function talkModal(c, m) {
  const emp = empOf(m.empId)
  if (!emp) return ''
  const open = openEntries(doc(), emp.id)
  m.date ||= todayISO()
  return modalFrame({
    title: `Mitarbeitergespräch: ${emp.name}`,
    wide: true,
    body: `<div class="form-grid"><label class="field"><span>Datum</span><input type="date" id="akt-date" value="${esc(m.date)}"></label>
        <label class="field"><span>Nächstes Gespräch (optional)</span><input type="date" id="akt-follow" value="${esc(m.followUp || '')}"></label></div>
      <section><h3>Besprochen</h3>${open.length ? open.map((e) => `<label class="check"><input type="checkbox" name="akt-e" value="${esc(e.id)}" checked><span><strong>${esc(short(e.date))}</strong> ${esc(e.title || '')}${e.objectId ? ` · ${esc(objName(e.objectId))}` : ''}</span></label>`).join('') : '<p class="muted">Keine offenen Vermerke.</p>'}</section>
      <div class="form-grid"><label class="field wide"><span>Ergebnis (warum, Sicht der Person)</span><textarea id="akt-note" rows="3" placeholder="z. B. zu wenig Zeit im Objekt, Reinigungsmittel fehlte, neu im Objekt">${esc(m.note || '')}</textarea></label>
        <label class="field wide"><span>Vereinbarung</span><textarea id="akt-agreed" rows="3" placeholder="z. B. Einschulung WC-Reinigung am Montag, Checkliste am Handy, mehr Zeit eingeplant">${esc(m.agreed || '')}</textarea></label></div>
      <p class="note">Das Protokoll (PDF) hat Felder für beide Unterschriften und kommt in den Ordner der Person.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="ak-talk-save">Gespräch eintragen</button></div>`,
  })
}
registerModal('ak-talk', talkModal, { module: MODULE })

function settingsModal() {
  const s = akteSettings(doc())
  return modalFrame({
    title: 'Mitarbeiterakte: Einstellungen',
    body: `<div class="form-grid"><label class="field"><span>Erinnerung ans Gespräch ab (offene Vermerke)</span><input type="number" id="aks-limit" min="1" max="10" value="${esc(s.limit)}"></label>
      <label class="field"><span>Besprochene Vermerke aufbewahren (Monate)</span><input type="number" id="aks-keep" min="6" max="120" value="${esc(s.keepMonths)}"></label></div>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="ak-settings-save">Speichern</button></div>`,
  })
}
registerModal('ak-settings', settingsModal, { module: MODULE })

registerTodo({
  id: 'mitarbeitergespraech',
  module: MODULE,
  title: 'Mitarbeitergespräch',
  compute: (today) => talksDue(doc(), app.data.employees, today).map((x) => ({ id: `g:${x.emp.id}:${x.entries.length}`, ...x })),
  render: (items) =>
    items
      .map((x) => `<div class="todo-item"><span class="flag warning">${x.entries.length}</span><div class="todo-text"><strong>${esc(x.emp.name)}</strong>: ${plural(x.entries.length, 'Vermerk', 'Vermerke')} seit ${esc(short(x.since))} offen</div><button class="btn small" data-action="ak-talk-open" data-emp="${esc(x.emp.id)}">Gespräch führen</button></div>`)
      .join(''),
})

// ---------------------------------------------------------------- Aktionen

registerActions({
  'ak-search': () => {
    app.ui.akSearch = val('ak-search')
    renderNow()
    const el = document.getElementById('ak-search')
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  },
  'ak-only': () => {
    app.ui.akOnly = document.getElementById('ak-only')?.checked
    renderNow()
  },
  'ak-open': (el) => openModal({ type: 'ak-person', empId: el.dataset.emp }),
  'ak-file': (el) => {
    const e = doc().entries.find((x) => x.id === el.dataset.id)
    openFile(el.dataset.f === 'report' ? e?.report : e?.photos?.[Number(el.dataset.i)])
  },
  'ak-entry-pdf': async (el) => {
    const e = doc().entries.find((x) => x.id === el.dataset.id)
    if (e) download(entryPdfName(e, empOf(e.empId) || {}), await entryPdf(e))
  },
  'ak-talk-pdf': async (el) => {
    const t = doc().talks.find((x) => x.id === el.dataset.id)
    if (!t) return
    const emp = empOf(t.empId) || {}
    download(talkPdfName(t, emp), await pdfBlob(talkDocument({ talk: t, emp, entries: doc().entries.filter((e) => t.entryIds.includes(e.id)), objectName: objName, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })))
  },
})

registerActions(
  {
    'ak-entry-open': (el) => openModal({ type: 'ak-entry', empId: el?.dataset?.emp || '' }),
    'ak-entry-save': async () => {
      const m = app.ui.modal
      Object.assign(m, { empId: val('ak-emp'), date: val('ak-date') || todayISO(), kind: val('ak-kind'), objectId: val('ak-obj'), title: val('ak-title').trim(), text: val('ak-text').trim() })
      const emp = empOf(m.empId)
      if (!emp) return toast('Bitte die Person wählen.')
      if (!m.title && !m.text) return toast('Bitte kurz eintragen, was war.')
      const files = [...(document.getElementById('ak-photos')?.files || [])].slice(0, 6)
      const id = uid('v')
      const photos = []
      for (const [i, f] of files.entries()) {
        const meta = await storeFile(f, `${folderOf(emp)}/${m.date}_foto_${id}_${i + 1}`)
        if (meta) photos.push(meta)
      }
      const entry = { id, empId: emp.id, date: m.date, kind: m.kind, objectId: m.objectId || '', title: m.title || AKTE_KINDS[m.kind]?.label || 'Vermerk', text: m.text, photos, report: null, source: null, by: by(), at: nowIso(), talkId: '', pdf: null }
      doc().entries.push(entry)
      persist()
      openModal({ type: 'ak-person', empId: emp.id })
      renderNow()
      const pdf = await storeEntryPdf(entry).catch(() => null)
      const open = openEntries(doc(), emp.id).length
      toast(`Vermerk eingetragen${pdf && !pdf.local ? ' (PDF im Ordner der Person)' : ''}.${open >= akteSettings(doc()).limit ? ` ${emp.name} hat jetzt ${open} offene Vermerke: Mitarbeitergespräch führen.` : ''}`)
    },
    'ak-entry-del': (el) => {
      if (!confirmStep(`ak-del:${el.dataset.id}`, renderModal)) return
      doc().entries = doc().entries.filter((e) => e.id !== el.dataset.id || e.talkId)
      persist()
      renderModal()
      renderNow()
    },
    'ak-talk-open': (el) => openModal({ type: 'ak-talk', empId: el.dataset.emp }),
    'ak-talk-save': async () => {
      const m = app.ui.modal
      const emp = empOf(m.empId)
      if (!emp) return
      const entryIds = checkedValues('akt-e')
      const note = val('akt-note').trim()
      if (!entryIds.length && !note) return toast('Bitte mindestens einen Vermerk ankreuzen oder das Ergebnis eintragen.')
      const talk = recordTalk(doc(), { id: uid('g'), empId: emp.id, date: val('akt-date') || todayISO(), entryIds, note, agreed: val('akt-agreed').trim(), followUp: val('akt-follow'), by: by(), at: nowIso() })
      persist()
      openModal({ type: 'ak-person', empId: emp.id })
      renderNow()
      const blob = await pdfBlob(talkDocument({ talk, emp, entries: doc().entries.filter((e) => entryIds.includes(e.id)), objectName: objName, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) }))
      download(talkPdfName(talk, emp), blob)
      const meta = await storeFile(new File([blob], talkPdfName(talk, emp), { type: 'application/pdf' }), `${folderOf(emp)}/${talk.date}_gespraech_${talk.id}`)
      if (meta) {
        const cur = doc().talks.find((t) => t.id === talk.id)
        if (cur) cur.pdf = meta
        persist()
      }
      toast(`Gespräch eingetragen, ${plural(entryIds.length, 'Vermerk', 'Vermerke')} besprochen. Protokoll zum Unterschreiben heruntergeladen.`)
    },
    'ak-settings-open': () => openModal({ type: 'ak-settings' }),
    'ak-settings-save': () => {
      doc().settings = { ...doc().settings, limit: Math.min(10, Math.max(1, Math.round(Number(val('aks-limit')) || AKTE_DEFAULTS.limit))), keepMonths: Math.min(120, Math.max(6, Math.round(Number(val('aks-keep')) || AKTE_DEFAULTS.keepMonths))) }
      persist()
      closeModal()
      renderNow()
      toast('Einstellungen gespeichert.')
    },
    'ak-import': async () => {
      const n = await importFromQuality({ force: true })
      toast(n ? `${plural(n, 'Vermerk', 'Vermerke')} aus der Qualitätsmessung übernommen.` : 'Nichts Neues aus der Qualitätsmessung (Räume mit Mangel und „gereinigt von“).')
      renderNow()
    },
  },
  { edit: MODULE },
)
