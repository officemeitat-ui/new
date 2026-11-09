// Einrichtung: Die App ist hochgeladen, aber noch nicht bei Microsoft
// registriert (config.json ohne sharepoint.clientId). Statt einer
// Fehlermeldung zeigt sie die Schritte mit den genauen Werten für diese
// Adresse und erzeugt die fertige config.json zum Hochladen.

import { esc } from './shared.js'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** config.json (Text wie am Server) mit eingetragener Anwendungs-ID. */
export function configMitAnwendungsId(text, clientId) {
  const id = String(clientId || '').trim()
  if (!GUID.test(id)) throw new Error('Das ist keine Anwendungs-ID. Sie sieht so aus: 0b1c2d3e-1234-4abc-9def-0123456789ab')
  const config = JSON.parse(text)
  config.sharepoint = { ...(config.sharepoint || {}), clientId: id }
  return `${JSON.stringify(config, null, 2)}\n`
}

/** Seite mit den Schritten. redirectUri: diese Adresse (wie die Anmeldung sie verwendet). */
export function setupHtml(config, redirectUri) {
  const sp = config.sharepoint || {}
  const code = (text) => `<code class="setup-value">${esc(text)}</code><button class="btn small ghost" data-action="setup-copy" data-text="${esc(text)}">Kopieren</button>`
  return `<h2>Noch ein Schritt: die App bei Microsoft registrieren</h2>
    <p>Die App ist hochgeladen, kennt aber ihre <strong>Anwendungs-ID</strong> noch nicht. Einmalig im <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">Microsoft Entra Admin Center</a> mit einem Administratorkonto:</p>
    <ol class="setup-steps">
      <li><strong>App-Registrierungen → Neue Registrierung:</strong> Name „${esc(config.brand?.app || 'App')}“, „Nur Konten in diesem Organisationsverzeichnis“, Umleitungs-URI Plattform <em>Single-Page-Anwendung (SPA)</em>:<br>${code(redirectUri)}</li>
      <li><strong>API-Berechtigungen → Microsoft Graph → Delegiert:</strong> User.Read, Sites.ReadWrite.All, Mail.Send, für den Termin der Nachkontrolle Calendars.ReadWrite${config.features?.posteingang ? `, für den Posteingang ${config.posteingang?.mailbox ? `Mail.Read.Shared (Sammelpostfach ${esc(config.posteingang.mailbox)}, nur lesen)` : 'Mail.Read (nur lesen)'}` : ''}; für die Routen im Mattenwechsel <em>Azure Maps → user_impersonation</em>. Danach <strong>Administratorzustimmung erteilen</strong>.</li>
      <li><strong>Tokenkonfiguration → Gruppenanspruch hinzufügen:</strong> Sicherheitsgruppen, beim ID-Token „Gruppen-ID“. Daraus kommen die Rechte je Gruppe.</li>
      <li><strong>Übersicht:</strong> Die Verzeichnis-ID muss ${sp.tenantId ? code(sp.tenantId) : '<em>(in config.json fehlt sharepoint.tenantId)</em>'} lauten. Die <strong>Anwendungs-ID (Client)</strong> kopieren und hier einfügen:</li>
    </ol>
    <div class="setup-form">
      <input type="text" id="setup-client" placeholder="0b1c2d3e-1234-4abc-9def-0123456789ab" autocomplete="off" spellcheck="false" aria-label="Anwendungs-ID">
      <button class="btn primary" data-action="setup-config">config.json erstellen</button>
    </div>
    <p id="setup-result" class="note" role="status"></p>
    <p class="note">Die erstellte <code>config.json</code> ersetzt die gleichnamige Datei im Ordner der App am Webserver (z. B. per FTP bei World4You). Danach diese Seite neu laden: Es kommt die Microsoft-Anmeldung. Ausführlich: docs/EINRICHTUNG.md, Schritt 2 und 4.</p>
    <p><button class="btn" data-action="reload">Neu laden</button></p>`
}

/** Aktionen der Seite; download(name, blob) wie in shared.js. */
export function setupActions(download) {
  return {
    'setup-copy': async (el) => {
      try {
        await navigator.clipboard.writeText(el.dataset.text)
        el.textContent = 'Kopiert'
      } catch {
        el.textContent = 'Bitte markieren und kopieren'
      }
    },
    'setup-config': async () => {
      const out = document.getElementById('setup-result')
      try {
        const res = await fetch('config.json', { cache: 'no-store' })
        if (!res.ok) throw new Error('config.json ist am Server nicht lesbar.')
        const text = configMitAnwendungsId(await res.text(), document.getElementById('setup-client').value)
        download('config.json', new Blob([text], { type: 'application/json' }))
        out.textContent = 'config.json erstellt (Download). Jetzt hochladen und neu laden.'
      } catch (err) {
        out.textContent = err.message
      }
    },
  }
}
