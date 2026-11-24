// Start der gebauten App (dist/, wie sie hochgeladen wird): `npm run build`, dann die App aus dem Bündel im
// Browser-Modus mit Beispieldaten öffnen (config.json des Repositorys über die des Builds gelegt), später geladene
// Bereiche über die Seitenleiste öffnen (Tourenplanung des Mattenwechsels, Fakturierung, Kennzahlen): keine Ausnahme,
// kein fehlendes Paket. Das Paket enthält keine Prüfungen und keine Quelldateien.
// Port 19805.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, check, finish, note, wait, R, P } from './ablauf-lib.mjs'
import { createDevServer } from '../scripts/serve.js'

const PORT = 19805
const errors = []
let browser = null
let server = null
try {
  execFileSync(process.execPath, [join(R, 'scripts/build.js')], { cwd: R, stdio: 'pipe' })
  const dist = join(R, 'dist')
  check('Build: dist/ mit index.html', existsSync(join(dist, 'index.html')))
  check('Build: keine Prüfungen und kein Quellcode im Paket', !existsSync(join(dist, 'pruefung')) && !existsSync(join(dist, 'test')) && !existsSync(join(dist, 'src')), readdirSync(dist).join(', ').slice(0, 400))
  const probe = join(P, 'dist_probe')
  rmSync(probe, { recursive: true, force: true })
  cpSync(dist, probe, { recursive: true })
  cpSync(join(R, 'config.json'), join(probe, 'config.json'))
  server = createDevServer({ base: probe }).listen(PORT)
  await wait(500)
  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, serviceWorkers: 'block' })
  await ctx.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname) && url.protocol.startsWith('http'), (r) => (r.request().resourceType() === 'stylesheet' ? r.fulfill({ status: 200, contentType: 'text/css', body: '' }) : r.abort()))
  const page = await ctx.newPage()
  const missing = []
  page.on('pageerror', (e) => errors.push(`Ausnahme: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text()) && errors.push(m.text()))
  page.on('response', (r) => r.url().startsWith(`http://localhost:${PORT}/`) && r.status() >= 400 && missing.push(`${r.status()} ${r.url().replace(`http://localhost:${PORT}`, '')}`))
  const start = Date.now()
  await page.goto(`http://localhost:${PORT}/`)
  await page.waitForSelector('main', { timeout: 60000 })
  await page.waitForFunction(() => (document.querySelector('main')?.innerText || '').length > 200, null, { timeout: 60000 })
  note(`Start: ${Date.now() - start} ms bis zur ersten Ansicht`)
  const text = async () => ((await page.locator('main').innerText()) || '').replace(/\s+/g, ' ')
  check('Gebaute App startet mit Beispieldaten', (await text()).length > 200, (await text()).slice(0, 200))
  // „Zu erledigen“ öffnet sich von selbst: schließen, sobald es da ist
  await page.waitForSelector('.modal', { timeout: 15000 }).then(() => page.keyboard.press('Escape')).catch(() => {})
  for (const [hash, expect] of [['#mw-planung', /Touren planen/], ['#fakturierung', /Rechnung|Angebot/], ['#kennzahlen', /Kennzahlen/], ['#mw-lieferscheine', /Matten-Lieferscheine/], ['#staff', /Mitarbeitende|Mitarbeiter/]]) {
    await page.evaluate((h) => { location.hash = h }, hash)
    const ok = await page.waitForFunction((re) => new RegExp(re).test(document.querySelector('main')?.innerText || ''), expect.source, { timeout: 30000 }).then(() => true, () => false)
    check(`Später geladener Bereich öffnet aus dem Bündel: ${hash}`, ok, ok ? '' : (await text()).slice(0, 200))
  }
  check('Keine fehlenden Dateien im Paket (alle Pakete und Bilder gefunden)', !missing.length, missing.slice(0, 6).join(' | '))
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stderr || err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
