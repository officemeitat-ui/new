// Posteingang (core/posteingang.js): E-Mail-Leser (.eml mit MIME), Regeln, KI-Anfrage und Prüfung, Ablage mit
// Aufräumen, Postfach über Graph (nur lesen), Übergaben an die Module, Rechte.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { scopesFor } from '../src/auth/msal.js'
import { resolveAccess } from '../src/core/access.js'
import { KI_LIMITS } from '../src/core/ki-vorschlag.js'
import {
  attachmentsFromGraph,
  checkPosteingang,
  cleanupPosteingang,
  contactsInText,
  decodeWords,
  emptyPosteingang,
  entryFor,
  filterEntries,
  findCreated,
  folderLookupUrls,
  handoversFor,
  hashOf,
  healthHint,
  htmlToText,
  isOutlookMsg,
  kiBlocked,
  kiCandidates,
  listUrl,
  mailBase,
  mailScope,
  maskText,
  messageKey,
  messageUrl,
  msgFromGraph,
  newCount,
  parseAddressList,
  parseEml,
  parseMailDate,
  parseParams,
  PE_ARTEN,
  posteingangRequest,
  prefillFor,
  ruleContext,
  ruleGuess,
  setArt,
  setStatus,
  settingsOf,
  trimQuoted,
  upsertEntry,
  wellKnownFolder,
} from '../src/core/posteingang.js'
import { classifyMail } from '../src/ai/extract.js'
import { dataRights, FOLDERS, MODULE_DOCS } from '../src/storage/data-service.js'

const CRLF = (lines) => lines.join('\r\n')
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')

// ---------------------------------------------------------------- E-Mail lesen

test('EML: Kopf mit RFC 2047 (B und Q, UTF-8 und Latin-1, geteilte Umlaute), Datum mit Zeitzone', () => {
  const eml = CRLF([
    'From: =?UTF-8?Q?Paul_M=C3=BCller?= <Objekte@HV-Beispiel.example>',
    'To: "Huber, Eva" <eva@firma.example>, office@firma.example',
    // „Größe“ in zwei Wörtern, das „ö“ (C3 B6) über die Grenze geteilt
    'Subject: =?UTF-8?B?R3LD?= =?UTF-8?B?tsOfZQ==?= und =?ISO-8859-1?Q?Gr=FC=DFe?=',
    'Date: Mon, 9 Nov 2026 10:15:00 +0100',
    'Message-ID: <abc@hv.example>',
    '',
    'Hallo',
  ])
  const m = parseEml(eml)
  assert.deepEqual(m.from, { name: 'Paul Müller', email: 'objekte@hv-beispiel.example' })
  assert.deepEqual(m.to, [{ name: 'Huber, Eva', email: 'eva@firma.example' }, { name: '', email: 'office@firma.example' }])
  assert.equal(m.subject, 'Größe und Grüße')
  assert.equal(m.date, '2026-11-09T09:15:00.000Z')
  assert.equal(m.messageId, 'abc@hv.example')
  assert.equal(m.text, 'Hallo')
  assert.equal(decodeWords('=?utf-8?q?A=3DB_=E2=82=AC?='), 'A=B €')
  assert.equal(decodeWords('kein =?kaputt'), 'kein =?kaputt')
  assert.equal(parseMailDate('Tue, 3 Feb 2026 23:30:00 -0500'), '2026-02-04T04:30:00.000Z')
  assert.equal(parseMailDate('9 Nov 26 08:00 GMT'), '2026-11-09T08:00:00.000Z')
  assert.equal(parseMailDate('kein Datum'), '')
})

test('EML: multipart/alternative nimmt den Text, quoted-printable mit weichem Umbruch, Anhang base64 mit RFC-2231-Namen', () => {
  const pdf = '%PDF-1.4\nRechnung\n%%EOF'
  const eml = CRLF([
    'From: Max <max@autohaus.example>',
    'Subject: Grundreinigung',
    'Content-Type: multipart/mixed; boundary="AAA"',
    '',
    'Präambel wird übergangen',
    '--AAA',
    'Content-Type: multipart/alternative; boundary="BBB"',
    '',
    '--BBB',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Bitte zus=C3=A4tzlich eine Grundreinigung des Schaur=',
    'aums.   ',
    '',
    '--BBB',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>HTML-Fassung</p>',
    '--BBB--',
    '--AAA',
    'Content-Type: application/pdf; name="=?utf-8?Q?alt.pdf?="',
    "Content-Disposition: attachment; filename*=UTF-8''Rechnung%20%C3%BCber%201.pdf",
    'Content-Transfer-Encoding: base64',
    '',
    b64(pdf).replace(/(.{8})/g, '$1\r\n'),
    '--AAA--',
    'Nachwort wird übergangen',
  ])
  const m = parseEml(eml)
  assert.equal(m.text, 'Bitte zusätzlich eine Grundreinigung des Schauraums.')
  assert.equal(m.html, false)
  assert.equal(m.attachments.length, 1)
  const a = m.attachments[0]
  assert.equal(a.name, 'Rechnung über 1.pdf')
  assert.equal(a.type, 'application/pdf')
  assert.equal(Buffer.from(a.data).toString('utf8'), pdf)
  assert.equal(a.size, pdf.length)
  assert.equal(a.inline, false)
})

