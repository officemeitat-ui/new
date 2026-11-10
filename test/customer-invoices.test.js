// Fakturierung im Kundenbereich (core/customer-invoices.js, kunden.php): welche Belege ein Link zeigt, Stand und
// Zahlungsdaten, QR-Code mit dem Kodierer des PDF, Online-Annahme von Angeboten (wer darf, was an den Webspace
// geht, Annahme außerhalb der Prüfsumme), gleiche Muster in PHP.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { acceptanceOf, acceptedOpen, collectedByDebit, INVOICE_FILE_PATTERN, invoiceDefaults, invoiceEntry, invoiceFile, invoiceQrPayload, invoiceSettings, invoiceSigText, isConsumer, newAcceptances, newOfferId, OFFER_ID_PATTERN, offerLink, offerMail, offerPayload, onlineActive, onlineCheck, portalDocuments, portalState, PORTAL_STATES, qrMatrixFromCanvas, SIGNATURE_PATTERN, signatureOk, sinceDate, suggestCustomers, withdrawNeeded } from '../src/core/customer-invoices.js'
import { linkMail, linkPayload, SHOW, showDefaults } from '../src/core/customer-portal.js'
import { checksumOf, epcPayload, finalize, intact, stornoDraft } from '../src/core/invoicing.js'

const PHP = readFileSync(new URL('../kunden.php', import.meta.url), 'utf8')
const { measure } = createRequire(import.meta.url)('pdfmake/src/qrEnc.js')

const TODAY = '2026-11-06'
const SETTINGS = {
  sender: { name: 'Gebäudereinigung Beispiel GmbH', address: 'Musterstraße 1\n5020 Salzburg', uid: 'ATU12345678' },
  bank: { iban: 'AT611904300234573201', bic: 'BKAUATWW', name: 'Bank Beispiel' },
}
const REC = { name: 'Hausverwaltung Beispiel GmbH', address: 'Ringstraße 3\n5020 Salzburg', uid: 'ATU87654321' }
const line = (price, qty = 1) => ({ id: `l${price}`, text: 'Unterhaltsreinigung', qty, unit: 'Monat', price, vat: 20 })
function docs() {
  const list = []
  const add = (d, extra = {}) => {
    const x = { ...finalize({ status: 'entwurf', recipient: REC, serviceFrom: d.date, serviceTo: d.date, lines: [line(d.price ?? 100)], ...d }, list, SETTINGS, { now: `${d.date}T09:00:00.000Z` }), ...extra }
    list.push(x)
    return x
  }
  add({ id: 'a-paid', kind: 'rechnung', date: '2026-09-02', dueDate: '2026-09-16', customerId: 'c1', price: 980 }, { payments: [{ id: 'p1', date: '2026-09-10', amount: 1176 }] })
  add({ id: 'a-open', kind: 'rechnung', date: '2026-10-02', dueDate: '2026-11-16', customerId: 'c1', price: 980 })
  add({ id: 'a-partial', kind: 'rechnung', date: '2026-10-05', dueDate: '2026-11-20', customerId: 'c1', price: 500 }, { payments: [{ id: 'p2', date: '2026-10-20', amount: 200 }] })
  add({ id: 'a-overdue', kind: 'rechnung', date: '2026-10-01', dueDate: '2026-10-15', customerId: 'c1', price: 100 })
  add({ id: 'a-old-paid', kind: 'rechnung', date: '2025-06-10', dueDate: '2025-06-24', customerId: 'c1', price: 100 }, { payments: [{ id: 'p3', date: '2025-06-20', amount: 120 }] })
  add({ id: 'a-old-open', kind: 'rechnung', date: '2025-05-02', dueDate: '2025-05-16', customerId: 'c1', price: 50 })
  add({ id: 'a-debit', kind: 'rechnung', date: '2026-11-02', dueDate: '2026-11-16', customerId: 'c1', price: 40, debitText: 'Der Betrag wird am 16.11.2026 per SEPA-Lastschrift eingezogen.' })
  const cancelled = add({ id: 'a-cancelled', kind: 'rechnung', date: '2026-10-20', dueDate: '2026-11-03', customerId: 'c1', price: 272 })
  add({ ...stornoDraft(cancelled, { id: 'a-storno', date: '2026-10-22', reason: 'falsches Objekt' }), customerId: 'c1' })
  add({ id: 'b-open', kind: 'rechnung', date: '2026-10-02', dueDate: '2026-10-12', customerId: 'c2', price: 1869 })
  add({ id: 'a-offer', kind: 'angebot', date: '2026-10-31', validUntil: '2026-11-30', customerId: 'c1', price: 640 })
  list.push({ id: 'a-draft', kind: 'rechnung', status: 'entwurf', date: '2026-11-05', customerId: 'c1', lines: [line(10)] })
  const tampered = add({ id: 'a-tampered', kind: 'rechnung', date: '2026-11-01', dueDate: '2026-11-15', customerId: 'c1', price: 10 })
  tampered.lines = [line(1)]
  return list
}

