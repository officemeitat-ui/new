// Fotonachweis zum Mattenwechsel-Lieferschein im Kundenbereich (kunden.php) gegen den eingebauten PHP-Server mit eigenem
// Ordner (KUNDEN_ORDNER): Link mit Lieferschein und Fotonachweis wie aus der App übertragen (linkPayload), beide PDFs
// als „fehlend“ gemeldet und hochgeladen; als Kunde: Lieferschein mit „Fotonachweis (3 Fotos, PDF …)“, Herunterladen;
// ohne den Schalter „Fotonachweis“ kein Link und kein Herunterladen (404), die Datei wird am Webspace gelöscht.
// Handy 390 px ohne Querscrollen. Port 19883.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, check, finish, wait, R, P, todayVienna } from './ablauf-lib.mjs'

const PORT = 19883
const dir = join(P, 'kunden-foto-php')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const KEY = 'k'.repeat(40)
const TOKEN = 'Kd12Ab34Cd56Ef78Gh90'
writeFileSync(join(dir, 'kundenbereich.json'), JSON.stringify({ version: 1, schluessel: KEY, adresse: `http://127.0.0.1:${PORT}/` }))
const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', R], { env: { ...process.env, KUNDEN_ORDNER: dir }, stdio: 'ignore' })
await wait(1200)
const browser = await chromium.launch()
const errors = []
// kleines gültiges PDF
const pdf = (title) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n% ${title} ${'x'.repeat(200)}\ntrailer<</Root 1 0 R>>\n%%EOF\n`)
try {
  const today = todayVienna()
  const { linkPayload } = await import('../src/core/customer-portal.js')
  const { noteEntry, photoFile } = await import('../src/core/customer-matten.js')
  const doc = { id: 'd1', number: 'LS-2026-000123', date: today, objectName: 'Terminal 1', source: { time: '08:12' }, lines: [], receipt: { name: 'Erika Muster', role: 'Portier' } }
  const foto = { datei: photoFile(doc), sig: 'e'.repeat(32), anzahl: 3, name: 'Fotonachweis_LS-2026-000123.pdf' }
  const entry = noteEntry(doc, { sig: 'f'.repeat(32), foto })
  const link = (fotos) => ({ id: 'kb0123456789', token: TOKEN, title: 'Flughafen', objectIds: ['o1'], show: { lieferscheine: true, fotos }, deliveryNotes: { customerIds: ['c1'], months: 13 } })
  const hash = createHash('sha256').update(TOKEN).digest('hex')
  const api = async (aktion, { body, raw, query = '' } = {}) => {
    const r = await fetch(`http://127.0.0.1:${PORT}/kunden.php?aktion=${aktion}${query}`, { method: 'POST', headers: { 'X-Schluessel': KEY, 'Content-Type': raw ? 'application/pdf' : 'application/json' }, body: raw || JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => null) }
  }
  const objectsById = new Map([['o1', { id: 'o1', name: 'Terminal 1', address: 'Flughafenstraße 1' }]])
  let r = await api('speichern', { body: { links: [linkPayload({ link: link(true), hash, objectsById, lieferscheine: [entry] })], entfernen: [] } })
  const fehlend = r.json?.fehlend?.kb0123456789 || []
  check('Übertragen: Lieferschein und Fotonachweis fehlen noch', r.status === 200 && fehlend.includes(entry.datei) && fehlend.includes(foto.datei), JSON.stringify(r.json))
  for (const datei of fehlend) {
    r = await api('datei', { raw: pdf(datei), query: `&link=kb0123456789&datei=${encodeURIComponent(datei)}` })
    check(`Hochgeladen: ${datei}`, r.status === 200, JSON.stringify(r.json))
  }
  r = await api('datei', { raw: pdf('x'), query: `&link=kb0123456789&datei=${encodeURIComponent('fotonachweis-LS-9.pdf')}` })
  check('Fremder Fotonachweis wird nicht angenommen (404)', r.status === 404)

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://127.0.0.1:${PORT}/kunden.php?k=${TOKEN}`)
  const section = page.locator('#mattenwechsel')
  check('Kunde: Lieferschein mit „Fotonachweis (3 Fotos, PDF …)“', /Lieferschein LS-2026-000123/.test(await section.textContent()) && /Fotonachweis \(3 Fotos, PDF/.test(await section.textContent()), (await section.textContent()).slice(0, 300))
  const href = await section.locator('.fotos a').getAttribute('href')
  const dl = await fetch(`http://127.0.0.1:${PORT}/${href.replace(/&amp;/g, '&')}`)
  check('Fotonachweis herunterladen: PDF', dl.status === 200 && (dl.headers.get('content-type') || '').includes('pdf'), `${dl.status}`)
  check('Handy 390 px: ohne Querscrollen', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))

  // Schalter aus: kein Link, kein Herunterladen, Datei gelöscht
  r = await api('speichern', { body: { links: [linkPayload({ link: link(false), hash, objectsById, lieferscheine: [noteEntry(doc, { sig: 'f'.repeat(32) })] })], entfernen: [] } })
  check('Ohne Schalter übertragen: nichts fehlt', r.status === 200 && !(r.json?.fehlend?.kb0123456789 || []).length, JSON.stringify(r.json))
  await page.reload()
  check('Kunde: kein Fotonachweis mehr', !/Fotonachweis/.test(await page.locator('#mattenwechsel').textContent()))
  const gone = await fetch(`http://127.0.0.1:${PORT}/kunden.php?k=${TOKEN}&datei=${foto.datei}`)
  check('Herunterladen ohne Schalter: 404', gone.status === 404)
  await ctx.close()
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
php.kill()
await finish(browser, [], errors)
