// Unterweisung am Handy, vom Büro bis zum Nachweis: App im SharePoint-Betrieb (Attrappe), unterweisung.php und
// mein-plan.php als echtes PHP (eingebauter Server, eigener Ordner privat/, Aufrufe der App werden dorthin durchgereicht).
//  1. „Plan am Handy“ einrichten und übertragen.
//  2. Unterweisungen & Fristen → „Unterweisung am Handy“ → Sicherheitsunterweisung: Vorlage einsetzen (6 Sprachen),
//     Sprachen prüfen, „Speichern und übertragen“.
//  3. Am Handy (390 px) mit dem Link der Person: Hinweis in „Plan am Handy“, lesen, Fragen, Unterschrift mit dem Finger.
//  4. Die App holt das Ergebnis: Eintrag für Sicherheitsunterweisung und Reinigungsmittel, Nachweis als PDF.
// Ports 19861 (App) und 19862 (PHP).
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna, R, P } from './ablauf-lib.mjs'
import { parseQuiz } from '../src/core/unterweisung-online.js'
import { VORLAGE } from '../src/core/unterweisung-vorlage.js'

const PORT = 19861
const PHP = 19862
const dir = join(P, 'unterweisung-app')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const server = startServer(PORT)
const php = spawn('php', ['-S', `127.0.0.1:${PHP}`, '-t', R], { env: { ...process.env, MEIN_PLAN_ORDNER: dir, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }, stdio: 'ignore' })
await wait(1200)
const browser = await chromium.launch()
const errors = []
try {
  const today = todayVienna()
  const { createDemoData } = await import('../src/data/demo.js')
  const { splitData } = await import('../src/storage/data-service.js')
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'] } })
  SP.seed(splitData(createDemoData(mondayOf(today)), []))
  const calls = []
  const forward = (X) =>
    X.ctx.route(/\/(mein-plan|unterweisung)\.php/, async (r) => {
      const u = new URL(r.request().url())
      calls.push(`${u.pathname.slice(1)}:${u.searchParams.get('aktion') || ''}`)
      const res = await r.fetch({ url: `http://127.0.0.1:${PHP}${u.pathname}${u.search}` })
      await r.fulfill({ response: res })
    })
  const O = await SP.open(browser, PORT, { email: 'office@cleanos.at', name: 'Petra Leitner', errors })
  await forward(O)
  const modal = () => O.text('.modal')

  // ------------------------------------------------ 1. Plan am Handy
  await O.act('portal-open')
  await O.page.waitForSelector('.modal #pt-enabled')
  if (!(await O.page.isChecked('#pt-enabled'))) await O.page.check('#pt-enabled')
  const [dl] = await Promise.all([O.page.waitForEvent('download'), O.page.click('.modal [data-action="portal-download"]')])
  writeFileSync(join(dir, 'mitarbeiter.json'), readFileSync(await dl.path(), 'utf8'))
  await O.page.click('.modal [data-action="portal-save"][data-send="1"]')
  check('„Plan am Handy“ eingerichtet und übertragen', !!(await O.toastWait(/Übertragen/, 30000)), await O.text('#toast'))
  await O.act('close-modal')

  // ------------------------------------------------ 2. Editor
  await O.view('unterweisungen')
  await O.act('uo-open')
  await O.page.waitForSelector('.modal [data-action="uo-edit"][data-type="sicherheit"]')
  check('Liste: Sicherheitsunterweisung noch nicht am Handy', /Sicherheitsunterweisung/.test(await modal()) && /noch kein Inhalt/.test(await modal()))
  await O.page.click('.modal [data-action="uo-edit"][data-type="sicherheit"]')
  await O.page.waitForSelector('.modal #uo-content')
  await O.page.click('.modal [data-action="uo-template"]')
  await O.page.waitForFunction(() => document.querySelector('#uo-content')?.value.includes('## '))
  const tabs = await O.page.evaluate(() => [...document.querySelectorAll('.modal [data-action="uo-lang"]')].map((b) => b.textContent.trim()))
  check('Vorlage eingesetzt: alle 6 Sprachen gültig (✓), 15 Fragen, „am Handy“ an', tabs.length === 6 && tabs.every((t) => t.endsWith('✓')) && (await O.page.isChecked('#uo-on')) && /15 Fragen/.test(await modal()), tabs.join(' | '))
  await O.page.click('.modal [data-action="uo-lang"][data-lang="ro"]')
  await O.page.waitForFunction(() => document.querySelector('[data-action="uo-lang"][data-lang="ro"]')?.getAttribute('aria-pressed') === 'true')
  check('Sprache Rumänisch zeigt die rumänischen Texte', (await O.page.inputValue('#uo-title')) === VORLAGE.ro.title)
  await O.page.click('.modal [data-action="uo-save"]')
  check('Gespeichert und übertragen', !!(await O.toastWait(/Gespeichert und übertragen \(\d+ Personen\)/, 30000)), await O.text('#toast'))
  check('Die App hat Ergebnisse abgefragt und übertragen', calls.includes('unterweisung.php:status') && calls.includes('unterweisung.php:uebertragen'), calls.join(','))
  const stamm = () => SP.json('unterweisungen/unterweisungen.json') || {}
  check('In SharePoint: Art mit Texten und Fassung', !!(await O.waitFor(() => stamm().types?.find((t) => t.id === 'sicherheit')?.online?.on && Object.keys(stamm().versions || {}).length === 1, 15000)))

  // ------------------------------------------------ 3. Am Handy
  const portal = SP.json('daten/stammdaten.json')?.rules?.portal || {}
  const emps = SP.json('daten/stammdaten.json')?.employees || []
  const emp = emps.find((e) => portal.codes?.[e.id] && (!e.lang || e.lang === 'de')) || emps.find((e) => portal.codes?.[e.id])
  const lang = emp.lang || 'de'
  const quiz = parseQuiz(VORLAGE[lang].quiz).questions
  const H = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const ph = await H.newPage()
  ph.on('pageerror', (e) => errors.push(`Handy: ${e.message}`))
  await ph.goto(`http://127.0.0.1:${PHP}/mein-plan.php?p=${portal.codes[emp.id]}`)
  check('„Plan am Handy“: offene Unterweisung oben mit Knopf', (await ph.locator('a[href="unterweisung.php"]').count()) === 1)
  await ph.click('a[href="unterweisung.php"]')
  await ph.click('a[href="unterweisung.php?u=sicherheit"]')
  await ph.waitForSelector('fieldset.uw-frage')
  check('Handy: Unterweisung in der Sprache der Person, ohne Querscrollen', (await ph.textContent('h1')).trim() === VORLAGE[lang].title && (await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)))
  for (let i = 0; i < quiz.length; i++) await ph.locator(`fieldset:nth-of-type(${i + 1}) label`, { hasText: quiz[i].options[quiz[i].correct] }).first().click()
  await Promise.all([ph.waitForURL(/schritt=unterschrift/), ph.click('form button[type=submit]')])
  const box = await ph.locator('.unterschrift canvas').boundingBox()
  await ph.mouse.move(box.x + 20, box.y + 40)
  await ph.mouse.down()
  for (const [x, y] of [[70, 20], [120, 60], [180, 30], [240, 55]]) await ph.mouse.move(box.x + x, box.y + y)
  await ph.mouse.up()
  await ph.check('input[name=bestaetigt]')
  await Promise.all([ph.waitForURL(/fertig=1/), ph.click('form button[type=submit]')])
  check('Handy: unterschrieben, Bestätigung mit Name', (await ph.textContent('main')).includes(emp.name))
  await H.close()

  // ------------------------------------------------ 4. Zurück in der App
  await O.act('close-modal')
  await O.act('uo-open')
  await O.page.waitForSelector('.modal [data-action="uo-sync"]')
  await O.page.click('.modal [data-action="uo-sync"]')
  check('App: Ergebnis abgeholt und eingetragen', !!(await O.toastWait(/Abgeglichen: 1 Nachweis neu eingetragen/, 20000)), await O.text('#toast'))
  const recs = () => (stamm().records || []).filter((r) => r.empId === emp.id && r.source === 'handy')
  check('Einträge: Sicherheitsunterweisung und Reinigungsmittel mit Unterschrift, Datum heute', !!(await O.waitFor(() => recs().length === 2, 15000)) && recs().every((r) => r.date === today && r.signature.startsWith('<svg')) && recs().map((r) => r.typeId).sort().join() === 'chemie,sicherheit', JSON.stringify(recs().map((r) => [r.typeId, r.date, r.note])))
  await O.act('close-modal')
  await O.page.click(`main [data-action="tr-record-open"][data-emp="${emp.id}"][data-type="sicherheit"]`)
  await O.page.waitForSelector('.modal [data-action="uo-pdf"]')
  check('Feld der Person: „Am Handy: 15 von 15 Fragen richtig“', /Am Handy: 15 von 15 Fragen richtig/.test(await modal()))
  const [pdf] = await Promise.all([O.page.waitForEvent('download'), O.page.click('.modal [data-action="uo-pdf"]')])
  const bytes = readFileSync(await pdf.path())
  writeFileSync(join(dir, 'nachweis.pdf'), bytes)
  check('Nachweis als PDF', /^Unterweisung_\d{4}-\d{2}-\d{2}_Sicherheitsunterweisung_.+\.pdf$/.test(pdf.suggestedFilename()) && bytes.subarray(0, 4).toString() === '%PDF' && bytes.length > 20000, `${pdf.suggestedFilename()} ${bytes.length}`)
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
php.kill()
await finish(browser, [server], errors)
