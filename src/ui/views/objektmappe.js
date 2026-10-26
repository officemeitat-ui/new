// Modul Objektmappe (ersetzt das Objekt-Dokument): je Objekt Kunde,
// Ansprechpartner, Zugang (ohne Codes), Geräte, Hinweise, Anhänge und das
// Leistungsverzeichnis mit Richtzeiten und Raumbuch, Ablauf- und
// Zugangsfotos. Stunden werden gerechnet und mit dem Dienstplan verglichen.
// Jedes Speichern ist eine Fassung (Verlauf mit Unterschieden, zurückholbar).
// Daraus das Objektblatt als PDF: fürs Personal (auch Englisch/Rumänisch),
// als Kundenfassung (nie Vertrauliches) oder als Akte, auf Wunsch mit
// Öffnungscode.

import { formatHours, todayISO } from '../../core/dates.js'
import { fileSafe } from '../../core/filename.js'
import { DEFECTS, itemText, openDefects, suggestOverall } from '../../core/inspections.js'
import { convertTemplates } from '../../core/legacy.js'
import { meterLabel, METER_KINDS } from '../../core/meters.js'
import { ACCESS_TYPES, areaFromTemplate, areaMinutes, compareHours, completeness, diffMappe, importCustomers, LV_INTERVALS, PRESETS, restoreVersion, roomsSize, saveVersion, SECTIONS, serviceWeekdays, sheetSections, templateFromArea, versions, WEEKDAYS } from '../../core/objektmappe.js'
import { wasteSummary } from '../../core/waste.js'
import { BUILTIN_TEMPLATES } from '../../data/lv-vorlagen.js'
import { SHEET_LANGS } from '../../export/objektblatt-i18n.js'
import { objektblattDocument } from '../../export/objektblatt-pdf.js'
import { openCode, protectPdf } from '../../export/pdf-parts.js'
import { app, canEdit, closeModal, empName, openModal, persist, registerActions, registerModal, registerView, renderModal, renderNow, toast } from '../context.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { photoDataUrl, photoLink, storePhoto } from '../photo.js'
import { download, esc, ICON, modalFrame, options, rhythmText } from '../shared.js'

const MODULE = 'objektmappe'
const M = () => {
  const m = (app.data.mappe ||= { objects: {} })
  m.objects ||= {}
  return m
}
const objOf = (id) => app.data.objects.find((o) => o.id === id)
const editable = () => canEdit(MODULE)
const canPdf = () => app.config.features.pdf && app.config.features.download
const h = (min) => formatHours(min)
const stamp = (iso) => (iso ? new Date(iso).toLocaleString('de-AT', { dateStyle: 'short', ...(iso.length > 10 ? { timeStyle: 'short' } : {}) }) : '')

/** Eigene Bereichsvorlagen zuerst, dann der eingebaute Katalog (gleichnamige eigene ersetzen ihn). */
function allTemplates() {
  const own = M().templates || []
  return [...own.map((t) => ({ ...t, own: true })), ...convertTemplates(BUILTIN_TEMPLATES).filter((b) => !own.some((o) => o.name === b.name))]
}

// ---------------------------------------------------------------- Bestand

function mappeView() {
  const q = (app.ui.mappeSearch || '').trim().toLowerCase()
  const region = app.ui.region
  const rows = app.data.objects
    .filter((o) => !region || o.region === region)
    .map((o) => ({ o, m: M().objects[o.id] || {} }))
    .filter(({ o, m }) => !q || `${o.name} ${o.short || ''} ${o.address || ''} ${m.customer || ''} ${m.customerNo || ''} ${m.objectNo || ''}`.toLowerCase().includes(q))
    .sort((a, b) => a.o.name.localeCompare(b.o.name, 'de'))
  const body = rows
    .map(({ o, m }) => {
      const c = completeness(m, o)
      const cmp = compareHours(m, app.data.tasks, o.id, todayISO())
      return `<tr><td><span class="swatch" style="--obj:var(--o${o.color || 10})"></span><button class="link-btn" data-action="mp-open" data-id="${esc(o.id)}"><strong>${esc(o.name)}</strong></button><br><span class="muted">${esc([o.address, m.objectNo ? `Obj.-Nr. ${m.objectNo}` : ''].filter(Boolean).join(' · '))}</span></td>
        <td>${esc(m.customer || '')}${m.customerNo ? `<br><span class="muted">Kd.-Nr. ${esc(m.customerNo)}</span>` : ''}</td>
        <td class="num">${cmp.lv ? `${h(cmp.lv)} h` : '–'}<br><span class="muted">Plan ${h(cmp.plan)} h</span>${cmp.warn ? `<br><span class="pill warning">${cmp.diff > 0 ? '+' : '−'}${h(Math.abs(cmp.diff))} h</span>` : ''}</td>
        <td><span class="pill ${c.pct === 100 ? 'ok' : c.pct >= 60 ? 'info' : 'warning'}">${c.pct} %</span>${c.missing.length ? `<br><span class="muted">fehlt: ${esc(c.missing.join(', '))}</span>` : ''}</td>
        <td><button class="btn small" data-action="mp-open" data-id="${esc(o.id)}">Öffnen</button>${canPdf() ? ` <button class="btn small" data-action="mp-open" data-id="${esc(o.id)}" data-tab="blatt">${ICON.print} Blatt</button>` : ''}</td></tr>`
    })
    .join('')
  const customers = M().customers?.length || 0
  return `<div class="section-head"><div><h2>${ICON.folder} Objektmappe</h2>
      <p>Alles zum Objekt an einem Ort: Ansprechpartner, Zugang, Leistungsverzeichnis mit Richtzeiten, Geräte, Dokumente. Stunden werden gerechnet und mit dem Dienstplan verglichen. Das Objektblatt gibt es fürs Personal, für den Kunden (ohne Vertrauliches) und als Akte.</p></div>
      <div class="actions">${editable() ? `<button class="btn" data-action="legacy-open">${ICON.upload} Aus Objektdoku &amp; Prüfprotokoll übernehmen</button><button class="btn" data-action="mp-customers-open">${ICON.users} Kundenstamm${customers ? ` (${customers})` : ''}</button>` : ''}</div></div>
    <div class="toolbar filters-bar"><label class="field inline grow"><span>Suche</span><input type="search" id="mappe-search" value="${esc(app.ui.mappeSearch || '')}" placeholder="Objekt, Kunde, Nummer" data-input="mappe-search"></label></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Objekt</th><th>Kunde</th><th>Stunden/Woche</th><th>Pflegestand</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`
}

