// Briefpapier (export/letterhead.js), Geschäftsbriefe und Serienbriefe (core/letters.js, export/letter-pdf.js):
// Seitenränder, Hintergrund je Seite, ausgeblendete Teile, Fußzeile, Platzhalter im Brief, Empfänger des
// Serienbriefs, Sammel-PDF. Die PDFs werden mit pdfmake wirklich gesetzt; die Lage der Texte liefert pdfmake
// selbst (pageBreakBefore bekommt jede Stelle mit Seite und Höhe).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { deflateSync } from 'node:zlib'

import { contrast } from '../src/core/color.js'
import { finalize, reminderFor } from '../src/core/invoicing.js'
import { contactGreeting, customerActive, customerLetters, letterArchivePath, letterContext, letterFileName, letterRecipient, letterState, pageStarts, resolveLetter, serialCounts, serialRecipients, splitContactName } from '../src/core/letters.js'
import { invoiceDocument, reminderDocument } from '../src/export/invoice-pdf.js'
import { letterDocument, lettersDocument } from '../src/export/letter-pdf.js'
import { A4, checkLetterheadImage, DEFAULT_MARGINS_PT, footerNeedMm, letterheadActive, letterheadKey, letterheadOf, letterheadPath, marginProblems, marginsPt, MM, pageSetup, setLetterheadImages, suggestFooter } from '../src/export/letterhead.js'

const require = createRequire(import.meta.url)
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps

// ---------------------------------------------------------------- kleines PNG (Kopf- und Fußbalken)

function png(w, h, pix) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b) => {
    let c = 0xffffffff
    for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      ;[raw[o], raw[o + 1], raw[o + 2]] = pix(x, y)
    }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')}`
}
// 1 Pixel = 1 mm: Kopf bis 40 mm, Fuß ab 275 mm
const FIRST = png(210, 297, (x, y) => (y < 40 ? [31, 58, 95] : y >= 275 ? [200, 200, 200] : [255, 255, 255]))
const NEXT = png(210, 297, (x, y) => (y < 22 ? [95, 31, 58] : [255, 255, 255]))

const sender = { name: 'Glanzwerk Reinigung GmbH', address: 'Musterstraße 1\n5020 Salzburg', uid: 'ATU12345678', phone: '+43 662 000000', email: 'office@glanzwerk.example', web: 'www.glanzwerk.example', register: 'FN 000000 x, LG Salzburg' }
const bank = { iban: 'AT611904300234573201', bic: 'BKAUATWW', name: 'Bank Beispiel' }
const lhSettings = (letterhead = {}) => ({
  sender,
  bank,
  letterhead: { first: { path: 'fakturierung/briefpapier/erste-seite.png', at: '2026-11-05T10:00:00Z' }, next: { path: 'fakturierung/briefpapier/folgeseiten.png', at: '2026-11-05T10:00:00Z' }, nextMode: 'own', margins: { top: 50, topNext: 30, bottom: 30, left: 25, right: 20 }, ...letterhead },
})
const imagesFor = (settings) => ({ key: letterheadKey(letterheadOf(settings)), first: FIRST, next: NEXT })

/** PDF mit pdfmake setzen; liefert Seitenzahl, Bilder und die Lage jeder Textstelle (Seite, oben in mm). */
async function layout(dd) {
  const pdfMake = require('pdfmake/build/pdfmake.js')
  pdfMake.addVirtualFileSystem(require('pdfmake/build/vfs_fonts.js'))
  const nodes = []
  const doc = { ...dd, pageBreakBefore: (node) => (node.text !== undefined && node.startPosition && nodes.push({ text: typeof node.text === 'string' ? node.text : JSON.stringify(node.text), page: node.startPosition.pageNumber, top: node.startPosition.top / MM, left: node.startPosition.left / MM }), false) }
  const buffer = Buffer.from(await new Promise((resolve) => pdfMake.createPdf(doc).getBuffer(resolve)))
  const pdf = buffer.toString('latin1')
  return { pdf, pages: (pdf.match(/\/Type \/Page\b/g) || []).length, images: (pdf.match(/\/Subtype \/Image/g) || []).length, nodes }
}

