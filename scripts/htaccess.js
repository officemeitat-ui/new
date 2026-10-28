// .htaccess für einen Apache-Webspace (z. B. World4You): dieselben
// Sicherheitsregeln und Cache-Zeiten wie in staticwebapp.config.json (Azure),
// daraus erzeugt, damit beide Wege nie auseinanderlaufen.
//
// Drei Dateien, weil Apache Regeln je Ordner liest:
//   .htaccess            ganze App (CSP, Header, Cache von index.html usw.)
//   app/.htaccess        gebündelter Code mit Hash im Namen: dauerhaft cachen
//   werkzeuge/.htaccess  Regeln der Werkzeuge (dürfen im Rahmen der App laufen)
// Alles in <IfModule>: Fehlt ein Modul, liefert der Webspace trotzdem aus
// (ohne die Header) statt mit „500 Internal Server Error“ abzubrechen.
// Kein Seitenschutz wie auf Azure: Der Code ist abrufbar, die Daten nur nach
// Microsoft-Anmeldung (docs/EINRICHTUNG.md, Variante B).

const KOPF = '# Erzeugt von npm run build aus staticwebapp.config.json (scripts/htaccess.js). Nicht von Hand ändern.'

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
    '# Cleanos App auf einem Apache-Webspace (z. B. World4You).',
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
    '# nur für Azure gedacht: auf dem Webspace nicht ausliefern',
    '<Files "staticwebapp.config.json">',
    '  <IfModule mod_authz_core.c>',
    '    Require all denied',
    '  </IfModule>',
    '</Files>',
    '',
  ].join('\n')
  const app = [KOPF, '<IfModule mod_headers.c>', `  Header set Cache-Control ${wert(cacheOf(swa, '/app/*'))}`, '</IfModule>', ''].join('\n')
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
  return { '.htaccess': root, 'app/.htaccess': app, 'werkzeuge/.htaccess': tools }
}