registerView({ id: 'objektmappe', order: 74, label: 'Objektmappe', group: 'service', module: MODULE, noWeek: true, mobile: { icon: ICON.folder, label: 'Mappe' }, render: mappeView })

// ---------------------------------------------------------------- Akte bearbeiten

const TEMPLATES = {
  contacts: () => ({ name: '', role: '', phone: '', mail: '', note: '', internal: false }),
  access: () => ({ label: '', number: '', type: 'Schlüssel', count: 1, place: '', note: '', confidential: true }),
  devices: () => ({ label: '', place: '', inventoryNo: '', owner: 'eigen', condition: '' }),
  attachments: () => ({ name: '', url: '' }),
  areas: () => ({ name: '', location: '', size: '', floor: '', services: [], rooms: [] }),
  services: () => ({ what: '', interval: 'w1', minutes: '', method: '' }),
  rooms: () => ({ no: '', name: '', size: '', floor: '', note: '' }),
  timeWindows: () => ({ days: 'Mo–Fr', from: '', to: '', note: '' }),
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj)
function setPath(obj, path, value) {
  const keys = path.split('.')
  const last = keys.pop()
  const target = keys.reduce((o, k) => (o[k] ??= /^\d+$/.test(k) ? [] : {}), obj)
  target[last] = value
}

/** Eingabefeld, das direkt in den Entwurf schreibt. */
function input(path, value, { type = 'text', placeholder = '', label = '', cls = '', list = '' } = {}) {
  const dis = editable() ? '' : 'disabled'
  if (type === 'checkbox') return `<label class="field inline"><input type="checkbox" data-change="mp-set" data-path="${path}" ${value ? 'checked' : ''} ${dis}><span>${esc(label)}</span></label>`
  if (type === 'textarea') return `<label class="field wide"><span>${esc(label)}</span><textarea rows="3" data-change="mp-set" data-path="${path}" ${dis}>${esc(value ?? '')}</textarea></label>`
  const field = `<input type="${type}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" data-change="mp-set" data-path="${path}" ${type === 'number' ? 'inputmode="decimal"' : ''} ${list ? `list="${list}"` : ''} aria-label="${esc(label || placeholder)}" ${dis}>`
  return label ? `<label class="field ${cls}"><span>${esc(label)}</span>${field}</label>` : field
}
const select = (path, value, opts, label = '') => `<select data-change="mp-set" data-path="${path}" aria-label="${esc(label)}" ${editable() ? '' : 'disabled'}>${options(opts, value)}</select>`
const rowDel = (path) => (editable() ? `<button type="button" class="btn small danger" data-action="mp-del" data-path="${path}" aria-label="Entfernen">×</button>` : '')
const addBtn = (path, label) => (editable() ? `<button type="button" class="btn small" data-action="mp-add" data-path="${path}">${ICON.plus} ${label}</button>` : '')