test('EML: verschachteltes multipart/mixed mit related, Bild im Text, weitergeleiteter Nachricht und Latin-1', () => {
  const eml = CRLF([
    'From: info@x.example',
    'Subject: Weiterleitung',
    'Content-Type: multipart/mixed; boundary=outer',
    '',
    '--outer',
    'Content-Type: multipart/mixed; boundary="inner"',
    '',
    '--inner',
    'Content-Type: multipart/related; boundary="rel"',
    '',
    '--rel',
    'Content-Type: text/html; charset=iso-8859-1',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<html><head><style>p{color:red}</style><title>x</title></head><body><p>Sch=F6ne Gr=FC=DFe&nbsp;&amp; Dank</p><ul><li>eins</li><li>zwei</li></ul><!-- weg --><script>alert(1)</script>Ende&#8364;</body></html>',
    '--rel',
    'Content-Type: image/png',
    'Content-ID: <logo@x>',
    'Content-Transfer-Encoding: base64',
    '',
    'iVBORw0KGgo=',
    '--rel--',
    '--inner',
    'Content-Type: message/rfc822',
    'Content-Disposition: attachment',
    '',
    'From: alt@x.example',
    'Subject: alt',
    '',
    'alter Text',
    '--inner--',
    '--outer',
    'Content-Type: text/plain; charset=utf-8; name="notiz.txt"',
    'Content-Disposition: attachment; filename="notiz.txt"',
    '',
    'Notiz',
    '--outer--',
  ])
  const m = parseEml(eml)
  assert.equal(m.html, true)
  assert.equal(m.text, 'Schöne Grüße & Dank\n\n- eins\n- zwei\nEnde€')
  assert.deepEqual(m.attachments.map((a) => [a.name, a.type, a.inline]), [
    ['Anhang-1.png', 'image/png', true],
    ['Anhang-2.eml', 'message/rfc822', false],
    ['notiz.txt', 'text/plain', false],
  ])
  assert.equal(m.attachments[0].cid, 'logo@x')
  assert.match(Buffer.from(m.attachments[1].data).toString(), /Subject: alt/)
})

test('EML: 8-Bit-Text ohne Kodierung, Bytes als Eingabe, ohne Leerzeile, .msg erkannt', () => {
  const bytes = Buffer.concat([Buffer.from('From: Bäckerei <b@x.example>\nSubject: Grüße\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\n', 'utf8'), Buffer.from('Schöne Grüße\n', 'utf8')])
  const m = parseEml(new Uint8Array(bytes))
  assert.equal(m.from.name, 'Bäckerei')
  assert.equal(m.subject, 'Grüße')
  assert.equal(m.text, 'Schöne Grüße')
  // Latin-1 ohne Angabe: kein Ersatzzeichen
  const latin = parseEml(new Uint8Array([...Buffer.from('Subject: x\n\n'), 0x47, 0x72, 0xfc, 0xdf, 0x65]))
  assert.equal(latin.text, 'Grüße')
  assert.equal(parseEml('Subject: nur Kopf').subject, 'nur Kopf')
  assert.ok(isOutlookMsg('Mail.MSG'))
  assert.ok(isOutlookMsg('x.bin', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1])))
  assert.ok(!isOutlookMsg('x.eml', new Uint8Array([0x46, 0x72])))
})

test('EML: Hilfen für Adressen, Parameter, HTML und Zitate', () => {
  assert.deepEqual(parseAddressList('max@x.example (Max Muster); "A <b>" <a@b.example>'), [{ name: 'Max Muster', email: 'max@x.example' }, { name: 'A <b>', email: 'a@b.example' }])
  assert.deepEqual(parseParams('Text/Plain; charset="UTF-8"; format=flowed'), { value: 'text/plain', params: { charset: 'UTF-8', format: 'flowed' } })
  // RFC 2231 mit Fortsetzungen
  assert.equal(parseParams("attachment; filename*0*=UTF-8''Rech; filename*1*=nung%C3%BC.pdf").params.filename, 'Rechnungü.pdf')
  assert.equal(htmlToText('<div>a<br>b</div><table><tr><td>c</td><td>d</td></tr></table>'), 'a\nb\nc d')
  assert.equal(trimQuoted('Danke, passt.\n\nAm 3.11.2026 um 10:00 schrieb Max <m@x.at>:\n> alt\n> alt'), 'Danke, passt.')
  assert.equal(trimQuoted('Neu\n\nVon: Büro\nGesendet: Montag\nAn: x\nBetreff: y\n\nalt'), 'Neu')
  assert.equal(trimQuoted('> nur Zitat'), '> nur Zitat')
  assert.equal(hashOf('abc'), hashOf(new TextEncoder().encode('abc')))
  assert.notEqual(hashOf('abc'), hashOf('abd'))
  assert.equal(messageKey({ messageId: 'X@Y' }), messageKey({ messageId: 'x@y' }))
})

// ---------------------------------------------------------------- Regeln

const CTX = ruleContext(
  {
    customers: [
      { id: 'c1', name: 'Hausverwaltung Beispiel GmbH', email: 'buchhaltung@hv-beispiel.example', contacts: [{ email: 'objekte@hv-beispiel.example' }], objectIds: ['o5', 'o11'], paymentDays: 14, hourRate: 38, iban: 'AT611904300234573201' },
      { id: 'c2', name: 'Autohaus Maxglan Beispiel KG', email: 'rechnung@autohaus-beispiel.example', objectIds: ['o2'] },
      { id: 'c3', name: '', firstName: 'Eva', lastName: 'Privat', email: 'eva.privat@gmail.com', objectIds: [] },
    ],
    suppliers: [{ id: 's1', name: 'Hygiene-Großhandel Beispiel GmbH', email: 'rechnung@hygiene-beispiel.example', contacts: [] }],
    objects: [
      { id: 'o2', name: 'Autohaus Maxglan', address: '5020 Salzburg-Maxglan' },
      { id: 'o5', name: 'Wohnanlage Lehen', address: 'Ignaz-Harrer-Straße 12, 5020 Salzburg' },
      { id: 'o7', name: 'Arztpraxis Liefering', address: '5020 Salzburg-Liefering' },
      { id: 'o11', name: 'Versicherungsbüro Lehen', address: '' },
    ],
    employees: [{ id: 'e2', name: 'Markus Huber', email: '' }, { id: 'e3', name: 'Ana Popescu', email: 'ana@reinigung.example' }],
  },
  { customerName: (c) => c.name || [c.firstName, c.lastName].join(' ') },
)
const mail = (from, subject, text = '', extra = {}) => ({ from: typeof from === 'string' ? { name: '', email: from } : from, subject, text, attachments: [], ...extra })

