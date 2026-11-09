// Leistungs-Checkliste am Handy in der App (Kürzel „ck-“, Rechenkern core/checkliste.js und core/checkliste-buero.js):
//  - Abruf vom Webspace mit den Stempelungen (gleicher Zeitpunkt, Knopf „Jetzt abrufen“ der Zeiterfassung; checkHooks in
//    ui/timeclock.js), je Woche gespeichert (Feld checks); Fotos nach SharePoint (plaene/checklisten/<Jahr>/), danach am
//    Webspace gelöscht. Ohne SharePoint bleiben sie am Webspace (62 Tage) und kommen von dort.
//  - Stand im Einsatz-Dialog je Person (erledigt, nicht möglich mit Grund, Foto ansehen).
//  - „Zu erledigen“: „nicht möglich“ gemeldet (bis „Gesehen“), Checkliste nach Ende nicht fertig (nur bei Personen, die
//    die Checkliste schon benutzen, bis zum Ende der Frist am Handy).
//  - Punkte im Dialog „Leistung bearbeiten“ (views/sites.js): Text, Foto nötig, wann (immer, 1× pro Woche, nur an
//    bestimmten Tagen), Vorlagen (core/checkliste-vorlagen.js), Übersetzungen wie bei den Objektanweisungen,
//    „Mit KI übersetzen“ (Vorschlag in den Feldern, gespeichert erst mit der Leistung).
// Später geladen (views/lazy.js, Paket des Büros). Rechte: Abruf und „Gesehen“ wie die Zeiterfassung (Einsatzplanung
// bearbeiten), Punkte wie die Leistung (Stammdaten).

import { itemsFor } from '../../core/checkliste.js'
import { checkKey, checkPhotoPath, checkTodos, cleanItems, mergeChecks, notPossibleSig, pendingFromServer, summaryOf, whenOf } from '../../core/checkliste-buero.js'
import { CHECKLIST_TEMPLATES, fromTemplate } from '../../core/checkliste-vorlagen.js'
import { addDays, formatDate, todayISO, WEEKDAY_SHORT } from '../../core/dates.js'
import { FOREIGN_LANGUAGES, translationRows, updateTranslations } from '../../core/sprachen.js'
import { hashIndex } from '../../core/staffplan.js'
import { absMinutes } from '../../core/timeclock.js'
import { app, canEdit, empName, ensureRange, persist, registerActions, renderModal, renderNow, toast } from '../context.js'
import { kixBox, kixButton, kixConsent, kixFailed, kixSet } from '../kix.js'
import { invalidateTodo, refreshBell, registerTodo } from '../modals/todo.js'
import { esc, ICON, options, uid } from '../shared.js'
import { call, portalSettings } from '../staffplan.js'
import { checkHooks, startPolling } from '../timeclock.js'

