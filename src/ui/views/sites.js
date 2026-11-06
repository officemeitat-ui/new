// Objekte & Leistungen (Stammplan), Objektinfo, Schlüssel, Budget.
// Objektanweisungen mit Übersetzungen für den „Plan am Handy“ (instructionsI18n, core/sprachen.js): von Hand
// oder „Mit KI übersetzen“ (nur, wenn der KI-Assistent eingerichtet ist; Vorschlag, gespeichert erst mit
// dem Objekt). Ändert sich der deutsche Text, gelten die Übersetzungen als veraltet.

import { addDays, formatDate, formatHours, mondayOf, todayISO, WEEKDAY_LONG, WEEKDAY_SHORT } from '../../core/dates.js'
import { holidayCalendar } from '../../core/holidays.js'
import { DEFAULT_HOLIDAY_RULE, HOLIDAY_RULES, NTH_LABEL } from '../../core/plan.js'
import { coordsText, parseCoords } from '../../core/geo.js'
import { wasteSummary } from '../../core/waste.js'
import { objectKeys } from '../../core/keys.js'
import { FOREIGN_LANGUAGES, langInfo, staleLanguages, translationRows, updateTranslations } from '../../core/sprachen.js'
import { locationFor } from '../../core/weather.js'
import { app, closeModal, empName, onModalRender, openModal, persist, registerActions, registerModal, registerView, renderModal, renderModalKeepingInput, renderNow, toast } from '../context.js'
import { CATEGORY_LABEL, checkboxes, checked, checkedValues, COLOR_NAMES, esc, ICON, modalFrame, num, options, rhythmText, uid, val } from '../shared.js'
import { geocode } from '../geocode.js'
import { readWaste, wasteSection } from '../waste-form.js'
import { weatherEnabled, weatherLocations, weatherRules } from '../weather.js'
import { regionFilter } from './objects.js'

function sitesView() {
  const region = app.ui.region
  const today = todayISO()
  const holidays = holidayCalendar(today, addDays(today, 70), app.data.extraFreeDays)
  const cards = app.data.objects
    .filter((o) => !region || o.region === region)
    .map((obj) => {
      const tasks = app.data.tasks.filter((t) => t.objectId === obj.id)
      const rows = tasks
        .map(
          (t) => `<tr>
          <td><strong>${esc(t.label)}</strong>${t.category === 'sonder' ? ' <span class="tag special">Sonderleistung</span>' : ''}${t.outdoor ? ' <span class="tag">im Freien</span>' : ''}</td>
          <td>${esc(rhythmText(t))}</td><td class="num">${esc(t.start)}–${esc(t.end)}${Number.isFinite(t.travelAfterMin) || t.travelNote ? `<br><span class="muted">Fahrt danach ${Number.isFinite(t.travelAfterMin) ? `${t.travelAfterMin} min` : 'automatisch'}${t.travelNote ? `: ${esc(t.travelNote)}` : ''}</span>` : ''}</td><td class="num">${t.staff}</td>
          <td>${t.regulars.map((id) => esc(empName(id))).join(', ') || '<span class="muted">–</span>'}</td>
          <td>${esc(HOLIDAY_RULES[t.holidayRule || DEFAULT_HOLIDAY_RULE])}</td>
          <td>${(t.skills || []).map((s) => `<span class="tag">${esc(s)}</span>`).join(' ') || '<span class="muted">–</span>'}</td>
          <td class="edit-only"><button class="btn small" data-action="task-edit" data-id="${esc(t.id)}">Bearbeiten</button></td></tr>`,
        )
        .join('')
      const keys = bookKeys(obj.id) || obj.keys || []
      return `<article class="object-card" style="--obj:var(--o${obj.color})">
        <header><h3>${esc(obj.name)}</h3><span class="addr">${esc([obj.address, obj.region].filter(Boolean).join(' · '))}${obj.onlyTrained ? ' · nur eingeschultes Personal' : ''}${obj.budgetHoursMonth ? ` · Budget ${formatHours(obj.budgetHoursMonth * 60)} h/Monat` : ''}</span>
          <span class="edit-only"><button class="btn small" data-action="task-edit" data-id="new" data-obj="${esc(obj.id)}">${ICON.plus} Leistung</button>
          <button class="btn small" data-action="obj-edit" data-id="${esc(obj.id)}">Objekt bearbeiten</button></span></header>
        ${obj.waste?.streams?.length ? `<div class="folder-line waste-line">${ICON.trash}<span>${esc(wasteSummary(obj, today, holidays))}</span></div>` : ''}
        ${obj.winter?.active && weatherEnabled() ? `<div class="folder-line">${ICON.snow}<span>${esc(winterSummary(obj))}</span></div>` : ''}
        ${obj.instructions || keys.length ? `<div class="folder-line">${obj.instructions ? `<span>${esc(obj.instructions)}</span>${translationTag(obj)}` : ''}${keys.length ? `<span class="keys">${ICON.key} ${keys.map((k) => `${esc(k.label)}: ${k.holderId ? esc(empName(k.holderId)) : 'Büro'}`).join(' · ')}</span>` : ''}</div>` : ''}
        ${tasks.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Leistung</th><th>Rhythmus</th><th>Zeit</th><th>Pers.</th><th>Stammkraft</th><th>An Feiertagen</th><th>Qualifikation</th><th class="edit-only"></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="note" style="padding:10px 14px;margin:0">Noch keine Leistungen.</p>'}
      </article>`
    })
    .join('')
  return `<div class="section-head"><div><h2>Objekte & Leistungen <span class="muted">(${app.data.objects.length} Objekte, ${app.data.tasks.length} Leistungen)</span></h2><p>Der Stammplan: welche Leistung in welchem Rhythmus, zu welcher Zeit, mit wem als Stammkraft, und was an Feiertagen passiert. Dazu Objektinfo, Schlüssel und Budget.</p></div>
    <div class="actions edit-only"><button class="btn" data-action="import-open" data-kind="tasks">${ICON.upload} Aus Excel einfügen</button><button class="btn primary" data-action="obj-edit" data-id="new">${ICON.plus} Objekt anlegen</button></div></div>
    ${regionFilter()}
    <div class="objects">${cards}</div>`
}

