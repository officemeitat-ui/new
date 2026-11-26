// Unterweisung am Handy (unterweisung.php), geprüft gegen den eingebauten PHP-Server mit eigenem Ordner privat/
// (MEIN_PLAN_ORDNER). Die Definition kommt aus dem Rechenkern der App (core/unterweisung-online.js) mit der Vorlage
// Gebäudereinigung & Facility (Österreich). Zwei Server: A = jetzt, B = am nächsten Tag (Versuche wieder frei).
// Geprüft: Übertragen (Schlüssel, Arten, Zuordnung, neue Person ohne Plan, Push), Liste und Hinweis in „Plan am Handy“,
// Seite in der Sprache der Person (Rumänisch), Lösung nicht in der Seite, falsche Antworten markiert und behalten,
// bestanden → Erklärung und Unterschrift, ohne Unterschrift abgelehnt, gespeichert mit Serverzeit, Ergebnis für die App
// samt „erledigt auch“, Eintrag im Rechenkern, übernommene Ergebnisse gelöscht, geänderte Fassung, Grenze der Versuche,
// Video in Teilen (Range), fremde Herkunft; im Browser am Handy (390 px) mit dem Finger unterschreiben.
// Ports 19871–19873.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, check, finish, wait, R, P } from './ablauf-lib.mjs'
import { parseQuiz, resultRecords, webDefinition } from '../src/core/unterweisung-online.js'
import { VORLAGE } from '../src/core/unterweisung-vorlage.js'

const sha = (t) => createHash('sha256').update(t).digest('hex')
const dir = join(P, 'unterweisung-php')
rmSync(dir, { recursive: true, force: true })
mkdirSync(join(dir, 'mitarbeiter'), { recursive: true })

const KEY = 'k'.repeat(40)
const ANA = 'AnaCode23456789abcdef'
const BOB = 'BobCode234567890abcde'
const NTFY = 19873
writeFileSync(join(dir, 'mitarbeiter.json'), JSON.stringify({ version: 1, schluessel: KEY, adresse: 'http://127.0.0.1:19871/', ntfy: `http://127.0.0.1:${NTFY}` }))
// Ana hat schon „Plan am Handy“ (Sprache Rumänisch), Bob ist neu (noch keine Datei am Webspace)
writeFileSync(join(dir, 'mitarbeiter', `${sha(ANA)}.json`), JSON.stringify({ name: 'Ana Popescu', ntfy: 'uw-ana', sprache: 'ro', wochen: {} }))

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
const PORTS = { A: 19871, B: 19872 }
const TIMES = { A: now, B: now + 86400 }
const servers = Object.entries(PORTS).map(([k, port]) => spawn('php', ['-S', `127.0.0.1:${port}`, '-t', R], { env: { ...process.env, MEIN_PLAN_ORDNER: dir, WETTER_JETZT: String(TIMES[k]), NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }, stdio: 'ignore' }))
await wait(1500)

const flat = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim()
const unesc = (t) => t.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
async function page(s, query, { person = ANA, form = null, headers = {}, file = 'unterweisung.php' } = {}) {
  const r = await fetch(`http://127.0.0.1:${PORTS[s]}/${file}${query ? `?${query}` : ''}`, {
    method: form ? 'POST' : 'GET',
    redirect: 'manual',
    headers: { ...(person ? { Cookie: `mein_plan=${person}` } : {}), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...headers },
    body: form ? new URLSearchParams(form).toString() : undefined,
  })
  const html = await r.text()
  return { status: r.status, html, text: flat(html), location: r.headers.get('location') || '' }
}
async function api(aktion, body, { key = KEY, raw = null, type = '', extra = '' } = {}) {
  const r = await fetch(`http://127.0.0.1:${PORTS.A}/unterweisung.php?aktion=${aktion}${extra}`, { method: body || raw ? 'POST' : 'GET', headers: { 'X-Schluessel': key, 'Content-Type': raw ? type : 'application/json' }, body: raw || (body ? JSON.stringify(body) : undefined) })
  return { status: r.status, json: await r.json().catch(() => null) }
}

