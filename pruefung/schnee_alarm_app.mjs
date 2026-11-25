// Schnee-Alarm in der App mit WhatsApp von selbst: App im SharePoint-Betrieb (Attrappe), wetter-alarm.php als echtes
// PHP (Aufrufe der App werden durchgereicht), Push (ntfy) und WhatsApp (Schnittstelle von Meta) werden mitgelesen.
//  1. „Alarm einrichten“: Stufe 1 aus dem Winterteam, Spalte „WhatsApp von selbst“ (nur mit Handynummer im Stammblatt),
//     Büro-Nummern für Stufe 2; die Alarm-Datei enthält die Nummern der Angehakten, sonst nichts Neues.
//  2. „Speichern und übertragen“; WhatsApp-Zugang eintragen: geht nur an den Webspace, steht danach weder in
//     SharePoint noch im Browser; Stand „eingerichtet“ ohne Token. Probe-Nachricht.
//  3. „Testalarm senden“: Push an alle aus Stufe 1, WhatsApp an die Angehakten; „Bin wach“ erscheint in der App.
//  4. „WhatsApp entfernen“; Handy 390 px ohne Querscrollen.
// Ports 19836 (App), 19837 (PHP), 19838 (ntfy), 19839 (WhatsApp).
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna, R, P } from './ablauf-lib.mjs'

const PORT = 19836
const PHP = 19837
const NTFY = 19838
const WA = 19839
const TOKEN = `EAAG${'t0k3n'.repeat(30)}XYZ9`
const NUMBER_ID = '123456789012345'
const dir = join(P, 'schnee-app')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