function objectTab(o, d) {
  const regulars = [...new Set(app.data.tasks.filter((t) => t.objectId === o.id).flatMap((t) => t.regulars || []))]
  return `<div class="form-grid">
      ${input('customer', d.customer, { label: 'Auftraggeber / Kunde', list: 'mp-customers' })}
      ${input('customerNo', d.customerNo, { label: 'Kunden-Nr.' })}
      ${input('objectNo', d.objectNo, { label: 'Objekt-Nr.' })}
      ${input('kind', d.kind, { label: 'Objektart', placeholder: 'Wohnhaus, Büro, Praxis …' })}
      ${input('street', d.street, { label: 'Straße / Hausnummer' })}
      ${input('contract', d.contract, { label: 'Vertrag' })}
      ${input('validFrom', d.validFrom, { label: 'Gültig ab', type: 'date' })}
      ${input('hvEmail', d.hvEmail, { label: 'E-Mail Hausverwaltung (für Berichte)', type: 'email' })}
      ${input('customerEmail', d.customerEmail, { label: 'E-Mail Kunde', type: 'email' })}
      ${input('manager', d.manager, { label: 'Objektleitung' })}
      ${input('deputy', d.deputy, { label: 'Vertretung' })}
      ${input('notes', d.notes, { type: 'textarea', label: 'Hinweise (stehen auf jedem Objektblatt)' })}
    </div>
    <datalist id="mp-customers">${(M().customers || []).map((c) => `<option value="${esc(c.name)}">${esc(c.nr)}</option>`).join('')}</datalist>
    <section><h3>Einsatzzeiten laut Vertrag</h3>
      <div class="seg mp-days" role="group" aria-label="Einsatztage">${WEEKDAYS.map((w) => `<label class="field inline"><input type="checkbox" data-change="mp-day" value="${w}" ${(d.serviceDays || []).includes(w) ? 'checked' : ''} ${editable() ? '' : 'disabled'}><span>${w}</span></label>`).join('')}</div>
      ${(d.timeWindows || []).map((w, i) => `<div class="mp-row">${input(`timeWindows.${i}.days`, w.days, { placeholder: 'Tage (Mo–Fr)' })}${input(`timeWindows.${i}.from`, w.from, { type: 'time', label: '' })}${input(`timeWindows.${i}.to`, w.to, { type: 'time' })}${input(`timeWindows.${i}.note`, w.note, { placeholder: 'Hinweis (vor Geschäftsbeginn …)' })}${rowDel(`timeWindows.${i}`)}</div>`).join('')}
      ${addBtn('timeWindows', 'Zeitfenster')}
      ${input('timeNote', d.timeNote, { label: 'Hinweis zu den Zeiten', placeholder: 'z. B. nicht vor 7 Uhr, Lärmschutz' })}
      <p class="note">Die Einsatztage bestimmen, wie oft Leistungen aus Vorlagen höchstens stattfinden (bei 3 Tagen wird aus „täglich“ „3× Woche“). Ohne Angabe gelten die Tage aus dem Stammplan.</p></section>
    <section><h3>Aus dem Dienstplan</h3><ul class="plain">
      <li><span class="muted">Adresse:</span> ${esc(o.address || '–')}${o.region ? ` · ${esc(o.region)}` : ''}</li>
      <li><span class="muted">Stammkräfte:</span> ${regulars.map((id) => esc(empName(id))).join(', ') || '–'}</li>
      ${o.instructions ? `<li><span class="muted">Anweisungen:</span> ${esc(o.instructions)}</li>` : ''}
      ${o.keys?.length ? `<li><span class="muted">Schlüssel:</span> ${o.keys.map((k) => `${esc(k.label)} (${k.holderId ? esc(empName(k.holderId)) : 'Büro'})`).join(', ')}</li>` : ''}
      ${app.data.tasks.filter((t) => t.objectId === o.id).map((t) => `<li><span class="muted">${esc(t.label)}:</span> ${esc(rhythmText(t))} ${esc(t.start)}–${esc(t.end)}</li>`).join('')}
    </ul><p class="note">Diese Angaben pflegt die Disposition unter „Objekte &amp; Leistungen“.</p></section>`
}

function peopleTab(d) {
  const contacts = (d.contacts || []).map((c, i) => `<div class="mp-row">${input(`contacts.${i}.name`, c.name, { placeholder: 'Name' })}${input(`contacts.${i}.role`, c.role, { placeholder: 'Rolle (Hausverwaltung …)' })}${input(`contacts.${i}.phone`, c.phone, { placeholder: 'Telefon', type: 'tel' })}${input(`contacts.${i}.mail`, c.mail, { placeholder: 'E-Mail', type: 'email' })}${input(`contacts.${i}.note`, c.note, { placeholder: 'Hinweis (erreichbar …)' })}${input(`contacts.${i}.internal`, c.internal, { type: 'checkbox', label: 'intern' })}${rowDel(`contacts.${i}`)}</div>`).join('')
  const access = (d.access || []).map((a, i) => `<div class="mp-row">${input(`access.${i}.label`, a.label, { placeholder: 'Bezeichnung (Haupteingang …)' })}${input(`access.${i}.number`, a.number, { placeholder: 'Nr.' })}${select(`access.${i}.type`, a.type, ACCESS_TYPES.map((x) => [x, x]), 'Art')}${input(`access.${i}.count`, a.count, { placeholder: 'Anzahl', type: 'number' })}${input(`access.${i}.place`, a.place, { placeholder: 'Wo / bei wem (z. B. Schlüsselkasten Büro)' })}${rowDel(`access.${i}`)}</div>`).join('')
  const devices = (d.devices || []).map((x, i) => `<div class="mp-row">${input(`devices.${i}.label`, x.label, { placeholder: 'Gerät' })}${input(`devices.${i}.place`, x.place, { placeholder: 'Standort' })}${input(`devices.${i}.inventoryNo`, x.inventoryNo, { placeholder: 'Inventar-Nr.' })}${select(`devices.${i}.owner`, x.owner, [['eigen', `Eigentum ${app.config.brand.name || 'Firma'}`], ['Kunde', 'Eigentum Kunde']], 'Eigentum')}${input(`devices.${i}.condition`, x.condition, { placeholder: 'Zustand' })}${rowDel(`devices.${i}`)}</div>`).join('')
  const files = (d.attachments || []).map((x, i) => `<div class="mp-row">${input(`attachments.${i}.name`, x.name, { placeholder: 'Dokument (Grundriss, Hygieneplan …)' })}${input(`attachments.${i}.url`, x.url, { placeholder: 'Link (SharePoint, OneDrive)', type: 'url' })}${x.url && /^https:\/\//.test(x.url) ? `<a class="btn small" href="${esc(x.url)}" target="_blank" rel="noopener">Öffnen</a>` : ''}${rowDel(`attachments.${i}`)}</div>`).join('')
  return `<section><h3>Ansprechpartner</h3>${contacts || '<p class="note">Noch keine.</p>'}${addBtn('contacts', 'Ansprechpartner')}</section>
    <section><h3>Schlüssel und Zugang</h3><p class="note">Codes nie eintragen, nur wo sie zu erfragen sind. Vertraulich: erscheint nicht in der Kundenfassung.</p>${access || ''}${addBtn('access', 'Zugang')}</section>
    <section><h3>Geräte vor Ort</h3>${devices || ''}${addBtn('devices', 'Gerät')}</section>
    <section><h3>Dokumente</h3><p class="note">Dateien bleiben in SharePoint/OneDrive, hier nur der Link.</p>${files || ''}${addBtn('attachments', 'Dokument')}</section>`
}

