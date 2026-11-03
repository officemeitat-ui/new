// Systemcheck für die Inbetriebnahme (nur Vollzugriff): prüft vom Browser aus, ob der Webspace und
// die Einrichtung passen: HTTPS, Sicherheitsregeln (.htaccess), Ordner privat/ gesperrt, PHP-Version
// und Erweiterungen (system.php), Webspace erreicht das Internet, Schnee-Alarm und Plan am Handy
// (Datei, Schlüssel, Cronjob), Microsoft-Anmeldung und SharePoint. Je Punkt ein Hinweis, was zu tun ist.

import { app, registerActions, registerView, renderNow, toast } from '../context.js'
import { esc, ICON } from '../shared.js'
import { portalSettings } from '../staffplan.js'
import { alarmSettings } from './weather-alarm.js'

const MARK = { ok: ['✓', 'ok'], warn: ['!', 'warning'], error: ['✗', 'error'], info: ['i', 'info'] }
const ago = (s) => {
  const min = Math.round((Date.now() / 1000 - s) / 60)
  return min < 1 ? 'gerade eben' : min < 120 ? `vor ${min} min` : min < 2880 ? `vor ${Math.round(min / 60)} h` : `vor ${Math.round(min / 1440)} Tagen`
}
const json = async (url, opts = {}) => {
  const r = await fetch(url, { cache: 'no-store', ...opts })
  return { status: r.status, data: (r.headers.get('content-type') || '').includes('json') ? await r.json().catch(() => null) : null, headers: r.headers }
}