test('Rechnungen im Kundenbereich: Standard aus, eigener Abschnitt, Monate, Dateiname ohne Namen wie in kunden.php', () => {
  assert.deepEqual(invoiceDefaults(), { on: false, customerIds: [], months: 13 })
  assert.equal(showDefaults().rechnungen, false, 'Rechnungen standardmäßig aus')
  // aus: Rechnungen und der Mattenwechsel (Lieferscheine, nächster Wechsel; test/customer-matten.test.js)
  assert.ok(Object.entries(showDefaults()).every(([k, v]) => v === !['rechnungen', 'lieferscheine', 'mattenwechsel', 'zusatz', 'status'].includes(k)), 'alles andere wie bisher an (Zusatzleistung anfragen und Stand im Objekt: neu, Standard aus)')
  assert.deepEqual(invoiceSettings({ invoices: { customerIds: ['c1'] } }), { on: false, customerIds: ['c1'], months: 13 })
  assert.equal(invoiceFile({ kind: 'rechnung', number: 'RE-2026-0005' }), 'rechnung-RE-2026-0005.pdf')
  assert.equal(invoiceFile({ kind: 'storno', number: 'ST/2026/1 ' }), 'storno-ST-2026-1.pdf')
  assert.ok(INVOICE_FILE_PATTERN.test('korrektur-KO-2026-0001.pdf') && !INVOICE_FILE_PATTERN.test('../rechnung-RE-1.pdf') && !INVOICE_FILE_PATTERN.test('angebot-AN-1.pdf'))
  assert.ok(PHP.includes(`const BELEG_MUSTER = '/${INVOICE_FILE_PATTERN.source}/';`), 'gleiches Muster in kunden.php')
  for (const k of Object.keys(PORTAL_STATES)) assert.ok(PHP.includes(`'${k}' => '${PORTAL_STATES[k]}'`), `Stand ${k} in kunden.php`)
  assert.ok(PHP.includes("'rechnungen'") && SHOW.rechnungen === 'Rechnungen und offene Posten zeigen')
})

test('Rechnungen im Kundenbereich: Kunden passend zu den Objekten vorschlagen, Zeitraum', () => {
  const customers = [{ id: 'c1', name: 'Hausverwaltung', objectIds: ['o5', 'o11'] }, { id: 'c2', name: 'Autohaus', objectIds: ['o2'] }, { id: 'c3', name: 'Bank', objectIds: ['o5'] }, { id: 'c4', name: 'Alt', objectIds: ['o5'], active: false }]
  assert.deepEqual(suggestCustomers(customers, ['o5', 'o11']).map((c) => c.id), ['c1', 'c3'], 'meiste gemeinsame Objekte zuerst, inaktive nicht')
  assert.deepEqual(suggestCustomers(customers, []), [])
  assert.equal(sinceDate('2026-11-06', 13), '2025-10-06')
  assert.equal(sinceDate('2026-03-31', 1), '2026-02-28', 'Monatsende')
  assert.equal(sinceDate('2026-01-15', 24), '2024-01-15')
})

