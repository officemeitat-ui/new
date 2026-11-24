// Mattenwechsel: Fotos ausgebaut (core/matten-fotos.js) im SharePoint-Betrieb (Graph-Attrappe).
//  1. Büro (PC): Liegeplatz-Dialog mit Abschnitt „Fotos“; Liegeplatz-Foto hochladen (matten/fotos/liegeplatz/<Liegeplatz>/…),
//     in matten.json vermerkt; Einstellungen der Lieferscheine: Fotopflicht „bei nicht möglich“, Fotonachweis beilegen,
//     Büro-Adresse.
//  2. Fahrer (Handy 390 px): Tour mit Kopie der Fotopflicht und des Liegeplatz-Fotos; Hinweis am Stopp, Knopf
//     „So liegt die Matte“ öffnet das Foto; „Nicht möglich“ ohne Foto → Abschluss gesperrt (Hinweis im Dialog und Meldung),
//     mit Foto geht der Abschluss.
//  3. Büro: Liste zeigt „1 Foto“; Dialog „Fotos des Fahrers“ mit Liegeplatz, Zeit und Grund; Fotonachweis als PDF
//     (Kopf, Liegeplatz, ein Bild); E-Mail mit Lieferschein und Fotonachweis; Liegeplatz-Dialog zeigt das Foto des
//     Wechsels im Verlauf und übernimmt es als Liegeplatz-Foto.
// Port 19851.
import { execFileSync } from 'node:child_process'
import { chromium, check, finish, note, sharepoint, startServer, wait, mondayOf, todayVienna, P } from './ablauf-lib.mjs'

