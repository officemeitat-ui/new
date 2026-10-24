// Erstellt dist/ zum Hochladen auf den Webserver (z. B. dienstplan.cleanos.at).
// Aufruf: npm run build
//
// - Eigener Code wird mit esbuild zu wenigen, minimierten Dateien mit
//   Inhalts-Hash gebündelt (app/…): schneller Start, sicheres Caching.
// - Bibliotheken (MSAL, ExcelJS, pdfmake, JSZip) liegen unter vendor/ und
//   werden erst bei Bedarf geladen.
// - staticwebapp.config.json bekommt die Tenant-ID aus config.json: die ganze
//   Seite ist dann nur nach Microsoft-Anmeldung im eigenen Tenant erreichbar.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VENDOR } from './vendor.js'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dist = join(root, 'dist')
const copy = (item, target = item) =>
  cp(join(root, item), join(dist, target), { recursive: true }).catch((err) => {
    if (err.code !== 'ENOENT') throw err
  })

await rm(dist, { recursive: true, force: true })
await mkdir(join(dist, 'vendor'), { recursive: true })
for (const item of ['config.json', 'themes', 'assets']) await copy(item)
for (const [target, source] of Object.entries(VENDOR)) await cp(join(root, source), join(dist, target))

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
await writeFile(join(dist, 'index.html'), html)

// ---------------------------------------------------------------- Anmeldung (Azure Static Web Apps)
// Standard: jede Seite nur nach Microsoft-Anmeldung.
//  - Mit Tenant-ID (config.json → sharepoint.tenantId oder Umgebungsvariable
//    ENTRA_TENANT_ID): nur Konten aus dem eigenen Tenant (Standard-Tarif).
//  - Ohne Tenant-ID: Anmeldung mit einem Microsoft-Konto (Free-Tarif); die
//    Daten bleiben trotzdem nur für berechtigte SharePoint-Konten lesbar.
//  - DIENSTPLAN_PUBLIC=1 schaltet den Schutz bewusst ab (reine Demo).
const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'))
const swa = JSON.parse(await readFile(join(root, 'staticwebapp.config.json'), 'utf8'))
const tenantId = process.env.ENTRA_TENANT_ID || config.sharepoint?.tenantId || ''
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
console.log('dist/ erstellt. Inhalt auf den Webserver laden; config.json vorher anpassen.')
