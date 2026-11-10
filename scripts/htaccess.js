// .htaccess für einen Apache-Webspace (z. B. World4You): dieselben
// Sicherheitsregeln und Cache-Zeiten wie in staticwebapp.config.json (Azure),
// daraus erzeugt, damit beide Wege nie auseinanderlaufen.
//
// Mehrere Dateien, weil Apache Regeln je Ordner liest:
//   .htaccess            ganze App (CSP, Header, Cache von index.html usw.)
//   app/.htaccess        gebündelter Code mit Hash im Namen: dauerhaft cachen (nur diese Dateien)
//   werkzeuge/.htaccess  Regeln der Werkzeuge (dürfen im Rahmen der App laufen)
//   privat/.htaccess     Schnee-Alarm und Mein Dienstplan: Einstellungen, Pläne, Anträge, gesperrt
// Alles in <IfModule>: Fehlt ein Modul, liefert der Webspace trotzdem aus
// (ohne die Header) statt mit „500 Internal Server Error“ abzubrechen.
// Kein Seitenschutz wie auf Azure: Der Code ist abrufbar, die Daten nur nach
// Microsoft-Anmeldung (docs/EINRICHTUNG.md, Variante B).

const KOPF = '# Erzeugt von npm run build aus staticwebapp.config.json (scripts/htaccess.js). Nicht von Hand ändern.'
/** Erkennungszeichen der .htaccess der App (system.php sucht danach: richtige Datei im Ordner der App, keine im Ordner darüber). */
export const MARKE = 'Cleanos App auf einem Apache-Webspace'

const wert = (v) => {
  if (/["\n]/.test(v)) throw new Error(`.htaccess: Wert mit Anführungszeichen oder Zeilenumbruch: ${v}`)
  return `"${v}"`
}
const routeOf = (swa, route) => swa.routes.find((r) => r.route === route)?.headers || {}
const cacheOf = (swa, route) => routeOf(swa, route)['cache-control']
// Sicherheits-Header mit „always“: auch bei Fehlerseiten. In Unterordnern ebenso,
// sonst stünde die Content-Security-Policy dort doppelt (Browser wenden dann beide an).
const sicherheit = (headers) =>
  Object.entries(headers)
    .filter(([name]) => name.toLowerCase() !== 'cache-control')
    .map(([name, v]) => `  Header always set ${name} ${wert(v)}`)

export function htaccessFor(swa) {
  const noCache = ['/index.html', '/sw.js', '/manifest.webmanifest'].filter((r) => cacheOf(swa, r) === 'no-cache').map((r) => r.slice(1).replaceAll('.', '\\.'))
  const root = [
    KOPF,
    `# ${MARKE} (z. B. World4You).`,
    'Options -Indexes',
    'DirectoryIndex index.html',
    'AddType application/manifest+json .webmanifest',
    'AddCharset utf-8 .html .js .css .json .webmanifest',
    '',
    '<IfModule mod_headers.c>',
    ...sicherheit(swa.globalHeaders),
    `  <FilesMatch "^(${noCache.join('|')})$">`,
    `    Header set Cache-Control "no-cache"`,
    '  </FilesMatch>',
    '  <Files "config.json">',
    `    Header set Cache-Control ${wert(cacheOf(swa, '/config.json') || 'no-store')}`,
    '  </Files>',
    '</IfModule>',
    '',
    '# Code, Stile und Daten komprimiert ausliefern (am Handy ein Viertel der Datenmenge; Azure macht das selbst)',
    '<IfModule mod_deflate.c>',
    '  <IfModule mod_filter.c>',
    '    AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript application/json application/manifest+json image/svg+xml',
    '  </IfModule>',
    '</IfModule>',
    '',
    '# nur für Azure gedacht: auf dem Webspace nicht ausliefern',
    '<Files "staticwebapp.config.json">',
    '  <IfModule mod_authz_core.c>',
    '    Require all denied',
    '  </IfModule>',
    '</Files>',
    '',
  ].join('\n')
  // Nur Dateien mit Hash im Namen (app-…, chunk-…, start-…, styles-…): Landet der Ordner beim Hochladen versehentlich
  // im Hauptordner des Webspace, trifft die Regel dort sonst Startseite und PHP-Seiten (ein Jahr im Browser)
  const app = [
    KOPF,
    '<IfModule mod_headers.c>',
    '  <FilesMatch "-[A-Z0-9]{8}\\.(js|css)$">',
    `    Header set Cache-Control ${wert(cacheOf(swa, '/app/*'))}`,
    '  </FilesMatch>',
    '</IfModule>',
    '',
  ].join('\n')
  const werkzeuge = routeOf(swa, '/werkzeuge/*')
  const tools = [
    KOPF,
    '# Die Werkzeuge: eigene Regeln, im Rahmen der App erlaubt (frame-ancestors self).',
    '<IfModule mod_headers.c>',
    ...sicherheit(werkzeuge),
    `  Header set Cache-Control ${wert(werkzeuge['cache-control'] || 'no-cache')}`,
    '</IfModule>',
    '',
  ].join('\n')
  // Schnee-Alarm und Mein Dienstplan: Einstellungen (Namen, E-Mail, Schlüssel), Pläne, Anträge nie ausliefern
  const privat = [
    KOPF,
    '# Schnee-Alarm (wetter-alarm.php), Mein Dienstplan (mein-plan.php), Kundenbereich (kunden.php) und Fahrerseite',
    '# (mattentour.php): Einstellungen, Pläne, Anträge, Touren, Fotos bis zur Übernahme; API-Schlüssel und Zähler von',
    '# KI-Assistent (ki.php) und Google-Routing (routing.php). Nur für PHP lesbar.',
    '<IfModule mod_authz_core.c>',
    '  Require all denied',
    '</IfModule>',
    '<IfModule !mod_authz_core.c>',
    '  Order allow,deny',
    '  Deny from all',
    '</IfModule>',
    '',
  ].join('\n')
  return { '.htaccess': root, 'app/.htaccess': app, 'werkzeuge/.htaccess': tools, 'privat/.htaccess': privat }
}