test('Rechnungen im Kundenbereich: nur festgeschriebene Belege der gewählten Kunden, letzte Monate plus alle offenen', () => {
  const list = docs()
  const ids = portalDocuments(list, { customerIds: ['c1'], months: 13, today: TODAY, settings: SETTINGS }).map((d) => d.id)
  assert.deepEqual(ids, ['a-debit', 'a-storno', 'a-cancelled', 'a-partial', 'a-open', 'a-overdue', 'a-paid', 'a-old-open'])
  assert.ok(!ids.includes('b-open'), 'kein Beleg eines anderen Kunden')
  assert.ok(!ids.includes('a-old-paid'), 'alte bezahlte nicht')
  assert.ok(!ids.includes('a-offer') && !ids.includes('a-draft'), 'keine Angebote und Entwürfe')
  assert.ok(!ids.includes('a-tampered'), 'nachträglich veränderte nie')
  assert.deepEqual(portalDocuments(list, { customerIds: [], today: TODAY, settings: SETTINGS }), [], 'ohne Kunden nichts')
  assert.deepEqual(portalDocuments(list, { customerIds: ['c1'], months: 3, today: TODAY, settings: SETTINGS }).map((d) => d.id).filter((id) => id.startsWith('a-old')), ['a-old-open'])
})

test('Rechnungen im Kundenbereich: Stand, offener Betrag, Zahlungsdaten und QR-Inhalt', () => {
  const list = docs()
  const byId = (id) => list.find((d) => d.id === id)
  const entry = (id) => invoiceEntry(byId(id), list, { today: TODAY, settings: SETTINGS, sig: 'a'.repeat(32), qr: 'QR' })
  assert.deepEqual(['a-open', 'a-partial', 'a-overdue', 'a-paid', 'a-cancelled', 'a-storno'].map((id) => portalState(byId(id), list, TODAY, SETTINGS)), ['offen', 'teilbezahlt', 'ueberfaellig', 'bezahlt', 'storniert', 'verrechnet'])
  const open = entry('a-open')
  assert.deepEqual({ ...open, name: undefined }, { datei: `rechnung-${byId('a-open').number}.pdf`, art: 'rechnung', titel: 'Rechnung', nummer: byId('a-open').number, betreff: '', datum: '2026-10-02', faellig: '2026-11-16', brutto: 1176, offen: 1176, status: 'offen', bezug: '', name: undefined, sig: 'a'.repeat(32), zahlung: { empfaenger: 'Gebäudereinigung Beispiel GmbH', iban: 'AT61 1904 3002 3457 3201', bic: 'BKAUATWW', betrag: 1176, zweck: byId('a-open').number }, lastschrift: false, qr: 'QR' })
  assert.match(open.name, /^Rechnung_RE-2026-\d{4}_Hausverwaltung-Beispiel-GmbH\.pdf$/)
  assert.ok(!JSON.stringify(open).includes('Ringstraße') && !('lines' in open), 'keine Anschrift, keine Positionen')
  // QR wie auf dem PDF, aber mit dem offenen Betrag
  const p = entry('a-partial')
  assert.equal(p.offen, 400)
  assert.equal(invoiceQrPayload(p), epcPayload({ name: SETTINGS.sender.name, iban: SETTINGS.bank.iban, bic: 'BKAUATWW', amount: 400, text: `Rechnung ${p.nummer}` }))
  assert.match(invoiceQrPayload(p), /^BCD\n002\n1\nSCT\nBKAUATWW\nGebäudereinigung Beispiel GmbH\nAT611904300234573201\nEUR400\.00\n\n\nRechnung RE-/)
  // bezahlt, storniert, Storno: nichts zu zahlen; Lastschrift: kein QR
  for (const id of ['a-paid', 'a-cancelled', 'a-storno']) assert.deepEqual([entry(id).offen, entry(id).zahlung, entry(id).qr], [0, null, ''], id)
  assert.equal(entry('a-storno').brutto, -326.4)
  assert.equal(entry('a-storno').bezug, byId('a-cancelled').number)
  const debit = entry('a-debit')
  assert.ok(collectedByDebit(byId('a-debit')) && debit.lastschrift && !debit.zahlung && debit.qr === '')
  // ohne gültige IBAN keine Zahlungsdaten
  assert.equal(invoiceEntry(byId('a-open'), list, { today: TODAY, settings: { ...SETTINGS, bank: { iban: 'AT00 1234' } } }).zahlung, null)
  // Signatur ändert sich mit dem Beleg, nicht mit Zahlungen
  assert.equal(invoiceSigText(byId('a-open')), invoiceSigText({ ...byId('a-open'), payments: [{ amount: 1 }] }))
  assert.notEqual(invoiceSigText(byId('a-open')), invoiceSigText({ ...byId('a-open'), checksum: 'anders' }))
})