const recipient = { name: 'Hausverwaltung Muster GmbH', address: 'Platz 2\n5020 Salzburg', uid: 'ATU87654321', customerNo: '10001' }
const invoice = (lines = 3, extra = {}) =>
  finalize(
    { id: 'd1', kind: 'rechnung', status: 'entwurf', date: '2026-11-03', serviceFrom: '2026-10-01', serviceTo: '2026-10-31', dueDate: '2026-11-17', recipient, lines: Array.from({ length: lines }, (_, i) => ({ id: `l${i}`, text: `Unterhaltsreinigung Stiege ${i + 1}`, qty: 1, unit: 'Monat', price: 100, vat: 20 })), ...extra },
    [],
    { sender, bank },
    { now: '2026-11-03T10:00:00Z', by: 'Büro' },
  )

// ---------------------------------------------------------------- Ränder

test('Briefpapier: ohne Einstellung bleiben die bisherigen Ränder, Fußzeile und Inhalt gleich', () => {
  const lh = letterheadOf({})
  assert.deepEqual(marginsPt(lh), { pageMargins: [40, 36, 40, 54], firstExtra: 0, firstTop: 36 })
  assert.equal(letterheadActive({}), false)
  const dd = invoiceDocument({ doc: invoice(), settings: { sender, bank } })
  assert.deepEqual(dd.pageMargins, [40, 36, 40, 54])
  assert.equal(dd.background, undefined)
  assert.ok(dd.content[0].columns, 'Kopf mit Logo und Absender zuerst, kein Abstand davor')
  const foot = dd.footer(1, 2)
  assert.deepEqual(foot.margin, [40, 10, 40, 0])
  assert.equal(foot.columns[1].text, 'Seite 1 von 2')
  assert.match(JSON.stringify(foot), /IBAN AT61 1904 3002 3457 3201/)
  assert.equal(dd.defaultStyle.font, 'Roboto')
})

test('Briefpapier: Ränder in mm → pt, oben auf der ersten Seite mehr Platz für den Kopf', () => {
  const lh = letterheadOf(lhSettings())
  const m = marginsPt(lh)
  assert.ok(near(m.pageMargins[0], 25 * MM) && near(m.pageMargins[1], 30 * MM) && near(m.pageMargins[2], 20 * MM) && near(m.pageMargins[3], 30 * MM), JSON.stringify(m))
  assert.ok(near(m.firstExtra, 20 * MM))
  // erste Seite oben weniger als die Folgeseiten: überall der größere Wert
  const small = marginsPt(letterheadOf({ letterhead: { margins: { top: 20, topNext: 35 } } }))
  assert.ok(near(small.pageMargins[1], 35 * MM) && small.firstExtra === 0)
  // nur „oben“ gesetzt: gilt auch für die Folgeseiten
  const only = letterheadOf({ letterhead: { margins: { top: '42,5' } } })
  assert.equal(only.margins.topNext, 42.5)
  // außerhalb der Grenzen: begrenzt; Unsinn: Standard
  const wild = letterheadOf({ letterhead: { margins: { top: 400, left: -3, right: 'x' } } })
  assert.equal(wild.margins.top, 150)
  assert.equal(wild.margins.left, 5)
  assert.equal(wild.margins.right, Math.round((DEFAULT_MARGINS_PT.right / MM) * 10) / 10)
})