const APP = 19851
const server = startServer(APP)
await wait(1000)
const browser = await chromium.launch()
const errors = []
try {
  const today = todayVienna()
  const y = today.slice(0, 4)
  const { createDemoData } = await import('../src/data/demo.js')
  const { splitData } = await import('../src/storage/data-service.js')
  const { stopsFromJobs } = await import('../src/core/matten-tour.js')
  const { releaseTour } = await import('../src/core/matten-touren.js')
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'], members: { mattenfahrer: ['fahrer@cleanos.at'] } } })
  const demo = createDemoData(mondayOf(today))
  SP.seed(splitData(demo, []))
  const matten = () => SP.json('matten/matten.json')
  const lpOf = (id) => matten().placements.find((p) => p.id === id)
  const jpegIn = async (X, color) => Buffer.from(await X.page.evaluate(async (c) => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 48; const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 64, 48); const b = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.8)); return [...new Uint8Array(await b.arrayBuffer())] }, color))
  const over = (X) => X.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

  // ------------------------------------------------ 1. Büro: Liegeplatz-Foto und Einstellungen
  const O = await SP.open(browser, APP, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, hash: '#mw-liegeplaetze' })
  await O.waitFor(async () => /Schauraum Eingang/.test(await O.text('main')), 20000)
  await O.act('mw-edit-open', { id: 'mw-demo1' })
  await O.page.waitForSelector('.modal .mw-photos')
  let t = await O.text('.modal .mw-photos')
  check('Liegeplatz-Dialog: Abschnitt „Fotos“ mit Hinweis, noch ohne Foto', /Noch kein Liegeplatz-Foto/.test(t) && /Foto hochladen/.test(t) && /Fotos der letzten Wechsel/.test(t) && /Noch keine Fotos der Fahrer/.test(t), t)
  await O.page.setInputFiles('.modal input[data-change="mw-photo-add"]', { name: 'eingang.jpg', mimeType: 'image/jpeg', buffer: await jpegIn(O, '#2a7') })
  const refOk = await O.waitFor(async () => lpOf('mw-demo1')?.photo?.path && SP.drive.items.get(`Plattform/${lpOf('mw-demo1').photo.path}`), 15000)
  const ref = lpOf('mw-demo1')?.photo
  check('Liegeplatz-Foto hochgeladen und am Liegeplatz vermerkt (Pfad, Name, wer, wann)', !!refOk && /^matten\/fotos\/liegeplatz\/mw-demo1\/\d{8}-\d{6}\.jpg$/.test(ref.path) && ref.by === 'Petra Leitner' && /T/.test(ref.at), JSON.stringify(ref))
  t = await O.text('.modal .mw-photos')
  check('Dialog zeigt das Liegeplatz-Foto mit „ansehen“, „Entfernen“ und „Foto ersetzen“', /Liegeplatz-Foto ansehen/.test(t) && /Entfernen/.test(t) && /Foto ersetzen/.test(t), t)
  await O.page.screenshot({ path: `${P}/matten-fotos-liegeplatz.png` })
  await O.closeModals()

  await O.view('mw-lieferscheine')
  await O.page.evaluate(async () => (await import('/src/ui/context.js')).openModal({ type: 'mw-ls-settings' }))
  await O.page.waitForSelector('#mw-ls-photo-rule')
  check('Einstellungen: Fotopflicht mit drei Stufen, Vorgabe freiwillig', (await O.page.locator('#mw-ls-photo-rule option').count()) === 3 && (await O.page.inputValue('#mw-ls-photo-rule')) === 'nie' && !(await O.page.isChecked('#mw-ls-photo-proof')))
  await O.page.selectOption('#mw-ls-photo-rule', 'ausnahme')
  await O.page.check('#mw-ls-photo-proof')
  await O.page.fill('#mw-ls-office', 'buero@cleanos.at')
  await O.page.click('.modal [data-action="mw-ls-settings-save"]')
  check('Einstellungen gespeichert: Fotopflicht bei „nicht möglich“, Fotonachweis beilegen', !!(await O.waitFor(async () => matten().settings.photoRule === 'ausnahme' && matten().settings.photoProof === true && matten().settings.officeEmail === 'buero@cleanos.at', 15000)), JSON.stringify(matten().settings))

  // ------------------------------------------------ Tour für heute (wie die Freigabe im Büro: Kopie der Regel und des Fotos)
  const placements = matten().placements
  const ids = ['mw-demo1', 'mw-demo2']
  const jobs = ids.map((pid) => ({ key: `${pid}:${today}`, placementId: pid, due: today, status: 'geplant' }))
  const stops = stopsFromJobs({ jobs, placements, objects: demo.objects, date: today })
  const draft = { schema: 1, id: 'mtfoto00000001', date: today, driverId: 'e2', driverName: 'Markus Huber', driverEmail: 'fahrer@cleanos.at', vehicleId: '', status: 'entwurf', order: stops.map((s) => s.id), route: { provider: 'luftlinie', shift: { from: '07:00', to: '15:30' } }, stops, createdAt: `${today}T05:00:00.000Z`, createdBy: 'Büro', updatedAt: `${today}T05:00:00.000Z`, updatedBy: 'Büro' }
  const A = releaseTour(draft, { now: `${today}T05:10:00.000Z`, by: 'Büro', photoRule: matten().settings.photoRule })
  const pathA = `matten/touren/${y}/${A.id}.json`
  SP.seed({ [pathA]: A })
  const fileA = () => SP.json(pathA)
  const sid = stops[0].id
  check('Tour: ein Stopp mit zwei Liegeplätzen, Fotopflicht und Liegeplatz-Foto als Kopie', stops.length === 1 && A.photoRule === 'ausnahme' && A.stops[0].items.find((it) => it.placementId === 'mw-demo1').refPhoto === ref.path && !A.stops[0].items.find((it) => it.placementId === 'mw-demo2').refPhoto, JSON.stringify(A.stops[0].items.map((it) => [it.placementId, it.refPhoto])))

  // ------------------------------------------------ 2. Fahrer am Handy
  const F = await SP.open(browser, APP, { email: 'fahrer@cleanos.at', name: 'Markus Huber', mobile: true, errors })
  await F.page.click('.bottom-nav [data-view="mw-touren"]')
  await F.waitFor(async () => (await F.page.locator('main .mwf-card').count()) > 0, 15000)
  await F.page.locator(`main [data-action="mwf-open"][data-tour="${A.id}"]`).tap(); await wait(500)
  await F.page.locator('main [data-action="mwf-start"]').tap()
  await F.waitFor(async () => fileA().status === 'unterwegs')
  await F.page.locator('main .mwf-go [data-action="mwf-stop"]').first().tap(); await wait(400)
  t = await F.text('main')
  check('Stopp: Hinweis zur Fotopflicht und Knopf „So liegt die Matte“ nur am Liegeplatz mit Foto', /Foto Pflicht, wenn ein Wechsel nicht möglich ist/.test(t) && (await F.page.locator('main [data-action="mwf-ref-open"]').count()) === 1 && (await F.page.locator('main section.mwf-pl[data-pl="mw-demo1"] [data-action="mwf-ref-open"]').count()) === 1, t.slice(0, 500))
  check('Stopp am Handy ohne Querscrollen', (await over(F)) <= 1, String(await over(F)))
  const refBox = await F.page.locator('main [data-action="mwf-ref-open"]').boundingBox()
  check('Knopf „So liegt die Matte“: Tippfläche ab 44 px', refBox.height >= 44, String(refBox.height))
  const [pop] = await Promise.all([F.ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null), F.page.locator('main [data-action="mwf-ref-open"]').tap()])
  check('„So liegt die Matte“ öffnet das Foto aus SharePoint', !!pop && /^blob:/.test(pop.url()), pop?.url())
  await pop?.close()
  await F.page.screenshot({ path: `${P}/matten-fotos-fahrer-stopp.png`, fullPage: true })
  const pl = (id) => `main section.mwf-pl[data-pl="${id}"]`
  await F.page.locator(`${pl('mw-demo1')} [data-action="mwf-done"]`).tap(); await wait(300)
  await F.page.locator(`${pl('mw-demo2')} [data-action="mwf-not-open"]`).tap()
  await F.page.waitForSelector('.modal input[name="mwf-not-reason"]')
  await F.page.locator('.modal label.mwf-choice:has-text("kein Zugang")').tap()
  await F.page.locator('.modal [data-action="mwf-not"]').tap(); await wait(400)
  // Abschluss ohne Foto: gesperrt
  await F.page.locator('main [data-action="mwf-finish-open"]').tap()
  await F.page.waitForSelector('.modal [data-action="mwf-nosig"]')
  t = await F.text('.modal')
  check('Abschluss-Dialog nennt das fehlende Foto am Liegeplatz', /Foto fehlt bei „Werkstatt Kundenannahme“/.test(t) && /beim Liegeplatz auf „Foto“ tippen/.test(t), t.slice(0, 400))
  await F.page.locator('.modal [data-action="mwf-nosig"]').tap()
  await F.page.waitForSelector('#mwf-f-reason')
  await F.page.fill('#mwf-f-reason', 'niemand vor Ort')
  await F.page.locator('.modal [data-action="mwf-finish"]').tap()
  await F.toastWait(/Foto fehlt bei „Werkstatt Kundenannahme“/, 8000)
  await wait(500)
  check('Ohne Foto bleibt der Stopp offen (auch in SharePoint)', !fileA().stops[0].finishedAt && (await F.page.locator('.modal [data-action="mwf-finish"]').count()) === 1, JSON.stringify(fileA().stops[0].status))
  await F.closeModals(); await wait(300)
  // Foto am nicht möglichen Liegeplatz, dann geht der Abschluss
  await F.page.setInputFiles(`${pl('mw-demo2')} input[data-change="mwf-photo"]`, { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer: await jpegIn(F, '#a33') })
  const fotoPath = `matten/fotos/${y}/mw-demo2/${today}_${A.id}_01.jpg`
  check('Foto des Fahrers in SharePoint und an der Tour', !!(await F.waitFor(async () => SP.drive.items.get(`Plattform/${fotoPath}`) && fileA().stops[0].items.find((it) => it.placementId === 'mw-demo2')?.photos?.[0]?.path === fotoPath, 15000)))
  await F.page.locator('main [data-action="mwf-finish-open"]').tap()
  await F.page.waitForSelector('.modal [data-action="mwf-nosig"]')
  check('Abschluss-Dialog ohne Foto-Hinweis, sobald das Foto da ist', !/Foto fehlt/.test(await F.text('.modal')))
  await F.page.locator('.modal [data-action="mwf-nosig"]').tap()
  await F.page.waitForSelector('#mwf-f-reason')
  await F.page.fill('#mwf-f-reason', 'niemand vor Ort')
  await F.page.locator('.modal [data-action="mwf-finish"]').tap()
  check('Mit Foto abgeschlossen (teilweise), Tour fertig', !!(await F.waitFor(async () => fileA().stops[0].status === 'teilweise' && fileA().status === 'abgeschlossen', 15000)), JSON.stringify([fileA().stops[0].status, fileA().status]))

  // ------------------------------------------------ 3. Büro: Fotos am Lieferschein, Fotonachweis, Versand, Verlauf
  await O.act('mw-ls-reload').catch(() => {})
  await O.waitFor(async () => /1 Foto/.test(await O.text('main')), 20000)
  t = await O.text('main')
  check('Liste der Lieferscheine: Stopp mit „1 Foto“', /1 Foto/.test(t) && /Autohaus Maxglan/.test(t), t.slice(0, 600))
  await O.act('mw-ls-create', { key: `matten:${A.id}:${sid}` })
  const fak = () => SP.json('fakturierung/fakturierung.json')
  const doc = await O.waitFor(async () => fak().documents.find((d) => d.kind === 'lieferschein' && d.source?.tourId === A.id && d.number), 20000)
  check('Lieferschein erstellt', !!doc, JSON.stringify(doc?.number))
  await O.closeModals()
  await O.act('mw-ls-open', { tour: A.id, stop: sid })
  await O.page.waitForSelector('.modal .mwl-photos')
  t = await O.text('.modal')
  check('Dialog: „Fotos des Fahrers (1)“ mit Liegeplatz, Zeit, Fahrer und Grund; Hinweis zum Fotonachweis', /Fotos des Fahrers \(1\)/.test(t) && /Werkstatt Kundenannahme/.test(t) && /Markus Huber/.test(t) && /nicht möglich: kein Zugang/.test(t) && /Fotonachweis \(PDF\) geht mit dem Lieferschein an den Kunden/.test(t), t.slice(0, 900))
  await O.page.screenshot({ path: `${P}/matten-fotos-lieferschein.png` })
  const [pho] = await Promise.all([O.ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null), O.page.click('.modal [data-action="mw-ls-photo"]')])
  check('Foto im Büro ansehen (aus SharePoint)', !!pho && /^blob:/.test(pho.url()), pho?.url())
  await pho?.close()
  const [dl] = await Promise.all([O.page.waitForEvent('download', { timeout: 30000 }), O.page.click('.modal [data-action="mw-ls-proof"]')])
  const pdfFile = `${P}/matten-fotonachweis.pdf`
  await dl.saveAs(pdfFile)
  const pdfText = execFileSync('pdftotext', ['-layout', pdfFile, '-']).toString()
  const images = execFileSync('pdfimages', ['-list', pdfFile]).toString().split('\n').filter((l) => /^\s*\d+\s+\d+\s+image/.test(l)).length
  check('Fotonachweis als PDF: Name, Kopf, Kunde, Lieferschein, Liegeplatz mit Grund, ein Bild', new RegExp(`^Fotonachweis_${doc.number}_Autohaus-Maxglan`).test(dl.suggestedFilename()) && /Fotonachweis/.test(pdfText) && /Autohaus Maxglan Beispiel KG/.test(pdfText) && new RegExp(doc.number).test(pdfText) && /Werkstatt Kundenannahme/.test(pdfText) && /nicht möglich: kein Zugang/.test(pdfText) && /1 Foto/.test(pdfText) && images >= 1, `${dl.suggestedFilename()} Bilder ${images}\n${pdfText.slice(0, 700)}`)
  check('Fotonachweis ohne Preise', !/€|EUR/.test(pdfText))
  await O.closeModals()
  // Versand ans Büro: Lieferschein und Fotonachweis
  await O.act('mw-ls-send', { id: doc.id, mode: 'buero' })
  await O.page.waitForSelector('.modal #mc-to', { timeout: 20000 })
  const files = await O.text('.modal .mc-files')
  const toField = await O.page.inputValue('#mc-to')
  const n = SP.sent.length
  await O.page.click('.modal [data-action="mail-send"]')
  const sentOk = await O.waitFor(async () => SP.sent.length > n, 20000)
  const mail = sentOk ? SP.sent.at(-1) : null
  const att = mail?.message?.attachments || []
  const toSent = (mail?.message?.toRecipients || []).map((r) => r.emailAddress?.address).join(';')
  if (!sentOk) note(`nicht gesendet: an „${toField}“, Meldung: ${await O.text('#toast')}`)
  check('E-Mail mit zwei Anhängen: Lieferschein und Fotonachweis', /LS-\d{4}-\d+_/.test(files) && /Fotonachweis_/.test(files) && att.length === 2 && /^Fotonachweis_/.test(att[1].name) && att[1].contentType === 'application/pdf' && toSent === 'buero@cleanos.at' && toField === 'buero@cleanos.at', `${files} ${JSON.stringify(att.map((a) => [a.name, a.contentType]))} ${toSent}`)
  await O.closeModals()

  // Verlauf am Liegeplatz und Übernahme als Liegeplatz-Foto
  await O.view('mw-liegeplaetze')
  await O.act('mw-edit-open', { id: 'mw-demo2' })
  await O.page.waitForSelector('.modal .mw-photos .mw-photo-list')
  t = await O.text('.modal .mw-photos')
  check('Liegeplatz-Dialog: Foto des Wechsels im Verlauf (Fahrer, nicht möglich mit Grund)', /Markus Huber/.test(t) && /nicht möglich: kein Zugang/.test(t) && /als Liegeplatz-Foto/.test(t) && /Noch kein Liegeplatz-Foto/.test(t), t)
  await O.page.click('.modal [data-action="mw-photo-use"]')
  check('Foto des Fahrers als Liegeplatz-Foto übernommen', !!(await O.waitFor(async () => lpOf('mw-demo2')?.photo?.path === fotoPath && lpOf('mw-demo2').photo.from === 'fahrer', 15000)), JSON.stringify(lpOf('mw-demo2')?.photo))
  await O.page.click('.modal [data-action="mw-photo-del"]')
  check('Liegeplatz-Foto entfernt, die Datei bleibt in der Ablage', !!(await O.waitFor(async () => !lpOf('mw-demo2')?.photo, 15000)) && !!SP.drive.items.get(`Plattform/${fotoPath}`))
  await O.closeModals()
  check('keine Fehler im Browser', !errors.length, errors.slice(0, 5).join(' | '))
  note(`Fotonachweis: ${pdfFile}`)
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