test('Regeln: Reklamation vom Kunden mit Objekt im Text', () => {
  const r = ruleGuess(mail('objekte@hv-beispiel.example', 'Stiegenhaus', 'Das Stiegenhaus der Wohnanlage Lehen wurde nicht gereinigt, alles verschmutzt.'), CTX)
  assert.equal(r.art, 'reklamation')
  assert.equal(r.customerId, 'c1')
  assert.equal(r.objectId, 'o5')
  assert.ok(r.reasons.some((x) => /Kunde „Hausverwaltung/.test(x)) && r.reasons.some((x) => /Objekt „Wohnanlage Lehen“/.test(x)))
  assert.equal(r.health, false)
  // Adresse statt Objektname
  assert.equal(ruleGuess(mail('objekte@hv-beispiel.example', 'Mängel', 'In der Ignaz-Harrer-Straße 12 ist der Keller schmutzig.'), CTX).objectId, 'o5')
  // gleiche Domain wie der Kunde, Objekt als einziges des Kunden
  const d = ruleGuess(mail('verkauf@autohaus-beispiel.example', 'Beschwerde', 'Der Boden ist dreckig.'), CTX)
  assert.equal(d.customerId, 'c2')
  assert.equal(d.objectId, 'o2')
  assert.ok(d.reasons.some((x) => /gleiche Domain/.test(x)) && d.reasons.some((x) => /einziges Objekt/.test(x)))
  // Freemail: Domain sagt nichts
  assert.equal(ruleGuess(mail('wer@gmail.com', 'Hallo', 'Frage'), CTX).customerId, '')
  assert.equal(ruleGuess(mail('eva.privat@gmail.com', 'Hallo', 'Frage'), CTX).customerId, 'c3')
  // dringend
  assert.equal(ruleGuess(mail('objekte@hv-beispiel.example', 'Wasserschaden', 'Bitte sofort kommen'), CTX).urgency, 'hoch')
})

test('Regeln: Eingangsrechnung, Zusatzauftrag, Anfrage, Kündigung, Termin, Bewerbung, Sonstiges', () => {
  const pdf = { name: 'Rechnung_2026-1187.pdf', type: 'application/pdf' }
  const er = ruleGuess(mail('rechnung@hygiene-beispiel.example', 'Ihre Rechnung', 'Im Anhang die Rechnung.', { attachments: [pdf] }), CTX)
  assert.equal(er.art, 'eingangsrechnung')
  assert.equal(er.supplierId, 's1')
  assert.ok(er.reasons.some((x) => /Anhang „Rechnung_2026-1187\.pdf“/.test(x)))
  // PDF direkt abgelegt (ohne Text)
  assert.equal(ruleGuess({ subject: 'scan_001.pdf', text: '', direct: true, attachments: [{ name: 'scan_001.pdf', type: 'application/pdf' }] }, CTX).art, 'eingangsrechnung')
  // „Rechnung“ ohne Beleg vom Kunden ist keine Eingangsrechnung
  assert.notEqual(ruleGuess(mail('buchhaltung@hv-beispiel.example', 'Frage zur Rechnung', 'Die Rechnung ist zu hoch.'), CTX).art, 'eingangsrechnung')
  assert.equal(ruleGuess(mail('rechnung@autohaus-beispiel.example', 'Zusätzliche Grundreinigung', 'Bitte um ein Angebot für eine einmalige Grundreinigung im Schauraum.'), CTX).art, 'zusatzauftrag')
  const neu = ruleGuess(mail({ name: 'Sabine Leitgeb', email: 'office@kanzlei.example' }, 'Anfrage Büroreinigung', 'Wir suchen eine Reinigungsfirma, bitte um ein unverbindliches Angebot und einen Termin zur Besichtigung.'), CTX)
  assert.equal(neu.art, 'anfrage_neukunde')
  assert.equal(neu.customerId, '')
  assert.equal(ruleGuess(mail('rechnung@autohaus-beispiel.example', 'Kündigung Reinigungsvertrag', 'Hiermit kündigen wir den Vertrag fristgerecht.'), CTX).art, 'kuendigung')
  assert.equal(ruleGuess(mail('objekte@hv-beispiel.example', 'Termin Begehung', 'Können wir nächste Woche eine Begehung im Versicherungsbüro Lehen machen?'), CTX).art, 'terminwunsch')
  assert.equal(ruleGuess(mail('jelena@mail.example', 'Bewerbung als Reinigungskraft', 'Ich bewerbe mich, Lebenslauf anbei.'), CTX).art, 'bewerbung')
  const s = ruleGuess(mail('newsletter@brief.example', 'Newsletter November', 'Lesen Sie in dieser Ausgabe …'), CTX)
  assert.equal(s.art, 'sonstiges')
  assert.ok(s.reasons.includes('kein eindeutiges Stichwort'))
})