function servicesTab(o, d, m) {
  const cmp = compareHours(d, app.data.tasks, o.id, todayISO())
  const intervals = Object.entries(LV_INTERVALS).map(([k, v]) => [k, v.label])
  const days = serviceWeekdays(d, app.data.tasks, o.id, todayISO())
  const tpls = allTemplates()
  const areas = (d.areas || [])
    .map((a, i) => {
      const rooms = a.rooms || []
      const sum = roomsSize(a)
      return `<div class="mp-area"><div class="mp-row mp-area-head">${input(`areas.${i}.name`, a.name, { placeholder: 'Bereich (Stiegenhaus, Büro EG …)' })}${input(`areas.${i}.location`, a.location, { placeholder: 'Lage' })}${input(`areas.${i}.size`, a.size, { placeholder: sum ? `${sum} m² (Räume)` : 'm²', type: 'number' })}${input(`areas.${i}.floor`, a.floor, { placeholder: 'Boden' })}<span class="muted mp-sum">${h(areaMinutes(a))} h/Woche</span>${editable() && a.name && a.services?.length ? `<button type="button" class="btn small" data-action="mp-as-tpl" data-i="${i}" title="Bereich mit Leistungen als eigene Vorlage speichern">Als Vorlage</button>` : ''}${rowDel(`areas.${i}`)}</div>
      ${(a.services || []).map((s, j) => `<div class="mp-row mp-service">${input(`areas.${i}.services.${j}.what`, s.what, { placeholder: 'Leistung' })}${select(`areas.${i}.services.${j}.interval`, s.interval, intervals, 'Häufigkeit')}${input(`areas.${i}.services.${j}.minutes`, s.minutes, { placeholder: 'Min. je Einsatz', type: 'number' })}${input(`areas.${i}.services.${j}.method`, s.method, { placeholder: 'Methode / Mittel' })}${rowDel(`areas.${i}.services.${j}`)}</div>`).join('')}
      ${addBtn(`areas.${i}.services`, 'Leistung')}
      <details class="mp-rooms" ${m.openRooms?.includes(i) ? 'open' : ''}><summary>Raumbuch: ${rooms.length ? `${rooms.length} ${rooms.length === 1 ? 'Raum' : 'Räume'}${sum ? `, ${sum.toLocaleString('de-AT')} m²` : ''}` : 'keine Räume'}</summary>
        ${rooms.map((r, j) => `<div class="mp-row mp-room">${input(`areas.${i}.rooms.${j}.no`, r.no, { placeholder: 'Nr.' })}${input(`areas.${i}.rooms.${j}.name`, r.name, { placeholder: 'Raum (Büro 1, WC Damen …)' })}${input(`areas.${i}.rooms.${j}.size`, r.size, { placeholder: 'm²', type: 'number' })}${input(`areas.${i}.rooms.${j}.floor`, r.floor, { placeholder: 'Boden' })}${input(`areas.${i}.rooms.${j}.note`, r.note, { placeholder: 'Bemerkung' })}${rowDel(`areas.${i}.rooms.${j}`)}</div>`).join('')}
        ${addBtn(`areas.${i}.rooms`, 'Raum')}</details></div>`
    })
    .join('')
  const own = tpls.filter((t) => t.own)
  const tplPicker = editable()
    ? `<div class="toolbar mp-tpl"><label class="field inline grow"><span>Vorlage</span><select id="mp-tpl" aria-label="Bereichsvorlage">${own.length ? `<optgroup label="Eigene Vorlagen">${own.map((t) => `<option value="${esc(t.name)}">${esc(t.name)} (${t.services.length})</option>`).join('')}</optgroup>` : ''}<optgroup label="Katalog">${tpls.filter((t) => !t.own).map((t) => `<option value="${esc(t.name)}">${esc(t.name)} (${t.services.length})</option>`).join('')}</optgroup></select></label>
        <button type="button" class="btn" data-action="mp-from-tpl">${ICON.plus} Bereich aus Vorlage</button></div>
      <p class="note">${days.length ? `Einsatztage: ${days.map((x) => WEEKDAYS[x - 1]).join(', ')}${d.serviceDays?.length ? ' (laut Vertrag)' : ' (aus dem Stammplan)'}. Häufigere Leistungen der Vorlage werden darauf begrenzt.` : 'Noch keine Einsatztage bekannt (unter „Objekt“ eintragen oder im Stammplan planen). Häufigkeiten der Vorlage bleiben unverändert.'} Richtzeiten der Vorlage sind Ausgangswerte und am Objekt anzupassen.</p>`
    : ''
  return `<div class="summary">
      <div class="stat"><div class="label">Leistungsverzeichnis</div><div class="value">${h(cmp.lv)} h</div><div class="muted">pro Woche</div></div>
      <div class="stat"><div class="label">Dienstplan</div><div class="value">${h(cmp.plan)} h</div><div class="muted">pro Woche (Stammplan)</div></div>
      <div class="stat ${cmp.warn ? 'warn' : ''}"><div class="label">Abweichung</div><div class="value">${cmp.diff > 0 ? '+' : cmp.diff < 0 ? '−' : '±'}${h(Math.abs(cmp.diff))} h</div><div class="muted">${cmp.warn ? 'bitte prüfen' : 'passt'}</div></div>
    </div>
    <p class="note">Stunden = Richtzeit × Häufigkeit, nie getippt. Weicht der Dienstplan deutlich ab, ist entweder das Leistungsverzeichnis oder der Stammplan nicht aktuell.</p>
    ${areas}<div class="actions">${addBtn('areas', 'Leerer Bereich')}</div>${tplPicker}`
}