test('Briefpapier: Hinweise zu Rändern und Fußzeile', () => {
  assert.deepEqual(marginProblems(letterheadOf(lhSettings())), [])
  const narrow = marginProblems(letterheadOf({ letterhead: { margins: { left: 60, right: 60 } } }))
  assert.match(narrow[0], /90 mm für den Text/)
  const tall = letterheadOf({ letterhead: { margins: { top: 50, bottom: 12 }, footer: ['a\nb\nc\nd\ne', '', '', ''] } })
  assert.ok(footerNeedMm(tall) > 12)
  assert.match(marginProblems(tall).join(' '), /Fußzeile braucht unten/)
  const swapped = marginProblems(letterheadOf({ letterhead: { margins: { top: 20, topNext: 35 } } }))
  assert.match(swapped.join(' '), /größere Wert/)
})

test('Briefpapier: Bild prüfen – PDF und andere Formate abgelehnt, A4 hoch, Auflösung', () => {
  assert.equal(checkLetterheadImage({ type: 'application/pdf', name: 'Briefpapier.pdf' }).error, 'pdf')
  assert.equal(checkLetterheadImage({ type: 'image/gif', name: 'a.gif', width: 10, height: 10 }).error, 'type')
  assert.deepEqual(checkLetterheadImage({ type: 'image/png', name: 'a.png', width: 1240, height: 1754 }), { warnings: [] })
  assert.deepEqual(checkLetterheadImage({ type: 'image/jpeg', name: 'a.jpg', width: 2480, height: 3508 }), { warnings: [] })
  assert.match(checkLetterheadImage({ type: 'image/png', width: 1754, height: 1240 }).warnings[0], /Querformat/)
  assert.match(checkLetterheadImage({ type: 'image/png', width: 1240, height: 1600 }).warnings[0], /Seitenverhältnis/)
  assert.match(checkLetterheadImage({ type: 'image/png', width: 600, height: 849 }).warnings[0], /etwa 73 dpi/)
  assert.equal(letterheadPath('first', 'image/png'), 'fakturierung/briefpapier/erste-seite.png')
  assert.equal(letterheadPath('next', 'image/jpeg'), 'fakturierung/briefpapier/folgeseiten.jpg')
})

// ---------------------------------------------------------------- Seite einrichten

test('Briefpapier: Hintergrund je Seite (erste, Folgeseiten eigen, wie die erste, ohne) nur mit passenden Bildern', () => {
  const s = lhSettings()
  const page = pageSetup(s, { images: imagesFor(s) })
  assert.deepEqual(page.images, { briefpapier1: FIRST, briefpapier2: NEXT })
  assert.deepEqual(page.background(1, A4), { image: 'briefpapier1', width: A4.width, height: A4.height, absolutePosition: { x: 0, y: 0 } })
  assert.equal(page.background(2, A4).image, 'briefpapier2')
  const same = lhSettings({ nextMode: 'same' })
  const p2 = pageSetup(same, { images: imagesFor(same) })
  assert.deepEqual(Object.keys(p2.images), ['briefpapier1'])
  assert.equal(p2.background(3, A4).image, 'briefpapier1')
  const none = lhSettings({ nextMode: 'none' })
  assert.equal(pageSetup(none, { images: imagesFor(none) }).background(2, A4), null)
  // Bilder zu einem anderen Stand (anderes Bild hochgeladen): kein Hintergrund statt des alten
  const stale = pageSetup(s, { images: { key: 'alt', first: FIRST, next: NEXT } })
  assert.equal(stale.background, null)
  // Standard: die von der Oberfläche bereitgelegten Bilder
  setLetterheadImages(imagesFor(s))
  assert.equal(invoiceDocument({ doc: invoice(), settings: s }).images.briefpapier1, FIRST)
  setLetterheadImages(null)
  assert.equal(invoiceDocument({ doc: invoice(), settings: s }).background, undefined)
})