const checksOf = () => (app.data.checks ||= {})
const nowMinutes = () => absMinutes(new Date().toISOString())
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }) : '')
const portalOn = () => {
  const p = portalSettings()
  return !!(p.enabled && p.key)
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// ---------------------------------------------------------------- Abruf vom Webspace

const sync = { at: 0, running: false, since: 0, error: '', pending: [] }

/**
 * Neue und geänderte Checklisten holen und je Woche speichern, Fotos nach SharePoint. Höchstens alle 2 Minuten, nach dem
 * ersten Abruf nur Geändertes; force: sofort, die letzten 14 Tage. Liefert die Zahl der übernommenen Stände.
 */
export async function syncChecks({ force = false } = {}) {
  const p = portalSettings()
  if (!p.enabled || !p.key || !canEdit('planung') || app.readOnly || !checkHooks.used()) return 0
  if (!force && (sync.running || Date.now() - sync.at < 120e3)) return 0
  while (sync.running) await new Promise((r) => setTimeout(r, 100))
  sync.running = true
  sync.at = Date.now()
  let n = 0
  try {
    const since = !force && sync.since ? sync.since : Math.floor(Date.now() / 1000) - 14 * 86400
    const [json, index] = await Promise.all([call(`checklisten&seit=${since}`), hashIndex(p)])
    const dates = (json.checklisten || []).map((r) => r.datum).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort()
    // nur geladene Wochen werden gespeichert
    if (dates.length) await ensureRange(dates[0], dates.at(-1))
    n = mergeChecks(checksOf(), json.checklisten, index)
    const sig = () => sync.pending.map((x) => `${x.instKey}|${x.empId}`).join()
    const before = sig()
    sync.pending = pendingFromServer(json.offen, index)
    if (!n && before !== sig()) {
      invalidateTodo()
      refreshBell()
    }
    sync.since = Math.max(since, Number(json.jetzt || 0) - 300)
    sync.error = ''
    if (n) {
      persist()
      invalidateTodo()
      refreshBell()
      if (app.ui.modal?.type === 'shift' || app.ui.modal?.type === 'todo') renderModal()
      else if (['zeiten', 'nachweis'].includes(app.ui.view)) renderNow()
    }
    await storePhotos(p.key)
  } catch (err) {
    sync.error = err.message || String(err)
  }
  sync.running = false
  return n
}

/** Foto vom Webspace (solange es dort liegt). */
async function webPhoto(datei) {
  const res = await fetch(`mein-plan.php?aktion=checkliste-foto&datei=${encodeURIComponent(datei)}`, { headers: { 'X-Schluessel': portalSettings().key }, cache: 'no-store' })
  if (!res.ok || !/^image\//.test(res.headers.get('content-type') || '')) throw new Error(`Foto ${datei}: Antwort ${res.status}`)
  return res.blob()
}

/**
 * Fotos der letzten 60 Tage nach SharePoint (Verweis am Punkt), dann am Webspace löschen lassen (wie die Fotos des
 * Winterdienst-Protokolls). Scheitert etwas, folgt der nächste Versuch beim nächsten Abruf.
 */
async function storePhotos(key) {
  if (app.store?.kind !== 'sharepoint' || !key) return
  const since = addDays(todayISO(), -60)
  let added = 0
  for (const c of Object.values(checksOf())) {
    if (c.date < since) continue
    for (const it of c.items || []) {
      const f = it.photo
      if (!f || f.pfad || f.webspaceGeloescht) continue
      try {
        const path = checkPhotoPath(c, f.datei)
        const up = await app.store.upload(path, await webPhoto(f.datei), 'image/jpeg')
        Object.assign(f, { pfad: path, url: up?.webUrl || '' })
        added++
      } catch {
        /* nächster Versuch beim nächsten Abruf */
      }
    }
  }
  if (added) persist()
  const uploaded = Object.values(checksOf()).flatMap((c) => (c.items || []).map((it) => it.photo).filter((f) => f?.pfad && !f.webspaceGeloescht))
  if (!uploaded.length) return
  try {
    await app.service.flush()
    await call('checkliste-fotos-uebernommen', { dateien: uploaded.map((f) => f.datei) })
    for (const f of uploaded) f.webspaceGeloescht = true
    persist()
  } catch {
    /* nächster Versuch beim nächsten Abruf */
  }
}

/** Foto als Blob: aus SharePoint, sonst vom Webspace. */
async function photoBlob(f) {
  if (f.pfad && app.store?.kind === 'sharepoint' && app.store.readBlob) {
    try {
      return await app.store.readBlob(f.pfad)
    } catch {
      /* sonst vom Webspace */
    }
  }
  if (!f.webspaceGeloescht && portalSettings().key) return webPhoto(f.datei)
  throw new Error('Foto nicht erreichbar')
}

// ---------------------------------------------------------------- Einsatz-Dialog

const MARK = { ok: ['✓', 'erledigt'], nicht: ['✗', 'nicht möglich'], '': ['○', 'offen'] }

/** Stand der Checkliste im Einsatz-Dialog: je Person erledigt / nicht möglich (Grund) / offen, Foto ansehen. */
function block(inst, c) {
  if (inst.status === 'cancelled') return ''
  const task = app.data.tasks.find((t) => t.id === inst.taskId)
  const planned = itemsFor(task, inst, c.instances)
  const records = Object.values(checksOf()).filter((x) => x.instKey === inst.key)
  if (!planned.length && !records.length) return ''
  const people = [...new Set([...c.state.assigned(inst.key).map((a) => a.employeeId), ...records.map((r) => r.empId).filter(Boolean)])]
  const over = inst.end <= nowMinutes()
  // „nicht ausgefüllt“ nur bei Personen, die die Checkliste schon benutzen (sonst hatten sie sie vielleicht nie am Handy)
  const users = new Set(Object.values(checksOf()).map((x) => x.empId))
  const shown = app.ui.modal?.ckPhoto
  const rows = people
    .map((empId) => {
      const r = records.find((x) => x.empId === empId)
      if (!r) return over && planned.length && users.has(empId) ? `<li><strong>${esc(empName(empId))}</strong>: <span class="pill na">nicht ausgefüllt</span></li>` : ''
      const s = summaryOf(r)
      const items = r.items
        .map((it) => {
          const [mark, label] = MARK[it.status] || MARK['']
          const open = shown?.key === checkKey(r) && shown.item === it.id
          return `<li class="ck-${it.status || 'offen'}"><span class="ck-mark" title="${label}">${mark}</span>${esc(it.text)}${it.status === 'nicht' ? ` <span class="muted">(nicht möglich: ${esc(it.reason)})</span>` : ''}${it.photo ? ` <button class="link-btn" data-action="ck-foto" data-key="${esc(checkKey(r))}" data-item="${esc(it.id)}">${ICON.camera} ${open ? 'Foto schließen' : 'Foto'}</button>` : it.photoRequired && it.status === 'ok' ? ' <span class="muted">(Foto fehlt)</span>' : ''}${open && shown.url ? `<img class="ck-bild" src="${esc(shown.url)}" alt="Foto: ${esc(it.text)}">` : ''}</li>`
        })
        .join('')
      return `<li><strong>${esc(r.empId ? empName(r.empId) : r.name)}</strong>: <span class="pill ${s.finished ? 'ok' : 'info'}">${s.finished ? `fertig ${esc(time(r.finished))}` : `${s.done} von ${s.total} erledigt`}</span>${s.notPossible ? ` <span class="pill warning">${s.notPossible} nicht möglich</span>` : ''}<ul class="ck-items">${items}</ul></li>`
    })
    .join('')
  const plan = !records.length ? `<p class="note">${plural(planned.length, 'Punkt', 'Punkte')} am Handy: ${planned.map((x) => esc(x.text)).join(' · ')}</p>` : ''
  return `<section class="ck-block"><h3>Checkliste</h3>${plan}${rows ? `<ul class="ck-people">${rows}</ul>` : ''}</section>`
}

checkHooks.sync = syncChecks
checkHooks.block = block

// ---------------------------------------------------------------- Zu erledigen

registerTodo({
  id: 'checkliste',
  module: 'planung',
  title: 'Checkliste am Handy',
  compute: (today) => {
    if (!portalOn() || !checkHooks.used()) return []
    startPolling()
    syncChecks()
    return checkTodos({ checks: checksOf(), pending: sync.pending, since: addDays(today, -14) })
  },
  render: (items) =>
    items
      .map((x) => {
        const c = x.check
        if (x.kind === 'nicht') {
          return `<div class="todo-item"><span class="flag warning">✗</span><div class="todo-text"><strong>${esc(c.empId ? empName(c.empId) : c.name)}</strong>: nicht möglich bei ${esc(c.objectName)}${c.label ? ` (${esc(c.label)})` : ''}<br><span class="muted">${esc(formatDate(c.date))} · ${x.items.map((it) => `${esc(it.text)}: ${esc(it.reason)}`).join(' · ')}</span></div><div class="todo-acts"><button class="btn small primary" data-action="ck-seen" data-key="${esc(x.key)}" title="Das Büro kümmert sich darum (z. B. Kunde informiert)">Gesehen</button><button class="btn small" data-action="open-shift" data-key="${esc(c.instKey)}">Einsatz öffnen</button></div></div>`
        }
        const s = c ? summaryOf(c) : null
        return `<div class="todo-item"><span class="flag info">?</span><div class="todo-text"><strong>${esc(empName(x.empId))}</strong>: Checkliste nicht fertig<br><span class="muted">${esc(formatDate(x.date))} ${esc(x.time)} ${esc(x.objectName)}${s ? ` · ${s.done} von ${s.total} erledigt` : ' · nicht ausgefüllt'} · am Handy bis 24 Stunden nach Ende änderbar</span></div><button class="btn small primary" data-action="open-shift" data-key="${esc(x.instKey)}">Einsatz öffnen</button></div>`
      })
      .join(''),
})

registerActions(
  {
    'ck-seen': (el) => {
      const c = checksOf()[el.dataset.key]
      if (!c) return
      c.seen = { sig: notPossibleSig(c), at: new Date().toISOString(), by: app.user?.name || '' }
      persist()
      invalidateTodo()
      refreshBell()
      if (app.ui.modal?.type === 'todo') renderModal()
      toast('Als gesehen vermerkt.')
    },
  },
  { edit: 'planung' },
)

registerActions({
  'ck-foto': async (el) => {
    const m = app.ui.modal
    if (!m) return
    const { key, item } = el.dataset
    if (m.ckPhoto?.key === key && m.ckPhoto.item === item) {
      URL.revokeObjectURL(m.ckPhoto.url)
      m.ckPhoto = null
      return renderModal()
    }
    const f = checksOf()[key]?.items?.find((x) => x.id === item)?.photo
    if (!f) return
    try {
      const url = URL.createObjectURL(await photoBlob(f))
      if (m.ckPhoto?.url) URL.revokeObjectURL(m.ckPhoto.url)
      m.ckPhoto = { key, item, url }
      if (app.ui.modal === m) renderModal()
    } catch (err) {
      toast(`Foto nicht verfügbar: ${err.message}`)
    }
  },
})

// ---------------------------------------------------------------- Punkte im Dialog „Leistung bearbeiten“

const WHEN = [
  ['immer', 'bei jedem Einsatz'],
  ['woche', '1× pro Woche'],
  ['tage', 'nur an …'],
]

/** Übersetzungen eines Punkts wie bei den Objektanweisungen (core/sprachen.js). */
const asObject = (x) => ({ instructions: x.text, instructionsI18n: x.i18n })

function rowHtml(x) {
  const id = esc(x.id)
  const when = whenOf(x)
  const rows = translationRows(asObject(x), x.text)
  const fresh = rows.filter((r) => r.text && !r.stale).length
  const stale = rows.filter((r) => r.stale).length
  return `<div class="ck-row" data-id="${id}" data-i18n="${esc(JSON.stringify(x.i18n || {}))}">
    <input type="text" class="ck-text" id="ck-text-${id}" value="${esc(x.text)}" maxlength="160" placeholder="z. B. Böden feucht wischen" aria-label="Punkt der Checkliste">
    <label class="check"><input type="checkbox" id="ck-photo-${id}" ${x.photo ? 'checked' : ''}><span>Foto nötig</span></label>
    <select id="ck-when-${id}" data-change="ck-when" data-id="${id}" aria-label="Wann">${options(WHEN, when)}</select>
    <span class="ck-days" id="ck-days-${id}" ${when === 'tage' ? '' : 'hidden'}>${WEEKDAY_SHORT.map((d, i) => `<label class="check"><input type="checkbox" name="ck-day-${id}" value="${i + 1}" ${x.days?.includes(i + 1) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</span>
    <button class="btn small danger" data-action="ck-del" data-id="${id}" aria-label="Punkt entfernen">Entfernen</button>
    <details class="spr-box"${stale ? ' open' : ''}><summary>Übersetzungen <span class="muted">(${fresh} von ${rows.length} aktuell${stale ? `, ${stale} veraltet` : ''})</span></summary>
      <div class="form-grid">${rows.map((r) => `<label class="field"><span>${esc(r.label)}${r.stale ? ' <span class="pill warning">veraltet</span>' : ''}</span><input type="text" id="ck-tr-${id}-${r.id}" lang="${esc(r.html)}" value="${esc(r.text)}" maxlength="160"></label>`).join('')}</div>
    </details>
  </div>`
}

/** Abschnitt „Checkliste am Handy“ im Dialog der Leistung. */
export function checklistSection(task) {
  const items = task.checklist || []
  return `<section class="ck-edit"><h3>Checkliste am Handy</h3>
    <p class="note">Die Reinigungskraft sieht die Punkte beim Einsatz im „Plan am Handy“ und hakt sie ab: erledigt, mit Foto (wo nötig, ohne Personen) oder „nicht möglich“ mit Grund. Der Stand steht im Einsatz und auf Wunsch im Leistungsnachweis. Höchstens 30 Punkte.</p>
    <div id="ck-rows">${items.map(rowHtml).join('')}</div>
    <div class="ck-tools"><button class="btn small" data-action="ck-add">${ICON.plus} Punkt</button>
      <select id="ck-tpl" aria-label="Vorlage">${options(CHECKLIST_TEMPLATES.map((t) => [t.id, `Vorlage ${t.label} (${t.items.length} Punkte)`]), '')}</select><button class="btn small" data-action="ck-tpl">Vorlage übernehmen</button>
      ${kixButton(`<button class="btn small" data-action="ck-ki">Mit KI übersetzen</button>`)}</div>
    ${kixBox('ck')}
    <p class="note">Vorlagen bringen die Übersetzungen für alle Sprachen der Mitarbeitenden mit. Ändert sich der deutsche Text, gilt die Übersetzung als veraltet und am Handy steht der deutsche Text. „Mit KI übersetzen“ füllt fehlende und veraltete Übersetzungen als Vorschlag; gespeichert wird erst mit der Leistung.</p>
  </section>`
}

/** Punkte aus dem Dialog lesen (ohne Formular: die gespeicherten). */
function readRows(existing = []) {
  const rows = [...document.querySelectorAll('#ck-rows .ck-row')]
  const by = app.user?.name || ''
  const at = todayISO()
  return rows.map((row) => {
    const id = row.dataset.id
    const text = (document.getElementById(`ck-text-${id}`)?.value || '').replace(/\s+/g, ' ').trim()
    const when = document.getElementById(`ck-when-${id}`)?.value || 'immer'
    const days = when === 'tage' ? [...row.querySelectorAll(`input[name="ck-day-${id}"]:checked`)].map((el) => Number(el.value)) : []
    let old = {}
    try {
      old = JSON.parse(row.dataset.i18n || '{}')
    } catch {
      old = {}
    }
    const prev = existing.find((x) => x.id === id)
    const inputs = Object.fromEntries(FOREIGN_LANGUAGES.map((l) => [l.id, document.getElementById(`ck-tr-${id}-${l.id}`)?.value ?? '']))
    const ki = FOREIGN_LANGUAGES.filter((l) => {
      const el = document.getElementById(`ck-tr-${id}-${l.id}`)
      return el?.dataset.ki && el.value.trim() === el.dataset.ki.trim()
    }).map((l) => l.id)
    // ohne Änderung bleiben die Übersetzungen, wie sie waren (auch der Vermerk „aus der Vorlage“)
    const i18n = updateTranslations({ instructionsI18n: prev?.i18n || old }, text, inputs, { ki, by, at })
    return { id, text, photo: !!document.getElementById(`ck-photo-${id}`)?.checked, ...(when === 'woche' ? { weekly: true } : {}), ...(days.length ? { days } : {}), ...(i18n ? { i18n } : {}) }
  })
}

/** Für views/sites.js beim Speichern der Leistung: bereinigte Punkte oder undefined (keine). */
export function readChecklist(existing) {
  if (!document.getElementById('ck-rows')) return existing?.checklist
  const items = cleanItems(readRows(existing?.checklist || []))
  return items.length ? items : undefined
}

function appendRows(items) {
  const box = document.getElementById('ck-rows')
  if (!box) return
  box.insertAdjacentHTML('beforeend', items.map(rowHtml).join(''))
}

registerActions(
  {
    'ck-add': () => {
      if (document.querySelectorAll('#ck-rows .ck-row').length >= 30) return toast('Höchstens 30 Punkte je Leistung.')
      const id = uid('p')
      appendRows([{ id, text: '' }])
      document.getElementById(`ck-text-${id}`)?.focus()
    },
    'ck-del': (el) => document.querySelector(`#ck-rows .ck-row[data-id="${CSS.escape(el.dataset.id)}"]`)?.remove(),
    'ck-when': (el) => {
      const days = document.getElementById(`ck-days-${el.dataset.id}`)
      if (days) days.hidden = el.value !== 'tage'
    },
    'ck-tpl': () => {
      const tpl = CHECKLIST_TEMPLATES.find((t) => t.id === document.getElementById('ck-tpl')?.value)
      if (!tpl) return
      const current = readRows()
      const next = fromTemplate(tpl, current, { newId: () => uid('p'), at: todayISO() })
      const added = next.slice(current.length)
      appendRows(added)
      toast(added.length ? `Vorlage ${tpl.label}: ${plural(added.length, 'Punkt', 'Punkte')} übernommen (mit Übersetzungen). Mit „Speichern“ sichern.` : 'Diese Punkte gibt es schon.')
    },
    'ck-ki': async (el) => {
      const rows = readRows().filter((x) => x.text)
      if (!rows.length) return toast('Bitte zuerst Punkte auf Deutsch eintragen.')
      if (!el?.dataset?.consent && !kixConsent('ck', 'Der deutsche Text der Punkte', { action: 'ck-ki' })) return
      kixSet('ck', { busy: 'Wird übersetzt …' })
      try {
        const { translateChecklist } = await import('../../ai/translate.js')
        const langs = FOREIGN_LANGUAGES.map((l) => l.id)
        const result = await translateChecklist(rows.map((x) => x.text), langs)
        let n = 0
        rows.forEach((x, i) => {
          const status = translationRows(asObject(x), x.text)
          for (const l of FOREIGN_LANGUAGES) {
            const field = document.getElementById(`ck-tr-${x.id}-${l.id}`)
            const text = result[l.id]?.[i]
            const r = status.find((s) => s.id === l.id)
            // aktuelle Übersetzungen bleiben; fehlende und veraltete bekommen den Vorschlag
            if (!field || !text || (r?.text && !r.stale && field.value.trim())) continue
            field.value = text
            field.dataset.ki = text
            field.closest('details')?.setAttribute('open', '')
            n++
          }
        })
        kixSet('ck', n ? { notice: { title: `Vorschlag der KI: ${plural(n, 'Übersetzung', 'Übersetzungen')} eingetragen`, items: [{ level: 'info', text: 'Bitte lesen und mit „Speichern“ sichern. Vorhandene aktuelle Übersetzungen bleiben.' }] } } : { notice: { title: 'Keine fehlenden Übersetzungen', items: [] } })
      } catch (err) {
        kixSet('ck', { error: `Übersetzen nicht möglich: ${kixFailed(err)}` })
      }
    },
  },
  { edit: 'stammdaten' },
)