function photosTab(d) {
  const areaNames = (d.areas || []).map((a) => a.name).filter(Boolean)
  const list = (d.photos || [])
    .map((p, i) => `<div class="mp-row mp-photo">${photoLink(p.photo, p.title || 'Foto') || '<span class="muted">Foto in SharePoint</span>'}${select(`photos.${i}.kind`, p.kind || 'ablauf', [['ablauf', 'Ablauf'], ['zugang', 'Zugang (vertraulich)']], 'Art')}${input(`photos.${i}.area`, p.area, { placeholder: 'Bereich', list: 'mp-area-names' })}${input(`photos.${i}.title`, p.title, { placeholder: 'Titel (z. B. Reihenfolge Stiegenhaus)' })}${input(`photos.${i}.text`, p.text, { placeholder: 'Beschreibung' })}${rowDel(`photos.${i}`)}</div>`)
    .join('')
  return `<p class="note">Ablauf-Fotos zeigen, wie und wo gereinigt wird (Objektblatt fürs Personal). Zugangsfotos (Eingang, Schlüsselkasten) sind vertraulich: sie erscheinen nur im Abschnitt „Schlüssel und Zugang“, nie in der Kundenfassung. Codes nie fotografieren.</p>
    <datalist id="mp-area-names">${areaNames.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
    ${list || '<p class="note">Noch keine Fotos.</p>'}
    ${editable() ? `<div class="actions"><label class="btn file-btn">${ICON.camera} Kamera<input type="file" accept="image/*" capture="environment" class="visually-hidden" data-change="mp-photo"></label><label class="btn file-btn">${ICON.upload} Galerie<input type="file" accept="image/*" multiple class="visually-hidden" data-change="mp-photo"></label></div>` : ''}`
}

