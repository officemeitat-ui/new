// Schnee-Alarm: wer wird an welchem Ort geweckt (Stufe 1, nach 15 min ohne
// Bestätigung Stufe 2), Handys über ntfy, Übertragen an den Webspace,
// Testalarm und Stand der Prüfung am Server (wetter-alarm.php, Cronjob).
//
// Die Einstellungen liegen bei den Regeln (rules.weather.alarm). Der Server
// bekommt nur, was er zum Wecken braucht: Orte, Namen, ntfy-Themen, E-Mail
// (privat/wetter-alarm.json, gesperrt).

import { addDays, todayISO } from '../../core/dates.js'
import { ALARM_DEFAULTS, alarmFile, alarmPlace, alarmProblems, findPlace, onCallIndex, PLACES, winterAt } from '../../core/weather.js'
import { app, canEdit, closeModal, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { checked, download, esc, ICON, modalFrame, num, options, val } from '../shared.js'
import { weatherLocations } from '../weather.js'

const hex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
const newTopic = () => `wd-${hex(8)}`
const address = () => new URL('.', location.href).href
const empById = (id) => app.data.employees.find((e) => e.id === id)
const time = (s) => new Date(s * 1000).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
const dateTime = (s) => new Date(s * 1000).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const ago = (s) => {
  const min = Math.round((Date.now() / 1000 - s) / 60)
  return min < 1 ? 'gerade eben' : min < 90 ? `vor ${min} min` : `vor ${Math.round(min / 60)} h`
}

export const alarmSettings = () => ({ ...ALARM_DEFAULTS, ...(app.data?.rules?.weather?.alarm || {}) })

/** Bei wöchentlichem Wechsel: wer diese und nächste Woche Bereitschaft hat. */
function onCall(set) {
  const ids = set.level1.filter((id) => empById(id))
  if (!set.rotate || ids.length < 2) return null
  const today = todayISO()
  return { now: ids[onCallIndex(today, ids.length)], next: ids[onCallIndex(addDays(today, 7), ids.length)] }
}

function saveSettings(alarm, locations) {
  const weather = { ...(app.data.rules?.weather || {}), alarm }
  if (locations) weather.locations = locations
  app.data.rules = { ...(app.data.rules || {}), weather }
  persist()
}

/** Schlüssel und Handy-Themen ergänzen (beim ersten Einschalten bzw. für neue Personen). */
function complete(alarm, locations) {
  const a = { ...alarm, topics: { ...(alarm.topics || {}) }, places: { ...(alarm.places || {}) } }
  a.key ||= hex(32)
  a.cronKey ||= hex(16)
  for (const loc of locations) {
    const set = alarmPlace(a, loc, app.data.objects, locations)
    for (const id of [...set.level1, ...set.level2]) a.topics[id] ||= newTopic()
  }
  return a
}

const fileFor = (alarm, locations) => alarmFile({ alarm, locations, objects: app.data.objects, employees: app.data.employees, address: address() })

// ---------------------------------------------------------------- Stand am Server

const status = { at: 0, data: null, error: '', loading: false }

/** Stand von wetter-alarm.php holen (höchstens jede Minute, force: sofort). */
export async function loadAlarmStatus(force = false) {
  const a = alarmSettings()
  if (!a.enabled || !a.key || status.loading || (!force && Date.now() - status.at < 60e3)) return
  status.at = Date.now()
  status.loading = true
  try {
    const res = await fetch('wetter-alarm.php?aktion=status', { headers: { 'X-Schluessel': a.key }, cache: 'no-store' })
    if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('wetter-alarm.php fehlt am Webspace (oder PHP ist aus).')
    const json = await res.json()
    if (res.status === 503) throw new Error('Am Webspace noch nicht eingerichtet: unter „Alarm einrichten“ die Alarm-Datei herunterladen und in den Ordner privat/ hochladen.')
    if (res.status === 403) throw new Error('Der Webspace kennt einen anderen Schlüssel: Alarm-Datei neu herunterladen und nach privat/ hochladen.')
    if (!res.ok) throw new Error(json.fehler || `Antwort ${res.status}`)
    Object.assign(status, { data: json, error: '' })
  } catch (err) {
    Object.assign(status, { data: null, error: err.message || String(err) })
  }
  status.loading = false
  if (app.ui.view === 'wetter') renderNow()
}

async function post(aktion, body, extra = '') {
  const res = await fetch(`wetter-alarm.php?aktion=${aktion}${extra}`, { method: 'POST', headers: { 'X-Schluessel': alarmSettings().key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const json = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null
  if (!json) throw new Error('wetter-alarm.php fehlt am Webspace (oder PHP ist aus).')
  if (res.status === 503) throw new Error('Am Webspace noch nicht eingerichtet: Alarm-Datei herunterladen und in den Ordner privat/ hochladen (einmalig).')
  if (res.status === 403) throw new Error('Der Webspace kennt einen anderen Schlüssel: Alarm-Datei neu herunterladen und nach privat/ hochladen.')
  if (!res.ok) throw new Error(json.fehler || `Antwort ${res.status}`)
  return json
}

// ---------------------------------------------------------------- Karte in „Wetter & Winterdienst“

export function alarmCard() {
  const a = alarmSettings()
  const editable = canEdit('planung') && !app.readOnly
  if (!a.enabled) {
    if (!editable) return ''
    return `<section class="wx-loc wx-alarm"><h3>${ICON.bell} Schnee-Alarm <span class="muted">(aus)</span></h3>
      <p>Weckt das Winterdienst-Team per Push aufs Handy, sobald es an einem Ort zu schneien beginnt, Glätte droht oder GeoSphere vor Schnee oder Glatteis warnt. Die Prüfung läuft alle 10 Minuten am Webspace, auch nachts und ohne offene App. Bestätigt niemand mit „Bin wach“, geht der Alarm an Stufe 2 (z. B. Büro).</p>
      <button class="btn primary" data-action="wx-alarm-open">${ICON.bell} Alarm einrichten</button></section>`
  }
  loadAlarmStatus()
  const locations = weatherLocations()
  const st = status.data
  const byName = new Map((st?.orte || []).map((o) => [o.name, o]))
  const names = (ids) => ids.map((id) => empById(id)?.name).filter(Boolean).join(', ')
  const rows = locations
    .map((loc) => {
      const set = alarmPlace(a, loc, app.data.objects, locations)
      if (!set.active) return `<li><strong>${esc(loc.name)}</strong> <span class="muted">aus</span></li>`
      const s = byName.get(loc.name)
      const alarm = s?.alarm
      const info = []
      if (s?.fehler) info.push(`<span class="pill warning">${esc(s.fehler)}</span>`)
      else if (s?.lage) info.push(s.lage === 'ruhig' ? '<span class="muted">ruhig</span>' : `<span class="pill info">${esc(s.lage)}</span>`)
      if (s?.wartend) info.push(`<span class="pill info">Ruhezeit: wird um ${esc(a.quietTo)} Uhr geweckt</span>`)
      if (alarm) {
        const wach = alarm.wach.map((w) => `${esc(w.name)} ${time(w.zeit)}`).join(', ')
        info.push(`<span class="pill ${wach ? 'ok' : alarm.test ? 'info' : 'error'}">${alarm.test ? 'Testalarm' : 'Alarm'} ${dateTime(alarm.gesendet)}${wach ? `, wach: ${wach}` : ', noch niemand bestätigt'}${alarm.eskaliert ? ', Stufe 2 alarmiert' : ''}</span>`)
      }
      const duty = onCall(set)
      return `<li><strong>${esc(loc.name)}</strong>: ${duty ? `Bereitschaft diese Woche ${esc(empById(duty.now).name)} <span class="muted">(nächste: ${esc(empById(duty.next).name)})</span>` : esc(names(set.level1) || 'niemand in Stufe 1')}${set.level2.length || a.topics?.office || a.officeEmails ? ` <span class="muted">· Stufe 2: ${esc([names(set.level2), a.topics?.office || a.officeEmails ? 'Büro' : ''].filter(Boolean).join(', '))}</span>` : ''} ${info.join(' ')}</li>`
    })
    .join('')
  const last = st?.letztePruefung
  const stale = last && Date.now() / 1000 - last > 30 * 60
  const server = status.error
    ? `<div class="banner warn-banner"><p><strong>Server-Prüfung nicht erreichbar.</strong> ${esc(status.error)}</p></div>`
    : !st
      ? `<p class="note">${status.loading ? 'Frage den Webspace …' : ''}</p>`
      : !last
        ? '<div class="banner warn-banner"><p><strong>Noch keine Prüfung am Webspace.</strong> Den Cronjob einrichten (alle 10 Minuten), siehe „Alarm einrichten“ → Webspace.</p></div>'
        : `<p class="${stale ? '' : 'note'}">${stale ? `<span class="pill error">Letzte Prüfung ${ago(last)}: läuft der Cronjob?</span>` : `Webspace prüfte zuletzt ${time(last)} Uhr (${ago(last)}).`}</p>`
  return `<section class="wx-loc wx-alarm"><h3>${ICON.bell} Schnee-Alarm <span class="muted">(ein)</span></h3>
    <ul class="wx-alarm-list">${rows}</ul>${server}
    ${editable ? `<div class="toolbar"><button class="btn" data-action="wx-alarm-open">Einstellungen</button><button class="btn" data-action="wx-alarm-test">Testalarm senden</button><button class="btn" data-action="wx-alarm-status">${ICON.refresh} Stand</button></div>` : ''}
    ${st?.protokoll?.length ? `<details><summary>Protokoll</summary><ul class="wx-log">${st.protokoll.map((p) => `<li><span class="muted">${dateTime(p.zeit)}</span> ${esc(p.ort)}: ${esc(p.text)}</li>`).join('')}</ul></details>` : ''}
  </section>`
}

// ---------------------------------------------------------------- Einstellungen (Dialog)

function draft() {
  const m = app.ui.modal
  if (!m.draft) {
    const locations = weatherLocations().map((l) => ({ ...l }))
    const a = alarmSettings()
    const places = {}
    for (const loc of locations) places[loc.name] = alarmPlace(a, loc, app.data.objects, locations)
    m.draft = { ...a, places, topics: { ...(a.topics || {}) }, locations, enabled: a.enabled || !a.key }
  }
  return m.draft
}

/** Formular → Entwurf (vor jedem Neuzeichnen, damit nichts verloren geht). */
function readForm() {
  const d = draft()
  if (!document.getElementById('al-enabled')) return d
  d.enabled = checked('al-enabled')
  d.locations.forEach((loc, i) => {
    const pick = (lvl) => [...document.querySelectorAll(`input[name="al-p${i}-l${lvl}"]:checked`)].map((el) => el.value)
    d.places[loc.name] = { active: checked(`al-p${i}-active`), level1: pick(1), level2: pick(2), rotate: checked(`al-p${i}-rotate`) }
  })
  const n = (id, fallback) => (num(id) === null ? fallback : num(id))
  Object.assign(d, {
    leadHours: Math.min(12, Math.max(1, n('al-lead', ALARM_DEFAULTS.leadHours))),
    snowCm: Math.max(0.1, n('al-snow', ALARM_DEFAULTS.snowCm)),
    escalateMin: Math.max(5, Math.round(n('al-escalate', ALARM_DEFAULTS.escalateMin))),
    pauseHours: Math.max(1, n('al-pause', ALARM_DEFAULTS.pauseHours)),
    quietFrom: val('al-quietfrom'),
    quietTo: val('al-quietto'),
    sender: val('al-sender').trim(),
    officeEmails: val('al-officeemails').trim(),
    emailLevel1: checked('al-emaill1'),
    ntfy: val('al-ntfy').trim().replace(/\/+$/, '') || ALARM_DEFAULTS.ntfy,
  })
  if (checked('al-office')) d.topics.office ||= newTopic()
  else delete d.topics.office
  return d
}

function personRow(i, id, set, team) {
  const e = empById(id)
  if (!e) return ''
  return `<tr><td>${esc(e.name)}${team.includes(id) ? ' <span class="tag">Team</span>' : ''}</td>
    <td class="num"><input type="checkbox" name="al-p${i}-l1" value="${esc(id)}" ${set.level1.includes(id) ? 'checked' : ''} aria-label="${esc(e.name)} Stufe 1"></td>
    <td class="num"><input type="checkbox" name="al-p${i}-l2" value="${esc(id)}" ${set.level2.includes(id) ? 'checked' : ''} aria-label="${esc(e.name)} Stufe 2"></td></tr>`
}

function alarmModal() {
  const d = draft()
  const { locations } = d
  const places = locations
    .map((loc, i) => {
      const set = d.places[loc.name] || { active: true, level1: [], level2: [], rotate: false }
      const { objects, team } = winterAt(loc, app.data.objects, locations)
      const people = [...new Set([...team, ...set.level1, ...set.level2])]
      const others = app.data.employees.filter((e) => !people.includes(e.id)).map((e) => [e.id, e.name])
      return `<section class="al-place"><h3><label class="check"><input type="checkbox" id="al-p${i}-active" ${set.active ? 'checked' : ''}><span>${esc(loc.name)}</span></label> <span class="muted">${objects.length ? `${objects.length} ${objects.length === 1 ? 'Objekt' : 'Objekte'} mit Winterdienst: ${esc(objects.map((o) => o.short || o.name).join(', '))}` : 'kein Objekt mit Winterdienst (beim Objekt „Ort“ wählen)'}</span></h3>
        ${people.length ? `<div class="table-wrap"><table class="data al-people"><thead><tr><th>Person</th><th class="num">Stufe 1 (wecken)</th><th class="num">Stufe 2 (nach ${esc(d.escalateMin)} min)</th></tr></thead><tbody>${people.map((id) => personRow(i, id, set, team)).join('')}</tbody></table></div>` : '<p class="muted">Noch niemand: Person hinzufügen oder beim Objekt ein Winterdienst-Team eintragen.</p>'}
        <label class="check"><input type="checkbox" id="al-p${i}-rotate" data-change="wx-alarm-redraw" ${set.rotate ? 'checked' : ''}><span>Stufe 1 wechselt wöchentlich (je Woche eine Person, Reihenfolge wie oben, Wechsel montags)${onCall(set) ? `: diese Woche <strong>${esc(empById(onCall(set).now).name)}</strong>, nächste ${esc(empById(onCall(set).next).name)}` : ''}</span></label>
        ${set.active && set.level1.length ? `<p class="note">${set.rotate && set.level1.length >= 4 ? 'Rufbereitschaft wechselt: je Person höchstens rund eine Woche im Monat.' : `Wer in Stufe 1 steht, ist in Rufbereitschaft (§ 20a AZG: außerhalb der Arbeitszeit höchstens an 10 Tagen im Monat, laut KV bis 30 Tage in 3 Monaten). ${set.rotate ? 'Mit weniger als 4 Personen kann jemand über 10 Tage im Monat kommen.' : 'Ohne Wechsel sind alle jede Nacht in Bereitschaft: wöchentlich wechseln (ab 4 Personen) oder schriftlich regeln.'}`}</p>` : ''}
        <div class="inline-form" style="border:0;padding:0"><label class="field"><span>Person hinzufügen</span><select id="al-p${i}-add">${options(others, '', { empty: '– wählen –' })}</select></label><button class="btn small" data-action="wx-alarm-person" data-idx="${i}">${ICON.plus} Hinzufügen</button></div>
      </section>`
    })
    .join('')
  const all = [...new Set(locations.flatMap((loc) => [...(d.places[loc.name]?.level1 || []), ...(d.places[loc.name]?.level2 || [])]))]
  const ntfy = d.ntfy || ALARM_DEFAULTS.ntfy
  const phones = all
    .map((id) => {
      const e = empById(id)
      if (!e) return ''
      const t = d.topics[id]
      const link = t ? `${ntfy}/${t}` : ''
      const invite = t && e.email ? `mailto:${encodeURIComponent(e.email)}?subject=${encodeURIComponent('Winterdienst: Schnee-Alarm aufs Handy')}&body=${encodeURIComponent(`Hallo ${e.name},\n\nfür den Schnee-Alarm bitte die App „ntfy“ installieren (Play Store bzw. App Store), dann auf + tippen und dieses Thema abonnieren:\n\n${t}\n\n(Server: ${ntfy}, oder diesen Link öffnen: ${link})\n\nIn der App beim Thema die Benachrichtigungen auf höchste Priorität stellen und „Nicht stören“ übergehen lassen, damit der Alarm auch nachts weckt.\n\nDanke!`)}` : ''
      return `<tr><td>${esc(e.name)}</td><td>${t ? `<code>${esc(t)}</code>` : '<span class="muted">wird beim Speichern angelegt</span>'}</td><td>${esc(e.email || '–')}</td>
        <td class="actions">${invite ? `<a class="btn small" href="${esc(invite)}">Einladung per E-Mail</a>` : ''}${t ? `<button class="btn small" data-action="wx-alarm-copy" data-text="${esc(t)}">Thema kopieren</button><button class="btn small" data-action="wx-alarm-newtopic" data-emp="${esc(id)}" title="Wenn jemand das Thema nicht mehr bekommen soll (z. B. Handy verloren)">Neues Thema</button>` : ''}</td></tr>`
    })
    .join('')
  const file = fileFor(complete(d, locations), locations)
  const problems = d.enabled ? alarmProblems(file) : []
  const cron = `${address()}wetter-alarm.php?aktion=pruefen&schluessel=${d.cronKey || '(nach dem Speichern)'}`
  const known = PLACES.filter((p) => !locations.some((l) => l.name.toLowerCase() === p.name.toLowerCase())).map((p) => `<option value="${esc(p.name)}">`).join('')
  return modalFrame({
    title: 'Schnee-Alarm einrichten',
    wide: true,
    body: `<label class="check"><input type="checkbox" id="al-enabled" ${d.enabled ? 'checked' : ''}><span><strong>Schnee-Alarm ein</strong>: bei Schneefall in den nächsten Stunden, Glätte oder einer Schnee-/Glatteiswarnung von GeoSphere wird Stufe 1 per Push geweckt (Knopf „Bin wach“). Bestätigt niemand, folgt Stufe 2. Ein Ort meldet sich höchstens alle ${esc(d.pauseHours)} h neu, außer die Warnstufe steigt.</span></label>
      ${problems.length ? `<div class="banner warn-banner"><p>${problems.map(esc).join(' · ')}</p></div>` : ''}
      <h3>Orte</h3>${places}
      <div class="inline-form" style="border:0;padding:0"><label class="field"><span>Ort hinzufügen (z. B. Hallein, Obertrum)</span><input type="text" id="al-newplace" list="al-places" placeholder="Name oder „Name = Breite, Länge“"><datalist id="al-places">${known}</datalist></label><button class="btn" data-action="wx-alarm-place">${ICON.plus} Ort hinzufügen</button></div>
      <p class="note">Orte entfernen oder umbenennen: unter <em>Regeln & Feiertage → Wetter & Winterdienst</em>.</p>
      <h3>Handys (ntfy)</h3>
      <p class="note">Jede Person installiert die kostenlose App <strong>ntfy</strong> (Android, iPhone) und abonniert ihr Thema. Beim Thema die höchste Priorität erlauben und „Nicht stören“ übergehen lassen (Android: Benachrichtigungskategorie „Höchste Priorität“ → „Nicht stören ignorieren“; iPhone: Fokus → Apps → ntfy erlauben). Das Thema wirkt wie ein Passwort: nicht weitergeben.</p>
      ${phones ? `<div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th>ntfy-Thema</th><th>E-Mail</th><th></th></tr></thead><tbody>${phones}</tbody></table></div>` : '<p class="muted">Noch niemand ausgewählt.</p>'}
      <label class="check"><input type="checkbox" id="al-office" ${d.topics.office ? 'checked' : ''}><span>Büro-Handy in Stufe 2${d.topics.office ? `: Thema <code>${esc(d.topics.office)}</code> <button class="btn small" data-action="wx-alarm-copy" data-text="${esc(d.topics.office)}">kopieren</button>` : ''}</span></label>
      <div class="form-grid">
        <label class="field wide"><span>Stufe 2 zusätzlich per E-Mail an</span><input type="text" id="al-officeemails" value="${esc(d.officeEmails || '')}" placeholder="z. B. office@…, mehrere mit Komma"></label>
        <label class="check wide"><input type="checkbox" id="al-emaill1" ${d.emailLevel1 ? 'checked' : ''}><span>Stufe 1 zusätzlich per E-Mail (weckt nachts nicht, gut als Nachweis)</span></label>
      </div>
      <h3>Wann wecken</h3>
      <div class="form-grid">
        <label class="field"><span>Schneefall ab (cm je Stunde)</span><input type="number" id="al-snow" step="0.1" min="0.1" value="${esc(d.snowCm)}"></label>
        <label class="field"><span>So weit voraus (Stunden)</span><input type="number" id="al-lead" step="1" min="1" max="12" value="${esc(d.leadHours)}"></label>
        <label class="field"><span>Stufe 2 nach (Minuten ohne „Bin wach“)</span><input type="number" id="al-escalate" step="5" min="5" value="${esc(d.escalateMin)}"></label>
        <label class="field"><span>Neuer Alarm frühestens nach (Stunden)</span><input type="number" id="al-pause" step="1" min="1" value="${esc(d.pauseHours)}"></label>
        <label class="field"><span>Ruhezeit von (optional)</span><input type="time" id="al-quietfrom" value="${esc(d.quietFrom || '')}"></label>
        <label class="field"><span>Ruhezeit bis</span><input type="time" id="al-quietto" value="${esc(d.quietTo || '')}"><small class="muted">In der Ruhezeit wird erst am Ende geweckt; Warnung orange oder rot weckt sofort.</small></label>
      </div>
      <h3>Webspace</h3>
      <div class="form-grid">
        <label class="field"><span>Absender der E-Mails</span><input type="email" id="al-sender" value="${esc(d.sender || '')}" placeholder="z. B. winterdienst@…"></label>
        <label class="field"><span>ntfy-Server</span><input type="url" id="al-ntfy" value="${esc(ntfy)}"></label>
      </div>
      <p class="note"><strong>Einmalig:</strong> „Alarm-Datei herunterladen“ und die Datei per FTP in den Ordner <code>privat/</code> der App laden (der Ordner ist gesperrt). Danach überträgt „Speichern und übertragen“ jede Änderung direkt. <strong>Cronjob</strong> alle 10 Minuten: am Webspace <code>php wetter-alarm.php</code> im Ordner der App, oder ein Cron-Dienst ruft diese Adresse auf:</p>
      <p><code class="wrap">${esc(cron)}</code> ${d.cronKey ? `<button class="btn small" data-action="wx-alarm-copy" data-text="${esc(cron)}">Adresse kopieren</button>` : ''}</p>`,
    foot: `<button class="btn" data-action="wx-alarm-download">Alarm-Datei herunterladen</button>
      <div class="actions"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn" data-action="wx-alarm-save">Speichern</button><button class="btn primary" data-action="wx-alarm-save" data-send="1">Speichern und übertragen</button></div>`,
  })
}

registerModal('wx-alarm', alarmModal, { module: 'planung' })

function rerender() {
  readForm()
  renderModal()
}

registerActions({
  'wx-alarm-open': () => openModal({ type: 'wx-alarm' }),
  // Häkchen „wechselt wöchentlich“: gleich anzeigen, wer dran ist
  'wx-alarm-redraw': () => rerender(),
  'wx-alarm-status': () => loadAlarmStatus(true),
  'wx-alarm-person': (el) => {
    const d = readForm()
    const i = Number(el.dataset.idx)
    const id = val(`al-p${i}-add`)
    if (!id) return toast('Bitte eine Person wählen.')
    const name = d.locations[i].name
    d.places[name].level1 = [...new Set([...d.places[name].level1, id])]
    renderModal()
  },
  'wx-alarm-place': () => {
    const d = readForm()
    const text = val('al-newplace').trim()
    const m = text.match(/^(.+?)\s*[=:]\s*(-?\d+(?:[.,]\d+)?)[\s,;]+(-?\d+(?:[.,]\d+)?)$/)
    const known = !m && findPlace(text)
    const place = m ? { name: m[1].trim(), lat: Number(m[2].replace(',', '.')), lon: Number(m[3].replace(',', '.')) } : known ? { name: text.length < known.name.length ? known.name : text, lat: known.lat, lon: known.lon } : null
    if (!place) return toast('Ort nicht in der Liste: bitte als „Name = Breite, Länge“ eingeben, z. B. „Hallein = 47.6833, 13.097“.')
    if (place.lat < 46 || place.lat > 49.1 || place.lon < 9.4 || place.lon > 17.2) return toast('Der Ort liegt nicht in Österreich.')
    if (d.locations.some((l) => l.name.toLowerCase() === place.name.toLowerCase())) return toast(`${place.name} ist schon da.`)
    d.locations.push(place)
    d.places[place.name] = { active: true, level1: [], level2: [], rotate: false }
    renderModal()
  },
  'wx-alarm-newtopic': (el) => {
    const d = readForm()
    d.topics[el.dataset.emp] = newTopic()
    renderModal()
    toast('Neues Thema: die Person muss es in ntfy neu abonnieren. Nach dem Speichern gilt nur noch das neue.')
  },
  'wx-alarm-copy': async (el) => {
    try {
      await navigator.clipboard.writeText(el.dataset.text)
      toast('Kopiert.')
    } catch {
      toast(el.dataset.text)
    }
  },
  'wx-alarm-download': () => {
    const d = readForm()
    const a = complete(d, d.locations)
    Object.assign(d, { key: a.key, cronKey: a.cronKey, topics: a.topics })
    download('wetter-alarm.json', new Blob([`${JSON.stringify(fileFor(a, d.locations), null, 2)}\n`], { type: 'application/json' }))
    saveSettings(strip(a), d.locations)
    renderModal()
    toast('Gespeichert und heruntergeladen: wetter-alarm.json per FTP in den Ordner privat/ der App laden.')
  },
  'wx-alarm-save': async (el) => {
    const d = readForm()
    const a = complete(d, d.locations)
    saveSettings(strip(a), d.locations)
    closeModal()
    renderNow()
    if (!el.dataset.send) return toast('Schnee-Alarm gespeichert. Für den Webspace „Speichern und übertragen“ oder die Alarm-Datei hochladen.')
    try {
      const r = await post('speichern', fileFor(a, d.locations))
      toast(`Übertragen: ${r.gespeichert}.`)
      loadAlarmStatus(true)
    } catch (err) {
      toast(`Gespeichert, aber nicht übertragen: ${err.message}`)
    }
  },
  'wx-alarm-test': async () => {
    try {
      const r = await post('test')
      const n = Object.values(r).reduce((s, x) => s + x.personen, 0)
      const errors = Object.values(r).flatMap((x) => x.fehler)
      toast(`Testalarm an ${n} ${n === 1 ? 'Person' : 'Personen'} gesendet${errors.length ? `; Fehler: ${errors.join('; ')}` : '. Auf den Handys „Bin wach“ tippen.'}`)
      loadAlarmStatus(true)
    } catch (err) {
      toast(`Testalarm nicht gesendet: ${err.message}`)
    }
  },
})

/** Entwurfsfelder, die nicht gespeichert werden (die Orte stehen bei den Regeln). */
function strip(a) {
  const { locations, ...rest } = a
  return rest
}
