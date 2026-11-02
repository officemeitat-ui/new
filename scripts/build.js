// Erstellt dist/ zum Hochladen auf den Webserver (app.cleanos.at).
// Aufruf: npm run build            Betrieb: config.json + config.production.json
//         DIENSTPLAN_DEMO=1 npm run build   Probe mit Beispieldaten (nur config.json)
//
// - Eigener Code wird mit esbuild zu wenigen, minimierten Dateien mit
//   Inhalts-Hash gebündelt (app/…): schneller Start, sicheres Caching.
// - Bibliotheken (MSAL, ExcelJS, pdfmake, JSZip) liegen unter vendor/ und
//   werden erst bei Bedarf geladen.
// - Die Werkzeuge kommen unverändert nach werkzeuge/ (scripts/werkzeuge.js).
// - staticwebapp.config.json bekommt die Tenant-ID aus config.json: die ganze
//   Seite ist dann nur nach Microsoft-Anmeldung im eigenen Tenant erreichbar.
// - .htaccess (Apache-Webspace, z. B. World4You) mit denselben Headern.
// - dist/config.json = config.json mit config.production.json darüber
//   (SharePoint, Anmeldung, Gruppen); ENTRA_CLIENT_ID/ENTRA_TENANT_ID aus der
//   Umgebung haben Vorrang (z. B. GitHub-Variablen).
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deepMerge } from '../src/ui/config.js'
import { htaccessFor } from './htaccess.js'
import { manifestFor, serviceWorkerSource } from './pwa.js'
import { VENDOR } from './vendor.js'
import { werkzeugeBauen } from './werkzeuge.js'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dist = join(root, 'dist')
const copy = (item, target = item) =>
  cp(join(root, item), join(dist, target), { recursive: true }).catch((err) => {
    if (err.code !== 'ENOENT') throw err
  })

await rm(dist, { recursive: true, force: true })
await mkdir(join(dist, 'vendor'), { recursive: true })
for (const item of ['themes', 'assets']) await copy(item)
// Werkzeuge (Wasserzähler, Objektkontrolle, Objektdoku, Mattenwechsel): unverändert, mit Anmeldebrücke
const werkzeuge = await werkzeugeBauen(root, dist)
console.log(`Werkzeuge: ${werkzeuge.length} (${werkzeuge.map((w) => w.split('/')[1]).join(', ')}) mit Anmeldung über die App.`)