function historyTab(o, d) {
  const saved = M().objects[o.id] || {}
  const list = versions(saved)
  const pending = JSON.stringify(d) !== JSON.stringify(saved) ? diffMappe(saved, d) : []
  const rows = list
    .map((v, i) => {
      const older = list[i + 1]
      const diff = older ? diffMappe(older.data, v.data) : []
      return `<li class="mp-version"><div><strong>Fassung ${v.version}</strong>${v.current ? ' <span class="pill ok">aktuell</span>' : ''} <span class="muted">${esc([stamp(v.at), v.by].filter(Boolean).join(' · '))}</span>${v.reason ? ` – ${esc(v.reason)}` : ''}
        ${!v.current && editable() ? ` <button type="button" class="btn small" data-action="mp-restore" data-i="${i}">Zurückholen</button>` : ''}</div>
        ${older ? (diff.length ? `<ul class="mp-diff">${diff.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">keine inhaltlichen Änderungen</p>') : '<p class="muted">älteste gespeicherte Fassung</p>'}</li>`
    })
    .join('')
  return `${pending.length ? `<div class="banner"><p><strong>Noch nicht gespeichert:</strong></p><ul class="mp-diff">${pending.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <p class="note">Jedes Speichern ergibt eine neue Fassung (die letzten 50 bleiben). Zurückholen lädt den Inhalt von damals als Entwurf; erst mit „Speichern“ wird er zur neuen aktuellen Fassung. Fotos bleiben dabei, wie sie sind.</p>
    ${Object.keys(saved).length ? `<ul class="plain mp-versions">${rows}</ul>` : '<p class="note">Noch nichts gespeichert.</p>'}`
}

function sheetTab(o, d, m) {
  const preset = m.preset || 'mitarbeiter'
  const chosen = m.sections || PRESETS[preset].sections
  const customer = !!PRESETS[preset].customer
  return `<div class="seg">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" class="btn small ${k === preset ? 'primary' : ''}" data-action="mp-preset" data-v="${k}">${esc(p.label)}</button>`).join('')}</div>
    <div class="mp-sections">${SECTIONS.map((s) => {
      const blocked = customer && s.confidential
      return `<label class="field inline ${blocked ? 'muted' : ''}"><input type="checkbox" name="mp-sec" value="${esc(s.id)}" ${chosen.includes(s.id) && !blocked ? 'checked' : ''} ${blocked ? 'disabled' : ''} data-change="mp-sections"><span>${esc(s.label)}${s.confidential ? ' <span class="pill warning">vertraulich</span>' : ''}</span></label>`
    }).join('')}</div>
    ${customer ? '<p class="note">Kundenfassung: vertrauliche Abschnitte (Ansprechpartner, Zugang, Richtzeiten, Kontrolle) werden nie ausgegeben.</p>' : ''}
    <div class="form-grid"><label class="field"><span>Sprache</span><select data-change="mp-lang" aria-label="Sprache des Objektblatts">${options(Object.entries(SHEET_LANGS), m.lang || 'de')}</select></label>
      <label class="field inline"><input type="checkbox" data-change="mp-protect" ${m.protect ? 'checked' : ''}><span>Mit Öffnungscode schützen</span></label></div>
    <p class="note">${(m.lang || 'de') !== 'de' ? 'Überschriften, Tabellen, Häufigkeiten und Wochentage kommen übersetzt; eigene Texte (Hinweise, Leistungen, Methoden) bleiben, wie sie eingetragen sind. ' : ''}${m.protect ? 'Der Code erscheint nach dem Erstellen einmal und wird nirgends gespeichert. Getrennt vom PDF weitergeben (Anruf, SMS), nie in derselben E-Mail.' : 'Für Akten mit Zugang oder Kontakten empfiehlt sich ein Öffnungscode, sobald das PDF das Haus verlässt.'}</p>
    <div class="actions">${canPdf() ? `<button class="btn primary" data-action="mp-pdf" data-id="${esc(o.id)}">${ICON.print} Objektblatt als PDF</button>` : '<p class="note">PDF ist in dieser Fassung ausgeschaltet.</p>'}</div>`
}

function mappeModal(c, m) {
  const o = objOf(m.id)
  if (!o) return ''
  m.draft ||= structuredClone(M().objects[o.id] || {})
  const d = m.draft
  const tab = m.tab || 'objekt'
  const tabs = [['objekt', 'Objekt'], ['personen', 'Kontakte & Zugang'], ['leistungen', 'Leistungen'], ['fotos', `Fotos${d.photos?.length ? ` (${d.photos.length})` : ''}`], ['verlauf', 'Verlauf'], ['blatt', 'Objektblatt']]
  const body = { personen: () => peopleTab(d), leistungen: () => servicesTab(o, d, m), fotos: () => photosTab(d), verlauf: () => historyTab(o, d), blatt: () => sheetTab(o, d, m) }[tab]?.() ?? objectTab(o, d)
  const dirty = JSON.stringify(d) !== JSON.stringify(M().objects[o.id] || {})
  return modalFrame({
    title: o.name,
    subtitle: `Objektmappe${d.customer ? ` · ${esc(d.customer)}` : ''}${d.version ? ` · Fassung ${d.version}` : ''}${d.checkedAt ? ` · ${new Date(d.checkedAt).toLocaleDateString('de-AT')}${d.checkedBy ? ` von ${esc(d.checkedBy)}` : ''}` : ''}`,
    color: o.color,
    wide: true,
    body: `<div class="seg mp-tabs" role="tablist">${tabs.map(([k, label]) => `<button type="button" class="btn small ${k === tab ? 'primary' : ''}" data-action="mp-tab" data-v="${k}" role="tab" aria-selected="${k === tab}">${label}</button>`).join('')}</div>${body}`,
    foot: editable() ? `<button class="btn" data-action="close-modal">${dirty ? 'Verwerfen' : 'Schließen'}</button><div class="actions mp-foot"><input type="text" id="mp-reason" class="mp-reason" value="${esc(m.reason || '')}" placeholder="Anlass der Änderung (optional)" aria-label="Anlass der Änderung" data-change="mp-reason"><button class="btn primary" data-action="mp-save" data-id="${esc(o.id)}" ${dirty ? '' : 'disabled'}>Speichern</button></div>` : '<span></span><button class="btn primary" data-action="close-modal">Schließen</button>',
  })
}

registerModal('mappe', mappeModal, { module: MODULE })

registerActions({
  'mp-open': (el) => openModal({ type: 'mappe', id: el.dataset.id, tab: el.dataset.tab || 'objekt' }),
  'mp-tab': (el) => {
    app.ui.modal.tab = el.dataset.v
    renderModal()
  },
  'mappe-search': (el) => {
    app.ui.mappeSearch = el.value
    renderNow()
    const input = document.getElementById('mappe-search')
    input?.focus()
    input?.setSelectionRange(input.value.length, input.value.length)
  },
  'mp-preset': (el) => {
    app.ui.modal.preset = el.dataset.v
    app.ui.modal.sections = null
    renderModal()
  },
  'mp-sections': () => {
    app.ui.modal.sections = [...document.querySelectorAll('input[name="mp-sec"]:checked')].map((x) => x.value)
  },
  'mp-lang': (el) => {
    app.ui.modal.lang = el.value
    renderModal()
  },
  'mp-protect': (el) => {
    app.ui.modal.protect = el.checked
    renderModal()
  },
  'mp-reason': (el) => {
    app.ui.modal.reason = el.value.trim()
  },
  'mp-pdf': async (el) => {
    const o = objOf(el.dataset.id)
    const m = app.ui.modal
    const preset = m.preset || 'mitarbeiter'
    const sections = sheetSections(preset, m.sections)
    const d = m.draft || M().objects[o.id] || {}
    toast('PDF wird erstellt …')
    // Fotos nur laden, wenn ihr Abschnitt drin ist (Zugangsfotos nur mit „Zugang“)
    const images = {}
    const wanted = (d.photos || []).filter((p) => p.id && (p.kind === 'zugang' ? sections.includes('zugang') : sections.includes('fotos')))
    await Promise.all(wanted.map(async (p) => (images[p.id] = await photoDataUrl(p.photo))))
    let doc = objektblattDocument({ ...sheetData(o, d), images }, { sections, customer: !!PRESETS[preset].customer, lang: m.lang || 'de', brand: app.config.brand, logo: await loadLogo() })
    const code = m.protect ? openCode() : null
    if (code) doc = protectPdf(doc, code)
    const blob = await pdfBlob(doc)
    download(fileSafe(`${PRESETS[preset].customer ? 'Leistungsverzeichnis' : 'Objektblatt'}_${o.short || o.name}_${m.lang && m.lang !== 'de' ? `${m.lang.toUpperCase()}_` : ''}${todayISO()}.pdf`), blob)
    if (code) openModal({ type: 'mp-code', code, back: m })
  },
  'mp-code-copy': async () => {
    try {
      await navigator.clipboard.writeText(app.ui.modal.code)
      toast('Code kopiert. Bitte nicht in dieselbe E-Mail wie das PDF einfügen.')
    } catch {
      toast('Kopieren nicht möglich – bitte abschreiben.')
    }
  },
  'mp-code-back': () => {
    app.ui.modal = app.ui.modal?.back || null
    renderModal()
  },
})

// Öffnungscode: einmal anzeigen, nie speichern
registerModal('mp-code', (c, m) =>
  modalFrame({
    title: 'Öffnungscode für das PDF',
    body: `<p class="open-code" aria-live="polite">${esc(m.code)}</p>
      <p>Das PDF lässt sich nur mit diesem Code öffnen. Drucken geht, Ändern und Kopieren nicht.</p>
      <p class="note">Der Code wird nur jetzt angezeigt und nirgends gespeichert. Getrennt vom PDF weitergeben (Anruf, SMS), nie in derselben E-Mail. Ist er verloren, einfach ein neues PDF erstellen.</p>`,
    foot: '<button class="btn" data-action="mp-code-copy">Kopieren</button><button class="btn primary" data-action="mp-code-back">Zurück zur Mappe</button>',
  }),
)

registerActions(
  {
    'mp-set': (el) => {
      const d = app.ui.modal.draft
      const value = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? '' : Number(String(el.value).replace(',', '.'))) : el.value.trim()
      setPath(d, el.dataset.path, value)
      // Kunde aus dem Kundenstamm: Nummer übernehmen
      if (el.dataset.path === 'customer') {
        const hit = (M().customers || []).find((c) => c.name === value)
        if (hit && !d.customerNo) d.customerNo = hit.nr
        if (hit) renderModal()
      }
      const save = document.querySelector('[data-action="mp-save"]')
      if (save) save.disabled = false
      // Summen aktualisieren (Raumbuch bleibt dabei aufgeklappt)
      const room = el.dataset.path.match(/^areas\.(\d+)\.rooms\./)
      if (room) keepRoomsOpen(Number(room[1]))
      if (/^areas\./.test(el.dataset.path) && /\.(minutes|interval)$/.test(el.dataset.path)) renderModal()
      if (room && /\.size$/.test(el.dataset.path)) renderModal()
    },
    'mp-add': (el) => {
      const d = app.ui.modal.draft
      const key = el.dataset.path.split('.').pop()
      const list = getPath(d, el.dataset.path) || []
      list.push(TEMPLATES[key]())
      setPath(d, el.dataset.path, list)
      const room = el.dataset.path.match(/^areas\.(\d+)\.rooms$/)
      if (room) keepRoomsOpen(Number(room[1]))
      renderModal()
    },
    'mp-day': (el) => {
      const d = app.ui.modal.draft
      const set = new Set(d.serviceDays || [])
      if (el.checked) set.add(el.value)
      else set.delete(el.value)
      d.serviceDays = WEEKDAYS.filter((w) => set.has(w))
      renderModal()
    },
    'mp-from-tpl': () => {
      const m = app.ui.modal
      const name = document.getElementById('mp-tpl')?.value
      const tpl = allTemplates().find((t) => t.name === name)
      if (!tpl) return
      const days = serviceWeekdays(m.draft, app.data.tasks, m.id, todayISO()).length
      const { area, fitted } = areaFromTemplate(tpl, days)
      ;(m.draft.areas ||= []).push(area)
      renderModal()
      toast(`Bereich „${tpl.name}“ mit ${area.services.length} Leistungen übernommen${fitted ? `; ${fitted} Häufigkeiten auf ${days} Einsatztage begrenzt` : ''}. Richtzeiten bitte prüfen.`)
    },
    'mp-as-tpl': (el) => {
      const a = app.ui.modal.draft.areas?.[Number(el.dataset.i)]
      if (!a?.name) return
      const list = (M().templates ||= [])
      const i = list.findIndex((t) => t.name === a.name)
      const tpl = templateFromArea(a, i >= 0 ? list[i].id : `V-${Date.now().toString(36)}`)
      if (i >= 0) list[i] = tpl
      else list.push(tpl)
      persist()
      renderModal()
      toast(`Vorlage „${a.name}“ ${i >= 0 ? 'aktualisiert' : 'gespeichert'}. Sie steht ab jetzt bei allen Objekten zur Auswahl.`)
    },
    'mp-photo': async (el) => {
      const m = app.ui.modal
      const files = [...(el.files || [])]
      if (!files.length) return
      toast('Foto wird gespeichert …')
      try {
        for (const file of files) {
          const id = `F-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
          const photo = await storePhoto(file, `objektmappe/fotos/${objOf(m.id)?.short || m.id}/${id}`)
          ;(m.draft.photos ||= []).push({ id, kind: 'ablauf', area: '', title: '', text: '', date: todayISO(), photo })
        }
        renderModal()
        toast(`${files.length === 1 ? 'Foto' : `${files.length} Fotos`} hinzugefügt. Titel und Art ergänzen, dann speichern.`)
      } catch (err) {
        toast(`Foto konnte nicht gespeichert werden: ${err.message}`)
      }
    },
    'mp-restore': (el) => {
      const m = app.ui.modal
      const v = versions(M().objects[m.id] || {})[Number(el.dataset.i)]
      if (!v) return
      m.draft = restoreVersion(m.draft, v.data)
      m.reason = `Fassung ${v.version} wiederhergestellt`
      renderModal()
      toast(`Fassung ${v.version} als Entwurf geladen. Mit „Speichern“ wird sie zur aktuellen Fassung.`)
    },
    'mp-del': (el) => {
      const d = app.ui.modal.draft
      const parts = el.dataset.path.split('.')
      const idx = Number(parts.pop())
      getPath(d, parts.join('.')).splice(idx, 1)
      renderModal()
    },
    'mp-save': (el) => {
      const m = app.ui.modal
      const d = m.draft
      // leere Zeilen weglassen
      for (const [key, field] of [['contacts', 'name'], ['access', 'label'], ['devices', 'label'], ['attachments', 'name']]) if (d[key]) d[key] = d[key].filter((x) => String(x[field] || '').trim())
      if (d.timeWindows) d.timeWindows = d.timeWindows.filter((w) => w.from || w.to || w.note)
      if (d.areas) d.areas = d.areas.filter((a) => a.name || a.services?.length).map((a) => ({ ...a, services: (a.services || []).filter((s) => s.what), rooms: (a.rooms || []).filter((r) => r.name || r.no) }))
      const reason = (document.getElementById('mp-reason')?.value ?? m.reason ?? '').trim()
      const prev = M().objects[el.dataset.id] || {}
      const next = saveVersion(prev, d, { by: app.user?.name || '', reason })
      M().objects[el.dataset.id] = next
      persist()
      closeModal()
      renderNow()
      toast(next.version !== prev.version ? `Objektmappe gespeichert (Fassung ${next.version}).` : 'Objektmappe gespeichert.')
    },
  },
  { edit: MODULE },
)