/** Stand der Übersetzungen auf der Objektkarte: veraltet (Warnung) oder wie viele Sprachen. */
function translationTag(obj) {
  const stale = staleLanguages(obj)
  if (stale.length) return ` <span class="tag warn-tag" title="Deutscher Text geändert: am Handy steht zusätzlich der deutsche Text">Übersetzung veraltet: ${esc(stale.map((id) => langInfo(id).own).join(', '))}</span>`
  const n = translationRows(obj).filter((r) => r.text).length
  return n ? ` <span class="tag">übersetzt: ${n} ${n === 1 ? 'Sprache' : 'Sprachen'}</span>` : ''
}

const sprStatus = (r) => (r.stale ? '<span class="pill warning">veraltet</span>' : r.text ? `<span class="pill ok">${r.ki ? 'mit KI, freigegeben' : 'aktuell'}</span>` : '<span class="pill na">fehlt</span>')

/** Übersetzungen der Anweisung für den Plan am Handy: je Sprache ein Feld mit Stand, „Passt noch“, KI-Vorschlag. */
function translationSection(o) {
  const rows = translationRows(o)
  const fresh = rows.filter((r) => r.text && !r.stale).length
  const stale = rows.filter((r) => r.stale).length
  return `<details class="spr-box"${stale ? ' open' : ''}><summary>Übersetzungen für Mitarbeitende <span class="muted">(${fresh} von ${rows.length} aktuell${stale ? `, ${stale} veraltet` : ''})</span></summary>
    <p class="note">Im „Plan am Handy“ sieht jede Person die Anweisung in ihrer Sprache (Mitarbeitende → Bearbeiten → Sprache am Handy). Ändert sich der deutsche Text, gilt eine Übersetzung als veraltet: Am Handy steht dann zusätzlich der deutsche Text. „Passt noch“, wenn die Änderung die Übersetzung nicht betrifft.</p>
    <div class="form-grid">${rows
      .map(
        (r) => `<div class="field wide"><label for="spr-${r.id}">${esc(r.label)} (<span lang="${esc(r.html)}">${esc(r.own)}</span>) <span id="spr-st-${r.id}">${sprStatus(r)}</span></label>
      <textarea id="spr-${r.id}" rows="2" lang="${esc(r.html)}" style="font-family:inherit;font-size:inherit">${esc(r.text)}</textarea>
      ${r.stale ? `<span><button class="btn small" data-action="spr-passt" data-lang="${r.id}" title="Die Änderung am deutschen Text betrifft diese Übersetzung nicht">Passt noch</button></span>` : ''}${r.at ? `<small class="muted">${r.ki ? 'mit KI übersetzt, ' : ''}gespeichert am ${esc(formatDate(r.at.slice(0, 10)))}${r.by ? ` von ${esc(r.by)}` : ''}</small>` : ''}</div>`,
      )
      .join('')}</div>
    <p class="spr-ki-line" hidden><button class="btn small" id="spr-ki" data-action="spr-ki">Mit KI übersetzen</button> <span class="muted">schickt nur den deutschen Text an den KI-Dienst; das Ergebnis ist ein Vorschlag zum Prüfen</span></p>
    <div id="spr-vorschau"></div>
  </details>`
}

// „Mit KI übersetzen“ nur, wenn der KI-Assistent eingerichtet ist (ki.php meldet „aktiv“); einmal je Sitzung gefragt
const kiCheck = { ok: null, at: 0 }
onModalRender(($modal) => {
  const line = $modal.querySelector('.spr-ki-line')
  if (!line || app.config?.assistant === false) return
  const show = () => kiCheck.ok && line.removeAttribute('hidden')
  if (kiCheck.ok !== null || Date.now() - kiCheck.at < 300e3) return show()
  kiCheck.at = Date.now()
  import('../../ai/translate.js')
    .then((m) => m.kiReady())
    .then((ok) => {
      kiCheck.ok = ok || null
      if (ok && document.body.contains(line)) show()
    })
})

