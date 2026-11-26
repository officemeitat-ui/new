// Meldungen der Fahrer aus dem Stopp (core/matten-meldungen.js): Prüfung, am Stopp speichern (auch nach dem Abschluss),
// Liste fürs Büro, Stand (Reklamation, erledigt), Vorlage für die Reklamation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addReport, complaintDraft, markReportDone, openReports, removeReport, reopenReport, reportProblem, reportsOf, reportState, REPORT_SOURCE } from '../src/core/matten-meldungen.js'
import { finishStop } from '../src/core/matten-fahrt.js'
import { KINDS, SOURCES } from '../src/core/complaints.js'

const tour = () => ({
  id: 'mt1',
  date: '2026-11-30',
  status: 'unterwegs',
  driverName: 'Dragan Jović',
  order: ['st-o1'],
  stops: [{ id: 'st-o1', objectId: 'o1', objectName: 'Terminal', customer: { id: 'c1', name: 'Flughafen Beispiel' }, status: 'in-bearbeitung', items: [{ jobKey: 'p1|2026-11-30', placementId: 'p1', placementName: 'GAC – Schuhkontrolle', planned: 1, mat: { name: 'Matte' }, status: 'geplant', photos: [{ path: 'matten/fotos/a.jpg' }] }, { jobKey: 'p2|2026-11-30', placementId: 'p2', placementName: 'Windfang', planned: 1, mat: { name: 'Matte' }, status: 'geplant' }] }],
})

test('Prüfung: Art nötig; beschädigt mit Liegeplatz ohne Text; Beschwerde braucht Text', () => {
  assert.match(reportProblem({}), /was passiert ist/)
  assert.equal(reportProblem({ kind: 'schaden', placementId: 'p1' }), '')
  assert.match(reportProblem({ kind: 'schaden' }), /Liegeplatz/)
  assert.match(reportProblem({ kind: 'kunde', text: 'x' }), /beschreiben/)
  assert.equal(reportProblem({ kind: 'kunde', text: 'Kunde will andere Farbe' }), '')
})

test('Am Stopp speichern, auch nach dem Abschluss; Zurücknehmen nur am offenen Stopp', () => {
  let t = addReport(tour(), 'st-o1', { kind: 'schaden', placementId: 'p1', text: 'Rand eingerissen', id: 'mr1', now: '2026-11-30T08:10:00Z', by: 'Dragan' })
  const r = t.stops[0].reports[0]
  assert.deepEqual(r, { id: 'mr1', kind: 'schaden', placementId: 'p1', placementName: 'GAC – Schuhkontrolle', text: 'Rand eingerissen', at: '2026-11-30T08:10:00Z', by: 'Dragan' })
  assert.equal(t.stops[0].status, 'in-bearbeitung')
  assert.throws(() => addReport(t, 'st-o1', { kind: 'fehlt', placementId: 'px' }), /nicht im Stopp/)
  t = finishStop(t, 'st-o1', { reason: 'niemand vor Ort', outcome: 'nicht-durchgefuehrt', now: '2026-11-30T08:20:00Z', by: 'Dragan' })
  t = addReport(t, 'st-o1', { kind: 'kunde', text: 'Kunde ruft im Büro an', id: 'mr2', now: '2026-11-30T08:25:00Z', by: 'Dragan' })
  assert.equal(t.stops[0].reports.length, 2)
  assert.equal(t.stops[0].status, 'nicht-durchgefuehrt')
  assert.throws(() => removeReport(t, 'st-o1', 'mr1'), /abgeschlossen/)
  const open = addReport(tour(), 'st-o1', { kind: 'zugang', text: 'Tor zu', id: 'mr3' })
  assert.equal(removeReport(open, 'st-o1', 'mr3').stops[0].reports.length, 0)
})

test('Liste fürs Büro, Stand und Vorlage der Reklamation', () => {
  const t1 = addReport(tour(), 'st-o1', { kind: 'schaden', placementId: 'p1', text: 'Rand eingerissen', id: 'mr1', now: '2026-11-30T08:10:00Z', by: 'Dragan' })
  const t2 = addReport({ ...tour(), id: 'mt2' }, 'st-o1', { kind: 'kunde', text: 'Kunde will andere Farbe', id: 'mr2', now: '2026-11-30T09:00:00Z', by: 'Dragan' })
  const list = reportsOf([t1, t2])
  assert.deepEqual(list.map((r) => r.id), ['mr2', 'mr1'])
  assert.deepEqual(list[1].photos, [{ path: 'matten/fotos/a.jpg' }])
  assert.equal(list[1].kindLabel, 'Matte beschädigt')
  assert.deepEqual(reportState(list[1]), { state: 'offen' })
  const handled = markReportDone({}, 'mr2', { now: 'x', by: 'Petra' })
  assert.deepEqual(reportState(list[0], { handled }), { state: 'erledigt', at: 'x', by: 'Petra' })
  assert.deepEqual(reopenReport(handled, 'mr2'), {})
  const d = complaintDraft(list[1])
  assert.deepEqual(d, { objectId: 'o1', date: '2026-11-30', source: REPORT_SOURCE, kind: 'Schaden', text: 'Matte beschädigt (GAC – Schuhkontrolle): Rand eingerissen (gemeldet von Dragan, Mattenwechsel am 30.11.2026)', contact: 'Flughafen Beispiel', ref: 'mw-report:mr1' })
  assert.ok(KINDS.includes(d.kind) && SOURCES.includes(d.source), 'Art und Quelle gibt es in den Reklamationen')
  const complaints = [{ id: 'c9', ref: 'mw-report:mr1', status: 'arbeit' }]
  assert.deepEqual(reportState(list[1], { complaints }), { state: 'reklamation', complaintId: 'c9', complaintStatus: 'arbeit' })
  assert.deepEqual(openReports([t1, t2], { handled, complaints }).map((r) => r.id), [])
  assert.deepEqual(openReports([t1, t2], {}).map((r) => r.id), ['mr2', 'mr1'])
})
