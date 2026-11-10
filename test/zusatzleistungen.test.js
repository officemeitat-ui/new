// Zusatzleistungen anfragen (core/zusatzleistungen.js, kunden.php, zusatz-texte.php): Arten, Übernahme vom Webspace,
// Stand, Angebotsentwurf mit Artikel und Preisliste, Vertriebsfall, Termin und Regiebericht, Rechte, versiegelter Code
// des Angebots (auch gegen PHP). Browser- und PHP-Tests: .pruefung/selfservice_app.mjs, .pruefung/selfservice_php.mjs.
// Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveAccess } from '../src/core/access.js'
import { SHOW, showDefaults } from '../src/core/customer-portal.js'
import {
  appointmentDraft,
  caseFromRequest,
  cleanKinds,
  customerForRequest,
  DEFAULT_KINDS,
  kindIdOf,
  linkOrders,
  newWebRequests,
  nextRequestNo,
  offerFields,
  offerOfRequest,
  openCode,
  regieDraft,
  requestFromWeb,
  requestRights,
  requestState,
  requestStatus,
  sealCode,
  STATUS,
  statusSig,
  syncRequestOffer,
  webSettings,
  webStatus,
  zusatzSettings,
} from '../src/core/zusatzleistungen.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (f) => readFileSync(`${root}${f}`, 'utf8')
const PHP = read('kunden.php')
let php = true
try {
  execFileSync('php', ['-v'], { stdio: 'ignore' })
} catch {
  php = false
}

const web = (over = {}) => ({ id: 'a1b2c3d4e5f6', link: 'kb0123456789', titel: 'Hausverwaltung Muster', objektNr: 1, objektId: 'o1', objekt: 'Wohnanlage Lehen', art: 'grundreinigung', artName: 'Grundreinigung', von: '2026-12-01', bis: '2026-12-05', flaeche: '120,5', text: 'Stiegenhaus nach dem Malen grundreinigen.', kontakt: { name: 'Maria Huber', telefon: '0662 123456', email: 'maria@example.com' }, fotos: ['0123456789ab.jpg', '../boese.jpg'], erstellt: 1793000000, status: 'eingegangen', uebernommen: null, ...over })

test('Arten: Vorgabe, aufräumen, Kennung aus dem Namen, nur Name und Kennung an den Webspace', () => {
  assert.deepEqual(zusatzSettings({}).kinds.map((k) => k.id), ['grundreinigung', 'glas', 'teppich', 'sonder', 'winter', 'sonstiges'])
  assert.equal(DEFAULT_KINDS.length, 6)
  assert.match(zusatzSettings({}).hint, /unverbindlich/)
  assert.equal(kindIdOf('Reinigung Tiefgarage (groß)'), 'reinigungtiefgarageg')
  assert.equal(kindIdOf('Grundreinigung', ['grundreinigung']), 'grundreinigung2')
  assert.equal(kindIdOf('Ö'), 'oe')
  const kinds = cleanKinds([{ id: 'grundreinigung', name: ' Grundreinigung ', articleId: 'a1' }, { id: 'grundreinigung', name: 'Doppelt' }, { id: 'X Y', name: 'Büro nach Übersiedlung' }, { name: '' }])
  assert.deepEqual(kinds, [{ id: 'grundreinigung', name: 'Grundreinigung', articleId: 'a1' }, { id: 'doppelt', name: 'Doppelt', articleId: '' }, { id: 'bueronachuebersiedlu', name: 'Büro nach Übersiedlung', articleId: '' }])
  assert.equal(cleanKinds(Array.from({ length: 30 }, (_, i) => ({ name: `Art ${i}` }))).length, 20)
  assert.deepEqual(webSettings({ settings: { kinds, hint: 'Bitte bis Freitag.' } }), { arten: kinds.map(({ id, name }) => ({ id, name })), hinweis: 'Bitte bis Freitag.' })
  assert.ok(!JSON.stringify(webSettings({ settings: { kinds } })).includes('a1'), 'keine Artikel am Webspace')
  // Vorgabe in kunden.php wie in der App
  for (const k of DEFAULT_KINDS) assert.ok(PHP.includes(`'${k.id}' => '${k.name}'`), `${k.id} in kunden.php`)
})

