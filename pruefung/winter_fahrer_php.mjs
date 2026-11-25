// Winterdienst-Protokoll am Handy über den dauerhaften Fahrer-Link (wetter-alarm.php?aktion=protokoll&f=<Code>),
// geprüft gegen den eingebauten PHP-Server mit einem eigenen Ordner privat/ (WETTER_ALARM_ORDNER): ungültiger Code,
// Formular mit allen Objekten mit Winterdienst (nach Ort gegliedert), „andere Adresse“, Foto; Eintrag mit Objekt und
// Foto, Eintrag mit freier Adresse, Fehlermeldungen; die App liest die Einträge mit ihrem Schlüssel und holt das Foto.
// Ohne Code und ohne Alarm bleibt der Link ungültig. Port 19811.
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, check, finish, wait, R, P } from './ablauf-lib.mjs'

const PORT = 19811
const dir = join(P, 'winter-php')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const KEY = 'k'.repeat(40)
const CODE = 'a1b2c3d4e5f6a1b2c3d4e5f6'
const CODE_EN = 'ffeeddccbbaa998877665544'
writeFileSync(
  join(dir, 'wetter-alarm.json'),
  JSON.stringify({
    version: 1,
    schluessel: KEY,
    pruefschluessel: 'p'.repeat(20),
    adresse: `http://127.0.0.1:${PORT}/`,
    orte: [],
    fahrer: [{ code: CODE, name: 'Dragan Jović' }, { code: CODE_EN, name: 'Ana Popescu', sprache: 'en' }, { code: 'zu-kurz', name: 'Niemand' }],
    winterObjekte: [
      { id: 'o5', name: 'Wohnanlage Lehen', adresse: 'Lehener Straße 1, 5020 Salzburg', ort: 'Salzburg' },
      { id: 'o2', name: 'Autohaus Maxglan', adresse: 'Autoweg 7, 5020 Salzburg', ort: 'Salzburg' },
      { id: 'o9', name: 'Werkstatt Hallein', adresse: 'Salzachtalstraße 3, 5400 Hallein', ort: 'Hallein' },
    ],
  }),
)
const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', R], { env: { ...process.env, WETTER_ALARM_ORDNER: dir }, stdio: 'ignore' })
await wait(1200)
const browser = await chromium.launch()
const errors = []
try {
  // ein echtes kleines JPEG aus dem Browser
  const page = await browser.newPage()
  const jpeg = Buffer.from(await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d'); x.fillStyle = '#39c'; x.fillRect(0, 0, 64, 48); const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8)); return [...new Uint8Array(await b.arrayBuffer())] }))
  await page.close()
  const base = `http://127.0.0.1:${PORT}/wetter-alarm.php`
  const get = async (q, headers = {}) => { const r = await fetch(`${base}?${q}`, { headers }); return { status: r.status, type: r.headers.get('content-type') || '', text: r.headers.get('content-type')?.includes('image') ? '' : await r.text(), size: Number(r.headers.get('content-length') || 0) } }
  const post = async (code, fields, photo = null) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(fields)) f.append(k, v)
    if (photo) f.append('fotos[]', new Blob([photo], { type: 'image/jpeg' }), 'IMG_0001.jpg')
    const r = await fetch(`${base}?aktion=protokoll&f=${code}`, { method: 'POST', body: f })
    return { status: r.status, text: await r.text() }
  }
  const entries = async () => JSON.parse((await get('aktion=protokolle', { 'X-Schluessel': KEY })).text).eintraege

  let r = await get('aktion=protokoll&f=000000000000000000000000')
  check('Unbekannter Code: 404 mit „gilt nicht (mehr)“', r.status === 404 && /Dieser Link gilt nicht \(mehr\)/.test(r.text), `${r.status}`)
  r = await get('aktion=protokoll&f=zu-kurz')
  check('Zu kurzer Code: ungültig', r.status === 404)
  r = await get('aktion=protokoll')
  check('Ohne Code und ohne Alarm: Link abgelaufen', r.status === 404 && /36 Stunden nach dem Alarm/.test(r.text))

  r = await get(`aktion=protokoll&f=${CODE}`)
  check('Formular: Name des Fahrers, Objekte nach Ort gegliedert mit Adresse, „andere Adresse“, Adressfeld, Foto vom Handy', r.status === 200 && /Dragan Jović/.test(r.text) && /<optgroup label="Salzburg">/.test(r.text) && /<optgroup label="Hallein">/.test(r.text) && /<option value="o5">Wohnanlage Lehen, Lehener Straße 1, 5020 Salzburg<\/option>/.test(r.text) && /<option value="andere">– andere Adresse/.test(r.text) && /name="adresse"/.test(r.text) && /name="fotos\[\]" accept="image\/\*" capture="environment" multiple/.test(r.text) && /wetter-foto\.js/.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 300))
  check('Formular ohne Preise und ohne fremde Namen', !/€|Ana Popescu/.test(r.text))

  // Eintrag mit Objekt und Foto
  r = await post(CODE, { objekt: 'o5', erledigt: '06:45', geraeumt: '1', gestreut: '1', mittel: 'Splitt', notiz: 'Eisplatte beim Eingang' }, jpeg)
  check('Gespeichert mit Foto: Bestätigung am Handy', r.status === 200 && /Gespeichert: Wohnanlage Lehen um 06:45 Uhr, 1 Foto\. Danke!/.test(r.text) && /Heute von dir eingetragen/.test(r.text), r.text.replace(/\s+/g, ' ').match(/class="(ok|fehler)">[^<]*/)?.[0])
  let list = await entries()
  const e1 = list.find((x) => x.objektId === 'o5')
  check('Eintrag am Webspace: Person, Objekt, Adresse, Ort, geräumt und gestreut mit Splitt, Notiz, ein Foto, Quelle Fahrer-Link', !!e1 && e1.person === 'Dragan Jović' && e1.objekt === 'Wohnanlage Lehen' && e1.adresse === 'Lehener Straße 1, 5020 Salzburg' && e1.ort === 'Salzburg' && e1.geraeumt === true && e1.gestreut === true && e1.kontrolle === false && e1.mittel === 'Splitt' && e1.notiz === 'Eisplatte beim Eingang' && e1.fotos.length === 1 && /^[a-f0-9]{12}-1\.jpg$/.test(e1.fotos[0]) && e1.quelle === 'fahrer' && e1.test === false && e1.alarm === '', JSON.stringify(e1))
  const foto = await get(`aktion=foto&datei=${e1.fotos[0]}`, { 'X-Schluessel': KEY })
  check('Foto für die App abrufbar (mit Schlüssel), ohne Schlüssel nicht', foto.status === 200 && /image\/jpeg/.test(foto.type) && foto.size > 300 && (await get(`aktion=foto&datei=${e1.fotos[0]}`)).status >= 400, `${foto.status} ${foto.type} ${foto.size}`)
  check('Protokolle ohne Schlüssel nicht lesbar', (await get('aktion=protokolle')).status >= 400)

  // freie Adresse
  r = await post(CODE, { objekt: 'andere', adresse: '  Musterstraße 5,   5020 Salzburg ', erledigt: '07:10', kontrolle: '1' })
  check('Freie Adresse gespeichert', r.status === 200 && /Gespeichert: Musterstraße 5, 5020 Salzburg um 07:10 Uhr\. Danke!/.test(r.text), r.text.replace(/\s+/g, ' ').match(/class="(ok|fehler)">[^<]*/)?.[0])
  list = await entries()
  const e2 = list.find((x) => x.objektId === '')
  check('Eintrag mit freier Adresse: ohne Objekt-Kennung, Adresse als Objekt, nur kontrolliert', !!e2 && e2.objekt === 'Musterstraße 5, 5020 Salzburg' && e2.adresse === 'Musterstraße 5, 5020 Salzburg' && e2.kontrolle === true && e2.geraeumt === false && e2.fotos.length === 0 && e2.person === 'Dragan Jović', JSON.stringify(e2))

  // Fehlermeldungen: nichts wird gespeichert
  r = await post(CODE, { objekt: 'andere', adresse: 'x', erledigt: '07:20', geraeumt: '1' })
  check('„Andere Adresse“ ohne Adresse: Hinweis, Eingabe bleibt stehen', /Bitte die Adresse eintragen/.test(r.text) && /name="adresse"[^>]*value="x"/.test(r.text))
  r = await post(CODE, { objekt: 'o2', erledigt: '07:20' })
  check('Nichts angekreuzt: Hinweis', /Bitte ankreuzen: geräumt, gestreut oder nur kontrolliert/.test(r.text))
  r = await post(CODE, { objekt: 'gibt-es-nicht', erledigt: '07:20', geraeumt: '1' })
  check('Unbekanntes Objekt: Hinweis', /Bitte das Objekt wählen/.test(r.text))
  check('Nach den Fehlversuchen weiter nur zwei Einträge', (await entries()).length === 2, String((await entries()).length))

  // zweite Person: eigene Liste „heute von dir“, andere Sprache
  r = await get(`aktion=protokoll&f=${CODE_EN}`)
  check('Zweiter Fahrer (Sprache Englisch): eigene Seite, sieht die Einträge des ersten nicht', r.status === 200 && /Ana Popescu/.test(r.text) && /<html lang="en"/.test(r.text) && /other address/.test(r.text) && !/Dragan Jović/.test(r.text) && !/Entered by you today/.test(r.text), r.text.replace(/\s+/g, ' ').slice(0, 200))
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
php.kill()
await finish(browser, [], errors)
