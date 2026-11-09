// Mitteilungen an Mitarbeitende mit Lesebestätigung (Büro): verfassen (Titel, Text, Anhang, Empfänger, Wichtigkeit,
// sichtbar ab/bis), auf Knopfdruck mit der KI übersetzen (Vorschlag, im Dialog prüf- und änderbar), veröffentlichen,
// Übersicht „gelesen/bestätigt x von y“ mit offenen Personen, „Erinnern“, Nachweis als PDF, Verknüpfung mit
// Unterweisungen & Fristen (Lesebestätigung als Nachweis, nur Arten der Unterweisung).
//
// Zustellung: ohne Konto über „Mein Plan“ (mein-plan.php, Schlüssel und Links aus „Plan am Handy“, ui/staffplan.js),
// mit Konto über das Postfach in SharePoint (mitteilungen/konten/postfach.json, gelesen in views/mitteilungen-postfach.js).
// Die Rückmeldungen holt die App alle 3 Minuten ab, solange jemand mit Bearbeitungsrecht sie offen hat (wie die Anträge),
// „Jetzt abholen“ sofort. Rechenkern: core/mitteilungen.js, PDF: export/mitteilung-pdf.js. Kürzel: „mit-“.

import { addDays, formatDate, todayISO } from '../../core/dates.js'
import {
  accountPayload,
  deliveryOf,
  deliverySummary,
  emptyMitteilungen,
  importAccountReceipts,
  importWebReceipts,
  messageState,
  MIT_LIMITS,
  MIT_TYPES,
  progress,
  progressText,
  pruneAccountReceipts,
  recipientLanguages,
  remind,
  resolveRecipients,
  STATE_TEXT,
  TARGETS,
  teamsOf,
  trainingRecords,
  trainingTypesForMessages,
  translationState,
  updateMessageTranslations,
  validateMessage,
  webPayload,
} from '../../core/mitteilungen.js'
import { langInfo, langOf } from '../../core/sprachen.js'
import { hashIndex, sha256Hex } from '../../core/staffplan.js'
import { typesOf } from '../../core/trainings.js'
import { messageProofDocument, messageProofName } from '../../export/mitteilung-pdf.js'
import { app, canEdit, closeModal, computeRange, confirmStep, ensureRange, onModalRender, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { call, portalSettings } from '../staffplan.js'
import { checked, checkedValues, download, esc, ICON, menu, modalFrame, options, uid, val } from '../shared.js'
import { mitIcon } from './lazy.js'

const MODULE = 'mitteilungen'
const doc = () => {
  const d = (app.data.mitteilungen ||= emptyMitteilungen())
  d.items ||= []
  d.receipts ||= {}
  d.settings ||= {}
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const sees = (m) => !app.access || app.access.sees(m)
const nowIso = () => new Date().toISOString()
const by = () => app.user?.name || 'Browser'
const empById = (id) => app.data.employees.find((e) => e.id === id)
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const short = (d) => formatDate(d, { weekday: false, year: true })
const when = (iso) => (iso ? new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const sizeText = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const portalOn = () => {
  const p = portalSettings()
  return !!(p.enabled && p.key)
}
const deliveryOpts = () => ({ codes: portalSettings().codes || {}, portalOn: portalOn() })
const STATE_CLS = { entwurf: 'na', geplant: 'info', laeuft: 'ok', beendet: 'na', zurueckgezogen: 'warning' }

// ---------------------------------------------------------------- Empfänger

/** Wer im Zeitraum in Objekten eingeteilt ist (nur mit Einsicht in die Einsatzplanung; sonst zählen die Stammkräfte). */
function assignedBetween(from, to) {
  if (!sees('planung') || !from || !to || to < from) return []
  const end = [to, addDays(from, 13)].sort()[0]
  const c = computeRange(from, end)
  const out = []
  for (const i of c.instances) if (i.date >= from && i.date <= end && i.status !== 'cancelled') for (const a of c.state.assigned(i.key)) out.push({ employeeId: a.employeeId, objectId: i.objectId })
  return out
}

const recipientsOf = (target, ab, bis) => resolveRecipients(target, { employees: app.data.employees, tasks: app.data.tasks || [], assigned: target?.art === 'objekt' ? assignedBetween(ab, bis) : [], from: ab || todayISO(), to: bis || ab || todayISO() })

/** Empfänger als Text, z. B. „Revier/Team: Flachgau, Tennengau“. */
function targetText(t) {
  const label = TARGETS.find(([id]) => id === t?.art)?.[1] || ''
  if (!t || t.art === 'alle') return label
  const names = (t.werte || []).map((v) => (t.art === 'objekt' ? app.data.objects.find((o) => o.id === v)?.name : t.art === 'personen' ? empById(v)?.name : v) || v)
  return `${label}: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` und ${names.length - 4} weitere` : ''}`
}

const wegText = (emp) => {
  const d = deliveryOf(emp, deliveryOpts())
  return [d.handy && 'Mein Plan', d.app && 'App'].filter(Boolean).join(', ') || 'kein Zugang'
}

// ---------------------------------------------------------------- Anhänge

// Browser-Modus: Anhänge nur in diesem Fenster; mit SharePoint unter mitteilungen/konten/anhaenge/ (lesen alle Konten)
const LOCAL = new Map()

/** Bild verkleinern (Handy-Foto): längste Seite höchstens 2000 Pixel, JPEG. PDF und kleine Bilder bleiben. */
async function shrink(file, max = 2000, quality = 0.82) {
  if (!/^image\//.test(file.type) || (file.size < 700e3 && MIT_TYPES[file.type]) || typeof createImageBitmap !== 'function') return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality))
    return blob ? new File([blob], `${String(file.name || 'bild').replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

async function attachmentBlob(m) {
  if (!m?.anhang) return null
  if (LOCAL.has(m.id)) return LOCAL.get(m.id)
  if (!m.anhang.pfad || !app.store?.readBlob) return null
  return app.store.readBlob(m.anhang.pfad).catch(() => null)
}

/** Anhang des Entwurfs ablegen: SharePoint (mitteilungen/konten/anhaenge/<id>.<Endung>), sonst nur in diesem Fenster. */
async function storeAttachment(id, file) {
  const ext = MIT_TYPES[file.type]
  const meta = { name: file.name || `Anhang.${ext}`, typ: file.type, groesse: file.size, pfad: `mitteilungen/konten/anhaenge/${id}.${ext}` }
  LOCAL.set(id, file)
  if (app.store?.kind !== 'sharepoint') return { ...meta, pfad: '' }
  await app.store.upload(meta.pfad, file, file.type)
  return meta
}

// ---------------------------------------------------------------- Übertragen und Abholen

const S = { running: false, at: 0, error: '', seit: 0, timer: null, webDay: '', webAt: 0, sending: null }

/** Anhang an den Webspace (Rohdaten mit dem Schlüssel von „Plan am Handy“). */
async function uploadToWeb(m) {
  const blob = await attachmentBlob(m)
  if (!blob) throw new Error(`Anhang „${m.anhang.name}“ ist auf diesem Gerät nicht verfügbar`)
  const res = await fetch(`mein-plan.php?aktion=mitteilung-anhang&id=${encodeURIComponent(m.id)}`, { method: 'POST', headers: { 'X-Schluessel': portalSettings().key, 'Content-Type': m.anhang.typ }, body: blob, cache: 'no-store' })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.fehler || `Anhang: Antwort ${res.status}`)
}

/**
 * Laufende und geplante Mitteilungen verteilen: Postfach der Konten (SharePoint) und „Mein Plan“ (Webspace, nur mit
 * eingeschaltetem Plan am Handy). Vorher die Bestätigungen der Konten übernehmen (sonst gingen sie beim Aufräumen verloren).
 * Liefert { web: Antwort oder null, app: Anzahl im Postfach }.
 */
async function distribute() {
  const today = todayISO()
  const d = doc()
  const acc = importAccountReceipts(d, app.data.mitBestaetigt?.receipts || {}, app.data.employees)
  if (acc.changed) d.receipts = acc.receipts
  const box = accountPayload(d.items, app.data.employees, today)
  if (JSON.stringify(box) !== JSON.stringify(app.data.mitPostfach || {})) app.data.mitPostfach = box
  const pruned = pruneAccountReceipts(app.data.mitBestaetigt?.receipts || {}, box)
  if (pruned !== (app.data.mitBestaetigt?.receipts || {})) app.data.mitBestaetigt = { ...(app.data.mitBestaetigt || {}), receipts: pruned }
  persist()
  if (!portalOn()) return { web: null, app: box.items.length }
  const p = portalSettings()
  const hashes = new Map()
  const live = d.items.filter((m) => m.status === 'veroeffentlicht' && m.bis >= today)
  for (const m of live) for (const id of m.empfaenger || []) if (p.codes?.[id] && !hashes.has(id)) hashes.set(id, await sha256Hex(p.codes[id]))
  const personen = [...hashes].map(([id, hash]) => ({ hash, name: empById(id)?.name || '', ntfy: p.topics?.[id] || '', sprache: langOf(empById(id)) }))
  const res = await call('mitteilungen', { mitteilungen: webPayload(d.items, { hashOf: (id) => hashes.get(id) || null, today }), personen })
  const missing = []
  for (const id of res.anhaengeFehlen || []) {
    const m = d.items.find((x) => x.id === id)
    try {
      if (m) await uploadToWeb(m)
    } catch (err) {
      missing.push(err.message)
    }
  }
  S.webDay = today
  S.webAt = Date.now()
  return { web: { ...res, missing }, app: box.items.length }
}

/** Ergebnis des Übertragens als kurzer Satz. */
function distributeNote(r) {
  if (!r) return ''
  const web = r.web ? ` Mein Plan: ${plural(r.web.mitteilungen, 'Mitteilung', 'Mitteilungen')}${r.web.push ? `, ${plural(r.web.push, 'Push-Nachricht', 'Push-Nachrichten')}` : ''}.` : portalOn() ? '' : ' Plan am Handy ist aus: nur Personen mit Konto bekommen sie in der App.'
  return `${web}${r.web?.missing?.length ? ` Achtung: ${r.web.missing.join('; ')}.` : ''}`
}

/** Unterweisungsnachweise aus bestätigten Mitteilungen eintragen (nur mit Recht auf Unterweisungen & Fristen). */
function addTrainingRecords() {
  if (!canEdit('unterweisungen') || !app.data.unterweisungen) return 0
  const t = app.data.unterweisungen
  t.records ||= []
  const recs = trainingRecords(doc().items, doc().receipts, t.records, { newId: () => uid('u'), by: 'Mitteilung (Lesebestätigung)', types: typesOf(t) })
  if (recs.length) t.records.push(...recs)
  return recs.length
}

/** Rückmeldungen abholen: Webspace (Mein Plan) und Konten (App); höchstens alle 3 Minuten, force: sofort. */
export async function syncMessages({ force = false } = {}) {
  if (!canEdit(MODULE) || S.running || (!force && Date.now() - S.at < 170e3)) return null
  S.running = true
  S.at = Date.now()
  let changed = 0
  let trained = 0
  try {
    const d = doc()
    const acc = importAccountReceipts(d, app.data.mitBestaetigt?.receipts || {}, app.data.employees)
    if (acc.changed) {
      d.receipts = acc.receipts
      changed += acc.changed
    }
    if (portalOn() && d.items.some((m) => m.status !== 'entwurf')) {
      const [res, index] = await Promise.all([call(`mitteilungen-status&seit=${S.seit ? S.seit - 300 : 0}`), hashIndex(portalSettings())])
      const web = importWebReceipts(d, res.status || [], index)
      if (web.changed) {
        d.receipts = web.receipts
        changed += web.changed
      }
      S.seit = Number(res.jetzt) || 0
    }
    trained = addTrainingRecords()
    if (changed || trained) persist()
    // einmal am Tag neu verteilen: geplante werden sichtbar, beendete fallen am Webspace weg (samt Rückmeldungen)
    if (S.webDay !== todayISO() && d.items.some((m) => m.status !== 'entwurf')) await distribute()
    S.error = ''
  } catch (err) {
    S.error = err.message || String(err)
  } finally {
    S.running = false
  }
  if ((changed || trained) && (app.ui.view === 'mitteilungen' || String(app.ui.modal?.type || '').startsWith('mit-'))) {
    if (app.ui.modal) renderModal()
    else renderNow()
  }
  return { changed, trained }
}

function startPolling() {
  if (S.timer || typeof window === 'undefined') return
  S.timer = setInterval(() => syncMessages(), 180e3)
  document.addEventListener?.('visibilitychange', () => document.visibilityState === 'visible' && syncMessages())
}

// ---------------------------------------------------------------- Ansicht

function row(m, today) {
  const st = messageState(m, today)
  const p = progress(m, doc().receipts)
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
  const prog = st === 'entwurf' ? '<span class="muted">noch nicht veröffentlicht</span>' : `<span class="mit-prog"><b>${esc(progressText(m, p))}</b><span class="mwf-bar" role="img" aria-label="${esc(progressText(m, p))}"><span style="width:${pct}%"></span></span></span>`
  return `<tr>
    <td><button class="link-btn mit-title" data-action="mit-open" data-id="${esc(m.id)}"><strong>${esc(m.titel || '(ohne Titel)')}</strong></button>${m.wichtig === 'bestaetigen' ? ' <span class="pill warning">Bestätigung nötig</span>' : ''}${m.anhang ? ` <span class="tag" title="${esc(m.anhang.name)}">Anhang</span>` : ''}<br><span class="muted">${esc(targetText(m.an))}</span></td>
    <td>${esc(short(m.ab))} – ${esc(short(m.bis))}</td>
    <td><span class="pill ${STATE_CLS[st]}">${esc(STATE_TEXT[st])}</span></td>
    <td>${prog}</td>
    <td class="actions-cell"><button class="btn small" data-action="mit-open" data-id="${esc(m.id)}">Öffnen</button></td>
  </tr>`
}

function mitView() {
  startPolling()
  syncMessages()
  const today = todayISO()
  const ed = editable()
  const items = [...doc().items].sort((a, b) => String(b.ab).localeCompare(String(a.ab)) || String(b.erstellt?.at || '').localeCompare(String(a.erstellt?.at || '')))
  const groups = [
    ['Laufend und geplant', items.filter((m) => ['laeuft', 'geplant'].includes(messageState(m, today)))],
    ['Entwürfe', items.filter((m) => messageState(m, today) === 'entwurf')],
  ]
  const old = items.filter((m) => ['beendet', 'zurueckgezogen'].includes(messageState(m, today)))
  const table = (list) => `<div class="table-wrap"><table class="data mit-table"><thead><tr><th>Mitteilung</th><th>Sichtbar</th><th>Stand</th><th>Gelesen/bestätigt</th><th></th></tr></thead><tbody>${list.map((m) => row(m, today)).join('')}</tbody></table></div>`
  const open = items.filter((m) => messageState(m, today) === 'laeuft').reduce((n, m) => n + progress(m, doc().receipts).open.length, 0)
  const p = portalSettings()
  const banner = !portalOn()
    ? `<div class="banner warn-banner"><p><strong>Plan am Handy ist aus${p.key ? '' : ' bzw. nicht eingerichtet'}.</strong> Mitteilungen erreichen dann nur Personen mit Konto in der App (E-Mail im Stammblatt). Für alle anderen „Plan am Handy“ unter Mitarbeitende einrichten.</p></div>`
    : ''
  const err = S.error ? `<div class="banner warn-banner"><p>Rückmeldungen konnten nicht abgeholt werden: ${esc(S.error)}</p></div>` : ''
  return `<div class="section-head"><div><h2>Mitteilungen</h2><p>An Mitarbeitende, in ihrer Sprache, mit Lesebestätigung: am Handy über „Mein Plan“ (ohne Konto) oder in der App (mit Konto). Je Mitteilung siehst du, wer gelesen bzw. bestätigt hat, und kannst die übrigen erinnern; der Nachweis kommt als PDF.</p></div>
    <div class="actions">${ed ? `<button class="btn primary" data-action="mit-new">${ICON.plus} Neue Mitteilung</button>` : ''}${menu({
      label: 'Mehr',
      single: false,
      items: [ed && { label: 'Rückmeldungen jetzt abholen', icon: ICON.refresh, action: 'mit-sync', hint: S.at ? `zuletzt ${new Date(S.at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}` : 'Mein Plan und App' }, canEdit('planung') && { label: 'Plan am Handy einrichten', icon: ICON.gear, action: 'portal-open', hint: 'Links, Push, Webspace' }],
    })}</div></div>
    ${banner}${err}
    <div class="impact-stats"><div class="stat"><div class="label">laufend</div><div class="value">${items.filter((m) => messageState(m, today) === 'laeuft').length}</div></div><div class="stat ${open ? 'warn' : ''}"><div class="label">noch offen (Personen)</div><div class="value">${open}</div></div><div class="stat"><div class="label">Entwürfe</div><div class="value">${groups[1][1].length}</div></div></div>
    ${groups.map(([label, list]) => (list.length ? `<h3>${esc(label)}</h3>${table(list)}` : '')).join('')}
    ${!items.length ? `<p class="muted">Noch keine Mitteilungen.${ed ? ' Mit „Neue Mitteilung“ schreibst du die erste, z. B. zu einer neuen Betriebsanweisung.' : ''}</p>` : ''}
    ${old.length ? `<details class="mit-old"><summary>Beendet und zurückgezogen (${old.length})</summary>${table(old)}</details>` : ''}`
}

registerView({
  id: 'mitteilungen',
  order: 84,
  label: 'Mitteilungen',
  group: 'stamm',
  module: MODULE,
  icon: mitIcon,
  noWeek: true,
  text: 'An Mitarbeitende, mehrsprachig, mit Lesebestätigung',
  render: mitView,
})

// ---------------------------------------------------------------- Verfassen

function newDraft(m = null) {
  const today = todayISO()
  if (m) return { id: m.id, titel: m.titel, text: m.text, art: m.an?.art || 'alle', werte: [...(m.an?.werte || [])], wichtig: m.wichtig || 'normal', unterweisung: m.unterweisung || '', ab: m.ab, bis: m.bis, push: m.push !== false, inputs: Object.fromEntries(Object.entries(m.uebersetzt || {}).map(([id, u]) => [id, { titel: u.titel || '', text: u.text || '' }])), ki: {}, anhang: m.anhang || null, file: null, old: m }
  return { id: '', titel: '', text: '', art: 'alle', werte: [], wichtig: 'normal', unterweisung: '', ab: today, bis: addDays(today, 30), push: true, inputs: {}, ki: {}, anhang: null, file: null, old: null }
}

const draft = () => (app.ui.modal.draft ||= newDraft())

function readForm() {
  const d = draft()
  if (!document.getElementById('mit-titel')) return d
  d.titel = val('mit-titel')
  d.text = val('mit-text')
  d.art = val('mit-art') || d.art
  if (document.getElementById('mit-werte')) d.werte = checkedValues('mit-wert')
  d.wichtig = document.querySelector('input[name="mit-wichtig"]:checked')?.value || 'normal'
  d.unterweisung = d.wichtig === 'bestaetigen' ? val('mit-unterweisung') : ''
  d.ab = val('mit-ab')
  d.bis = val('mit-bis')
  d.push = checked('mit-push')
  for (const el of document.querySelectorAll('textarea[data-lang]')) d.inputs[el.dataset.lang] = { titel: val(`mit-ut-${el.dataset.lang}`), text: el.value }
  return d
}

const draftTarget = (d) => ({ art: d.art, werte: d.art === 'alle' ? [] : d.werte })
/** Mitteilung aus dem Entwurf (Übersetzungen nur für Sprachen mit Feld; andere bleiben, wie sie waren). */
function messageOf(d) {
  const base = { ...(d.old || {}), titel: d.titel.trim().slice(0, MIT_LIMITS.titel), text: d.text.trim().slice(0, MIT_LIMITS.text), an: draftTarget(d), wichtig: d.wichtig, unterweisung: d.wichtig === 'bestaetigen' ? d.unterweisung : '', ab: d.ab, bis: d.bis, push: d.push }
  const kiLangs = Object.keys(d.ki).filter((id) => d.inputs[id] && d.inputs[id].text.trim() === d.ki[id].text.trim() && d.inputs[id].titel.trim() === d.ki[id].titel.trim())
  const shown = Object.keys(d.inputs)
  const kept = Object.fromEntries(Object.entries(base.uebersetzt || {}).filter(([id]) => !shown.includes(id)))
  return { ...base, uebersetzt: { ...kept, ...updateMessageTranslations(base, d.inputs, { ki: kiLangs }) } }
}

function recipientPicker(d) {
  const box = (name, list) => `<div class="mit-picks" id="mit-werte" role="group" aria-label="${esc(name)}">${list.map(([v, l, extra]) => `<label class="check" data-name="${esc(String(l).toLowerCase())}"><input type="checkbox" name="mit-wert" value="${esc(v)}" data-change="mit-redraw" ${d.werte.includes(v) ? 'checked' : ''}><span>${esc(l)}${extra ? ` <small class="muted">${esc(extra)}</small>` : ''}</span></label>`).join('')}</div>`
  if (d.art === 'team') return box('Revier/Team', teamsOf(app.data.employees).map((t) => [t, t]))
  if (d.art === 'objekt')
    return `<input type="search" class="mit-filter" placeholder="Objekt suchen" aria-label="Objekt suchen" data-input="mit-filter">${box(
      'Objekte',
      [...app.data.objects].filter((o) => !o.inactive).sort((a, b) => a.name.localeCompare(b.name, 'de')).map((o) => [o.id, o.name, o.region || '']),
    )}<p class="note">Wer dort arbeitet: Stammkräfte der Leistungen${sees('planung') ? ' und wer in den ersten zwei Wochen ab „sichtbar ab“ eingeteilt ist' : ''}.</p>`
  if (d.art === 'personen')
    return `<input type="search" class="mit-filter" placeholder="Person suchen" aria-label="Person suchen" data-input="mit-filter">${box(
      'Personen',
      [...app.data.employees].filter((e) => !e.exitDate || e.exitDate >= todayISO()).sort((a, b) => a.name.localeCompare(b.name, 'de')).map((e) => [e.id, e.name, [e.team, langOf(e) !== 'de' ? langInfo(langOf(e)).own : ''].filter(Boolean).join(' · ')]),
    )}`
  return ''
}

/** Vorschau: wie viele Personen, welche Sprachen, welcher Zustellweg. */
function previewHtml(d) {
  const ids = recipientsOf(draftTarget(d), d.ab, d.bis)
  const langs = recipientLanguages(ids, app.data.employees)
  const del = deliverySummary(ids, app.data.employees, deliveryOpts())
  if (!ids.length) return '<p class="muted">Noch keine Empfänger.</p>'
  return `<p><strong>${plural(ids.length, 'Person', 'Personen')}</strong>${langs.length ? ` · Sprachen: ${esc(langs.map((l) => `${l.label} ${l.count}`).join(', '))}` : ' · alle Deutsch'}<br>
    <span class="muted">Zustellung: ${del.handy} über „Mein Plan“, ${del.app} in der App${del.keiner.length ? `, <strong>${del.keiner.length} ohne Zugang</strong> (${esc(del.keiner.slice(0, 5).map((id) => empById(id)?.name).join(', '))}${del.keiner.length > 5 ? ' …' : ''}): ausdrucken oder persönlich übergeben` : ''}</span></p>`
}

/** Übersetzungen je Sprache der Empfänger: Felder mit Stand, „Mit KI übersetzen“ nur mit eingerichteter KI. */
function translationsHtml(d) {
  const ids = recipientsOf(draftTarget(d), d.ab, d.bis)
  const langs = recipientLanguages(ids, app.data.employees)
  if (!langs.length) return '<p class="note">Alle Empfänger lesen Deutsch: keine Übersetzung nötig.</p>'
  const m = messageOf(d)
  const state = new Map(translationState(m, langs.map((l) => l.id)).map((s) => [s.id, s]))
  const pill = (id) => {
    const s = state.get(id)
    const inp = d.inputs[id]
    if (d.ki[id] && inp && inp.text.trim() === d.ki[id].text.trim()) return '<span class="pill info">Vorschlag der KI – bitte prüfen</span>'
    if (!inp?.text?.trim()) return '<span class="pill na">fehlt: Deutsch mit Hinweis</span>'
    return s?.stale ? '<span class="pill warning">veraltet</span>' : '<span class="pill ok">aktuell</span>'
  }
  return `<p class="mit-ki-line" hidden><button class="btn small" id="mit-ki" data-action="mit-ki">Mit KI übersetzen</button> <span class="muted">schickt nur Titel und Text an den KI-Dienst, in ${esc(langs.map((l) => l.label).join(', '))}; das Ergebnis ist ein Vorschlag zum Prüfen</span></p>
    <p class="note mit-ki-aus">Ohne eingerichteten KI-Assistenten bleibt die Mitteilung deutsch; am Handy steht dann „Diese Mitteilung gibt es nur auf Deutsch“. Eine Übersetzung von Hand geht trotzdem.</p>
    ${langs
      .map((l) => {
        const inp = d.inputs[l.id] || { titel: '', text: '' }
        return `<fieldset class="mit-lang"><legend>${esc(l.label)} (<span lang="${esc(l.html)}">${esc(l.own)}</span>) · ${plural(l.count, 'Person', 'Personen')} <span id="mit-st-${l.id}">${pill(l.id)}</span></legend>
          <label class="field wide"><span>Titel</span><input type="text" id="mit-ut-${l.id}" lang="${esc(l.html)}" maxlength="${MIT_LIMITS.titel}" value="${esc(inp.titel)}"></label>
          <label class="field wide"><span>Text</span><textarea id="mit-u-${l.id}" data-lang="${esc(l.id)}" lang="${esc(l.html)}" rows="4" maxlength="${MIT_LIMITS.text}">${esc(inp.text)}</textarea></label></fieldset>`
      })
      .join('')}`
}

function editModal() {
  const d = draft()
  const today = todayISO()
  const types = sees('unterweisungen') && canEdit('unterweisungen') ? trainingTypesForMessages(typesOf(app.data.unterweisungen)) : []
  const chip = d.file || d.anhang ? `<span class="tag">${esc((d.file || d.anhang).name)} · ${sizeText((d.file?.size ?? d.anhang?.groesse) || 0)}</span> <button class="btn small" data-action="mit-file-remove">Entfernen</button>` : '<span class="muted">PDF oder Bild (JPEG, PNG), höchstens 6 MB, z. B. eine Betriebsanweisung</span>'
  const warn = d.warnings?.length ? `<div class="banner warn-banner"><p><strong>Bitte prüfen:</strong></p><ul>${d.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul><p>Noch einmal „Veröffentlichen“, wenn es so passt.</p></div>` : ''
  return modalFrame({
    title: d.id ? 'Mitteilung bearbeiten' : 'Neue Mitteilung',
    subtitle: 'auf Deutsch; Übersetzungen weiter unten',
    wide: true,
    body: `${warn}<div class="form-grid">
        <label class="field wide"><span>Titel</span><input type="text" id="mit-titel" maxlength="${MIT_LIMITS.titel}" value="${esc(d.titel)}" placeholder="z. B. Neue Betriebsanweisung Sanitärreiniger"></label>
        <label class="field wide"><span>Text</span><textarea id="mit-text" rows="6" maxlength="${MIT_LIMITS.text}" placeholder="Was die Mitarbeitenden wissen oder tun sollen. Kurze Sätze helfen beim Übersetzen.">${esc(d.text)}</textarea></label>
        <div class="field wide"><span>Anhang</span><div class="ek-beleg-bar"><label class="btn">${ICON.upload} Datei wählen<input type="file" accept="application/pdf,image/jpeg,image/png" data-change="mit-file" hidden></label>${chip}</div></div>
      </div>
      <h3>Empfänger</h3>
      <div class="form-grid"><label class="field"><span>An</span><select id="mit-art" data-change="mit-art">${options(TARGETS, d.art)}</select></label></div>
      ${recipientPicker(d)}
      <div id="mit-preview" class="mit-preview">${previewHtml(d)}</div>
      <h3>Wichtigkeit und Zeitraum</h3>
      <div class="mit-radio" role="radiogroup" aria-label="Wichtigkeit">
        <label class="check"><input type="radio" name="mit-wichtig" value="normal" data-change="mit-art" ${d.wichtig !== 'bestaetigen' ? 'checked' : ''}><span><strong>Normal</strong>: die Person tippt „Gelesen“</span></label>
        <label class="check"><input type="radio" name="mit-wichtig" value="bestaetigen" data-change="mit-art" ${d.wichtig === 'bestaetigen' ? 'checked' : ''}><span><strong>Bestätigung nötig</strong>: die Person tippt „Verstanden“ (z. B. Betriebsanweisung, Sicherheit)</span></label>
      </div>
      ${d.wichtig === 'bestaetigen' && types.length ? `<div class="form-grid"><label class="field wide"><span>Als Unterweisungsnachweis zählen</span><select id="mit-unterweisung">${options(types.map((t) => [t.id, `${t.name}${t.law ? ` (${t.law})` : ''}`]), d.unterweisung, { empty: 'nein' })}</select></label></div>
        <p class="note">„Verstanden“ wird dann unter Unterweisungen &amp; Fristen eingetragen (Datum der Bestätigung, Vermerk „Lesebestätigung“). Geeignet für schriftliche Ergänzungen wie eine neue Betriebsanweisung; die mündliche Unterweisung mit Rückfragen ersetzt sie nicht immer (§ 14 ASchG: verständlich, in der Arbeitszeit).</p>` : ''}
      <div class="form-grid">
        <label class="field"><span>Sichtbar ab</span><input type="date" id="mit-ab" value="${esc(d.ab)}" min="${esc(d.old?.status === 'veroeffentlicht' ? '' : today)}" data-change="mit-redraw"></label>
        <label class="field"><span>Sichtbar bis</span><input type="date" id="mit-bis" value="${esc(d.bis)}" data-change="mit-redraw"></label>
      </div>
      <label class="check"><input type="checkbox" id="mit-push" ${d.push ? 'checked' : ''}><span>Push an Personen mit Push-Thema („Plan am Handy“, App ntfy): „Neue Mitteilung vom Büro“, ohne Inhalt</span></label>
      <h3>Übersetzungen</h3>
      <div id="mit-langs">${translationsHtml(d)}</div>
      <p class="note">Mitteilungen an Personen mit Konto liegen in SharePoint (mitteilungen/konten/), dort für alle Konten lesbar: nichts Vertrauliches an Einzelne schreiben.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn" data-action="mit-save">Als Entwurf speichern</button><button class="btn primary" data-action="mit-publish">${ICON.send} Veröffentlichen</button></div>`,
  })
}
registerModal('mit-edit', editModal, { module: MODULE })

// „Mit KI übersetzen“ nur, wenn der KI-Assistent eingerichtet ist (ki.php meldet „aktiv“); einmal je Sitzung gefragt
const kiCheck = { ok: null, at: 0 }
function showKi(root) {
  const line = root.querySelector('.mit-ki-line')
  if (!line || app.config?.assistant === false) return
  const show = () => {
    if (!kiCheck.ok) return
    line.removeAttribute('hidden')
    root.querySelector('.mit-ki-aus')?.setAttribute('hidden', '')
  }
  if (kiCheck.ok !== null || Date.now() - kiCheck.at < 300e3) return show()
  kiCheck.at = Date.now()
  import('../../ai/translate.js')
    .then((m) => m.kiReady())
    .then((ok) => {
      kiCheck.ok = ok || null
      if (ok && document.body.contains(line)) show()
    })
}
onModalRender(($modal) => showKi($modal))

/** Vorschau und Übersetzungsfelder neu (ohne den ganzen Dialog: Auswahl und Bildlauf bleiben). d: schon gelesener Entwurf. */
function refreshParts(d = readForm()) {
  const prev = document.getElementById('mit-preview')
  if (prev) prev.innerHTML = previewHtml(d)
  const langs = document.getElementById('mit-langs')
  if (langs) {
    langs.innerHTML = translationsHtml(d)
    showKi(langs)
  }
}

/** Speichern (Entwurf oder veröffentlichen). Liefert die Mitteilung oder null (mit Meldung). */
async function saveDraft(publish) {
  const d = readForm()
  const today = todayISO()
  const m = messageOf(d)
  m.id = d.id || uid('mit').toLowerCase()
  const recipients = recipientsOf(m.an, m.ab, m.bis)
  if (publish) {
    const { errors, warnings } = validateMessage(m, { today, recipients, employees: app.data.employees, delivery: deliveryOpts() })
    if (errors.length) {
      d.warnings = null
      toast(errors[0])
      return null
    }
    const key = JSON.stringify([warnings, m.titel, m.text, recipients.length])
    if (warnings.length && d.confirmed !== key) {
      d.warnings = warnings
      d.confirmed = key
      renderModal()
      document.querySelector('#modal-root .modal-body')?.scrollTo?.(0, 0)
      return null
    }
  } else if (!m.titel.trim() && !m.text.trim()) {
    toast('Bitte zumindest einen Titel oder Text eingeben.')
    return null
  }
  if (d.file) {
    try {
      m.anhang = await storeAttachment(m.id, d.file)
    } catch (err) {
      toast(`Anhang nicht gespeichert: ${err.message}`)
      return null
    }
  } else m.anhang = d.anhang || null
  const at = nowIso()
  m.status = publish ? 'veroeffentlicht' : m.status === 'veroeffentlicht' ? 'veroeffentlicht' : 'entwurf'
  m.erstellt ||= { at, by: by() }
  if (d.old) m.geaendert = { at, by: by() }
  m.erinnert ||= {}
  if (publish) {
    m.empfaenger = recipients
    m.veroeffentlicht = { at, by: by() }
  } else m.empfaenger ||= []
  const list = doc().items
  const i = list.findIndex((x) => x.id === m.id)
  if (i >= 0) list.splice(i, 1, m)
  else list.push(m)
  persist()
  return m
}

// ---------------------------------------------------------------- Mitteilung ansehen

function detailModal(c, { id }) {
  const m = doc().items.find((x) => x.id === id)
  if (!m) return null
  const today = todayISO()
  const st = messageState(m, today)
  const ed = editable()
  const p = progress(m, doc().receipts)
  const live = st === 'laeuft' || st === 'geplant'
  const onlyOpen = app.ui.mitOnlyOpen
  const rows = p.rows
    .map((r) => ({ ...r, emp: empById(r.empId) }))
    .filter((r) => !onlyOpen || !r.done)
    .sort((a, b) => Number(a.done) - Number(b.done) || String(a.emp?.name || '').localeCompare(String(b.emp?.name || ''), 'de'))
    .map((r) => {
      const stateText = r.state === 'bestaetigt' ? `verstanden ${when(r.bestaetigt)}` : r.state === 'gelesen' ? `gelesen ${when(r.gelesen)}` : 'offen'
      const cls = r.done ? 'ok' : r.state === 'gelesen' ? 'warning' : 'na'
      return `<tr><td>${esc(r.emp?.name || '(nicht mehr in den Stammdaten)')}</td><td>${esc(langInfo(langOf(r.emp)).label)}</td><td>${esc(r.weg ? (r.weg === 'app' ? 'App' : 'Mein Plan') : r.emp ? wegText(r.emp) : '')}</td><td><span class="pill ${cls}">${esc(stateText)}</span></td><td>${r.erinnert ? esc(when(r.erinnert)) : ''}</td></tr>`
    })
    .join('')
  const langs = Object.entries(m.uebersetzt || {}).filter(([, u]) => String(u?.text || '').trim())
  const tState = new Map(translationState(m, langs.map(([lid]) => lid)).map((s) => [s.id, s]))
  const type = m.unterweisung ? typesOf(app.data.unterweisungen).find((t) => t.id === m.unterweisung) : null
  const confirmWithdraw = app.ui.confirm === `mit-withdraw:${m.id}`
  const confirmDelete = app.ui.confirm === `mit-delete:${m.id}`
  return modalFrame({
    title: m.titel || '(ohne Titel)',
    subtitle: `<span class="pill ${STATE_CLS[st]}">${esc(STATE_TEXT[st])}</span> ${esc(short(m.ab))} – ${esc(short(m.bis))}${m.wichtig === 'bestaetigen' ? ' · Bestätigung nötig' : ''}`,
    wide: true,
    body: `<div class="mit-detail-text">${esc(m.text).replace(/\n/g, '<br>')}</div>
      <p class="muted">${esc(targetText(m.an))}${m.veroeffentlicht ? ` · veröffentlicht ${esc(when(m.veroeffentlicht.at))} von ${esc(m.veroeffentlicht.by)}` : ''}</p>
      <p>${langs.length ? `Übersetzt: ${langs.map(([lid, u]) => `<span class="tag" lang="${esc(langInfo(lid).html)}">${esc(langInfo(lid).own)}${u.ki ? ' · KI' : ''}${tState.get(lid)?.stale ? ' · veraltet' : ''}</span>`).join(' ')}` : '<span class="muted">nur Deutsch</span>'}
        ${m.anhang ? ` <button class="btn small" data-action="mit-file-open" data-id="${esc(m.id)}">${ICON.download} ${esc(m.anhang.name)}</button>` : ''}
        ${type ? ` <span class="tag">zählt als ${esc(type.name)}</span>` : ''}</p>
      ${
        st === 'entwurf'
          ? '<p class="note">Entwurf: noch nicht veröffentlicht, niemand sieht ihn.</p>'
          : `<div class="impact-stats"><div class="stat"><div class="label">${m.wichtig === 'bestaetigen' ? 'verstanden' : 'gelesen'}</div><div class="value">${p.done} von ${p.total}</div></div>${m.wichtig === 'bestaetigen' ? `<div class="stat"><div class="label">gelesen, nicht bestätigt</div><div class="value">${p.gelesen - p.bestaetigt}</div></div>` : ''}<div class="stat ${p.open.length ? 'warn' : ''}"><div class="label">offen</div><div class="value">${p.open.length}</div></div></div>
        <label class="check"><input type="checkbox" data-change="mit-only-open" ${onlyOpen ? 'checked' : ''}><span>nur offene</span></label>
        <div class="table-wrap"><table class="data mit-people"><thead><tr><th>Name</th><th>Sprache</th><th>Weg</th><th>Stand</th><th>Erinnert</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">Alle erledigt.</td></tr>'}</tbody></table></div>
        ${ed && live ? `<div class="form-grid"><label class="field"><span>Sichtbar bis</span><input type="date" id="mit-bis-neu" value="${esc(m.bis)}" min="${esc(today)}"></label><div class="field"><span>&nbsp;</span><button class="btn small" data-action="mit-bis" data-id="${esc(m.id)}">Ändern</button></div></div>` : ''}`
      }
      ${S.error ? `<p class="banner warn-banner">Abholen: ${esc(S.error)}</p>` : ''}`,
    foot: `<div class="actions">${ed && st === 'entwurf' ? `<button class="btn ${confirmDelete ? 'danger' : ''}" data-action="mit-delete" data-id="${esc(m.id)}">${confirmDelete ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}${ed && live ? `<button class="btn ${confirmWithdraw ? 'danger' : ''}" data-action="mit-withdraw" data-id="${esc(m.id)}" title="Am Handy und in der App nicht mehr sichtbar; der Nachweis bleibt">${confirmWithdraw ? 'Wirklich zurückziehen?' : 'Zurückziehen'}</button>` : ''}</div>
      <div class="actions">${st !== 'entwurf' ? `<button class="btn" data-action="mit-pdf" data-id="${esc(m.id)}">${ICON.download} Nachweis (PDF)</button>` : ''}${ed && st === 'entwurf' ? `<button class="btn primary" data-action="mit-edit-open" data-id="${esc(m.id)}">Bearbeiten</button>` : ''}${ed && st === 'laeuft' && p.open.length ? `<button class="btn primary" data-action="mit-remind" data-id="${esc(m.id)}" title="Bei den offenen Personen wieder oben und hervorgehoben; mit Push eine Nachricht">${ICON.bell} Erinnern (${p.open.length})</button>` : ''}</div>`,
  })
}
registerModal('mit-detail', detailModal, { module: MODULE })

// ---------------------------------------------------------------- Aktionen

/** Verteilen und das Ergebnis als Satz; scheitert der Webspace, holt das nächste Abholen es nach. */
async function publishNow() {
  try {
    return distributeNote(await distribute())
  } catch (err) {
    S.webDay = ''
    return ` Noch nicht übertragen: ${err.message}. Wird beim nächsten Abholen nachgeholt.`
  }
}

// Ansehen (auch ohne Schreibrecht): Mitteilung öffnen, nur offene, Anhang, Nachweis
registerActions({
  'mit-open': (el) => openModal({ type: 'mit-detail', id: el.dataset.id }),
  'mit-only-open': (el) => {
    app.ui.mitOnlyOpen = el.checked
    renderModal()
  },
  'mit-file-open': async (el) => {
    const m = doc().items.find((x) => x.id === el.dataset.id)
    const blob = await attachmentBlob(m)
    if (!blob) return toast(app.store?.kind === 'sharepoint' ? 'Anhang nicht gefunden.' : 'Im Browser-Modus ist der Anhang nur in dem Fenster da, in dem er gewählt wurde.')
    window.open(URL.createObjectURL(blob), '_blank', 'noopener')
  },
  'mit-pdf': async (el) => {
    const m = doc().items.find((x) => x.id === el.dataset.id)
    if (!m) return
    await syncMessages({ force: true })
    const type = m.unterweisung ? typesOf(app.data.unterweisungen).find((t) => t.id === m.unterweisung) : null
    const pdf = messageProofDocument({ m, receipts: doc().receipts, employees: app.data.employees, target: targetText(m.an), trainingType: type, brand: app.config.brand, logo: await loadLogo() })
    download(messageProofName(m), await pdfBlob(pdf))
  },
})

registerActions(
  {
    'mit-new': () => openModal({ type: 'mit-edit', draft: newDraft() }),
    'mit-edit-open': (el) => {
      const m = doc().items.find((x) => x.id === el.dataset.id)
      if (m) openModal({ type: 'mit-edit', draft: newDraft(m) })
    },
    'mit-art': () => {
      const d = readForm()
      if (!['team', 'objekt', 'personen'].includes(d.art)) d.werte = []
      if (d.art === 'objekt' && sees('planung') && app.service?.ensureWeeks) ensureRange(d.ab || todayISO(), addDays(d.ab || todayISO(), 13)).then(() => refreshParts(), () => {})
      d.warnings = null
      renderModal()
    },
    'mit-redraw': () => refreshParts(),
    'mit-filter': (el) => {
      const q = el.value.trim().toLowerCase()
      for (const label of document.querySelectorAll('#mit-werte label')) label.hidden = !!q && !label.dataset.name.includes(q)
    },
    'mit-file': async (el) => {
      const file = el.files?.[0]
      el.value = ''
      if (!file) return
      if (!/^image\//.test(file.type) && file.type !== 'application/pdf') return toast('Nur PDF oder Bild (JPEG, PNG).')
      const f = await shrink(file)
      if (!MIT_TYPES[f.type]) return toast('Nur PDF oder Bild (JPEG, PNG).')
      if (f.size > MIT_LIMITS.anhang) return toast(`${file.name}: zu groß (höchstens 6 MB).`)
      const d = readForm()
      d.file = f
      d.anhang = null
      renderModal()
    },
    'mit-file-remove': () => {
      const d = readForm()
      d.file = null
      d.anhang = null
      renderModal()
    },
    'mit-ki': async (el) => {
      const d = readForm()
      if (!d.titel.trim() || !d.text.trim()) return toast('Bitte zuerst Titel und Text auf Deutsch eingeben.')
      const langs = recipientLanguages(recipientsOf(draftTarget(d), d.ab, d.bis), app.data.employees).map((l) => l.id)
      if (!langs.length) return toast('Alle Empfänger lesen Deutsch: keine Übersetzung nötig.')
      el.disabled = true
      el.textContent = 'Wird übersetzt …'
      try {
        const { translateMessage } = await import('../../ai/translate.js')
        const texts = await translateMessage({ titel: d.titel, text: d.text }, langs)
        if (!Object.keys(texts).length) return toast('Die KI hat keine Übersetzung geliefert. Bitte von Hand übersetzen.')
        // was inzwischen getippt wurde, zuerst übernehmen; dann die Vorschläge in die Felder
        readForm()
        for (const [lid, t] of Object.entries(texts)) {
          d.inputs[lid] = { ...t }
          d.ki[lid] = { ...t }
        }
        refreshParts(d)
        toast(`Übersetzt: ${Object.keys(texts).map((lid) => langInfo(lid).label).join(', ')}. Bitte prüfen; gespeichert wird mit „Als Entwurf speichern“ oder „Veröffentlichen“.`)
      } catch (err) {
        toast(`Übersetzen nicht möglich: ${err.message}`)
      } finally {
        if (document.body.contains(el)) {
          el.disabled = false
          el.textContent = 'Mit KI übersetzen'
        }
      }
    },
    'mit-save': async () => {
      const m = await saveDraft(false)
      if (!m) return
      closeModal()
      renderNow()
      const note = m.status === 'veroeffentlicht' ? await publishNow() : ''
      toast(`${m.status === 'veroeffentlicht' ? 'Gespeichert.' : 'Als Entwurf gespeichert: noch nicht sichtbar.'}${note}`)
    },
    'mit-publish': async (el) => {
      el.disabled = true
      try {
        const m = await saveDraft(true)
        if (!m) return
        const del = deliverySummary(m.empfaenger, app.data.employees, deliveryOpts())
        openModal({ type: 'mit-detail', id: m.id })
        renderNow()
        const note = await publishNow()
        toast(`Veröffentlicht an ${plural(m.empfaenger.length, 'Person', 'Personen')} (${del.handy} über Mein Plan, ${del.app} in der App${del.keiner.length ? `, ${del.keiner.length} ohne Zugang` : ''}).${note}`)
        renderModal()
      } finally {
        if (document.body.contains(el)) el.disabled = false
      }
    },
    'mit-remind': async (el) => {
      const m = doc().items.find((x) => x.id === el.dataset.id)
      if (!m) return
      await syncMessages({ force: true })
      const r = remind(m, doc().receipts, { at: nowIso() })
      if (!r.n) return toast('Alle haben schon gelesen bzw. bestätigt.')
      m.erinnert = r.erinnert
      persist()
      renderModal()
      const note = await publishNow()
      toast(`Erinnert: ${plural(r.n, 'Person', 'Personen')} – die Mitteilung steht bei ihnen wieder oben und hervorgehoben.${note}`)
    },
    'mit-withdraw': async (el) => {
      const m = doc().items.find((x) => x.id === el.dataset.id)
      if (!m || !confirmStep(`mit-withdraw:${m.id}`, renderModal)) return
      await syncMessages({ force: true })
      m.status = 'zurueckgezogen'
      m.zurueckgezogen = { at: nowIso(), by: by() }
      persist()
      renderModal()
      renderNow()
      toast(`Zurückgezogen: am Handy und in der App nicht mehr sichtbar; der Nachweis bleibt.${await publishNow()}`)
    },
    'mit-delete': (el) => {
      const d = doc()
      const m = d.items.find((x) => x.id === el.dataset.id)
      if (!m || m.status !== 'entwurf' || !confirmStep(`mit-delete:${m.id}`, renderModal)) return
      d.items = d.items.filter((x) => x.id !== m.id)
      if (m.anhang?.pfad && app.store?.remove) app.store.remove(m.anhang.pfad).catch(() => {})
      LOCAL.delete(m.id)
      persist()
      closeModal()
      renderNow()
      toast('Entwurf gelöscht.')
    },
    'mit-bis': async (el) => {
      const m = doc().items.find((x) => x.id === el.dataset.id)
      const bis = val('mit-bis-neu')
      if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(bis) || bis < m.ab || bis < todayISO()) return toast('Bitte ein Datum ab heute und nach „sichtbar ab“ wählen.')
      if (bis > addDays(m.ab, MIT_LIMITS.tage)) return toast(`Höchstens ${MIT_LIMITS.tage} Tage sichtbar.`)
      m.bis = bis
      m.geaendert = { at: nowIso(), by: by() }
      persist()
      renderModal()
      toast(`Sichtbar bis ${short(bis)}.${await publishNow()}`)
    },
    'mit-sync': async () => {
      const r = await syncMessages({ force: true })
      if (S.error) return toast(`Abholen nicht möglich: ${S.error}`)
      toast(r?.changed ? `${plural(r.changed, 'neue Rückmeldung', 'neue Rückmeldungen')} übernommen${r.trained ? `, ${plural(r.trained, 'Unterweisungsnachweis', 'Unterweisungsnachweise')} eingetragen` : ''}.` : 'Keine neuen Rückmeldungen.')
      renderNow()
    },
  },
  { edit: MODULE },
)

// Abholen im Hintergrund, sobald das Modul geladen ist (nur wer Mitteilungen bearbeitet)
if (typeof window !== 'undefined' && typeof setTimeout === 'function')
  setTimeout(() => {
    if (app.data && canEdit(MODULE)) {
      startPolling()
      syncMessages()
    }
  }, 4000)