test('Abschnitt im Kundenbereich: je Link einschaltbar, Standard aus', () => {
  assert.ok(SHOW.zusatz && PHP.includes("'zusatz'"))
  assert.equal(showDefaults().zusatz, false)
})

test('Übernahme vom Webspace: Kennung aus der Meldung, Nummer, Art, Fläche, Fotos nur gültige', () => {
  const r = requestFromWeb(web(), { requests: [{ no: 'ZL-2026-004' }], link: { title: 'HV Muster' } })
  assert.equal(r.id, 'zla1b2c3d4e5f6')
  assert.equal(r.no, 'ZL-2026-005')
  assert.equal(r.received, new Date(1793000000 * 1000).toISOString())
  assert.deepEqual([r.kindId, r.kindName, r.from, r.to, r.area, r.objectId, r.linkId, r.linkTitle], ['grundreinigung', 'Grundreinigung', '2026-12-01', '2026-12-05', 120.5, 'o1', 'kb0123456789', 'HV Muster'])
  assert.deepEqual(r.contact, { name: 'Maria Huber', phone: '0662 123456', email: 'maria@example.com' })
  assert.deepEqual(r.photos, [{ datei: '0123456789ab.jpg' }])
  assert.equal(requestStatus(r), 'eingegangen')
  // unbekannte Art (in der App gelöscht): Name wie geschickt
  const x = requestFromWeb(web({ art: 'tiefgarage', artName: 'Tiefgarage', flaeche: null, von: 'morgen' }))
  assert.deepEqual([x.kindId, x.kindName, x.area, x.from], ['tiefgarage', 'Tiefgarage', null, ''])
  assert.equal(nextRequestNo([], '2027'), 'ZL-2027-001')
  // neu: gültige Kennung, nicht übernommen, nicht schon in der App
  const list = [web(), web({ id: 'ffffffffffff', uebernommen: 123 }), web({ id: '../x' }), web({ id: '000000000001' })]
  assert.deepEqual(newWebRequests(list, [r]).map((a) => a.id), ['000000000001'])
})

test('Anfrage nach Mitternacht: Nummer, Angebotstext und Vertriebsfall mit dem Tag in Wien', () => {
  // Neujahr 0:15 Uhr in Wien = 31.12.2026 23:15 UTC: die Anfrage gehört ins Jahr 2027
  const ny = requestFromWeb(web({ erstellt: Date.parse('2026-12-31T23:15:00Z') / 1000 }), { requests: [{ no: 'ZL-2026-041' }] })
  assert.equal(ny.no, 'ZL-2027-001')
  // Di 10.11.2026 0:30 Uhr in Wien = 9.11. 23:30 UTC: „Ihre Anfrage … vom 10.11.2026“, Anfrage im Vertrieb am 10.11.
  const r = requestFromWeb(web({ erstellt: Date.parse('2026-11-09T23:30:00Z') / 1000 }))
  assert.match(offerFields(r, { fak: { articles: [] }, settings: zusatzSettings({}), date: '2026-11-10' }).lines[2].text, /Ihre Anfrage ZL-2026-001 vom 10\.11\.2026$/)
  assert.equal(caseFromRequest(r, { id: 'vf1', today: '2026-11-10' }).requestDate, '2026-11-10')
})

