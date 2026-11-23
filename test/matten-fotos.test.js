// Mattenwechsel: Fotos des Fahrers, Fotopflicht, Verlauf je Liegeplatz, Fotonachweis (core/matten-fotos.js). Alle Daten erfunden.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { finishProblem, finishStop } from '../src/core/matten-fahrt.js'
import { isRefPhotoPath, PHOTO_RULES, photoCount, photoProblem, photoRule, photoRuleHint, placementPhotos, proofFileName, proofRows, refPhotoPath, stopPhotos, tourPhotos } from '../src/core/matten-fotos.js'
import { releaseTour } from '../src/core/matten-touren.js'

const photo = (n, extra = {}) => ({ name: `2026-11-12_t1_0${n}.jpg`, path: `matten/fotos/2026/lp1/2026-11-12_t1_0${n}.jpg`, at: `2026-11-12T08:1${n}:00.000Z`, by: 'Fahrer Eins', ...extra })
const item = (placementId, placementName, extra = {}) => ({ jobKey: `${placementId}:2026-11-12`, placementId, placementName, mat: { name: 'Matte', size: '85 × 150' }, planned: 1, status: 'geplant', ...extra })
const stop = (items, extra = {}) => ({ id: 'st-o1', objectId: 'o1', objectName: 'Musterhaus', customer: { id: 'c1', name: 'Muster GmbH' }, status: 'in-bearbeitung', items, ...extra })
const tour = (stops, extra = {}) => ({ id: 't1', date: '2026-11-12', status: 'unterwegs', driverName: 'Fahrer Eins', stops, ...extra })

test('Fotos eines Stopps: Reihenfolge der Liegeplätze, Fotos nur am ersten Eintrag des Liegeplatzes', () => {
  const s = stop([
    item('lp1', 'Haupteingang', { status: 'gewechselt', actual: 1, photos: [photo(1), photo(2, { queued: true })] }),
    item('lp1', 'Haupteingang', { status: 'gewechselt', actual: 1, mat: { name: 'Matte', size: '115 × 180' } }),
    item('lp2', 'Lieferanteneingang', { status: 'nicht-moeglich', reason: 'kein Zugang', photos: [{ path: 'matten/fotos/2026/lp2/2026-11-12_t1_01.jpg', at: '2026-11-12T08:20:00.000Z' }] }),
    item('lp3', 'Keller', { status: 'gewechselt', actual: 1 }),
  ])
  const list = stopPhotos(s)
  assert.equal(list.length, 3)
  assert.deepEqual(list.map((p) => [p.placementName, p.name, p.queued, p.status]), [
    ['Haupteingang', '2026-11-12_t1_01.jpg', false, 'gewechselt'],
    ['Haupteingang', '2026-11-12_t1_02.jpg', true, 'gewechselt'],
    ['Lieferanteneingang', '2026-11-12_t1_01.jpg', false, 'nicht-moeglich'],
  ])
  assert.equal(list[2].reason, 'kein Zugang')
  assert.equal(photoCount(s), 3)
  assert.equal(photoCount(stop([item('lp1', 'A')])), 0)
  assert.deepEqual(stopPhotos(null), [])
})

test('Fotos einer Tour tragen Tour, Tag, Stopp, Kunde und Objekt', () => {
  const t = tour([stop([item('lp1', 'Haupteingang', { photos: [photo(1)] })]), stop([item('lp9', 'Tor')], { id: 'st-o2' })])
  assert.deepEqual(tourPhotos(t).map((p) => [p.tourId, p.date, p.stopId, p.customerName, p.objectName, p.placementId]), [['t1', '2026-11-12', 'st-o1', 'Muster GmbH', 'Musterhaus', 'lp1']])
})