test('Regeln: Krankmeldung aus dem Team, Gesundheitsdaten erkannt, „Arztpraxis“ ist kein Hinweis', () => {
  const k = ruleGuess(mail({ name: 'Markus Huber', email: 'm.huber@mail.example' }, 'heute', 'Ich bin krank und komme nicht.'), CTX)
  assert.equal(k.art, 'krankmeldung')
  assert.equal(k.employeeId, 'e2')
  assert.ok(k.health && k.personal)
  const strong = ruleGuess(mail('wer@gmail.com', 'Krankmeldung', 'AU-Bestätigung folgt'), CTX)
  assert.equal(strong.art, 'krankmeldung')
  // Kunde erwähnt eine kranke Reinigungskraft: Art bleibt, aber Gesundheitsdaten (nicht an die KI)
  const c = ruleGuess(mail('objekte@hv-beispiel.example', 'Reklamation', 'Ihre Reinigungskraft war krank und niemand gekommen.'), CTX)
  assert.equal(c.art, 'reklamation')
  assert.ok(c.health)
  assert.ok(c.reasons.some((x) => /Gesundheitsdaten/.test(x)))
  const praxis = ruleGuess(mail('objekte@hv-beispiel.example', 'Arztpraxis Liefering', 'Bitte die Arztpraxis Liefering zusätzlich reinigen.'), CTX)
  assert.equal(praxis.health, false)
  assert.equal(praxis.objectId, 'o7')
  assert.deepEqual(healthHint({ subject: 'x', text: 'arbeitsunfähig seit Montag' }).words, ['arbeitsunfähig'])
  // Mitarbeiterin per E-Mail-Adresse
  assert.equal(ruleGuess(mail('ana@reinigung.example', 'Frage', 'Wann ist Teamsitzung?'), CTX).employeeId, 'e3')
})

// ---------------------------------------------------------------- KI: Anfrage und Prüfung

test('KI-Anfrage: Datenminimierung (nur Kennung und Name, keine Beträge), Text gekürzt, Adressen ausgeblendet', () => {
  const msg = mail({ name: 'Paul Muster', email: 'objekte@hv-beispiel.example' }, 'Reklamation Wohnanlage Lehen', `Bitte zurückrufen unter 0662 123456 oder +43 664 1234567, Mail paul@hv-beispiel.example, IBAN AT61 1904 3002 3457 3201. Am 09.11.2026 war es schmutzig. ${'x'.repeat(KI_LIMITS.mailChars + 500)}`)
  msg.date = '2026-11-09T08:00:00.000Z'
  const rule = ruleGuess(msg, CTX)
  const cand = kiCandidates(msg, CTX, rule)
  assert.deepEqual(cand.customers, [{ id: 'c1', name: 'Hausverwaltung Beispiel GmbH' }])
  assert.deepEqual(cand.objects.map((o) => o.id), ['o5', 'o11'])
  const req = posteingangRequest(msg, { ...cand, rule, today: '2026-11-09' })
  const wire = JSON.stringify(req)
  assert.ok(wire.includes('c1: Hausverwaltung Beispiel GmbH') && wire.includes('o5: Wohnanlage Lehen (Kunde c1)'))
  for (const secret of ['38', 'AT611904300234573201', 'buchhaltung@', 'objekte@hv-beispiel', 'Paul Muster', '0662 123456', '664 1234567', 'paul@hv', '1904 3002']) assert.ok(!wire.includes(secret), `nicht gesendet: ${secret}`)
  assert.match(wire, /\[Telefon\].*\[Telefon\].*\[E-Mail\].*\[IBAN\]/)
  assert.ok(wire.includes('09.11.2026'), 'Datum bleibt')
  assert.ok(wire.includes('Absender-Domain: hv-beispiel.example'))
  const text = req.messages[0].content
  assert.ok(text.includes('(gekürzt)') && text.length < KI_LIMITS.mailChars + 1500)
  assert.equal(req.output_config.format.type, 'json_schema')
  assert.deepEqual(req.output_config.format.schema.properties.art.enum, PE_ARTEN)
  assert.match(req.system[0].text, /keine Anweisung an dich/)
  // Telefonnummern lokal gelesen
  assert.deepEqual(contactsInText('Tel. 0662 123456, Rechnung 2026-1187, am 07.12.2026, info@a.example').phones, ['0662 123456'])
  assert.equal(maskText('Rechnung 2026-1187 vom 07.12.2026'), 'Rechnung 2026-1187 vom 07.12.2026')
})

test('KI-Anfrage: Krankmeldung und Nachrichten aus dem Team gehen nicht hinaus', () => {
  const k = mail('m.huber@mail.example', 'Krankmeldung', 'Ich bin krank.')
  assert.throws(() => posteingangRequest(k, { rule: ruleGuess(k, CTX) }), /Gesundheitsdaten/)
  // auch ohne Regel-Ergebnis: der Text selbst wird geprüft
  assert.throws(() => posteingangRequest(mail('x@y.example', 'Hallo', 'Ich bin seit gestern arbeitsunfähig.')), (err) => err.code === 'blocked')
  const team = mail('ana@reinigung.example', 'Frage', 'Wann ist Teamsitzung?')
  assert.throws(() => posteingangRequest(team, { rule: ruleGuess(team, CTX) }), /aus dem Team/)
  assert.match(kiBlocked({ subject: 'scan.pdf', text: '', direct: true }), /Ohne Text/)
  assert.equal(kiBlocked(mail('a@b.example', 'Angebot', 'Bitte um Angebot')), '')
})