test('Stand: eingegangen → Angebot gesendet → beauftragt; erledigt und abgelehnt mit Begründung', () => {
  const r = requestFromWeb(web())
  assert.equal(requestStatus(r), 'eingegangen')
  assert.equal(requestStatus({ ...r, offer: { id: 'f1', number: '', state: 'entwurf' } }), 'eingegangen', 'Entwurf: noch nicht gesendet')
  assert.equal(requestStatus({ ...r, offer: { id: 'f1', number: 'AN-2026-0007', state: 'offen', sent: false, online: false } }), 'eingegangen', 'festgeschrieben, nicht gesendet')
  assert.equal(requestStatus({ ...r, offer: { id: 'f1', number: 'AN-2026-0007', state: 'offen', sent: true } }), 'angebot')
  assert.equal(requestStatus(r, { offer: { id: 'an0123456789', publishedAt: '2026-11-09T10:00:00Z' } }), 'angebot', 'online')
  assert.equal(requestStatus(r, { offer: { id: 'an0123456789', publishedAt: '2026-11-09', revokedAt: '2026-11-10' } }), 'eingegangen', 'zurückgezogen')
  assert.equal(requestStatus(r, { offer: { id: 'an0123456789', publishedAt: '2026-11-09', acceptedAt: '2026-11-10' } }), 'beauftragt', 'online angenommen')
  assert.equal(requestStatus({ ...r, offer: { id: 'f1', number: 'AN-1', state: 'angenommen' } }), 'beauftragt')
  assert.equal(requestStatus({ ...r, ordered: { via: 'termin' } }), 'beauftragt')
  assert.equal(requestStatus({ ...r, ordered: { via: 'termin' }, done: { at: 'x' } }), 'erledigt')
  const declined = { ...r, declined: { reason: 'Leider keine Kapazität im Dezember.', at: 'x' }, done: { at: 'y' } }
  assert.equal(requestStatus(declined), 'abgelehnt')
  assert.deepEqual(webStatus(declined), { id: 'a1b2c3d4e5f6', status: 'abgelehnt', antwort: 'Leider keine Kapazität im Dezember.', angebot: null })
  // Code des Angebots nur bei „Angebot gesendet“ bzw. „beauftragt“
  const angebot = { id: 'an0123456789', nummer: 'AN-2026-0007', n: 'ab', c: 'cd' }
  assert.deepEqual(webStatus(r, { offer: { publishedAt: 'x' }, angebot }).angebot, angebot)
  assert.equal(webStatus(r, { angebot }).angebot, null)
  assert.equal(webStatus({ ...r, done: { at: 'x' } }, { offer: { publishedAt: 'x' }, angebot }).angebot, null)
  // Signatur ohne Code, mit Stand des Links (neuer Link → neu übertragen)
  const s = webStatus(r, { offer: { publishedAt: 'x' }, angebot })
  assert.equal(statusSig(s, '2026-11-01'), 'angebot||an0123456789:AN-2026-0007:2026-11-01')
  assert.notEqual(statusSig(s, '2026-11-01'), statusSig(s, '2026-11-02'))
  assert.equal(statusSig(webStatus(r)), 'eingegangen||')
  assert.equal(r.sent, 'eingegangen||', 'frisch übernommen: nichts zu melden')
  assert.deepEqual(Object.keys(STATUS), ['eingegangen', 'angebot', 'beauftragt', 'erledigt', 'abgelehnt'])
  for (const k of Object.keys(STATUS)) assert.ok(PHP.includes(`'${k}' =>`), `Stand ${k} in kunden.php`)
  assert.deepEqual(requestState({ ...r, offer: { number: 'AN-1', state: 'offen', sent: true } }), { key: 'angebot', label: 'Angebot gesendet', cls: 'info' })
})