test('Verlauf je Liegeplatz: neueste zuerst, nur dieser Liegeplatz, begrenzt', () => {
  const tours = [
    tour([stop([item('lp1', 'Haupteingang', { photos: [photo(1)] }), item('lp2', 'Tor', { photos: [{ path: 'matten/fotos/2026/lp2/x.jpg', at: '2026-11-12T09:00:00.000Z' }] })])]),
    tour([stop([item('lp1', 'Haupteingang', { photos: [{ path: 'matten/fotos/2026/lp1/2026-11-26_t2_01.jpg', at: '2026-11-26T08:00:00.000Z' }, { path: 'matten/fotos/2026/lp1/2026-11-26_t2_02.jpg', at: '2026-11-26T08:01:00.000Z' }] })])], { id: 't2', date: '2026-11-26', driverName: 'Fahrer Zwei' }),
  ]
  const all = placementPhotos(tours, 'lp1')
  assert.deepEqual(all.map((p) => [p.tourId, p.date, p.name]), [['t2', '2026-11-26', '2026-11-26_t2_02.jpg'], ['t2', '2026-11-26', '2026-11-26_t2_01.jpg'], ['t1', '2026-11-12', '2026-11-12_t1_01.jpg']])
  assert.equal(all[0].driverName, 'Fahrer Zwei')
  assert.equal(placementPhotos(tours, 'lp1', { limit: 1 }).length, 1)
  assert.deepEqual(placementPhotos(tours, 'lp7'), [])
  assert.deepEqual(placementPhotos(tours, ''), [])
})

test('Fotopflicht: freiwillig, bei Ausnahme, immer', () => {
  assert.deepEqual(Object.keys(PHOTO_RULES), ['nie', 'ausnahme', 'immer'])
  assert.equal(photoRule('immer'), 'immer')
  assert.equal(photoRule('quatsch'), 'nie')
  assert.equal(photoRule(undefined), 'nie')
  const done = stop([item('lp1', 'Haupteingang', { status: 'gewechselt', actual: 1 })])
  const doneFoto = stop([item('lp1', 'Haupteingang', { status: 'gewechselt', actual: 1, photos: [photo(1)] })])
  const blocked = stop([item('lp1', 'Haupteingang', { status: 'gewechselt', actual: 1 }), item('lp2', 'Tor', { status: 'nicht-moeglich', reason: 'kein Zugang' })])
  const blockedFoto = stop([item('lp1', 'Haupteingang', { status: 'gewechselt', actual: 1 }), item('lp2', 'Tor', { status: 'nicht-moeglich', reason: 'kein Zugang', photos: [photo(1)] })])
  // freiwillig: nie ein Hinweis
  for (const s of [done, blocked]) assert.equal(photoProblem(s, 'nie'), '')
  assert.equal(photoProblem(blocked, 'unbekannt'), '')
  // immer: mindestens ein Foto am Stopp
  assert.match(photoProblem(done, 'immer'), /^Foto fehlt: an jedem Stopp/)
  assert.equal(photoProblem(doneFoto, 'immer'), '')
  assert.equal(photoProblem(blockedFoto, 'immer'), '')
  // Ausnahme: nur der nicht mögliche Liegeplatz braucht ein Foto
  assert.equal(photoProblem(done, 'ausnahme'), '')
  assert.match(photoProblem(blocked, 'ausnahme'), /^Foto fehlt bei „Tor“/)
  assert.equal(photoProblem(blockedFoto, 'ausnahme'), '')
  // Ausnahme beim Abschluss (z. B. nicht angetroffen) mit offenen Liegeplätzen: ein Foto am Stopp genügt
  const open = stop([item('lp1', 'Haupteingang'), item('lp2', 'Tor')])
  assert.equal(photoProblem(open, 'ausnahme'), '')
  assert.match(photoProblem(open, 'ausnahme', { outcome: 'nicht-angetroffen' }), /^Foto fehlt: Wenn der Stopp nicht wie geplant/)
  assert.equal(photoProblem(stop([item('lp1', 'Haupteingang', { photos: [photo(1)] }), item('lp2', 'Tor')]), 'ausnahme', { outcome: 'nicht-angetroffen' }), '')
  assert.equal(photoRuleHint('nie'), '')
  assert.match(photoRuleHint('immer'), /mindestens ein Foto/)
  assert.match(photoRuleHint('ausnahme'), /nicht möglich/)
})

