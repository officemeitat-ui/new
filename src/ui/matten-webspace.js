// Mattenwechsel P10b, Büro-Seite der Fahrerseite am Webspace (mattentour.php) für Fahrer ohne Microsoft-Konto:
// Einrichten (Schlüssel, Push und E-Mail ans Büro, Frist), Tour beim Freigeben übertragen und beim Zurücknehmen
// entfernen, Fahrerliste (Hashwerte der persönlichen Links) übertragen und die Rückmeldungen der Fahrer abholen – wie bei
// Reklamationen und Online-Annahme: höchstens alle 2 Minuten, solange jemand mit Bearbeitungsrecht im Mattenwechsel die
// App offen hat, „Jetzt abholen“ sofort. Übernommen wird mit den Rechenkernen der Fahreransicht (applyWebEvents in
// core/matten-webspace.js) über die gemeinsame Touren-Ablage (Zusammenführen mit mergeTour); Fotos gehen vorher nach
// matten/fotos/…; erst wenn die Tour in SharePoint steht, meldet die App „übernommen“ (dann löscht der Webspace Fotos,
// Unterschrift und Bemerkungen). Aktionen und Dialoge mit dem Kürzel „mww-“.

import { todayISO } from '../core/dates.js'
import { emptyMatten, upgradeMatten } from '../core/matten.js'
import { normalizeDrivers } from '../core/matten-touren.js'
import { applyWebEvents, eventsByTour, isWebDriver, tourLinkMessage, tourOnWebspace, WEB_DEFAULTS, webDriversPayload, webIdentity, webLink, webTourPayload } from '../core/matten-webspace.js'
import { langOf } from '../core/sprachen.js'
import { newCode, sha256Hex } from '../core/staffplan.js'
import { ALARM_DEFAULTS } from '../core/weather.js'
import { app, canEdit, closeModal, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from './context.js'
import { tourStore } from './matten-tourablage.js'
import { checked, download, esc, modalFrame, val } from './shared.js'

const MODULE = 'matten'
const doc = () => upgradeMatten((app.data.matten ||= emptyMatten()))
const settings = () => (doc().settings ||= {})
export const webSettings = () => ({ ...WEB_DEFAULTS, ...(settings().webspace || {}) })
export const webReady = () => !!(webSettings().enabled && webSettings().key)
const address = () => new URL('.', location.href).href
const hex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
const emailOk = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim())
const nowIso = () => new Date().toISOString()
const product = () => app.config?.brand?.app || app.config?.brand?.name || 'App'
const when = (iso) => (iso ? new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const editable = () => canEdit(MODULE) && !app.readOnly

/** Zustand des Abgleichs in dieser Sitzung (für den Dialog). */
export const webState = { at: 0, running: false, error: '', open: 0, skipped: [], notes: [], timer: null, driversAt: 0 }

// ---------------------------------------------------------------- Webspace

/** Aufruf von mattentour.php mit dem Schlüssel; aktion=foto liefert das Bild (Blob). */
export async function webCall(aktion, { body, query = '', freigabe = '' } = {}) {
  const res = await fetch(`mattentour.php?aktion=${aktion}${query}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Schluessel': webSettings().key, ...(freigabe ? { 'X-Freigabe': freigabe } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  if (aktion === 'foto' && res.ok && /^image\//.test(res.headers.get('content-type') || '')) return res.blob()
  const json = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => null) : null
  if (!json) throw new Error('mattentour.php fehlt am Webspace (oder PHP ist aus).')
  if (res.status === 503) throw Object.assign(new Error('Am Webspace noch nicht eingerichtet: unter „Fahrerseite am Webspace“ speichern und übertragen oder die Datei mattentour.json nach privat/ hochladen.'), { status: 503 })
  if (res.status === 403) throw Object.assign(new Error('Der Webspace kennt einen anderen Schlüssel: mattentour.json neu herunterladen und nach privat/ hochladen.'), { status: 403 })
  if (!res.ok) throw Object.assign(new Error(json.fehler || `Antwort ${res.status}`), { status: res.status, json })
  return json
}

const ntfyServer = () => app.data?.rules?.weather?.alarm?.ntfy || ALARM_DEFAULTS.ntfy

/** Einstellungen für privat/mattentour.json (nur, was der Webspace braucht). */
export function webSettingsFile(s = webSettings()) {
  const buero = []
  if (s.officeTopic) buero.push({ name: 'Büro-Handy', ntfy: s.officeTopic })
  for (const email of String(s.officeEmails || '').split(/[,;\s]+/).filter(emailOk)) buero.push({ name: 'Büro', email })
  return { version: 1, schluessel: s.key, adresse: address(), ntfy: ntfyServer(), absender: emailOk(s.sender) ? s.sender.trim() : '', buero, frist: Number(s.keepDays) || WEB_DEFAULTS.keepDays }
}

/** Einstellungen an den Webspace; beim ersten Mal mit dem Schlüssel von Plan am Handy, Schnee-Alarm oder Kundenbereich. */
async function setup() {
  const body = webSettingsFile()
  try {
    return await webCall('einrichten', { body })
  } catch (err) {
    if (err.status !== 503) throw err
    const andere = [app.data?.rules?.portal?.key, app.data?.rules?.weather?.alarm?.key, app.data?.kundenbereich?.settings?.key].filter((k) => typeof k === 'string' && k.length >= 32)
    for (const freigabe of andere) {
      try {
        return await webCall('einrichten', { body, freigabe })
      } catch (e) {
        if (e.status !== 503) throw e
      }
    }
    throw err
  }
}

// ---------------------------------------------------------------- Fahrer ohne Konto: Link

/** Code von „Plan am Handy“ der Person (nur wer die Stammdaten liest und Plan am Handy eingeschaltet hat). */
const portalCode = (employeeId) => {
  const p = app.data?.rules?.portal
  const c = employeeId && p?.enabled ? p.codes?.[employeeId] : ''
  return typeof c === 'string' && /^[A-Za-z0-9]{16,40}$/.test(c) ? c : ''
}

/**
 * Fahrer ohne Konto vor dem Speichern ergänzen: ein schon vorhandener Link bleibt (Plan am Handy: Hashwert und Sprache
 * frisch, wenn lesbar). Neu: Person mit Link von Plan am Handy → dessen Hashwert (der Code bleibt in den Stammdaten) und
 * ihre Sprache; sonst ein eigener Code (wie bei Plan am Handy erzeugt) mit Hashwert. „Neuer Link“ entfernt web vorher.
 */
export async function completeWebDrivers(rows) {
  const out = []
  for (const r of rows) {
    if (!r.webspace) {
      const x = { ...r }
      delete x.web
      delete x.lang
      delete x.webspace
      out.push(x)
      continue
    }
    const code = portalCode(r.employeeId)
    const emp = r.employeeId ? (app.data?.employees || []).find((e) => e.id === r.employeeId) : null
    const keep = r.web?.hash && (r.web.from === 'mein-plan' || r.web.code)
    if (code && (!keep || r.web.from === 'mein-plan')) out.push({ ...r, lang: emp ? langOf(emp) : r.lang || 'de', web: { from: 'mein-plan', hash: await sha256Hex(code) } })
    else if (keep) out.push(r)
    else {
      const c = newCode()
      out.push({ ...r, web: { from: 'eigen', code: c, hash: await sha256Hex(c) } })
    }
  }
  return out
}

/** Kennung des Fahrers für die Tour (Hashwert frisch aus Plan am Handy, wenn lesbar). */
export async function webIdentityFor(driver) {
  if (!isWebDriver(driver)) return null
  const code = driver.web?.from === 'mein-plan' ? portalCode(driver.employeeId) : ''
  return webIdentity(driver, { hash: code ? await sha256Hex(code) : '' })
}

/** Link und Nachricht eines Fahrers mit eigenem Code (sonst null: er nutzt den Link von Plan am Handy). */
export function webLinkOf(driver) {
  if (!driver?.web?.code) return null
  const link = webLink(address(), driver.web.code)
  return { link, ...tourLinkMessage(driver.lang || 'de', { name: driver.name, product: product(), link }) }
}

/** Fahrerliste an den Webspace (Link gilt sofort, Sprache; nicht mehr genannte gelten nicht mehr). */
export async function pushWebDrivers() {
  if (!webReady()) return null
  const res = await webCall('fahrer', { body: { fahrer: webDriversPayload(normalizeDrivers(settings().drivers)) } })
  webState.driversAt = Date.now()
  return res
}

// ---------------------------------------------------------------- Tour übertragen und zurückziehen

/** Stand der Übertragung an der Tour vermerken (ohne Sperre des Büros: nur dieses Feld). */
async function markTour(id, change) {
  const st = tourStore()
  if (!st?.byId(id)) return
  await st.update(id, (t) => {
    const w = { ...(t.webspace || {}), ...change }
    for (const [k, v] of Object.entries(w)) if (v === undefined) delete w[k]
    return { ...t, webspace: w }
  })
}

/** Tour an den Webspace (beim Freigeben, „Erneut übertragen“, Abgleich). Liefert true bzw. wirft nicht: Fehler steht an der Tour. */
export async function publishWebTour(tour) {
  if (!tourOnWebspace(tour)) return false
  const payload = webTourPayload(tour, { hash: tour.webspace.hash, name: tour.webspace.name || tour.driverName, lang: tour.webspace.lang })
  try {
    if (!webReady()) throw new Error('Fahrerseite am Webspace ist nicht eingerichtet („Mehr“ → „Fahrerseite am Webspace“).')
    await webCall('tour', { body: payload })
    await markTour(tour.id, { publishedAt: nowIso(), error: undefined })
    return true
  } catch (err) {
    await markTour(tour.id, { error: String(err?.message || err) })
    return false
  }
}

/** Tour vom Webspace nehmen (Freigabe zurücknehmen). Hat der Fahrer schon gemeldet: Fehler mit status 409. */
export async function withdrawWebTour(tour) {
  if (!tourOnWebspace(tour)) return
  await webCall('tour-entfernen', { body: { id: tour.id } })
}

// ---------------------------------------------------------------- Rückmeldungen abholen

/**
 * Meldungen vom Webspace übernehmen (höchstens alle 2 Minuten, force: sofort). Je Tour: frisch lesen, Fotos nach
 * SharePoint (fester Pfad), Meldungen anwenden und speichern; erst danach „übernommen“ an den Webspace. Nebenbei: nicht
 * übertragene Touren nachholen, Fahrerliste einmal je Sitzung. Liefert die Zahl der übernommenen Meldungen.
 */
export async function syncWebspace({ force = false } = {}) {
  if (!webReady() || !canEdit(MODULE) || app.readOnly || webState.running) return 0
  if (!force && Date.now() - webState.at < 120e3) return 0
  const st = tourStore()
  if (!st) return 0
  webState.running = true
  webState.at = Date.now()
  let taken = 0
  const skipped = []
  const notes = []
  try {
    if (!webState.driversAt) await pushWebDrivers().catch(() => null)
    const { meldungen = [] } = await webCall('meldungen')
    webState.open = meldungen.length
    for (const [id, evs] of eventsByTour(meldungen)) {
      // je Tour für sich: ein Fehler hält die übrigen Touren nicht auf (die Meldungen dieser Tour bleiben am Webspace)
      try {
        const date = String(evs.find((m) => m.datum)?.datum || '')
        if (!st.byId(id) && /^\d{4}-/.test(date)) await st.load({ years: [date.slice(0, 4)] })
        if (!st.byId(id)) {
          skipped.push({ tour: id, reason: 'Tour nicht in SharePoint gefunden' })
          continue
        }
        const fresh = (await st.refresh(id)) || st.byId(id)
        const plan = applyWebEvents(fresh, evs, { now: nowIso() })
        // Fotos zuerst nach SharePoint; geht eines nicht, bleibt die Tour für den nächsten Abgleich am Webspace. Fehlt ein
        // Foto am Webspace (404), wird das am Stopp als „Foto fehlt“ vermerkt und der Rest übernommen.
        const missing = []
        if (app.store?.kind === 'sharepoint') {
          for (const u of plan.uploads) {
            const blob = await webCall('foto', { query: `&datei=${encodeURIComponent(u.datei)}` }).catch((err) => {
              if (err?.status === 404) return null
              throw err
            })
            if (!blob) {
              missing.push(u.datei)
              continue
            }
            const up = await app.store.upload(u.path, blob, 'image/jpeg')
            if (up?.queued) throw new Error('Ohne Verbindung zu SharePoint: die Rückmeldungen bleiben am Webspace und werden später übernommen.')
          }
        }
        let result = plan
        await st.update(id, (cur) => (result = applyWebEvents(cur, evs, { now: nowIso(), missing })).tour)
        await st.flush()
        if (st.isPending(id)) continue // noch nicht in SharePoint: nächster Abgleich
        if (result.done.length) await webCall('uebernommen', { body: { ids: result.done } })
        taken += result.applied.length
        skipped.push(...result.skipped.map((x) => ({ ...x, tour: id })))
        notes.push(...result.notes.map((x) => ({ ...x, tour: id })))
      } catch (err) {
        skipped.push({ tour: id, reason: String(err?.message || err) })
      }
    }
    // nicht übertragene Touren (Fehler beim Freigeben, ohne Netz) nachholen
    const today = todayISO()
    for (const t of st.tours()) {
      if (tourOnWebspace(t) && ['freigegeben', 'unterwegs'].includes(t.status) && t.date >= today && (!t.webspace.publishedAt || t.webspace.error)) await publishWebTour(t)
    }
    webState.error = ''
    webState.skipped = skipped
    webState.notes = notes
  } catch (err) {
    webState.error = String(err?.message || err)
  }
  webState.running = false
  const lost = notes.reduce((n, x) => n + (x.missing || 0), 0)
  if (taken) {
    toast(`${taken === 1 ? 'Eine Rückmeldung' : `${taken} Rückmeldungen`} von der Fahrerseite am Webspace übernommen${lost ? ` – ${lost === 1 ? 'ein Foto fehlt' : `${lost} Fotos fehlen`} (am Webspace nicht mehr vorhanden, steht an der Tour)` : ''}.`)
    if (['mw-planung', 'mw-touren', 'mw-kalender'].includes(app.ui.view) && !app.ui.modal) renderNow()
  }
  if (app.ui.modal?.type === 'mww-web') renderModal()
  return taken
}

/** Abholen im Hintergrund starten (aus „Zu erledigen“ und der Tourenplanung; einmal je Sitzung). */
export function startWebPolling() {
  if (webState.timer || typeof window === 'undefined' || !webReady() || !canEdit(MODULE)) return
  webState.timer = setInterval(() => syncWebspace(), 120e3)
  document.addEventListener?.('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncWebspace()
  })
  setTimeout(() => syncWebspace(), 2000)
}

// ---------------------------------------------------------------- In der Tourenplanung

/** Hinweis an einer Tour des Fahrers ohne Konto (HTML). */
export function webTourNote(t, { ed = false } = {}) {
  if (!tourOnWebspace(t) || t.status === 'entwurf') return ''
  const w = t.webspace
  const done = (t.stops || []).filter((s) => s.web?.event).length
  const retry = ed ? `<button class="btn small" data-action="mww-web-publish" data-tour="${esc(t.id)}">Erneut übertragen</button>` : ''
  if (w.error) return `<div class="banner warn-banner mww-note" role="status"><p><strong>Fahrerseite am Webspace:</strong> noch nicht übertragen – ${esc(w.error)}</p>${retry}</div>`
  // Fotos, die beim Abholen am Webspace fehlten (web.fotosFehlen, siehe applyWebEvents)
  const lost = (t.stops || []).map((s, i) => [i + 1, s.web?.fotosFehlen || 0]).filter(([, n]) => n)
  const lostHtml = lost.length ? `<div class="banner warn-banner mww-note mww-foto-fehlt" role="status"><p><strong>Foto fehlt:</strong> ${esc(lost.map(([no, n]) => `Stopp ${no}: ${n === 1 ? 'ein Foto' : `${n} Fotos`}`).join(', '))} vom Fahrer war am Webspace nicht mehr vorhanden. Die übrige Rückmeldung ist übernommen.</p></div>` : ''
  return `${lostHtml}<p class="note mww-note">Fahrer ohne Konto: Tour auf der Fahrerseite am Webspace${w.publishedAt ? ` (übertragen ${esc(when(w.publishedAt))})` : ' (wird übertragen)'}${done ? `, ${plural(done, 'Stopp', 'Stopps')} von dort übernommen` : ''}.</p>`
}

// ---------------------------------------------------------------- Dialog „Fahrerseite am Webspace“

function draft(m) {
  if (!m.d) m.d = { ...webSettings() }
  return m.d
}
function readForm(m) {
  const d = draft(m)
  if (!document.getElementById('mww-web-on')) return d
  Object.assign(d, { enabled: checked('mww-web-on'), officeTopic: val('mww-web-topic').trim(), officeEmails: val('mww-web-mails').trim(), sender: val('mww-web-sender').trim(), keepDays: Number(val('mww-web-keep')) || WEB_DEFAULTS.keepDays })
  return d
}

registerModal(
  'mww-web',
  (c, m) => {
    const ed = editable()
    const dis = ed ? '' : 'disabled'
    const d = draft(m)
    const list = normalizeDrivers(settings().drivers).filter(isWebDriver)
    const status = webState.error
      ? `<div class="banner warn-banner"><p>${esc(webState.error)}</p></div>`
      : webState.at
        ? `<p class="note">Zuletzt abgeholt ${esc(when(new Date(webState.at).toISOString()))}${webState.skipped.length ? `; ${plural(webState.skipped.length, 'Meldung bleibt', 'Meldungen bleiben')} am Webspace (${esc(webState.skipped.map((x) => x.reason).join('; '))})` : ''}${webState.notes.length ? `; ${esc(webState.notes.map((x) => x.reason).join('; '))}` : ''}.</p>`
        : ''
    // Fotos, die beim Abholen am Webspace fehlten (bleibt an der Tour, auch nach dem nächsten Abholen)
    const lost = (tourStore()?.tours() || []).filter((t) => (t.stops || []).some((s) => s.web?.fotosFehlen)).sort((a, b) => String(b.date).localeCompare(String(a.date)))
    const lostHtml = lost.length ? `<p class="note mww-foto-fehlt">Foto fehlt (am Webspace nicht mehr vorhanden) bei ${plural(lost.length, 'Tour', 'Touren')}: ${esc(lost.slice(0, 5).map((t) => `${t.date.split('-').reverse().join('.')} ${t.driverName || ''}`.trim()).join(', '))}${lost.length > 5 ? ' …' : ''}. Hinweis an der Tour in der Tourenplanung.</p>` : ''
    return modalFrame({
      title: 'Fahrerseite am Webspace',
      wide: true,
      body: `<p>Für Fahrer <strong>ohne Microsoft-Konto</strong>: Sie öffnen ihre Tour mit einem persönlichen Link am Handy (mattentour.php, ohne Anmeldung), bestätigen je Liegeplatz, machen Fotos und lassen unterschreiben. Die App überträgt beim Freigeben nur, was der Fahrer braucht (keine Preise, kein Kundenstamm), holt die Rückmeldungen ab und legt sie in SharePoint ab. Fotos und Unterschriften bleiben am Webspace nur bis zur Übernahme, alles andere höchstens bis zur Frist.</p>
        <label class="check"><input type="checkbox" id="mww-web-on" ${d.enabled ? 'checked' : ''} ${dis}><span><strong>Fahrerseite einschalten</strong></span></label>
        <div class="form-grid">
          <label class="field"><span>Büro-Handy (Push-Thema, optional)</span><input type="text" id="mww-web-topic" value="${esc(d.officeTopic)}" placeholder="z. B. buero-matten" ${dis}></label>
          <label class="field"><span>E-Mail ans Büro (optional)</span><input type="text" id="mww-web-mails" value="${esc(d.officeEmails)}" placeholder="z. B. buero@firma.example" ${dis}></label>
          <label class="field"><span>Absender der E-Mails (optional)</span><input type="email" id="mww-web-sender" value="${esc(d.sender)}" ${dis}></label>
          <label class="field"><span>Am Webspace höchstens</span><select id="mww-web-keep" ${dis}>${[7, 14, 30].map((n) => `<option value="${n}"${Number(d.keepDays) === n ? ' selected' : ''}>${n} Tage nach dem Tag der Tour</option>`).join('')}</select></label>
        </div>
        <p class="note">Push und E-Mail ans Büro gibt es bei einer Ausnahme (z. B. „Kunde nicht angetroffen“) und wenn eine Tour fertig ist – ohne Kundennamen.</p>
        <h4>Fahrer ohne Konto</h4>
        ${list.length ? `<ul class="mww-list">${list.map((x) => `<li><strong>${esc(x.name)}</strong> – ${x.web?.from === 'mein-plan' ? 'Link von „Plan am Handy“' : x.web?.code ? 'eigener Link' : 'noch kein Link (im Dialog „Fahrer“ speichern)'}</li>`).join('')}</ul>` : '<p class="muted">Noch niemand. Im Dialog „Fahrer (Mattenwechsel)“ bei einem Fahrer „ohne Microsoft-Konto“ ankreuzen.</p>'}
        ${status}${lostHtml}
        <p class="note">Einmalig am Webspace: „Speichern und übertragen“ richtet ihn direkt ein, wenn dort schon Plan am Handy, der Schnee-Alarm oder der Kundenbereich läuft. Sonst „Einrichtungs-Datei herunterladen“ und mattentour.json in den Ordner privat/ hochladen.</p>`,
      foot: `<div class="actions">${ed && webSettings().key ? '<button class="btn" data-action="mww-web-file">Einrichtungs-Datei herunterladen</button>' : ''}${webReady() ? '<button class="btn" data-action="mww-web-sync">Jetzt abholen</button>' : ''}</div><div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? '<button class="btn primary" data-action="mww-web-save">Speichern und übertragen</button>' : ''}</div>`,
    })
  },
  { module: MODULE },
)

async function saveWeb() {
  const d = readForm(app.ui.modal)
  for (const e of String(d.officeEmails || '').split(/[,;\s]+/).filter(Boolean)) if (!emailOk(e)) return toast(`E-Mail prüfen: ${e}`)
  if (d.officeTopic && !/^[A-Za-z0-9_-]{1,64}$/.test(d.officeTopic)) return toast('Push-Thema: nur Buchstaben, Ziffern, - und _.')
  settings().webspace = { ...d, key: d.key || webSettings().key || hex(32) }
  persist()
  if (!d.enabled) {
    closeModal()
    return toast('Gespeichert. Die Fahrerseite ist aus; die App überträgt nichts.')
  }
  try {
    await setup()
    await pushWebDrivers()
    closeModal()
    toast('Fahrerseite am Webspace eingerichtet.')
    startWebPolling()
  } catch (err) {
    webState.error = err.message
    renderModal()
    toast(err.status === 503 ? 'Gespeichert. Am Webspace noch nicht eingerichtet: Einrichtungs-Datei herunterladen und nach privat/ hochladen.' : `Gespeichert, aber nicht übertragen: ${err.message}`)
  }
}

registerActions({
  'mww-web-open': () => openModal({ type: 'mww-web' }),
  'mww-copy': async (el) => {
    try {
      await navigator.clipboard.writeText(el.dataset.text)
      toast('Link kopiert.')
    } catch {
      toast(el.dataset.text)
    }
  },
})

registerActions(
  {
    'mww-web-save': () => saveWeb(),
    'mww-web-file': () => {
      download('mattentour.json', new Blob([`${JSON.stringify(webSettingsFile(), null, 2)}\n`], { type: 'application/json' }))
      toast('mattentour.json in den Ordner privat/ am Webspace hochladen (wie die Datei von Plan am Handy).')
    },
    'mww-web-sync': async () => {
      const n = await syncWebspace({ force: true })
      if (!n) toast(webState.error ? `Nicht abgeholt: ${webState.error}` : 'Keine neuen Rückmeldungen.')
    },
    'mww-web-publish': async (el) => {
      const t = tourStore()?.byId(el.dataset.tour)
      if (!t) return
      const ok = await publishWebTour(t)
      toast(ok ? 'Tour an die Fahrerseite übertragen.' : `Nicht übertragen: ${tourStore().byId(t.id)?.webspace?.error || ''}`)
      renderNow()
    },
  },
  { edit: MODULE },
)