test('Angebot der Anfrage: Entwurf, Stand aus der Fakturierung, auch über den Vertriebsfall', () => {
  const r = requestFromWeb(web())
  const docs = [
    { id: 'f0', kind: 'rechnung', source: { type: 'zusatzleistung', requestId: r.id } },
    { id: 'f1', kind: 'angebot', date: '2026-11-09', source: { type: 'zusatzleistung', requestId: r.id }, lines: [], total: { net: 400 } },
    { id: 'f2', kind: 'angebot', date: '2026-11-08', source: { type: 'zusatzleistung', requestId: 'zlanders' } },
  ]
  assert.equal(offerOfRequest(r, docs).id, 'f1')
  assert.equal(offerOfRequest({ ...r, case: { id: 'vf1' } }, [{ id: 'f9', kind: 'angebot', source: { type: 'vertrieb', caseId: 'vf1' } }]).id, 'f9')
  let res = syncRequestOffer(r, docs[1], { documents: docs, today: '2026-11-09', at: 'T1', by: 'Eva' })
  assert.ok(res.changed)
  assert.deepEqual([res.request.offer.id, res.request.offer.state, res.request.history.at(-1).text], ['f1', 'entwurf', 'Angebot als Entwurf angelegt'])
  assert.equal(syncRequestOffer(res.request, docs[1], { documents: docs, today: '2026-11-09' }).changed, false, 'unverändert')
  const fixed = { ...docs[1], number: 'AN-2026-0007', validUntil: '2026-12-09', sent: [{ at: 'x' }] }
  res = syncRequestOffer(res.request, fixed, { documents: docs, today: '2026-11-09', at: 'T2' })
  assert.deepEqual([res.request.offer.state, res.request.offer.sent, res.request.history.at(-1).text, requestStatus(res.request)], ['offen', true, 'Angebot AN-2026-0007 festgeschrieben', 'angebot'])
  res = syncRequestOffer(res.request, { ...fixed, status: 'angenommen', acceptance: { at: '2026-11-10T09:00:00Z', name: 'Maria Huber' } }, { documents: docs, today: '2026-11-10' })
  assert.deepEqual([res.request.offer.state, res.request.history.at(-1).text, requestStatus(res.request)], ['angenommen', 'Angebot AN-2026-0007 angenommen (online von Maria Huber)', 'beauftragt'])
  res = syncRequestOffer(res.request, null, {})
  assert.deepEqual([res.request.offer, res.request.history.at(-1).text], [null, 'Angebot gelöscht'])
})

test('Angebotsentwurf: Artikel mit Kundenpreis, Menge = Fläche bei m², sonst Textposition', () => {
  const r = { ...requestFromWeb(web()), received: '2026-11-09T10:00:00.000Z' }
  const fak = {
    settings: { vat: 20 },
    customers: [{ id: 'c1', name: 'HV Muster', objectIds: ['o1'], discount: 5 }, { id: 'c2', name: 'Alt', objectIds: ['o1'], active: false }],
    articles: [{ id: 'a1', name: 'Grundreinigung', text: 'Hartboden', unit: 'm²', price: '3,20', vat: 20, articleNo: 'GR-1' }],
    customerPrices: [{ id: 'p1', customerId: 'c1', articleId: 'a1', price: '2,90', validFrom: '2026-01-01' }],
  }
  const settings = zusatzSettings({ settings: { kinds: [{ id: 'grundreinigung', name: 'Grundreinigung', articleId: 'a1' }] } })
  assert.equal(customerForRequest(r, fak.customers).id, 'c1')
  assert.equal(customerForRequest({ ...r, customerId: 'c2' }, fak.customers).id, 'c1', 'inaktiver Kunde nicht')
  let i = 0
  let f = offerFields(r, { fak, settings, customerId: 'c1', date: '2026-11-09', newId: () => `l${++i}` })
  assert.equal(f.title, 'Grundreinigung – Wohnanlage Lehen')
  assert.deepEqual([f.objectId, f.objectName, f.priced], ['o1', 'Wohnanlage Lehen', true])
  assert.deepEqual(f.source, { type: 'zusatzleistung', requestId: r.id, no: r.no, linkId: 'kb0123456789' })
  assert.deepEqual(f.lines.map((l) => l.type || 'item'), ['title', 'item', 'text'])
  const item = f.lines[1]
  assert.deepEqual([item.text, item.articleNo, item.unit, item.qty, item.price, item.discount, item.vat], ['Grundreinigung – Hartboden', 'GR-1', 'm²', 120.5, 2.9, 0, 20], 'Kundenpreis, ohne Rabatt')
  assert.match(item.longText, /Stiegenhaus nach dem Malen/)
  assert.equal(f.lines[2].text, 'Wunschtermin: 01.12.2026 bis 05.12.2026 · Fläche laut Anfrage: 120,5 m² · Ihre Anfrage ZL-2026-001 vom 09.11.2026')
  // Standardpreis mit Kundenrabatt als Positionsrabatt; ohne Fläche Menge 1
  f = offerFields({ ...r, area: null }, { fak: { ...fak, customerPrices: [] }, settings, customerId: 'c1', date: '2026-11-09' })
  assert.deepEqual([f.lines[1].qty, f.lines[1].price, f.lines[1].discount], [1, 3.2, 5])
  // ohne Artikel: Textposition mit Beschreibung, Preis trägt das Büro ein
  f = offerFields(r, { fak, settings: zusatzSettings({}), customerId: 'c1', date: '2026-11-09' })
  assert.deepEqual([f.priced, f.lines[1].text, f.lines[1].longText, f.lines[1].price, f.lines[1].unit], [false, 'Grundreinigung', 'Stiegenhaus nach dem Malen grundreinigen.', '', 'Pauschale'])
  // Artikel inaktiv: wie ohne Artikel
  assert.equal(offerFields(r, { fak: { ...fak, articles: [{ ...fak.articles[0], active: false }] }, settings, date: '2026-11-09' }).priced, false)
})