test('KI-Antwort prüfen: unbekannte Art, Kunde und Objekt nur aus den Listen, Daten gültig, Texte gekürzt', () => {
  const lists = { customers: [{ id: 'c1', name: 'HV' }], objects: [{ id: 'o5', name: 'Lehen', customerId: 'c1' }, { id: 'o2', name: 'Maxglan', customerId: 'c2' }], today: '2026-11-09' }
  const x = checkPosteingang({ art: 'werbung', kunde_id: 'c99', objekt_id: 'o99', dringlichkeit: 'sehr', kurzfassung: 'k', begruendung: 'b', felder: {} }, lists)
  assert.equal(x.art, 'sonstiges')
  assert.equal(x.customerId, '')
  assert.equal(x.objectId, '')
  assert.equal(x.urgency, 'normal')
  assert.ok(x.problems.some((p) => /unbekannt/.test(p.text)) && x.problems.filter((p) => /nicht zur Auswahl/.test(p.text)).length === 2)
  const t = checkPosteingang({ art: 'terminwunsch', kunde_id: '', objekt_id: 'o5', dringlichkeit: 'hoch', kurzfassung: `${'Lang '.repeat(200)}`, begruendung: 'Kunde will Termin. Zweiter Satz.', felder: { datum: '2026-11-31', uhrzeit: '9.30', grund: 'Begehung', name: 'gehört nicht dazu' } }, lists)
  assert.equal(t.art, 'terminwunsch')
  assert.equal(t.objectId, 'o5')
  assert.equal(t.customerId, 'c1', 'Kunde aus dem Objekt')
  assert.equal(t.urgency, 'hoch')
  assert.ok(t.summary.length <= 400 && t.summary.endsWith('…'))
  assert.equal(t.reason, 'Kunde will Termin.')
  assert.deepEqual(t.fields, { grund: 'Begehung', uhrzeit: '09:30' })
  assert.ok(t.problems.some((p) => /kein gültiges Datum/.test(p.text)))
  // Termin in der Vergangenheit, Objekt eines anderen Kunden
  const v = checkPosteingang({ art: 'zusatzauftrag', kunde_id: 'c1', objekt_id: 'o2', felder: { datum: '2026-10-01', leistung: 'Fenster' } }, lists)
  assert.equal(v.objectId, '')
  assert.deepEqual(v.fields, { leistung: 'Fenster' })
  // Krankmeldung: nichts aus dem Inhalt
  const k = checkPosteingang({ art: 'krankmeldung', kurzfassung: 'Grippe bis Freitag', begruendung: 'krank', felder: { grund: 'Grippe', datum: '2026-11-13' } }, lists)
  assert.deepEqual([k.summary, k.reason, k.fields], ['', '', {}])
  assert.equal(checkPosteingang(null).art, 'sonstiges')
})

test('KI: classifyMail mit gespielter Antwort (über die Prüfung)', async () => {
  const msg = { ...mail('objekte@hv-beispiel.example', 'Stiegenhaus', 'Das Stiegenhaus der Wohnanlage Lehen ist schmutzig.'), date: '2026-11-09T08:00:00Z' }
  let sent = null
  const send = async (req) => {
    sent = req
    return `Ergebnis: ${JSON.stringify({ art: 'reklamation', kurzfassung: 'Stiegenhaus nachreinigen.', kunde_id: 'c1', objekt_id: 'o5', dringlichkeit: 'normal', begruendung: 'Mangel gemeldet.', felder: { grund: 'Stiegenhaus schmutzig', ort_im_objekt: 'Stiegenhaus', datum: '2026-11-08', name: '', firma: '', adresse: '', leistung: '', uhrzeit: '' } })}`
  }
  const res = await classifyMail(msg, { ctx: CTX, rule: ruleGuess(msg, CTX), today: '2026-11-09', send })
  assert.equal(res.art, 'reklamation')
  assert.equal(res.objectId, 'o5')
  assert.deepEqual(res.fields, { grund: 'Stiegenhaus schmutzig', ort_im_objekt: 'Stiegenhaus', datum: '2026-11-08' })
  assert.ok(sent && !JSON.stringify(sent).includes('objekte@hv'))
  await assert.rejects(classifyMail(mail('m.huber@mail.example', 'Krankmeldung', 'krank'), { ctx: CTX, send: async () => assert.fail('gesendet') }), /Gesundheitsdaten/)
})

// ---------------------------------------------------------------- Ablage

test('Ablage: leere Datei wie in data-service.js, Rechte nur Vollzugriff bzw. eigene Rolle', () => {
  assert.deepEqual(MODULE_DOCS.posteingang.empty(), emptyPosteingang())
  assert.equal(MODULE_DOCS.posteingang.path, 'posteingang/posteingang.json')
  assert.ok(FOLDERS.some(([f]) => f === 'posteingang'))
  const path = MODULE_DOCS.posteingang.path
  const voll = dataRights(resolveAccess({ preview: 'disposition' }))
  assert.ok(voll.read(path) && voll.write(path))
  for (const r of ['objektleitung', 'buchhaltung', 'personalverwaltung', 'objektmanagement', 'lesen']) {
    const x = dataRights(resolveAccess({ preview: r }))
    assert.ok(!x.read(path) && !x.write(path), r)
  }
  const access = { roles: { sekretariat: { label: 'Sekretariat', modules: ['posteingang', 'reklamationen', 'termine'], edit: ['posteingang', 'reklamationen', 'termine'] } } }
  const sek = resolveAccess({ preview: 'sekretariat', access })
  assert.ok(dataRights(sek).write(path))
  assert.deepEqual(handoversFor('zusatzauftrag', sek.canEdit).map((h) => h.id), [], 'ohne Fakturierung und Regie kein Angebot')
  assert.deepEqual(handoversFor('reklamation', sek.canEdit).map((h) => h.id), ['reklamation'])
  assert.deepEqual(handoversFor('zusatzauftrag').map((h) => h.id), ['angebot', 'regie'])
  assert.deepEqual(handoversFor('sonstiges'), [])
})

