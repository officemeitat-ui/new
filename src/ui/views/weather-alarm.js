// Schnee-Alarm: wer wird an welchem Ort geweckt (Stufe 1, nach 15 min ohne
// Bestätigung Stufe 2), Handys über ntfy, Übertragen an den Webspace,
// Testalarm und Stand der Prüfung am Server (wetter-alarm.php, Cronjob).
//
// Die Einstellungen liegen bei den Regeln (rules.weather.alarm). Der Server
// bekommt nur, was er zum Wecken braucht: Orte, Namen, ntfy-Themen, E-Mail
// (privat/wetter-alarm.json, gesperrt).
//
// SMS von selbst (zusätzlich zu Push und E-Mail): geht nur über einen SMS-Dienst (seven.io). Der Schlüssel geht aus
// dem Dialog direkt an den Webspace (privat/sms.json) und steht nie in den Daten der App; hier liegt nur, wer eine
// SMS bekommt (alarm.sms, alarm.officeSms).
// WhatsApp von selbst (zusätzlich zu Push und E-Mail): geht nur über die Schnittstelle von Meta. Zugriffstoken,
// Telefonnummer-ID und Name der Vorlage gehen aus dem Dialog direkt an den Webspace (privat/whatsapp.json) und stehen
// nie in den Daten der App; hier liegt nur, wer per WhatsApp geweckt wird (alarm.whatsapp, alarm.officeWhatsapp).

import { addDays, todayISO } from '../../core/dates.js'
import { ALARM_DEFAULTS, alarmDrivers, alarmFile, alarmPlace, alarmProblems, driverLink, findPlace, onCallIndex, PLACES, SMS_PROVIDERS, WHATSAPP_TEMPLATE, whatsappButtonUrl, whatsappNumbers, winterAt } from '../../core/weather.js'
import { waNumber } from '../../core/whatsapp.js'
import { app, canEdit, closeModal, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { checked, download, esc, ICON, modalFrame, num, options, val } from '../shared.js'
import { weatherLocations } from '../weather.js'
import { waLink } from '../whatsapp.js'

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

const fileFor = (alarm, locations) => alarmFile({ alarm, locations, objects: app.data.objects, employees: app.data.employees, absences: app.data.absences || [], address: address() })

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

// ---------------------------------------------------------------- von selbst aktuell halten
// Abwesenheiten, Teams und Austritte ändern sich laufend: die Alarm-Datei am Webspace wird neu übertragen,
// sobald sie sich ändert (alle 15 Minuten geprüft, nur wer die Planung ändern darf, nach dem ersten
// „Speichern und übertragen“). So weckt der Server niemanden, der krank oder auf Urlaub ist.

const hashOf = (text) => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return String(h >>> 0)
}
let syncing = false
export async function syncAlarmFile() {
  const a = alarmSettings()
  if (syncing || !app.data || !a.key || !a.transferred || !canEdit('planung') || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false
  const sig = hashOf(JSON.stringify(fileFor(a, weatherLocations())))
  let last = ''
  try {
    last = localStorage.getItem('cleanos-alarm-gesendet') || ''
  } catch {
    /* privat */
  }
  if (last === sig) return false
  syncing = true
  try {
    await post('speichern', fileFor(a, weatherLocations()))
    try {
      localStorage.setItem('cleanos-alarm-gesendet', sig)
    } catch {
      /* privat */
    }
    return true
  } catch {
    return false
  } finally {
    syncing = false
  }
}
if (typeof window !== 'undefined' && typeof setInterval === 'function') {
  setTimeout(() => syncAlarmFile(), 20e3)
  setInterval(() => syncAlarmFile(), 15 * 60e3)
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
    ${st?.sms || st?.whatsapp ? `<p class="note">${[st.sms ? 'SMS' : '', st.whatsapp ? 'WhatsApp' : ''].filter(Boolean).join(' und ')} von selbst ${st.sms && st.whatsapp ? 'sind' : 'ist'} eingerichtet: wer in den Einstellungen angehakt ist, bekommt den Alarm auch dort.</p>` : ''}
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
    m.draft = { ...a, places, topics: { ...(a.topics || {}) }, whatsapp: { ...(a.whatsapp || {}) }, sms: { ...(a.sms || {}) }, locations, enabled: a.enabled || !a.key }
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
    officeWhatsapp: val('al-officewa').trim(),
    officeSms: val('al-officesms').trim(),
    emailLevel1: checked('al-emaill1'),
    ntfy: val('al-ntfy').trim().replace(/\/+$/, '') || ALARM_DEFAULTS.ntfy,
  })
  if (checked('al-office')) d.topics.office ||= newTopic()
  else delete d.topics.office
  // wer per WhatsApp geweckt wird (nur die Personen der Liste; ohne Liste bleibt es, wie es war)
  if (document.querySelector('input[name="al-wa"]')) d.whatsapp = Object.fromEntries([...document.querySelectorAll('input[name="al-wa"]:checked')].map((el) => [el.value, true]))
  if (document.querySelector('input[name="al-sms"]')) d.sms = Object.fromEntries([...document.querySelectorAll('input[name="al-sms"]:checked')].map((el) => [el.value, true]))
  // Zugang zum SMS-Dienst: wie bei WhatsApp nur im Speicher dieses Dialogs
  for (const [key, id] of [['key', 'al-sms-key'], ['sender', 'al-sms-sender'], ['provider', 'al-sms-provider'], ['test', 'al-sms-test']]) if (document.getElementById(id)) smsForm[key] = val(id).trim()
  // Zugangsdaten für WhatsApp: nur im Speicher dieses Dialogs, nie im Entwurf und nie in den Daten der App
  for (const [key, id] of [['token', 'al-wa-token'], ['numberId', 'al-wa-id'], ['template', 'al-wa-template'], ['language', 'al-wa-lang'], ['version', 'al-wa-version'], ['test', 'al-wa-test']]) if (document.getElementById(id)) waForm[key] = val(id).trim()
  return d
}