test('Briefpapier: Logo, Absender, Absenderzeile und Fußzeile der App ausblenden; eigene Fußzeile in Spalten', () => {
  const s = lhSettings({ hideLogo: true, hideSender: true, hideReturnLine: true, hideFooter: true })
  const dd = invoiceDocument({ doc: invoice(), settings: s, letterhead: imagesFor(s), logo: { svg: '<svg/>' } })
  const json = JSON.stringify(dd.content)
  assert.doesNotMatch(json, /<svg\/>/, 'kein Logo')
  assert.doesNotMatch(json, /Tel\. \+43 662 000000/, 'kein Absender oben rechts')
  assert.doesNotMatch(json, /Glanzwerk Reinigung GmbH · Musterstraße 1/, 'keine Absenderzeile')
  assert.match(json, /Hausverwaltung Muster GmbH/)
  assert.deepEqual(dd.footer(2, 3).columns[1], { text: 'Seite 2 von 3', alignment: 'right', fontSize: 7, color: dd.footer(2, 3).columns[1].color, width: 70 })
  assert.doesNotMatch(JSON.stringify(dd.footer(1, 1)), /IBAN/)
  assert.equal(pageSetup(lhSettings({ hideFooter: true, pageNumbers: false })).footer(() => ({ columns: [] }))(1, 1), null)
  // nur das Logo aus: Absender bleibt
  const one = invoiceDocument({ doc: invoice(), settings: lhSettings({ hideLogo: true }), logo: { svg: '<svg/>' } })
  assert.equal(one.content.find((c) => c.columns)?.columns[0].text, '')
  assert.match(JSON.stringify(one.content), /Tel\. \+43 662 000000/)
  // eigene Fußzeile: bis 4 Spalten und die Seitenzahl
  const cols = suggestFooter(sender, bank)
  assert.equal(cols.length, 4)
  assert.match(cols[2], /IBAN AT61 1904 3002 3457 3201\nBIC BKAUATWW/)
  const own = invoiceDocument({ doc: invoice(), settings: lhSettings({ footer: cols }) })
  const foot = own.footer(1, 2)
  assert.equal(foot.columns.length, 5)
  assert.equal(foot.columns[0].text, 'Glanzwerk Reinigung GmbH\nMusterstraße 1\n5020 Salzburg')
  assert.ok(near(foot.margin[0], 25 * MM) && near(foot.margin[2], 20 * MM))
  const noNum = invoiceDocument({ doc: invoice(), settings: lhSettings({ footer: cols, pageNumbers: false }) })
  assert.equal(noNum.footer(1, 2).columns.length, 4)
  // Fußzeile der App ohne Seitenzahl
  assert.equal(invoiceDocument({ doc: invoice(), settings: lhSettings({ pageNumbers: false }) }).footer(1, 2).columns.length, 1)
})

test('Briefpapier: Akzentfarbe lesbar (≥ 4,5:1), Schrift und Grundgröße', () => {
  const s = lhSettings({ accent: '#7fc8f8', fontSize: 10 })
  const dd = invoiceDocument({ doc: invoice(), settings: s })
  assert.ok(contrast(dd.styles.title.color, '#ffffff') >= 4.5, dd.styles.title.color)
  assert.ok(contrast(dd.styles.th.color, dd.styles.th.fillColor) >= 4.5)
  assert.equal(dd.defaultStyle.fontSize, 10)
  assert.equal(dd.defaultStyle.font, 'Roboto')
  // unbekannte Schrift (nicht in pdfmake eingebettet): Roboto
  assert.equal(letterheadOf({ letterhead: { font: 'Comic Sans' } }).font, 'Roboto')
  assert.equal(letterheadActive(s), true)
})

