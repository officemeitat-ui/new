// Läufe der Fakturierung (core/fak-laeufe.js): Sammel-Festschreiben in fortlaufender Nummernfolge, Sammelversand
// (E-Mail oder Post), Mahnlauf mit Mahnsperre und „im Einzug“, Angebote nachfassen und Angebotsquote; dazu das
// Sammel-PDF zum Drucken (export/pdf-sammel.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checksumOf, intact } from '../src/core/invoicing.js'
import { activeBlocks, batchDrafts, blockOf, dunningRun, emailValid, finalizeBatch, followUpMailText, followUpOf, mailWithDebit, offerStats, offerTasks, paymentReminders, sendCandidates } from '../src/core/fak-laeufe.js'
import { creditorIdFor } from '../src/core/sepa.js'
import { combineDocuments, pdfPageCount } from '../src/export/pdf-sammel.js'

const IBAN = 'AT611904300234573201'
const settings = { sender: { name: 'Reinigung Beispiel GmbH', address: 'Musterstraße 1\n5020 Salzburg', uid: 'ATU12345678' }, bank: { iban: IBAN, bic: 'BKAUATWW' }, sepa: { creditorId: creditorIdFor('01234567890') } }
const rec = (name) => ({ name, address: 'Ringstraße 3\n5020 Salzburg', uid: 'ATU87654321', email: '' })
const line = (price) => [{ id: 'l1', text: 'Unterhaltsreinigung', qty: 1, unit: 'Monat', price, vat: 20 }]
const draft = (id, name, extra = {}) => ({ id, kind: 'rechnung', status: 'entwurf', date: '2026-11-03', serviceFrom: '2026-11-01', serviceTo: '2026-11-30', dueDate: '2026-11-17', customerId: `c-${id}`, recipient: rec(name), lines: line(500), source: { type: 'dauerauftrag', key: `rec:r-${id}:2026-11` }, ...extra })
const fixed = (id, number, extra = {}) => ({ ...draft(id, 'Beispiel GmbH'), number, status: 'fest', total: { net: 1000, vat: 200, gross: 1200, groups: [{ rate: 20, net: 1000, vat: 200 }] }, ...extra })

test('Sammel-Festschreiben: Entwürfe des Monatslaufs prüfen, Reihenfolge nach Datum und Empfänger', () => {
  const docs = [draft('a', 'Zeta Beispiel KG'), draft('b', 'Alpha Beispiel GmbH'), draft('c', 'Mitte Beispiel OG', { recipient: { name: '' } }), draft('d', 'Eigen Beispiel', { source: null }), draft('e', 'Oktober Beispiel', { source: { type: 'dauerauftrag', key: 'rec:r-e:2026-10' } }), fixed('f', 'RE-2026-0004')]
  const lauf = batchDrafts(docs, { filter: 'lauf', ym: '2026-11', settings })
  assert.deepEqual(lauf.map((x) => x.doc.id), ['c', 'b', 'a'])
  assert.ok(lauf[0].errors.length && /Name des Empfängers/.test(lauf[0].errors[0].text))
  assert.equal(lauf[1].errors.length, 0)
  assert.equal(lauf[1].gross, 600)
  assert.deepEqual(batchDrafts(docs, { filter: 'lauf', settings }).map((x) => x.doc.id), ['c', 'b', 'e', 'a'])
  assert.equal(batchDrafts(docs, { filter: 'alle', settings }).length, 5)
})

test('Sammel-Festschreiben: fortlaufende Nummern, Fehler halten die übrigen nicht auf, Lastschrift-Hinweis bei Mandat', () => {
  const customers = new Map([['c-b', { id: 'c-b', iban: 'AT483200000012345864', mandate: { reference: 'M-1', signedAt: '2026-01-01', scheme: 'CORE' } }]])
  const docs = [fixed('f', 'RE-2026-0004', { date: '2026-10-02' }), draft('a', 'Zeta Beispiel KG'), draft('b', 'Alpha Beispiel GmbH'), draft('c', '', { recipient: { name: '' } })]
  const r = finalizeBatch(['a', 'b', 'c'], docs, settings, { now: '2026-11-03T09:00:00Z', by: 'Test', customersById: customers })
  assert.deepEqual(r.done.map((d) => `${d.id}:${d.number}`), ['b:RE-2026-0005', 'a:RE-2026-0006'])
  assert.deepEqual(r.failed.map((f) => f.id), ['c'])
  assert.match(r.failed[0].error, /Name des Empfängers/)
  const b = r.docs.find((d) => d.id === 'b')
  assert.ok(intact(b) && b.checksum === checksumOf(b))
  assert.match(b.debitText, /mit SEPA-Lastschrift .*Mandatsreferenz M-1/)
  assert.equal(r.docs.find((d) => d.id === 'a').debitText, undefined)
  assert.equal(docs[1].number, undefined, 'Eingangsliste bleibt unverändert')
  assert.equal(r.docs.find((d) => d.id === 'c').number, undefined)
})

