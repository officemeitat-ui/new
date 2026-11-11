import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { contrast, mix, parseColor, readableOn, textOn, toHex } from '../src/core/color.js'
import { inkColors, timesheetDocument } from '../src/export/pdf.js'
import { extractBrand, stylesheetUrls } from '../scripts/theme/extract.js'
import { themeCss } from '../scripts/theme/generate.js'

const dir = new URL('./fixtures/website/', import.meta.url)
const html = readFileSync(new URL('index.html', dir), 'utf8')
const css = readFileSync(new URL('style.css', dir), 'utf8')
const base = new URL('index.html', dir).href

test('Farben: lesen, mischen, Kontrast', () => {
  assert.equal(toHex(parseColor('#0a3')), '#00aa33')
  assert.equal(toHex(parseColor('rgb(10 61 107 / .5)')), '#0a3d6b')
  assert.equal(parseColor('rgba(10,61,107,0.5)').a, 0.5)
  assert.equal(toHex(parseColor('hsl(0 100% 50%)')), '#ff0000')
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080')
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01)
  assert.ok(contrast(readableOn('#f5a623', '#ffffff'), '#ffffff') >= 4.5)
  assert.equal(textOn('#00737a'), '#ffffff')
  assert.equal(textOn('#f5f5a0'), '#111827')
})

test('Design übernehmen: Farben, Schriften, Logo und Kopfzeile einer Website', () => {
  assert.deepEqual(stylesheetUrls(html, base), [new URL('style.css', dir).href])
  const b = extractBrand({ html, css, base })
  assert.equal(b.primary, '#00737a')
  assert.equal(b.accent, '#f5a623')
  assert.equal(b.fonts.heading, 'Montserrat')
  assert.equal(b.fonts.body, 'Open Sans')
  assert.equal(b.fonts.googleUrls.length, 1)
  assert.deepEqual(b.fonts.googleFamilies.sort(), ['Montserrat', 'Open Sans'])
  assert.equal(b.logo.url, new URL('bilder/beispiel-logo.svg', dir).href)
  assert.equal(b.header, '#ffffff')
  // Ohne Baukasten-Variablen: Farbe aus Häufigkeit und wichtigen Selektoren
  const plain = extractBrand({ html, css: css.replace(/:root \{[^}]*\}/, ''), base })
  assert.equal(plain.primary, '#00737a')
  assert.equal(plain.accent, '#f5a623')
})