test('Briefpapier: im gesetzten PDF liegt das Bild hinten und kein Text im Kopf oder Fuß', async () => {
  const s = lhSettings({ hideLogo: true, hideSender: true })
  const r = await layout(invoiceDocument({ doc: invoice(45), settings: s, letterhead: imagesFor(s) }))
  assert.ok(r.pages >= 2, `${r.pages} Seiten`)
  assert.equal(r.images, 2, 'erste Seite und Folgeseiten je einmal eingebettet')
  const body = r.nodes.filter((n) => n.text.trim())
  const first = body.filter((n) => n.page === 1)
  const later = body.filter((n) => n.page > 1)
  assert.ok(Math.min(...first.map((n) => n.top)) >= 50 - 0.01, `erste Seite oben ${Math.min(...first.map((n) => n.top))} mm`)
  assert.ok(later.length && Math.min(...later.map((n) => n.top)) >= 30 - 0.01, `Folgeseite oben ${Math.min(...later.map((n) => n.top))} mm`)
  assert.ok(Math.min(...body.map((n) => n.left)) >= 25 - 0.01)
  // Mahnung: dasselbe Briefpapier
  const inv = invoice(2)
  const reminder = reminderFor(inv, [inv], { today: '2026-12-20', settings: s })
  const rr = await layout(reminderDocument({ doc: inv, reminder, settings: s, letterhead: imagesFor(s), today: '2026-12-20' }))
  assert.equal(rr.images, 1)
  assert.ok(Math.min(...rr.nodes.filter((n) => n.text.trim()).map((n) => n.top)) >= 50 - 0.01)
})

// ---------------------------------------------------------------- Brief: Empfänger und Platzhalter

const customer = {
  id: 'c1',
  customerNo: '10001',
  name: 'Hausverwaltung Muster GmbH',
  salutation: 'Herr',
  firstName: 'Karl',
  lastName: 'Maier',
  street: 'Ringstraße 3',
  zip: '5020',
  city: 'Salzburg',
  email: 'buchhaltung@hv-muster.example',
  group: 'Hausverwaltung',
  objectIds: ['o1'],
  contacts: [
    { id: 'p1', name: 'Frau Mag. Eva Huber, MBA', role: 'Buchhaltung', email: 'eva.huber@hv-muster.example' },
    { id: 'p2', name: 'Paul Muster', role: 'Objektbetreuung', email: '' },
  ],
}

test('Brief: Ansprechpartner zerlegen und Anrede', () => {
  assert.deepEqual(splitContactName('Frau Mag. Eva Huber, MBA'), { salutation: 'Frau', title: 'Mag.', firstName: 'Eva', lastName: 'Huber' })
  assert.deepEqual(splitContactName('Herrn DI Dr. Franz Josef Gruber'), { salutation: 'Herr', title: 'DI Dr.', firstName: 'Franz Josef', lastName: 'Gruber' })
  assert.deepEqual(splitContactName('Paul Muster'), { salutation: '', title: '', firstName: 'Paul', lastName: 'Muster' })
  assert.equal(contactGreeting(customer.contacts[0], customer), 'Sehr geehrte Frau Mag. Huber')
  assert.equal(contactGreeting(customer.contacts[1], customer), 'Sehr geehrter Herr Maier', 'ohne Herr/Frau: Anrede des Kunden')
  assert.equal(contactGreeting({ name: 'Paul Muster' }, {}), 'Sehr geehrte Damen und Herren')
})

test('Brief: Anschrift mit z. H. des Ansprechpartners, E-Mail des Ansprechpartners vor der des Kunden', () => {
  const plain = letterRecipient(customer)
  assert.equal(plain.address, 'z. H. Herr Karl Maier\nRingstraße 3\n5020 Salzburg')
  assert.equal(plain.email, 'buchhaltung@hv-muster.example')
  const r = letterRecipient(customer, customer.contacts[0])
  assert.deepEqual(r, { name: 'Hausverwaltung Muster GmbH', address: 'z. H. Frau Mag. Eva Huber, MBA\nRingstraße 3\n5020 Salzburg', email: 'eva.huber@hv-muster.example', customerNo: '10001' })
  assert.equal(letterRecipient(customer, customer.contacts[1]).email, 'buchhaltung@hv-muster.example', 'Ansprechpartner ohne E-Mail')
  // Privatkunde: Name aus den Personenfeldern
  assert.equal(letterRecipient({ salutation: 'Frau', firstName: 'Anna', lastName: 'Berger', street: 'Weg 1', zip: '5020', city: 'Salzburg' }).name, 'Anna Berger')
})