test('Sammelversand: festgeschriebene, noch nicht versendete Belege mit E-Mail des Belegs oder des Kunden', () => {
  const docs = [fixed('a', 'RE-2026-0010', { recipient: { ...rec('A'), email: 'buchhaltung@a-beispiel.example' } }), fixed('b', 'RE-2026-0009', { customerId: 'cb' }), fixed('c', 'RE-2026-0011', { sent: [{ at: '2026-11-03T10:00:00Z', to: 'x@y.at' }] }), draft('d', 'D'), fixed('e', 'RE-2026-0012', { customerId: 'ce' }), fixed('o', 'AN-2026-0001', { kind: 'angebot' })]
  const list = sendCandidates(docs, [{ id: 'cb', email: 'rechnung@b-beispiel.example' }])
  assert.deepEqual(list.map((x) => `${x.doc.number}:${x.to}`), ['RE-2026-0009:rechnung@b-beispiel.example', 'RE-2026-0010:buchhaltung@a-beispiel.example', 'RE-2026-0012:'])
  assert.deepEqual(sendCandidates(docs, [], { ids: ['a'] }).map((x) => x.doc.id), ['a'])
  assert.deepEqual(sendCandidates([fixed('i', 'RE-2025-0400', { imported: { system: 'orgaMAX' } })], []), [], 'übernommene Altbelege sind schon versendet')
  assert.ok(emailValid('a@b.at') && !emailValid('ab.at') && !emailValid(''))
  // Rechnung mit Lastschrift: Hinweis auf den Einzug statt „zahlbar bis … auf IBAN“
  assert.equal(mailWithDebit('Hallo\nBetrag: € 10,00, zahlbar bis 01.12.2026 auf AT61.\nGruß', { debitText: 'Wird eingezogen.' }), 'Hallo\nWird eingezogen.\nGruß')
  assert.equal(mailWithDebit('Betrag: x', {}), 'Betrag: x')
})

test('Mahnlauf: fällige Stufe mit Zinsen und Gebühr, Sperre je Beleg oder Kunde, Lastschrift im Einzug', () => {
  const old = (id, extra = {}) => fixed(id, `RE-2026-00${id.charCodeAt(0)}`, { date: '2026-09-01', dueDate: '2026-09-15', customerId: `c-${id}`, ...extra })
  const docs = [
    old('a'),
    old('b', { reminders: [{ level: 0, name: 'Zahlungserinnerung', date: '2026-09-25', deadline: '2026-10-02' }] }),
    old('c', { dunningBlock: { until: '2026-12-31', note: 'Ratenvereinbarung' } }),
    old('d'),
    old('e', { directDebit: { status: 'eingereicht', dueDate: '2026-11-10' } }),
    old('f', { dunningBlock: { until: '2026-10-31', note: 'abgelaufen' } }),
    fixed('g', 'RE-2026-0100', { dueDate: '2026-11-04' }),
  ]
  const customers = [{ id: 'c-d', email: 'rechnung@d-beispiel.example', dunningBlock: { until: '', note: 'Insolvenzverfahren: nicht mahnen' } }]
  const r = dunningRun(docs, customers, '2026-11-05', { ...settings, baseRate: 1.53 })
  assert.deepEqual(r.due.map((x) => x.doc.id), ['a', 'b', 'f'])
  assert.equal(r.due[0].reminder.name, 'Zahlungserinnerung')
  assert.equal(r.due[0].reminder.fee, 0)
  const b = r.due[1].reminder
  assert.equal(b.name, '1. Mahnung')
  assert.equal(b.fee, 40)
  assert.ok(b.interest.amount > 0 && b.interest.rate === 10.73)
  assert.equal(b.total, Math.round((1200 + b.interest.amount + 40) * 100) / 100)
  assert.deepEqual(r.blocked.map((x) => `${x.doc.id}:${x.block.scope}`), ['c:beleg', 'd:kunde'])
  assert.equal(r.blocked[1].to, 'rechnung@d-beispiel.example')
  assert.deepEqual(r.collecting.map((x) => x.doc.id), ['e'])
  assert.equal(blockOf(docs[5], null, '2026-11-05'), null, 'abgelaufene Sperre gilt nicht mehr')
  assert.deepEqual(blockOf({ dunningBlock: { until: '2026-11-05' } }, null, '2026-11-05'), { scope: 'beleg', until: '2026-11-05', note: '' })
  assert.deepEqual(activeBlocks(docs, customers, '2026-11-05').map((x) => x.scope), ['kunde', 'beleg'])
})