const body = (req) => new Promise((ok) => { let t = ''; req.on('data', (c) => (t += c)); req.on('end', () => ok(t)) })
const pushes = []
const ntfy = createServer(async (req, res) => {
  pushes.push(JSON.parse((await body(req)) || '{}'))
  res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
}).listen(NTFY, '127.0.0.1')
const whatsapps = []
const meta = createServer(async (req, res) => {
  const m = JSON.parse((await body(req)) || '{}')
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'Invalid OAuth access token', code: 190 } }))
  whatsapps.push({ pfad: req.url, ...m })
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ input: m.to, wa_id: m.to }], messages: [{ id: `wamid.${whatsapps.length}` }] }))
}).listen(WA, '127.0.0.1')
const server = startServer(PORT)
const php = spawn('php', ['-S', `127.0.0.1:${PHP}`, '-t', R], { env: { ...process.env, WETTER_ALARM_ORDNER: dir, WHATSAPP_API: `http://127.0.0.1:${WA}`, TMPDIR: dir, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }, stdio: 'ignore' })
await wait(1200)
const browser = await chromium.launch()
const errors = []
try {
  const today = todayVienna()
  const { createDemoData } = await import('../src/data/demo.js')
  const { splitData } = await import('../src/storage/data-service.js')
  const data = createDemoData(mondayOf(today))
  // Handynummern im Stammblatt: zwei in österreichischer Schreibweise, eine mit +43, eine Person ohne Nummer
  const phones = { 'Dragan Jović': '0664 1111111', 'Gül Arslan': '+43 664 2222222', 'Irina Bogdan': '0650/333 33 33' }
  for (const e of data.employees) if (phones[e.name]) e.phone = phones[e.name]
  const idOf = (name) => data.employees.find((e) => e.name === name).id
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'] } })
  SP.seed(splitData(data, []))
  const calls = []
  const forward = (X) =>
    X.ctx.route(/\/wetter-alarm\.php/, async (r) => {
      const u = new URL(r.request().url())
      calls.push(`${r.request().method()} ${u.searchParams.get('aktion')}`)
      await r.fulfill({ response: await r.fetch({ url: `http://127.0.0.1:${PHP}/wetter-alarm.php${u.search}` }) })
    })
  const O = await SP.open(browser, PORT, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, hash: '#wetter' })
  await forward(O)
  const alarm = () => SP.json('daten/stammdaten.json')?.rules?.weather?.alarm || {}
  const modal = () => O.text('.modal')
  const waState = () => O.text('#al-wa-state')
  const openDialog = async () => {
    await O.act('wx-alarm-open')
    await O.page.waitForSelector('.modal #al-enabled')
  }

  // ------------------------------------------------ 1. Einrichten
  await O.waitFor(async () => /Schnee-Alarm/.test(await O.text('main')), 20000)
  check('Wetter & Winterdienst: Schnee-Alarm ist anfangs aus, Knopf „Alarm einrichten“', /Schnee-Alarm \(aus\)/.test(await O.text('main .wx-alarm')) && (await O.page.locator('main [data-action="wx-alarm-open"]').count()) === 1)
  await O.page.click('main [data-action="wx-alarm-open"]')
  await O.page.waitForSelector('.modal #al-enabled')
  let t = await modal()
  check('Dialog: Abschnitt „WhatsApp von selbst“ erklärt Meta, Kosten und die Grenze beim Wecken', /WhatsApp von selbst/.test(t) && /offizielle Schnittstelle von Meta/.test(t) && /ein paar Cent/.test(t) && /ntfy-App verlässlicher/.test(t) && /Knopf zum Selber-Schicken/.test(t))
  check('Vor dem Einrichten des Alarms: Hinweis, dass zuerst die Alarm-Datei am Webspace liegen muss', /Zuerst den Schnee-Alarm speichern und am Webspace einrichten/.test(await waState()))
  const rows = () =>
    O.page.evaluate(() =>
      [...document.querySelectorAll('.modal table.data')]
        .find((tb) => /WhatsApp von selbst/.test(tb.tHead?.innerText || ''))
        ?.tBodies[0].querySelectorAll('tr')
        .values()
        .toArray()
        .map((tr) => ({ name: tr.cells[0].innerText.trim(), wa: tr.cells[3].innerText.trim(), box: !!tr.querySelector('input[name="al-wa"]'), checked: !!tr.querySelector('input[name="al-wa"]:checked') })),
    )
  let people = await rows()
  const by = (name) => people.find((p) => p.name === name)
  check('Handys: je Person aus Stufe 1 die Nummer für WhatsApp (mit Ländervorwahl), ohne Nummer kein Häkchen', people.length === 4 && by('Dragan Jović').wa === '+436641111111' && by('Gül Arslan').wa === '+436642222222' && by('Irina Bogdan').wa === '+436503333333' && by('Elif Kaya').wa === 'keine Nummer' && !by('Elif Kaya').box && people.every((p) => !p.checked), JSON.stringify(people))
  await O.page.check(`.modal input[name="al-wa"][value="${idOf('Dragan Jović')}"]`)
  await O.page.check(`.modal input[name="al-wa"][value="${idOf('Irina Bogdan')}"]`)
  await O.page.fill('#al-officewa', '0664 9999999, kaputt')
  await O.page.fill('#al-ntfy', `http://127.0.0.1:${NTFY}`)
  await O.page.check('.modal #al-p0-rotate') // zeichnet den Dialog neu: Eingaben müssen bleiben
  await O.page.waitForSelector('.modal #al-p0-rotate:checked')
  people = await rows()
  check('Nach dem Neuzeichnen bleiben die Häkchen; eine unbrauchbare Büro-Nummer wird gemeldet', by('Dragan Jović').checked && by('Irina Bogdan').checked && !by('Gül Arslan').checked && /Eine Nummer ist nicht brauchbar/.test(await modal()))
  await O.page.uncheck('.modal #al-p0-rotate')
  await O.page.fill('#al-officewa', '0664 9999999')
  const [dl] = await Promise.all([O.page.waitForEvent('download'), O.page.click('.modal [data-action="wx-alarm-download"]')])
  const fileText = readFileSync(await dl.path(), 'utf8')
  const file = JSON.parse(fileText)
  const ort = file.orte.find((o) => o.stufe1.length)
  const s1 = (name) => ort.stufe1.find((p) => p.name === name)
  check('Alarm-Datei: WhatsApp-Nummer nur bei den Angehakten, Büro-Nummer in Stufe 2, Thema für Push bei allen', dl.suggestedFilename() === 'wetter-alarm.json' && ort.stufe1.length === 4 && s1('Dragan Jović').whatsapp === '436641111111' && s1('Irina Bogdan').whatsapp === '436503333333' && !('whatsapp' in s1('Gül Arslan')) && !('whatsapp' in s1('Elif Kaya')) && ort.stufe1.every((p) => /^wd-[a-f0-9]{16}$/.test(p.ntfy)) && ort.stufe2.some((p) => p.name === 'Büro' && p.whatsapp === '436649999999') && file.ntfy === `http://127.0.0.1:${NTFY}`, JSON.stringify(ort.stufe1))
  check('In der Alarm-Datei steht kein Zugang zu WhatsApp', !/token|EAAG/i.test(fileText))
  writeFileSync(join(dir, 'wetter-alarm.json'), fileText) // einmalig per FTP nach privat/
  await O.page.click('.modal [data-action="wx-alarm-save"][data-send="1"]')
  check('„Speichern und übertragen“: am Webspace angekommen', !!(await O.toastWait(/Übertragen: \d+ Ort/, 20000)), await O.text('#toast'))
  check('Einstellungen in den Stammdaten: wer per WhatsApp geweckt wird und die Büro-Nummer, sonst nichts zu WhatsApp', !!(await O.waitFor(() => alarm().transferred === true && alarm().whatsapp?.[idOf('Dragan Jović')] === true && alarm().whatsapp?.[idOf('Irina Bogdan')] === true && Object.keys(alarm().whatsapp).length === 2 && alarm().officeWhatsapp === '0664 9999999', 15000)), JSON.stringify(alarm().whatsapp))

  // ------------------------------------------------ 2. WhatsApp-Zugang
  await openDialog()
  check('Dialog nach dem Einrichten: Stand von WhatsApp am Webspace „noch nicht eingerichtet“', !!(await O.waitFor(async () => /noch nicht eingerichtet/.test(await waState()), 10000)), await waState())
  await O.page.click('.modal details.al-wa-help summary')
  t = await modal()
  check('Anleitung für Meta: fünf Schritte, Name und Text der Vorlage, Adresse des Knopfs mit Variable', /business\.facebook\.com/.test(t) && /Telefonnummer-ID/.test(t) && /dauerhaftes Zugriffstoken/.test(t) && /winterdienst_alarm/.test(t) && t.includes('Winterdienst-Meldung: {{1}} – {{2}} (automatische Nachricht)') && t.includes(`http://localhost:${PORT}/wetter-alarm.php?aktion=wach&t={{1}}`) && /Dienstprogramm/.test(t))
  await O.page.fill('#al-wa-token', TOKEN)
  await O.page.fill('#al-wa-id', '+43 664 1234567')
  await O.page.click('.modal [data-action="wx-wa-save"]')
  check('Telefonnummer statt Telefonnummer-ID: Hinweis, nichts gesendet', !!(await O.toastWait(/Telefonnummer-ID besteht nur aus Ziffern/)) && !calls.includes('POST whatsapp'))
  check('Das eingetippte Token bleibt dabei im Feld (als Passwort verdeckt)', (await O.page.inputValue('#al-wa-token')) === TOKEN && (await O.page.getAttribute('#al-wa-token', 'type')) === 'password')
  await O.page.fill('#al-wa-id', NUMBER_ID)
  await O.page.click('.modal [data-action="wx-wa-save"]')
  check('„Am Webspace speichern“: gespeichert', !!(await O.toastWait(/WhatsApp am Webspace gespeichert/, 15000)), await O.text('#toast'))
  check('Stand „eingerichtet“ mit Telefonnummer-ID, Vorlage und den letzten vier Zeichen des Tokens; das Feld ist wieder leer', !!(await O.waitFor(async () => /eingerichtet Telefonnummer-ID 123456789012345, Vorlage winterdienst_alarm \(de\), Token endet auf …XYZ9/.test(await waState()), 10000)) && (await O.page.inputValue('#al-wa-token')) === '', await waState())
  check('Das Token liegt am Webspace in privat/whatsapp.json', JSON.parse(readFileSync(join(dir, 'whatsapp.json'), 'utf8')).token === TOKEN)
  await wait(1500)
  const inSharePoint = [...SP.drive.items.entries()].filter(([, it]) => Buffer.from(it.content).includes(TOKEN)).map(([p]) => p)
  const inBrowser = await O.page.evaluate((tk) => JSON.stringify({ ...localStorage }).includes(tk) || JSON.stringify({ ...sessionStorage }).includes(tk) || document.body.innerHTML.includes(tk), TOKEN)
  check('Das Token steht weder in SharePoint noch im Browser (Speicher, Seite)', inSharePoint.length === 0 && inBrowser === false, inSharePoint.join(', '))
  await O.page.fill('#al-wa-test', 'keine nummer')
  await O.page.click('.modal [data-action="wx-wa-test"]')
  check('Probe ohne brauchbare Nummer: Hinweis', !!(await O.toastWait(/Bitte eine Handynummer mit Vorwahl eintragen/)))
  await O.page.fill('#al-wa-test', '0664 5555555')
  await O.page.click('.modal [data-action="wx-wa-test"]')
  check('„Probe senden“: Nachricht geht mit Ländervorwahl an Meta', !!(await O.toastWait(/Probe an \+436645555555 gesendet/, 15000)) && whatsapps.length === 1 && whatsapps[0].to === '436645555555' && whatsapps[0].pfad === `/v25.0/${NUMBER_ID}/messages` && whatsapps[0].template.name === 'winterdienst_alarm', JSON.stringify(whatsapps[0] || {}).slice(0, 200))
  await O.closeModals()

  // ------------------------------------------------ 3. Testalarm
  await O.waitFor(async () => /Schnee-Alarm \(ein\)/.test(await O.text('main .wx-alarm')), 10000)
  await O.page.click('main [data-action="wx-alarm-test"]')
  check('„Testalarm senden“: an vier Personen', !!(await O.toastWait(/Testalarm an 4 Personen gesendet\. Auf den Handys „Bin wach“ tippen\./, 20000)), await O.text('#toast'))
  await wait(300)
  const test = whatsapps.slice(1)
  check('Push an alle vier aus Stufe 1, WhatsApp nur an die zwei Angehakten', pushes.length === 4 && pushes.every((p) => /^Testalarm Winterdienst /.test(p.title) && p.priority === 5) && test.map((m) => m.to).sort().join() === '436503333333,436641111111', `${pushes.length} Push · ${test.map((m) => m.to)}`)
  const param = (m, type) => m.template.components.find((c) => c.type === type).parameters.map((p) => p.text)
  const dragan = test.find((m) => m.to === '436641111111')
  check('WhatsApp: Überschrift und Text des Testalarms, Knopf mit Bestätigungs-Code', !!dragan && /^Testalarm Winterdienst /.test(param(dragan, 'body')[0]) && /Probe: So kommt der Schnee-Alarm/.test(param(dragan, 'body')[1]) && /^[a-f0-9]{24}$/.test(param(dragan, 'button')[0]), JSON.stringify(dragan || {}).slice(0, 300))
  await O.waitFor(async () => /Testalarm/.test(await O.text('main .wx-alarm')), 15000)
  t = await O.text('main .wx-alarm')
  check('Karte in der App: Testalarm noch unbestätigt, Hinweis „WhatsApp von selbst ist eingerichtet“', /Testalarm .*noch niemand bestätigt/.test(t) && /WhatsApp von selbst ist eingerichtet/.test(t), t.slice(0, 300))
  const wach = await fetch(`http://127.0.0.1:${PHP}/wetter-alarm.php?aktion=wach&t=${param(dragan, 'button')[0]}`, { method: 'POST' })
  await O.page.click('main [data-action="wx-alarm-status"]')
  check('„Bin wach“ über den Knopf der WhatsApp-Nachricht: die App zeigt, wer wach ist', wach.status === 200 && !!(await O.waitFor(async () => /wach: Dragan Jović/.test(await O.text('main .wx-alarm')), 15000)), (await O.text('main .wx-alarm')).slice(0, 300))

  // ------------------------------------------------ 4. Entfernen, Handy
  await openDialog()
  await O.waitFor(async () => /eingerichtet Telefonnummer-ID/.test(await waState()), 10000)
  check('Dialog erneut: Zugang weiter „eingerichtet“, Häkchen wie gespeichert, Token-Feld leer mit Hinweis', (await O.page.inputValue('#al-wa-token')) === '' && /gespeichert, endet auf …XYZ9/.test(await O.page.getAttribute('#al-wa-token', 'placeholder')) && (await rows()).filter((p) => p.checked).map((p) => p.name).sort().join() === 'Dragan Jović,Irina Bogdan')
  await O.page.click('.modal [data-action="wx-wa-remove"]')
  check('„WhatsApp entfernen“: Zugang am Webspace gelöscht, Stand „noch nicht eingerichtet“', !!(await O.toastWait(/WhatsApp entfernt/, 15000)) && !!(await O.waitFor(async () => /noch nicht eingerichtet/.test(await waState()), 10000)) && !existsSync(join(dir, 'whatsapp.json')))
  await O.ctx.close()

  const M = await SP.open(browser, PORT, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, mobile: true, hash: '#wetter' })
  await forward(M)
  await M.waitFor(async () => /Schnee-Alarm/.test(await M.text('main')), 20000)
  await M.act('wx-alarm-open')
  await M.page.waitForSelector('.modal #al-wa-token')
  await M.page.click('.modal details.al-wa-help summary')
  await M.page.evaluate(() => document.querySelector('.modal details.al-wa-help').scrollIntoView())
  const scroll = await M.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('Handy 390 px: Dialog mit Anleitung und Zugangsdaten ohne Querscrollen', scroll <= 0, `${scroll}`)
  await M.page.screenshot({ path: join(P, 'schnee-alarm-handy.png') })
  await M.ctx.close()
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
php.kill()
ntfy.close()
meta.close()
await finish(browser, [server], errors)
