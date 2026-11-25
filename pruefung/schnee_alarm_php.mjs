// Schnee-Alarm von Anfang bis Ende mit allen Sendungen, gegen echtes PHP (wetter-alarm.php): eine Winternacht mit
// nachgestelltem Wetter (GeoSphere), mitgelesenem Push (ntfy), mitgelesener E-Mail (sendmail_path) und mitgelesenem
// WhatsApp (Schnittstelle von Meta, WHATSAPP_API). Der Cronjob läuft wie am Webspace als „php wetter-alarm.php“, je
// Schritt mit eigener Uhrzeit (WETTER_JETZT); die Aufrufe der App und „Bin wach“ gehen an den eingebauten Server.
//  1. Einrichten und Schlüssel; WhatsApp-Zugang speichern (Token kommt nie zurück), Probe, Grenzen.
//  2. Ruhige Nacht: nichts wird gesendet.
//  3. Schneefall in zwei Stunden: Stufe 1 bekommt Push (Knöpfe in ihrer Sprache), E-Mail und WhatsApp; wer abwesend
//     ist, nichts; keine doppelten Sendungen.
//  4. Niemand bestätigt: nach 15 Minuten Stufe 2 (Büro) auf allen drei Wegen. „Bin wach“ über den Knopf.
//  5. Warnstufe steigt (orange): neuer Alarm trotz Pause. Wechselnde Bereitschaft, Glätte, bestätigt = keine Stufe 2.
//  6. Ruhezeit: erst am Ende wecken, orange sofort. Ausfall der Wetterdaten: Stufe 2 einmal informiert.
//  7. Testalarm aus der App; Fehler eines Weges (Push-Dienst antwortet nicht, WhatsApp lehnt ab) stehen im Protokoll,
//     die anderen Wege gehen trotzdem. Grenze je Tag; WhatsApp entfernt = nur noch Push und E-Mail.
//  8. SMS von selbst (SMS-Dienst seven.io nachgestellt): Zugang speichern (Schlüssel kommt nie zurück), Probe, Guthaben;
//     Alarm als kurze SMS mit Link „Bin wach“ (nur SMS-taugliche Zeichen, höchstens zwei SMS lang), Bestätigen über den
//     kurzen Link; Guthaben aufgebraucht, Grenze je Tag, Entfernen.
//  9. SMS über das eigene Android-Handy (App „SMS Gateway for Android“, Server nachgestellt): Zugang mit Benutzername und
//     Passwort (kommt nie zurück), Probe, falsches Passwort, Wechsel des Weges, Alarm als SMS über das Handy.
// 10. „Handy einrichten“: Seite in der Sprache der Person mit Link ntfy://, Probe von der Seite und aus der App (alle Wege,
//     ohne Protokoll-Knopf), Grenze je Stunde, „Bin wach“ zur Probe, Stand „bereit“ je Thema (auch nach einem Alarm).
// Ports 19831 (Wetter), 19832 (ntfy), 19833 (WhatsApp), 19834 (PHP), 19835 (SMS-Dienst), 19841 (SMS-Gateway).
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, finish, wait, R, P } from './ablauf-lib.mjs'
import { onCallIndex } from '../src/core/weather.js'

const WX = 19831
const NTFY = 19832
const WA = 19833
const HTTP = 19834
const SMS = 19835
const GATE = 19841
const GATE_USER = 'H7XQ2B'
const GATE_PASS = 'pw-3x9_kLq2'
const SMS_KEY = 'smsKey0123456789abcdefABCDEF4321'
const SMS_KEY_BAD = 'falscherSchluessel0123456789xyz'
const dir = join(P, 'schnee-alarm')
rmSync(dir, { recursive: true, force: true })
mkdirSync(join(dir, 'post'), { recursive: true })
mkdirSync(join(dir, 'tmp'), { recursive: true })
const mailScript = join(dir, 'sendmail.sh')
writeFileSync(mailScript, `#!/bin/sh\ncat > "${join(dir, 'post')}/$(date +%s%N)-$$.eml"\n`)
chmodSync(mailScript, 0o755)

const KEY = 'k'.repeat(64)
const CRON = 'c'.repeat(32)
const TOKEN = `EAAG${'t0k3n'.repeat(30)}XYZ9`
const TOKEN_BAD = `EAAG${'falsch'.repeat(20)}`
const NUMBER_ID = '123456789012345'
// 10.12.2026, 02:00 Uhr in Wien (Winterzeit)
const T0 = Date.UTC(2026, 11, 10, 1, 0, 0) / 1000
const hour = (h) => T0 + (h - 2) * 3600 // volle Stunde am 10.12. in Wien
const min = (n) => T0 + n * 60

// ---------------------------------------------------------------- Wetter (GeoSphere nachgestellt)
// je Szenario und Ort: { wert(at) → { t, tp, sf }, warn: [...] } oder 'aus'
const ORTE = { '47.8095,13.0550': 'Salzburg', '47.6833,13.0970': 'Hallein', '47.9333,13.0833': 'Obertrum', '47.9000,13.1333': 'Seekirchen', '47.7500,13.0667': 'Anif' }
const still = () => ({ t: 3, tp: 0, sf: 0 })
const snowAt = (hours, cm = 1.2) => (at) => (hours.map(hour).includes(at) ? { t: -1, tp: cm, sf: cm } : still())
const orange = { warntypid: 3, warnstufeid: 2, rawinfo: { start: hour(4), end: hour(12) }, text: 'Neuschnee 10 bis 20 cm' }
const SZENEN = {
  ruhig: {},
  schnee: { Salzburg: { wert: snowAt([5, 6, 7, 8]) } },
  orange: { Salzburg: { wert: snowAt([5, 6, 7, 8]), warn: [orange] } },
  nachbarn: { Salzburg: { wert: snowAt([5, 6, 7, 8]), warn: [orange] }, Hallein: { wert: snowAt([4, 5]) }, Obertrum: { wert: (at) => (at === hour(5) ? { t: -1, tp: 0.4, sf: 0 } : still()) } },
  ruhe: { Salzburg: { wert: snowAt([5, 6, 7, 8]), warn: [orange] }, Seekirchen: { wert: snowAt([6, 7]) }, Anif: { warn: [{ ...orange, warntypid: 4, rawinfo: { start: hour(3), end: hour(9) } }] } },
  aus: { Salzburg: 'aus', Seekirchen: { wert: snowAt([6, 7]) } },
  mittag: { Obertrum: { wert: (at) => (at === hour(13) ? { t: -1, tp: 0.4, sf: 0 } : still()) } },
}
const wetterAnfragen = []
const wetter = createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  const [, szene, art] = u.pathname.split('/')
  const ort = art === 'forecast' ? ORTE[u.searchParams.get('lat_lon')] : ORTE[`${u.searchParams.get('lat')},${u.searchParams.get('lon')}`]
  wetterAnfragen.push(`${szene}/${art}/${ort}`)
  const s = SZENEN[szene]?.[ort] || {}
  const json = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
  if (!SZENEN[szene] || !ort) return json(404, { fehler: 'unbekannt' })
  if (s === 'aus') return json(503, { detail: 'Wartung' })
  if (art === 'warnings') return json(200, { properties: { warnings: (s.warn || []).map((w) => ({ properties: w })) } })
  const stunden = Array.from({ length: 34 }, (_, i) => T0 - 2 * 3600 + i * 3600)
  const werte = stunden.map((at) => (s.wert || still)(at))
  json(200, {
    timestamps: stunden.map((at) => new Date(at * 1000).toISOString().replace('.000Z', '+00:00')),
    features: [{ properties: { parameters: { '2t': { unit: 'degree_Celsius', data: werte.map((w) => w.t) }, tp: { unit: 'kg m-2', data: werte.map((w) => w.tp) }, sf: { unit: 'kg m-2', data: werte.map((w) => w.sf) }, '10fg': { unit: 'm s-1', data: werte.map(() => 2) } } } }],
  })
}).listen(WX, '127.0.0.1')

