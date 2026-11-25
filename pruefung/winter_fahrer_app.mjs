// Winterdienst in der App (SharePoint-Betrieb mit Attrappe; wetter-alarm.php ist hier nachgestellt, die echte
// Server-Seite prüft winter_fahrer_php.mjs):
//  1. „Protokoll-Links für Fahrer“: Person aus den Mitarbeitenden hinzufügen, Link mit dauerhaftem Code, „Speichern
//     und übertragen“ → Einstellungen in den Stammdaten, Alarm-Datei mit „fahrer“ und allen Objekten mit Winterdienst.
//  2. Vom Handy holen: Eintrag mit Objekt und Foto sowie einer mit freier Adresse werden übernommen, das Foto liegt in
//     SharePoint unter exporte/Winterdienst/<Monat>/, die Übersicht zeigt die freie Adresse als eigene Zeile.
//  3. In der App eintragen: Objekt mit Foto vom Gerät (verkleinert, in SharePoint), dann „andere Adresse“ mit Foto;
//     ohne Adresse wird nicht gespeichert.
// Port 19813.
import { chromium, check, finish, sharepoint, startServer, wait, mondayOf, todayVienna, P } from './ablauf-lib.mjs'

const PORT = 19813
const server = startServer(PORT)
await wait(800)
const browser = await chromium.launch()
const errors = []
try {
  const today = todayVienna()
  const month = today.slice(0, 7)
  const { createDemoData } = await import('../src/data/demo.js')
  const { splitData } = await import('../src/storage/data-service.js')
  const SP = sharepoint({ access: { planners: ['office@cleanos.at'] } })
  SP.seed(splitData(createDemoData(mondayOf(today)), []))

  // wetter-alarm.php nachgestellt: speichern (Datei merken), protokolle, foto, fotos-uebernommen, status
  const ctxRoutes = async (X, state) => {
    await X.ctx.route(/\/wetter-alarm\.php/, async (r) => {
      const u = new URL(r.request().url())
      const aktion = u.searchParams.get('aktion')
      const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (aktion === 'speichern') { state.file = JSON.parse(r.request().postData() || '{}'); state.key = r.request().headers()['x-schluessel']; return json({ gespeichert: `${(state.file.orte || []).length} Orte` }) }
      if (aktion === 'protokolle') return json({ eintraege: state.entries })
      if (aktion === 'foto') return r.fulfill({ status: 200, contentType: 'image/jpeg', body: state.jpeg })
      if (aktion === 'fotos-uebernommen') { state.removed = JSON.parse(r.request().postData() || '{}').dateien; return json({ geloescht: state.removed.length }) }
      return json({ orte: [] })
    })
  }
  const state = { file: null, entries: [], jpeg: null, removed: null }
  const O = await SP.open(browser, PORT, { email: 'office@cleanos.at', name: 'Petra Leitner', errors, hash: '#wetter' })
  await ctxRoutes(O, state)
  state.jpeg = Buffer.from(await O.page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 2400; c.height = 1800; const x = c.getContext('2d'); x.fillStyle = '#39c'; x.fillRect(0, 0, 2400, 1800); const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); return [...new Uint8Array(await b.arrayBuffer())] }))
  await O.waitFor(async () => /Winterdienst-Protokoll/.test(await O.text('main')), 20000)
  check('Wetter & Winterdienst: Knopf „Protokoll-Links für Fahrer“', (await O.page.locator('main [data-action="wx-drivers-open"]').count()) === 1)

  // ------------------------------------------------ 1. Links verwalten
  await O.page.click('main [data-action="wx-drivers-open"]')
  await O.page.waitForSelector('.modal [data-action="wx-drivers-add"]')
  check('Dialog: Erklärung, noch niemand, Hinweis zum Webspace', /Noch niemand eingetragen/.test(await O.text('.modal')) && /Am Webspace noch nicht eingerichtet/.test(await O.text('.modal')))
  await O.page.click('.modal [data-action="wx-drivers-add"]')
  await O.page.fill('#wd-name-0', 'Dragan Jović')
  const link = await O.page.inputValue('.modal .wd-link input')
  check('Link mit dauerhaftem Code (24 Zeichen) zur Protokoll-Seite', new RegExp(`^http://localhost:${PORT}/wetter-alarm\\.php\\?aktion=protokoll&f=[a-f0-9]{24}$`).test(link), link)
  await O.page.click('.modal [data-action="wx-drivers-add"]')
  await O.page.fill('#wd-name-1', 'Aushilfe Winter')
  check('WhatsApp-Knopf je Person mit dem Link im Text', (await O.page.locator('.modal a.wa-btn').count()) >= 1 && decodeURIComponent(await O.page.locator('.modal a.wa-btn').first().getAttribute('href')).includes(link))
  await O.page.click('.modal [data-action="wx-drivers-save"]')
  await O.toastWait(/Übertragen: 2 Protokoll-Links gelten jetzt/, 15000)
  const alarm = () => SP.json('daten/stammdaten.json')?.rules?.weather?.alarm
  check('Einstellungen in den Stammdaten: zwei Fahrer (einer mit Stammblatt verknüpft), übertragen vermerkt', !!(await O.waitFor(async () => alarm()?.drivers?.length === 2 && alarm().transferred === true, 15000)) && alarm().drivers[0].employeeId === 'e4' && !alarm().drivers[1].employeeId && /^[a-f0-9]{24}$/.test(alarm().drivers[0].code), JSON.stringify(alarm()?.drivers))
  const code = alarm().drivers[0].code
  check('Alarm-Datei am Webspace: „fahrer“ mit Code und Name, alle Objekte mit Winterdienst mit Adresse', state.file?.fahrer?.length === 2 && state.file.fahrer[0].code === code && state.file.fahrer[0].name === 'Dragan Jović' && state.file.winterObjekte.length >= 2 && state.file.winterObjekte.every((o) => o.id && o.name) && state.file.winterObjekte.some((o) => o.id === 'o5') && state.key === alarm().key, JSON.stringify(state.file?.winterObjekte)?.slice(0, 300))
  await O.waitFor(async () => /Protokoll-Link am Handy: Dragan Jović, Aushilfe Winter/.test(await O.text('main')), 10000)
  check('Übersicht nennt, wer einen Protokoll-Link hat', /Protokoll-Link am Handy: Dragan Jović, Aushilfe Winter/.test(await O.text('main')) && /Protokoll-Links für Fahrer \(2\)/.test(await O.text('main')))

  // ------------------------------------------------ 2. Einträge vom Handy holen
  const ts = Math.floor(Date.now() / 1000) - 3600
  state.entries = [
    { id: 'a483a473e4a2', datum: today, erledigt: ts, ort: 'Salzburg', objektId: 'o5', objekt: 'Wohnanlage Lehen', adresse: 'Lehener Straße 1', person: 'Dragan Jović', geraeumt: true, gestreut: true, kontrolle: false, mittel: 'Splitt', notiz: 'Eisplatte beim Eingang', fotos: ['a483a473e4a2-1.jpg'], eingetragen: ts, alarm: '', test: false, quelle: 'fahrer' },
    { id: 'b95e7e54bae7', datum: today, erledigt: ts + 600, ort: '', objektId: '', objekt: 'Musterstraße 5, 5020 Salzburg', adresse: 'Musterstraße 5, 5020 Salzburg', person: 'Dragan Jović', geraeumt: false, gestreut: false, kontrolle: true, mittel: '', notiz: '', fotos: [], eingetragen: ts, alarm: '', test: false, quelle: 'fahrer' },
  ]
  await O.page.click('main [data-action="winterlog-sync"]')
  await O.toastWait(/2 Protokolle vom Handy übernommen, Fotos in SharePoint/, 20000)
  const log = () => O.state(async () => Object.values((await import('/src/ui/context.js')).app.data.winterlog || {}))
  let entries = await log()
  const e1 = entries.find((e) => e.serverId === 'a483a473e4a2')
  const e2 = entries.find((e) => e.serverId === 'b95e7e54bae7')
  const fotoPfad = `exporte/Winterdienst/${month}/${today}_Wohnanlage-Lehen_a483a473e4a2-1.jpg`
  check('Übernommen: Eintrag mit Objekt (Quelle Fahrer-Link), Foto in SharePoint mit Verweis', !!e1 && e1.objectId === 'o5' && e1.quelle === 'Handy (Fahrer-Link)' && e1.fotos[0].pfad === fotoPfad && !!SP.drive.items.get(`Plattform/${fotoPfad}`), JSON.stringify(e1?.fotos))
  check('Übernommen: Eintrag mit freier Adresse, ohne Objekt', !!e2 && e2.objectId === '' && e2.object === 'Musterstraße 5, 5020 Salzburg' && e2.kontrolle === true, JSON.stringify(e2))
  let t = await O.text('main .wx-log')
  check('Übersicht: Zeile für das Objekt mit Foto und eigene Zeile „(andere Adresse)“', /Dragan Jović: geräumt, gestreut \(Splitt\)/.test(t) && /1 Foto/.test(t) && /Musterstraße 5, 5020 Salzburg \(andere Adresse\)/.test(t) && /kontrolliert, nichts nötig/.test(t), t.slice(0, 700))
  await O.waitFor(async () => !!state.removed, 15000)
  check('Foto am Webspace nach der Ablage in SharePoint gelöscht', JSON.stringify(state.removed) === JSON.stringify(['a483a473e4a2-1.jpg']), JSON.stringify(state.removed))
  await O.page.screenshot({ path: `${P}/winter-fahrer-uebersicht.png`, fullPage: true })

  // ------------------------------------------------ 3. In der App eintragen, mit Foto
  await O.page.click('main .toolbar [data-action="winterlog-add"]')
  await O.page.waitForSelector('#wl-fotos')
  await O.page.selectOption('#wl-obj', 'o2')
  await O.page.fill('#wl-notiz', 'Zufahrt nachgestreut')
  await O.page.setInputFiles('#wl-fotos', [{ name: 'IMG_1.jpg', mimeType: 'image/jpeg', buffer: state.jpeg }])
  await O.page.click('.modal [data-action="winterlog-save"]')
  await O.toastWait(/Protokoll gespeichert: .* Uhr, 1 Foto\./, 20000)
  entries = await log()
  const e3 = entries.find((e) => e.objectId === 'o2' && e.quelle === 'App')
  const up = e3 ? SP.drive.items.get(`Plattform/${e3.fotos[0]?.pfad}`) : null
  check('App-Eintrag mit Foto: Datei in SharePoint unter exporte/Winterdienst/<Monat>/, verkleinert (längste Seite 1600 px)', !!e3 && /^exporte\/Winterdienst\/\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}_Autohaus-Maxglan_[a-f0-9]{12}-1\.jpg$/.test(e3.fotos[0].pfad) && !!up && up.type === 'image/jpeg' && up.content.length < state.jpeg.length && e3.by === 'Petra Leitner' && e3.notiz === 'Zufahrt nachgestreut', JSON.stringify(e3?.fotos))
  // andere Adresse: zuerst ohne Adresse, dann mit
  await O.page.click('main .toolbar [data-action="winterlog-add"]')
  await O.page.waitForSelector('#wl-obj')
  await O.page.fill('#wl-notiz', 'bleibt stehen')
  await O.page.selectOption('#wl-obj', '-')
  await O.page.waitForSelector('#wl-address')
  check('„Andere Adresse“: Adressfeld erscheint, die Notiz bleibt stehen', (await O.page.inputValue('#wl-notiz')) === 'bleibt stehen')
  await O.page.click('.modal [data-action="winterlog-save"]')
  await O.toastWait(/Bitte die Adresse eintragen/, 8000)
  await O.page.fill('#wl-address', 'Beispielgasse 9, 5020 Salzburg')
  await O.page.setInputFiles('#wl-fotos', [{ name: 'IMG_2.jpg', mimeType: 'image/jpeg', buffer: state.jpeg }])
  await O.page.click('.modal [data-action="winterlog-save"]')
  await O.toastWait(/Protokoll gespeichert: Beispielgasse 9, 5020 Salzburg .* 1 Foto\./, 20000)
  entries = await log()
  const e4 = entries.find((e) => e.object === 'Beispielgasse 9, 5020 Salzburg')
  check('App-Eintrag mit freier Adresse und Foto', !!e4 && e4.objectId === '' && e4.address === 'Beispielgasse 9, 5020 Salzburg' && /_Beispielgasse-9-5020-Salzburg_[a-f0-9]{12}-1\.jpg$/.test(e4.fotos[0].pfad) && !!SP.drive.items.get(`Plattform/${e4.fotos[0].pfad}`), JSON.stringify(e4?.fotos))
  t = await O.text('main .wx-log')
  check('Übersicht zeigt alle vier Einträge', /Beispielgasse 9, 5020 Salzburg \(andere Adresse\)/.test(t) && /Zufahrt nachgestreut/.test(t) && /Musterstraße 5/.test(t), t.slice(0, 900))
  // Fotos ansehen (aus SharePoint)
  await O.page.locator('main .wx-log [data-action="winterlog-fotos"]').first().click()
  await O.page.waitForSelector('.modal .wl-photos img')
  const shown = await O.waitFor(async () => O.state(() => [...document.querySelectorAll('.modal .wl-photos img')].every((i) => i.naturalWidth > 0)), 15000)
  check('Fotos im Büro ansehbar (aus SharePoint geladen)', !!shown)
  await O.closeModals()
  check('keine Fehler im Browser', !errors.length, errors.slice(0, 5).join(' | '))
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
await finish(browser, [server], errors)