test('Rechnungen im Kundenbereich: was ein Link sendet (aus: leer, ohne Recht: unverändert)', () => {
  const link = { id: 'kb0123456789', title: 'HV', objectIds: [], token: 'x', show: { ...showDefaults() }, invoices: { customerIds: ['c1'], months: 6 } }
  const entries = [{ datei: 'rechnung-RE-1.pdf' }]
  assert.deepEqual(linkPayload({ link, hash: 'h', rechnungen: entries }).rechnungen, [], 'Link zeigt keine Rechnungen: am Webspace löschen')
  const on = { ...link, show: { ...link.show, rechnungen: true } }
  const p = linkPayload({ link: on, hash: 'h', rechnungen: entries })
  assert.deepEqual([p.rechnungen, p.rechnungenMonate, p.zeige.rechnungen], [entries, 6, true])
  assert.equal(linkPayload({ link: on, hash: 'h' }).rechnungen, null, 'ohne Recht auf die Fakturierung: letzter Stand')
  assert.match(linkMail({ link: on, url: 'u' }).text, /Ihre Rechnungen und offenen Posten als PDF/)
  assert.ok(!/Rechnungen/.test(linkMail({ link, url: 'u' }).text))
})

test('QR-Code: Matrix aus dem Kodierer von pdfmake (wie im PDF)', () => {
  const payload = epcPayload({ name: SETTINGS.sender.name, iban: SETTINGS.bank.iban, bic: 'BKAUATWW', amount: 1176, text: 'Rechnung RE-2026-0003' })
  const node = measure({ qr: payload, fit: 400, eccLevel: 'M' })
  const m = qrMatrixFromCanvas(node._canvas)
  assert.ok(m.length >= 21 && (m.length - 17) % 4 === 0, `Größe ${m.length}`)
  // Suchmuster links oben, rechts oben, links unten: Rahmen 7 × 7 dunkel, Ring hell, Kern 3 × 3 dunkel
  const n = m.length
  for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let i = 0; i < 7; i++) assert.ok(m[r0][c0 + i] && m[r0 + 6][c0 + i] && m[r0 + i][c0] && m[r0 + i][c0 + 6], 'Rahmen')
    assert.ok(!m[r0 + 1][c0 + 1] && m[r0 + 3][c0 + 3] && m[r0 + 2][c0 + 2])
  }
  // dieselbe Matrix wie aus dem Messen mit anderer Größe
  assert.deepEqual(qrMatrixFromCanvas(measure({ qr: payload, fit: 150, eccLevel: 'M' })._canvas), m)
  assert.equal(qrMatrixFromCanvas([]), null)
})