// ---------------------------------------------------------------- Push (ntfy) und WhatsApp (Meta) mitlesen
const pushes = []
const ntfyAus = new Set() // Themen, bei denen der Push-Dienst mit einem Fehler antwortet
const body = (req) => new Promise((ok) => { let t = ''; req.on('data', (c) => (t += c)); req.on('end', () => ok(t)) })
const ntfy = createServer(async (req, res) => {
  const m = JSON.parse((await body(req)) || '{}')
  if (ntfyAus.has(m.topic)) return res.writeHead(500).end('{}')
  pushes.push(m)
  res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
}).listen(NTFY, '127.0.0.1')
const whatsapps = []
const waAbgelehnt = new Set() // Nummern, die WhatsApp nicht zustellt
const meta = createServer(async (req, res) => {
  const m = JSON.parse((await body(req)) || '{}')
  const json = (status, b) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(b))
  const auth = req.headers.authorization || ''
  if (auth !== `Bearer ${TOKEN}`) return json(401, { error: { message: `Invalid OAuth access token - Cannot parse access token ${auth.slice(7)}`, type: 'OAuthException', code: 190, fbtrace_id: 'x1' } })
  if (waAbgelehnt.has(m.to)) return json(400, { error: { message: '(#131026) Message undeliverable', type: 'OAuthException', code: 131026, error_data: { messaging_product: 'whatsapp', details: 'Message Undeliverable.' }, fbtrace_id: 'x2' } })
  whatsapps.push({ pfad: req.url, ...m })
  json(200, { messaging_product: 'whatsapp', contacts: [{ input: m.to, wa_id: m.to }], messages: [{ id: `wamid.${whatsapps.length}` }] })
}).listen(WA, '127.0.0.1')

// SMS-Dienst (seven.io): Formularfelder to, from, text; Schlüssel im Kopf X-Api-Key; Antwort als JSON mit Guthaben
const smsListe = []
const smsOhneGuthaben = new Set()
const seven = createServer(async (req, res) => {
  const f = Object.fromEntries(new URLSearchParams(await body(req)))
  const json = (b) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(b))
  if (req.url !== '/api/sms' || req.method !== 'POST') return res.writeHead(404).end('')
  if (req.headers['x-api-key'] !== SMS_KEY) return json({ success: '900', total_price: null, balance: null, messages: [] })
  if (smsOhneGuthaben.has(f.to)) return json({ success: '500', total_price: 0, balance: 0.03, messages: [{ id: null, recipient: f.to, success: false, error: '500', error_text: 'Zu wenig Guthaben' }] })
  smsListe.push({ ...f, typ: req.headers['content-type'] })
  json({ success: '100', total_price: 0.15, balance: 12.34, debug: 'false', sms_type: 'direct', messages: [{ id: `77${smsListe.length}`, sender: f.from, recipient: f.to, text: f.text, encoding: 'gsm', parts: 2, price: 0.15, success: true, error: null, error_text: null }] })
}).listen(SMS, '127.0.0.1')

// SMS Gateway for Android (Cloud-Server nachgestellt): POST /3rdparty/v1/message, Basic, JSON { textMessage: { text }, phoneNumbers }
const gateListe = []
const gateFehler = new Set()
const gate = createServer(async (req, res) => {
  const roh = await body(req)
  const json = (status, b) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(b))
  if (req.url !== '/3rdparty/v1/message' || req.method !== 'POST') return json(404, { message: 'not found' })
  if (req.headers.authorization !== `Basic ${Buffer.from(`${GATE_USER}:${GATE_PASS}`).toString('base64')}`) return json(401, { message: 'Unauthorized' })
  const m = JSON.parse(roh || '{}')
  if (gateFehler.has(m.phoneNumbers?.[0])) return json(202, { id: 'g-x', state: 'Failed', recipients: [{ phoneNumber: m.phoneNumbers[0], state: 'Failed' }] })
  gateListe.push({ ...m, typ: req.headers['content-type'] })
  json(202, { id: `g-${gateListe.length}`, state: 'Pending', recipients: [{ phoneNumber: m.phoneNumbers?.[0], state: 'Pending' }] })
}).listen(GATE, '127.0.0.1')

const env = (jetzt, szene) => ({
  ...process.env,
  WETTER_ALARM_ORDNER: dir,
  WETTER_JETZT: String(jetzt),
  WETTER_VORHERSAGE: `http://127.0.0.1:${WX}/${szene}/forecast`,
  WETTER_WARNUNGEN: `http://127.0.0.1:${WX}/${szene}/warnings`,
  WHATSAPP_API: `http://127.0.0.1:${WA}`,
  SMS_API: `http://127.0.0.1:${SMS}`,
  SMS_GATE_API: `http://127.0.0.1:${GATE}/3rdparty/v1`,
  TMPDIR: join(dir, 'tmp'),
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
})
const php = spawn('php', ['-d', `sendmail_path=${mailScript}`, '-S', `127.0.0.1:${HTTP}`, '-t', R], { env: env(min(5), 'ruhig'), stdio: 'ignore' })
await wait(1200)

/**
 * Cronjob am Webspace: php wetter-alarm.php zur Uhrzeit jetzt mit dem Wetter der Szene; liefert den Bericht. Nicht
 * blockierend, damit die nachgestellten Dienste in diesem Prozess währenddessen antworten können.
 */
function cron(jetzt, szene) {
  return new Promise((ok) => {
    execFile('php', ['-d', `sendmail_path=${mailScript}`, 'wetter-alarm.php'], { cwd: R, env: env(jetzt, szene), encoding: 'utf8' }, (err, stdout) => {
      try {
        ok(JSON.parse(stdout))
      } catch {
        ok({ abbruch: String(stdout || err?.message).slice(0, 300) })
      }
    })
  })
}
const api = async (aktion, { method = 'GET', json, key = KEY, extra = '' } = {}) => {
  const r = await fetch(`http://127.0.0.1:${HTTP}/wetter-alarm.php?aktion=${aktion}${extra}`, { method, headers: { ...(key ? { 'X-Schluessel': key } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) }, body: json ? JSON.stringify(json) : undefined, redirect: 'manual' })
  const text = await r.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {}
  return { status: r.status, json: data, text, location: r.headers.get('location') || '' }
}
/** E-Mails seit dem letzten Aufruf: { an, betreff, text, von }. */
const gelesen = new Set()
function mails() {
  const out = []
  for (const f of readdirSync(join(dir, 'post')).sort()) {
    if (gelesen.has(f)) continue
    gelesen.add(f)
    const roh = readFileSync(join(dir, 'post', f), 'utf8')
    const [kopf, ...rest] = roh.split(/\r?\n\r?\n/)
    const feld = (n) => kopf.match(new RegExp(`^${n}: (.*)$`, 'mi'))?.[1] || ''
    const klar = (s) => s.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'))
    out.push({ an: feld('To'), betreff: klar(feld('Subject')), von: klar(feld('From')), text: rest.join('\n\n') })
  }
  return out
}
/** Was seit dem letzten Aufruf gesendet wurde. */
let pN = 0
let wN = 0
let sN = 0
const neu = async () => {
  await wait(150)
  const out = { push: pushes.slice(pN), wa: whatsapps.slice(wN), sms: smsListe.slice(sN), mail: mails() }
  pN = pushes.length
  wN = whatsapps.length
  sN = smsListe.length
  return out
}
const waText = (m) => m.template.components.find((c) => c.type === 'body').parameters.map((p) => p.text)
const waKnopf = (m) => m.template.components.find((c) => c.type === 'button')
const tokenOf = (push) => push.actions.find((a) => a.action === 'http')?.url.match(/t=([a-f0-9]{24})$/)?.[1] || ''
const flat = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()

