// Stempeluhr am Tablet, vom Büro bis zur Stempelung: App im SharePoint-Betrieb (Attrappe), mein-plan.php als echtes PHP
// (eingebauter Server, eigener Ordner privat/, Aufrufe der App werden dorthin durchgereicht).
//  1. „Plan am Handy“ → Zeiterfassung ein → „Tablets und PINs“: Tablet für ein Objekt anlegen, PINs entstehen.
//  2. Einrichtungs-Datei: nur Hashwerte von Code und PINs; nach privat/ gelegt, „Speichern und übertragen“.
//  3. Am Tablet den Einrichtungs-Link öffnen, mit der PIN aus der App stempeln (beweist: App und PHP rechnen gleich).
//  4. Die App holt die Stempelung: Ansicht „Zeiterfassung“ mit Person, Objekt und Vermerk „Tablet“; Tablet „aktiv“.
//  5. Neue PIN (die alte gilt nicht mehr), Blatt mit QR-Code, neuer Link (das Tablet ist keine Stempeluhr mehr), Entfernen.
//  6. Handy 390 px: Unterseite ohne Querscrollen.
// Ports 19821 (App) und 19822 (PHP).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna, R, P } from './ablauf-lib.mjs'

const PORT = 19821
const PHP = 19822
const dir = join(P, 'tablet-app')
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
  /** Aufrufe der App an mein-plan.php gehen an den PHP-Server. */
  const forward = (X) =>
    X.ctx.route(/\/mein-plan\.php/, async (r) => {
      const u = new URL(r.request().url())
      calls.push(u.searchParams.get('aktion') || '')
      const res = await r.fetch({ url: `http://127.0.0.1:${PHP}/mein-plan.php${u.search}` })
      await r.fulfill({ response: res })
    })
  const O = await SP.open(browser, PORT, { email: 'office@cleanos.at', name: 'Petra Leitner', errors })
  await forward(O)
  const portal = () => SP.json('daten/stammdaten.json')?.rules?.portal || {}
  const modal = () => O.text('.modal')
  const scrollX = (X) => X.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

  // ------------------------------------------------ 1. Tablet anlegen
  await O.act('portal-open')
  await O.page.waitForSelector('.modal #pt-enabled')
  check('„Plan am Handy“: ohne Zeiterfassung kein Knopf für Tablets', (await O.page.locator('.modal [data-action="portal-page"]').count()) === 0)
  await O.page.check('.modal #pt-timeclock')
  await O.page.waitForSelector('.modal [data-action="portal-page"][data-page="tablets"]')
  check('Mit Zeiterfassung: „Tablets und PINs …“ mit Erklärung, noch 0 Tablets', /Stempeluhr am Tablet für Objekte ohne eigenes Handy: 0 Tablets/.test(await modal()))
  await O.page.click('.modal [data-action="portal-page"][data-page="tablets"]')
  await O.page.waitForSelector('.modal #pt-tablet-object')
  let t = await modal()
  check('Unterseite: Erklärung, noch kein Tablet, PINs erst mit dem ersten Tablet, drei Schritte', /Stempeluhr am Tablet \(Tablets und PINs\)/.test(t) && /Noch kein Tablet eingerichtet/.test(t) && /PINs entstehen mit dem ersten Tablet/.test(t) && /Speichern und übertragen/.test(t) && /Blatt mit QR-Code/.test(t) && /Geführter Zugriff/.test(t))
  await O.page.click('.modal [data-action="portal-tablet-add"]')
  check('Ohne Objekt: Hinweis statt Tablet', !!(await O.toastWait(/Bitte zuerst das Objekt wählen/)))
  const object = await O.page.evaluate(() => {
    const o = document.querySelector('#pt-tablet-object option:nth-child(2)')
    return { id: o.value, name: o.textContent }
  })
  await O.page.selectOption('#pt-tablet-object', object.id)
  await O.page.click('.modal [data-action="portal-tablet-add"]')
  await O.page.waitForSelector('.modal [data-action="portal-tablet-sheet"]')
  const rowsOf = () =>
    O.page.evaluate(() => ({
      tablets: [...document.querySelectorAll('.modal table')][0] ? [...[...document.querySelectorAll('.modal table')][0].querySelectorAll('tbody tr')].map((tr) => ({ name: tr.cells[0].textContent.trim(), link: tr.querySelector('[data-action="portal-copy"]').dataset.text, state: tr.cells[2].textContent.trim() })) : [],
      pins: [...document.querySelectorAll('.modal code.pt-pin')].map((c) => ({ name: c.closest('tr').cells[0].textContent.trim(), pin: c.textContent.trim(), emp: c.closest('tr').querySelector('[data-action="portal-pin-new"]').dataset.emp, wa: c.closest('tr').querySelector('a.wa-btn')?.getAttribute('href') || '' })),
    }))
  let rows = await rowsOf()
  const link = rows.tablets[0]?.link || ''
  check('Tablet angelegt: Objekt, Einrichtungs-Link mit Code (20 Zeichen), „noch nicht geöffnet“', rows.tablets.length === 1 && rows.tablets[0].name === object.name && new RegExp(`^http://localhost:${PORT}/mein-plan\\.php\\?tablet=[A-Za-z0-9]{20}$`).test(link) && rows.tablets[0].state === 'noch nicht geöffnet', JSON.stringify(rows.tablets))
  check('PINs: jede Person mit Link hat eine eigene mit vier Ziffern', rows.pins.length >= 5 && rows.pins.every((p) => /^[1-9]\d{3}$/.test(p.pin)) && new Set(rows.pins.map((p) => p.pin)).size === rows.pins.length, `${rows.pins.length} PINs`)
  const person = rows.pins[0]
  check('PIN per WhatsApp: Nachricht mit PIN und Anleitung', !person.wa || (decodeURIComponent(person.wa).includes(person.pin) && /Stempeluhr|PIN/.test(decodeURIComponent(person.wa))), person.wa.slice(0, 80))
  check('Das neue Objekt steht nicht mehr zur Auswahl', !(await O.page.locator(`#pt-tablet-object option[value="${object.id}"]`).count()))

  // ------------------------------------------------ 2. Einrichtungs-Datei und Übertragen
  await O.page.click('.modal [data-action="portal-page"][data-page=""]')
  await O.page.waitForSelector('.modal #pt-enabled')
  check('Zurück auf der Hauptseite: 1 Tablet, Zeiterfassung noch an', /ohne eigenes Handy: 1 Tablet/.test(await modal()) && (await O.page.isChecked('#pt-timeclock')))
  const [dl] = await Promise.all([O.page.waitForEvent('download'), O.page.click('.modal [data-action="portal-download"]')])
  const fileText = readFileSync(await dl.path(), 'utf8')
  const file = JSON.parse(fileText)
  const code = link.split('tablet=')[1]
  const tb = file.zeiterfassung?.tablet
  check('Einrichtungs-Datei: Abschnitt „tablet“ mit einem Gerät und allen PINs als Hashwert', dl.suggestedFilename() === 'mitarbeiter.json' && !!tb && Object.keys(tb.geraete).length === 1 && Object.values(tb.geraete)[0].id === object.id && Object.values(tb.geraete)[0].name === object.name && Object.keys(tb.pins).length === rows.pins.length && Object.keys(tb.pins).every((k) => /^[a-f0-9]{64}$/.test(k)) && Object.values(tb.pins).every((p) => /^[a-f0-9]{64}$/.test(p.hash) && p.name), JSON.stringify(tb).slice(0, 200))
  check('In der Datei stehen weder der Code des Tablets noch eine PIN im Klartext', !fileText.includes(code) && !rows.pins.some((p) => new RegExp(`"${p.pin}"`).test(fileText)))
  check('Einstellungen in den Stammdaten: Tablet und PINs', !!(await O.waitFor(() => portal().tablets?.[object.id] === code && Object.keys(portal().pins || {}).length === rows.pins.length, 15000)), JSON.stringify(portal().tablets))
  writeFileSync(join(dir, 'mitarbeiter.json'), fileText) // einmalig per FTP nach privat/
  await O.page.click('.modal [data-action="portal-save"][data-send="1"]')
  check('„Speichern und übertragen“: am Webspace angekommen', !!(await O.toastWait(/Übertragen: Pläne für \d+ Person/, 30000)), await O.text('#toast'))
  check('Die App hat eingerichtet und die Pläne geschickt', calls.includes('einrichten') && calls.includes('speichern'), calls.join(','))

  // ------------------------------------------------ 3. Am Tablet stempeln (echtes PHP, PIN aus der App)
  const T = await browser.newContext({ viewport: { width: 800, height: 1280 } })
  const tab = await T.newPage()
  tab.on('pageerror', (e) => errors.push(`Tablet: ${e.message}`))
  const tabletUrl = link.replace(`http://localhost:${PORT}`, `http://127.0.0.1:${PHP}`)
  await tab.goto(tabletUrl)
  await tab.waitForSelector('#tb-form.tb-js')
  check('Tablet: Einrichtungs-Link öffnet die Stempeluhr des Objekts', (await tab.textContent('#tb')).includes(object.name) && tab.url().endsWith('?tablet=1'))
  const type = async (pin) => {
    for (const z of pin) await tab.click(`.tb-tasten button[data-z="${z}"]`)
  }
  await type(person.pin)
  await tab.waitForSelector('.tb-name')
  check('Tablet: die PIN aus der App gehört zur richtigen Person', (await tab.textContent('.tb-name')).includes(person.name), await tab.textContent('.tb-name'))
  await tab.click('button.tb-gross')
  await tab.waitForSelector('.tb-haken')
  check('Tablet: Stempelung erfasst', /erfasst/.test(await tab.textContent('#tb')), (await tab.textContent('#tb')).replace(/\s+/g, ' ').slice(0, 120))

  // ------------------------------------------------ 4. Die App holt die Stempelung
  await O.view('zeiten')
  await O.act('nav-today') // die Vorschau beginnt mit der nächsten Woche
  await wait(400)
  await O.act('tc-sync')
  check('App: Stempelung übernommen', !!(await O.toastWait(/1 Stempelung übernommen/, 20000)), await O.text('#toast'))
  const row = await O.waitFor(() =>
    O.page.evaluate(
      ([n, o]) => {
        const tr = [...document.querySelectorAll('main .tc-table tbody tr')].find((x) => x.textContent.includes(n) && x.textContent.includes(o))
        return tr ? tr.innerText.replace(/\s+/g, ' ') : ''
      },
      [person.name, object.name],
    ),
  )
  check('Ansicht „Zeiterfassung“: Zeile mit Person, Objekt, Kommen und Vermerk „Tablet“', /\d{2}:\d{2}/.test(row || '') && /Tablet/.test(row || ''), row || '(keine Zeile)')
  const stored = Object.values(SP.json(`plaene/${today.slice(0, 4)}/${mondayOf(today)}.json`)?.stamps || {})
  check('Stempelung in der Woche gespeichert (Person zugeordnet, Quelle Tablet)', !!(await O.waitFor(() => Object.values(SP.json(`plaene/${today.slice(0, 4)}/${mondayOf(today)}.json`)?.stamps || {}).some((s) => s.empId === person.emp && s.objectId === object.id && s.via === 'tablet'), 15000)), JSON.stringify(stored).slice(0, 200))
  await O.act('portal-open')
  await O.page.waitForSelector('.modal [data-action="portal-page"][data-page="tablets"]')
  await O.page.click('.modal [data-action="portal-page"][data-page="tablets"]')
  await O.page.waitForSelector('.modal [data-action="portal-tablet-sheet"]')
  rows = await rowsOf()
  check('Unterseite nach dem Abruf: Tablet „aktiv“, PINs unverändert', rows.tablets[0].state === 'aktiv' && rows.pins[0].pin === person.pin, JSON.stringify(rows.tablets))

  // ------------------------------------------------ 5. Neue PIN, Blatt, neuer Link, Entfernen
  await O.page.click(`.modal [data-action="portal-pin-new"][data-emp="${person.emp}"]`)
  await O.toastWait(/Neue PIN für/)
  const fresh = (await rowsOf()).pins.find((p) => p.emp === person.emp).pin
  check('„Neue PIN“: andere PIN, weiter eindeutig', fresh !== person.pin && /^[1-9]\d{3}$/.test(fresh) && new Set((await rowsOf()).pins.map((p) => p.pin)).size === rows.pins.length, `${person.pin} → ${fresh}`)
  const [sheet] = await Promise.all([O.page.waitForEvent('download', { timeout: 30000 }), O.page.click('.modal [data-action="portal-tablet-sheet"]')])
  const pdf = readFileSync(await sheet.path())
  check('„Blatt mit QR-Code“: PDF mit dem Namen des Objekts, vorher übertragen', /^Stempeluhr_einrichten_.+\.pdf$/.test(sheet.suggestedFilename()) && pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 4000 && !!(await O.toastWait(/Blatt erstellt: mit der Kamera des Tablets scannen, danach vernichten\.$/, 15000)), `${sheet.suggestedFilename()} ${pdf.length} · ${await O.text('#toast')}`)
  await tab.goto(`http://127.0.0.1:${PHP}/mein-plan.php?tablet=1`)
  await tab.waitForSelector('#tb-form.tb-js')
  await type(person.pin)
  await tab.waitForSelector('.fehler')
  check('Tablet: die alte PIN gilt nach dem Übertragen nicht mehr', /Diese PIN kennen wir nicht/.test(await tab.textContent('#tb')))
  await type(fresh)
  await tab.waitForSelector('.tb-name')
  check('Tablet: die neue PIN gilt', (await tab.textContent('.tb-name')).includes(person.name))

  await O.page.click('.modal [data-action="portal-tablet-new"]')
  await O.toastWait(/Neuer Einrichtungs-Link/)
  const link2 = (await rowsOf()).tablets[0].link
  check('„Neuer Link“: anderer Code für dasselbe Objekt', link2 !== link && /tablet=[A-Za-z0-9]{20}$/.test(link2))
  await O.page.click('.modal [data-action="portal-save"][data-send="1"]')
  await O.toastWait(/Übertragen: Pläne für \d+ Person/, 30000)
  await tab.goto(`http://127.0.0.1:${PHP}/mein-plan.php?tablet=1`)
  check('Tablet mit dem alten Link: keine Stempeluhr mehr', /nicht \(mehr\) als Stempeluhr eingerichtet/.test(await tab.textContent('main')))
  await tab.goto(link2.replace(`http://localhost:${PORT}`, `http://127.0.0.1:${PHP}`))
  await tab.waitForSelector('#tb-form.tb-js')
  check('Tablet mit dem neuen Link: wieder Stempeluhr des Objekts', (await tab.textContent('#tb')).includes(object.name))
  await T.close()

  await O.act('portal-open')
  await O.page.click('.modal [data-action="portal-page"][data-page="tablets"]')
  await O.page.waitForSelector('.modal [data-action="portal-tablet-del"]')
  await O.page.click('.modal [data-action="portal-tablet-del"]')
  await O.toastWait(/entfernt/)
  check('„Entfernen“: Tablet weg, Objekt wieder wählbar', /Noch kein Tablet eingerichtet/.test(await modal()) && (await O.page.locator(`#pt-tablet-object option[value="${object.id}"]`).count()) === 1)
  await O.page.click('.modal [data-action="portal-save"][data-send="1"]')
  await O.toastWait(/Übertragen: Pläne für \d+ Person/, 30000)
  const after = JSON.parse(readFileSync(join(dir, 'mitarbeiter.json'), 'utf8'))
  check('Ohne Tablet: kein Abschnitt „tablet“ am Webspace, QR-Zeiterfassung bleibt, PINs bleiben in der App für später', !after.zeiterfassung.tablet && Object.keys(after.zeiterfassung.objekte).length > 0 && !!(await O.waitFor(() => Object.keys(portal().tablets || {}).length === 0 && portal().pins?.[person.emp] === fresh, 15000)))
  check('Am Webspace liegen keine PINs im Klartext', existsSync(join(dir, 'mitarbeiter', 'tablet.json')) && !readFileSync(join(dir, 'mitarbeiter', 'zeiten.json'), 'utf8').includes(fresh))
  await O.ctx.close()

  // ------------------------------------------------ 6. Handy
  const M = await SP.open(browser, PORT, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, mobile: true })
  await forward(M)
  await M.act('portal-open')
  await M.page.waitForSelector('.modal [data-action="portal-page"][data-page="tablets"]')
  await M.page.click('.modal [data-action="portal-page"][data-page="tablets"]')
  await M.page.waitForSelector('.modal #pt-tablet-object')
  await M.page.selectOption('#pt-tablet-object', object.id)
  await M.page.click('.modal [data-action="portal-tablet-add"]')
  await M.page.waitForSelector('.modal [data-action="portal-tablet-sheet"]')
  check('Handy 390 px: Unterseite mit Tablet und PINs ohne Querscrollen', (await scrollX(M)) <= 0 && (await M.page.locator('.modal code.pt-pin').count()) >= 5, `${await scrollX(M)}`)
  await M.page.screenshot({ path: join(P, 'tablet-app-handy.png') })
  await M.ctx.close()
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
php.kill()
await finish(browser, [server], errors)
