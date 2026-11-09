// Aushang (QR) im Objekt (core/aushang.js, export/aushang-pdf.js, kunden.php?q=CODE, aushang-texte.php): Code und
// Hashwert, was an den Webspace geht, Meldung → Reklamation mit Eingang „Aushang (QR)“ (Kategorie → Art), Stand und
// öffentliche Antwort zurück, Inhalt des PDF-Aushangs, Texte der Seite, Rechte. Den Ablauf mit echtem PHP-Server prüfen
// .pruefung/objekt_qr_php.mjs und .pruefung/objekt_qr_app.mjs. Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { AUSHANG_SOURCE, CATEGORIES, categoryLabel, complaintFromPosterReport, defaultPosterTitle, isPosterComplaint, isPosterReport, kindOfCategory, newPosterId, POSTER_ID_PATTERN, posterActive, posterLink, posterOf, posterPayload, posterState, publicReplyOf } from '../src/core/aushang.js'
import { KINDS, SOURCES } from '../src/core/complaints.js'
import { complaintFromReport, markSent, newReports, reportStatus, statusUpdates } from '../src/core/customer-portal.js'
import { newCode, sha256Hex } from '../src/core/staffplan.js'
import { resolveAccess } from '../src/core/access.js'
import { dataRights, MODULE_DOCS } from '../src/storage/data-service.js'
import { POSTER_TEXT, posterDocument, posterPdfName } from '../src/export/aushang-pdf.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (f) => readFileSync(`${root}${f}`, 'utf8')
const PHP = read('kunden.php')
const hasPhp = (() => {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

test('Aushang: eigener Code je Objekt, am Webspace nur Hashwert, Bezeichnung und Objekt', async () => {
  assert.equal(newPosterId(() => new Uint8Array([0, 15, 160, 255, 1])), 'ah000fa0ff01')
  assert.match(newPosterId(), POSTER_ID_PATTERN)
  assert.ok(PHP.includes(`const AUSHANG_MUSTER = '/${POSTER_ID_PATTERN.source}/';`), 'gleiches Muster in kunden.php')
  // Code wie bei den Links des Kundenbereichs: 20 Zeichen (rund 117 Bit), passt zur Prüfung in kunden.php
  const token = newCode()
  assert.match(token, /^[A-Za-z0-9]{20}$/)
  assert.notEqual(token, newCode())
  assert.equal(posterLink('https://app.cleanos.at', 'Abc123xyz'), 'https://app.cleanos.at/kunden.php?q=Abc123xyz')
  assert.equal(posterLink('https://app.cleanos.at/', 'A b'), 'https://app.cleanos.at/kunden.php?q=A%20b')
  const hash = await sha256Hex(token)
  assert.match(hash, /^[a-f0-9]{64}$/)
  const poster = { id: 'ah0123456789', objectId: 'o5', title: '  Wohnanlage Musterstraße 5  ', token, active: true, createdBy: 'Petra Leitner' }
  const payload = posterPayload(poster, hash)
  assert.deepEqual(payload, { id: 'ah0123456789', hash, titel: 'Wohnanlage Musterstraße 5', objektId: 'o5' })
  assert.ok(!JSON.stringify(payload).includes(token) && !JSON.stringify(payload).includes('Petra'), 'kein Code, keine Namen')
  assert.equal(posterPayload({ ...poster, title: 'x'.repeat(300) }, hash).titel.length, 120)
  assert.equal(defaultPosterTitle({ name: 'Wohnanlage Lehen', address: 'Musterweg 1' }), 'Wohnanlage Lehen')
  assert.ok(posterActive(poster) && !posterActive({ ...poster, active: false }) && !posterActive({ ...poster, token: '' }) && !posterActive(null))
  assert.equal(posterOf([poster], 'o5'), poster)
  assert.equal(posterOf([poster], 'o6'), null)
})

test('Aushang: Stand in der App (aus, neu, aktiv, Fehler, ausgeschaltet aber noch nicht entfernt)', () => {
  const p = { active: true, token: 'x' }
  assert.equal(posterState(p).key, 'neu')
  assert.equal(posterState({ ...p, publishedAt: '2026-11-09T10:00:00Z', changedAt: '2026-11-09T09:00:00Z' }).key, 'aktiv')
  assert.equal(posterState({ ...p, publishedAt: '2026-11-09T10:00:00Z', changedAt: '2026-11-09T11:00:00Z' }).key, 'neu')
  assert.equal(posterState({ ...p, publishedAt: '2026-11-09T10:00:00Z', error: 'Antwort 500' }).key, 'fehler')
  assert.equal(posterState({ ...p, active: false }).key, 'aus')
  assert.equal(posterState({ ...p, active: false, publishedAt: '2026-11-09T10:00:00Z', changedAt: '2026-11-09T11:00:00Z' }).key, 'aus-offen')
  assert.equal(posterState({ ...p, active: false, publishedAt: '2026-11-09T12:00:00Z', changedAt: '2026-11-09T11:00:00Z' }).key, 'aus')
})

const report = (over = {}) => ({ id: 'a1b2c3d4e5f6', quelle: 'aushang', aushang: 'ah0123456789', link: '', titel: 'Wohnanlage Musterstraße 5', objektId: 'o5', objekt: 'Wohnanlage Musterstraße 5', kategorie: 'schaden', ort: 'Stiege 2, 3. Stock', datum: '2026-11-09', text: 'Glasbruch an der Eingangstür', kontakt: { name: 'Ilse Beispiel', telefon: '', email: 'ilse@beispiel.example' }, rueckmeldung: true, info: false, foto: 'a1b2c3d4e5f6.jpg', erstellt: Date.parse('2026-11-09T07:30:00Z') / 1000, status: 'eingegangen', antwort: '', ...over })

test('Aushang: Meldung → Reklamation des Objekts mit Eingang „Aushang (QR)“, Kategorie → Art', () => {
  assert.ok(SOURCES.includes(AUSHANG_SOURCE), 'Eingang im Reklamations-Dialog wählbar')
  assert.equal(AUSHANG_SOURCE, 'Aushang (QR)')
  // jede Kategorie hat eine Art der Reklamation; dieselben Schlüssel und Namen in kunden.php und auf der Seite
  const php = PHP.match(/const AUSHANG_KATEGORIEN = \[([^\]]+)\];/)[1]
  const texte = read('aushang-texte.php')
  for (const [key, { label, kind }] of Object.entries(CATEGORIES)) {
    assert.ok(KINDS.includes(kind), `${key}: Art ${kind}`)
    assert.ok(php.includes(`'${key}' => '${label}'`), `${key} in kunden.php`)
    assert.ok(texte.includes(`'ah_kat_${key}' =>`), `${key} in aushang-texte.php`)
  }
  assert.deepEqual(Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, kindOfCategory(k)])), { reinigung: 'Leistung nicht erbracht', verschmutzung: 'Reinigung mangelhaft', schaden: 'Schaden', muell: 'Reinigung mangelhaft', winterdienst: 'Leistung nicht erbracht', sonstiges: 'Sonstiges' })
  assert.equal(kindOfCategory('werbung'), 'Sonstiges')
  assert.equal(categoryLabel('werbung'), 'Sonstiges')

  const m = report()
  assert.ok(isPosterReport(m) && !isPosterReport({ ...m, quelle: undefined }))
  const c = complaintFromReport(m, { link: null })
  assert.deepEqual(c, complaintFromPosterReport(m), 'der Kundenbereich gibt Meldungen vom Aushang weiter')
  assert.equal(c.id, 'rka1b2c3d4e5f6')
  assert.deepEqual([c.source, c.by, c.kind, c.objectId, c.date, c.status, c.due], ['Aushang (QR)', 'Aushang (QR)', 'Schaden', 'o5', '2026-11-09', 'offen', '2026-11-12'])
  assert.equal(c.text, 'Schaden/Defekt · Ort: Stiege 2, 3. Stock\nGlasbruch an der Eingangstür')
  assert.equal(c.contact, 'Ilse Beispiel, ilse@beispiel.example (Rückmeldung gewünscht)')
  assert.deepEqual(c.employees, [])
  assert.equal(c.publicReply, '')
  assert.deepEqual(c.portal, { id: 'a1b2c3d4e5f6', link: '', aushang: 'ah0123456789', sent: 'eingegangen|' })
  assert.match(c.history[0].text, /^gemeldet über den Aushang \(QR\) „Wohnanlage Musterstraße 5“, Rückmeldung gewünscht$/)
  assert.ok(isPosterComplaint(c))
  // ohne Ort, ohne Kontakt; Winterdienst als nicht erbrachte Leistung mit kurzer Frist
  const w = complaintFromReport(report({ kategorie: 'winterdienst', ort: '', kontakt: { name: '', telefon: '', email: '' }, rueckmeldung: false }))
  assert.deepEqual([w.kind, w.text, w.contact, w.due], ['Leistung nicht erbracht', 'Winterdienst\nGlasbruch an der Eingangstür', '', '2026-11-10'])
  assert.equal(complaintFromReport(report({ text: 'x'.repeat(3000) })).text.length, 2000)
  // Foto wie beim Kundenbereich (die Übernahme legt es nach SharePoint): Dateiname bleibt an der Meldung
  assert.equal(m.foto, 'a1b2c3d4e5f6.jpg')
  // neue Meldungen: dieselbe Abholung wie beim Kundenbereich
  assert.deepEqual(newReports([m, report({ id: 'bbbbbbbbbbbb', uebernommen: 1 }), { ...m, id: 'cccccccccccc' }], [c]).map((x) => x.id), ['cccccccccccc'])
})