/** Vorschlag der KI zur Prüfung: je Sprache Text und Haken (übernehmen); nichts ist gespeichert. */
function proposalHtml(texts) {
  const items = FOREIGN_LANGUAGES.filter((l) => texts[l.id])
    .map((l) => {
      const field = document.getElementById(`spr-${l.id}`)
      const keep = field?.value.trim() && !document.getElementById(`spr-st-${l.id}`)?.textContent.includes('veraltet')
      return `<li><label class="check"><input type="checkbox" id="spr-v-${l.id}" ${keep ? '' : 'checked'}><span><strong>${esc(l.label)}</strong>: <span lang="${esc(l.html)}" id="spr-vt-${l.id}">${esc(texts[l.id])}</span></span></label></li>`
    })
    .join('')
  return `<div class="banner warn-banner spr-vorschlag"><p><strong>Vorschlag der KI – bitte lesen.</strong> Übernommen wird nur, was angehakt ist; gespeichert erst mit „Speichern“. Vorhandene aktuelle Übersetzungen sind nicht angehakt.</p>
    <ul style="margin:0;padding-left:0;list-style:none;flex:1 1 100%">${items}</ul>
    <div class="actions"><button class="btn small" data-action="spr-ki-weg">Verwerfen</button><button class="btn small primary" data-action="spr-ki-ok">Übernehmen</button></div></div>`
}

/** Schlüssel des Objekts aus dem Schlüsselbuch (null, wenn das Objekt dort nicht geführt wird oder das Modul fehlt). */
function bookKeys(objectId) {
  const book = app.data.schluessel?.keys || []
  if (!objectId || !book.some((k) => k.objectId === objectId)) return null
  return objectKeys(book, objectId)
}