test('Abschluss des Stopps prüft die Fotopflicht (Kopie der Regel an der Tour)', () => {
  const sig = { name: 'Frau Muster', role: 'Kunde', svg: '<svg/>' }
  const s = stop([item('lp1', 'Haupteingang', { status: 'gewechselt', actual: 1 })])
  assert.equal(finishProblem(s, { signature: sig }), '')
  assert.equal(finishProblem(s, { signature: sig, photoRule: 'ausnahme' }), '')
  assert.match(finishProblem(s, { signature: sig, photoRule: 'immer' }), /^Foto fehlt/)
  const withPhoto = stop([item('lp1', 'Haupteingang', { status: 'gewechselt', actual: 1, photos: [photo(1)] })])
  assert.equal(finishProblem(withPhoto, { signature: sig, photoRule: 'immer' }), '')
  // die übrigen Prüfungen kommen zuerst (offene Liegeplätze), die Fotopflicht danach
  assert.match(finishProblem(stop([item('lp1', 'Haupteingang')]), { signature: sig, photoRule: 'immer' }), /^Noch offen/)
  // finishStop nimmt die Regel von der Tour
  const t = tour([s], { photoRule: 'immer' })
  assert.throws(() => finishStop(t, 'st-o1', { signature: sig, now: '2026-11-12T09:00:00.000Z', by: 'Fahrer Eins' }), /Foto fehlt/)
  const ok = finishStop(tour([withPhoto], { photoRule: 'immer' }), 'st-o1', { signature: sig, now: '2026-11-12T09:00:00.000Z', by: 'Fahrer Eins' })
  assert.equal(ok.stops[0].status, 'abgeschlossen')
  // ohne Regel an der Tour bleibt alles wie bisher
  assert.equal(finishStop(tour([s]), 'st-o1', { signature: sig, now: '2026-11-12T09:00:00.000Z', by: 'Fahrer Eins' }).stops[0].status, 'abgeschlossen')
})

test('Freigabe schreibt die Fotopflicht an die Tour', () => {
  const draft = { id: 't1', date: '2026-11-12', status: 'entwurf', stops: [] }
  assert.equal(releaseTour(draft, { now: '2026-11-11T10:00:00.000Z', by: 'Büro', photoRule: 'ausnahme' }).photoRule, 'ausnahme')
  assert.equal('photoRule' in releaseTour(draft, { now: '2026-11-11T10:00:00.000Z', by: 'Büro' }), false)
  assert.equal('photoRule' in releaseTour({ ...draft, photoRule: 'immer' }, { now: '2026-11-11T10:00:00.000Z', by: 'Büro', photoRule: 'nie' }), false)
})

test('Liegeplatz-Foto: Pfad unter matten/fotos/liegeplatz/', () => {
  const p = refPhotoPath('lp-1_a', { now: '2026-11-23T08:15:30.000Z' })
  assert.equal(p, 'matten/fotos/liegeplatz/lp-1_a/20261123-081530.jpg')
  assert.equal(isRefPhotoPath(p), true)
  assert.equal(isRefPhotoPath('matten/fotos/2026/lp1/2026-11-12_t1_01.jpg'), false)
  assert.equal(refPhotoPath('lp1', { now: '2026-11-23T08:15:30.000Z', ext: 'png' }), 'matten/fotos/liegeplatz/lp1/20261123-081530.png')
  assert.throws(() => refPhotoPath('../x'.replace(/[^.\/]/g, '')), /ohne Liegeplatz/)
})

test('Fotonachweis: Zeilen mit Liegeplatz, Zeit in Wien, Person und Grund; Dateiname', () => {
  const s = stop([
    item('lp1', 'Haupteingang', { status: 'gewechselt', actual: 1, photos: [photo(1)] }),
    item('lp2', 'Tor', { status: 'nicht-moeglich', reason: 'kein Zugang', photos: [{ path: 'matten/fotos/2026/lp2/a.jpg', at: '2026-11-12T08:20:00.000Z', by: 'Fahrer Eins' }] }),
  ])
  assert.deepEqual(proofRows(s).map((r) => [r.title, r.sub]), [
    ['Haupteingang', '12.11.2026, 09:11 Uhr · Fahrer Eins'],
    ['Tor', '12.11.2026, 09:20 Uhr · Fahrer Eins · nicht möglich: kein Zugang'],
  ])
  assert.equal(proofFileName({ number: 'LS-2026-000123', date: '2026-11-12', customerName: 'Muster GmbH & Co KG' }), 'Fotonachweis_LS-2026-000123_Muster-GmbH-Co-KG.pdf')
  assert.equal(proofFileName({ date: '2026-11-12', customerName: 'Bäckerei Österreich' }), 'Fotonachweis_2026-11-12_Bäckerei-Österreich.pdf')
  assert.equal(proofFileName(), 'Fotonachweis.pdf')
})