test('Vertriebsfall, Termin und Regiebericht aus der Anfrage; Termin bzw. Bericht mit ref gilt als beauftragt', () => {
  const r = requestFromWeb(web())
  const c = caseFromRequest(r, { id: 'vf9', cases: [{ no: 'VT-2026-004' }], today: '2026-11-09', customer: { id: 'c1', name: 'HV Muster' }, object: { name: 'Wohnanlage Lehen', address: 'Ignaz-Harrer-Straße 10' }, owner: 'Eva', at: 'T', by: 'Eva' })
  assert.deepEqual([c.no, c.stage, c.source, c.customerId, c.objectId, c.site.address, c.lead.contact, c.lead.phone, c.next.text], ['VT-2026-005', 'anfrage', 'bestandskunde', 'c1', 'o1', 'Ignaz-Harrer-Straße 10', 'Maria Huber', '0662 123456', 'Besichtigung vereinbaren'])
  assert.match(c.note, /Anfrage ZL-\d{4}-001 aus dem Kundenbereich\nWunschtermin: 01\.12\.2026 bis 05\.12\.2026\nFläche: 120,5 m²/)
  const a = appointmentDraft(r, { today: '2026-11-09' })
  assert.deepEqual([a.kind, a.start, a.objectId, a.ref], ['kunde', '2026-12-01T08:00', 'o1', `zl:${r.id}`])
  assert.equal(appointmentDraft({ ...r, from: '2026-01-01' }, { today: '2026-11-09' }).start, '2026-11-09T08:00', 'Wunsch vorbei: heute')
  const g = regieDraft(r, { today: '2026-11-09' })
  assert.deepEqual([g.kind, g.date, g.orderedBy, g.orderedRole, g.orderRef, g.ref, g.status], ['grundreinigung', '2026-11-09', 'Maria Huber', 'Kunde', `Anfrage ${r.no}`, `zl:${r.id}`, 'offen'])
  assert.equal(regieDraft({ ...r, kindId: 'tiefgarage' }, { today: '2026-11-09' }).kind, 'sonstige')
  const other = { ...r, id: 'zlother' }
  const out = linkOrders([r, other, { ...r, id: 'zlx', declined: { reason: 'nein' } }], { reports: [{ id: 'rb1', no: 'RB-2026-0003', date: '2026-11-09', ref: `zl:${r.id}`, createdBy: 'Olga' }], appointments: [{ id: 't1', ref: 'zl:zlother', start: '2026-12-01T08:00', cancelled: true }], at: 'T' })
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].ordered, { via: 'regie', id: 'rb1', no: 'RB-2026-0003', date: '2026-11-09', at: 'T', by: 'Olga' })
  assert.equal(requestStatus(out[0]), 'beauftragt')
  const t = linkOrders([other], { appointments: [{ id: 't2', ref: 'zl:zlother', start: '2026-12-01T08:00', createdBy: 'Eva' }] })
  assert.deepEqual([t[0].ordered.via, t[0].ordered.date, t[0].history.at(-1).text], ['termin', '2026-12-01', 'Termin am 01.12.2026 eingetragen'])
})

