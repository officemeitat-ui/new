// Stempeluhr am Tablet (core/stempeluhr.js): PINs, Einstellungen für den Webspace (nur Hashwerte), Nachricht mit der PIN,
// Stempelungen mit Quelle „Tablet“; dazu die Regeln der Seite mein-plan.php, soweit sie am Quelltext prüfbar sind.
// Der Ablauf am Tablet selbst läuft gegen echtes PHP in pruefung/stempel_tablet_php.mjs. Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

import { completePins, newPin, PIN_LENGTH, PIN_MESSAGE_LANGS, pinMessage, seenText, tabletFile, tabletLink, weakPin } from '../src/core/stempeluhr.js'
import { LANGUAGES } from '../src/core/sprachen.js'
import { PORTAL_DEFAULTS, portalFile } from '../src/core/staffplan.js'
import { fromServer, mergeStamps } from '../src/core/timeclock.js'
import { mayWhatsApp } from '../src/core/whatsapp.js'
import { tabletSheetDocument } from '../src/export/qr-pdf.js'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const sha = (t) => createHash('sha256').update(t).digest('hex')
const KEY = 'k'.repeat(64)

test('PIN: vier Ziffern, erste nicht 0, nicht leicht zu erraten, jede nur einmal', () => {
  for (const weak of ['1111', '1212', '1221', '1234', '4321', '2468', '9753', '1987', '2026', '0123', '12', 'abcd']) assert.equal(weakPin(weak), true, weak)
  for (const ok of ['4821', '7395', '6274', '9053', '1047']) assert.equal(weakPin(ok), false, ok)
  const taken = new Set()
  for (let i = 0; i < 400; i++) {
    const pin = newPin(taken)
    assert.match(pin, /^[1-9]\d{3}$/)
    assert.equal(pin.length, PIN_LENGTH)
    assert.equal(weakPin(pin), false, pin)
    assert.ok(!taken.has(pin), `${pin} doppelt`)
    taken.add(pin)
  }
})

test('PIN: Zufall, der immer dasselbe liefert, endet mit einem Fehler statt in einer Endlosschleife', () => {
  const same = () => new Uint8Array([0x12, 0x34]) // 4660 → 5660
  assert.equal(newPin(new Set(), same), '5660')
  assert.throws(() => newPin(new Set(['5660']), same), /Keine freie PIN/)
  assert.throws(() => newPin(new Set(), () => new Uint8Array([0xff, 0xff])), /Keine freie PIN/, 'Werte über 63000 werden verworfen (gleiche Verteilung)')
})

test('PINs ergänzen: gültige bleiben, doppelte und ungültige werden ersetzt, PINs anderer fallen weg', () => {
  const out = completePins({ a: '4821', b: '4821', c: '0123', d: 'x', weg: '7395' }, ['a', 'b', 'c', 'd', 'neu'])
  assert.equal(out.a, '4821')
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b', 'c', 'd', 'neu'])
  assert.equal(new Set(Object.values(out)).size, 5, 'jede PIN nur einmal')
  for (const pin of Object.values(out)) assert.match(pin, /^[1-9]\d{3}$/)
  assert.deepEqual(completePins({ a: '4821' }, []), {})
  assert.deepEqual(completePins(undefined, ['a']).a.length, 4)
})

test('Einstellungen für den Webspace: nur Hashwerte von Codes und PINs, Name und Objekt im Klartext', async () => {
  const portal = { key: KEY, codes: { e1: 'MariaCode23456789abcd', e2: 'AnaCode23456789abcdef' }, pins: { e1: '4821', e2: '7395', e3: '6274', e4: 'falsch' }, tablets: { o1: 'TabletCodeEins234567', weg: 'TabletCodeFort234567', o2: 'kurz' } }
  const employees = [{ id: 'e1', name: 'Maria Huber' }, { id: 'e2', name: 'Ana Popescu' }, { id: 'e3', name: 'Ohne Link' }, { id: 'e4', name: 'Ohne gültige PIN' }]
  const objects = [{ id: 'o1', name: 'Autohaus Maxglan' }, { id: 'o2', name: 'Wohnanlage Lehen' }]
  const t = await tabletFile({ portal, employees, objects })
  assert.deepEqual(t.geraete, { [sha('TabletCodeEins234567')]: { id: 'o1', name: 'Autohaus Maxglan' } }, 'gelöschtes Objekt und zu kurzer Code fallen weg')
  assert.deepEqual(t.pins, {
    [sha(`${KEY}:4821`)]: { hash: sha('MariaCode23456789abcd'), name: 'Maria Huber' },
    [sha(`${KEY}:7395`)]: { hash: sha('AnaCode23456789abcdef'), name: 'Ana Popescu' },
  })
  assert.equal(t.pinLaenge, 4)
  const json = JSON.stringify(t)
  for (const secret of ['TabletCodeEins234567', 'MariaCode23456789abcd', '4821', '7395', KEY]) assert.ok(!json.includes(secret), `${secret} steht nicht in der Datei`)
  assert.equal(await tabletFile({ portal: { ...portal, tablets: {} }, employees, objects }), null, 'ohne Tablet kein Abschnitt')
  assert.equal(await tabletFile({ portal: { ...portal, key: '' }, employees, objects }), null)
  // mein-plan.php rechnet den Hashwert der PIN genauso
  assert.match(read('mein-plan.php'), /hash\('sha256', \$e\['schluessel'\] \. ':' \. \$pin\)/)
  assert.match(read('mein-plan.php'), /\$tb\['geraete'\]\[hash\('sha256', \$wert\)\]/)
})

