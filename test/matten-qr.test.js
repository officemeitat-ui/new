// QR am Liegeplatz (core/matten-qr.js): Link auf dem Aufkleber, Liegeplatz aus dem Link, passender Stopp (heute zuerst),
// Scan vermerken (erster zählt, Stopp in Bearbeitung, abgeschlossen bleibt), Aufkleber-PDF.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markScanned, matchPlacementId, qrIdFromKey, qrLink, scansOf, scanTarget } from '../src/core/matten-qr.js'
import { qrStickerDocument, qrStickerName } from '../src/export/matten-qr-pdf.js'

const item = (pl) => ({ jobKey: `${pl}:d`, placementId: pl, placementName: pl, planned: 1, mat: { name: 'Matte' }, status: 'geplant' })
const tour = (id, date, status, stops) => ({ id, date, status, order: stops.map((s) => s.id), stops })
const stop = (id, pls, extra = {}) => ({ id, objectId: 'o1', status: 'geplant', items: pls.map(item), ...extra })

test('Link: Fahrerseite am Webspace bzw. direkt die App; Liegeplatz aus dem Link', () => {
  assert.equal(qrLink('Pl_1x', { appBase: 'https://app.example/app/index.html#mw-planung', webBase: 'https://app.example/app' }), 'https://app.example/app/mattentour.php?qr=Pl_1x')
  assert.equal(qrLink('Pl_1x', { appBase: 'https://app.example/app/index.html#mw-planung' }), 'https://app.example/app/index.html#mw-touren/qr/Pl_1x')
  assert.equal(qrIdFromKey('mw-touren/qr/pl_1x'), 'pl_1x')
  assert.equal(qrIdFromKey('mw-touren'), '')
  assert.equal(qrIdFromKey('mw-touren/qr/<script>'), '')
  assert.equal(matchPlacementId('pl_1x', ['a', 'Pl_1x']), 'Pl_1x')
})

test('Stopp zum Scan: heute zuerst, dann liegen gebliebene; nicht abgeschlossene, nicht Entwurf, nicht künftig', () => {
  const tours = [
    tour('alt', '2026-11-25', 'unterwegs', [stop('s1', ['p1'])]),
    tour('heute', '2026-11-26', 'freigegeben', [stop('s1', ['p1', 'p2'])]),
    tour('morgen', '2026-11-27', 'freigegeben', [stop('s1', ['p3'])]),
    tour('entwurf', '2026-11-26', 'entwurf', [stop('s1', ['p4'])]),
    tour('fertig', '2026-11-26', 'unterwegs', [stop('s1', ['p5'], { status: 'abgeschlossen' })]),
  ]
  assert.equal(scanTarget(tours, 'P1', { today: '2026-11-26' }).tour.id, 'heute')
  assert.equal(scanTarget(tours, 'p1', { today: '2026-11-26' }).placementId, 'p1')
  assert.equal(scanTarget(tours.filter((t) => t.id !== 'heute'), 'p1', { today: '2026-11-26' }).tour.id, 'alt')
  for (const p of ['p3', 'p4', 'p5', 'px']) assert.equal(scanTarget(tours, p, { today: '2026-11-26' }), null, p)
})

test('Scan vermerken: erster zählt, Stopp in Bearbeitung; abgeschlossener Stopp unverändert', () => {
  const t0 = tour('t', '2026-11-26', 'unterwegs', [stop('s1', ['p1', 'p2'])])
  const t1 = markScanned(t0, 's1', 'p2', { now: '2026-11-26T07:12:00Z', by: 'Ivo' })
  assert.deepEqual(t1.stops[0].items[1].scan, { at: '2026-11-26T07:12:00Z', by: 'Ivo' })
  assert.equal(t1.stops[0].status, 'in-bearbeitung')
  assert.equal(markScanned(t1, 's1', 'p2', { now: 'später', by: 'X' }), t1, 'zweiter Scan ändert nichts')
  assert.deepEqual([...scansOf(t1.stops[0]).keys()], ['p2'])
  assert.throws(() => markScanned(t0, 's1', 'px'), /nicht im Stopp/)
  const done = tour('t', '2026-11-26', 'unterwegs', [stop('s1', ['p1'], { status: 'abgeschlossen' })])
  assert.equal(markScanned(done, 's1', 'p1'), done)
})

test('Aufkleber-PDF: je Liegeplatz ein QR mit Link, zwei Spalten; Dateiname', () => {
  const items = [{ id: 'p1', name: 'GAC Schuhkontrolle', floor: 'EG', objectName: 'Terminal 1', customerName: 'Flughafen' }, { id: 'p2', name: 'Windfang' }, { id: 'p3', name: 'Tor' }]
  const doc = qrStickerDocument({ items, link: (id) => `https://x/mattentour.php?qr=${id}`, title: 'Flughafen' })
  const qrs = JSON.stringify(doc).match(/"qr":"[^"]+"/g)
  assert.deepEqual(qrs, ['"qr":"https://x/mattentour.php?qr=p1"', '"qr":"https://x/mattentour.php?qr=p2"', '"qr":"https://x/mattentour.php?qr=p3"'])
  assert.equal(doc.content.at(-1).table.body.length, 2)
  assert.equal(qrStickerName('Flughafen Salzburg', '2026-11-26'), 'QR-Liegeplaetze_Flughafen-Salzburg_2026-11-26.pdf')
})