/** Alle Prüfungen; liefert [{ group, label, status, detail, fix }]. */
export async function runChecks() {
  const out = []
  const add = (group, label, status, detail = '', fix = '') => out.push({ group, label, status, detail, fix })
  const local = ['localhost', '127.0.0.1'].includes(location.hostname)
  const W = 'Webspace (World4You)'

  // ---- Webspace
  add(W, 'HTTPS', location.protocol === 'https:' ? 'ok' : local ? 'info' : 'error', location.origin, 'Im World4You-Kundenbereich für die Subdomain das SSL-Zertifikat (Let\'s Encrypt) aktivieren und auf https weiterleiten. Ohne HTTPS geht die Microsoft-Anmeldung nicht.')
  try {
    const r = await fetch('index.html', { cache: 'no-store' })
    const csp = r.headers.get('content-security-policy')
    add(W, 'Sicherheitsregeln (.htaccess)', csp ? 'ok' : local ? 'info' : 'warn', csp ? 'Content-Security-Policy aktiv' : 'kein Sicherheits-Header', 'Die Datei .htaccess im Hauptordner mit hochladen (versteckte Datei, in FileZilla „versteckte Dateien anzeigen“). Ist sie da, fehlt beim Hoster das Modul mod_headers: bei World4You nachfragen. Die App läuft trotzdem.')
  } catch (err) {
    add(W, 'Sicherheitsregeln (.htaccess)', 'warn', err.message)
  }
  let open = []
  for (const f of ['privat/wetter-alarm.json', 'privat/mitarbeiter.json', 'privat/.htaccess']) {
    try {
      if ((await fetch(f, { cache: 'no-store' })).status === 200) open.push(f)
    } catch {
      /* nicht erreichbar = gut */
    }
  }
  add(W, 'Ordner privat/ gesperrt', open.length ? 'error' : 'ok', open.length ? `von außen lesbar: ${open.join(', ')}` : 'von außen nicht lesbar', 'Die Datei privat/.htaccess hochladen (liegt im Paket). Bis dahin keine Einrichtungsdateien in privat/ legen.')

  const key = alarmSettings().key || portalSettings().key
  let sys = null
  try {
    sys = (await json('system.php', { headers: key ? { 'X-Schluessel': key } : {} })).data
  } catch {
    sys = null
  }
  if (!sys) {
    add(W, 'PHP', 'error', 'system.php antwortet nicht', 'Im World4You-Kundenbereich PHP für die Subdomain einschalten (Version 8.x) und system.php mit hochladen. Ohne PHP fehlen Schnee-Alarm, Plan am Handy, Zeiterfassung und der Wetter-Umweg; Dienstplan und Werkzeuge laufen.')
  } else {
    add(W, 'PHP-Version', sys.php.ok ? 'ok' : 'error', sys.php.version ? `PHP ${sys.php.version}` : sys.php.ok ? '8 oder neuer' : 'älter als 8', 'Im World4You-Kundenbereich PHP 8.0 oder neuer einstellen (mein-plan.php braucht PHP 8).')
    const ext = sys.erweiterungen || {}
    const missingHard = ['json', 'mbstring'].filter((x) => !ext[x])
    const missingSoft = ['curl', 'openssl', 'fileinfo'].filter((x) => !ext[x])
    add(W, 'PHP-Erweiterungen', missingHard.length ? 'error' : missingSoft.length ? 'warn' : 'ok', missingHard.length || missingSoft.length ? `fehlt: ${[...missingHard, ...missingSoft].join(', ')}` : 'json, mbstring, curl, openssl, fileinfo', 'Beim Hoster einschalten lassen. curl/openssl: Abfragen an GeoSphere und ntfy; fileinfo: Prüfung der Fotos.')
    add(W, 'Ordner privat/ beschreibbar', sys.privat.beschreibbar ? 'ok' : 'error', sys.privat.vorhanden ? (sys.privat.beschreibbar ? 'ja' : 'nicht beschreibbar') : 'fehlt', 'Den Ordner privat/ (aus dem Paket) hochladen und per FTP Schreibrechte geben (Rechte 755 bzw. 775).')
    add(W, 'Upload-Grenze für Fotos', sys.upload.ok ? 'ok' : 'warn', `${Math.round(sys.upload.bytes / 1024 / 1024)} MB`, 'Für Winterdienst-Fotos upload_max_filesize und post_max_size auf mindestens 8 MB stellen (World4You: PHP-Einstellungen).')
    if (sys.speicherFrei) add(W, 'Freier Speicher', sys.speicherFrei > 500 * 1024 ** 2 ? 'ok' : 'warn', `${(sys.speicherFrei / 1024 ** 3).toFixed(1).replace('.', ',')} GB`, 'Speicher am Webspace aufräumen oder Paket vergrößern.')
  }
  try {
    const r = await json('wetter.php?art=warnungen&lat=47.8095&lon=13.055')
    add(W, 'Webspace erreicht das Internet', r.status === 200 && r.data ? 'ok' : 'warn', r.status === 200 ? 'GeoSphere über wetter.php erreichbar' : `wetter.php: Antwort ${r.status}`, 'Der Webspace muss GeoSphere und ntfy erreichen (Schnee-Alarm, Push). Bei World4You nachfragen, ob ausgehende Verbindungen gesperrt sind.')
  } catch (err) {
    add(W, 'Webspace erreicht das Internet', 'warn', err.message)
  }

  // ---- Schnee-Alarm
  const S = 'Schnee-Alarm'
  const a = alarmSettings()
  if (!a.enabled) add(S, 'Schnee-Alarm', 'info', 'ausgeschaltet')
  else {
    add(S, 'Alarm-Datei in privat/', sys?.dateien.wetterAlarm ? 'ok' : 'error', sys?.dateien.wetterAlarm ? 'vorhanden' : 'fehlt', 'Wetter & Winterdienst → Alarm einrichten → „Alarm-Datei herunterladen“ und per FTP nach privat/ laden.')
    try {
      const r = await json('wetter-alarm.php?aktion=status', { headers: { 'X-Schluessel': a.key } })
      add(S, 'Schlüssel stimmt', r.status === 200 ? 'ok' : 'error', r.status === 200 ? 'App und Webspace passen zusammen' : `Antwort ${r.status}`, r.status === 403 ? 'Der Webspace kennt einen anderen Schlüssel: Alarm-Datei neu herunterladen und nach privat/ laden.' : 'wetter-alarm.php mit hochladen.')
    } catch (err) {
      add(S, 'Schlüssel stimmt', 'error', err.message)
    }
    const last = sys?.cron?.wetterAlarm
    add(S, 'Cronjob (alle 10 Minuten)', last && Date.now() / 1000 - last < 30 * 60 ? 'ok' : 'warn', last ? `zuletzt ${ago(last)}` : 'noch nie gelaufen', 'Cronjob anlegen: im World4You-Kundenbereich „php wetter-alarm.php“ im Ordner der App, oder bei cron-job.org die Adresse aus „Alarm einrichten“ alle 10 Minuten aufrufen.')
  }

  // ---- Plan am Handy
  const H = 'Plan am Handy'
  const p = portalSettings()
  if (!p.enabled) add(H, 'Plan am Handy', 'info', 'ausgeschaltet')
  else {
    add(H, 'Einrichtungs-Datei in privat/', sys?.dateien.mitarbeiter ? 'ok' : 'error', sys?.dateien.mitarbeiter ? 'vorhanden' : 'fehlt', 'Mitarbeitende → Plan am Handy → „Einrichtungs-Datei herunterladen“ und mitarbeiter.json per FTP nach privat/ laden.')
    try {
      const r = await json('mein-plan.php?aktion=antraege', { headers: { 'X-Schluessel': p.key } })
      add(H, 'Schlüssel stimmt', r.status === 200 ? 'ok' : 'error', r.status === 200 ? 'App und Webspace passen zusammen' : `Antwort ${r.status}`, r.status === 403 ? 'mitarbeiter.json neu herunterladen und nach privat/ laden.' : 'mein-plan.php mit hochladen.')
    } catch (err) {
      add(H, 'Schlüssel stimmt', 'error', err.message)
    }
    if (p.timeclock && Number(p.alarmMin) > 0) {
      const last = sys?.cron?.meinPlan
      add(H, 'Cronjob Zeiterfassung (Nichterscheinen)', last && Date.now() / 1000 - last < 30 * 60 ? 'ok' : 'warn', last ? `zuletzt ${ago(last)}` : 'noch nie gelaufen', 'Zweiten Cronjob alle 5–10 Minuten: „php mein-plan.php pruefen“ oder die Adresse aus dem Dialog „Plan am Handy“.')
    }
  }

  // ---- KI-Assistent (ki.php, Claude-API)
  const K = 'KI-Assistent'
  if (app.config.assistant === false) add(K, 'KI-Assistent', 'info', 'ausgeschaltet (config.json)')
  else {
    try {
      const { kiRequest } = await import('../../ai/agent.js')
      const st = await kiRequest('status')
      add(K, 'Eingerichtet', st.eingerichtet ? (st.aktiv ? 'ok' : 'warn') : 'info', st.eingerichtet ? `${st.modellName || st.modell}${st.aktiv ? '' : ', ausgeschaltet'}` : 'noch kein API-Schlüssel', 'Assistent (Kopfleiste) → Einstellungen: API-Schlüssel von console.anthropic.com eintragen.')
      if (st.php?.zeitlimit && st.php.zeitlimit < 120) add(K, 'PHP-Zeitlimit', 'warn', `${st.php.zeitlimit} s`, 'Längere Aufgaben brauchen bis zu 3 Minuten: max_execution_time im World4You-Kundenbereich auf 180 stellen.')
    } catch (err) {
      add(K, 'ki.php', err.status === 401 ? 'info' : 'warn', err.status === 401 ? 'nur mit Microsoft-Anmeldung prüfbar' : err.message, 'ki.php mit hochladen (liegt im Paket).')
    }
  }

  // ---- Microsoft und SharePoint
  const M = 'Microsoft 365 und SharePoint'
  const sp = app.config.sharepoint || {}
  if (app.store?.kind === 'sharepoint') add(M, 'Daten in SharePoint', 'ok', `${sp.siteUrl || ''} → ${sp.library || ''}/${sp.folder || ''}`)
  else add(M, 'Daten in SharePoint', app.config.storage === 'sharepoint' ? 'error' : local ? 'info' : 'warn', 'Browser-Modus: Daten nur in diesem Browser', 'In config.json bzw. config.production.json "storage": "sharepoint" mit siteUrl, library und folder eintragen (docs/EINRICHTUNG.md, Schritt 3).')
  add(M, 'Anwendungs-ID (Entra ID)', sp.clientId ? 'ok' : app.config.storage === 'sharepoint' ? 'error' : 'info', sp.clientId ? 'eingetragen' : 'fehlt', 'App in Entra ID registrieren (Single-Page-Anwendung, Umleitung https://app.cleanos.at/) und die Anwendungs-ID eintragen (Schritt 2).')
  add(M, 'Angemeldet', app.user ? 'ok' : 'info', app.user ? `${app.user.name || ''}${app.access?.roles?.length ? ` · ${app.access.roles.join(', ')}` : ''}` : 'ohne Anmeldung (Browser-Modus)')
  add(M, 'Daten geladen', app.data?.employees?.length && app.data?.objects?.length ? 'ok' : 'warn', `${app.data?.employees?.length || 0} Mitarbeitende, ${app.data?.objects?.length || 0} Objekte`, 'Noch leer: unter Mitarbeitende bzw. Objekte & Leistungen aus Excel einfügen.')
  return out
}