test('Online-Annahme: nur festgeschriebene, offene Angebote mit Frist; Verbraucher nur mit Einstellung', () => {
  const offer = docs().find((d) => d.id === 'a-offer')
  assert.ok(onlineCheck(offer, { today: TODAY }).ok)
  assert.match(onlineCheck({ ...offer, number: '' }, { today: TODAY }).reason, /festgeschriebenes Angebot/)
  assert.match(onlineCheck({ ...offer, kind: 'rechnung' }, { today: TODAY }).reason, /festgeschriebenes Angebot/)
  assert.match(onlineCheck({ ...offer, status: 'angenommen' }, { today: TODAY }).reason, /schon angenommen/)
  assert.match(onlineCheck({ ...offer, status: 'abgelehnt' }, { today: TODAY }).reason, /abgelehnt/)
  assert.match(onlineCheck({ ...offer, validUntil: '' }, { today: TODAY }).reason, /gültig bis/)
  assert.match(onlineCheck({ ...offer, validUntil: '2026-11-05' }, { today: TODAY }).reason, /abgelaufen \(gültig bis 05\.11\.2026\)/)
  assert.ok(onlineCheck({ ...offer, validUntil: TODAY }, { today: TODAY }).ok, 'am letzten Tag noch')
  // Verbraucher (Kunde oder Empfänger): gesperrt, außer die Einstellung bestätigt die Belehrung im Angebot
  const consumer = { id: 'c9', consumer: true }
  const blocked = onlineCheck(offer, { customer: consumer, today: TODAY })
  assert.deepEqual([blocked.ok, blocked.consumer], [false, true])
  assert.match(blocked.reason, /Verbraucher.*Fernabsatzvertrag \(FAGG\).*Rücktrittsrecht.*Widerrufsbelehrung/)
  assert.ok(isConsumer({ recipient: { consumer: true } }, null))
  assert.deepEqual(onlineCheck({ ...offer, recipient: { ...offer.recipient, consumer: true } }, { today: TODAY, settings: { onlineConsumers: true } }), { ok: true, consumer: true, reason: '' })
})

test('Online-Annahme: was an den Webspace geht (Kopfdaten, kein Code), Kennung, Link, E-Mail', () => {
  const offer = docs().find((d) => d.id === 'a-offer')
  const p = offerPayload({ doc: offer, id: 'an0123456789', hash: 'h'.repeat(64), consumer: false, sig: 's'.repeat(32) })
  assert.deepEqual(Object.keys(p).sort(), ['brutto', 'datum', 'empfaenger', 'gueltigBis', 'hash', 'id', 'name', 'netto', 'nummer', 'sig', 'titel', 'ust', 'verbraucher'])
  assert.deepEqual([p.nummer, p.gueltigBis, p.netto, p.ust, p.brutto], [offer.number, '2026-11-30', 640, 128, 768])
  assert.ok(!JSON.stringify(p).includes('Ringstraße') && !JSON.stringify(p).includes('Unterhaltsreinigung'), 'keine Anschrift, keine Positionen')
  assert.equal(newOfferId(() => new Uint8Array([0, 15, 160, 255, 1])), 'an000fa0ff01')
  assert.ok(OFFER_ID_PATTERN.test(newOfferId()))
  assert.ok(PHP.includes(`const ANGEBOT_MUSTER = '/${OFFER_ID_PATTERN.source}/';`))
  assert.equal(offerLink('https://app.cleanos.at', 'Abc123'), 'https://app.cleanos.at/kunden.php?a=Abc123')
  const mail = offerMail({ doc: offer, url: 'https://app.cleanos.at/kunden.php?a=Abc123', company: 'Cleanos', sender: 'Eva Büro', amount: '€ 768,00' })
  assert.equal(mail.subject, `Angebot ${offer.number}`)
  assert.match(mail.text, /^Sehr geehrte Damen und Herren,\n\nunser Angebot AN-2026-\d{4} über € 768,00 finden Sie unter diesem Link zum Ansehen, als PDF und zum Annehmen:\nhttps:\/\/app\.cleanos\.at\/kunden\.php\?a=Abc123/)
  assert.match(mail.text, /gilt bis 30\.11\.2026/)
  assert.ok(!/\b(du|dein|dich)\b/i.test(mail.text))
})

