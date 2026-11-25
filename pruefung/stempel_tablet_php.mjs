// Stempeluhr am Tablet (mein-plan.php?tablet=…), geprüft gegen den eingebauten PHP-Server mit einem eigenen Ordner
// privat/ (MEIN_PLAN_ORDNER). Vier Server mit verschiedener Uhrzeit (WETTER_JETZT) teilen sich den Ordner:
// A = jetzt, B = +90 s (Ticket abgelaufen), C = +3 h 5 min (Gehen, Sperre), D = C + 310 s (Sperre vorbei).
// Geprüft: Einrichten (Link, Cookie), PIN-Feld ohne Namen und Codes, falsche PIN, Name und Plan nach der PIN, Kommen,
// zweimal Tippen, abgelaufenes und fremdes Ticket, Gehen mit Dauer, Person ohne Plan, Sprache der Person, Gehen am
// eigenen Handy (QR-Code) nach Kommen am Tablet, Sperre nach fünf falschen PINs mit Push ans Büro und doppelter Dauer,
// Aufruf von fremder Seite, entferntes Tablet; im Browser Zifferntasten, Uhr, zurück zum PIN-Feld, Tablet und Handy.
// Ports 19815–19819.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, check, finish, wait, R, P } from './ablauf-lib.mjs'

const sha = (t) => createHash('sha256').update(t).digest('hex')
const dir = join(P, 'tablet-php')
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

const KEY = 'k'.repeat(40)
const QR = 'QRTOKEN12345'
const T1 = 'TabletCodeEins234567' // Autohaus
const T2 = 'TabletCodeZwei234567' // Wohnanlage
const P_MARIA = 'MariaCode23456789abcd'
const P_ANA = 'AnaCode23456789abcdef'
const P_MEHMET = 'MehmetCode23456789abc'
const P_JELENA = 'JelenaCode23456789abc'
const PIN = { maria: '4821', ana: '7395', mehmet: '6274', jelena: '9053' }
const NTFY = 19819
const settings = (geraete) => ({
  version: 1,
  schluessel: KEY,
  adresse: 'http://127.0.0.1:19815/',
  ntfy: `http://127.0.0.1:${NTFY}`,
  absender: '',
  buero: [{ name: 'Büro-Handy', ntfy: 'buero-thema' }],
  zeiterfassung: {
    alarmMinuten: 20,
    pruefschluessel: 'p'.repeat(32),
    objekte: { [QR]: { id: 'o1', name: 'Autohaus Maxglan' } },
    tablet: {
      pinLaenge: 4,
      geraete,
      pins: {
        [sha(`${KEY}:${PIN.maria}`)]: { hash: sha(P_MARIA), name: 'Maria Huber' },
        [sha(`${KEY}:${PIN.ana}`)]: { hash: sha(P_ANA), name: 'Ana Popescu' },
        [sha(`${KEY}:${PIN.mehmet}`)]: { hash: sha(P_MEHMET), name: 'Mehmet Yılmaz' },
        [sha(`${KEY}:${PIN.jelena}`)]: { hash: sha(P_JELENA), name: 'Jelena Marković' },
      },
    },
  },
})
const BOTH = { [sha(T1)]: { id: 'o1', name: 'Autohaus Maxglan' }, [sha(T2)]: { id: 'o2', name: 'Wohnanlage Lehen' } }
writeFileSync(join(dir, 'mitarbeiter.json'), JSON.stringify(settings(BOTH)))

// Push ans Büro mitlesen
const pushes = []
const ntfy = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    try {
      pushes.push(JSON.parse(body))
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}')
  })
}).listen(NTFY, '127.0.0.1')

const now = Math.floor(Date.now() / 1000)
const TIMES = { A: now, B: now + 90, C: now + 3 * 3600 + 300, D: now + 3 * 3600 + 300 + 310 }
const PORTS = { A: 19815, B: 19816, C: 19817, D: 19818 }
const servers = Object.entries(PORTS).map(([k, port]) => spawn('php', ['-S', `127.0.0.1:${port}`, '-t', R], { env: { ...process.env, MEIN_PLAN_ORDNER: dir, WETTER_JETZT: String(TIMES[k]), NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }, stdio: 'ignore' }))
await wait(1500)