function systemView() {
  const res = app.ui.systemCheck
  if (!res && !app.ui.systemRunning) {
    app.ui.systemRunning = true
    runChecks().then((r) => {
      app.ui.systemCheck = { at: new Date(), items: r }
      app.ui.systemRunning = false
      if (app.ui.view === 'system') renderNow()
    })
  }
  const items = res?.items || []
  const count = (s) => items.filter((x) => x.status === s).length
  const groups = [...new Set(items.map((x) => x.group))]
  const summary = !res ? '<p class="muted">Prüfe …</p>' : count('error') ? `<div class="banner warn-banner"><p><strong>${count('error')} ${count('error') === 1 ? 'Punkt muss' : 'Punkte müssen'} noch erledigt werden</strong>${count('warn') ? `, ${count('warn')} ${count('warn') === 1 ? 'Hinweis' : 'Hinweise'}` : ''}.</p></div>` : `<div class="banner"><p><strong>Bereit.</strong> ${count('warn') ? `${count('warn')} ${count('warn') === 1 ? 'Hinweis' : 'Hinweise'} ansehen.` : 'Alles in Ordnung.'}</p></div>`
  const list = groups
    .map((g) => `<section><h3>${esc(g)}</h3><ul class="sys-list">${items
      .filter((x) => x.group === g)
      .map((x) => `<li class="sys-${x.status}"><span class="flag ${MARK[x.status][1]}">${MARK[x.status][0]}</span><div><strong>${esc(x.label)}</strong> <span class="muted">${esc(x.detail)}</span>${x.status === 'error' || x.status === 'warn' ? `<br><small>${esc(x.fix)}</small>` : ''}</div></li>`)
      .join('')}</ul></section>`)
    .join('')
  return `<div class="section-head"><div><h2>Systemcheck</h2><p>Prüft für die Inbetriebnahme, ob Webspace, Einrichtung und Microsoft 365 zusammenpassen. Nur lesend; es wird nichts verändert.</p></div>
      <div class="actions"><button class="btn" data-action="system-copy" ${res ? '' : 'disabled'}>${ICON.copy} Bericht kopieren</button><button class="btn primary" data-action="system-run">${ICON.refresh} Erneut prüfen</button></div></div>
    ${summary}${list}${res ? `<p class="note">Stand ${esc(res.at.toLocaleString('de-AT'))}</p>` : ''}`
}

registerView({ id: 'system', order: 130, label: 'Systemcheck', group: 'stamm', module: 'stammdaten', noWeek: true, available: () => !app.access || !!app.access.all, text: 'Inbetriebnahme prüfen', render: systemView })

registerActions({
  'system-run': () => {
    app.ui.systemCheck = null
    app.ui.systemRunning = false
    renderNow()
  },
  'system-copy': async () => {
    const res = app.ui.systemCheck
    if (!res) return
    const text = [`Systemcheck ${location.origin}, ${res.at.toLocaleString('de-AT')}`, ...res.items.map((x) => `[${x.status.toUpperCase()}] ${x.group} · ${x.label}: ${x.detail}`)].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast('Bericht kopiert.')
    } catch {
      toast('Kopieren nicht möglich.')
    }
  },
})