test('Einrichtungs-Datei: Abschnitt „tablet“ nur mit Zeiterfassung; Standardwerte ohne Tablets und PINs', () => {
  const tablet = { pinLaenge: 4, geraete: { abc: { id: 'o1', name: 'Autohaus' } }, pins: {} }
  const base = { address: 'https://app.example/', ntfy: 'https://ntfy.sh', objects: [{ id: 'o1', name: 'Autohaus' }], tablet }
  const on = portalFile({ ...base, portal: { key: KEY, timeclock: true, alarmMin: 20, cronKey: 'c'.repeat(32), objectTokens: { o1: 'QRTOKEN12345' } } })
  assert.deepEqual(on.zeiterfassung.tablet, tablet)
  assert.deepEqual(on.zeiterfassung.objekte, { QRTOKEN12345: { id: 'o1', name: 'Autohaus' } }, 'der QR-Code bleibt daneben bestehen')
  const off = portalFile({ ...base, portal: { key: KEY, timeclock: false } })
  assert.equal(off.zeiterfassung, undefined)
  assert.equal(portalFile({ ...base, tablet: null, portal: { key: KEY, timeclock: true } }).zeiterfassung.tablet, undefined)
  assert.deepEqual([PORTAL_DEFAULTS.tablets, PORTAL_DEFAULTS.pins], [{}, {}])
})

test('Stempelung vom Tablet: Quelle bleibt erhalten, vom Handy ohne Vermerk', () => {
  const r = { id: 'a1b2c3d4e5f6', hash: 'h1', name: 'Maria Huber', objektId: 'o1', objekt: 'Autohaus', einsatz: '2026-11-25|t1', plan: '06:00–09:00', datum: '2026-11-25', kommen: 1795600000, gehen: null, geaendert: 1795600000 }
  const index = new Map([['h1', 'e1']])
  assert.equal(fromServer({ ...r, quelle: 'tablet' }, index).via, 'tablet')
  assert.equal('via' in fromServer(r, index), false)
  assert.equal('via' in fromServer({ ...r, quelle: 'sonstwas' }, index), false)
  const stamps = {}
  assert.equal(mergeStamps(stamps, [{ ...r, quelle: 'tablet' }], index), 1)
  assert.equal(mergeStamps(stamps, [{ ...r, quelle: 'tablet', gehen: 1795610000, geaendert: 1795610000 }], index), 1, '„Gehen“ kommt als Änderung nach')
  const s = stamps['2026-11-25|za1b2c3d4e5f6']
  assert.equal(s.via, 'tablet')
  assert.equal(s.empId, 'e1')
  assert.ok(s.out)
})

test('Zustand eines Tablets: noch nicht geöffnet, aktiv, zuletzt vor …; Warnung erst nach zwei Tagen', () => {
  const now = 1_800_000_000
  assert.deepEqual(seenText(0, now), { text: 'noch nicht geöffnet', tone: 'info' })
  assert.deepEqual(seenText(undefined, now), { text: 'noch nicht geöffnet', tone: 'info' })
  assert.deepEqual(seenText(now - 5 * 60, now), { text: 'aktiv', tone: 'ok' })
  assert.deepEqual(seenText(now - 45 * 60, now), { text: 'zuletzt vor 45 Minuten', tone: 'ok' })
  assert.deepEqual(seenText(now - 14 * 3600, now), { text: 'zuletzt vor 14 Stunden', tone: 'info' }, 'über Nacht ist kein Grund zur Sorge')
  assert.deepEqual(seenText(now - 3 * 86400, now), { text: 'zuletzt vor 3 Tagen', tone: 'warning' })
  assert.equal(seenText(now + 500, now).text, 'aktiv', 'Uhr des Büro-PCs geht nach')
})