test('Aushang: Stand zurück, öffentlich nur die eigene Antwort, nie Ergebnis oder Maßnahme', () => {
  const c = complaintFromReport(report())
  assert.deepEqual(statusUpdates([c]), [])
  const work = { ...c, status: 'arbeit', measure: 'Glaser bestellt (Firma K.)', result: 'Intern: Mitarbeiterin M. hat die Tür offen gelassen' }
  assert.deepEqual(statusUpdates([work]), [{ id: 'a1b2c3d4e5f6', status: 'arbeit', antwort: '' }])
  const done = { ...markSent(work), status: 'erledigt', publicReply: '  Die Scheibe ist getauscht. Danke für den Hinweis!  ' }
  assert.deepEqual(reportStatus(done), { id: 'a1b2c3d4e5f6', status: 'erledigt', antwort: 'Die Scheibe ist getauscht. Danke für den Hinweis!' })
  assert.ok(!JSON.stringify(statusUpdates([done])).match(/Intern|Glaser|Mitarbeiterin/))
  assert.deepEqual(statusUpdates([markSent(done)]), [])
  // die öffentliche Antwort geht auch vor „erledigt“ hinaus, wenn sie eingetragen ist
  assert.deepEqual(reportStatus({ ...work, publicReply: 'Wir kommen morgen.' }).antwort, 'Wir kommen morgen.')
  assert.equal(publicReplyOf({ publicReply: 'x'.repeat(2000) }).length, 1000)
  // Kundenbereich unverändert: dort ist es das Ergebnis, wenn erledigt
  const kb = complaintFromReport({ ...report(), quelle: undefined, art: 'Schaden', link: 'kb0123456789' })
  assert.equal(kb.source, 'Kundenbereich')
  assert.equal(reportStatus({ ...kb, status: 'erledigt', result: 'Erledigt.', publicReply: 'nie' }).antwort, 'Erledigt.')
})