test('Ablage: Eintrag nur mit erlaubten Feldern, Gesundheitsdaten ohne Absender und Betreff', () => {
  const msg = { id: 'pe-1', messageId: 'm1@x', source: 'graph', from: { name: 'Paul', email: 'p@x.example' }, subject: 'Reklamation', date: '2026-11-09T08:00:00.000Z', text: 'GEHEIMER TEXT', attachments: [{ name: 'a.pdf', data: new Uint8Array(3) }] }
  const e = entryFor(msg, { art: 'reklamation', at: '2026-11-09T09:00:00.000Z', by: 'Petra' })
  assert.deepEqual(Object.keys(e).sort(), ['art', 'artBy', 'date', 'from', 'id', 'msgId', 'seenAt', 'seenBy', 'source', 'status', 'subject'])
  assert.equal(e.from, 'Paul <p@x.example>')
  assert.ok(!JSON.stringify(e).includes('GEHEIM') && !JSON.stringify(e).includes('a.pdf'))
  const file = entryFor({ id: 'pe-2', hash: 'abcd', source: 'datei', subject: 'scan.pdf' }, { art: 'eingangsrechnung' })
  assert.equal(file.hash, 'abcd')
  assert.ok(!('msgId' in file))
  const k = entryFor({ ...msg, subject: 'Krankmeldung Markus Huber' }, { art: 'krankmeldung' })
  assert.deepEqual([k.from, k.subject, k.masked], ['', '', true])
  const masked = entryFor(msg, { art: 'reklamation', masked: true })
  assert.deepEqual([masked.from, masked.subject], ['', ''])
  assert.equal(entryFor(msg, { art: 'quatsch' }).art, 'sonstiges')
})

test('Ablage: aufnehmen, Art und Status, Filter', () => {
  const a = entryFor({ id: 'pe-a', messageId: 'a', from: { email: 'a@x' }, subject: 'A', date: '2026-11-08T08:00:00Z' }, { art: 'sonstiges' })
  let r = upsertEntry([], a)
  assert.ok(r.created)
  // Regel erkennt nach dem Laden des Texts mehr: Art folgt, solange niemand gewählt hat
  r = upsertEntry(r.items, { ...a, art: 'reklamation' })
  assert.equal(r.items[0].art, 'reklamation')
  const chosen = setArt(r.items[0], 'zusatzauftrag', 'person')
  r = upsertEntry([chosen], { ...a, art: 'reklamation' })
  assert.equal(r.items[0].art, 'zusatzauftrag')
  assert.equal(r.changed, false)
  // später erkannt: Gesundheitsdaten → Absender und Betreff weg
  r = upsertEntry(r.items, { ...a, from: '', subject: '', masked: true })
  assert.deepEqual([r.items[0].from, r.items[0].subject, r.items[0].masked], ['', '', true])
  assert.equal(setArt(a, 'krankmeldung', 'ki').subject, '')
  const done = setStatus(a, 'erledigt', { by: 'Petra', at: '2026-11-09T10:00:00Z', link: { kind: 'reklamation', id: 'r1', label: 'Reklamation' } })
  assert.deepEqual([done.status, done.by, done.link.id], ['erledigt', 'Petra', 'r1'])
  const again = setStatus(done, 'neu')
  assert.ok(!again.link && !again.by && again.status === 'neu')
  assert.throws(() => setStatus(a, 'weg'), /Unbekannter Status/)
  const b = { ...a, id: 'pe-b', date: '2026-11-09T08:00:00Z' }
  const list = [done, b, setStatus({ ...a, id: 'pe-c' }, 'ignoriert', { at: '2026-11-09T00:00:00Z' })]
  assert.deepEqual(filterEntries(list, 'neu').map((x) => x.id), ['pe-b'])
  assert.deepEqual(filterEntries(list, 'erledigt').map((x) => x.id).sort(), ['pe-a', 'pe-c'])
  assert.equal(filterEntries(list, 'alle')[0].id, 'pe-b')
  assert.equal(newCount(list), 1)
})

test('Aufräumen: erledigte und ignorierte nach 180 Tagen (einstellbar), neue bleiben', () => {
  const at = (d) => `${d}T10:00:00.000Z`
  const items = [
    { id: '1', status: 'erledigt', at: at('2026-05-12'), date: at('2026-05-10') },
    { id: '2', status: 'erledigt', at: at('2026-05-13') },
    { id: '3', status: 'ignoriert', at: at('2026-01-01') },
    { id: '4', status: 'neu', seenAt: at('2025-01-01'), date: at('2025-01-01') },
  ]
  const r = cleanupPosteingang(items, '2026-11-09')
  assert.deepEqual(r.items.map((x) => x.id), ['2', '4'])
  assert.equal(r.removed, 2)
  assert.deepEqual(cleanupPosteingang(items, '2026-11-09', 30).items.map((x) => x.id), ['4'])
  assert.deepEqual(settingsOf({}), { folder: 'inbox', days: 14, unreadOnly: true, keepDays: 180 })
  assert.deepEqual(settingsOf({ settings: { folder: ' Rechnungen ', days: 500, unreadOnly: false, keepDays: 2 } }), { folder: 'Rechnungen', days: 90, unreadOnly: false, keepDays: 7 })
})