test('Nachricht mit der PIN: alle Sprachen der App, mit Name, PIN und den Knöpfen der Seite', () => {
  assert.deepEqual([...PIN_MESSAGE_LANGS].sort(), LANGUAGES.map((l) => l.id).sort())
  const page = read('mein-plan-texte.php')
  const block = (lang) => page.slice(page.indexOf(`    '${lang}' => [`), page.indexOf("\n    ],", page.indexOf(`    '${lang}' => [`)))
  const textOf = (lang, key) => block(lang).match(new RegExp(`'${key}' => '([^']*)'`))?.[1]
  for (const lang of PIN_MESSAGE_LANGS) {
    const m = pinMessage(lang, { name: 'Maria', pin: '4821', product: 'Cleanos App' })
    assert.ok(m.subject.length > 5 && !/\{/.test(m.subject + m.text), `${lang}: keine offenen Platzhalter`)
    assert.ok(m.text.includes('Maria') && m.text.includes('4821') && m.text.includes('Cleanos App'), lang)
    assert.ok(m.text.includes(textOf(lang, 'kommen_knopf')), `${lang}: „${textOf(lang, 'kommen_knopf')}“ wie am Tablet`)
    assert.ok(m.text.includes(textOf(lang, 'gehen_knopf')), `${lang}: „${textOf(lang, 'gehen_knopf')}“ wie am Tablet`)
    assert.ok(m.text.length < 600, `${lang}: kurz genug für WhatsApp`)
  }
  assert.equal(pinMessage('xx', { name: 'A', pin: '1', product: 'P' }).subject, pinMessage('de', { name: 'A', pin: '1', product: 'P' }).subject)
  assert.equal(mayWhatsApp('tablet-pin'), true, 'die PIN darf per WhatsApp an die Person')
})

test('Einrichtungs-Link und Blatt: Link als QR-Code, Warnung „nicht aufhängen“', () => {
  assert.equal(tabletLink('https://app.example/app', 'TabletCodeEins234567'), 'https://app.example/app/mein-plan.php?tablet=TabletCodeEins234567')
  assert.equal(tabletLink('https://app.example/app/', 'a b'), 'https://app.example/app/mein-plan.php?tablet=a%20b')
  const doc = tabletSheetDocument({ object: { name: 'Autohaus Maxglan', address: 'Autoweg 7, 5020 Salzburg' }, link: 'https://app.example/mein-plan.php?tablet=TabletCodeEins234567', brand: { name: 'Cleanos' } })
  const json = JSON.stringify(doc)
  assert.ok(json.includes('"qr":"https://app.example/mein-plan.php?tablet=TabletCodeEins234567"'))
  assert.ok(json.includes('Autohaus Maxglan') && json.includes('Autoweg 7'))
  assert.match(json, /nicht im Objekt aufhängen/)
  assert.match(json, /Nach dem Einrichten vernichten/)
})

test('mein-plan.php: Regeln der Stempeluhr am Quelltext', () => {
  const php = read('mein-plan.php')
  const num = (name) => Number(php.match(new RegExp(`const ${name} = (\\d+);`))?.[1])
  assert.ok(num('TABLET_TICKET') > 0 && num('TABLET_TICKET') < 60, 'Ticket kürzer als die Minute, in der zweimal Tippen einmal zählt')
  assert.equal(num('TABLET_FEHLER'), 5)
  assert.equal(num('TABLET_SPERRE'), 300)
  const part = php.slice(php.indexOf("if (isset($_GET['tablet'])) {"), php.indexOf("$code = (string) ($_GET['p']"))
  assert.ok(part.length > 2000)
  assert.equal(part.split('fremde_herkunft()').length - 1, 2, 'PIN und Stempeln: nur vom eigenen Formular')
  assert.match(part, /hash_equals|tablet_siegel_lesen/)
  assert.ok(!/\$_COOKIE\[COOKIE\]/.test(part), 'die Stempeluhr benutzt nie den persönlichen Link eines Handys')
  assert.match(php, /hash_equals\(hash_hmac\('sha256', \$roh, 'tablet:' \. \$e\['schluessel'\]\), \$sig\)/, 'Signatur in gleichbleibender Zeit verglichen')
  assert.match(part, /'httponly' => true, 'samesite' => 'Lax'/)
  // richtige PIN setzt den Zähler falscher PINs nicht zurück (sonst ließe sich mit der eigenen PIN weiterraten)
  const pin = part.slice(part.indexOf("if ($aktion === 'pin'"), part.indexOf("if ($aktion === 'stempeln'"))
  assert.ok(pin.indexOf("return ['ok', false, 0];") < pin.indexOf("$g['fehl'][] = jetzt();"))
  assert.ok(!/\$g\['fehl'\] = \[\];[^}]*return \['ok'/.test(pin))
  // Skript geht mit dem Paket mit
  assert.match(read('scripts/build.js'), /'mein-plan\.php', 'mein-plan-tablet\.js'/)
  const js = read('mein-plan-tablet.js')
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(js), 'am gemeinsamen Gerät wird nichts gespeichert')
})