test('Brief: Platzhalter mit fillPlaceholders – Anrede des Ansprechpartners, Betreff, Datum, Firma, Benutzer', () => {
  const settings = { sender, bank }
  const letter = { id: 'br1', customerId: 'c1', contactId: 'p1', date: '2026-11-05', objectName: 'Wohnanlage Lehen', subject: 'Preisanpassung {Objekt} ab {Heute}', text: '{Anrede},\n\nzu „{Betreff}“: Kundennummer {Kundennummer}, {Kunde}.\n\nMit freundlichen Grüßen\n{Benutzer}\n{Firma}\n{Unbekannt}' }
  const ctx = letterContext({ letter, customer, settings, user: 'Petra Leitner', today: '2026-11-04' })
  assert.equal(ctx.Anrede, 'Sehr geehrte Frau Mag. Huber')
  assert.equal(ctx.Datum, '05.11.2026')
  assert.equal(ctx.Ansprechpartner, 'Frau Mag. Eva Huber, MBA')
  assert.equal(ctx.Belegart, 'Brief')
  const out = resolveLetter(letter, { customer, settings, user: 'Petra Leitner', today: '2026-11-04' })
  assert.equal(out.subject, 'Preisanpassung Wohnanlage Lehen ab 04.11.2026')
  assert.equal(out.text, 'Sehr geehrte Frau Mag. Huber,\n\nzu „Preisanpassung Wohnanlage Lehen ab 04.11.2026“: Kundennummer 10001, Hausverwaltung Muster GmbH.\n\nMit freundlichen Grüßen\nPetra Leitner\nGlanzwerk Reinigung GmbH\n{Unbekannt}')
  assert.match(out.mailText, /^Sehr geehrte Frau Mag\. Huber,\n\nanbei erhalten Sie unser Schreiben „Preisanpassung Wohnanlage Lehen ab 04\.11\.2026“ als PDF\./)
  assert.equal(out.recipient.email, 'eva.huber@hv-muster.example')
  // ohne Ansprechpartner: Anrede des Kunden
  assert.equal(letterContext({ letter: { ...letter, contactId: '' }, customer, settings }).Anrede, 'Sehr geehrter Herr Maier')
})

test('Brief: Dateiname, Ablage je Jahr, Verlauf und Zustand', () => {
  const l = { id: 'brlz3kab12', date: '2026-11-05', subject: 'Preisanpassung 2027: Unterhaltsreinigung', recipient: { name: 'Hausverwaltung Müller & Söhne GmbH' } }
  assert.equal(letterFileName(l), 'Brief_2026-11-05_Hausverwaltung-Mueller-Soehne-GmbH_Preisanpassung-2027-Unterhaltsreinigung_ab12.pdf')
  assert.equal(letterArchivePath(l), `fakturierung/briefe/2026/${letterFileName(l)}`)
  const list = [{ id: 'a', customerId: 'c1', date: '2026-10-01' }, { id: 'b', customerId: 'c2', date: '2026-11-01' }, { id: 'c', customerId: 'c1', date: '2026-11-02', sent: [{ at: '2026-11-02T08:00:00Z', to: 'x@y.at', via: 'graph' }] }]
  assert.deepEqual(customerLetters(list, 'c1').map((x) => x.id), ['c', 'a'])
  assert.equal(letterState(list[2]).text, 'per E-Mail an x@y.at')
  assert.equal(letterState({ printedAt: '2026-11-02' }).key, 'gedruckt')
  assert.equal(letterState({}).key, 'entwurf')
})

// ---------------------------------------------------------------- Serienbrief: Empfänger