const person = { dragan: { name: 'Dragan Jović', ntfy: 'wd-dragan', email: 'dragan@cleanos.example', whatsapp: '436641111111', sprache: 'bks' }, ana: { name: 'Ana Popescu', ntfy: 'wd-ana', whatsapp: '436642222222', abwesend: [['2026-12-08', '2026-12-12']] }, mehmet: { name: 'Mehmet Yılmaz', whatsapp: '436643333333' } }
const buero = [{ name: 'Büro', ntfy: 'wd-buero' }, { name: 'Büro', email: 'office@cleanos.example' }, { name: 'Büro', whatsapp: '436649999999' }]
const einstellungen = (regeln = {}) => ({
  version: 1,
  schluessel: KEY,
  pruefschluessel: CRON,
  adresse: `http://127.0.0.1:${HTTP}/`,
  ntfy: `http://127.0.0.1:${NTFY}`,
  absender: 'winterdienst@cleanos.example',
  regeln: { vorlaufStunden: 3, schneeCm: 0.3, pauseStunden: 8, eskalationMinuten: 15, ruheVon: '', ruheBis: '', ruheAusnahmeStufe: 2, ...regeln },
  orte: [
    { name: 'Salzburg', lat: 47.8095, lon: 13.055, objekte: [{ id: 'o5', name: 'Wohnanlage Lehen', adresse: 'Lehener Straße 1' }, { id: 'o2', name: 'Autohaus Maxglan', adresse: 'Autoweg 7' }], stufe1: [person.dragan, person.ana, person.mehmet], stufe2: buero },
    { name: 'Hallein', lat: 47.6833, lon: 13.097, objekte: [{ id: 'o9', name: 'Werkstatt Hallein', adresse: '' }], wechsel: 'woche', stufe1: [{ name: 'Erste Woche', ntfy: 'wd-h1' }, { name: 'Zweite Woche', ntfy: 'wd-h2' }], stufe2: [{ name: 'Büro', ntfy: 'wd-buero' }] },
    { name: 'Obertrum', lat: 47.9333, lon: 13.0833, objekte: [], stufe1: [{ name: 'Jelena Marković', ntfy: 'wd-jelena' }], stufe2: [] },
    { name: 'Seekirchen', lat: 47.9, lon: 13.1333, objekte: [], stufe1: [{ name: 'Petra Leitner', ntfy: 'wd-petra' }], stufe2: [] },
    { name: 'Anif', lat: 47.75, lon: 13.0667, objekte: [], stufe1: [{ name: 'Karl Anif', ntfy: 'wd-anif' }], stufe2: [] },
  ],
})