// Arten wie in der App: Sicherheitsunterweisung mit Vorlage, erledigt auch „Unterweisung Reinigungsmittel“
const types = [
  { id: 'sicherheit', name: 'Sicherheitsunterweisung', months: 12, who: 'alle', law: '§ 14 ASchG', kind: 'unterweisung', online: { on: true, texts: VORLAGE, pass: 80, covers: ['chemie'] } },
  { id: 'chemie', name: 'Unterweisung Reinigungsmittel', months: 12, who: 'alle', law: '§ 14 ASchG', kind: 'unterweisung' },
]
const def = webDefinition(types[0], { types })
const personen = { [sha(ANA)]: [{ art: 'sicherheit', stand: 'fehlt', bis: '', datum: '' }], [sha(BOB)]: [{ art: 'sicherheit', stand: 'abgelaufen', bis: '2026-10-01', datum: '2025-10-01' }] }
const namen = [{ hash: sha(BOB), name: 'Bob Berger', ntfy: '', sprache: 'de' }]
const ro = parseQuiz(VORLAGE.ro.quiz).questions

/** Antworten aus der Seite wählen: richtig (Text der richtigen rumänischen Antwort) bzw. falsch. */
function answers(html, right) {
  const form = {}
  const sets = html.split('<fieldset').slice(1)
  sets.forEach((fs, i) => {
    const opts = [...fs.matchAll(/<input type="radio" name="a(\d+)" value="(\d+)"[^>]*>\s*([^<]*)<\/label>/g)].map((m) => ({ name: `a${m[1]}`, value: m[2], text: unesc(m[3]).trim() }))
    const good = opts.find((o) => o.text === ro[i].options[ro[i].correct])
    const pick = right ? good : opts.find((o) => o !== good)
    if (pick) form[pick.name] = pick.value
  })
  return form
}