// ---------------------------------------------------------------- Postfach (Graph)

test('Postfach: Berechtigung, Adressen nur zum Lesen, Ordner, Umwandlung', () => {
  assert.equal(mailScope({}), 'Mail.Read')
  assert.equal(mailScope({ posteingang: { mailbox: 'office@firma.at' } }), 'Mail.Read.Shared')
  assert.ok(!scopesFor({ features: {} }).some((s) => /^Mail\.Read/.test(s)))
  assert.ok(scopesFor({ features: { posteingang: true } }).includes('Mail.Read'))
  assert.ok(scopesFor({ features: { posteingang: true }, posteingang: { mailbox: 'office@firma.at' } }).includes('Mail.Read.Shared'))
  assert.equal(mailBase(''), 'https://graph.microsoft.com/v1.0/me')
  assert.equal(mailBase('office@firma.at'), 'https://graph.microsoft.com/v1.0/users/office%40firma.at')
  const url = listUrl({ mailbox: 'office@firma.at', folderId: 'inbox', days: 14, unreadOnly: true, now: new Date('2026-11-09T10:00:00Z') })
  const u = new URL(url)
  assert.equal(u.pathname, '/v1.0/users/office%40firma.at/mailFolders/inbox/messages')
  assert.equal(u.searchParams.get('$filter'), 'receivedDateTime ge 2026-10-26T00:00:00Z and isRead eq false')
  assert.equal(u.searchParams.get('$orderby'), 'receivedDateTime desc')
  assert.equal(u.searchParams.get('$top'), '50')
  assert.ok(!new URL(listUrl({ unreadOnly: false, now: new Date('2026-11-09T10:00:00Z') })).searchParams.get('$filter').includes('isRead'))
  assert.match(messageUrl('', 'AA=='), /\/me\/messages\/AA%3D%3D\?\$select=.*body/)
  assert.equal(wellKnownFolder('Posteingang'), 'inbox')
  assert.equal(wellKnownFolder('Archive'), 'archive')
  assert.equal(wellKnownFolder('Rechnungen'), '')
  assert.match(decodeURIComponent(folderLookupUrls('', "Kunden's")[0]), /displayName eq 'Kunden''s'/)
  const m = msgFromGraph({ id: 'g1', internetMessageId: '<x@y>', subject: ' Hallo ', from: { emailAddress: { name: 'Max', address: 'Max@X.example' } }, toRecipients: [{ emailAddress: { name: 'Büro', address: 'office@firma.at' } }], receivedDateTime: '2026-11-09T08:00:00Z', bodyPreview: 'Vorschau', hasAttachments: true, body: { contentType: 'html', content: '<p>Text&amp;mehr</p>' } })
  assert.deepEqual([m.graphId, m.messageId, m.from.email, m.subject, m.text, m.loaded, m.hasAttachments], ['g1', 'x@y', 'max@x.example', 'Hallo', 'Text&mehr', true, true])
  assert.equal(msgFromGraph({ id: 'g2' }).loaded, undefined)
  assert.deepEqual(attachmentsFromGraph([{ '@odata.type': '#microsoft.graph.fileAttachment', id: 'a1', name: 'R.pdf', contentType: 'application/pdf', size: 10, isInline: false }, { '@odata.type': '#microsoft.graph.itemAttachment', id: 'a2', name: 'Mail' }]), [{ name: 'R.pdf', type: 'application/pdf', size: 10, inline: false, graphId: 'a1' }])
})

// ---------------------------------------------------------------- Übergaben