test('Zahlungserinnerung: nur die erste Stufe, versandbereit mit E-Mail, ohne Adresse und höhere Stufen bleiben im Mahnlauf', () => {
  const old = (id, extra = {}) => fixed(id, `RE-2026-00${id.charCodeAt(0)}`, { date: '2026-09-01', dueDate: '2026-09-15', customerId: `c-${id}`, ...extra })
  const docs = [
    old('a', { recipient: { ...rec('A'), email: 'buchhaltung@a-beispiel.example' } }),
    old('b', { reminders: [{ level: 0, name: 'Zahlungserinnerung', date: '2026-09-25', deadline: '2026-10-02' }], recipient: { ...rec('B'), email: 'b@b-beispiel.example' } }),
    old('h'),
    old('i', { dunningBlock: { until: '2026-12-31', note: 'Ratenvereinbarung' }, recipient: { ...rec('I'), email: 'i@i-beispiel.example' } }),
    old('j', { directDebit: { status: 'eingereicht', dueDate: '2026-11-10' } }),
    fixed('k', 'RE-2026-0101', { dueDate: '2026-11-03', customerId: 'c-k' }),
  ]
  const customers = [{ id: 'c-h', email: 'kein-at-zeichen' }, { id: 'c-k', email: 'k@k-beispiel.example' }]
  const r = paymentReminders(docs, customers, '2026-11-05', { ...settings, baseRate: 1.53 })
  assert.deepEqual(r.ready.map((x) => `${x.doc.id}:${x.to}`), ['a:buchhaltung@a-beispiel.example'])
  assert.equal(r.ready[0].reminder.fee, 0, 'freundlich: ohne Gebühr')
  assert.equal(r.ready[0].reminder.interest.amount, 0, 'freundlich: ohne Zinsen')
  assert.deepEqual(r.post.map((x) => x.doc.id), ['h'], 'ohne gültige E-Mail-Adresse: per Post im Mahnlauf')
  assert.equal(r.later, 1, 'b ist schon erinnert: 1. Mahnung gehört in den Mahnlauf')
  // gesperrt, im Lastschrifteinzug und noch nicht lange genug überfällig: keine Erinnerung
  assert.ok(!r.ready.some((x) => ['i', 'j', 'k'].includes(x.doc.id)))
})

test('Angebote nachfassen: Wiedervorlage eigen oder X Tage nach Versand, bald ablaufend, erledigt', () => {
  const offer = (id, extra = {}) => ({ ...fixed(id, `AN-2026-000${id}`), kind: 'angebot', status: 'offen', date: '2026-10-20', validUntil: '2026-11-19', ...extra })
  const s = { ...settings, offerFollowUpDays: 7 }
  assert.deepEqual(followUpOf(offer('1', { sent: [{ at: '2026-10-21T08:00:00Z' }] }), s), { date: '2026-10-28', note: '', done: false, auto: true })
  assert.equal(followUpOf(offer('1'), s), null, 'ohne Versand keine automatische Wiedervorlage')
  assert.equal(followUpOf(offer('1', { sent: [{ at: '2026-10-21T08:00:00Z' }] }), { ...s, offerFollowUpDays: 0 }), null)
  assert.deepEqual(followUpOf(offer('1', { followUp: { date: '2026-11-10', note: 'Herrn Beispiel anrufen' } }), s), { date: '2026-11-10', note: 'Herrn Beispiel anrufen', done: false, auto: false })
  // nach Mitternacht versendet (Do 22.10. 0:30 Uhr in Wien = 21.10. 22:30 UTC): 7 Tage ab dem 22.10.
  assert.equal(followUpOf(offer('1', { sent: [{ at: '2026-10-21T22:30:00.000Z' }] }), s).date, '2026-10-29')
  assert.equal(followUpOf(offer('1', { followUp: { doneAt: '2026-11-01T23:10:00.000Z' } }), s).date, '2026-11-02')
  const docs = [
    offer('1', { sent: [{ at: '2026-10-21T08:00:00Z' }] }),
    offer('2', { followUp: { date: '2026-11-10', note: 'später' } }),
    offer('3', { followUp: { date: '2026-11-01', note: 'nachfragen', doneAt: '2026-11-02T10:00:00Z' } }),
    offer('4', { validUntil: '2026-11-08' }),
    offer('5', { status: 'angenommen', sent: [{ at: '2026-10-21T08:00:00Z' }] }),
    offer('6', { validUntil: '2026-11-01', sent: [{ at: '2026-10-21T08:00:00Z' }] }),
  ]
  const t = offerTasks(docs, '2026-11-05', s)
  assert.deepEqual(t.followUps.map((x) => `${x.doc.id}:${x.date}:${x.overdue}`), ['1:2026-10-28:8'])
  assert.deepEqual(t.expiring.map((x) => `${x.doc.id}:${x.days}`), ['4:3'])
  assert.match(followUpMailText({ doc: docs[0], greeting: 'Sehr geehrte Frau Beispiel', sender: 'Eva', company: 'Reinigung Beispiel GmbH' }), /^Sehr geehrte Frau Beispiel,\n\nvor kurzem haben wir Ihnen unser Angebot AN-2026-0001 vom 20\.10\.2026 .*gilt bis 19\.11\.2026/s)
})