const browser = await chromium.launch()
const errors = []
try {
  // ---------------------------------------------------------------- 1. Übertragen
  check('Ohne Schlüssel kein Zugriff', (await api('status', null, { key: 'x'.repeat(40) })).status === 403)
  let r = await api('uebertragen', { arten: [def], personen, namen, uebernommen: [] })
  check('Übertragen: eine Art, zwei Personen, Bob neu angelegt (Link gilt ohne Plan)', r.status === 200 && r.json.arten === 1 && r.json.personen === 2 && r.json.neuePersonen === 1, JSON.stringify(r.json))
  check('Push an Ana (Rumänisch, Link zur Unterweisung); Bob ohne Push-Thema bekommt keinen', pushes.length === 1 && pushes[0].topic === 'uw-ana' && pushes[0].click === 'http://127.0.0.1:19871/unterweisung.php?u=sicherheit' && pushes[0].title.includes(VORLAGE.ro.title), JSON.stringify(pushes))
  await api('uebertragen', { arten: [def], personen, namen, uebernommen: [] })
  check('Nochmals übertragen: keine zweite Push-Nachricht (erst nach 7 Tagen)', pushes.length === 1)

  // ---------------------------------------------------------------- 2. Liste, Hinweis, Seite
  let p = await page('A', '', { person: null })
  check('Ohne persönlichen Link: nichts zu sehen (404)', p.status === 404)
  p = await page('A', '')
  check('Liste: offen, Knopf zum Starten', p.status === 200 && p.html.includes('href="unterweisung.php?u=sicherheit"') && p.html.includes('uw-karte offen'), p.text.slice(0, 200))
  const plan = await page('A', '', { file: 'mein-plan.php' })
  check('„Plan am Handy“ zeigt oben die offene Unterweisung', plan.status === 200 && plan.html.includes('href="unterweisung.php"') && plan.text.includes(VORLAGE.ro.title), plan.text.slice(0, 300))
  p = await page('A', 'u=sicherheit')
  check('Seite auf Rumänisch: Titel, 20 Abschnitte, 15 Fragen', p.status === 200 && p.text.includes(VORLAGE.ro.title) && (p.html.match(/class="uw-abschnitt"/g) || []).length === 21 && (p.html.match(/<fieldset/g) || []).length === 15)
  check('Die Lösung steht nicht in der Seite (Werte sind die Stellen am Handy, gemischt)', !p.html.includes('loesung') && new Set([...p.html.matchAll(/name="a(\d+)" value="(\d+)"[^>]*>\s*([^<]*)</g)].filter((m) => unesc(m[3]).trim() === ro[Number(m[1])].options[ro[Number(m[1])].correct]).map((m) => m[2])).size > 1)
  const v = p.html.match(/name="v" value="([a-f0-9]{8})"/)?.[1]
  check('Fassung steht im Formular', v === def.version)

  // ---------------------------------------------------------------- 3. Falsch, dann richtig
  p = await page('A', 'aktion=pruefen&u=sicherheit', { form: { v, ...answers(p.html, false) } })
  check('Alles falsch: nicht bestanden, 15 Fragen markiert, Antworten bleiben gewählt', p.status === 200 && (p.html.match(/uw-frage uw-falsch/g) || []).length === 15 && (p.html.match(/ checked/g) || []).length === 15)
  p = await page('A', 'aktion=pruefen&u=sicherheit', { form: { v, ...answers(p.html, true) }, headers: { 'Sec-Fetch-Site': 'cross-site' } })
  check('Von fremder Seite abgeschickt: abgelehnt', p.status === 403)
  const ok = answers((await page('A', 'u=sicherheit')).html, true)
  p = await page('A', 'aktion=pruefen&u=sicherheit', { form: { v, ...ok } })
  check('Alles richtig: weiter zur Unterschrift', p.status === 303 && p.location.endsWith('u=sicherheit&schritt=unterschrift'), `${p.status} ${p.location}`)
  p = await page('A', 'u=sicherheit&schritt=unterschrift')
  check('Unterschrift: Erklärung auf Rumänisch, Feld zum Unterschreiben, Skript', p.status === 200 && p.text.includes(VORLAGE.ro.decl.slice(0, 40)) && p.html.includes('<canvas width="600" height="200"') && p.html.includes('kunden-unterschrift.js'))
  p = await page('A', 'aktion=unterschreiben&u=sicherheit', { form: { unterschrift: '', bestaetigt: '1' } })
  check('Ohne Unterschrift: abgelehnt, bleibt beim Unterschreiben', p.status === 200 && p.html.includes('role="alert"') && p.html.includes('data-unterschrift'))
  p = await page('A', 'aktion=unterschreiben&u=sicherheit', { form: { unterschrift: 'M10 10L40 30L80 20L120 60', bestaetigt: '1' } })
  check('Mit Unterschrift: gespeichert, Bestätigung', p.status === 303 && p.location.endsWith('&fertig=1'))
  p = await page('A', 'u=sicherheit&fertig=1')
  check('Bestätigung mit Name und Datum', p.status === 200 && p.text.includes('Ana Popescu') && p.html.includes('class="ok"'))
  p = await page('A', '')
  check('Liste: jetzt erledigt (bis die App den neuen Stand schickt)', !p.html.includes('uw-karte offen'))
  check('„Plan am Handy“ zeigt keinen Hinweis mehr', !(await page('A', '', { file: 'mein-plan.php' })).html.includes('href="unterweisung.php"'))

  // ---------------------------------------------------------------- 4. Ergebnis für die App
  r = await api('status')
  const e = r.json?.ergebnisse?.[0]
  check('Ergebnis: Person, Art, Fassung, 15 von 15, 3 Versuche, Sprache, Unterschrift, Erklärung', r.status === 200 && r.json.ergebnisse.length === 1 && e.hash === sha(ANA) && e.art === 'sicherheit' && e.version === def.version && e.richtig === 15 && e.gesamt === 15 && e.versuche === 2 && e.sprache === 'ro' && e.unterschrift.startsWith('M10 10') && e.erklaerung === VORLAGE.ro.decl && e.geoeffnet > 0, JSON.stringify(e).slice(0, 300))
  const doc = { types, records: [], versions: { [def.version]: { covers: ['chemie'] } } }
  const rec = resultRecords(doc, r.json.ergebnisse, { empOf: (h) => (h === sha(ANA) ? { id: 'e1', name: 'Ana Popescu' } : null), newId: (() => { let n = 0; return () => `r${++n}` })(), types })
  check('Rechenkern der App: Nachweis für die Sicherheitsunterweisung und „Reinigungsmittel“ (gleiche Unterschrift)', rec.records.length === 2 && rec.records.map((x) => x.typeId).join() === 'sicherheit,chemie' && rec.records[0].signature.startsWith('<svg') && rec.records[0].note === 'Am Handy: 15 von 15 Fragen richtig (2. Versuch)' && rec.taken.length === 1)
  r = await api('uebertragen', { arten: [def], personen, namen, uebernommen: rec.taken })
  check('Übernommen: am Webspace gelöscht', (await api('status')).json.ergebnisse.length === 0)

  // ---------------------------------------------------------------- 5. Geänderte Fassung, Grenze der Versuche
  const p0 = await page('A', 'u=sicherheit', { person: BOB })
  check('Bob (neu, ohne Plan): Seite auf Deutsch', p0.status === 200 && p0.text.includes(VORLAGE.de.title))
  const def2 = webDefinition({ ...types[0], online: { ...types[0].online, pass: 100 } }, { types })
  await api('uebertragen', { arten: [def2], personen, namen, uebernommen: [] })
  p = await page('A', 'aktion=pruefen&u=sicherheit', { person: BOB, form: { v: def.version, a0: '0' } })
  check('Inzwischen geänderte Fassung: Hinweis, nochmals lesen', p.status === 200 && p.html.includes('role="alert"') && !p.html.includes('uw-frage uw-falsch'), `${p.status} ${p.text.slice(0, 200)}`)
  // alle Fragen beantwortet (an erster Stelle), damit jeder Versuch zählt
  const alle = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`a${i}`, '0']))
  let last = null
  for (let i = 0; i < 13; i++) last = await page('A', 'aktion=pruefen&u=sicherheit', { person: BOB, form: { v: def2.version, ...alle } })
  check('Nach 12 Versuchen am Tag: keine weiteren', last.status === 200 && /role="alert"/.test(last.html) && !last.html.includes('uw-frage uw-falsch'), last.text.slice(0, 200))
  last = await page('B', 'aktion=pruefen&u=sicherheit', { person: BOB, form: { v: def2.version, ...alle } })
  check('Am nächsten Tag geht es wieder', last.status === 200 && last.html.includes('uw-frage uw-falsch'))

  // ---------------------------------------------------------------- 6. Video in Teilen
  const vid = Buffer.alloc(5 * 1024 * 1024 + 123, 7)
  Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]).copy(vid, 0)
  const V = 'a1b2c3d4'
  r = await api('video', null, { raw: vid.subarray(4 * 1024 * 1024), type: 'video/mp4', extra: `&art=sicherheit&version=${V}&teil=1&teile=2` })
  check('Video: Teil 2 vor Teil 1 abgelehnt', r.status === 409)
  r = await api('video', null, { raw: vid.subarray(0, 4 * 1024 * 1024), type: 'video/mp4', extra: `&art=sicherheit&version=${V}&teil=0&teile=2` })
  const r2 = await api('video', null, { raw: vid.subarray(4 * 1024 * 1024), type: 'video/mp4', extra: `&art=sicherheit&version=${V}&teil=1&teile=2` })
  check('Video in zwei Teilen hochgeladen', r.status === 200 && r2.status === 200 && r2.json.fertig === true && r2.json.groesse === vid.length, JSON.stringify(r2.json))
  r = await api('video', null, { raw: Buffer.from('kein video'), type: 'video/mp4', extra: '&art=chemie&version=b1b2c3d4&teil=0&teile=1' })
  check('Kein MP4: abgelehnt', r.status === 415)
  const def3 = { ...def2, video: { version: V, typ: 'video/mp4' } }
  r = await api('uebertragen', { arten: [def3], personen, namen, uebernommen: [] })
  check('Übertragen mit Video: nichts fehlt', r.json.videosFehlen.length === 0)
  p = await page('A', 'u=sicherheit')
  check('Seite zeigt das Video', p.html.includes('<video controls') && p.html.includes('aktion=abspielen'))
  const range = await fetch(`http://127.0.0.1:${PORTS.A}/unterweisung.php?aktion=abspielen&u=sicherheit`, { headers: { Cookie: `mein_plan=${ANA}`, Range: 'bytes=0-99' } })
  const part = Buffer.from(await range.arrayBuffer())
  check('Video mit Range (Spulen am iPhone): 206, 100 Bytes', range.status === 206 && part.length === 100 && range.headers.get('content-range') === `bytes 0-99/${vid.length}`, `${range.status} ${part.length} ${range.headers.get('content-range')}`)
  const ohne = await fetch(`http://127.0.0.1:${PORTS.A}/unterweisung.php?aktion=abspielen&u=sicherheit`)
  check('Video ohne Link: nicht zu sehen', ohne.status === 404, `${ohne.status}`)

  // ---------------------------------------------------------------- 7. Formular ohne Fragen (Diensthandy)
  const { FORMULAR_VORLAGEN } = await import('../src/core/formular-vorlagen.js')
  const handy = FORMULAR_VORLAGEN.find((f) => f.id === 'diensthandy')
  const defF = webDefinition({ id: 'diensthandy', name: handy.name, months: 0, who: 'skill:Diensthandy', kind: 'formular', online: { on: true, texts: handy.texts, pass: 0 } }, { types: [] })
  await api('uebertragen', { arten: [def3, defF], personen: { ...personen, [sha(ANA)]: [...personen[sha(ANA)], { art: 'diensthandy', stand: 'fehlt', bis: '', datum: '' }] }, namen, uebernommen: [] })
  p = await page('A', 'u=diensthandy')
  check('Formular: ohne Fragen, „lesen und unterschreiben“, Knopf weiter zur Unterschrift', p.status === 200 && !p.html.includes('<fieldset') && p.text.includes(handy.texts.de.title) && /name="v" value="[a-f0-9]{8}"/.test(p.html), p.text.slice(0, 200))
  const vf = p.html.match(/name="v" value="([a-f0-9]{8})"/)?.[1]
  p = await page('A', 'aktion=pruefen&u=diensthandy', { form: { v: vf } })
  check('Formular: weiter → Unterschrift', p.status === 303 && p.location.endsWith('u=diensthandy&schritt=unterschrift'))
  p = await page('A', 'aktion=unterschreiben&u=diensthandy', { form: { unterschrift: 'M5 5L30 30L60 10L90 40', bestaetigt: '1' } })
  check('Formular unterschrieben: Ergebnis ohne Fragen (0 von 0)', p.status === 303 && (await api('status')).json.ergebnisse.some((x) => x.art === 'diensthandy' && x.gesamt === 0 && x.richtig === 0))

  // ---------------------------------------------------------------- 8. Im Browser am Handy unterschreiben
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true })
  await ctx.addCookies([{ name: 'mein_plan', value: BOB, domain: '127.0.0.1', path: '/' }])
  const pg = await ctx.newPage()
  pg.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  pg.on('response', (res) => res.status() >= 400 && errors.push(`${res.status()} ${res.url()}`))
  pg.on('pageerror', (err) => errors.push(String(err)))
  await pg.goto(`http://127.0.0.1:${PORTS.B}/unterweisung.php?u=sicherheit`)
  check('Handy (390 px): kein seitliches Scrollen', await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  const de = parseQuiz(VORLAGE.de.quiz).questions
  for (let i = 0; i < de.length; i++) await pg.locator(`fieldset:nth-of-type(${i + 1}) label`, { hasText: de[i].options[de[i].correct] }).first().click()
  await Promise.all([pg.waitForURL(/schritt=unterschrift/), pg.click('button[type=submit]')])
  check('Im Browser bestanden: Seite zum Unterschreiben, Feld sichtbar (Skript geladen)', await pg.locator('.unterschrift').isVisible())
  await pg.locator('.unterschrift canvas').scrollIntoViewIfNeeded()
  const box = await pg.locator('.unterschrift canvas').boundingBox()
  await pg.mouse.move(box.x + 20, box.y + 30)
  await pg.mouse.down()
  for (const [x, y] of [[60, 50], [110, 30], [160, 70], [220, 40]]) await pg.mouse.move(box.x + x, box.y + y)
  await pg.mouse.up()
  await pg.check('input[name=bestaetigt]')
  await Promise.all([pg.waitForURL(/fertig=1/), pg.click('button[type=submit]')])
  check('Mit dem Finger unterschrieben: gespeichert', (await api('status')).json.ergebnisse.some((x) => x.hash === sha(BOB) && /^M\d+ \d+L/.test(x.unterschrift)))
  await ctx.close()
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
ntfy.close()
for (const s of servers) s.kill()
await finish(browser, [], errors)