function objectModal(c, { id }) {
  const o = id === 'new' ? { id: 'new', name: '', short: '', address: '', region: app.ui.region || '', color: (app.data.objects.length % 12) + 1, onlyTrained: false, keys: [] } : app.data.objects.find((x) => x.id === id)
  if (!o) return null
  const regions = [...new Set(app.data.objects.map((x) => x.region).filter(Boolean))]
  const keys = app.ui.modal.keys ?? o.keys ?? []
  const empOptions = app.data.employees.map((e) => [e.id, e.name])
  const confirmDel = app.ui.confirm === 'obj-delete'
  return modalFrame({
    title: id === 'new' ? 'Objekt anlegen' : o.name,
    color: o.color,
    body: `<div class="form-grid">
        <label class="field wide"><span>Name</span><input type="text" id="obj-name" value="${esc(o.name)}" required></label>
        <label class="field"><span>Kurzname (für den Plan)</span><input type="text" id="obj-short" value="${esc(o.short)}"></label>
        <label class="field"><span>Adresse</span><input type="text" id="obj-address" value="${esc(o.address)}"></label>
        <label class="field"><span>Koordinaten (Breite, Länge) für die Fahrzeit</span><span class="input-btn"><input type="text" id="obj-coords" value="${esc(coordsText(o))}" placeholder="z. B. 47.80950, 13.05500"><button class="btn small" data-action="obj-geocode" title="Über OpenStreetMap aus der Adresse suchen">Suchen</button></span></label>
        <label class="field"><span>Revier</span><input type="text" id="obj-region" list="region-list" value="${esc(o.region || '')}"><datalist id="region-list">${regions.map((r) => `<option value="${esc(r)}">`).join('')}</datalist></label>
        <label class="field"><span>Farbe</span><select id="obj-color">${COLOR_NAMES.map((n, i) => `<option value="${i + 1}" ${o.color === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span>Budget (Sollstunden/Monat)</span><input type="number" id="obj-budget" min="0" step="1" value="${esc(o.budgetHoursMonth ?? '')}" placeholder="laut Kalkulation"></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="obj-trained" ${o.onlyTrained ? 'checked' : ''}><span>Nur eingeschultes Personal (Schlüssel, Alarm, Hygiene)</span></label>
        <label class="field wide"><span>Sonntagsarbeit erlaubt aufgrund (Ausnahme von der Wochenendruhe)</span><input type="text" id="obj-sundaybasis" value="${esc(o.sundayBasis || '')}" placeholder="z. B. ARG-VO, Krankenanstalt · Betriebsvereinbarung vom … · leer = wie unter „Regeln“"></label>
      </div>
      <section><h3>Objektinfo</h3><div class="form-grid">
        <label class="field wide"><span>Anweisungen für das Personal (erscheint im Einsatz, für Vertretungen und im Plan am Handy)</span><textarea id="obj-instructions" rows="3" style="font-family:inherit;font-size:inherit">${esc(o.instructions || '')}</textarea></label>
        <div class="wide">${translationSection(o)}</div>
        <label class="field wide"><span>Ansprechperson beim Kunden</span><input type="text" id="obj-contact" value="${esc(o.contact || '')}"></label>
        <label class="field wide"><span>E-Mail für den Leistungsnachweis</span><input type="email" id="obj-proofemail" value="${esc(o.proofEmail || '')}" placeholder="z. B. hausverwaltung@beispiel.at"></label>
      </div><p class="note">Keine Alarmcodes oder Passwörter eintragen: diese Daten liegen für alle Disponent:innen lesbar in SharePoint und die Anweisungen am Handy der Mitarbeitenden.</p></section>
      ${bookKeys(o.id)
        ? `<section><h3>Schlüssel</h3><p>${bookKeys(o.id).map((k) => `${esc(k.label)}${k.no ? ` (${esc(k.no)})` : ''}: <strong>${k.holderId ? esc(empName(k.holderId)) : 'im Büro'}</strong>`).join(' · ') || 'keine aktiven Schlüssel'}</p>
        <p class="note">Die Schlüssel dieses Objekts stehen im Schlüsselbuch (Ausgabe, Rückgabe, Quittung). <button class="btn small" data-action="keys-open-object" data-obj="${esc(o.id)}">Im Schlüsselbuch öffnen</button></p></section>`
        : `<section><h3>Schlüssel</h3>
        ${keys.map((k, i) => `<div class="inline-row"><input type="text" id="key-label-${i}" value="${esc(k.label)}" aria-label="Schlüssel"><select id="key-holder-${i}" aria-label="Bei">${options(empOptions, k.holderId, { empty: 'im Büro' })}</select><button class="btn small danger" data-action="key-remove" data-idx="${i}">Entfernen</button></div>`).join('')}
        <button class="btn small" data-action="key-add">${ICON.plus} Schlüssel</button>
        <p class="note">Ist ein Schlüssel hinterlegt, markiert der Plan jede Vertretung ohne Schlüssel mit „Schlüsselübergabe nötig“.</p></section>`}
      ${wasteSection(o)}
      ${weatherEnabled() ? winterSection(o) : ''}`,
    foot: `${id === 'new' ? '<span></span>' : `<button class="btn ${confirmDel ? 'danger confirm' : 'danger'}" data-action="obj-delete" data-id="${esc(o.id)}">${confirmDel ? 'Objekt samt Leistungen löschen?' : 'Löschen'}</button>`}
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="obj-save" data-id="${esc(o.id)}">Speichern</button></div>`,
  })
}

/** Winterdienst je Objekt: räumen und streuen (§ 93 StVO), angelegt in „Wetter & Winterdienst“. */
function winterSection(o) {
  const w = o.winter || {}
  const cfg = weatherRules()
  const team = w.team || []
  const people = app.data.employees.filter((e) => (!e.exitDate || e.exitDate >= todayISO() || team.includes(e.id)) && (!o.region || !e.team || e.team === o.region || team.includes(e.id)))
  return `<section class="obj-winter"><h3>${ICON.snow} Winterdienst</h3>
    <label class="check"><input type="checkbox" id="win-active" ${w.active ? 'checked' : ''}><span>Dieses Objekt räumen und streuen (Gehsteig, Zugang, Parkplatz)</span></label>
    <div class="form-grid">
      <label class="field"><span>Ort (Wetter, Schnee-Alarm)</span><select id="obj-weatherplace">${options([['', `wie Revier (${locationFor({ region: o.region }, weatherLocations())?.name || '–'})`], ...weatherLocations().map((l) => [l.name, l.name])], o.weatherPlace || '')}</select></label>
      <label class="field"><span>Fertig bis</span><input type="time" id="win-until" value="${esc(w.until || '')}" placeholder="${esc(cfg.winterUntil)}"><small class="muted">leer = ${esc(cfg.winterUntil)} Uhr (Regeln)</small></label>
      <label class="field"><span>Dauer (min)</span><input type="number" id="win-minutes" min="5" step="5" value="${esc(w.minutes ?? '')}" placeholder="${esc(cfg.winterMinutes)}"></label>
      <label class="field"><span>Personen</span><input type="number" id="win-staff" min="1" step="1" value="${esc(w.staff ?? 1)}"></label>
      <label class="field wide"><span>Hinweis (Flächen, Streugut, Schneeräumer)</span><input type="text" id="win-note" value="${esc(w.note || '')}" placeholder="z. B. Streusplitt im Keller, Gehsteig 40 m, Stiege zum Eingang"></label>
    </div>
    <p class="note">Winterdienst-Team (wird beim Anlegen eingeteilt, in dieser Reihenfolge nach Personen):</p>
    <div class="form-grid">${people.map((e) => `<label class="check"><input type="checkbox" name="win-team" id="win-team-${esc(e.id)}" value="${esc(e.id)}" ${team.includes(e.id) ? 'checked' : ''}><span>${esc(e.name)}</span></label>`).join('') || '<p class="muted">Noch keine Mitarbeitenden.</p>'}</div>
    <p class="note">Bei Schnee oder Glätte zeigt „Wetter & Winterdienst“ die Objekte an; ein Klick legt die Einsätze an. § 93 StVO: Gehsteige von 6 bis 22 Uhr geräumt und bei Glätte gestreut; wer den Winterdienst vertraglich übernimmt, tritt an die Stelle des Eigentümers (Abs. 5).</p>
  </section>`
}

function winterSummary(o) {
  const w = o.winter
  const cfg = weatherRules()
  const team = (w.team || []).map(empName).filter(Boolean)
  return `Winterdienst fertig bis ${w.until || cfg.winterUntil} Uhr · ${w.minutes || cfg.winterMinutes} min · ${w.staff || 1} P. · Team: ${team.length ? team.join(', ') : 'keins (beim Anlegen offen)'}`
}

function readWinter(existing) {
  if (!document.getElementById('win-active')) return existing?.winter // Wetter-Modul aus: unverändert lassen
  const active = checked('win-active')
  const team = checkedValues('win-team')
  const until = val('win-until')
  const w = {
    active,
    until: /^\d{2}:\d{2}$/.test(until) ? until : undefined,
    minutes: num('win-minutes') > 0 ? Math.round(num('win-minutes')) : undefined,
    staff: Math.max(1, Math.round(num('win-staff') || 1)),
    team,
    note: val('win-note').trim() || undefined,
  }
  for (const k of Object.keys(w)) if (w[k] === undefined) delete w[k]
  // ganz ohne Angaben: nichts speichern (alte Objekte bleiben unverändert)
  if (!active && !team.length && !w.note && !w.until && !w.minutes && !existing?.winter) return undefined
  return w
}

function readKeys() {
  const keys = []
  for (let i = 0; document.getElementById(`key-label-${i}`); i++) {
    const label = val(`key-label-${i}`).trim()
    if (label) keys.push({ id: `k${i}${Date.now().toString(36)}`, label, holderId: val(`key-holder-${i}`) })
  }
  return keys
}

function taskModal(c, { id, objectId }) {
  const t =
    id === 'new'
      ? { id: 'new', objectId: objectId || app.data.objects[0]?.id, label: '', category: 'reinigung', recurrence: { type: 'weekly', weekdays: [1, 2, 3, 4, 5], everyWeeks: 1, anchor: c.monday }, start: '18:00', end: '20:00', staff: 1, regulars: [], skills: [], holidayRule: DEFAULT_HOLIDAY_RULE, breakMin: 0 }
      : app.data.tasks.find((x) => x.id === id)
  if (!t) return null
  const r = t.recurrence
  const type = r.type
  const monthly = type === 'monthly' ? r : { mode: 'nth', nth: 1, weekday: r.weekdays?.[0] || 1, day: 1, everyMonths: 1, anchor: `${c.monday.slice(0, 7)}-01` }
  const obj = app.data.objects.find((o) => o.id === t.objectId)
  const confirmDel = app.ui.confirm === 'task-delete'
  return modalFrame({
    title: id === 'new' ? 'Leistung anlegen' : t.label,
    subtitle: esc(obj?.name || ''),
    color: obj?.color,
    body: `<div class="form-grid">
        <label class="field"><span>Objekt</span><select id="task-object">${options(app.data.objects.map((o) => [o.id, o.name]), t.objectId)}</select></label>
        <label class="field"><span>Bezeichnung</span><input type="text" id="task-label" value="${esc(t.label)}" placeholder="z. B. Büroreinigung"></label>
        <label class="field"><span>Art</span><select id="task-category">${options(Object.entries(CATEGORY_LABEL), t.category)}</select></label>
        <label class="field"><span>Rhythmus</span><select id="task-type" data-toggle="rhythm">${options([['weekly', 'wöchentlich / 14-tägig'], ['monthly', 'monatlich / quartalsweise'], ['once', 'einmalig']], type)}</select></label>
      </div>
      <div class="form-grid" data-rhythm="weekly" ${type === 'weekly' ? '' : 'hidden'}>
        <div class="field wide"><span>Wochentage</span><div class="weekday-picker">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label><input type="checkbox" name="task-wd" value="${d}" ${type === 'weekly' && r.weekdays.includes(d) ? 'checked' : ''}>${WEEKDAY_SHORT[d - 1]}</label>`).join('')}</div></div>
        <label class="field"><span>Intervall</span><select id="task-every">${options([[1, 'jede Woche'], [2, 'alle 2 Wochen (14-tägig)'], [3, 'alle 3 Wochen'], [4, 'alle 4 Wochen']], r.everyWeeks || 1)}</select></label>
        <label class="field"><span>Erstmals in der Woche vom</span><input type="date" id="task-anchor" value="${esc(r.anchor || c.monday)}"></label>
        <label class="field"><span>Gültig bis (optional)</span><input type="date" id="task-until" value="${esc(r.until || '')}"></label>
      </div>
      <div class="form-grid" data-rhythm="monthly" ${type === 'monthly' ? '' : 'hidden'}>
        <label class="field"><span>Intervall</span><select id="task-months">${options([[1, 'monatlich'], [2, 'alle 2 Monate'], [3, 'quartalsweise'], [6, 'halbjährlich'], [12, 'jährlich']], monthly.everyMonths || 1)}</select></label>
        <label class="field"><span>Termin</span><select id="task-mmode" data-toggle="mmode">${options([['nth', 'Wochentag im Monat'], ['day', 'fixer Tag im Monat']], monthly.mode)}</select></label>
        <label class="field" data-mmode="nth" ${monthly.mode === 'day' ? 'hidden' : ''}><span>Welcher</span><select id="task-nth">${options(Object.entries(NTH_LABEL).sort((a, b) => (a[0] === '-1') - (b[0] === '-1') || a[0] - b[0]), monthly.nth)}</select></label>
        <label class="field" data-mmode="nth" ${monthly.mode === 'day' ? 'hidden' : ''}><span>Wochentag</span><select id="task-mweekday">${options(WEEKDAY_LONG.map((n, i) => [i + 1, n]), monthly.weekday)}</select></label>
        <label class="field" data-mmode="day" ${monthly.mode === 'day' ? '' : 'hidden'}><span>Tag im Monat</span><input type="number" id="task-mday" min="1" max="31" step="1" value="${esc(monthly.day || 1)}"><small class="muted">31 = immer Monatsletzter</small></label>
        <label class="field"><span>Erstmals im Monat</span><input type="month" id="task-manchor" value="${esc((monthly.anchor || c.monday).slice(0, 7))}"></label>
        <label class="field"><span>Gültig bis (optional)</span><input type="date" id="task-muntil" value="${esc(type === 'monthly' ? r.until || '' : '')}"></label>
      </div>
      <div class="form-grid" data-rhythm="once" ${type === 'once' ? '' : 'hidden'}>
        <label class="field"><span>Datum</span><input type="date" id="task-date" value="${esc(type === 'once' ? r.date : c.monday)}"></label>
      </div>
      <div class="form-grid">
        <label class="field"><span>Beginn</span><input type="time" id="task-start" value="${esc(t.start)}"></label>
        <label class="field"><span>Ende</span><input type="time" id="task-end" value="${esc(t.end)}"></label>
        <label class="field"><span>Personen</span><input type="number" id="task-staff" min="1" step="1" value="${esc(t.staff)}"></label>
        <label class="field"><span>An Feiertagen</span><select id="task-holiday">${options(Object.entries(HOLIDAY_RULES), t.holidayRule || DEFAULT_HOLIDAY_RULE)}</select></label>
        <label class="field"><span>Fahrzeit danach (min)</span><input type="number" id="task-travel" min="0" step="5" value="${Number.isFinite(t.travelAfterMin) ? t.travelAfterMin : ''}" placeholder="automatisch"></label>
        <label class="field wide"><span>Fahrtnotiz (Standard, je Woche änderbar)</span><input type="text" id="task-travel-note" value="${esc(t.travelNote || '')}" placeholder="z. B. Firmenauto zurück ins Lager"></label>
        <label class="check wide"><input type="checkbox" id="task-outdoor" ${t.outdoor ? 'checked' : ''}><span>Arbeit im Freien (Außenanlage, Fassade, Glas außen): Hinweise bei Hitze und Sturm</span></label>
      </div>
      <section><h3>Stammkraft</h3><div class="form-grid">${checkboxes('task-reg', app.data.employees.filter((e) => !obj?.region || !e.team || e.team === obj.region || t.regulars.includes(e.id)).map((e) => [e.id, e.name]), t.regulars || [])}</div><p class="note">Angezeigt werden Personen aus dem Revier des Objekts.</p></section>
      <section><h3>Benötigte Qualifikation</h3><div class="form-grid">${checkboxes('task-skill', (app.data.skills || []).map((s) => [s, s]), t.skills || [])}</div></section>`,
    foot: `${id === 'new' ? '<span></span>' : `<button class="btn ${confirmDel ? 'danger confirm' : 'danger'}" data-action="task-delete" data-id="${esc(t.id)}">${confirmDel ? 'Wirklich löschen?' : 'Löschen'}</button>`}
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn primary" data-action="task-save" data-id="${esc(t.id)}">Speichern</button></div>`,
  })
}

function readRecurrence() {
  const type = val('task-type')
  if (type === 'once') return { type: 'once', date: val('task-date') }
  if (type === 'monthly') {
    const mode = val('task-mmode')
    return {
      type: 'monthly',
      mode,
      ...(mode === 'day' ? { day: Math.min(31, Math.max(1, Math.round(num('task-mday') || 1))) } : { nth: Number(val('task-nth')) || 1, weekday: Number(val('task-mweekday')) || 1 }),
      everyMonths: Number(val('task-months')) || 1,
      anchor: `${val('task-manchor') || app.cur.monday.slice(0, 7)}-01`,
      ...(val('task-muntil') ? { until: val('task-muntil') } : {}),
    }
  }
  return { type: 'weekly', weekdays: checkedValues('task-wd').map(Number), everyWeeks: Number(val('task-every')) || 1, anchor: val('task-anchor') || app.cur.monday, ...(val('task-until') ? { until: val('task-until') } : {}) }
}

/**
 * „Erstmals in der Woche vom … / im Monat …“ in der Zukunft gilt auch als Beginn
 * (vorher nur als Takt: der Einsatz erschien schon in früheren Wochen).
 * Ein Anker in der Vergangenheit bleibt reiner Takt, damit veröffentlichte Wochen unverändert bleiben.
 */
function withStart(recurrence, old) {
  if (recurrence.type === 'once' || !recurrence.anchor) return recurrence
  const start = recurrence.type === 'monthly' ? recurrence.anchor : mondayOf(recurrence.anchor)
  const now = recurrence.type === 'monthly' ? `${todayISO().slice(0, 7)}-01` : mondayOf(todayISO())
  if (old && old.anchor === recurrence.anchor) return old.from ? { ...recurrence, from: old.from } : recurrence
  return start > now ? { ...recurrence, from: start } : recurrence
}

function readTaskForm(existing) {
  const recurrence = withStart(readRecurrence(), existing?.recurrence)
  return {
    ...existing,
    objectId: val('task-object'),
    label: val('task-label').trim(),
    category: val('task-category'),
    recurrence,
    start: val('task-start'),
    end: val('task-end'),
    staff: Math.max(1, Math.round(num('task-staff') || 1)),
    holidayRule: val('task-holiday'),
    travelAfterMin: val('task-travel').trim() === '' ? undefined : Math.max(0, Math.round(num('task-travel') ?? 0)),
    travelNote: val('task-travel-note').trim() || undefined,
    regulars: checkedValues('task-reg'),
    skills: checkedValues('task-skill'),
    outdoor: checked('task-outdoor') || undefined,
  }
}

function removeTaskEverywhere(id) {
  const { data } = app
  data.tasks = data.tasks.filter((t) => t.id !== id)
  for (const key of Object.keys(data.assignments)) if (key.endsWith(`|${id}`)) delete data.assignments[key]
  for (const key of Object.keys(data.overrides)) if (key.endsWith(`|${id}`)) delete data.overrides[key]
}

registerView({ id: 'sites', order: 90, label: 'Objekte & Leistungen', group: 'stamm', render: sitesView })
registerModal('object', objectModal, { module: 'stammdaten' })
registerModal('task', taskModal, { module: 'stammdaten' })

registerActions(
  {
    'obj-edit': (el) => {
      openModal({ type: 'object', id: el.dataset.id })
      if (el.dataset.focus) document.querySelector(`#modal-root .${el.dataset.focus}`)?.scrollIntoView({ block: 'start' })
    },
    'key-add': () => {
      app.ui.modal.keys = [...readKeys(), { label: 'Haupteingang', holderId: '' }]
      app.ui.modal.waste = readWaste()
      renderModalKeepingInput(/^key-|^wsr-/)
    },
    'key-remove': (el) => {
      const keys = readKeys()
      keys.splice(Number(el.dataset.idx), 1)
      app.ui.modal.keys = keys
      app.ui.modal.waste = readWaste()
      renderModalKeepingInput(/^key-|^wsr-/)
    },
    'obj-geocode': async (el) => {
      const address = val('obj-address').trim()
      if (!address) return toast('Bitte zuerst die Adresse eintragen.')
      el.disabled = true
      try {
        const hit = await geocode(address)
        if (!hit) return toast('Adresse bei OpenStreetMap nicht gefunden. Koordinaten von Hand eintragen (z. B. aus Google Maps: Rechtsklick auf den Ort).')
        document.getElementById('obj-coords').value = `${hit.lat.toFixed(5)}, ${hit.lon.toFixed(5)}`
        toast(`Gefunden: ${hit.label}`)
      } catch (err) {
        toast(`Suche nicht möglich: ${err.message}`)
      } finally {
        el.disabled = false
      }
    },
    'obj-save': (el) => {
      const id = el.dataset.id
      const existing = id === 'new' ? { id: uid('o') } : app.data.objects.find((o) => o.id === id)
      const obj = {
        ...existing,
        name: val('obj-name').trim(),
        short: val('obj-short').trim(),
        address: val('obj-address').trim(),
        lat: parseCoords(val('obj-coords'))?.lat,
        lon: parseCoords(val('obj-coords'))?.lon,
        region: val('obj-region').trim() || undefined,
        color: Number(val('obj-color')) || 1,
        budgetHoursMonth: num('obj-budget') || undefined,
        onlyTrained: checked('obj-trained'),
        sundayBasis: val('obj-sundaybasis').trim() || undefined,
        instructions: val('obj-instructions').trim() || undefined,
        contact: val('obj-contact').trim() || undefined,
        proofEmail: val('obj-proofemail').trim() || undefined,
        keys: bookKeys(existing.id) ? existing.keys || [] : readKeys(),
        winter: readWinter(existing),
        weatherPlace: document.getElementById('obj-weatherplace') ? val('obj-weatherplace') || undefined : existing.weatherPlace,
      }
      const waste = readWaste()
      obj.waste = waste.streams?.length ? waste : undefined
      if (document.getElementById(`spr-${FOREIGN_LANGUAGES[0].id}`)) {
        const field = (id) => document.getElementById(`spr-${id}`)
        const inputs = Object.fromEntries(FOREIGN_LANGUAGES.map((l) => [l.id, field(l.id).value]))
        const confirmed = FOREIGN_LANGUAGES.filter((l) => field(l.id).dataset.ok).map((l) => l.id)
        const ki = FOREIGN_LANGUAGES.filter((l) => field(l.id).dataset.ki && field(l.id).value.trim() === field(l.id).dataset.ki.trim()).map((l) => l.id)
        obj.instructionsI18n = updateTranslations(existing, obj.instructions, inputs, { confirmed, ki, by: app.user?.name || '', at: todayISO() })
      }
      if (!obj.name) return toast('Bitte einen Namen eingeben.')
      if (obj.proofEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(obj.proofEmail)) return toast('Die E-Mail-Adresse für den Leistungsnachweis sieht nicht richtig aus.')
      if (val('obj-coords').trim() && !parseCoords(val('obj-coords'))) return toast('Koordinaten bitte als „Breite, Länge“ eintragen, z. B. 47.80950, 13.05500.')
      if (!obj.short) obj.short = obj.name.split(' ')[0]
      for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k]
      if (id === 'new') app.data.objects.push(obj)
      else app.data.objects = app.data.objects.map((o) => (o.id === id ? obj : o))
      persist()
      closeModal()
      renderNow()
      const stale = staleLanguages(obj)
      if (stale.length) toast(`Gespeichert. Übersetzung veraltet (${stale.map((x) => langInfo(x).label).join(', ')}): am Handy steht dazu der deutsche Text. Bitte unter „Übersetzungen für Mitarbeitende“ anpassen.`)
    },
    'spr-passt': (el) => {
      const field = document.getElementById(`spr-${el.dataset.lang}`)
      if (!field) return
      field.dataset.ok = '1'
      document.getElementById(`spr-st-${el.dataset.lang}`).innerHTML = '<span class="pill ok">passt, wird beim Speichern bestätigt</span>'
      el.remove()
    },
    'spr-ki': async (el) => {
      const german = val('obj-instructions').trim()
      if (!german) return toast('Bitte zuerst die Anweisung auf Deutsch eintragen.')
      const box = document.getElementById('spr-vorschau')
      el.disabled = true
      el.textContent = 'Wird übersetzt …'
      try {
        const { translateText } = await import('../../ai/translate.js')
        const texts = await translateText(german, FOREIGN_LANGUAGES.map((l) => l.id))
        if (!Object.keys(texts).length) return toast('Die KI hat keine Übersetzung geliefert. Bitte von Hand übersetzen.')
        if (box) {
          box.dataset.german = german
          box.innerHTML = proposalHtml(texts)
        }
      } catch (err) {
        toast(`Übersetzen nicht möglich: ${err.message}`)
      } finally {
        el.disabled = false
        el.textContent = 'Mit KI übersetzen'
      }
    },
    'spr-ki-ok': () => {
      const box = document.getElementById('spr-vorschau')
      if (box?.dataset.german && box.dataset.german !== val('obj-instructions').trim()) {
        box.innerHTML = ''
        return toast('Der deutsche Text wurde inzwischen geändert. Bitte noch einmal übersetzen.')
      }
      let n = 0
      for (const l of FOREIGN_LANGUAGES) {
        const text = document.getElementById(`spr-vt-${l.id}`)?.textContent
        if (!text || !document.getElementById(`spr-v-${l.id}`)?.checked) continue
        const field = document.getElementById(`spr-${l.id}`)
        field.value = text
        field.dataset.ki = text
        document.getElementById(`spr-st-${l.id}`).innerHTML = '<span class="pill info">Vorschlag der KI, noch nicht gespeichert</span>'
        n++
      }
      if (box) box.innerHTML = ''
      toast(n ? `${n} ${n === 1 ? 'Übersetzung' : 'Übersetzungen'} übernommen. Bitte prüfen und mit „Speichern“ sichern.` : 'Nichts angehakt, nichts übernommen.')
    },
    'spr-ki-weg': () => {
      const box = document.getElementById('spr-vorschau')
      if (box) box.innerHTML = ''
    },
    'obj-delete': (el) => {
      if (app.ui.confirm !== 'obj-delete') {
        app.ui.confirm = 'obj-delete'
        return renderModal()
      }
      const id = el.dataset.id
      for (const t of app.data.tasks.filter((x) => x.objectId === id)) removeTaskEverywhere(t.id)
      for (const action of ['out', 'in']) removeTaskEverywhere(`muell-${id}-${action}`)
      app.data.objects = app.data.objects.filter((o) => o.id !== id)
      for (const e of app.data.employees) e.trained = (e.trained || []).filter((x) => x !== id)
      persist()
      closeModal()
      renderNow()
    },
    'task-edit': (el) => {
      if (!app.data.objects.length) return toast('Bitte zuerst ein Objekt anlegen.')
      openModal({ type: 'task', id: el.dataset.id, objectId: el.dataset.obj })
    },
    'task-save': (el) => {
      const id = el.dataset.id
      const existing = id === 'new' ? { id: uid('t') } : app.data.tasks.find((t) => t.id === id)
      const task = readTaskForm(existing)
      if (!task.label) return toast('Bitte eine Bezeichnung eingeben.')
      if (task.recurrence.type === 'weekly' && !task.recurrence.weekdays.length) return toast('Bitte mindestens einen Wochentag wählen.')
      if (!task.start || !task.end) return toast('Bitte Beginn und Ende angeben.')
      for (const k of Object.keys(task)) if (task[k] === undefined) delete task[k]
      if (id === 'new') app.data.tasks.push(task)
      else app.data.tasks = app.data.tasks.map((t) => (t.id === id ? task : t))
      for (const empId of task.regulars) {
        const emp = app.data.employees.find((e) => e.id === empId)
        if (emp && !(emp.trained || []).includes(task.objectId)) emp.trained = [...(emp.trained || []), task.objectId]
      }
      persist()
      closeModal()
      renderNow()
      toast(`Leistung „${task.label}“ gespeichert. Mit „Woche planen“ einteilen.`)
    },
    'task-delete': (el) => {
      if (app.ui.confirm !== 'task-delete') {
        app.ui.confirm = 'task-delete'
        return renderModal()
      }
      removeTaskEverywhere(el.dataset.id)
      persist()
      closeModal()
      renderNow()
    },
  },
  { edit: 'stammdaten' },
)