// ---------------------------------------------------------------- SMS von selbst (SMS-Dienst)

/** Stand am Webspace (ohne Schlüssel) und die Eingaben des Dialogs; beides nur im Speicher. */
const sms = { data: null, error: '', loading: false, at: 0 }
const smsForm = { key: '', sender: '', provider: '', test: '' }

/** Stand eines Dienstes (aktion: „sms“ oder „whatsapp“) vom Webspace holen; zeichnet den Dialog neu, sobald er da ist. */
async function loadChannel(aktion, store, force = false) {
  const a = alarmSettings()
  if (!a.key || store.loading || (!force && Date.now() - store.at < 60e3)) return
  store.loading = true
  store.at = Date.now()
  try {
    const res = await fetch(`wetter-alarm.php?aktion=${aktion}`, { headers: { 'X-Schluessel': a.key }, cache: 'no-store' })
    const json = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null
    if (!json) throw new Error('wetter-alarm.php fehlt am Webspace (oder PHP ist aus).')
    if (res.status === 503) throw new Error('Zuerst den Schnee-Alarm am Webspace einrichten (Alarm-Datei nach privat/ laden).')
    if (res.status === 403) throw new Error('Der Webspace kennt einen anderen Schlüssel: Alarm-Datei neu herunterladen und nach privat/ hochladen.')
    if (!res.ok) throw new Error(json.fehler || `Antwort ${res.status}`)
    Object.assign(store, { data: json, error: '' })
  } catch (err) {
    Object.assign(store, { data: null, error: err.message || String(err) })
  }
  store.loading = false
  if (app.ui.modal?.type === 'wx-alarm') rerender()
}