function keepRoomsOpen(i) {
  const m = app.ui.modal
  m.openRooms = [...new Set([...(m.openRooms || []), i])]
}

/** Daten fürs Objektblatt aus Dienstplan, Zählern und Kontrollen (nur, was die Rolle lesen darf). */
function sheetData(o, d) {
  const tasks = app.data.tasks.filter((t) => t.objectId === o.id && t.recurrence.type !== 'once').map((t) => ({ ...t, regularNames: (t.regulars || []).map(empName).join(', ') }))
  const meters = (app.data.zaehler?.meters || []).filter((m) => m.objectId === o.id && m.state !== 'abriss').map((m) => ({ location: m.location || meterLabel(m), number: m.number, kind: METER_KINDS[m.kind]?.label || '' }))
  const k = app.data.kontrolle
  const last = (k?.inspections || []).filter((x) => x.objectId === o.id && x.status === 'abgeschlossen').sort((a, b) => b.date.localeCompare(a.date))[0]
  const checklist = k?.checklists?.find((x) => x.id === last?.checklistId) || k?.checklists?.[0]
  const inspection = last ? { date: last.date, overall: last.summary?.overall || suggestOverall(last.items), defects: openDefects(k.inspections, { objectId: o.id }).filter((x) => DEFECTS.includes(x.rating)).map((x) => ({ id: x.itemId, rating: x.rating, text: itemText(k.checklists?.find((c) => c.id === x.checklistId) || checklist, x.itemId), note: x.note })) } : null
  return {
    object: o,
    mappe: d,
    tasks,
    keys: (o.keys || []).map((key) => ({ label: key.label, holder: key.holderId ? empName(key.holderId) : null })),
    waste: o.waste?.streams?.length ? wasteSummary(o, todayISO(), app.cur?.holidays) : '',
    meters,
    inspection,
    plannedMinutes: compareHours(d, app.data.tasks, o.id, todayISO()).plan,
  }
}

