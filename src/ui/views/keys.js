// Schlüsselbuch (Objektservice): Schlüssel je Objekt und je Person, Ausgabe und Rückgabe mit Datum,
// Unterschrift am Bildschirm und Quittung (PDF), Verlust mit Verlustmeldung, Hinweise (ausgetreten,
// Rückgabe fällig, verloren), Übergaben laut Plan in den nächsten 7 Tagen. Datei schluessel/schluessel.json
// (Rechenkern: core/keys.js). Die Prüfregel „Schlüsselübergabe nötig“ im Plan liest dieses Buch.

import { addDays, formatDate, todayISO } from '../../core/dates.js'
import { effectiveKeys, emptyKeys, giveBack, handOver, handoversNeeded, historyText, importFromObjects, isActive, KEY_KINDS, KEY_STATUS, keysOf, keyWarnings, markFound, markLost, objectKeys, returnToCustomer } from '../../core/keys.js'
import { toCSV } from '../../core/reports.js'
import { lossDocument, personListDocument, receiptDocument, receiptPdfName } from '../../export/key-pdf.js'
import { app, canEdit, closeModal, computeRange, confirmStep, empName, ensureRange, openModal, persist, registerActions, registerModal, registerObjectHint, registerView, renderModal, renderNow, toast } from '../context.js'
import { registerTodo } from '../modals/todo.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, checkedValues, download, esc, ICON, menu, modalFrame, options, uid, val } from '../shared.js'
import { clearSignatures, signatureField, signatureSvg } from '../signature.js'

const MODULE = 'schluessel'
const ICON_KEY = '<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 9.3-9.3M17 6l3 3M14.5 8.5l2 2"/>'
const book = () => {
  const d = (app.data.schluessel ||= emptyKeys())
  d.keys ||= []
  return d
}
const editable = () => canEdit(MODULE) && !app.readOnly
const nowIso = () => new Date().toISOString()
const by = () => app.user?.name || 'Browser'
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const objName = (id) => objOf(id)?.name || 'Objekt'
const keyOf = (id) => book().keys.find((k) => k.id === id)
const holderText = (k) => (k.holderId ? empName(k.holderId) : k.storage ? `Büro (${k.storage})` : 'Büro')
const SEV = { error: 'error', warning: 'warning', info: 'info' }
const activeEmployees = () => app.data.employees.filter((e) => !e.exitDate || e.exitDate >= todayISO())
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function update(id, fn) {
  const d = book()
  d.keys = d.keys.map((k) => (k.id === id ? fn(k) : k))
}

const warnings = () => keyWarnings({ keys: book().keys, employees: app.data.employees, absences: app.data.absences || [], today: todayISO() })
const legacyKeys = () => importFromObjects(app.data.objects, book().keys, { newId: () => 'x', at: '', date: '' })