test('Rechte: Kundenbereich verwaltet und holt ab, Fakturierung macht das Angebot, Vertrieb den Fall', () => {
  const access = { groups: {}, members: {} }
  const role = (id) => requestRights(resolveAccess({ roleClaims: [id], access, strict: true }))
  assert.deepEqual(requestRights(null), { view: true, portal: true, offer: true, case: true, termin: true, regie: true, decide: true, settings: true })
  assert.deepEqual(role('buchhaltung'), { view: true, portal: false, offer: true, case: false, termin: false, regie: false, decide: true, settings: false })
  assert.deepEqual(role('objektleitung'), { view: true, portal: true, offer: false, case: true, termin: true, regie: true, decide: true, settings: true })
  assert.deepEqual(role('objektservice'), { view: true, portal: true, offer: false, case: false, termin: false, regie: true, decide: true, settings: true })
  for (const id of ['lager', 'vorarbeiter', 'lesen', 'mattenwechsel', 'personalverwaltung']) assert.deepEqual([role(id).view, role(id).decide], [false, false], id)
})

test('Code des Angebots: mit dem Code des Links versiegelt, ohne ihn nicht lesbar, PHP öffnet ihn', { skip: !php && 'ohne PHP' }, async () => {
  const code = 'AbCdEf1234567890GhIj'
  const link = 'KundeAnnaCode12345678'
  const sealed = await sealCode(code, link, '0011223344556677')
  assert.match(sealed, /^[a-f0-9]{40}$/)
  assert.ok(!sealed.includes(Buffer.from(code).toString('hex')))
  assert.equal(await openCode(sealed, link, '0011223344556677'), code)
  assert.notEqual(await openCode(sealed, 'AndererCode1234567890', '0011223344556677'), code)
  assert.notEqual(await sealCode(code, link, '0011223344556678'), sealed, 'anderer nonce, anderer Text')
  await assert.rejects(sealCode('x'.repeat(33), link, 'n'))
  // dieselbe Rechnung in kunden.php
  const fn = PHP.match(/function anfrage_code_oeffnen\([^]*?\n}\n/)[0]
  const out = execFileSync('php', ['-r', `${fn} echo anfrage_code_oeffnen($argv[1], $argv[2], $argv[3]);`, sealed, '0011223344556677', link], { encoding: 'utf8' })
  assert.equal(out, code)
})

test('Texte der Seite (zusatz-texte.php): Deutsch und Englisch mit denselben Schlüsseln und Platzhaltern', { skip: !php && 'ohne PHP' }, () => {
  const T = JSON.parse(execFileSync('php', ['-r', 'echo json_encode(require "zusatz-texte.php", JSON_UNESCAPED_UNICODE);'], { cwd: root, encoding: 'utf8' }))
  assert.deepEqual(Object.keys(T), ['de', 'en'])
  const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join()
  for (const [key, de] of Object.entries(T.de)) {
    assert.ok(key.startsWith('zl_'), key)
    assert.ok(String(T.en[key] || '').trim(), `en: ${key}`)
    assert.equal(holes(T.en[key]), holes(de), `Platzhalter ${key}`)
  }
  assert.deepEqual(Object.keys(T.en).sort(), Object.keys(T.de).sort())
  for (const k of Object.keys(STATUS)) assert.ok(T.de[`zl_st_${k}`], `Stand ${k}`)
  // jeder Schlüssel, den kunden.php nutzt, steht in der Datei
  for (const m of PHP.matchAll(/\bth?\('(zl_[a-z0-9_]*[a-z0-9])'/g)) assert.ok(m[1] in T.de, m[1])
  assert.ok(!/[A-ZÄÖÜ]{4,}/.test(Object.values(T.de).join(' ').replace(/JPEG/g, '')), 'keine Wörter in Großbuchstaben (außer Abkürzungen wie JPEG)')
})