try {
  // ---------------------------------------------------------------- 1. Einrichten, Schlüssel, WhatsApp-Zugang
  let r = await api('status')
  check('Ohne Alarm-Datei: „noch nicht eingerichtet“ (503), der Cronjob sagt dasselbe', r.status === 503 && /noch nicht eingerichtet/.test(r.json?.fehler || '') && /noch nicht eingerichtet/.test(JSON.stringify(await cron(T0, 'ruhig'))), `${r.status}`)
  writeFileSync(join(dir, 'wetter-alarm.json'), JSON.stringify(einstellungen())) // einmalig per FTP nach privat/
  check('Schlüssel: ohne oder mit falschem Schlüssel kein Zugriff; der Prüfschlüssel darf nur prüfen', (await api('status', { key: '' })).status === 403 && (await api('status', { key: 'x'.repeat(64) })).status === 403 && (await api('status', { key: '', extra: `&schluessel=${CRON}` })).status === 403 && (await api('test', { method: 'POST', key: '', extra: `&schluessel=${CRON}` })).status === 403 && (await api('whatsapp', { key: '', extra: `&schluessel=${CRON}` })).status === 403)
  r = await api('status')
  check('Stand vor der ersten Prüfung: fünf Orte, noch keine Prüfung, WhatsApp nicht eingerichtet', r.status === 200 && r.json.orte.length === 5 && r.json.letztePruefung === null && r.json.whatsapp === false, JSON.stringify(r.json).slice(0, 160))

  r = await api('whatsapp')
  check('WhatsApp: Stand „nicht eingerichtet“ mit den Vorgaben (Vorlage, Sprache, Version)', r.status === 200 && r.json.eingerichtet === false && r.json.vorlage === 'winterdienst_alarm' && r.json.sprache === 'de' && /^v\d+\.\d$/.test(r.json.version), JSON.stringify(r.json))
  check('WhatsApp-Probe ohne Zugang: verständliche Absage', (r = await api('whatsapp-test', { method: 'POST', json: { an: '436641234567' } })).status === 409 && /noch nicht eingerichtet/.test(r.json.fehler))
  check('WhatsApp speichern: Token mit Leerzeichen, Telefonnummer statt ID, falscher Vorlagenname werden abgelehnt', (await api('whatsapp', { method: 'POST', json: { token: 'kurz und falsch', nummerId: NUMBER_ID } })).status === 400 && (await api('whatsapp', { method: 'POST', json: { token: TOKEN, nummerId: '+43 664 1234567' } })).status === 400 && (await api('whatsapp', { method: 'POST', json: { token: TOKEN, nummerId: NUMBER_ID, vorlage: 'Winterdienst Alarm!' } })).status === 400 && (await api('whatsapp', { method: 'POST', json: { nummerId: NUMBER_ID } })).status === 400 && !existsSync(join(dir, 'whatsapp.json')))
  r = await api('whatsapp', { method: 'POST', json: { token: TOKEN_BAD, nummerId: NUMBER_ID, vorlage: 'winterdienst_alarm', sprache: 'de', version: 'v25.0' } })
  check('WhatsApp gespeichert: Stand ohne Token (nur die letzten vier Zeichen)', r.status === 200 && r.json.eingerichtet === true && r.json.nummerId === NUMBER_ID && r.json.tokenEnde === TOKEN_BAD.slice(-4) && !r.text.includes(TOKEN_BAD) && !('token' in r.json), r.text.slice(0, 200))
  check('Zugang liegt nur am Webspace (privat/whatsapp.json, nur für den Besitzer lesbar)', JSON.parse(readFileSync(join(dir, 'whatsapp.json'), 'utf8')).token === TOKEN_BAD && (statSync(join(dir, 'whatsapp.json')).mode & 0o077) === 0)
  r = await api('whatsapp-test', { method: 'POST', json: { an: '436641234567' } })
  check('Probe mit einem Token, das Meta nicht annimmt: Fehler von Meta, ohne das Token im Text', r.status === 502 && /Antwort 401 \(Code 190\): Invalid OAuth access token/.test(r.json.fehler) && !r.json.fehler.includes(TOKEN_BAD), JSON.stringify(r.json))
  r = await api('whatsapp', { method: 'POST', json: { token: TOKEN } })
  check('Nur das Token tauschen: die anderen Angaben bleiben', r.status === 200 && r.json.tokenEnde === 'XYZ9' && r.json.nummerId === NUMBER_ID && r.json.vorlage === 'winterdienst_alarm')
  r = await api('whatsapp-test', { method: 'POST', json: { an: '0664 1234567' } })
  check('Probe an eine Nummer ohne Ländervorwahl: abgelehnt, bevor etwas an Meta geht', r.status === 502 && /Nummer ungültig/.test(r.json.fehler) && whatsapps.length === 0, JSON.stringify(r.json))
  r = await api('whatsapp-test', { method: 'POST', json: { an: '+43 664 1234567' } })
  let n = await neu()
  check('Probe: Nachricht aus der Vorlage an Meta (Adresse mit Version und Telefonnummer-ID, Token im Kopf, Knopf „info“)', r.status === 200 && r.json.gesendet === true && n.wa.length === 1 && n.wa[0].pfad === `/v25.0/${NUMBER_ID}/messages` && n.wa[0].messaging_product === 'whatsapp' && n.wa[0].to === '436641234567' && n.wa[0].type === 'template' && n.wa[0].template.name === 'winterdienst_alarm' && n.wa[0].template.language.code === 'de' && waText(n.wa[0])[0] === 'Probe' && waKnopf(n.wa[0]).sub_type === 'url' && waKnopf(n.wa[0]).index === '0' && waKnopf(n.wa[0]).parameters[0].text === 'info', JSON.stringify(n.wa[0]).slice(0, 300))
  r = await api('wach', { key: '', extra: '&t=info' })
  check('Knopf einer Nachricht ohne Bestätigung führt zur App', r.status === 302 && r.location === `http://127.0.0.1:${HTTP}/#wetter`, `${r.status} ${r.location}`)
  for (let i = 0; i < 8; i++) await api('whatsapp-test', { method: 'POST', json: { an: '436641234567' } })
  r = await api('whatsapp-test', { method: 'POST', json: { an: '436641234567' } })
  check('Höchstens zehn Proben je Stunde', r.status === 429 && /Zu viele Proben/.test(r.json.fehler), `${r.status}`)
  await neu()
  check('Stand des Alarms zeigt jetzt „WhatsApp eingerichtet“', (await api('status')).json.whatsapp === true)

  // ---------------------------------------------------------------- 2. Ruhige Nacht
  let b = await cron(T0, 'ruhig')
  n = await neu()
  check('02:00 Uhr, kein Schnee: alle Orte „ruhig“, nichts gesendet', Object.values(b.orte || {}).length === 5 && Object.values(b.orte).every((o) => o.lage === 'ruhig' && !o.alarm) && !n.push.length && !n.mail.length && !n.wa.length, JSON.stringify(b).slice(0, 200))
  check('Der Cronjob fragt je Ort Vorhersage und Warnungen ab', ['forecast', 'warnings'].every((art) => Object.values(ORTE).every((o) => wetterAnfragen.includes(`ruhig/${art}/${o}`))))

  // ---------------------------------------------------------------- 3. Schneefall in zwei Stunden
  b = await cron(min(10), 'schnee')
  n = await neu()
  const lageText = 'Schneefall ab 04:00 Uhr, ca. 4,8 cm in 12 h'
  const alarmText = `${lageText}. Objekte: Wohnanlage Lehen, Autohaus Maxglan. Bitte mit „Bin wach“ bestätigen.`
  check('02:10 Uhr, Schneefall ab 04:00: Lage erkannt, nur Salzburg alarmiert', b.orte?.Salzburg?.lage === lageText && !!b.orte.Salzburg.alarm && !b.orte.Salzburg.fehler.length && b.orte.Hallein.lage === 'ruhig' && !b.orte.Hallein.alarm, JSON.stringify(b.orte?.Salzburg))
  const pD = n.push.find((p) => p.topic === 'wd-dragan')
  check('Push an Stufe 1: nur wer ein Thema hat und nicht abwesend ist (Ana ist auf Urlaub)', n.push.length === 1 && !!pD, n.push.map((p) => p.topic).join(','))
  check('Push: Titel, Text mit Lage und Objekten, höchste Priorität', pD?.title === 'Winterdienst Salzburg' && pD.message === alarmText && pD.priority === 5 && pD.tags.includes('snowflake') && pD.click === `http://127.0.0.1:${HTTP}/#wetter`, JSON.stringify(pD).slice(0, 300))
  const tD = tokenOf(pD || { actions: [] })
  check('Push: Knöpfe in der Sprache der Person (Bosnisch/Kroatisch/Serbisch), „Bin wach“ bestätigt mit einem eigenen Code', pD?.actions.length === 3 && pD.actions[0].action === 'http' && pD.actions[0].method === 'POST' && pD.actions[0].label !== 'Bin wach' && pD.actions[0].label.length > 2 && tD.length === 24 && pD.actions[1].action === 'view' && pD.actions[1].url.endsWith(`aktion=protokoll&t=${tD}`), JSON.stringify(pD?.actions))
  check('E-Mail an Stufe 1 (wer eine Adresse hat): Betreff, Lage, Links zum Bestätigen und zum Protokoll, Absender', n.mail.length === 1 && n.mail[0].an === 'dragan@cleanos.example' && n.mail[0].betreff === 'Winterdienst Salzburg' && n.mail[0].text.includes(alarmText) && n.mail[0].text.includes(`Bitte bestätigen: http://127.0.0.1:${HTTP}/wetter-alarm.php?aktion=wach&t=${tD}`) && n.mail[0].text.includes('Protokoll eintragen:') && /Winterdienst <winterdienst@cleanos\.example>/.test(n.mail[0].von), JSON.stringify(n.mail[0]).slice(0, 400))
  const waD = n.wa.find((m) => m.to === person.dragan.whatsapp)
  const waM = n.wa.find((m) => m.to === person.mehmet.whatsapp)
  check('WhatsApp an Stufe 1: Dragan und Mehmet, Ana (abwesend) nicht', n.wa.length === 2 && !!waD && !!waM, n.wa.map((m) => m.to).join(','))
  check('WhatsApp: Vorlage mit Überschrift und Text, einzeilig; Knopf mit demselben Code wie im Push', !!waD && waText(waD)[0] === 'Winterdienst Salzburg' && waText(waD)[1] === alarmText && !/[\n\t]| {2}/.test(waText(waD).join('')) && waKnopf(waD).parameters[0].text === tD && waD.pfad === `/v25.0/${NUMBER_ID}/messages`, JSON.stringify(waD).slice(0, 300))
  const tM = waM ? waKnopf(waM).parameters[0].text : ''
  check('Jede Person hat ihren eigenen Code zum Bestätigen', /^[a-f0-9]{24}$/.test(tM) && tM !== tD)

  b = await cron(min(20), 'schnee')
  n = await neu()
  check('02:20 Uhr, gleiche Lage: nichts doppelt gesendet', !n.push.length && !n.mail.length && !n.wa.length && !!b.orte.Salzburg.alarm)

  // ---------------------------------------------------------------- 4. Niemand bestätigt: Stufe 2, dann „Bin wach“
  b = await cron(min(26), 'schnee')
  n = await neu()
  const stufe2Text = `${lageText}. Seit 02:10 Uhr hat niemand aus dem Winterdienst-Team bestätigt. Bitte übernehmen oder das Team anrufen.`
  check('02:26 Uhr, 16 Minuten ohne „Bin wach“: Stufe 2 per Push', n.push.length === 1 && n.push[0].topic === 'wd-buero' && n.push[0].title === 'Winterdienst Salzburg – niemand bestätigt' && n.push[0].message === stufe2Text, JSON.stringify(n.push).slice(0, 300))
  check('Stufe 2 per E-Mail und per WhatsApp', n.mail.length === 1 && n.mail[0].an === 'office@cleanos.example' && n.mail[0].betreff === 'Winterdienst Salzburg – niemand bestätigt' && n.wa.length === 1 && n.wa[0].to === '436649999999' && waText(n.wa[0])[1] === stufe2Text, `${n.mail.length} ${n.wa.length}`)
  r = await api('wach', { key: '', extra: `&t=${tD}` })
  check('„Bin wach“ aus der E-Mail: zuerst eine Seite mit Knopf (Mail-Prüfprogramme bestätigen nichts von selbst), in der Sprache der Person', r.status === 200 && /<html lang="hr">/.test(r.text) && /<form method="post">/.test(r.text) && (await api('status')).json.orte[0].alarm.wach.length === 0)
  r = await api('wach', { method: 'POST', key: '', extra: `&t=${tM}` })
  check('„Bin wach“ über den Knopf (WhatsApp, Push): bestätigt mit Namen und Ort, weiter zum Protokoll', r.status === 200 && /Danke, Mehmet Yılmaz/.test(flat(r.text)) && /Winterdienst Salzburg ist bestätigt/.test(flat(r.text)) && r.text.includes(`aktion=protokoll&amp;t=${tM}`), flat(r.text).slice(0, 200))
  r = await api('status')
  check('Die App sieht: Alarm 02:10, Stufe 2 alarmiert, Mehmet ist wach; Protokoll mit jedem Schritt', r.json.orte[0].alarm.gesendet === min(10) && r.json.orte[0].alarm.eskaliert === min(26) && r.json.orte[0].alarm.wach.length === 1 && r.json.orte[0].alarm.wach[0].name === 'Mehmet Yılmaz' && r.json.protokoll.some((p) => p.text === `Alarm: ${lageText}`) && r.json.protokoll.some((p) => p.text === 'Niemand bestätigt: Stufe 2 alarmiert') && r.json.protokoll.some((p) => p.text === 'Mehmet Yılmaz ist wach (bestätigt)'), JSON.stringify(r.json.protokoll.slice(0, 4)))
  check('Ungültiger oder fremder Code bestätigt nichts', (await api('wach', { method: 'POST', key: '', extra: '&t=abc' })).status === 400 && (await api('wach', { method: 'POST', key: '', extra: `&t=${'0'.repeat(24)}` })).status === 404)
  await cron(min(40), 'schnee')
  n = await neu()
  check('02:40 Uhr: nach der Bestätigung keine weiteren Sendungen', !n.push.length && !n.mail.length && !n.wa.length)

  // ---------------------------------------------------------------- 5. Warnstufe steigt, wechselnde Bereitschaft, Glätte
  b = await cron(min(60), 'orange')
  n = await neu()
  check('03:00 Uhr, Schneewarnung orange: neuer Alarm trotz Pause von acht Stunden, wieder an Stufe 1', /Schneewarnung orange \(GeoSphere\) 10\.12\. 04:00–12:00 Uhr/.test(b.orte.Salzburg.lage) && n.push.length === 1 && n.push[0].topic === 'wd-dragan' && /Schneewarnung orange/.test(n.push[0].message) && n.wa.length === 2 && n.mail.length === 1, `${b.orte.Salzburg.lage} · ${n.push.length}/${n.wa.length}/${n.mail.length}`)
  const tD2 = tokenOf(n.push[0])
  check('Der neue Alarm hat neue Codes; der alte gilt nicht mehr', tD2 !== tD && (await api('wach', { method: 'POST', key: '', extra: `&t=${tD}` })).status === 404)

  b = await cron(min(70), 'nachbarn')
  n = await neu()
  const dran = ['wd-h1', 'wd-h2'][onCallIndex('2026-12-10', 2)]
  const pH = n.push.find((p) => p.topic.startsWith('wd-h'))
  check('03:10 Uhr, Hallein mit wöchentlichem Wechsel: nur wer diese Woche Bereitschaft hat (wie in der App gerechnet)', n.push.filter((p) => p.topic.startsWith('wd-h')).length === 1 && pH.topic === dran && /^Es schneit, ca\. 2,4 cm in 12 h\. Objekte: Werkstatt Hallein\./.test(pH.message), `${pH?.topic} erwartet ${dran}: ${pH?.message}`)
  const pJ = n.push.find((p) => p.topic === 'wd-jelena')
  check('Obertrum: Glätte (Niederschlag bei Frost, kein Schnee) weckt auch', !!pJ && /^Glätte möglich ab 04:00 Uhr \(-1 °C mit Niederschlag\)\. Bitte mit „Bin wach“ bestätigen\.$/.test(pJ.message), pJ?.message)
  check('Salzburg bleibt still (gleiche Warnstufe wie beim letzten Alarm)', !n.push.some((p) => p.topic === 'wd-dragan') && !n.wa.length)
  r = await api('wach', { method: 'POST', key: '', extra: `&t=${tokenOf(pH)}` })
  await cron(min(90), 'nachbarn')
  n = await neu()
  check('03:30 Uhr: Hallein hat bestätigt, also keine Stufe 2 dort; Obertrum ohne Stufe 2 bleibt ohne Folge', r.status === 200 && !n.push.some((p) => /Hallein|Obertrum/.test(p.title)), n.push.map((p) => p.title).join(' | '))
  check('Der zweite Alarm in Salzburg (orange, 03:00) blieb unbestätigt: Stufe 2 wird wieder alarmiert', n.push.length === 1 && n.push[0].title === 'Winterdienst Salzburg – niemand bestätigt' && /Seit 03:00 Uhr hat niemand/.test(n.push[0].message) && n.wa.length === 1 && n.mail.length === 1, `${n.push.length}/${n.wa.length}/${n.mail.length}`)
  n = await neu()

  // ---------------------------------------------------------------- 6. Ruhezeit und Ausfall der Wetterdaten
  r = await api('speichern', { method: 'POST', json: einstellungen({ ruheVon: '22:00', ruheBis: '05:00' }) })
  check('Die App überträgt neue Einstellungen (Ruhezeit 22 bis 5 Uhr)', r.status === 200 && r.json.gespeichert === '5 Orte', JSON.stringify(r.json))
  check('Ungültige Einstellungen nimmt der Webspace nicht an', (await api('speichern', { method: 'POST', json: { schluessel: 'kurz', orte: [] } })).status === 400 && (await api('speichern', { method: 'POST', json: { schluessel: KEY, orte: [{ name: 'Ohne Koordinaten' }] } })).status === 400)
  b = await cron(hour(4), 'ruhe')
  n = await neu()
  const pA = n.push.find((p) => p.topic === 'wd-anif')
  check('04:00 Uhr in der Ruhezeit: Schneefall in Seekirchen wird gemerkt, nicht gesendet', b.orte.Seekirchen.wartend === true && !b.orte.Seekirchen.alarm && !n.push.some((p) => p.topic === 'wd-petra'), JSON.stringify(b.orte.Seekirchen))
  check('Glatteiswarnung orange in Anif weckt trotz Ruhezeit sofort', !!pA && /Glatteiswarnung orange \(GeoSphere\)/.test(pA.message) && !!b.orte.Anif.alarm, pA?.message)
  check('Die App zeigt für Seekirchen „wird am Ende der Ruhezeit geweckt“ (wartend seit 04:00)', (await api('status')).json.orte.find((o) => o.name === 'Seekirchen').wartend === hour(4))
  b = await cron(hour(5), 'ruhe')
  n = await neu()
  const pP = n.push.find((p) => p.topic === 'wd-petra')
  check('05:00 Uhr, Ruhezeit vorbei: Seekirchen wird geweckt, mit dem Hinweis seit wann', !!pP && /^Um 04:00 Uhr gemeldet \(Ruhezeit\): Schneefall ab 05:00 Uhr, ca\. 2,4 cm in 12 h\. Jetzt: Es schneit, ca\. 2,4 cm in 12 h\./.test(pP.message) && n.push.length === 1, pP?.message)

  b = await cron(hour(5) + 600, 'aus')
  n = await neu()
  check('05:10 Uhr, GeoSphere antwortet für Salzburg nicht: Fehler im Bericht, noch keine Nachricht (erst nach zwei Stunden)', /Vorhersage nicht erreichbar \(Antwort 503\)/.test(b.orte.Salzburg.fehler || '') && !n.push.length && !n.wa.length && !n.mail.length, JSON.stringify(b.orte.Salzburg))
  check('Die anderen Orte laufen trotzdem weiter', b.orte.Seekirchen.lage !== undefined && !('abbruch' in b))
  b = await cron(hour(7) + 600, 'aus')
  n = await neu()
  check('07:10 Uhr, seit über zwei Stunden ohne Wetterdaten: Stufe 2 einmal informiert, auf allen drei Wegen', n.push.length === 1 && n.push[0].topic === 'wd-buero' && n.push[0].title === 'Schnee-Alarm Salzburg ohne Wetterdaten' && /Seit 05:00 Uhr kommen keine Wetterdaten von GeoSphere .*Bitte selbst auf das Wetter achten\./.test(n.push[0].message) && n.mail.length === 1 && n.wa.length === 1 && waKnopf(n.wa[0]).parameters[0].text === 'info' && !n.push[0].actions.some((a) => a.action === 'http'), JSON.stringify(n.push[0] || {}).slice(0, 300))
  await cron(hour(7) + 1200, 'aus')
  n = await neu()
  check('07:20 Uhr: kein zweiter Hinweis', !n.push.length && !n.mail.length && !n.wa.length)
  check('Der Ausfall steht in der App beim Ort und im Protokoll', (r = await api('status')).json.orte[0].fehler === 'Vorhersage nicht erreichbar (Antwort 503)' && r.json.protokoll.some((p) => p.text === 'Keine Wetterdaten: Stufe 2 informiert'))

  // ---------------------------------------------------------------- 7. Testalarm, Fehler eines Weges, Grenze, Entfernen
  ntfyAus.add('wd-dragan')
  waAbgelehnt.add(person.mehmet.whatsapp)
  r = await api('test', { method: 'POST', extra: '&ort=Salzburg' })
  n = await neu()
  check('Testalarm aus der App an Salzburg: alle drei aus Stufe 1 (auch wer abwesend ist), Fehler je Weg gemeldet', r.status === 200 && r.json.Salzburg.personen === 3 && r.json.Salzburg.fehler.length === 2 && r.json.Salzburg.fehler.some((f) => f === 'ntfy an Dragan Jović: Antwort 500') && r.json.Salzburg.fehler.some((f) => f === 'WhatsApp an Mehmet Yılmaz: Antwort 400 (Code 131026): Message Undeliverable.'), JSON.stringify(r.json))
  check('Fällt ein Weg aus, gehen die anderen trotzdem: Dragan bekommt WhatsApp und E-Mail, Ana Push und WhatsApp', n.push.length === 1 && n.push[0].topic === 'wd-ana' && n.push[0].title === 'Testalarm Winterdienst Salzburg' && n.wa.map((m) => m.to).sort().join() === [person.dragan.whatsapp, person.ana.whatsapp].sort().join() && n.mail.length === 1 && n.mail[0].an === 'dragan@cleanos.example', `${n.push.map((p) => p.topic)} · ${n.wa.map((m) => m.to)} · ${n.mail.length}`)
  check('Die Fehler stehen im Protokoll der App', (await api('status')).json.protokoll[0].text.startsWith('Testalarm an 3 Personen – ntfy an Dragan Jović: Antwort 500; WhatsApp an Mehmet Yılmaz'))
  check('Testalarm für einen unbekannten Ort: 404', (await api('test', { method: 'POST', extra: '&ort=Nirgendwo' })).status === 404)
  ntfyAus.clear()
  waAbgelehnt.clear()

  writeFileSync(join(dir, 'whatsapp-zaehler.json'), JSON.stringify({ tag: '2026-12-10', anzahl: 150 }))
  r = await api('test', { method: 'POST', extra: '&ort=Salzburg' })
  n = await neu()
  check('Grenze je Tag (150 Nachrichten): WhatsApp hält an, Push und E-Mail gehen weiter', r.json.Salzburg.fehler.length === 3 && r.json.Salzburg.fehler.every((f) => /^WhatsApp an .*: Grenze von 150 Nachrichten am Tag erreicht$/.test(f)) && !n.wa.length && n.push.length === 2 && n.mail.length === 1, JSON.stringify(r.json))
  writeFileSync(join(dir, 'whatsapp-zaehler.json'), JSON.stringify({ tag: '2026-12-09', anzahl: 150 }))
  await api('test', { method: 'POST', extra: '&ort=Salzburg' })
  n = await neu()
  check('Am nächsten Tag zählt die Grenze neu', n.wa.length === 3 && JSON.parse(readFileSync(join(dir, 'whatsapp-zaehler.json'), 'utf8')).anzahl === 3)

  r = await api('whatsapp', { method: 'POST', json: { entfernen: true } })
  check('WhatsApp entfernen: Zugang am Webspace gelöscht', r.status === 200 && r.json.eingerichtet === false && !existsSync(join(dir, 'whatsapp.json')) && (await api('status')).json.whatsapp === false)
  await api('test', { method: 'POST', extra: '&ort=Salzburg' })
  n = await neu()
  check('Ohne WhatsApp-Zugang: Alarm nur per Push und E-Mail, kein Fehler', !n.wa.length && n.push.length === 2 && n.mail.length === 1 && !(await api('status')).json.protokoll[0].text.includes('WhatsApp'))
  check('Am Webspace liegt das Token nirgends mehr', !readdirSync(dir).some((f) => statSync(join(dir, f)).isFile() && readFileSync(join(dir, f), 'utf8').includes(TOKEN)))

  // ---------------------------------------------------------------- 8. SMS von selbst
  r = await api('sms')
  check('SMS: Stand „nicht eingerichtet“, zwei Wege (eigenes Handy als Vorgabe, seven.io)', r.status === 200 && r.json.eingerichtet === false && r.json.anbieter === 'handy' && /^eigenes Android-Handy/.test(r.json.anbieterListe.handy) && /^seven\.io/.test(r.json.anbieterListe.seven) && (await api('status')).json.sms === false, JSON.stringify(r.json))
  check('SMS-Zugang nur mit dem Schlüssel der App (nicht mit dem Prüfschlüssel, nicht ohne)', (await api('sms', { key: '' })).status === 403 && (await api('sms', { key: '', extra: `&schluessel=${CRON}` })).status === 403)
  check('Probe-SMS ohne Zugang: verständliche Absage', (r = await api('sms-test', { method: 'POST', json: { an: '436641234567' } })).status === 409 && /noch nicht eingerichtet/.test(r.json.fehler))
  check('SMS speichern: zu kurzer Schlüssel, unbekannter Dienst, kein Schlüssel werden abgelehnt', (await api('sms', { method: 'POST', json: { schluessel: 'kurz' } })).status === 400 && (await api('sms', { method: 'POST', json: { anbieter: 'irgendwer', schluessel: SMS_KEY } })).status === 400 && (await api('sms', { method: 'POST', json: { absender: 'Cleanos' } })).status === 400 && !existsSync(join(dir, 'sms.json')))
  r = await api('sms', { method: 'POST', json: { anbieter: 'seven', schluessel: SMS_KEY_BAD, absender: 'Cleanos Gebäudereinigung' } })
  check('SMS gespeichert: Stand ohne Schlüssel (nur die letzten vier Zeichen), Absender auf elf Zeichen gekürzt', r.status === 200 && r.json.eingerichtet === true && r.json.anbieterName === 'seven.io (SMS-Dienst)' && r.json.absender === 'CleanosGeba' && r.json.schluesselEnde === SMS_KEY_BAD.slice(-4) && !r.text.includes(SMS_KEY_BAD) && !('schluessel' in r.json), r.text.slice(0, 220))
  check('Zugang liegt nur am Webspace (privat/sms.json, nur für den Besitzer lesbar)', JSON.parse(readFileSync(join(dir, 'sms.json'), 'utf8')).schluessel === SMS_KEY_BAD && (statSync(join(dir, 'sms.json')).mode & 0o077) === 0)
  r = await api('sms-test', { method: 'POST', json: { an: '+43 664 1234567' } })
  check('Probe mit einem Schlüssel, den der Dienst nicht kennt: klarer Grund', r.status === 502 && r.json.fehler === 'Schlüssel falsch (Code 900)', JSON.stringify(r.json))
  r = await api('sms', { method: 'POST', json: { schluessel: SMS_KEY } })
  check('Nur den Schlüssel tauschen: Dienst und Absender bleiben', r.status === 200 && r.json.schluesselEnde === '4321' && r.json.absender === 'CleanosGeba')
  r = await api('sms-test', { method: 'POST', json: { an: '0664 1234567' } })
  check('Probe an eine Nummer ohne Ländervorwahl: abgelehnt, bevor etwas an den Dienst geht', r.status === 502 && /Nummer ungültig/.test(r.json.fehler) && smsListe.length === 0)
  r = await api('sms-test', { method: 'POST', json: { an: '+43 664 1234567' } })
  n = await neu()
  const gsm = /^[A-Za-z0-9 !"#%&'()*+,\-./:;<=>?@_äöüÄÖÜßéèàùìòÉñÑ]+$/
  check('Probe-SMS: Formularfelder an den Dienst (Nummer mit Ländervorwahl, Absender, Text), Schlüssel im Kopf', r.status === 200 && r.json.gesendet === true && n.sms.length === 1 && n.sms[0].to === '436641234567' && n.sms[0].from === 'CleanosGeba' && /^Probe Cleanos App: So kommt der Schnee-Alarm als SMS\./.test(n.sms[0].text) && /x-www-form-urlencoded/.test(n.sms[0].typ) && gsm.test(n.sms[0].text), JSON.stringify(n.sms[0]))
  check('Das Guthaben beim Dienst steht danach im Stand (für die App)', r.json.guthaben === 12.34 && (await api('sms')).json.guthaben === 12.34 && (await api('status')).json.sms === true)

  const mitSms = einstellungen()
  mitSms.orte[0].stufe1 = [{ ...person.dragan, sms: '436641111111' }, { ...person.ana, sms: '436642222222' }, { ...person.mehmet, sms: '436643333333' }]
  mitSms.orte[0].stufe2 = [...buero, { name: 'Büro', sms: '436649999999' }]
  mitSms.orte[2].stufe1 = [{ name: 'Jelena Marković', ntfy: 'wd-jelena', sms: '436645555555' }]
  await api('speichern', { method: 'POST', json: mitSms })
  r = await api('test', { method: 'POST', extra: '&ort=Salzburg' })
  n = await neu()
  const smsD = n.sms.find((m) => m.to === '436641111111')
  const tS = tokenOf(n.push.find((p) => p.topic === 'wd-dragan') || { actions: [] })
  check('Testalarm: SMS an alle drei aus Stufe 1, zusätzlich zu Push und E-Mail, ohne Fehler', r.json.Salzburg.fehler.length === 0 && n.sms.length === 3 && n.push.length === 2 && n.mail.length === 1 && !n.wa.length, `${JSON.stringify(r.json)} · ${n.sms.length}`)
  check('SMS: Überschrift, Text und kurzer Link „Bin wach“ in der Sprache der Person, mit demselben Code wie im Push', !!smsD && smsD.text === `Testalarm Winterdienst Salzburg: Probe: So kommt der Schnee-Alarm. Budan/na sam: http://127.0.0.1:${HTTP}/wetter-alarm.php?w=${tS}` && tS.length === 24, smsD?.text)
  check('SMS: nur Zeichen einer gewöhnlichen SMS (keine „“, kein –), höchstens zwei SMS lang', n.sms.every((m) => gsm.test(m.text) && m.text.length <= 306), n.sms.map((m) => m.text.length).join(','))
  r = await api('', { key: '', extra: `&w=${tS}` })
  check('Kurzer Link aus der SMS: Seite mit Knopf (bestätigt noch nichts)', r.status === 200 && /<form method="post">/.test(r.text) && /<html lang="hr">/.test(r.text) && (await api('status')).json.orte[0].alarm.wach.length === 0, `${r.status}`)
  r = await api('', { method: 'POST', key: '', extra: `&w=${tS}` })
  check('Knopf auf dieser Seite: bestätigt mit Namen', r.status === 200 && /Dragan Jović/.test(flat(r.text)) && (await api('status')).json.orte[0].alarm.wach[0]?.name === 'Dragan Jović', flat(r.text).slice(0, 120))

  b = await cron(hour(12), 'mittag')
  n = await neu()
  check('12:00 Uhr, Glätte in Obertrum (neuer Alarm nach der Pause): Push und SMS', !!b.orte?.Obertrum?.alarm && n.push.length === 1 && n.push[0].topic === 'wd-jelena' && n.sms.length === 1 && n.sms[0].to === '436645555555', `${JSON.stringify(b.orte?.Obertrum)} · ${n.push.length}/${n.sms.length}`)
  check('SMS zum echten Alarm: Lage ohne Sonderzeichen (Grad statt °C), Link zum Bestätigen', new RegExp(`^Winterdienst Obertrum: Glätte möglich ab 12:00 Uhr \\(-1 Grad mit Niederschlag\\)\\. Bin wach: http://127\\.0\\.0\\.1:${HTTP}/wetter-alarm\\.php\\?w=[a-f0-9]{24}$`).test(n.sms[0]?.text || ''), n.sms[0]?.text)
  await cron(hour(12) + 960, 'mittag')
  n = await neu()
  check('12:16 Uhr, niemand bestätigt, Obertrum hat keine Stufe 2: nichts weiter; Salzburg bleibt ruhig', !n.sms.length && !n.push.length)

  smsOhneGuthaben.add('436643333333')
  r = await api('test', { method: 'POST', extra: '&ort=Salzburg' })
  n = await neu()
  check('Guthaben beim Dienst aufgebraucht: klarer Grund im Bericht, Push und E-Mail gehen trotzdem', r.json.Salzburg.fehler.length === 1 && r.json.Salzburg.fehler[0] === 'SMS an Mehmet Yılmaz: Guthaben beim SMS-Dienst aufgebraucht (Code 500)' && n.sms.length === 2 && n.push.length === 2 && n.mail.length === 1, JSON.stringify(r.json))
  check('Die App sieht das niedrige Guthaben', (await api('sms')).json.guthaben === 0.03)
  smsOhneGuthaben.clear()
  writeFileSync(join(dir, 'sms-zaehler.json'), JSON.stringify({ tag: '2026-12-10', anzahl: 100, guthaben: 5 }))
  r = await api('test', { method: 'POST', extra: '&ort=Salzburg' })
  n = await neu()
  check('Grenze je Tag (100 SMS): SMS hält an, Push und E-Mail gehen weiter', r.json.Salzburg.fehler.length === 3 && r.json.Salzburg.fehler.every((f) => /^SMS an .*: Grenze von 100 SMS am Tag erreicht$/.test(f)) && !n.sms.length && n.push.length === 2, JSON.stringify(r.json))
  r = await api('sms', { method: 'POST', json: { entfernen: true } })
  check('SMS entfernen: Zugang am Webspace gelöscht', r.status === 200 && r.json.eingerichtet === false && !existsSync(join(dir, 'sms.json')) && (await api('status')).json.sms === false)
  r = await api('test', { method: 'POST', extra: '&ort=Salzburg' })
  n = await neu()
  check('Ohne SMS-Zugang: keine SMS, kein Fehler', !n.sms.length && r.json.Salzburg.fehler.length === 0 && n.push.length === 2)
  check('Am Webspace liegt der Schlüssel des SMS-Dienstes nirgends mehr', !readdirSync(dir).some((f) => statSync(join(dir, f)).isFile() && readFileSync(join(dir, f), 'utf8').includes(SMS_KEY)))

  // ---------------------------------------------------------------- 9. SMS über das eigene Android-Handy
  check('Eigenes Handy: ohne Benutzername oder Passwort, mit Leerzeichen oder einem Server ohne https abgelehnt', (await api('sms', { method: 'POST', json: { anbieter: 'handy', benutzer: GATE_USER } })).status === 400 && (await api('sms', { method: 'POST', json: { anbieter: 'handy', benutzer: 'mit leer', passwort: GATE_PASS } })).status === 400 && (await api('sms', { method: 'POST', json: { anbieter: 'handy', benutzer: GATE_USER, passwort: GATE_PASS, server: 'http://unsicher.example' } })).status === 400 && !existsSync(join(dir, 'sms.json')))
  r = await api('sms', { method: 'POST', json: { anbieter: 'handy', benutzer: GATE_USER, passwort: 'falsch-123' } })
  check('Eigenes Handy gespeichert: Stand mit Benutzername, ohne Passwort', r.status === 200 && r.json.eingerichtet === true && r.json.anbieter === 'handy' && r.json.benutzer === GATE_USER && r.json.server === '' && !r.text.includes('falsch-123') && !('passwort' in r.json) && (statSync(join(dir, 'sms.json')).mode & 0o077) === 0, r.text.slice(0, 200))
  r = await api('sms-test', { method: 'POST', json: { an: '+43 664 1234567' } })
  check('Probe mit falschem Passwort: klarer Grund, ohne das Passwort im Text', r.status === 502 && r.json.fehler === 'Benutzername oder Passwort falsch (Antwort 401)', JSON.stringify(r.json))
  r = await api('sms', { method: 'POST', json: { passwort: GATE_PASS } })
  check('Nur das Passwort tauschen: Weg und Benutzername bleiben', r.status === 200 && r.json.anbieter === 'handy' && r.json.benutzer === GATE_USER)
  r = await api('sms-test', { method: 'POST', json: { an: '+43 664 1234567' } })
  n = await neu()
  check('Probe-SMS über das Handy: JSON mit Text und Nummer mit +, Benutzername und Passwort als Basic, kein SMS-Dienst beteiligt', r.status === 200 && gateListe.length === 1 && gateListe[0].phoneNumbers.join() === '+436641234567' && /^Probe Cleanos App: So kommt der Schnee-Alarm als SMS\./.test(gateListe[0].textMessage.text) && /application\/json/.test(gateListe[0].typ) && !n.sms.length && !('guthaben' in r.json), JSON.stringify(gateListe[0]))
  gateFehler.add('+436649999999')
  r = await api('sms-test', { method: 'POST', json: { an: '+43 664 9999999' } })
  check('Meldet das Handy „Failed“: als Fehler erkannt', r.status === 502 && r.json.fehler === 'vom Handy nicht gesendet (Failed)', JSON.stringify(r.json))
  gateFehler.clear()
  r = await api('test', { method: 'POST', extra: '&ort=Salzburg' })
  await wait(150)
  const viaHandy = gateListe.slice(1)
  n = await neu()
  check('Testalarm: SMS an alle drei über das Handy, mit Link „Bin wach“', r.json.Salzburg.fehler.length === 0 && viaHandy.length === 3 && viaHandy.every((m) => /^\+43664[123]{7}$/.test(m.phoneNumbers[0]) && /wetter-alarm\.php\?w=[a-f0-9]{24}$/.test(m.textMessage.text)) && n.push.length === 2 && !n.sms.length, `${JSON.stringify(r.json)} · ${viaHandy.map((m) => m.phoneNumbers[0])}`)
  r = await api('sms', { method: 'POST', json: { anbieter: 'seven', schluessel: SMS_KEY } })
  check('Wechsel zu seven.io: Benutzername und Passwort des Handys fallen weg', r.status === 200 && r.json.anbieter === 'seven' && !/benutzer|passwort/.test(readFileSync(join(dir, 'sms.json'), 'utf8')))
  r = await api('sms', { method: 'POST', json: { anbieter: 'handy', benutzer: GATE_USER } })
  check('Zurück zum Handy ohne Passwort: abgelehnt (das alte gilt nicht mehr)', r.status === 400 && /Benutzername und Passwort/.test(r.json.fehler))
  r = await api('sms', { method: 'POST', json: { anbieter: 'handy', benutzer: GATE_USER, passwort: GATE_PASS, server: 'https://sms.cleanos.example/3rdparty/v1' } })
  check('Eigener Server mit https wird gespeichert und angezeigt', r.status === 200 && r.json.server === 'https://sms.cleanos.example/3rdparty/v1' && !readFileSync(join(dir, 'sms.json'), 'utf8').includes(SMS_KEY))
  await neu()

  // ---------------------------------------------------------------- 10. „Handy einrichten“, Probe, bereit
  const seite = async (q, opts) => {
    const res = await fetch(`http://127.0.0.1:${HTTP}/wetter-alarm.php?${q}`, { redirect: 'manual', ...opts })
    return { status: res.status, html: await res.text(), robots: res.headers.get('x-robots-tag') || '' }
  }
  let sp = await seite('aktion=handy&t=wd-unbekannt')
  check('Einrichtungsseite mit unbekanntem Thema: 404, keine Namen', sp.status === 404 && /gilt nicht \(mehr\)/.test(flat(sp.html)) && !/Dragan|Ana/.test(sp.html))
  sp = await seite('aktion=handy&t=wd-dragan')
  const deep = sp.html.match(/href="(ntfy:\/\/[^"]+)"/)?.[1]?.replace(/&amp;/g, '&') || ''
  check('Einrichtungsseite in der Sprache der Person (Bosnisch/Kroatisch/Serbisch), mit Name, App-Läden und Schritten', sp.status === 200 && /<html lang="hr">/.test(sp.html) && /Dragan Jović/.test(sp.html) && /Podesi telefon za alarm za snijeg/.test(flat(sp.html)) && /play\.google\.com\/store\/apps\/details\?id=io\.heckel\.ntfy/.test(sp.html) && /f-droid\.org\/packages\/io\.heckel\.ntfy/.test(sp.html) && /apps\.apple\.com\/app\/ntfy\/id1625396347/.test(sp.html) && /noindex/.test(sp.robots), flat(sp.html).slice(0, 200))
  check('Knopf öffnet ntfy und abonniert das Thema (ntfy://Server/Thema, Anzeigename, http-Server mit secure=false)', deep === `ntfy://127.0.0.1:${NTFY}/wd-dragan?display=Alarm%20za%20snijeg&secure=false`, deep)
  check('Fallback von Hand: Thema und Server stehen auf der Seite', sp.html.includes('<code>wd-dragan</code>') && sp.html.includes(`<code>http://127.0.0.1:${NTFY}</code>`))
  check('Seite auf Deutsch umstellbar', /Handy für den Schnee-Alarm einrichten/.test(flat((await seite('aktion=handy&t=wd-dragan&sprache=de')).html)))
  sp = await seite('aktion=handy&t=wd-dragan', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } })
  check('Probe von einer fremden Seite: 403', sp.status === 403)
  sp = await seite('aktion=handy&t=wd-dragan', { method: 'POST' })
  n = await neu()
  const pp = n.push.find((p) => p.topic === 'wd-dragan')
  const tP = tokenOf(pp || { actions: [] })
  check('Probe von der Seite: Bestätigung auf der Seite, Push mit Knopf „Bin wach“ und ohne Protokoll-Knopf', /Proba je poslana/.test(flat(sp.html)) && !!pp && pp.title === 'Probe Winterdienst' && /^Probe: So kommt der Schnee-Alarm auf dieses Handy\./.test(pp.message) && tP.length === 24 && !pp.actions.some((a) => /aktion=protokoll/.test(a.url)), JSON.stringify(pp || {}).slice(0, 300))
  check('Probe geht über alle Wege der Person: E-Mail ohne Protokoll-Link, SMS über das Handy (eigener Server laut Einstellung, hier nachgestellt)', n.mail.length === 1 && n.mail[0].an === 'dragan@cleanos.example' && /Bitte bestätigen: .*aktion=wach&t=/.test(n.mail[0].text) && !/Protokoll eintragen/.test(n.mail[0].text) && gateListe.at(-1)?.phoneNumbers?.[0] === '+436641111111' && gateListe.at(-1).textMessage.text.endsWith(`?w=${tP}`), JSON.stringify(n.mail[0] || {}).slice(0, 200))
  r = await api('status')
  check('Stand für die App: Probe gesendet (nach der letzten Bestätigung, also offen)', r.json.handys['wd-dragan']?.probe > 0 && r.json.handys['wd-dragan'].probe >= (r.json.handys['wd-dragan'].bestaetigt || 0), JSON.stringify(r.json.handys))
  check('Bestätigte Alarme zählen auch: Hallein (03:10 bestätigt) ist „bereit“', r.json.handys['wd-h2']?.bestaetigt > 0, JSON.stringify(r.json.handys))
  sp = await seite(`aktion=wach&t=${tP}`)
  check('„Bin wach“ zur Probe: zuerst eine Seite mit Knopf', sp.status === 200 && /<form method="post">/.test(sp.html))
  sp = await seite(`aktion=wach&t=${tP}`, { method: 'POST' })
  check('Knopf: „Hvala, Dragan Jović!“ – Handy bereit', sp.status === 200 && /Hvala, Dragan Jović!/.test(flat(sp.html)) && /spreman za alarm za snijeg/.test(flat(sp.html)), flat(sp.html).slice(0, 160))
  r = await api('status')
  check('Stand für die App: bestätigt', r.json.handys['wd-dragan']?.bestaetigt > 0 && r.json.protokoll.some((p) => p.ort === 'Probe' && p.text === 'Probe an Dragan Jović'))
  check('Die Einrichtungsseite zeigt danach „zuletzt bestätigt“', /zadnji put potvrdio/.test(flat((await seite('aktion=handy&t=wd-dragan')).html)))
  await seite('aktion=handy&t=wd-dragan', { method: 'POST' })
  await seite('aktion=handy&t=wd-dragan', { method: 'POST' })
  sp = await seite('aktion=handy&t=wd-dragan', { method: 'POST' })
  n = await neu()
  check('Höchstens drei Proben je Stunde von der Seite', /Upravo je poslano više proba/.test(flat(sp.html)) && n.push.filter((p) => p.topic === 'wd-dragan').length === 2, `${n.push.length}`)
  r = await api('probe', { method: 'POST', json: { thema: 'wd-ana' } })
  n = await neu()
  check('Probe aus der App an eine Person (Thema): Push an sie', r.status === 200 && r.json.gesendet === true && n.push.length === 1 && n.push[0].topic === 'wd-ana' && n.push[0].title === 'Probe Winterdienst', JSON.stringify(r.json))
  check('Probe aus der App: unbekanntes Thema 404, ohne Schlüssel 403', (await api('probe', { method: 'POST', json: { thema: 'wd-niemand' } })).status === 404 && (await api('probe', { method: 'POST', key: '', json: { thema: 'wd-ana' } })).status === 403)
  r = await api('sms', { method: 'POST', json: { entfernen: true } })
  check('SMS über das Handy entfernt: Zugang gelöscht, Passwort liegt nirgends mehr', r.json.eingerichtet === false && !readdirSync(dir).some((f) => statSync(join(dir, f)).isFile() && readFileSync(join(dir, f), 'utf8').includes(GATE_PASS)))
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
php.kill()
wetter.close()
ntfy.close()
meta.close()
seven.close()
gate.close()
await finish(null, [], [])