test('Übergaben: Vorbelegung je Ziel und Wiederfinden des angelegten Eintrags', () => {
  const msg = { ...mail({ name: 'Paul Muster', email: 'objekte@hv-beispiel.example' }, 'Reklamation Wohnanlage Lehen', 'Das Stiegenhaus ist schmutzig. Tel. 0662 000 001'), date: '2026-11-08T07:30:00.000Z' }
  const a = ruleGuess(msg, CTX)
  const rek = prefillFor('reklamation', msg, { a, today: '2026-11-09', entryId: 'pe-1' })
  assert.deepEqual([rek.objectId, rek.date, rek.source, rek.kind, rek.due, rek.posteingang], ['o5', '2026-11-08', 'Kunde (E-Mail)', 'Reinigung mangelhaft', '2026-11-10', 'pe-1'])
  assert.equal(rek.contact, 'Paul Muster, objekte@hv-beispiel.example, 0662 000 001')
  assert.match(rek.text, /Stiegenhaus ist schmutzig/)
  // Wahl der Person vor KI und Regel
  assert.equal(prefillFor('reklamation', msg, { a, ki: { objectId: 'o11', fields: {} }, choice: { objectId: 'o2' }, today: '2026-11-09' }).objectId, 'o2')
  assert.equal(prefillFor('reklamation', msg, { a, ki: { objectId: 'o11', fields: {} }, today: '2026-11-09' }).objectId, 'o11')
  const t = prefillFor('termin', msg, { a, ki: { fields: { datum: '2026-11-17', uhrzeit: '23:30', grund: 'Begehung' } }, today: '2026-11-09', entryId: 'pe-1' })
  assert.deepEqual([t.title, t.start, t.end, t.ref, t.attendees[0].email], ['Begehung', '2026-11-17T23:30', '2026-11-17T23:59', 'pst:pe-1', 'objekte@hv-beispiel.example'])
  const ohne = prefillFor('termin', msg, { a, today: '2026-11-09' })
  assert.equal(ohne.start, '2026-11-10T09:00')
  assert.match(ohne.note, /noch abstimmen/)
  const vt = prefillFor('vertrieb', { ...msg, from: { name: 'Sabine Leitgeb', email: 'office@kanzlei.example' } }, { a: {}, ki: { summary: 'Büroreinigung 2x pro Woche', fields: { firma: 'Kanzlei Leitgeb', name: 'Mag. Sabine Leitgeb', adresse: 'Linzer Gasse 12', leistung: 'Büroreinigung' } }, today: '2026-11-09', entryId: 'pe-9' })
  assert.deepEqual([vt.source, vt.lead.name, vt.lead.contact, vt.lead.email, vt.lead.phone, vt.site.address, vt.title], ['email', 'Kanzlei Leitgeb', 'Mag. Sabine Leitgeb', 'office@kanzlei.example', '0662 000 001', 'Linzer Gasse 12', 'Büroreinigung'])
  assert.equal(prefillFor('kuendigung', msg, { a, ki: { fields: { datum: 'bald' } }, today: '2026-11-09' }).to, '')
  assert.equal(prefillFor('einkauf', msg, { a: { supplierId: 's1' }, today: '2026-11-09', entryId: 'x' }).supplierId, 's1')
  assert.equal(prefillFor('bewerbung', mail('j@mail.example', 'Initiativbewerbung', 'Hallo'), { a: {}, today: '2026-11-09' }).source, 'initiativ')
  assert.deepEqual(prefillFor('abwesenheit', { ...msg, date: '2026-11-09T05:10:00Z' }, { a: { employeeId: 'e2' }, today: '2026-11-09' }), { employeeId: 'e2', date: '2026-11-09', absenceType: 'Krankenstand' })
  const data = {
    reklamationen: { items: [{ id: 'r1' }, { id: 'r2', posteingang: 'pe-1' }] },
    fakturierung: { documents: [{ id: 'f1', posteingang: 'pe-2', number: '' }], contracts: [{ id: 'v1', no: 'V-2026-002', cancel: { posteingang: 'pe-3', recordedAt: 'x' } }, { id: 'v2', cancel: { posteingang: 'pe-4' } }] },
    termine: { items: [{ id: 't1', ref: 'pst:pe-5', start: '2026-11-17T10:00' }] },
    einkauf: { invoices: [{ id: 'er1', no: 'ER-2026-0004', posteingang: 'pe-6' }] },
    bewerbung: { applicants: [{ id: 'b1', name: 'Jelena', posteingang: 'pe-7' }] },
    vertrieb: { cases: [{ id: 'vf1', no: 'VT-2026-004', posteingang: 'pe-8' }] },
    regie: { reports: [{ id: 'rb1', no: 'RB-2026-001', posteingang: 'pe-9' }] },
  }
  assert.deepEqual(findCreated('pe-1', 'reklamation', data), { kind: 'reklamation', id: 'r2', label: 'Reklamation' })
  assert.equal(findCreated('pe-2', 'angebot', data).label, 'Angebot (Entwurf)')
  assert.equal(findCreated('pe-3', 'kuendigung', data).label, 'Vertrag V-2026-002: Kündigung vorgemerkt')
  assert.equal(findCreated('pe-4', 'kuendigung', data), null, 'erst nach dem Speichern')
  assert.equal(findCreated('pe-5', 'termin', data).label, 'Termin am 17.11.2026')
  assert.equal(findCreated('pe-6', 'einkauf', data).label, 'Eingangsrechnung ER-2026-0004')
  assert.equal(findCreated('pe-7', 'bewerbung', data).label, 'Bewerbung', 'ohne Namen in der Ablage')
  assert.equal(findCreated('pe-8', 'vertrieb', data).id, 'vf1')
  assert.equal(findCreated('pe-9', 'regie', data).label, 'Regiebericht RB-2026-001')
  assert.equal(findCreated('pe-1', 'angebot', data), null)
  assert.equal(findCreated('', 'reklamation', data), null)
})

test('Beispiel-Postfach: alle Nachrichten lesbar und passend erkannt', async () => {
  const { demoMails, createPosteingangDemo } = await import('../src/data/demo-posteingang.js')
  const { createDemoData } = await import('../src/data/demo.js')
  const data = createDemoData('2026-11-09')
  const ctx = ruleContext({ customers: data.fakturierung.customers, suppliers: data.einkauf.suppliers, objects: data.objects, employees: data.employees })
  const mails = demoMails('2026-11-09').map(parseEml)
  const arts = mails.map((m) => ruleGuess(m, ctx).art)
  assert.deepEqual(arts, ['reklamation', 'krankmeldung', 'zusatzauftrag', 'anfrage_neukunde', 'eingangsrechnung', 'terminwunsch', 'kuendigung', 'bewerbung', 'sonstiges'])
  assert.equal(mails[2].subject, 'Zusätzliche Grundreinigung Schauraum')
  assert.equal(mails[7].from.name, 'Jelena Marić')
  assert.equal(mails[4].attachments[0].name, 'Rechnung_2026-1187.pdf')
  assert.ok(Buffer.from(mails[4].attachments[0].data).toString('latin1').startsWith('%PDF-1.4'))
  assert.ok(mails.every((m) => m.messageId && m.date.startsWith('2026-11')))
  assert.deepEqual(data.posteingang, createPosteingangDemo())
})