test('Aushang als PDF: A4 je Objekt, großer QR-Code, Text Deutsch und Englisch, Bezeichnung, Logo', () => {
  const posters = [
    { id: 'ah0000000001', title: 'Wohnanlage Musterstraße 5', token: 'AbcDef1234567890Ghij', active: true },
    { id: 'ah0000000002', title: 'Büro Hausverwaltung, 2. Stock', token: 'XyzXyz1234567890Abcd', active: true },
  ]
  const doc = posterDocument({ posters, address: 'https://app.cleanos.at/', brand: { name: 'Cleanos', app: 'Cleanos App' }, logo: { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' }, phone: '0662 87 65 43', createdAt: new Date('2026-11-09T10:00:00Z') })
  assert.equal(doc.pageSize, 'A4')
  assert.equal(doc.content.length, 2)
  assert.ok(!doc.content[0].pageBreak && doc.content[1].pageBreak === 'before', 'eine Seite je Aushang')
  const text = JSON.stringify(doc.content)
  const qr = doc.content.map((p) => p.stack.find((x) => x.qr))
  assert.deepEqual(qr.map((x) => x.qr), ['https://app.cleanos.at/kunden.php?q=AbcDef1234567890Ghij', 'https://app.cleanos.at/kunden.php?q=XyzXyz1234567890Abcd'])
  assert.ok(qr.every((x) => x.fit >= 280 && x.eccLevel === 'M'), 'großer QR-Code')
  for (const s of ['Problem gesehen? Hier melden', 'Seen a problem? Report it here', 'Wohnanlage Musterstraße 5', 'Büro Hausverwaltung, 2. Stock', 'Dringend? Bitte rufen Sie an: 0662 87 65 43', 'Ohne Anmeldung, ohne App.', 'No login, no app.']) assert.ok(text.includes(s), s)
  assert.ok(doc.content[0].stack[0].svg, 'Firmenlogo oben')
  assert.equal(POSTER_TEXT.de.head, 'Problem gesehen? Hier melden')
  assert.equal(POSTER_TEXT.en.head, 'Seen a problem? Report it here')
  // ohne Logo: Firmenname; ohne Telefon: kein Hinweis; ohne Aushang: kurzer Text
  const plain = posterDocument({ posters: posters.slice(0, 1), address: 'https://app.cleanos.at', brand: { name: 'Cleanos' } })
  assert.equal(plain.content[0].stack[0].text, 'Cleanos')
  assert.ok(!JSON.stringify(plain.content).includes('Dringend'))
  assert.equal(posterDocument({ posters: [], address: 'x' }).content[0].text, 'Kein Aushang eingeschaltet.')
  assert.equal(posterPdfName(posters.slice(0, 1)), 'Aushang_QR_Wohnanlage-Musterstrasse-5.pdf')
  assert.equal(posterPdfName(posters), 'Aushaenge_QR.pdf')
})

test('Aushang: Texte der Seite (Deutsch und Englisch), gleiche Schlüssel und Platzhalter', { skip: !hasPhp && 'PHP nicht installiert' }, () => {
  const json = (f) => JSON.parse(execFileSync('php', ['-r', `echo json_encode(require "${f}", JSON_UNESCAPED_UNICODE);`], { cwd: root, encoding: 'utf8' }))
  const T = json('aushang-texte.php')
  const PLAN = json('mein-plan-texte.php')
  assert.deepEqual(Object.keys(T), ['de', 'en'])
  const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
  for (const [lang, t] of Object.entries(T)) {
    assert.ok(PLAN[lang]?.sprache_name, `${lang}: Sprache der App (Name und „Sprache“ aus mein-plan-texte.php)`)
    assert.deepEqual(Object.keys(t), Object.keys(T.de), `${lang}: Schlüssel wie Deutsch`)
    for (const [k, v] of Object.entries(t)) {
      assert.ok(k.startsWith('ah_') && !(k in PLAN.de), `${k}: eigener Schlüssel`)
      assert.ok(typeof v === 'string' && v.trim(), `${lang}.${k} leer`)
      assert.deepEqual(holes(v), holes(T.de[k]), `${lang}.${k}: Platzhalter`)
    }
  }
  // jeder Schlüssel, den kunden.php verwendet, steht in den Texten
  const used = new Set([...PHP.matchAll(/\bth?\('(ah_[a-z_]+)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('_')))
  for (const k of Object.keys(CATEGORIES)) used.add(`ah_kat_${k}`)
  for (const k of ['eingegangen', 'arbeit', 'erledigt']) used.add(`ah_st_${k}`)
  for (const k of used) assert.ok(k in T.de, `${k} fehlt in aushang-texte.php`)
  assert.ok(used.size >= 40, `${used.size} Texte verwendet`)
  // keine Großbuchstaben-Wörter, Sie-Form
  assert.ok(!/\b(du|dich|dein)\b/i.test(Object.values(T.de).join(' ')))
})

test('Aushang: kunden.php endet vor dem Kundenbereich, Schutz gegen Programme und Grenzen', () => {
  const start = PHP.indexOf('$aushangCode = $nurText(')
  const ende = PHP.indexOf('// ---------------------------------------------------------------- Angebot online annehmen (kunden.php?a=CODE)', start)
  assert.ok(start > 0 && ende > start && PHP.indexOf('$link = link_zum_code($code);') > ende, 'Aushang vor Angebot und Link')
  const teil = PHP.slice(start, ende)
  // kein Zugriff auf Links, Nachweise, Rechnungen oder Termine
  assert.doesNotMatch(teil, /link_zum_code|link_ordner|link_datei|nachweise|rechnungen|termine|pdf_senden|angebot_/)
  // jeder Weg aus dem Abschnitt endet (Seite mit exit), nichts fällt in den Kundenbereich durch
  assert.match(teil, /\$ahSeite\('<div class="hallo"><h1>' \. th\('ah_titel'\)/)
  assert.match(teil, /seite\([^;]+\);\n\s+exit;/)
  // Honeypot, Mindestzeit, Grenzen geprüft und gezählt in einem Schritt, Adresse nur als Hashwert, Folge-Code als Hashwert
  assert.match(teil, /\$nurText\(\$_POST\['webseite'\] \?\? ''\) !== ''/)
  assert.match(teil, /\$alter === null \|\| \$alter < AUSHANG_MINDESTZEIT/)
  assert.match(teil, /grenze\('aushang-code', \$aid, GRENZE_AUSHANG_CODE, true\) \|\| grenze\('aushang-adresse', \$werHash, GRENZE_AUSHANG_ADRESSE, true\)/)
  assert.ok(teil.indexOf('GRENZE_AUSHANG_CODE, true') < teil.indexOf('$ok = meldungen('))
  assert.match(teil, /\$werHash = hash_hmac\('sha256', \$wer, \$schluessel\);/)
  assert.match(teil, /'statusHash' => hash\('sha256', \$sc\)/)
  assert.match(teil, /foto_speichern\(\$_FILES\['foto'\] \?\? null, \$mid\)/)
  assert.match(PHP, /const GRENZE_AUSHANG_CODE = \[10, 86400\];/)
  assert.match(PHP, /const GRENZE_AUSHANG_ADRESSE = \[5, 86400\];/)
  // die App überträgt mit dem Schlüssel des Kundenbereichs
  assert.match(PHP, /'status', 'aushang', 'angebot'/)
})

test('Aushang: Rechte wie der Kundenbereich (Reklamationen oder Planung bearbeiten), Daten in kundenbereich.json', () => {
  const path = MODULE_DOCS.kundenbereich.path
  const rights = (role) => dataRights(resolveAccess({ roleClaims: [role], strict: true }))
  for (const role of ['objektmanagement', 'objektleitung', 'objektservice']) assert.ok(rights(role).read(path) && rights(role).write(path), role)
  for (const role of ['lesen', 'lager', 'buchhaltung', 'lohnverrechnung', 'vorarbeiter']) assert.ok(!rights(role).read(path), role)
  // Abschnitt und Aktionen: dieselben Bereiche wie die Ansicht Kundenbereich
  const ui = read('src/ui/views/customer-portal-aushang.js')
  assert.match(ui, /const MODULES = \['reklamationen', 'planung'\]/)
  assert.match(ui, /registerModal\('ah-edit', posterModal, \{ module: MODULES \}\)/)
  assert.match(ui, /\{ edit: MODULES \},\n\)/)
})