// ---------------------------------------------------------------- Kundenstamm

registerModal('mp-customers', (c, m) => {
  const list = M().customers || []
  const preview = m.text ? importCustomers(m.text) : null
  return modalFrame({
    title: 'Kundenstamm',
    subtitle: `${list.length} Kunden`,
    wide: true,
    body: `<p class="note">Am einfachsten direkt aus SharePoint: <button class="link-btn" data-action="legacy-open">Aus den bisherigen Werkzeugen übernehmen</button> liest Stammdaten/Kunden.json. Oder hier Kunden.json oder eine Excel-Liste mit Kundennummer, Name, Straße, Ort und E-Mail. Damit sind Kunde, Nummer und E-Mail in der Objektmappe und beim Versand der Kontrollen auswählbar.</p>
      <input type="file" accept=".json,.csv,.txt,application/json,text/csv" data-change="mp-customers-file">
      <textarea id="mp-cust-text" rows="5" placeholder="Kundennummer&#9;Name&#9;Straße&#9;Ort&#9;E-Mail" data-input="mp-customers-text">${esc(m.text || '')}</textarea>
      ${preview ? `<p><strong>${preview.length} Kunden erkannt.</strong> ${preview.slice(0, 3).map((x) => esc(`${x.nr} ${x.name}`)).join(', ')}${preview.length > 3 ? ' …' : ''}</p>` : ''}
      ${list.length ? `<details><summary>Vorhandene Kunden anzeigen</summary><div class="table-wrap"><table class="data"><thead><tr><th>Nr.</th><th>Name</th><th>Adresse</th><th>E-Mail</th></tr></thead><tbody>${list.slice(0, 200).map((x) => `<tr><td>${esc(x.nr)}</td><td>${esc(x.name)}</td><td>${esc([x.street, x.city].filter(Boolean).join(', '))}</td><td>${esc(x.email)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}`,
    foot: `<button class="btn" data-action="close-modal">Schließen</button><div class="actions"><button class="btn primary" data-action="mp-customers-apply" ${preview?.length ? '' : 'disabled'}>Übernehmen (ersetzt den Kundenstamm)</button></div>`,
  })
})

registerActions({
  'mp-customers-text': (el) => {
    app.ui.modal.text = el.value
    renderModal()
    const t = document.getElementById('mp-cust-text')
    t?.focus()
    t?.setSelectionRange(t.value.length, t.value.length)
  },
  'mp-customers-file': async (el) => {
    const file = el.files?.[0]
    if (!file) return
    app.ui.modal.text = await file.text()
    renderModal()
  },
})

registerActions(
  {
    'mp-customers-open': () => openModal({ type: 'mp-customers', text: '' }),
    'mp-customers-apply': () => {
      const list = importCustomers(app.ui.modal.text || '')
      M().customers = list
      persist()
      closeModal()
      renderNow()
      toast(`${list.length} Kunden übernommen.`)
    },
  },
  { edit: MODULE },
)

