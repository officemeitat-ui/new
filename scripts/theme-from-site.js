// Corporate Design von der eigenen Website übernehmen:
//
//   npm run theme -- https://www.cleanos.at
//   npm run theme -- ./cleanos-gespeichert/index.html     (im Browser „Seite speichern unter … komplett“)
//
// Liest Logo, Markenfarben, Schriften und Kopfzeile, schreibt
// themes/<name>.css, lädt Logo (und ggf. Schriften) nach assets/ bzw.
// themes/fonts/ und trägt alles in config.json ein. Danach `npm start` und
// prüfen. Optionen: --name cleanos   --dry (nur anzeigen)

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { contrast } from '../src/core/color.js'
import { extractBrand, stylesheetUrls } from './theme/extract.js'
import { themeCss } from './theme/generate.js'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (n) => args.includes(`--${n}`)
const option = (n) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : null)
const source = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--name')
if (!source) {
  console.log('Aufruf: npm run theme -- https://www.firma.at   (oder Pfad zu einer gespeicherten Seite)')
  process.exit(1)
}

const config = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'))
const name = (option('name') || config.brand?.theme || 'marke').toLowerCase().replace(/[^a-z0-9-]/g, '')
const base = /^https?:/i.test(source) ? source : pathToFileURL(resolvePath(source)).href

async function load(url, as = 'text') {
  if (url.startsWith('file:')) {
    const buf = await readFile(fileURLToPath(url))
    return { body: as === 'text' ? buf.toString('utf8') : buf, type: '' }
  }
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Dienstplan Theme-Import)', accept: as === 'text' ? 'text/html,text/css,*/*' : '*/*' }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return { body: as === 'text' ? await res.text() : Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '' }
}

console.log(`Lese ${base} …`)
const { body: html } = await load(base)
let css = ''
const sheets = stylesheetUrls(html, base).slice(0, 15)
for (const url of sheets) {
  try {
    const sheet = (await load(url)).body
    css += `\n${sheet}`
    for (const m of sheet.matchAll(/@import\s+(?:url\()?['"]?([^'")\s;]+\.css[^'")\s;]*)/gi)) {
      if (/fonts\.googleapis/.test(m[1])) continue
      css += `\n${(await load(new URL(m[1], url).href).catch(() => ({ body: '' }))).body}`
    }
  } catch (err) {
    console.warn(`  Stylesheet übersprungen: ${err.message}`)
  }
}

const brand = extractBrand({ html, css, base })
if (!brand.primary) {
  console.error('Keine Markenfarbe gefunden. Bitte Farben in themes/*.css von Hand eintragen.')
  process.exit(2)
}

// Schriften: Google Fonts direkt einbinden, sonst Dateien der Website übernehmen
const wanted = new Set([brand.fonts.heading, brand.fonts.body].filter(Boolean))
const imports = brand.fonts.googleUrls
const fontFaces = []
if (!imports.length && !flag('dry')) {
  await mkdir(join(root, 'themes/fonts'), { recursive: true })
  for (const f of brand.fonts.fontFaces.filter((x) => wanted.has(x.family)).slice(0, 8)) {
    try {
      const file = `${f.family.replace(/[^a-z0-9]+/gi, '-')}-${f.weight}-${f.style}${extname(new URL(f.url).pathname) || '.woff2'}`.toLowerCase()
      await writeFile(join(root, 'themes/fonts', file), (await load(f.url, 'binary')).body)
      fontFaces.push({ ...f, file: `fonts/${file}` })
    } catch (err) {
      console.warn(`  Schrift übersprungen: ${err.message}`)
    }
  }
}

// Logo
let logoPath = config.brand?.logo || ''
if (brand.logo && !flag('dry')) {
  await mkdir(join(root, 'assets'), { recursive: true })
  try {
    if (brand.logo.svg) {
      logoPath = `assets/${name}-logo.svg`
      await writeFile(join(root, logoPath), brand.logo.svg.includes('xmlns') ? brand.logo.svg : brand.logo.svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'))
    } else {
      const { body, type } = await load(brand.logo.url, 'binary')
      const ext = /svg/.test(type) ? '.svg' : /png/.test(type) ? '.png' : /webp/.test(type) ? '.webp' : /jpe?g/.test(type) ? '.jpg' : extname(new URL(brand.logo.url).pathname) || '.png'
      logoPath = `assets/${name}-logo${ext}`
      await writeFile(join(root, logoPath), body)
    }
  } catch (err) {
    console.warn(`  Logo nicht geladen: ${err.message}`)
  }
}

const css2 = themeCss({ name, primary: brand.primary, accent: brand.accent, heading: brand.fonts.heading, body: brand.fonts.body, imports, fontFaces, header: brand.header, source: /^https?:/.test(source) ? source : basename(source) })
const lightHeader = !brand.header || contrast(brand.header, '#000000') > contrast(brand.header, '#ffffff')

console.log(`
Gefunden${brand.title ? ` („${brand.title}“)` : ''}:
  Primärfarbe   ${brand.primary}${brand.named.primary ? ' (aus Website-Variablen)' : ''}
  Akzentfarbe   ${brand.accent}
  Weitere       ${brand.candidates.slice(0, 5).map((c) => c.hex).join(', ') || '–'}
  Schriften     ${brand.fonts.heading || '–'} / ${brand.fonts.body || '–'}${imports.length ? ' (Google Fonts)' : fontFaces.length ? ` (${fontFaces.length} Dateien übernommen)` : ''}
  Kopfzeile     ${brand.header || 'hell (keine Farbe gefunden)'} → ${lightHeader ? 'helle Kopfzeile' : 'Kopfzeile in Markenfarbe'}
  Logo          ${brand.logo ? (brand.logo.svg ? 'SVG aus der Seite' : brand.logo.url) : 'nicht gefunden'}${brand.logo?.icon ? ' (nur Favicon)' : ''}`)

if (flag('dry')) {
  console.log('\n--dry: nichts geschrieben.')
  process.exit(0)
}
await mkdir(join(root, 'themes'), { recursive: true })
await writeFile(join(root, `themes/${name}.css`), css2)
config.brand = {
  ...config.brand,
  theme: name,
  logo: logoPath,
  colors: { primary: brand.primary, accent: brand.accent },
  ...(lightHeader && logoPath ? { logoOnLight: logoPath } : {}),
}
await writeFile(join(root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)
console.log(`
Geschrieben: themes/${name}.css${logoPath ? `, ${logoPath}` : ''}, config.json (brand)
Jetzt mit „npm start“ ansehen. Passt etwas nicht, die Werte in themes/${name}.css anpassen.`)