const euro = (n) => `${Number(n).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** Abschnitt „SMS“ im Dialog: Stand, Erklärung, Zugang, Probe. */
function smsSection(d) {
  const ready = !!alarmSettings().key
  if (ready && !sms.data && !sms.error) loadChannel('sms', sms)
  const st = sms.data
  const state = !ready
    ? '<span class="muted">Zuerst den Schnee-Alarm speichern und am Webspace einrichten (Alarm-Datei), dann geht es hier weiter.</span>'
    : sms.error
      ? `<span class="pill warning">${esc(sms.error)}</span>`
      : !st
        ? '<span class="muted">Frage den Webspace …</span>'
        : st.eingerichtet
          ? `<span class="pill ok">eingerichtet</span> <span class="muted">${esc(st.anbieterName)}, Absender ${esc(st.absender || 'vom Dienst')}, Schlüssel endet auf …${esc(st.schluesselEnde)}${st.guthaben !== null && st.guthaben !== undefined ? `, Guthaben zuletzt ${esc(euro(st.guthaben))}` : ''}</span>${st.guthaben !== null && st.guthaben !== undefined && st.guthaben < 2 ? ' <span class="pill error">Guthaben fast aufgebraucht</span>' : ''}`
          : '<span class="pill info">noch nicht eingerichtet</span>'
  const bad = (text) => text && whatsappNumbers(text).length !== String(text).split(/[,;\n]+/).filter((x) => x.trim()).length
  return `<h3>SMS von selbst</h3>
    <p class="note">Der Server kann den Alarm zusätzlich als SMS schicken: kurzer Text mit der Lage und einem Link zum Bestätigen. Das geht auf jedem Handy ohne eigene App, braucht aber einen <strong>SMS-Dienst</strong>, denn ein Webspace kann selbst keine SMS senden. Eingebaut ist <strong>seven.io</strong>: Konto anlegen, Guthaben aufladen, einen Schlüssel für die Schnittstelle erzeugen und hier eintragen. Je SMS verrechnet der Dienst einige Cent; ein Alarm braucht je nach Länge eine oder zwei SMS. Eine SMS piept nur kurz: zum Wecken den Absender am Handy als Kontakt speichern und ihm einen lauten Ton und die Ausnahme von „Nicht stören“ geben.</p>
    <p id="al-sms-state">${state}</p>
    <div class="form-grid">
      <label class="field"><span>SMS-Dienst</span><select id="al-sms-provider">${options(Object.entries(SMS_PROVIDERS), smsForm.provider || st?.anbieter || 'seven')}</select></label>
      <label class="field wide"><span>Schlüssel der Schnittstelle${st?.eingerichtet ? ' (leer lassen: bleibt, wie er ist)' : ''}</span><input type="password" id="al-sms-key" autocomplete="off" value="${esc(smsForm.key)}" placeholder="${st?.eingerichtet ? `gespeichert, endet auf …${esc(st.schluesselEnde)}` : 'vom SMS-Dienst (API-Schlüssel)'}"></label>
      <label class="field"><span>Absender (höchstens 11 Zeichen oder eine Nummer)</span><input type="text" id="al-sms-sender" maxlength="20" value="${esc(smsForm.sender || st?.absender || (app.config.brand?.name || 'Winterdienst').replace(/[^A-Za-z0-9]/g, '').slice(0, 11))}"></label>
    </div>
    <p class="note">Der Schlüssel geht nur an den Webspace (Ordner <code>privat/</code>) und wird hier nicht gespeichert und nie wieder angezeigt.</p>
    <div class="toolbar"><button class="btn" data-action="wx-sms-save">Am Webspace speichern</button>${st?.eingerichtet ? '<button class="btn" data-action="wx-sms-remove">SMS entfernen</button>' : ''}</div>
    ${st?.eingerichtet ? `<div class="inline-form" style="border:0;padding:0"><label class="field"><span>Probe-SMS an (Handynummer)</span><input type="tel" id="al-sms-test" value="${esc(smsForm.test)}" placeholder="z. B. 0664 1234567"></label><button class="btn" data-action="wx-sms-test">Probe senden</button></div>` : ''}
    <div class="form-grid"><label class="field wide"><span>Stufe 2 zusätzlich per SMS an (Handynummern)</span><input type="text" id="al-officesms" value="${esc(d.officeSms || '')}" placeholder="z. B. 0664 1234567, mehrere mit Komma">${bad(d.officeSms) ? '<small class="muted">Eine Nummer ist nicht brauchbar (mit Vorwahl, nur Ziffern).</small>' : ''}</label></div>`
}

// ---------------------------------------------------------------- WhatsApp von selbst (Schnittstelle von Meta)

/** Stand am Webspace (ohne Token) und die Eingaben des Dialogs; beides nur im Speicher. */
const wa = { data: null, error: '', loading: false, at: 0 }
const waForm = { token: '', numberId: '', template: '', language: '', version: '', test: '' }

const loadWhatsapp = (force = false) => loadChannel('whatsapp', wa, force)

/** Abschnitt „WhatsApp“ im Dialog: Stand, Anleitung für Meta, Zugangsdaten, Probe. */
function whatsappSection(d) {
  const ready = !!alarmSettings().key
  if (ready && !wa.data && !wa.error) loadWhatsapp()
  const st = wa.data
  const state = !ready
    ? '<span class="muted">Zuerst den Schnee-Alarm speichern und am Webspace einrichten (Alarm-Datei), dann geht es hier weiter.</span>'
    : wa.error
    ? `<span class="pill warning">${esc(wa.error)}</span>`
    : !st
      ? '<span class="muted">Frage den Webspace …</span>'
      : st.eingerichtet
        ? `<span class="pill ok">eingerichtet</span> <span class="muted">Telefonnummer-ID ${esc(st.nummerId)}, Vorlage ${esc(st.vorlage)} (${esc(st.sprache)}), Token endet auf …${esc(st.tokenEnde)}</span>`
        : '<span class="pill info">noch nicht eingerichtet</span>'
  const url = whatsappButtonUrl(address())
  const copy = (text) => `<button class="btn small" data-action="wx-alarm-copy" data-text="${esc(text)}">${ICON.copy} kopieren</button>`
  return `<h3>WhatsApp von selbst</h3>
    <p class="note">Der Server kann den Alarm zusätzlich per WhatsApp schicken. Das geht nur über die <strong>offizielle Schnittstelle von Meta</strong> (WhatsApp Business Platform): eine eigene Absendernummer, ein Zugriffstoken und eine freigegebene Vorlage; Meta verrechnet je Nachricht ein paar Cent. Ohne das bleibt WhatsApp ein Knopf zum Selber-Schicken. Für das Wecken in der Nacht ist die ntfy-App verlässlicher: WhatsApp läutet nur, wenn das Handy WhatsApp nicht stumm schaltet.</p>
    <p id="al-wa-state">${state}</p>
    <details class="al-wa-help"><summary>So richtest du es bei Meta ein</summary>
      <ol class="note">
        <li>Auf <strong>business.facebook.com</strong> ein Unternehmenskonto anlegen (falls noch keines da ist) und unter <strong>developers.facebook.com</strong> eine App mit dem Produkt „WhatsApp“ erstellen.</li>
        <li>Eine Telefonnummer als Absender eintragen, die noch nicht in der normalen WhatsApp-App verwendet wird, und bestätigen. Meta zeigt dazu die <strong>Telefonnummer-ID</strong> (nur Ziffern).</li>
        <li>Im WhatsApp-Manager unter „Nachrichtenvorlagen“ die Vorlage unten anlegen (Kategorie „Dienstprogramm“) und auf die Freigabe warten.</li>
        <li>Für einen Systembenutzer ein <strong>dauerhaftes Zugriffstoken</strong> mit dem Recht „whatsapp_business_messaging“ erzeugen.</li>
        <li>Token, Telefonnummer-ID und Name der Vorlage hier eintragen, „Am Webspace speichern“ und eine Probe senden.</li>
      </ol>
      <div class="table-wrap"><table class="data"><tbody>
        <tr><th>Name der Vorlage</th><td><code>${esc(WHATSAPP_TEMPLATE.name)}</code></td><td>${copy(WHATSAPP_TEMPLATE.name)}</td></tr>
        <tr><th>Sprache</th><td>Deutsch (<code>${esc(WHATSAPP_TEMPLATE.language)}</code>)</td><td></td></tr>
        <tr><th>Text</th><td><code class="wrap">${esc(WHATSAPP_TEMPLATE.body)}</code></td><td>${copy(WHATSAPP_TEMPLATE.body)}</td></tr>
        <tr><th>Beispiel für {{1}}</th><td>${esc(WHATSAPP_TEMPLATE.samples[0])}</td><td></td></tr>
        <tr><th>Beispiel für {{2}}</th><td>${esc(WHATSAPP_TEMPLATE.samples[1])}</td><td></td></tr>
        <tr><th>Knopf</th><td>„Website besuchen“, Text <code>${esc(WHATSAPP_TEMPLATE.button)}</code>, Adresse dynamisch:<br><code class="wrap">${esc(url)}</code><br>Beispiel für die Variable: <code>${esc(WHATSAPP_TEMPLATE.samples[2])}</code></td><td>${copy(url)}</td></tr>
      </tbody></table></div>
      <p class="note">Der feste Text der Vorlage lässt sich ändern, solange die zwei Variablen und der Knopf mit der Adresse bleiben. Die Personen müssen dem Empfang zustimmen (im Stammblatt die Handynummer, oben das Häkchen „WhatsApp“).</p>
    </details>
    <div class="form-grid">
      <label class="field wide"><span>Zugriffstoken${st?.eingerichtet ? ' (leer lassen: bleibt, wie es ist)' : ''}</span><input type="password" id="al-wa-token" autocomplete="off" value="${esc(waForm.token)}" placeholder="${st?.eingerichtet ? `gespeichert, endet auf …${esc(st.tokenEnde)}` : 'von Meta, beginnt meist mit EAA…'}"></label>
      <label class="field"><span>Telefonnummer-ID</span><input type="text" id="al-wa-id" inputmode="numeric" value="${esc(waForm.numberId || st?.nummerId || '')}" placeholder="nur Ziffern"></label>
      <label class="field"><span>Name der Vorlage</span><input type="text" id="al-wa-template" value="${esc(waForm.template || st?.vorlage || WHATSAPP_TEMPLATE.name)}"></label>
      <label class="field"><span>Sprache der Vorlage</span><input type="text" id="al-wa-lang" value="${esc(waForm.language || st?.sprache || WHATSAPP_TEMPLATE.language)}"></label>
      <label class="field"><span>Version der Schnittstelle</span><input type="text" id="al-wa-version" value="${esc(waForm.version || st?.version || WHATSAPP_TEMPLATE.version)}"></label>
    </div>
    <p class="note">Das Token geht nur an den Webspace (Ordner <code>privat/</code>) und wird hier nicht gespeichert und nie wieder angezeigt.</p>
    <div class="toolbar"><button class="btn" data-action="wx-wa-save">Am Webspace speichern</button>${st?.eingerichtet ? '<button class="btn" data-action="wx-wa-remove">WhatsApp entfernen</button>' : ''}</div>
    ${st?.eingerichtet ? `<div class="inline-form" style="border:0;padding:0"><label class="field"><span>Probe an (Handynummer)</span><input type="tel" id="al-wa-test" value="${esc(waForm.test)}" placeholder="z. B. 0664 1234567"></label><button class="btn" data-action="wx-wa-test">Probe senden</button></div>` : ''}
    <div class="form-grid"><label class="field wide"><span>Stufe 2 zusätzlich per WhatsApp an (Handynummern)</span><input type="text" id="al-officewa" value="${esc(d.officeWhatsapp || '')}" placeholder="z. B. 0664 1234567, mehrere mit Komma">${d.officeWhatsapp && whatsappNumbers(d.officeWhatsapp).length !== String(d.officeWhatsapp).split(/[,;\n]+/).filter((x) => x.trim()).length ? '<small class="muted">Eine Nummer ist nicht brauchbar (mit Vorwahl, nur Ziffern).</small>' : ''}</label></div>`
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
      const inviteText = t ? `Hallo ${e.name},\n\nfür den Schnee-Alarm bitte die App „ntfy“ installieren (Play Store bzw. App Store), dann auf + tippen und dieses Thema abonnieren:\n\n${t}\n\n(Server: ${ntfy}, oder diesen Link öffnen: ${link})\n\nIn der App beim Thema die Benachrichtigungen auf höchste Priorität stellen und „Nicht stören“ übergehen lassen, damit der Alarm auch nachts weckt.\n\nDanke!` : ''
      const invite = t && e.email ? `mailto:${encodeURIComponent(e.email)}?subject=${encodeURIComponent('Winterdienst: Schnee-Alarm aufs Handy')}&body=${encodeURIComponent(inviteText)}` : ''
      const number = waNumber(e.phone)
      return `<tr><td>${esc(e.name)}</td><td>${t ? `<code>${esc(t)}</code>` : '<span class="muted">wird beim Speichern angelegt</span>'}</td><td>${esc(e.email || '–')}</td>
        <td class="al-handy">${number ? `<span>+${esc(number)}</span> <label class="check"><input type="checkbox" name="al-sms" value="${esc(id)}" ${d.sms?.[id] ? 'checked' : ''}><span>SMS</span></label> <label class="check"><input type="checkbox" name="al-wa" value="${esc(id)}" ${d.whatsapp?.[id] ? 'checked' : ''}><span>WhatsApp</span></label>` : '<span class="muted" title="Handynummer im Stammblatt eintragen">keine Nummer</span>'}</td>
        <td class="actions">${invite ? `<a class="btn small" href="${esc(invite)}">Einladung per E-Mail</a>` : ''}${t ? waLink({ kind: 'schnee-alarm', phone: e.phone, text: inviteText, label: 'Einladung per WhatsApp' }) : ''}${t ? `<button class="btn small" data-action="wx-alarm-copy" data-text="${esc(t)}">Thema kopieren</button><button class="btn small" data-action="wx-alarm-newtopic" data-emp="${esc(id)}" title="Wenn jemand das Thema nicht mehr bekommen soll (z. B. Handy verloren)">Neues Thema</button>` : ''}</td></tr>`
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
      <h3>Handys (ntfy), SMS und WhatsApp</h3>
      <p class="note">Jede Person installiert die kostenlose App <strong>ntfy</strong> (Android, iPhone) und abonniert ihr Thema. Beim Thema die höchste Priorität erlauben und „Nicht stören“ übergehen lassen (Android: Benachrichtigungskategorie „Höchste Priorität“ → „Nicht stören ignorieren“; iPhone: Fokus → Apps → ntfy erlauben). Das Thema wirkt wie ein Passwort: nicht weitergeben.</p>
      ${phones ? `<div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th>ntfy-Thema</th><th>E-Mail</th><th>Von selbst an die Handynummer</th><th></th></tr></thead><tbody>${phones}</tbody></table></div>` : '<p class="muted">Noch niemand ausgewählt.</p>'}
      <label class="check"><input type="checkbox" id="al-office" ${d.topics.office ? 'checked' : ''}><span>Büro-Handy in Stufe 2${d.topics.office ? `: Thema <code>${esc(d.topics.office)}</code> <button class="btn small" data-action="wx-alarm-copy" data-text="${esc(d.topics.office)}">kopieren</button>` : ''}</span></label>
      <div class="form-grid">
        <label class="field wide"><span>Stufe 2 zusätzlich per E-Mail an</span><input type="text" id="al-officeemails" value="${esc(d.officeEmails || '')}" placeholder="z. B. office@…, mehrere mit Komma"></label>
        <label class="check wide"><input type="checkbox" id="al-emaill1" ${d.emailLevel1 ? 'checked' : ''}><span>Stufe 1 zusätzlich per E-Mail (weckt nachts nicht, gut als Nachweis)</span></label>
      </div>
      ${smsSection(d)}
      ${whatsappSection(d)}
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
  'wx-alarm-open': () => {
    openModal({ type: 'wx-alarm' })
    // Stand von SMS und WhatsApp am Webspace frisch holen (zeichnet den Dialog neu, sobald er da ist)
    wa.error = ''
    sms.error = ''
    loadWhatsapp(true)
    loadChannel('sms', sms, true)
  },
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
      const file = fileFor(a, d.locations)
      const r = await post('speichern', file)
      // ab jetzt hält die App die Datei von selbst aktuell (Abwesenheiten, Teams)
      saveSettings({ ...strip(a), transferred: true }, d.locations)
      try {
        localStorage.setItem('cleanos-alarm-gesendet', hashOf(JSON.stringify(fileFor({ ...a, transferred: true }, d.locations))))
      } catch {
        /* privat */
      }
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

registerActions(
  {
    'wx-sms-save': async () => {
      readForm()
      if (!smsForm.key && !sms.data?.eingerichtet) return toast('Bitte den Schlüssel des SMS-Dienstes eintragen.')
      try {
        const r = await post('sms', { anbieter: smsForm.provider || 'seven', schluessel: smsForm.key, absender: smsForm.sender })
        Object.assign(sms, { data: r, error: '', at: Date.now() })
        smsForm.key = ''
        smsForm.sender = ''
        if (app.ui.modal?.type === 'wx-alarm') renderModal()
        toast('SMS am Webspace gespeichert. Jetzt eine Probe senden und oben anhaken, wer eine SMS bekommt.')
      } catch (err) {
        toast(`Nicht gespeichert: ${err.message}`)
      }
    },
    'wx-sms-remove': async () => {
      readForm()
      try {
        const r = await post('sms', { entfernen: true })
        Object.assign(sms, { data: r, error: '', at: Date.now() })
        Object.assign(smsForm, { key: '', sender: '', provider: '', test: '' })
        if (app.ui.modal?.type === 'wx-alarm') renderModal()
        toast('SMS entfernt: der Server schickt keine SMS mehr.')
      } catch (err) {
        toast(`Nicht entfernt: ${err.message}`)
      }
    },
    'wx-sms-test': async () => {
      readForm()
      const an = waNumber(smsForm.test)
      if (!an) return toast('Bitte eine Handynummer mit Vorwahl eintragen, z. B. 0664 1234567.')
      try {
        const r = await post('sms-test', { an })
        Object.assign(sms, { data: { ...r, gesendet: undefined }, error: '', at: Date.now() })
        if (app.ui.modal?.type === 'wx-alarm') renderModal()
        toast(`Probe-SMS an +${an} gesendet.`)
      } catch (err) {
        toast(`Probe nicht gesendet: ${err.message}`)
      }
    },
    'wx-wa-save': async () => {
      readForm()
      const body = { token: waForm.token, nummerId: waForm.numberId, vorlage: waForm.template, sprache: waForm.language, version: waForm.version }
      if (!body.token && !wa.data?.eingerichtet) return toast('Bitte das Zugriffstoken von Meta eintragen.')
      if (!/^\d{6,20}$/.test(body.nummerId)) return toast('Die Telefonnummer-ID besteht nur aus Ziffern (nicht die Telefonnummer selbst).')
      try {
        const r = await post('whatsapp', body)
        Object.assign(wa, { data: r, error: '', at: Date.now() })
        waForm.token = ''
        if (app.ui.modal?.type === 'wx-alarm') renderModal()
        toast('WhatsApp am Webspace gespeichert. Jetzt eine Probe senden und oben anhaken, wer per WhatsApp geweckt wird.')
      } catch (err) {
        toast(`Nicht gespeichert: ${err.message}`)
      }
    },
    'wx-wa-remove': async () => {
      readForm()
      try {
        const r = await post('whatsapp', { entfernen: true })
        Object.assign(wa, { data: r, error: '', at: Date.now() })
        Object.assign(waForm, { token: '', numberId: '', template: '', language: '', version: '', test: '' })
        if (app.ui.modal?.type === 'wx-alarm') renderModal()
        toast('WhatsApp entfernt: der Server schickt wieder nur Push und E-Mail.')
      } catch (err) {
        toast(`Nicht entfernt: ${err.message}`)
      }
    },
    'wx-wa-test': async () => {
      readForm()
      const an = waNumber(waForm.test)
      if (!an) return toast('Bitte eine Handynummer mit Vorwahl eintragen, z. B. 0664 1234567.')
      try {
        await post('whatsapp-test', { an })
        toast(`Probe an +${an} gesendet. Kommt nichts an: Vorlage freigegeben? Nummer bei WhatsApp?`)
      } catch (err) {
        toast(`Probe nicht gesendet: ${err.message}`)
      }
    },
  },
  { edit: 'planung' },
)

// ---------------------------------------------------------------- Protokoll-Links für Fahrer (ohne Alarm)
// Jede Person bekommt einen dauerhaften Link zum Winterdienst-Protokoll am Handy (wetter-alarm.php?aktion=protokoll&f=…):
// Objekt wählen oder Adresse eintragen, ankreuzen, Foto aufnehmen. Die Liste steht in den Einstellungen des Alarms
// (alarm.drivers) und geht mit der Alarm-Datei an den Webspace; entfernt oder „Neuer Link“ macht den alten ungültig.

/** Fahrer mit Protokoll-Link (für die Übersicht in „Wetter & Winterdienst“). */
export const winterDrivers = () => alarmDrivers(alarmSettings(), app.data?.employees || [])

function driverRows(m) {
  if (!m.rows) m.rows = winterDrivers().map((d) => ({ id: d.id, code: d.code, name: d.name, employeeId: d.employeeId }))
  return m.rows
}

/** Namen aus dem Dialog lesen; ein Name aus den Mitarbeitenden verknüpft die Person (Sprache der Seite, Austritt). */
function readDrivers() {
  const m = app.ui.modal
  if (m?.type !== 'wx-drivers') return []
  const rows = driverRows(m)
  rows.forEach((r, i) => {
    const el = document.getElementById(`wd-name-${i}`)
    if (!el) return
    r.name = el.value.trim()
    const e = (app.data.employees || []).find((x) => String(x.name || '').trim().toLowerCase() === r.name.toLowerCase())
    r.employeeId = e ? e.id : ''
  })
  return rows
}

const driverText = (name, link) => `Hallo ${String(name || '').split(' ')[0]}, hier ist dein Link für das Winterdienst-Protokoll: ${link}\nNach dem Räumen und Streuen: Objekt wählen (oder die Adresse eintragen), ankreuzen und ein Foto machen.`

function driversModal(c, m) {
  const rows = driverRows(m)
  const a = alarmSettings()
  const ed = canEdit('planung') && !app.readOnly
  const saved = new Set(winterDrivers().map((d) => d.code))
  const names = (app.data.employees || []).filter((e) => !e.exitDate || e.exitDate >= todayISO()).map((e) => e.name).sort((x, y) => String(x).localeCompare(String(y), 'de'))
  const list = rows
    .map((r, i) => {
      const link = driverLink(address(), r.code)
      const live = saved.has(r.code) && a.transferred
      const phone = r.employeeId ? empById(r.employeeId)?.phone || '' : ''
      return `<li class="wd-row">
        <label class="field"><span>Name</span><input type="text" id="wd-name-${i}" list="wd-people" value="${esc(r.name)}" placeholder="aus den Mitarbeitenden oder frei" autocomplete="off" ${ed ? '' : 'disabled'}></label>
        <label class="field wd-link"><span>Link zum Protokoll${live ? '' : ' <span class="muted">(gilt nach „Speichern und übertragen“)</span>'}</span><input type="text" value="${esc(link)}" readonly aria-label="Link für ${esc(r.name || 'neue Person')}"></label>
        <div class="actions"><button class="btn small" data-action="wx-alarm-copy" data-text="${esc(link)}">Kopieren</button>${r.name ? waLink({ kind: 'winter-link', phone, text: driverText(r.name, link), label: 'WhatsApp' }) : ''}${ed ? `<button class="btn small" data-action="wx-drivers-renew" data-idx="${i}" title="Der bisherige Link wird ungültig (z. B. Handy verloren)">Neuer Link</button><button class="btn small ghost" data-action="wx-drivers-del" data-idx="${i}">Entfernen</button>` : ''}</div>
      </li>`
    })
    .join('')
  const setup = a.transferred ? '' : `<div class="banner warn-banner"><p><strong>Am Webspace noch nicht eingerichtet.</strong> „Speichern und übertragen“ versucht es direkt. Geht das nicht, einmal „Alarm-Datei herunterladen“ und per FTP in den Ordner privat/ der App laden – danach hält die App die Datei selbst aktuell.</p></div>`
  return modalFrame({
    title: 'Protokoll-Links für Fahrer',
    subtitle: 'Winterdienst-Protokoll am Handy, ohne Anmeldung und ohne Alarm',
    wide: true,
    body: `<p>Jede Person bekommt einen eigenen, dauerhaften Link. Am Handy wählt sie das Objekt (alle Objekte mit Winterdienst, mit Adresse) oder trägt eine andere Adresse ein, kreuzt „geräumt“, „gestreut“ oder „nur kontrolliert“ an und nimmt bis zu vier Fotos auf. Die App holt Einträge und Fotos ab und legt die Fotos in SharePoint ab.</p>
      ${setup}
      ${rows.length ? `<ul class="wd-list">${list}</ul>` : '<p class="empty">Noch niemand eingetragen.</p>'}
      <datalist id="wd-people">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      ${ed ? `<button class="btn" data-action="wx-drivers-add">${ICON.plus} Person hinzufügen</button>` : ''}
      <p class="note">Der Link wirkt wie ein Schlüssel: nur an die Person selbst weitergeben. „Entfernen“ oder „Neuer Link“ macht den bisherigen nach dem Übertragen ungültig. Die Seite zeigt keine Preise und keine Daten anderer Personen.</p>`,
    foot: `<div class="actions">${ed ? `<button class="btn" data-action="wx-drivers-download">${ICON.download} Alarm-Datei herunterladen</button>` : ''}</div>
      <div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? '<button class="btn primary" data-action="wx-drivers-save">Speichern und übertragen</button>' : ''}</div>`,
  })
}
registerModal('wx-drivers', driversModal, { module: 'planung' })

/** Einstellungen mit der Liste aus dem Dialog (leere Namen fallen weg), Schlüssel ergänzt. */
function withDrivers() {
  const drivers = readDrivers()
    .filter((r) => r.name)
    .map((r) => ({ id: r.id, code: r.code, name: r.name, ...(r.employeeId ? { employeeId: r.employeeId } : {}) }))
  return complete({ ...alarmSettings(), drivers }, weatherLocations())
}

registerActions({ 'wx-drivers-open': () => openModal({ type: 'wx-drivers' }) })

registerActions(
  {
    'wx-drivers-add': () => {
      const rows = readDrivers()
      rows.push({ id: `wd${hex(4)}`, code: hex(12), name: '', employeeId: '' })
      renderModal()
      document.getElementById(`wd-name-${rows.length - 1}`)?.focus()
    },
    'wx-drivers-del': (el) => {
      readDrivers().splice(Number(el.dataset.idx), 1)
      renderModal()
    },
    'wx-drivers-renew': (el) => {
      const r = readDrivers()[Number(el.dataset.idx)]
      if (!r) return
      r.code = hex(12)
      renderModal()
      toast('Neuer Link: gilt nach „Speichern und übertragen“, der bisherige ist dann ungültig.')
    },
    'wx-drivers-download': () => {
      const a = withDrivers()
      saveSettings(strip(a))
      download('wetter-alarm.json', new Blob([`${JSON.stringify(fileFor(a, weatherLocations()), null, 2)}\n`], { type: 'application/json' }))
      closeModal()
      renderNow()
      toast('Gespeichert und heruntergeladen: wetter-alarm.json per FTP in den Ordner privat/ der App laden.')
    },
    'wx-drivers-save': async () => {
      const a = withDrivers()
      const n = (a.drivers || []).length
      saveSettings(strip(a))
      closeModal()
      renderNow()
      try {
        await post('speichern', fileFor(a, weatherLocations()))
        // ab jetzt hält die App die Datei von selbst aktuell
        saveSettings({ ...strip(a), transferred: true })
        try {
          localStorage.setItem('cleanos-alarm-gesendet', hashOf(JSON.stringify(fileFor({ ...a, transferred: true }, weatherLocations()))))
        } catch {
          /* privat */
        }
        renderNow()
        toast(`Übertragen: ${n} ${n === 1 ? 'Protokoll-Link gilt' : 'Protokoll-Links gelten'} jetzt.`)
      } catch (err) {
        toast(`Gespeichert, aber nicht übertragen: ${err.message}`)
      }
    },
  },
  { edit: 'planung' },
)

/** Entwurfsfelder, die nicht gespeichert werden (die Orte stehen bei den Regeln). */
function strip(a) {
  const { locations, ...rest } = a
  return rest
}