/** Übergaben laut Plan (heute bis +7 Tage), wenn die Wochen geladen sind. */
function handovers() {
  try {
    const from = todayISO()
    const r = computeRange(from, addDays(from, 7))
    return handoversNeeded({ instances: r.instances, state: r.state, keysByObject: effectiveKeys(app.data.objects, book().keys), from, to: addDays(from, 7) }).filter((h) => book().keys.some((k) => k.objectId === h.inst.objectId))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------- Ansicht

function keysView() {
  const d = book()
  const ed = editable()
  const legacy = legacyKeys()
  const active = d.keys.filter(isActive)
  const out = active.filter((k) => k.holderId)
  const warn = warnings()
  const mode = app.ui.keyMode === 'person' ? 'person' : 'objekt'
  const tile = (label, value, cls = '') => `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div></div>`
  const banner = legacy.length && ed ? `<div class="banner welcome"><p><strong>${plural(legacy.length, 'Schlüssel ist', 'Schlüssel sind')} bisher direkt bei den Objekten eingetragen.</strong> Ins Schlüsselbuch übernehmen (mit der Person, die ihn hat): ab dann mit Ausgabe, Rückgabe und Quittung.</p><button class="btn primary" data-action="keys-import">Übernehmen</button></div>` : ''
  const empty = !d.keys.length && !legacy.length ? `<div class="banner welcome"><p><strong>Noch keine Schlüssel.</strong> Je Objekt die Schlüssel, Transponder und Karten anlegen (auch mehrere gleiche auf einmal), dann ausgeben: mit Unterschrift am Handy oder Tablet und Quittung als PDF.</p>${ed ? `<button class="btn primary" data-action="key-edit-open">${ICON.plus} Schlüssel anlegen</button>` : ''}</div>` : ''
  const warnHtml = warn.length
    ? `<div class="table-wrap"><table class="data"><thead><tr><th></th><th>Objekt</th><th>Schlüssel</th><th>Hinweis</th><th></th></tr></thead><tbody>${warn
        .map((w) => `<tr><td><span class="flag ${SEV[w.severity]}">${w.severity === 'info' ? 'i' : '!'}</span></td><td>${esc(objName(w.key.objectId))}</td><td>${esc(w.key.label)}${w.key.no ? ` <span class="muted">${esc(w.key.no)}</span>` : ''}</td><td>${esc(w.text)}</td>
          <td>${ed ? (w.code === 'VERLOREN' ? `<button class="btn small" data-action="key-lost-open" data-id="${esc(w.key.id)}">Verlust bearbeiten</button>` : `<button class="btn small" data-action="key-move-open" data-mode="rueckgabe" data-emp="${esc(w.key.holderId)}" data-ids="${esc(w.key.id)}">Rückgabe</button>`) : ''}</td></tr>`)
        .join('')}</tbody></table></div>`
    : ''
  const ho = handovers()
  const hoHtml = ho.length
    ? `<h3>Übergaben laut Plan (nächste 7 Tage)</h3><div class="table-wrap"><table class="data"><thead><tr><th>Erster Einsatz</th><th>Objekt</th><th>Person</th><th>Schlüssel derzeit</th><th></th></tr></thead><tbody>${ho
        .slice(0, 10)
        .map((h) => `<tr><td>${formatDate(h.date)} ${esc(h.inst.startTime)}</td><td>${esc(objName(h.inst.objectId))}</td><td>${esc(empName(h.empId))}</td><td>${[...h.holders.map((id) => esc(empName(id))), h.office ? 'Büro' : ''].filter(Boolean).join(', ') || '–'}</td>
          <td>${ed ? `<button class="btn small primary" data-action="key-move-open" data-mode="ausgabe" data-obj="${esc(h.inst.objectId)}" data-emp="${esc(h.empId)}">Übergeben</button>` : ''}</td></tr>`)
        .join('')}</tbody></table></div>${ho.length > 10 ? `<p class="note">… und ${ho.length - 10} weitere. Alle stehen auch im Plan als „Schlüsselübergabe nötig“.</p>` : ''}`
    : ''
  const list = mode === 'person' ? personTable() : objectTable()
  return `<div class="section-head"><div><h2>Schlüsselbuch</h2><p>Wer hat welchen Schlüssel: Ausgabe und Rückgabe mit Unterschrift und Quittung, Verlust, Hinweise beim Austritt. Der Plan meldet daraus „Schlüsselübergabe nötig“.</p></div>
      <div class="actions">${ed ? `<button class="btn primary" data-action="key-move-open" data-mode="ausgabe">${ICON.key} Ausgeben</button><button class="btn" data-action="key-move-open" data-mode="rueckgabe">Rückgabe</button>` : ''}${menu({
        label: 'Mehr',
        single: false,
        items: [
          ed && { label: 'Schlüssel anlegen', icon: ICON.plus, action: 'key-edit-open', hint: 'Bezeichnung, Nummer, Objekt, Schließanlage' },
          { heading: 'Export' },
          { label: 'Schlüsselliste (CSV)', icon: ICON.download, action: 'keys-csv' },
        ],
      })}</div></div>
    ${banner}${empty}
    ${d.keys.length ? `<div class="impact-stats tc-stats">${tile('Schlüssel', active.length)}${tile('ausgegeben', out.length)}${tile('im Büro', active.length - out.length)}${tile('Hinweise', warn.filter((w) => w.severity !== 'info').length, warn.some((w) => w.severity === 'error') ? 'err' : '')}</div>` : ''}
    ${warnHtml}${hoHtml}
    ${d.keys.length ? `<div class="filters"><div class="seg">${[['objekt', 'je Objekt'], ['person', 'je Person']].map(([k, l]) => `<button class="btn small ${mode === k ? 'primary' : ''}" data-action="keys-mode" data-v="${k}">${l}</button>`).join('')}</div>
      ${mode === 'objekt' ? `<label class="field inline"><span>Objekt</span><select id="keys-obj" data-change="keys-obj">${options(app.data.objects.filter((o) => d.keys.some((k) => k.objectId === o.id)).map((o) => [o.id, o.name]), app.ui.keyObject || '', { empty: 'alle' })}</select></label>` : ''}
      <label class="check"><input type="checkbox" id="keys-all" ${app.ui.keyAll ? 'checked' : ''} data-change="keys-all"><span>auch verlorene und zurückgegebene</span></label></div>${list}` : ''}`
}

function objectTable() {
  const ed = editable()
  const keys = book()
    .keys.filter((k) => (app.ui.keyAll || isActive(k)) && (!app.ui.keyObject || k.objectId === app.ui.keyObject))
    .sort((a, b) => objName(a.objectId).localeCompare(objName(b.objectId), 'de') || a.label.localeCompare(b.label, 'de') || String(a.no).localeCompare(String(b.no), 'de', { numeric: true }))
  const today = todayISO()
  const rows = keys
    .map((k) => {
      const status = !isActive(k) ? `<span class="pill ${k.status === 'verloren' ? 'error' : ''}">${KEY_STATUS[k.status]}</span>` : k.due && k.due < today ? `<span class="pill warning">Rückgabe fällig</span>` : k.holderId ? '<span class="pill info">ausgegeben</span>' : '<span class="pill ok">im Büro</span>'
      const acts = ed && isActive(k) ? `<button class="btn small" data-action="key-move-open" data-mode="ausgabe" data-obj="${esc(k.objectId)}" data-ids="${esc(k.id)}">${k.holderId ? 'Weitergeben' : 'Ausgeben'}</button>${k.holderId ? ` <button class="btn small" data-action="key-move-open" data-mode="rueckgabe" data-emp="${esc(k.holderId)}" data-ids="${esc(k.id)}">Zurück</button>` : ''}` : ''
      return `<tr><td>${esc(objName(k.objectId))}</td><td class="clickable" data-action="key-edit-open" data-id="${esc(k.id)}"><strong>${esc(k.label)}</strong>${k.no ? ` <span class="muted">Nr. ${esc(k.no)}</span>` : ''}</td><td>${esc(KEY_KINDS[k.kind] || '')}</td>
        <td>${isActive(k) ? esc(holderText(k)) : '–'}</td><td>${k.since ? formatDate(k.since) : ''}</td><td>${k.due ? formatDate(k.due) : ''}</td><td>${status}</td><td class="actions-cell">${acts}</td></tr>`
    })
    .join('')
  return rows ? `<div class="table-wrap"><table class="data keys-table"><thead><tr><th>Objekt</th><th>Schlüssel</th><th>Art</th><th>bei</th><th>seit</th><th>Rückgabe bis</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine Schlüssel in dieser Auswahl.</p>'
}

function personTable() {
  const ed = editable()
  const keys = book().keys.filter((k) => isActive(k) && k.holderId)
  const byPerson = new Map()
  for (const k of keys) byPerson.set(k.holderId, [...(byPerson.get(k.holderId) || []), k])
  const rows = [...byPerson]
    .sort((a, b) => empName(a[0]).localeCompare(empName(b[0]), 'de'))
    .map(([empId, list]) => {
      const e = app.data.employees.find((x) => x.id === empId)
      return `<tr><td><strong>${esc(empName(empId))}</strong>${e?.exitDate ? ` <span class="pill ${e.exitDate < todayISO() ? 'error' : 'warning'}">Austritt ${formatDate(e.exitDate)}</span>` : ''}</td><td class="num">${list.length}</td>
        <td>${list.map((k) => `${esc(objName(k.objectId))}: ${esc(k.label)}${k.no ? ` (${esc(k.no)})` : ''}`).join('<br>')}</td>
        <td class="actions-cell"><button class="btn small" data-action="keys-person-pdf" data-emp="${esc(empId)}">${ICON.download} Liste</button>${ed ? ` <button class="btn small" data-action="key-move-open" data-mode="rueckgabe" data-emp="${esc(empId)}">Rückgabe</button>` : ''}</td></tr>`
    })
    .join('')
  return rows ? `<div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th class="num">Schlüssel</th><th>welche</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Niemand hat gerade einen Schlüssel: alle im Büro.</p>'
}

registerView({
  id: 'schluessel',
  order: 74,
  label: 'Schlüsselbuch',
  group: 'service',
  module: MODULE,
  icon: ICON_KEY,
  noWeek: true,
  text: 'Schlüssel, Ausgabe, Rückgabe, Quittung',
  badge: () => warnings().filter((w) => w.severity === 'error').length,
  range: () => ({ from: todayISO(), to: addDays(todayISO(), 7) }),
  render: keysView,
})

// ---------------------------------------------------------------- Schlüssel anlegen und bearbeiten

function editModal(c, m) {
  const k = m.id ? keyOf(m.id) : null
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const x = k || { objectId: m.objectId || app.ui.keyObject || '', label: '', no: '', kind: 'schluessel', storage: '', note: '' }
  const history = (k?.history || []).slice().reverse()
  const onlyAdmin = k && (k.history || []).every((h) => ['angelegt', 'uebernommen', 'geaendert'].includes(h.kind)) && !k.holderId
  return modalFrame({
    title: k ? `${k.label}${k.no ? ` · Nr. ${k.no}` : ''}` : 'Schlüssel anlegen',
    subtitle: k ? `${esc(objName(k.objectId))} · ${isActive(k) ? esc(holderText(k)) : KEY_STATUS[k.status]}` : '',
    wide: true,
    body: `<div class="form-grid">
        <label class="field"><span>Objekt</span><select id="ke-obj" ${dis}>${options(app.data.objects.map((o) => [o.id, o.name]), x.objectId, { empty: '– wählen –' })}</select></label>
        <label class="field"><span>Bezeichnung</span><input type="text" id="ke-label" value="${esc(x.label)}" placeholder="z. B. Haupteingang, Keller, Generalschlüssel" ${dis}></label>
        <label class="field"><span>Nummer / Prägung</span><input type="text" id="ke-no" value="${esc(x.no || '')}" placeholder="z. B. 12 oder S-4711" ${dis}></label>
        <label class="field"><span>Art</span><select id="ke-kind" ${dis}>${options(Object.entries(KEY_KINDS), x.kind)}</select></label>
        <label class="field"><span>Aufbewahrung im Büro</span><input type="text" id="ke-storage" value="${esc(x.storage || '')}" placeholder="z. B. Schlüsselkasten Haken 14" ${dis}></label>
        ${k ? '' : `<label class="field"><span>Anzahl gleicher Schlüssel</span><input type="number" id="ke-count" min="1" max="30" value="1" ${dis}></label>`}
        <label class="field wide"><span>Notiz (keine Codes oder Passwörter)</span><input type="text" id="ke-note" value="${esc(x.note || '')}" ${dis}></label>
      </div>
      ${k ? '' : '<p class="note">Bei mehreren gleichen Schlüsseln bekommt jeder eine eigene Nummer (1, 2, 3 … bzw. Nummer-1, Nummer-2 …), damit klar ist, wer welchen hat.</p>'}
      ${k?.status === 'verloren' ? `<div class="banner warn-banner"><p><strong>Verloren</strong> am ${formatDate(k.lost?.date)}${k.lost?.text ? `: ${esc(k.lost.text)}` : ''}. ${k.lost?.informed ? 'Kunde informiert.' : 'Kunde noch nicht informiert.'}${k.lost?.measure ? ` Maßnahme: ${esc(k.lost.measure)}` : ''}</p></div>` : ''}
      ${history.length ? `<section><h3>Verlauf</h3><ul class="tc-list">${history.map((h) => `<li>${formatDate(h.date)} ${esc(historyText(h, empName))}${h.by ? ` <span class="muted">(${esc(h.by)})</span>` : ''}${h.note ? ` – ${esc(h.note)}` : ''}${h.signature ? ' <span class="pill ok">unterschrieben</span>' : ''}</li>`).join('')}</ul></section>` : ''}`,
    foot: `<div class="actions">${ed && k ? `${isActive(k) ? `<button class="btn" data-action="key-lost-open" data-id="${esc(k.id)}">Verlust melden</button><button class="btn" data-action="key-customer" data-id="${esc(k.id)}">${app.ui.confirm === `key-cust:${k.id}` ? 'Wirklich an Kunden zurück?' : 'An Kunden zurück'}</button>` : k.status === 'verloren' ? `<button class="btn" data-action="key-lost-open" data-id="${esc(k.id)}">Verlust bearbeiten</button><button class="btn" data-action="key-found" data-id="${esc(k.id)}">Wieder da</button>` : ''}${onlyAdmin ? `<button class="btn danger" data-action="key-delete" data-id="${esc(k.id)}">${app.ui.confirm === `key-del:${k.id}` ? 'Wirklich löschen?' : 'Löschen'}</button>` : ''}` : ''}</div>
      <div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? `<button class="btn primary" data-action="key-save" data-id="${esc(k?.id || '')}">Speichern</button>` : ''}</div>`,
  })
}
registerModal('key-edit', editModal, { module: MODULE })

function saveKey(id) {
  const objectId = val('ke-obj')
  const label = val('ke-label').trim()
  if (!objectId) return toast('Bitte das Objekt wählen.')
  if (!label) return toast('Bitte eine Bezeichnung eingeben, z. B. Haupteingang.')
  const fields = { objectId, label, no: val('ke-no').trim(), kind: val('ke-kind'), storage: val('ke-storage').trim(), note: val('ke-note').trim() }
  const d = book()
  const date = todayISO()
  if (id) {
    update(id, (k) => ({ ...k, ...fields, history: [...(k.history || []), ...(k.objectId !== objectId || k.label !== label || k.no !== fields.no ? [{ at: nowIso(), date, kind: 'geaendert', by: by() }] : [])] }))
  } else {
    const count = Math.max(1, Math.min(30, Math.round(Number(val('ke-count')) || 1)))
    for (let i = 1; i <= count; i++) {
      const no = count > 1 ? (fields.no ? `${fields.no}-${i}` : String(i)) : fields.no
      d.keys.push({ id: uid('k'), ...fields, no, holderId: '', since: date, due: '', status: 'aktiv', history: [{ at: nowIso(), date, kind: 'angelegt', by: by() }] })
    }
    toast(count > 1 ? `${count} Schlüssel „${label}“ angelegt (Nr. ${fields.no ? `${fields.no}-1` : '1'} bis ${fields.no ? `${fields.no}-${count}` : count}).` : `Schlüssel „${label}“ angelegt.`)
  }
  persist()
  closeModal()
  renderNow()
  if (id) toast('Gespeichert.')
}

// ---------------------------------------------------------------- Ausgeben und zurücknehmen

function moveDraft() {
  const m = app.ui.modal
  if (!m.init) {
    m.init = true
    m.date ||= todayISO()
    m.ids = m.ids ? String(m.ids).split(',').filter(Boolean) : []
    if (m.mode === 'ausgabe' && !m.objectId && m.ids.length) m.objectId = keyOf(m.ids[0])?.objectId || ''
    if (m.mode === 'rueckgabe' && !m.empId && m.ids.length) m.empId = keyOf(m.ids[0])?.holderId || ''
    m.pdf = true
  }
  return m
}

function readMove() {
  const m = moveDraft()
  if (!document.getElementById('km-date')) return m
  Object.assign(m, { date: val('km-date') || todayISO(), due: val('km-due'), note: val('km-note').trim(), pdf: checked('km-pdf'), ids: checkedValues('km-key') })
  if (document.getElementById('km-obj')) m.objectId = val('km-obj')
  if (document.getElementById('km-emp')) m.empId = val('km-emp')
  return m
}

function moveModal() {
  const m = moveDraft()
  const give = m.mode === 'ausgabe'
  const d = book()
  const candidates = give ? objectKeys(d.keys, m.objectId) : keysOf(d.keys, m.empId)
  const keyRows = candidates.length
    ? candidates.map((k) => `<label class="check"><input type="checkbox" name="km-key" value="${esc(k.id)}" ${m.ids.includes(k.id) || (!m.ids.length && (!give || candidates.length === 1)) ? 'checked' : ''}><span>${give ? '' : `${esc(objName(k.objectId))}: `}${esc(k.label)}${k.no ? ` <span class="muted">Nr. ${esc(k.no)}</span>` : ''} <span class="muted">· ${esc(holderText(k))}</span></span></label>`).join('')
    : `<p class="muted">${give ? (m.objectId ? 'Für dieses Objekt ist kein Schlüssel angelegt.' : 'Zuerst das Objekt wählen.') : m.empId ? 'Diese Person hat keinen Schlüssel.' : 'Zuerst die Person wählen.'}</p>`
  const people = give ? activeEmployees() : app.data.employees.filter((e) => keysOf(d.keys, e.id).length)
  return modalFrame({
    title: give ? 'Schlüssel ausgeben' : 'Schlüssel zurücknehmen',
    subtitle: give ? 'Übergabe mit Unterschrift und Quittung' : 'zurück ins Büro',
    wide: true,
    body: `<div class="form-grid">
        ${give ? `<label class="field"><span>Objekt</span><select id="km-obj" data-change="key-move-redraw">${options(app.data.objects.filter((o) => d.keys.some((k) => k.objectId === o.id && isActive(k))).map((o) => [o.id, o.name]), m.objectId || '', { empty: '– wählen –' })}</select></label>` : ''}
        <label class="field"><span>${give ? 'An' : 'Von'}</span><select id="km-emp" ${give ? '' : 'data-change="key-move-redraw"'}>${options(people.map((e) => [e.id, e.name]), m.empId || '', { empty: '– Person –' })}</select></label>
        <label class="field"><span>Datum</span><input type="date" id="km-date" value="${esc(m.date)}"></label>
        ${give ? `<label class="field"><span>Rückgabe bis (optional)</span><input type="date" id="km-due" value="${esc(m.due || '')}"></label>` : ''}
      </div>
      <section><h3>Schlüssel</h3><div class="form-grid">${keyRows}</div></section>
      <label class="field wide"><span>Notiz</span><input type="text" id="km-note" value="${esc(m.note || '')}" placeholder="${give ? 'z. B. für die Urlaubsvertretung' : ''}"></label>
      ${signatureField('key-sig', give ? 'Unterschrift Empfänger:in (am Handy oder Tablet)' : 'Unterschrift Büro (optional)')}
      <label class="check"><input type="checkbox" id="km-pdf" ${m.pdf ? 'checked' : ''}><span>Quittung als PDF</span></label>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary" data-action="key-move-save">${give ? 'Ausgeben' : 'Zurücknehmen'}</button></div>`,
  })
}
registerModal('key-move', moveModal, { module: MODULE })

async function saveMove() {
  const m = readMove()
  const give = m.mode === 'ausgabe'
  if (!m.empId) return toast(give ? 'Bitte wählen, wer die Schlüssel bekommt.' : 'Bitte die Person wählen.')
  if (!m.ids.length) return toast('Bitte mindestens einen Schlüssel ankreuzen.')
  const signature = signatureSvg('key-sig')
  const keys = m.ids.map(keyOf).filter(Boolean)
  const base = { date: m.date, by: by(), note: m.note, signature, at: nowIso() }
  const from = give ? [...new Set(keys.map((k) => (k.holderId ? empName(k.holderId) : 'Büro')))].join(', ') : empName(m.empId)
  for (const k of keys) update(k.id, (x) => (give ? handOver(x, { ...base, to: m.empId, due: m.due }) : giveBack(x, base)))
  persist()
  if (m.pdf) {
    // je Objekt eine Quittung
    const byObject = new Map()
    for (const k of keys) byObject.set(k.objectId, [...(byObject.get(k.objectId) || []), k])
    const logo = await loadLogo().catch(() => null)
    for (const [objectId, list] of byObject) {
      const obj = objOf(objectId) || {}
      const doc = receiptDocument({ keys: list, objectName: obj.name || '', address: obj.address || '', to: give ? empName(m.empId) : app.user?.name || 'Büro', from: give ? from : empName(m.empId), date: m.date, due: give ? m.due : '', note: m.note, signature, brand: app.config.brand || {}, logo, giveBack: !give })
      download(receiptPdfName(obj.name || '', empName(m.empId), m.date, !give), await pdfBlob(doc))
    }
  }
  clearSignatures('key-')
  closeModal()
  renderNow()
  toast(give ? `${plural(keys.length, 'Schlüssel', 'Schlüssel')} an ${empName(m.empId)} ausgegeben${signature ? ' (unterschrieben)' : ''}.` : `${plural(keys.length, 'Schlüssel', 'Schlüssel')} von ${empName(m.empId)} zurück im Büro.`)
}

// ---------------------------------------------------------------- Verlust

function lostModal(c, m) {
  const k = keyOf(m.id)
  if (!k) return ''
  const lost = k.lost || {}
  return modalFrame({
    title: `Verlust: ${k.label}${k.no ? ` Nr. ${k.no}` : ''}`,
    subtitle: `${esc(objName(k.objectId))}${k.holderId ? ` · zuletzt bei ${esc(empName(k.holderId))}` : ''}`,
    body: `<div class="form-grid">
        <label class="field"><span>Verlust bemerkt am</span><input type="date" id="kl-date" value="${esc(lost.date || todayISO())}"></label>
        <label class="field wide"><span>Umstände</span><input type="text" id="kl-text" value="${esc(lost.text || '')}" placeholder="z. B. im Bus liegen gelassen, Bund verloren"></label>
        <label class="field wide"><span>Maßnahme</span><input type="text" id="kl-measure" value="${esc(lost.measure || '')}" placeholder="z. B. Transponder gesperrt, Zylinder wird getauscht"></label>
        <label class="check"><input type="checkbox" id="kl-informed" ${lost.informed ? 'checked' : ''}><span>Kunde informiert</span></label></div>
      <p class="note">Solange der Kunde nicht informiert ist, steht der Verlust unter „Zu erledigen“. Die Verlustmeldung (PDF) enthält keine Namen.</p>`,
    foot: `<button class="btn" data-action="key-loss-pdf" data-id="${esc(k.id)}">${ICON.download} Verlustmeldung</button><div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="key-lost-save" data-id="${esc(k.id)}">Speichern</button></div>`,
  })
}
registerModal('key-lost', lostModal, { module: MODULE })

// ---------------------------------------------------------------- Aktionen

registerActions({
  'keys-mode': (el) => {
    app.ui.keyMode = el.dataset.v
    renderNow()
  },
  'keys-obj': () => {
    app.ui.keyObject = val('keys-obj')
    renderNow()
  },
  'keys-all': () => {
    app.ui.keyAll = checked('keys-all')
    renderNow()
  },
  'keys-open-object': async (el) => {
    app.ui.keyObject = el.dataset.obj
    app.ui.keyMode = 'objekt'
    app.ui.view = 'schluessel'
    app.ui.modal = null
    await ensureRange(todayISO(), addDays(todayISO(), 7)).catch(() => {})
    renderNow()
  },
  'key-edit-open': (el) => openModal({ type: 'key-edit', id: el.dataset.id || '', objectId: el.dataset.obj || '' }),
  'keys-csv': () => {
    const cols = [
      ['Objekt', (k) => objName(k.objectId)],
      ['Schlüssel', (k) => k.label],
      ['Nummer', (k) => k.no || ''],
      ['Art', (k) => KEY_KINDS[k.kind] || ''],
      ['bei', (k) => (isActive(k) ? holderText(k) : '')],
      ['seit', (k) => k.since || ''],
      ['Rückgabe bis', (k) => k.due || ''],
      ['Status', (k) => KEY_STATUS[k.status || 'aktiv']],
    ]
    download(`Schluesselbuch_${todayISO()}.csv`, new Blob([`﻿${toCSV(book().keys, cols)}`], { type: 'text/csv;charset=utf-8' }))
  },
  'keys-person-pdf': async (el) => {
    const empId = el.dataset.emp
    const rows = keysOf(book().keys, empId).map((key) => ({ key, objectName: objName(key.objectId) }))
    download(`Schluessel_${empName(empId).replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-')}_${todayISO()}.pdf`, await pdfBlob(personListDocument({ person: empName(empId), rows, brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })))
  },
  'key-loss-pdf': async (el) => {
    const k = keyOf(el.dataset.id)
    const obj = objOf(k.objectId) || {}
    const draft = { ...k, lost: { ...(k.lost || {}), date: val('kl-date') || k.lost?.date, text: val('kl-text') || k.lost?.text, measure: val('kl-measure') || k.lost?.measure } }
    download(`Verlustmeldung_${(obj.name || '').replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '-')}_${draft.lost.date || todayISO()}.pdf`, await pdfBlob(lossDocument({ key: draft, objectName: obj.name || '', address: obj.address || '', brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) })))
  },
})

registerActions(
  {
    'keys-import': () => {
      const list = importFromObjects(app.data.objects, book().keys, { newId: () => uid('k'), at: nowIso(), date: todayISO(), by: by() })
      book().keys.push(...list)
      persist()
      renderNow()
      toast(`${plural(list.length, 'Schlüssel', 'Schlüssel')} übernommen. Nummern und Art bei Bedarf ergänzen.`)
    },
    'key-save': (el) => saveKey(el.dataset.id || ''),
    'key-delete': (el) => {
      if (!confirmStep(`key-del:${el.dataset.id}`, renderModal)) return
      book().keys = book().keys.filter((k) => k.id !== el.dataset.id)
      persist()
      closeModal()
      renderNow()
      toast('Schlüssel gelöscht.')
    },
    'key-move-open': async (el) => {
      clearSignatures('key-')
      await ensureRange(todayISO(), addDays(todayISO(), 7)).catch(() => {})
      openModal({ type: 'key-move', mode: el.dataset.mode || 'ausgabe', objectId: el.dataset.obj || '', empId: el.dataset.emp || '', ids: el.dataset.ids || '' })
    },
    'key-move-redraw': () => {
      const m = readMove()
      m.ids = []
      renderModal()
    },
    'key-move-save': () => saveMove(),
    'key-lost-open': (el) => openModal({ type: 'key-lost', id: el.dataset.id }),
    'key-lost-save': (el) => {
      const k = keyOf(el.dataset.id)
      const data = { date: val('kl-date') || todayISO(), by: by(), text: val('kl-text').trim(), informed: checked('kl-informed'), measure: val('kl-measure').trim(), at: nowIso() }
      if (k.status === 'verloren') update(k.id, (x) => ({ ...x, lost: { date: data.date, text: data.text, informed: data.informed, measure: data.measure } }))
      else update(k.id, (x) => markLost(x, data))
      persist()
      closeModal()
      renderNow()
      toast(data.informed ? 'Verlust gespeichert.' : 'Verlust gespeichert. Bitte den Kunden informieren (Verlustmeldung als PDF).')
    },
    'key-found': (el) => {
      update(el.dataset.id, (x) => markFound(x, { date: todayISO(), by: by(), at: nowIso() }))
      persist()
      closeModal()
      renderNow()
      toast('Schlüssel ist wieder da und liegt im Büro.')
    },
    'key-customer': (el) => {
      if (!confirmStep(`key-cust:${el.dataset.id}`, renderModal)) return
      update(el.dataset.id, (x) => returnToCustomer(x, { date: todayISO(), by: by(), at: nowIso() }))
      persist()
      closeModal()
      renderNow()
      toast('Als „an Kunden zurück“ vermerkt.')
    },
  },
  { edit: MODULE },
)

// ---------------------------------------------------------------- Zu erledigen, Objekt-Hinweis

registerTodo({
  id: 'schluessel',
  module: MODULE,
  title: 'Schlüssel',
  compute: () => warnings().filter((w) => w.severity !== 'info').map((w) => ({ ...w, id: `${w.code}:${w.key.id}:${w.key.holderId || ''}:${w.key.due || ''}` })),
  render: (list) =>
    list
      .map((w) => `<div class="todo-item"><span class="flag ${SEV[w.severity]}">!</span><div class="todo-text"><strong>${esc(objName(w.key.objectId))}: ${esc(w.key.label)}${w.key.no ? ` Nr. ${esc(w.key.no)}` : ''}</strong><br><span class="muted">${esc(w.text)}</span></div>
        ${w.code === 'VERLOREN' ? `<button class="btn small primary" data-action="key-lost-open" data-id="${esc(w.key.id)}">Bearbeiten</button>` : `<button class="btn small primary" data-action="key-move-open" data-mode="rueckgabe" data-emp="${esc(w.key.holderId)}" data-ids="${esc(w.key.id)}">Rückgabe</button>`}</div>`)
      .join(''),
})

registerObjectHint({
  module: MODULE,
  html: (objectId) => {
    const keys = objectKeys(book().keys, objectId)
    if (!keys.length) return ''
    return `<strong>Schlüssel</strong>: ${keys.map((k) => `${esc(k.label)}${k.no ? ` ${esc(k.no)}` : ''} bei ${esc(holderText(k))}`).join(' · ')}${editable() ? ` <button class="btn small" data-action="key-move-open" data-mode="ausgabe" data-obj="${esc(objectId)}">Übergeben</button>` : ''}`
  },
})