test('Online-Annahme: Annahme übernehmen außerhalb der Prüfsumme, PDF-Abgleich, Unterschrift nur als Pfad', () => {
  const list = docs()
  const offer = list.find((d) => d.id === 'a-offer')
  const before = { checksum: offer.checksum, computed: checksumOf(offer) }
  offer.online = { id: 'an0123456789', publishedAt: '2026-11-01T10:00:00.000Z', validUntil: offer.validUntil, pdfSha256: 'a'.repeat(64) }
  assert.ok(onlineActive(offer) && !onlineActive({ online: { ...offer.online, revokedAt: 'x' } }))
  const entry = { id: 'an0123456789', nummer: offer.number, annahme: { zeit: Date.parse('2026-11-06T13:32:00Z') / 1000, name: 'Mag. Eva Beispiel', funktion: 'Geschäftsführerin', nummer: offer.number, pdfSha256: 'a'.repeat(64), unterschrift: 'M10 20L30 40', uebernommen: null } }
  const fresh = newAcceptances([entry, { ...entry, id: 'an9999999999' }, { id: '../x', annahme: {} }, { ...entry, annahme: null }], list)
  assert.deepEqual(fresh.map((x) => x.doc.id), ['a-offer'])
  const a = acceptanceOf(entry, offer, { now: '2026-11-06T13:35:00.000Z' })
  assert.deepEqual(a, { via: 'online', at: '2026-11-06T13:32:00.000Z', name: 'Mag. Eva Beispiel', role: 'Geschäftsführerin', number: offer.number, pdfSha256: 'a'.repeat(64), pdfOk: true, signature: 'M10 20L30 40', receivedAt: '2026-11-06T13:35:00.000Z' })
  assert.equal(acceptanceOf({ ...entry, annahme: { ...entry.annahme, pdfSha256: 'b'.repeat(64) } }, offer).pdfOk, false, 'anderes PDF')
  assert.equal(acceptanceOf({ ...entry, annahme: { ...entry.annahme, unterschrift: 'M1 2"/><script>' } }, offer).signature, '')
  assert.ok(signatureOk('M10 20L30 40M5 5L5 5') && !signatureOk('L10 20') && !signatureOk('M10 20<'))
  assert.ok(PHP.includes(`const UNTERSCHRIFT_MUSTER = '/${SIGNATURE_PATTERN.source}/';`))
  // festgeschriebenes Angebot unverändert: Annahme und Link stehen außerhalb der Prüfsumme
  offer.acceptance = a
  offer.status = 'angenommen'
  assert.equal(checksumOf(offer), before.computed)
  assert.equal(offer.checksum, before.checksum)
  assert.ok(intact(offer))
  assert.deepEqual(newAcceptances([entry], list), [], 'schon übernommen')
  // „Zu erledigen“: bis eine Auftragsbestätigung (oder Rechnung) dazu besteht oder es erledigt ist
  assert.deepEqual(acceptedOpen(list).map((d) => d.id), ['a-offer'])
  assert.deepEqual(acceptedOpen([...list, { id: 'ab1', kind: 'auftrag', refId: 'a-offer' }]), [])
  assert.deepEqual(acceptedOpen(list.map((d) => (d.id === 'a-offer' ? { ...d, acceptance: { ...d.acceptance, doneAt: 'x' } } : d))), [])
})

test('Online-Annahme: im Büro entschieden (angenommen, abgelehnt, Folgebeleg) → aktiven Link zurückziehen, außer online angenommen', () => {
  const offer = { ...docs().find((d) => d.id === 'a-offer'), online: { id: 'an0123456789', publishedAt: '2026-11-01T10:00:00.000Z', validUntil: '2026-11-30' } }
  assert.equal(withdrawNeeded(offer), false, 'noch offen: Link bleibt')
  assert.equal(withdrawNeeded({ ...offer, status: 'angenommen' }), true, '„Angenommen“ von Hand bzw. Auftragsbestätigung erstellt')
  assert.equal(withdrawNeeded({ ...offer, status: 'abgelehnt' }), true)
  assert.equal(withdrawNeeded({ ...offer, status: 'angenommen', acceptance: { via: 'online' } }), false, 'online angenommen: Link zeigt weiter „angenommen“')
  assert.equal(withdrawNeeded({ ...offer, status: 'angenommen', online: { ...offer.online, revokedAt: 'x' } }), false, 'schon zurückgezogen')
  assert.equal(withdrawNeeded({ ...offer, status: 'angenommen', online: undefined }), false, 'nie online')
  assert.equal(withdrawNeeded({ ...offer, kind: 'auftrag', status: 'angenommen' }), false)
})
