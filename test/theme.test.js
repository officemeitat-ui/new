import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { contrast, mix, parseColor, readableOn, textOn, toHex } from '../src/core/color.js'
import { timesheetDocument } from '../src/export/pdf.js'
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
  const accent = light.match(/:root\[data-brand='beispiel'\] \{[^}]*--accent: (#[0-9a-f]{6});/)[1]
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
})