test('Angebotsquote je Jahr: angenommen, abgelehnt, abgelaufen, offen mit Summe', () => {
  const offer = (id, status, net, extra = {}) => ({ id, kind: 'angebot', number: `AN-2026-${id}`, date: '2026-03-01', status, validUntil: '2026-12-31', total: { net, vat: 0, gross: net, groups: [] }, ...extra })
  const docs = [offer('1', 'angenommen', 1000), offer('2', 'angenommen', 500), offer('3', 'abgelehnt', 2000), offer('4', 'offen', 300, { validUntil: '2026-04-01' }), offer('5', 'offen', 700), offer('6', 'angenommen', 99, { date: '2025-12-01' }), { id: 'x', kind: 'angebot', status: 'entwurf', date: '2026-03-01' }]
  const st = offerStats(docs, '2026', '2026-11-05', settings)
  assert.equal(st.count, 5)
  assert.equal(st.net, 4500)
  assert.deepEqual(st.byState.angenommen, { count: 2, net: 1500 })
  assert.deepEqual(st.byState.abgelehnt, { count: 1, net: 2000 })
  assert.deepEqual(st.byState.abgelaufen, { count: 1, net: 300 })
  assert.deepEqual(st.byState.offen, { count: 1, net: 700 })
  assert.equal(st.rate, 50)
  assert.equal(st.rateNet, Math.round((1500 / 3800) * 10000) / 100)
  assert.equal(offerStats([], '2026', '2026-11-05', settings).rate, null)
})

test('Sammel-PDF: Belege hintereinander, Fußzeile mit Seite je Beleg', () => {
  const footer = (name) => (page, pages) => ({ text: `${name} Seite ${page} von ${pages}` })
  const defs = [
    { pageSize: 'A4', content: [{ text: 'Rechnung 1' }], footer: footer('A'), styles: { title: { bold: true } }, info: { title: 'A' } },
    { pageSize: 'A4', content: [{ text: 'Rechnung 2' }], footer: footer('B'), images: { logo: 'data:x' }, watermark: { text: 'ENTWURF' } },
    { pageSize: 'A4', content: { text: 'Mahnung' }, footer: footer('C'), background: (page) => ({ text: `bg ${page}` }) },
  ]
  const all = combineDocuments(defs, [1, 3, 1], { title: 'Sammeldruck Beispiel' })
  assert.equal(all.content.length, 3)
  assert.equal(all.content[0].pageBreak, undefined)
  assert.equal(all.content[1].pageBreak, 'before')
  assert.deepEqual(all.content[2].stack, [{ text: 'Mahnung' }])
  assert.equal(all.info.title, 'Sammeldruck Beispiel')
  assert.deepEqual(all.images, { logo: 'data:x' })
  assert.ok(all.styles.title && !all.watermark)
  assert.deepEqual([1, 2, 3, 4, 5].map((p) => all.footer(p, 5, {}).text), ['A Seite 1 von 1', 'B Seite 1 von 3', 'B Seite 2 von 3', 'B Seite 3 von 3', 'C Seite 1 von 1'])
  assert.deepEqual(all.background(5, {}), { text: 'bg 1' })
  assert.equal(all.background(2, {}), null)
  assert.throws(() => combineDocuments([], []), /Nichts/)
  assert.equal(pdfPageCount('%PDF-1.3\n<< /Type /Pages /Count 2 >>\n<< /Type /Page /Parent 1 0 R >>\n<</Type /Page>>'), 2)
})