const vienna = (ts, opt) => new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', ...opt }).format(new Date(ts * 1000))
const hm = (ts) => vienna(ts, { hour: '2-digit', minute: '2-digit' })
const dateOf = (ts) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(new Date(ts * 1000))
const flat = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

/** Aufruf an Server s; cookie: Wert des Tablet-Cookies (oder null), form: POST-Felder. */
async function call(s, query, { cookie = null, form = null, headers = {}, person = null } = {}) {
  const jar = [cookie ? `mein_plan_tablet=${cookie}` : '', person ? `mein_plan=${person}` : ''].filter(Boolean).join('; ')
  const r = await fetch(`http://127.0.0.1:${PORTS[s]}/mein-plan.php?${query}`, {
    method: form ? 'POST' : 'GET',
    redirect: 'manual',
    headers: { ...(jar ? { Cookie: jar } : {}), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...headers },
    body: form ? new URLSearchParams(form).toString() : undefined,
  })
  const html = await r.text()
  return { status: r.status, html, text: flat(html), location: r.headers.get('location') || '', cookies: r.headers.getSetCookie?.() || [] }
}
const follow = async (s, r, cookie) => call(s, r.location.split('?')[1], { cookie })
const ticketOf = (html) => html.match(/name="ticket" value="([^"]+)"/)?.[1] || ''
const api = async (s, aktion, body) => {
  const r = await fetch(`http://127.0.0.1:${PORTS[s]}/mein-plan.php?aktion=${aktion}`, { method: body ? 'POST' : 'GET', headers: { 'X-Schluessel': KEY, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const stamps = async (s = 'A') => (await api(s, 'zeiten&seit=0')).json.zeiten
/** PIN tippen und, wenn sie stimmt, den Knopf drücken: liefert die Seite nach der PIN und die Bestätigung. */
async function stamp(s, cookie, pin) {
  const confirm = await call(s, 'tablet=1&aktion=pin', { cookie, form: { pin } })
  if (confirm.status !== 200) return { confirm, done: null }
  const go = await call(s, 'tablet=1&aktion=stempeln', { cookie, form: { ticket: ticketOf(confirm.html) } })
  return { confirm, go, done: go.status === 303 ? await follow(s, go, cookie) : go }
}

const browser = await chromium.launch()
const errors = []
try {
  // Plan am Handy: Maria heute im Autohaus (Beginn jetzt), Mehmet mit türkischer Seite, ohne Einsatz dort
  const today = dateOf(TIMES.A)
  const monday = (() => {
    const d = new Date(`${today}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    return d.toISOString().slice(0, 10)
  })()
  const begin = hm(TIMES.A)
  const end = hm(TIMES.A + 3 * 3600)
  const week = (entries) => ({ kw: 1, von: monday, bis: monday, tage: [{ datum: today, eintraege: entries }], summe: { ist: 180, soll: 180 }, konto: null })
  let a = await api('A', 'speichern', {
    personen: [{ hash: sha(P_MARIA), name: 'Maria Huber', ntfy: '', sprache: 'de' }, { hash: sha(P_MEHMET), name: 'Mehmet Yılmaz', ntfy: '', sprache: 'tr' }],
    wochen: {
      [sha(P_MARIA)]: { [monday]: week([{ id: `${today}|t1`, objektId: 'o1', beginn: begin, zeit: `${begin}–${end}`, objekt: 'Autohaus Maxglan', leistung: 'Unterhaltsreinigung', adresse: '', notizen: [] }]) },
      [sha(P_MEHMET)]: { [monday]: week([]) },
    },
  })
  check('Vorbereitung: Pläne für zwei Personen am Webspace', a.status === 200 && a.json.personen === 2, JSON.stringify(a.json))

  // ---------------------------------------------------------------- Einrichten
  let r = await call('A', 'tablet=1')
  check('Gerät ohne Einrichtung: 403 mit Hinweis auf den Einrichtungs-Link', r.status === 403 && /noch keine Stempeluhr/.test(r.text) && !/Autohaus|Maria/.test(r.text), `${r.status} ${r.text.slice(0, 120)}`)
  r = await call('A', 'tablet=FalscherCode234567890')
  check('Unbekannter Einrichtungs-Link: 404, kein Cookie', r.status === 404 && /nicht \(mehr\) als Stempeluhr eingerichtet/.test(r.text) && !r.cookies.length, `${r.status}`)
  r = await call('A', `tablet=${T1}`)
  const set = r.cookies.find((c) => c.startsWith('mein_plan_tablet=')) || ''
  check('Einrichtungs-Link: Cookie (nur für den Server lesbar, 400 Tage), weiter zur Stempeluhr ohne Code in der Adresse', r.status === 303 && r.location === 'mein-plan.php?tablet=1' && set.startsWith(`mein_plan_tablet=${T1}`) && /HttpOnly/i.test(set) && /SameSite=Lax/i.test(set) && /Max-Age=345\d{5}/i.test(set), `${r.status} ${r.location} ${set}`)

  r = await call('A', 'tablet=1', { cookie: T1 })
  check('PIN-Feld: Objekt, Uhrzeit des Servers, Zifferntasten, Skript', r.status === 200 && /Stempeluhr/.test(r.text) && /Autohaus Maxglan/.test(r.text) && /Deine PIN eintippen/.test(r.text) && r.text.includes(hm(TIMES.A)) && (r.html.match(/data-z="\d"/g) || []).length === 10 && /src="mein-plan-tablet\.js"/.test(r.html) && /id="tb-pin"[^>]*inputmode="numeric"/.test(r.html), r.text.slice(0, 200))
  check('PIN-Feld verrät nichts: keine Namen, keine PINs, kein Code des Tablets, kein Schlüssel', !/Maria|Ana |Mehmet|Jelena/.test(r.html) && !Object.values(PIN).some((p) => r.html.includes(p)) && !r.html.includes(T1) && !r.html.includes(KEY) && !r.html.includes(sha(T1)))
  {
    const raw = await fetch(`http://127.0.0.1:${PORTS.A}/mein-plan.php?tablet=1`, { headers: { Cookie: `mein_plan_tablet=${T1}` } })
    check('Kopfzeilen: noindex, no-store, kein Referrer', /noindex/.test(raw.headers.get('x-robots-tag') || '') && /no-store/.test(raw.headers.get('cache-control') || '') && /no-referrer/.test(raw.headers.get('referrer-policy') || ''), `${raw.headers.get('x-robots-tag')} | ${raw.headers.get('cache-control')} | ${raw.headers.get('referrer-policy')}`)
  }

  // ---------------------------------------------------------------- PIN und Kommen
  r = await call('A', 'tablet=1&aktion=pin', { cookie: T1, form: { pin: '1357' } })
  check('Falsche PIN: zurück zum PIN-Feld', r.status === 303 && r.location === 'mein-plan.php?tablet=1&f=pin', `${r.status} ${r.location}`)
  r = await follow('A', r, T1)
  check('Falsche PIN: verständliche Meldung, kein Name', /Diese PIN kennen wir nicht/.test(r.text) && !/Hallo/.test(r.text))

  r = await call('A', 'tablet=1&aktion=pin', { cookie: T1, form: { pin: PIN.maria } })
  const ticket1 = ticketOf(r.html)
  check('Richtige PIN: Name, Objekt, Einsatz laut Plan, Knopf „Kommen erfassen“, Abbrechen', r.status === 200 && /Hallo Maria Huber!/.test(r.text) && /Autohaus Maxglan/.test(r.text) && r.text.includes(`Laut Plan: ${begin}–${end}`) && /Unterhaltsreinigung/.test(r.text) && /Kommen erfassen/.test(r.text) && /Abbrechen \(das bin ich nicht\)/.test(r.text) && ticket1.length > 80, r.text.slice(0, 260))
  check('Nach der PIN ist noch nichts gestempelt; die Seite geht nach 30 Sekunden zurück', (await stamps()).length === 0 && /data-zurueck="30"/.test(r.html))
  check('Die PIN steht nicht in der Seite', !r.html.includes(PIN.maria))

  r = await call('A', 'tablet=1&aktion=stempeln', { cookie: T1, form: { ticket: ticket1 } })
  check('Kommen: Weiterleitung auf die Bestätigung', r.status === 303 && r.location.startsWith('mein-plan.php?tablet=1&erfasst='), `${r.status} ${r.location.slice(0, 60)}`)
  r = await follow('A', r, T1)
  check('Bestätigung: Name, „Kommen um … Uhr erfasst“, „Fertig“, nach 6 Sekunden zurück', r.status === 200 && /Maria Huber/.test(r.text) && r.text.includes(`Kommen um ${hm(TIMES.A)} Uhr erfasst.`) && /Fertig/.test(r.text) && /data-zurueck="6"/.test(r.html), r.text.slice(0, 200))
  let list = await stamps()
  check('Stempelung am Webspace: Person, Objekt, Einsatz laut Plan, Uhrzeit des Servers, Quelle Tablet', list.length === 1 && list[0].hash === sha(P_MARIA) && list[0].name === 'Maria Huber' && list[0].objektId === 'o1' && list[0].einsatz === `${today}|t1` && list[0].plan === `${begin}–${end}` && list[0].kommen === TIMES.A && list[0].gehen === null && list[0].quelle === 'tablet', JSON.stringify(list[0]))
  check('Alarm „nicht eingestempelt“ gilt ab jetzt für Maria (stempelt vermerkt)', JSON.parse(readFileSync(join(dir, 'mitarbeiter', `${sha(P_MARIA)}.json`), 'utf8')).stempelt === TIMES.A)

  r = await call('A', 'tablet=1&aktion=stempeln', { cookie: T1, form: { ticket: ticket1 } })
  r = await follow('A', r, T1)
  list = await stamps()
  check('Zweimal getippt zählt einmal: „Schon erfasst“, kein Gehen', /Schon erfasst/.test(r.text) && list.length === 1 && list[0].gehen === null, r.text.slice(0, 120))

  // ---------------------------------------------------------------- Ticket: abgelaufen, verändert, fremdes Tablet
  r = await call('B', 'tablet=1&aktion=stempeln', { cookie: T1, form: { ticket: ticket1 } })
  check('Ticket nach 90 Sekunden abgelaufen: zurück zum PIN-Feld', r.status === 303 && r.location === 'mein-plan.php?tablet=1&f=zeit', `${r.status} ${r.location}`)
  r = await follow('B', r, T1)
  list = await stamps()
  check('Abgelaufen: Meldung „zu lange gedauert“, Stempelung unverändert', /Das hat zu lange gedauert/.test(r.text) && list.length === 1 && list[0].gehen === null)
  const fresh = await call('B', 'tablet=1&aktion=pin', { cookie: T2, form: { pin: PIN.maria } })
  const ticket2 = ticketOf(fresh.html)
  check('Zweites Tablet (Wohnanlage) kennt dieselbe PIN: dort kein Einsatz laut Plan', fresh.status === 200 && /Wohnanlage Lehen/.test(fresh.text) && /Laut Plan hast du hier jetzt keinen Einsatz/.test(fresh.text) && ticket2.length > 80)
  r = await call('B', 'tablet=1&aktion=stempeln', { cookie: T1, form: { ticket: ticket2 } })
  check('Ticket eines anderen Tablets gilt hier nicht', r.status === 303 && r.location.endsWith('&f=zeit'))
  r = await call('B', 'tablet=1&aktion=stempeln', { cookie: T2, form: { ticket: `${ticket2.slice(0, -4)}0000` } })
  check('Verändertes Ticket gilt nicht', r.status === 303 && r.location.endsWith('&f=zeit'))
  r = await call('B', 'tablet=1&aktion=stempeln', { cookie: T2, form: { ticket: ticket2.replace(/^[^.]+/, Buffer.from(JSON.stringify({ a: 'ticket', g: sha(T2), h: sha(P_ANA), bis: TIMES.B + 999 })).toString('base64url')) } })
  check('Selbst gebautes Ticket für eine andere Person gilt nicht', r.status === 303 && r.location.endsWith('&f=zeit') && (await stamps()).length === 1)
  r = await call('B', `tablet=1&erfasst=${encodeURIComponent(ticket2)}`, { cookie: T2 })
  check('Ein Ticket ist keine Bestätigung: es erscheint nur das PIN-Feld', r.status === 200 && /Deine PIN eintippen/.test(r.text) && !/Maria/.test(r.text))
  r = await call('B', 'tablet=1&aktion=pin', { cookie: T1, form: { pin: PIN.maria }, headers: { 'Sec-Fetch-Site': 'cross-site' } })
  check('Formular von einer fremden Seite: 403', r.status === 403 && /Nicht erlaubt/.test(r.text))
  r = await call('B', 'tablet=1&aktion=stempeln', { cookie: T1, form: { ticket: ticket1 }, headers: { 'Sec-Fetch-Site': 'cross-site' } })
  check('Stempeln von einer fremden Seite: 403', r.status === 403)
  {
    // Felder als Liste statt als Text (pin[]=…, ticket[]=…): zählt wie eine falsche Eingabe, keine PHP-Meldung
    const raw = (q, body) => fetch(`http://127.0.0.1:${PORTS.B}/mein-plan.php?${q}`, { method: 'POST', redirect: 'manual', headers: { Cookie: `mein_plan_tablet=${T2}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    const p1 = await raw('tablet=1&aktion=pin', `pin[]=${PIN.maria}`)
    const p2 = await raw('tablet=1&aktion=stempeln', `ticket[]=${encodeURIComponent(ticket2)}`)
    const p3 = await fetch(`http://127.0.0.1:${PORTS.B}/mein-plan.php?tablet[]=1`, { redirect: 'manual' })
    check('Unerwartete Formularwerte (Listen): abgewiesen ohne PHP-Meldung', p1.status === 303 && (p1.headers.get('location') || '').endsWith('&f=pin') && p2.status === 303 && (p2.headers.get('location') || '').endsWith('&f=zeit') && p3.status === 403 && !/Warning|Notice|Fatal/.test(await p3.text()), `${p1.status} ${p2.status} ${p3.status}`)
  }

  // ---------------------------------------------------------------- Gehen
  let s = await stamp('C', T1, PIN.maria)
  check('Später: „Eingestempelt seit … (laut Plan …)“ und Knopf „Gehen erfassen“', s.confirm.text.includes(`Eingestempelt seit ${hm(TIMES.A)} Uhr (laut Plan ${begin}–${end}).`) && /Gehen erfassen/.test(s.confirm.text), s.confirm.text.slice(0, 220))
  check('Gehen: Bestätigung mit Uhrzeit und Dauer', s.done.text.includes(`Gehen um ${hm(TIMES.C)} Uhr erfasst (3:05 h). Danke!`), s.done.text.slice(0, 160))
  list = await stamps('C')
  check('Stempelung vollständig: Kommen und Gehen mit Zeit des Servers', list.length === 1 && list[0].kommen === TIMES.A && list[0].gehen === TIMES.C && list[0].geaendert === TIMES.C && list[0].quelle === 'tablet')

  // Person ohne veröffentlichten Plan (keine Datei am Webspace): Name aus der PIN-Liste
  s = await stamp('C', T1, PIN.ana)
  list = await stamps('C')
  const ana = list.find((x) => x.hash === sha(P_ANA))
  check('Person ohne Plan am Handy: Name aus der PIN-Liste, „kein Einsatz“, Kommen ohne Einsatz laut Plan', /Hallo Ana Popescu!/.test(s.confirm.text) && /Laut Plan hast du hier jetzt keinen Einsatz/.test(s.confirm.text) && /Ana Popescu/.test(s.done.text) && !!ana && ana.name === 'Ana Popescu' && ana.einsatz === '' && ana.datum === dateOf(TIMES.C) && ana.quelle === 'tablet', JSON.stringify(ana))

  // Sprache der Person (Stammblatt): Türkisch
  s = await stamp('C', T1, PIN.mehmet)
  check('Sprache der Person: Seite nach der PIN und Bestätigung auf Türkisch', /<html lang="tr">/.test(s.confirm.html) && /Merhaba Mehmet Yılmaz!/.test(s.confirm.text) && /Gelişi kaydet/.test(s.confirm.text) && /İptal \(bu ben değilim\)/.test(s.confirm.text) && /Geliş kaydedildi/.test(s.done.text) && /Tamam/.test(s.done.text), s.confirm.text.slice(0, 200))
  r = await call('C', 'tablet=1', { cookie: T1 })
  check('Danach ist das PIN-Feld wieder in der Sprache des Geräts (Deutsch)', /<html lang="de">/.test(r.html) && /Deine PIN eintippen/.test(r.text))
  r = await call('C', 'tablet=1&sprache=ro', { cookie: T1 })
  check('Sprache am PIN-Feld umstellbar (Rumänisch)', /<html lang="ro">/.test(r.html) && /Tastează codul tău PIN/.test(r.text) && /Pontaj pe tabletă/.test(r.text))

  // Kommen am Tablet, Gehen am eigenen Handy mit dem QR-Code: dieselbe Stempelung
  r = await call('D', `o=${QR}&aktion=stempeln`, { person: P_MEHMET, form: {} })
  list = await stamps('D')
  const mehmet = list.find((x) => x.hash === sha(P_MEHMET))
  check('Gehen am eigenen Handy (QR-Code) schließt die Stempelung vom Tablet', r.status === 303 && /erfasst=gehen/.test(r.location) && list.filter((x) => x.hash === sha(P_MEHMET)).length === 1 && mehmet.kommen === TIMES.C && mehmet.gehen === TIMES.D && mehmet.quelle === 'tablet', `${r.status} ${r.location} ${JSON.stringify(mehmet)}`)
  r = await call('A', `o=${QR}&aktion=stempeln`, { person: P_JELENA, form: {} })
  check('QR-Code ohne veröffentlichten Plan bleibt wie bisher gesperrt (Handy unbekannt)', r.status === 403)

  // ---------------------------------------------------------------- Sperre
  for (let i = 0; i < 4; i++) r = await call('C', 'tablet=1&aktion=pin', { cookie: T1, form: { pin: `13${i}7` } })
  check('Vier falsche PINs: noch nicht gesperrt', r.location.endsWith('&f=pin') && pushes.length === 0)
  s = await stamp('C', T1, PIN.jelena)
  check('Eine richtige PIN dazwischen geht, setzt den Zähler aber nicht zurück', /Hallo Jelena Marković!/.test(s.confirm.text) && /Kommen um/.test(s.done.text))
  r = await call('C', 'tablet=1&aktion=pin', { cookie: T1, form: { pin: '2460' } })
  check('Fünfte falsche PIN in zehn Minuten: gesperrt', r.status === 303 && r.location.endsWith('&f=gesperrt'), r.location)
  r = await follow('C', r, T1)
  check('Gesperrt: Meldung mit Minuten, keine Zifferntasten, Seite lädt nach der Sperre neu', /Zu viele falsche Versuche\. Bitte in 5 Minuten noch einmal versuchen oder im Büro anrufen\./.test(r.text) && !/data-z=/.test(r.html) && /data-zurueck="301"/.test(r.html), r.text.slice(0, 220))
  await wait(300)
  check('Push ans Büro-Handy: Objekt, Dauer der Sperre, wo die PINs stehen', pushes.length === 1 && pushes[0].topic === 'buero-thema' && pushes[0].title === 'Stempeluhr Autohaus Maxglan: mehrfach falsche PIN' && /für 5 Minuten gesperrt/.test(pushes[0].message) && /Tablets und PINs/.test(pushes[0].message), JSON.stringify(pushes))
  r = await call('C', 'tablet=1&aktion=pin', { cookie: T1, form: { pin: PIN.ana } })
  check('Während der Sperre gilt auch die richtige PIN nicht', r.status === 303 && r.location.endsWith('&f=gesperrt'))
  r = await call('C', 'tablet=1&aktion=pin', { cookie: T2, form: { pin: PIN.ana } })
  check('Die Sperre gilt nur für dieses Tablet', r.status === 200 && /Hallo Ana Popescu!/.test(r.text))
  a = await api('C', 'zeiten&seit=0')
  const t1 = a.json.tablets.find((t) => t.objektId === 'o1')
  check('Die App sieht je Tablet Objekt, letzte Meldung und Sperre (ohne Codes)', a.json.tablets.length === 2 && t1.gesehen >= TIMES.A && t1.gesperrt === TIMES.C + 300 && !JSON.stringify(a.json.tablets).includes(sha(T1)), JSON.stringify(a.json.tablets))
  check('Ohne Schlüssel bekommt niemand Stempelungen oder Tablets', (await fetch(`http://127.0.0.1:${PORTS.C}/mein-plan.php?aktion=zeiten`)).status === 403)

  r = await call('D', 'tablet=1', { cookie: T1 })
  check('Nach fünf Minuten: PIN-Feld wieder da', /Deine PIN eintippen/.test(r.text) && /data-z="5"/.test(r.html))
  s = await stamp('D', T1, PIN.ana)
  check('Nach der Sperre geht die richtige PIN wieder (Gehen)', /Gehen um/.test(s.done?.text || ''), s.confirm.text.slice(0, 120))
  for (let i = 0; i < 5; i++) r = await call('D', 'tablet=1&aktion=pin', { cookie: T1, form: { pin: `24${i}9` } })
  r = await follow('D', r, T1)
  await wait(300)
  check('Zweite Sperre am selben Tag: doppelt so lang, das Büro bekommt in dieser Stunde keinen zweiten Push', /Bitte in 10 Minuten/.test(r.text) && pushes.length === 1, `${r.text.slice(0, 160)} · ${pushes.length}`)

  // ---------------------------------------------------------------- Browser: Zifferntasten, Uhr, zurück zum PIN-Feld
  for (const [label, viewport] of [['Tablet 800 × 1280', { width: 800, height: 1280 }], ['Handy 390 × 844', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport })
    const page = await ctx.newPage()
    page.on('pageerror', (err) => errors.push(`${label}: ${err.message}`))
    page.on('console', (m) => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push(`${label}: ${m.text()}`))
    await page.goto(`http://127.0.0.1:${PORTS.A}/mein-plan.php?tablet=${T2}`)
    await page.waitForSelector('#tb-form.tb-js')
    check(`${label}: nach dem Einrichtungs-Link steht kein Code in der Adresse`, page.url().endsWith('mein-plan.php?tablet=1'), page.url())
    const lay = await page.evaluate(() => {
      const keys = [...document.querySelectorAll('.tb-tasten button')].map((b) => b.getBoundingClientRect())
      return { scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, keys: keys.length, small: keys.filter((k) => k.width < 44 || k.height < 44).length, type: document.getElementById('tb-pin').type, dots: document.getElementById('tb-punkte').textContent, extra: getComputedStyle(document.querySelector('.tb-ohne')).display }
    })
    check(`${label}: zwölf Tasten, alle mindestens 44 px, kein Querscrollen, PIN-Feld versteckt (keine Passwort-Frage)`, lay.keys === 12 && lay.small === 0 && lay.scroll <= 0 && lay.type === 'hidden' && lay.dots === '○○○○' && lay.extra === 'none', JSON.stringify(lay))
    const t0 = await page.textContent('#tb-uhr')
    await wait(1300)
    const t1b = await page.textContent('#tb-uhr')
    check(`${label}: die Uhr läuft (Serverzeit mit Sekunden)`, /^\d{2}:\d{2}:\d{2}$/.test(t0) && t0 !== t1b && t0.startsWith(hm(TIMES.A).slice(0, 2)), `${t0} → ${t1b}`)
    await page.click('.tb-tasten button[data-z="1"]')
    await page.click('.tb-tasten button[data-z="3"]')
    check(`${label}: getippte Ziffern als Punkte`, (await page.textContent('#tb-punkte')) === '●●○○')
    await page.click('.tb-tasten button[data-weg]')
    await page.click('.tb-tasten button[data-weg]')
    check(`${label}: „Löschen“ nimmt die Ziffern zurück`, (await page.textContent('#tb-punkte')) === '○○○○')
    for (const z of PIN.jelena) await page.click(`.tb-tasten button[data-z="${z}"]`)
    await page.waitForSelector('.tb-name')
    const hello = await page.textContent('.tb-name')
    const big = await page.evaluate(() => {
      const b = document.querySelector('button.tb-gross').getBoundingClientRect()
      return { h: b.height, scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth }
    })
    check(`${label}: vier Ziffern genügen, dann Name und großer Knopf`, hello === 'Hallo Jelena Marković!' && big.h >= 60 && big.scroll <= 0, `${hello} ${JSON.stringify(big)}`)
    if (label.startsWith('Tablet')) {
      await page.click('a.tb-zweit')
      await page.waitForSelector('#tb-form.tb-js')
      check(`${label}: „Abbrechen“ führt zurück zum PIN-Feld, nichts gestempelt`, !(await stamps()).some((x) => x.hash === sha(P_JELENA) && x.objektId === 'o2'))
      await page.keyboard.type(PIN.jelena)
      await page.waitForSelector('.tb-name')
      check(`${label}: PIN auch mit einer angeschlossenen Tastatur`, (await page.textContent('.tb-name')) === 'Hallo Jelena Marković!')
      await page.click('button.tb-gross')
      await page.waitForSelector('.tb-haken')
      const done = await page.textContent('#tb')
      check(`${label}: Bestätigung mit Haken und Namen`, /Jelena Marković/.test(done) && /Kommen um \d{2}:\d{2} Uhr erfasst\./.test(done), done.replace(/\s+/g, ' ').slice(0, 140))
      await page.screenshot({ path: join(P, 'tablet-bestaetigung.png') })
      await page.waitForSelector('#tb-form.tb-js', { timeout: 9000 })
      check(`${label}: nach sechs Sekunden von selbst wieder das PIN-Feld`, (await page.textContent('#tb-punkte')) === '○○○○' && page.url().endsWith('mein-plan.php?tablet=1'))
      await page.screenshot({ path: join(P, 'tablet-pin.png') })
    } else {
      await page.screenshot({ path: join(P, 'tablet-handy-name.png') })
    }
    await ctx.close()
  }
  // ohne Skript: PIN-Feld mit der Tastatur des Geräts
  {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 1280 }, javaScriptEnabled: false })
    const page = await ctx.newPage()
    await page.goto(`http://127.0.0.1:${PORTS.A}/mein-plan.php?tablet=${T2}`)
    const plain = await page.evaluate(() => ({ type: document.getElementById('tb-pin').type, keys: getComputedStyle(document.querySelector('.tb-tasten')).display, button: getComputedStyle(document.querySelector('.tb-ohne')).display }))
    await page.fill('#tb-pin', PIN.ana)
    await page.click('button.tb-ohne')
    await page.waitForSelector('.tb-name')
    check('Ohne Skript: PIN-Feld mit „Weiter“, Zifferntasten ausgeblendet, es geht trotzdem', plain.type === 'password' && plain.keys === 'none' && plain.button !== 'none' && (await page.textContent('.tb-name')) === 'Hallo Ana Popescu!', JSON.stringify(plain))
    await ctx.close()
  }

  // ---------------------------------------------------------------- Tablet entfernt, neuer Link
  a = await api('A', 'einrichten', settings({ [sha(T2)]: BOTH[sha(T2)] }))
  r = await call('A', 'tablet=1', { cookie: T1 })
  check('Im Büro entferntes Tablet (oder neuer Link): das Gerät ist keine Stempeluhr mehr', a.status === 200 && r.status === 403 && /nicht \(mehr\) als Stempeluhr eingerichtet/.test(r.text) && !/data-z=/.test(r.html), `${a.status} ${r.status}`)
  r = await call('A', 'tablet=1&aktion=pin', { cookie: T1, form: { pin: PIN.maria } })
  check('Am entfernten Tablet gilt keine PIN mehr', r.status === 403 && !/Hallo/.test(r.text))
  a = await api('A', 'zeiten&seit=0')
  check('Die App sieht nur noch das verbliebene Tablet', a.json.tablets.length === 1 && a.json.tablets[0].objektId === 'o2')
  const cfg = settings(BOTH)
  delete cfg.zeiterfassung.tablet
  a = await api('A', 'einrichten', cfg)
  r = await call('A', 'tablet=1', { cookie: T2 })
  check('Ohne Stempeluhr in den Einstellungen: keine Tablet-Seite, QR-Zeiterfassung unberührt', r.status === 403 && (await call('A', `o=${QR}`, { person: P_MARIA })).status === 200)
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
ntfy.close()
for (const s of servers) s.kill()
await finish(browser, [], errors)