const today = '2026-11-05'
const customers = [
  customer,
  { id: 'c2', name: 'Autohaus Beispiel KG', group: 'Gewerbe', email: 'office@autohaus.example', objectIds: ['o2'] },
  { id: 'c3', name: 'Partner Reinigung GmbH', group: 'Subauftrag', email: '', objectIds: [] },
  { id: 'c4', salutation: 'Frau', firstName: 'Anna', lastName: 'Berger', consumer: true, email: 'anna@berger.example', objectIds: [], noAds: true },
  { id: 'c5', name: 'Alte Firma GmbH', group: 'Hausverwaltung', email: 'alt@firma.example', objectIds: ['o1'], active: false },
  { id: 'c6', name: 'Schläfer GmbH', group: 'Gewerbe', email: 'x@schlaefer.example', objectIds: ['o9'] },
]
const env = {
  today,
  documents: [
    { id: 'd1', customerId: 'c3', number: 'RE-2026-0001', date: '2026-03-01' },
    { id: 'd2', customerId: 'c6', number: 'RE-2023-0001', date: '2023-01-10' },
    { id: 'd3', customerId: 'c4', number: '', date: '2026-10-01' },
  ],
  recurring: [{ id: 'r1', customerId: 'c4', active: true }],
  objects: [{ id: 'o1' }, { id: 'o2' }, { id: 'o9', active: false }],
}

test('Serienbrief: aktive Kunden (Beleg in 24 Monaten, Dauerauftrag, aktives Objekt; nicht inaktiv markiert)', () => {
  assert.equal(customerActive(customers[0], env), true, 'aktives Objekt')
  assert.equal(customerActive(customers[2], env), true, 'Rechnung 2026')
  assert.equal(customerActive(customers[3], env), true, 'Dauerauftrag (Entwurf zählt nicht, Dauerauftrag schon)')
  assert.equal(customerActive(customers[4], env), false, 'als inaktiv markiert')
  assert.equal(customerActive(customers[5], env), false, 'letzte Rechnung 2023, Objekt inaktiv')
  const list = serialRecipients(customers, { ...env, scope: 'aktiv' })
  assert.deepEqual(list.map((x) => x.id).sort(), ['c1', 'c2', 'c3', 'c4'])
})

test('Serienbrief: nach Gruppe, Objekt, Firmen/Privat, Suche; abgewählte bleiben in der Liste', () => {
  assert.deepEqual(serialRecipients(customers, { ...env, scope: 'gruppe', group: 'Hausverwaltung' }).map((x) => x.id), ['c5', 'c1'])
  assert.deepEqual(serialRecipients(customers, { ...env, scope: 'objekt', objectId: 'o1' }).map((x) => x.id), ['c5', 'c1'])
  assert.deepEqual(serialRecipients(customers, { ...env, scope: 'alle', type: 'privat' }).map((x) => x.id), ['c4'])
  assert.equal(serialRecipients(customers, { ...env, scope: 'alle', type: 'firma' }).length, 5)
  assert.deepEqual(serialRecipients(customers, { ...env, scope: 'alle', search: 'huber' }).map((x) => x.id), ['c1'], 'Suche auch über Ansprechpartner')
  const list = serialRecipients(customers, { ...env, scope: 'aktiv', excluded: ['c2'] })
  assert.equal(list.find((x) => x.id === 'c2').selected, false)
  assert.deepEqual(serialCounts(list), { all: 4, selected: 3, mail: 2, print: 1 })
})

test('Serienbrief: Ansprechpartner nach Funktion, ohne E-Mail ins Sammel-PDF, Werbung nicht an Kunden mit Widerspruch', () => {
  const list = serialRecipients(customers, { ...env, scope: 'aktiv', role: 'buchhaltung' })
  const hv = list.find((x) => x.id === 'c1')
  assert.equal(hv.contact.id, 'p1')
  assert.equal(hv.email, 'eva.huber@hv-muster.example')
  assert.match(hv.recipient.address, /^z\. H\. Frau Mag\. Eva Huber, MBA\n/)
  assert.match(list.find((x) => x.id === 'c2').note, /kein Ansprechpartner „buchhaltung“/)
  const partner = list.find((x) => x.id === 'c3')
  assert.equal(partner.viaMail, false)
  assert.match(partner.note, /ohne E-Mail/)
  // Information: auch an Kunden mit Werbewiderspruch per E-Mail; Werbung: nicht
  assert.equal(list.find((x) => x.id === 'c4').viaMail, true)
  const ads = serialRecipients(customers, { ...env, scope: 'aktiv', advertising: true })
  const anna = ads.find((x) => x.id === 'c4')
  assert.equal(anna.viaMail, false)
  assert.equal(anna.email, '')
  assert.match(anna.note, /Werbung per E-Mail abgelehnt/)
  assert.deepEqual(serialCounts(ads), { all: 4, selected: 4, mail: 2, print: 2 })
})