test('Design übernehmen: Theme mit lesbaren Farben, helle oder farbige Kopfzeile', () => {
  const b = extractBrand({ html, css, base })
  const light = themeCss({ name: 'beispiel', primary: b.primary, accent: b.accent, heading: b.fonts.heading, body: b.fonts.body, imports: b.fonts.googleUrls, header: b.header })
  assert.match(light, /--brand-primary: #00737a;/)
  assert.match(light, /@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Montserrat/)
  assert.match(light, /--font-display: 'Montserrat'/)
  assert.match(light, /border-bottom: 3px solid var\(--brand-accent\)/)
  const accent = light.match(/:root\[data-skin='beispiel'\] \{[^}]*--accent: (#[0-9a-f]{6});/)[1]
  assert.match(light, /\[data-brand='beispiel'\] \.brand-logo/, 'Logo bleibt Marke, Farben sind wählbares Farbschema')
  assert.ok(contrast(accent, '#ffffff') >= 4.5)
  const dark = themeCss({ name: 'beispiel', primary: b.primary, accent: b.accent, header: '#0d2b2d' })
  assert.match(dark, /linear-gradient\(100deg, var\(--brand-primary\)/)
  assert.match(dark, /--brand-on-accent: #111827;/) // dunkle Schrift auf Orange
})

test('PDF in Markenfarbe mit Logo', () => {
  const ts = { employee: { name: 'Test', type: 'Teilzeit', weeklyHours: 20 }, monday: '2026-10-26', sunday: '2026-11-01', days: [], totals: { soll: 0, credited: 0, travel: 0, ist: 0, saldo: 0 } }
  const svg = readFileSync(new URL('bilder/beispiel-logo.svg', dir), 'utf8')
  const doc = timesheetDocument([{ ts }], { brand: { name: 'Beispiel', product: 'Dienstplan', colors: { primary: '#00737a' } }, logo: { svg } })
  assert.equal(doc.styles.brand.color, '#00737a')
  assert.ok(contrast(doc.styles.th.color, doc.styles.th.fillColor) >= 4.5)
  assert.equal(doc.content[0].columns[0].stack[0].svg, svg)
  const plain = timesheetDocument([{ ts }], { brand: { name: 'Beispiel' } })
  assert.equal(plain.content[0].columns[0].stack[0].text, 'Beispiel')
  // Cleanos: Tagesbänder in Cleanos-Blau getönt, Sonderleistung in Grün dunkel, Nebentext „Text leise“
  const { brand } = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'))
  const c = inkColors(brand)
  assert.equal(c.ink, '#0c6cb4')
  assert.equal(c.special, '#4e7a1e')
  assert.equal(c.grey, '#4b5b67')
  assert.ok(contrast(c.band, '#ffffff') < 1.25 && contrast('#13232f', c.band) >= 7, `Band ${c.band} hell und gut lesbar`)
  const day = { date: '2026-10-26', holiday: null, absence: null, total: 60, lines: [{ kind: 'work', style: 'special', time: '08:00 - 09:00', hours: 60, credited: 60, travel: 0, notes: [], text: 'Sonder' }] }
  const doc2 = timesheetDocument([{ ts: { ...ts, days: [day] } }], { brand })
  const json = JSON.stringify(doc2.content)
  assert.ok(json.includes(`"fillColor":"${c.band}"`) && json.includes('"color":"#4e7a1e"'), 'Band und Sonderleistung in Cleanos-Farben')
  assert.ok(!/#D9E1F2|#00A651/.test(json), 'keine Farben des alten Excel-Plans')
})

test('Cleanos-Design nach www.cleanos.at: Hausfarben, drei Farbschemata, lesbar', () => {
  const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'))
  const { brand } = config
  for (const file of [brand.logo, brand.logoOnLight, brand.icon]) assert.ok(readFileSync(new URL(`../${file}`, import.meta.url)).length > 1000, file)
  assert.deepEqual(brand.colors, { primary: '#0c6cb4', accent: '#9cc654', accentText: '#4e7a1e', muted: '#4b5b67' })
  assert.deepEqual(Object.keys(brand.themes), ['cleanos', 'cleanos-nacht', 'cleanos-kontrast'])
  assert.equal(brand.builtinThemes, false, 'interne Cleanos App: nur Cleanos-Farbschemata')
  const theme = readFileSync(new URL(`../themes/${brand.theme}.css`, import.meta.url), 'utf8')
  for (const token of ['--brand-primary: #0c6cb4;', '--brand-accent: #9cc654;', '--brand-night: #0e2433;', '--fg: #13232f;', '--bg: #f3f6f8;', '--line: #dde5ea;', '--ok: #4e7a1e;', '--ok-soft: #eef6e2;']) assert.ok(theme.includes(token), token)
  assert.match(theme, /--font-body: 'Segoe UI'/, 'Systemschrift wie auf der Website')
  assert.match(theme, /:root\[data-skin='cleanos-nacht'\] \{\r?\n  --sb-bg: #0e2433;/, 'Nachtblau: Seitenleiste in Nachtblau')
  assert.match(theme, /--sb-marker: #9cc654;/, 'grüne Markierung nur auf Dunkel')
  // Text lesbar (≥ 4,5:1), Grün nur auf Dunkel als Schrift; auch Seitenleiste hell und Nachtblau
  const pairs = [['#0c6cb4', '#ffffff'], ['#ffffff', '#0c6cb4'], ['#4b5b67', '#f3f6f8'], ['#4e7a1e', '#eef6e2'], ['#0c6cb4', '#e8f1fa'], ['#8a5300', '#fdf0d5'], ['#b3261e', '#fce8e6'], ['#9cc654', '#0e2433'], ['#5ea9e3', '#0e2433'], ['#a3b4c1', '#0e2433'], ['#5f6f7b', '#ffffff'], ['#5f6f7b', '#f3f6f8'], ['#e3ebf0', '#0e2433'], ['#8fa3b2', '#0e2433'], ['#ffffff', '#173f5c'], ['#a3245a', '#f8e9f0']]
  for (const [fg, bg] of pairs) assert.ok(contrast(fg, bg) >= 4.5, `${fg} auf ${bg}: ${contrast(fg, bg).toFixed(2)}`)
  assert.ok(contrast('#9cc654', '#ffffff') < 3, 'Grün auf Weiß wäre nicht lesbar und wird nicht als Schrift verwendet')
  // Cleanos Kontrast: Schrift mindestens 7:1 (hell und dunkel), Hinweise auf getönten Flächen mindestens 4,5:1
  assert.match(theme, /:root\[data-skin='cleanos-kontrast'\] \{/)
  for (const [fg, bg] of [['#0e2433', '#ffffff'], ['#13232f', '#eef2f5'], ['#0a5a96', '#ffffff'], ['#ffffff', '#0a5a96'], ['#3b5f16', '#ffffff'], ['#6b4000', '#ffeac2'], ['#ffffff', '#000000'], ['#e9eff3', '#0e2433'], ['#7ab8e8', '#000000'], ['#9cc654', '#000000'], ['#ffffff', '#123a58']]) assert.ok(contrast(fg, bg) >= 7, `Kontrast ${fg} auf ${bg}: ${contrast(fg, bg).toFixed(2)}`)
  for (const [fg, bg] of [['#0a5a96', '#dceaf6'], ['#3b5f16', '#e6f2d6'], ['#a00000', '#ffe0e0'], ['#7ab8e8', '#11344f'], ['#9cc654', '#1d3311'], ['#ff8a8a', '#3a0000']]) assert.ok(contrast(fg, bg) >= 4.5, `Kontrast ${fg} auf ${bg}: ${contrast(fg, bg).toFixed(2)}`)
})

test('Darstellung: nur Cleanos-Farbschemata (interne App), Auswahl je Gerät', async () => {
  const { applyTheme, resolveTheme, themeList } = await import('../src/ui/theme.js')
  const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'))
  assert.deepEqual(themeList(config.brand).map((t) => t.id), ['cleanos', 'cleanos-nacht', 'cleanos-kontrast'])
  assert.deepEqual(themeList({ ...config.brand, builtinThemes: true }).map((t) => t.id), ['cleanos', 'cleanos-nacht', 'cleanos-kontrast', 'standard', 'ruhig', 'kontrast'], 'andere Marke: eingebaute dazu')
  assert.deepEqual(themeList({}).map((t) => t.id), ['standard', 'ruhig', 'kontrast'], 'ohne Marke (neutrale Vorschau) nur die eingebauten')
  assert.deepEqual(resolveTheme({}, config.brand), { skin: 'cleanos', mode: 'auto', scale: 'normal', look: 'modern' }, 'Voreinstellung aus config.json')
  assert.deepEqual(resolveTheme({ skin: 'cleanos-kontrast', mode: 'dunkel', scale: 'gross', look: 'schlicht' }, config.brand), { skin: 'cleanos-kontrast', mode: 'dunkel', scale: 'gross', look: 'schlicht' })
  assert.equal(resolveTheme({ skin: 'kontrast' }, config.brand).skin, 'cleanos', 'früher gewähltes „Standard“/„Ruhig“/„Hoher Kontrast“: zurück auf Cleanos')
  assert.equal(resolveTheme({ skin: 'ruhig' }, config.brand).skin, 'cleanos')
  assert.equal(resolveTheme({ skin: 'gibtsnicht' }, {}).skin, 'standard')
  assert.equal(themeList({ theme: 'firma', name: 'Firma' })[0].label, 'Firma', 'ältere config ohne brand.themes')
  // anwenden: Attribute am Wurzelelement und Farbe der Statusleiste
  const meta = { content: '' }
  globalThis.document = { querySelector: () => meta, head: { appendChild: (x) => x } }
  const root = { dataset: {} }
  applyTheme({ skin: 'cleanos-nacht', mode: 'hell', scale: 'gross' }, config.brand, root)
  assert.deepEqual({ ...root.dataset }, { skin: 'cleanos-nacht', theme: 'light', scale: 'gross', look: 'modern' })
  assert.equal(meta.content, '#0e2433')
  applyTheme({ skin: 'standard', mode: 'auto' }, config.brand, root)
  assert.deepEqual({ ...root.dataset }, { skin: 'cleanos', look: 'modern' }, 'nicht mehr wählbar: Cleanos')
  applyTheme({ skin: 'cleanos-kontrast', mode: 'dunkel' }, config.brand, root)
  assert.equal(meta.content, '#000000')
  assert.equal(root.dataset.look, 'schlicht', 'Kontrast immer schlicht')
  applyTheme({ skin: 'cleanos', look: 'schlicht' }, config.brand, root)
  assert.equal(root.dataset.look, 'schlicht', 'Stil wählbar')
  delete globalThis.document
})