// ---------------------------------------------------------------- Konfiguration
const demoBuild = process.env.DIENSTPLAN_DEMO === '1' || process.env.DIENSTPLAN_PUBLIC === '1'
let appConfig = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'))
if (!demoBuild) {
  try {
    appConfig = deepMerge(appConfig, JSON.parse(await readFile(join(root, 'config.production.json'), 'utf8')))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}
appConfig.sharepoint = { ...(appConfig.sharepoint || {}) }
if (process.env.ENTRA_TENANT_ID) appConfig.sharepoint.tenantId = process.env.ENTRA_TENANT_ID
if (process.env.ENTRA_CLIENT_ID) appConfig.sharepoint.clientId = process.env.ENTRA_CLIENT_ID
await writeFile(join(dist, 'config.json'), `${JSON.stringify(appConfig, null, 2)}\n`)
if (appConfig.storage === 'sharepoint') {
  console.log(`Betrieb: SharePoint ${appConfig.sharepoint.siteUrl || '(siteUrl fehlt)'} → ${appConfig.sharepoint.library}/${appConfig.sharepoint.folder}, Anmeldung nur mit Firmenkonten.`)
  if (!appConfig.sharepoint.clientId) console.warn('Hinweis: Noch keine Anwendungs-ID (sharepoint.clientId). Die Seite zeigt bis dahin „noch nicht bei Microsoft registriert“. In config.production.json eintragen oder ENTRA_CLIENT_ID setzen (docs/EINRICHTUNG.md, Schritt 2).')
} else {
  console.log('Probe: Daten im Browser' + (appConfig.demo ? ' mit Beispieldaten' : '') + '.')
}
for (const [target, source] of Object.entries(VENDOR)) await cp(join(root, source), join(dist, target))
// Wetter am Webspace (PHP): Umweg, falls der Browser GeoSphere nicht direkt erreicht, und
// Schnee-Alarm (Cronjob). Einstellungen und Stand des Alarms liegen in privat/ (gesperrt).
// „Mein Dienstplan“ (mein-plan.php): persönlicher Link für Mitarbeitende, braucht dieselben Bausteine.
const webspace = [
  ...(appConfig.weather !== false ? ['wetter.php', 'wetter-alarm.php', 'wetter-foto.js'] : []),
  ...(appConfig.staffPortal !== false ? ['mein-plan.php'] : []),
]
if (webspace.length) {
  for (const file of ['wetter-lib.php', 'webspace-lib.php', 'system.php', ...webspace]) await copy(file)
  await mkdir(join(dist, 'privat'), { recursive: true })
}

// ---------------------------------------------------------------- Bündeln
let html = await readFile(join(root, 'index.html'), 'utf8')
let esbuild = null
try {
  esbuild = await import('esbuild')
} catch {
  console.warn('Hinweis: esbuild ist nicht installiert (npm ci). Der Quellcode wird ungebündelt kopiert.')
}
if (esbuild) {
  const result = await esbuild.build({
    entryPoints: { app: join(root, 'src/ui/app.js'), styles: join(root, 'src/ui/styles.css') },
    bundle: true,
    splitting: true,
    format: 'esm',
    target: ['es2022'],
    minify: true,
    legalComments: 'none',
    outdir: join(dist, 'app'),
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    metafile: true,
    logLevel: 'warning',
  })
  const outputs = Object.entries(result.metafile.outputs)
  const entry = (name) => relative(dist, join(root, outputs.find(([file, o]) => o.entryPoint && file.includes(`/app/${name}-`))[0])).replaceAll('\\', '/')
  html = html.replace('src/ui/app.js', entry('app')).replace('src/ui/styles.css', entry('styles'))
  const size = outputs.reduce((s, [, o]) => s + o.bytes, 0)
  console.log(`Gebündelt: ${outputs.length} Dateien, ${Math.round(size / 1024)} KB (${entry('app')})`)
} else {
  await copy('src')
}
// ---------------------------------------------------------------- Als App installierbar (PWA)
const brand = appConfig.brand || {}
const head = [
  '<link rel="manifest" href="manifest.webmanifest">',
  `<meta name="theme-color" content="${brand.colors?.primary || '#1d4ea6'}">`,
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  `<meta name="apple-mobile-web-app-title" content="${brand.app && brand.app.length <= 12 ? brand.app : brand.product || 'Dienstplan'}">`,
  brand.appleTouchIcon ? `<link rel="apple-touch-icon" href="${brand.appleTouchIcon}">` : '',
  brand.icon ? `<link rel="icon" href="${brand.icon}">` : '',
].filter(Boolean)
html = html.replace('</head>', `${head.join('\n')}\n</head>`)
await writeFile(join(dist, 'index.html'), html)
await writeFile(join(dist, 'manifest.webmanifest'), `${JSON.stringify(manifestFor(appConfig), null, 2)}\n`)
const listFiles = async (dir) => (await readdir(join(dist, dir), { withFileTypes: true }).catch(() => [])).flatMap((d) => (d.isFile() ? [`./${dir}/${d.name}`] : []))
const precache = [
  './index.html',
  './config.json',
  './manifest.webmanifest',
  ...(await listFiles('app')),
  ...(await listFiles('assets')),
  ...(await listFiles('themes')),
  './vendor/msal-browser.min.js',
]
// Version aus den Inhalten (nicht nur den Namen): auch eine geänderte Theme-Datei oder ein neues Logo kommt auf jedes Gerät
const hash = createHash('sha256').update(html)
for (const file of precache) hash.update(file).update(await readFile(join(dist, file)).catch(() => ''))
const version = hash.digest('hex').slice(0, 10)
await writeFile(join(dist, 'sw.js'), serviceWorkerSource({ version, precache }))
console.log(`App-Installation: manifest.webmanifest, sw.js (${precache.length} Dateien vorgehalten)`)

// ---------------------------------------------------------------- Anmeldung (Azure Static Web Apps)
// Standard: jede Seite nur nach Microsoft-Anmeldung.
//  - Mit Tenant-ID (config.json → sharepoint.tenantId oder Umgebungsvariable
//    ENTRA_TENANT_ID): nur Konten aus dem eigenen Tenant (Standard-Tarif).
//  - Ohne Tenant-ID: Anmeldung mit einem Microsoft-Konto (Free-Tarif); die
//    Daten bleiben trotzdem nur für berechtigte SharePoint-Konten lesbar.
//  - DIENSTPLAN_PUBLIC=1 schaltet den Schutz bewusst ab (reine Demo).
const swa = JSON.parse(await readFile(join(root, 'staticwebapp.config.json'), 'utf8'))
const tenantId = appConfig.sharepoint.tenantId || ''
if (process.env.DIENSTPLAN_PUBLIC === '1') {
  delete swa.auth
  delete swa.responseOverrides
  swa.routes = swa.routes.map(({ allowedRoles, ...route }) => route)
  console.warn('ACHTUNG: DIENSTPLAN_PUBLIC=1 – die Seite ist ohne Anmeldung erreichbar (nur für Demos).')
} else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
  swa.auth.identityProviders.azureActiveDirectory.registration.openIdIssuer = `https://login.microsoftonline.com/${tenantId}/v2.0`
  console.log(`Geschützt: Anmeldung nur mit Konten aus dem Tenant ${tenantId} (Azure Static Web Apps, Standard-Tarif).`)
} else {
  delete swa.auth
  console.warn('Hinweis: Keine Tenant-ID gefunden. Die Seite verlangt eine Microsoft-Anmeldung, lässt aber jedes Microsoft-Konto zu. Für „nur eigener Tenant“ sharepoint.tenantId in config.json oder ENTRA_TENANT_ID setzen.')
}
await writeFile(join(dist, 'staticwebapp.config.json'), `${JSON.stringify(swa, null, 2)}\n`)

// ---------------------------------------------------------------- Webspace (Apache, z. B. World4You)
const exists = (dir) => readdir(join(dist, dir)).then(() => true, () => false)
for (const [file, text] of Object.entries(htaccessFor(swa))) {
  const dir = file.split('/').slice(0, -1).join('/')
  if (!dir || (await exists(dir))) await writeFile(join(dist, file), text)
}
console.log('Webspace: .htaccess mit denselben Sicherheitsregeln (Apache, z. B. World4You). Dort ist der Code ohne Anmeldung abrufbar, die Daten nicht.')
console.log('dist/ erstellt. Inhalt auf den Webserver laden (app.cleanos.at).')