// ---------------------------------------------------------------- Brief als PDF, Sammel-PDF

const letterOf = (id, n = 1, extra = {}) => ({ id, date: '2026-11-05', subject: `Information ${id}`, text: Array.from({ length: n }, (_, i) => `Absatz ${i + 1}: Wir informieren Sie über die neuen Reinigungszeiten in Ihrem Objekt.`).join('\n\n'), recipient: { name: `Kunde ${id}`, address: 'Weg 1\n5020 Salzburg', customerNo: '1000' }, author: 'Petra Leitner', ...extra })

test('Brief-PDF: Briefpapier, Anschrift, Betreff, Text; kein Text im Kopf', async () => {
  const s = lhSettings({ hideLogo: true, hideSender: true })
  const dd = letterDocument({ letter: letterOf('a', 3, { objectName: 'Wohnanlage Lehen' }), settings: s, letterhead: imagesFor(s) })
  const json = JSON.stringify(dd.content)
  for (const t of ['Kunde a', 'Weg 1', 'Information a', 'Absatz 3', 'Bearbeitet von', 'Petra Leitner', 'Wohnanlage Lehen', 'Kundennummer', '05.11.2026']) assert.ok(json.includes(t), t)
  const r = await layout(dd)
  assert.equal(r.pages, 1)
  assert.equal(r.images, 1)
  assert.ok(Math.min(...r.nodes.filter((n) => n.text.trim()).map((n) => n.top)) >= 50 - 0.01)
})

test('Sammel-PDF: jeder Brief auf neuer Seite mit dem Briefpapier der ersten Seite, Seitenzahl je Brief', async () => {
  const s = lhSettings()
  assert.deepEqual(pageStarts([1, 2, 1]), [1, 2, 4])
  const letters = [letterOf('a'), letterOf('b', 40), letterOf('c')]
  // Seitenzahl je Brief: einzeln setzen (wie die Oberfläche)
  const counts = []
  for (const l of letters) counts.push((await layout(letterDocument({ letter: l, settings: s }))).pages)
  assert.deepEqual(counts.map((n) => n > 1), [false, true, false])
  const starts = pageStarts(counts)
  const dd = lettersDocument({ letters, settings: s, letterhead: imagesFor(s), starts })
  const total = counts.reduce((a, b) => a + b, 0)
  const r = await layout(dd)
  assert.equal(r.pages, total)
  // Hintergrund: erste Seite jedes Briefs das erste Bild, sonst das der Folgeseiten
  for (let p = 1; p <= total; p++) assert.equal(dd.background(p, A4).image, starts.includes(p) ? 'briefpapier1' : 'briefpapier2', `Seite ${p}`)
  assert.equal(dd.footer(starts[2], total).columns[1].text, 'Seite 1 von 1')
  assert.equal(dd.footer(starts[1] + 1, total).columns[1].text, `Seite 2 von ${counts[1]}`)
  // jeder Brief beginnt oben auf seiner Seite unter dem Kopf (50 mm)
  for (const [i, l] of letters.entries()) {
    const head = r.nodes.find((n) => n.text.includes(`Kunde ${l.id}`))
    assert.equal(head.page, starts[i], `Brief ${l.id} auf Seite ${starts[i]}`)
    assert.ok(head.top >= 50, `${head.top} mm`)
  }
})
