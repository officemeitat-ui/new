// Nachgeholte Uploads: Fotos und Dateien aus Regiebericht, Anlagen, Qualitätsmessung, Arbeitsschutz, Bewerbungen …
// kamen ohne Netz in die Warteschlange der Ablage und stehen im Modul mit queued: true. Holt der Abgleich sie nach,
// muss der Vermerk weg und die url dazu (core/uploads.js markUploaded; ui/context.js registerUploadHook, uploadDone),
// und was mit echtem Fehler hängt, steht in „Zu erledigen“ (ui/uploads.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { markUploaded, queuedFiles } from '../src/core/uploads.js'

// Was die Module der Oberfläche beim Import vom Browser brauchen: Attrappen genügen (wie test/lazy.test.js)
const noop = () => {}
const el = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop }, append: noop, setAttribute: noop, addEventListener: noop })
globalThis.window ??= globalThis
globalThis.addEventListener ??= noop
globalThis.localStorage ??= { getItem: () => null, setItem: noop, removeItem: noop }
globalThis.document ??= { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: el, head: el(), body: el(), documentElement: el() }

const { app, registerUploadHook, uploadDone, UPLOAD_HOOKS } = await import('../src/ui/context.js')
const { SOURCES } = await import('../src/ui/modals/todo.js')
const { startUploads, uploadLabel, uploadState } = await import('../src/ui/uploads.js')

/** Moduldaten, wie sie nach einem Funkloch aussehen: je Modul ein Eintrag, der noch wartet, und einer, der fertig ist. */
const data = () => ({
  employees: [{ id: 'e1', name: 'Ana' }],
  regie: { reports: [{ id: 'r1', photos: [{ path: 'regie/nachweise/2026/a.jpg', name: 'a.jpg', phase: 'vorher', queued: true }, { path: 'regie/nachweise/2026/b.jpg', name: 'b.jpg', url: 'https://sp/b.jpg' }], pdf: null }] },
  anlagen: { checks: [{ id: 'c1', photos: [{ path: 'anlagen/nachweise/2026/c1_1.jpg', queued: true }], report: { path: 'anlagen/nachweise/2026/c1_pruefbericht.pdf', name: 'Bericht.pdf', queued: true } }] },
  qualitaet: { measurements: [{ id: 'm1', rooms: [{ items: [{ photo: { path: 'qualitaet/nachweise/2026/m1_r1.jpg', queued: true } }, { photo: null }] }], report: { path: 'qualitaet/nachweise/2026/m1.pdf', queued: true } }] },
  material: { articles: [{ id: 'a1', haz: { sdb: { path: 'arbeitsschutz/dokumente/sdb/x_2026-01-01_s1.pdf', queued: true }, sdbDate: '2026-01-01' } }] },
  bewerbung: { applicants: [{ id: 'b1', docs: [{ path: 'bewerbung/unterlagen/b1/2026-11-09_cv.pdf', queued: true }] }] },
  reklamationen: { items: [{ id: 'k1', photos: [{ path: 'reklamationen/fotos/2026-11/k1.jpg', url: '' }] }] },
})

test('Nachgeholte Uploads: Vermerk am passenden Eintrag, egal in welchem Modul und wie tief', () => {
  const d = data()
  assert.equal(markUploaded(d, 'regie/nachweise/2026/a.jpg', 'https://sp/a.jpg'), 1)
  assert.deepEqual(d.regie.reports[0].photos[0], { path: 'regie/nachweise/2026/a.jpg', name: 'a.jpg', phase: 'vorher', url: 'https://sp/a.jpg' })
  assert.deepEqual(d.regie.reports[0].photos[1], { path: 'regie/nachweise/2026/b.jpg', name: 'b.jpg', url: 'https://sp/b.jpg' }, 'andere Datei unverändert')
  assert.equal(markUploaded(d, 'anlagen/nachweise/2026/c1_pruefbericht.pdf', 'https://sp/p.pdf'), 1)
  assert.deepEqual(d.anlagen.checks[0].report, { path: 'anlagen/nachweise/2026/c1_pruefbericht.pdf', name: 'Bericht.pdf', url: 'https://sp/p.pdf' })
  assert.equal(d.anlagen.checks[0].photos[0].queued, true, 'das Foto derselben Prüfung wartet weiter')
  assert.equal(markUploaded(d, 'qualitaet/nachweise/2026/m1_r1.jpg', 'https://sp/q.jpg'), 1)
  assert.deepEqual(d.qualitaet.measurements[0].rooms[0].items[0].photo, { path: 'qualitaet/nachweise/2026/m1_r1.jpg', url: 'https://sp/q.jpg' })
  assert.equal(markUploaded(d, 'arbeitsschutz/dokumente/sdb/x_2026-01-01_s1.pdf', 'https://sp/s.pdf'), 1)
  assert.deepEqual(d.material.articles[0].haz.sdb, { path: 'arbeitsschutz/dokumente/sdb/x_2026-01-01_s1.pdf', url: 'https://sp/s.pdf' })
  assert.equal(markUploaded(d, 'bewerbung/unterlagen/b1/2026-11-09_cv.pdf', 'https://sp/cv.pdf'), 1)
  assert.equal(d.bewerbung.applicants[0].docs[0].url, 'https://sp/cv.pdf')
  // Reklamation vom Webspace: ohne queued, aber noch ohne Adresse
  assert.equal(markUploaded(d, 'reklamationen/fotos/2026-11/k1.jpg', 'https://sp/k1.jpg'), 1)
  assert.deepEqual(d.reklamationen.items[0].photos[0], { path: 'reklamationen/fotos/2026-11/k1.jpg', url: 'https://sp/k1.jpg' })
  assert.deepEqual(queuedFiles(d).map((f) => f.path), ['anlagen/nachweise/2026/c1_1.jpg', 'qualitaet/nachweise/2026/m1.pdf'])
})

test('Nachgeholte Uploads: unbekannter Pfad und schon hochgeladene Datei bleiben unberührt; ohne Adresse nur queued weg', () => {
  const d = data()
  const before = JSON.stringify(d)
  assert.equal(markUploaded(d, 'regie/nachweise/2026/fehlt.jpg', 'https://sp/x.jpg'), 0)
  assert.equal(markUploaded(d, 'regie/nachweise/2026/b.jpg', 'https://sp/anders.jpg'), 0, 'hat schon eine Adresse')
  assert.equal(markUploaded(d, '', 'https://sp/x.jpg'), 0)
  assert.equal(markUploaded(null, 'regie/nachweise/2026/a.jpg', 'https://sp/x.jpg'), 0)
  assert.equal(JSON.stringify(d), before)
  assert.equal(markUploaded(d, 'anlagen/nachweise/2026/c1_1.jpg', null), 1)
  assert.deepEqual(d.anlagen.checks[0].photos[0], { path: 'anlagen/nachweise/2026/c1_1.jpg' }, 'SharePoint ohne webUrl: wartet nicht mehr, Adresse fehlt')
})

test('Nachgeholte Uploads: uploadDone fragt die angemeldeten Module, findet Dateien in allen Moduldaten und speichert nur bei Treffer', () => {
  const hooksBefore = UPLOAD_HOOKS.length
  let scheduled = 0
  app.service = { schedule: () => scheduled++ }
  app.data = data()
  const seen = []
  const off = registerUploadHook((path, url) => {
    seen.push([path, url])
    return path.startsWith('matten/fotos/') // wie die Fahreransicht: nur ihre Fotos
  })
  assert.equal(uploadDone('regie/nachweise/2026/a.jpg', 'https://sp/a.jpg'), true)
  assert.equal(app.data.regie.reports[0].photos[0].url, 'https://sp/a.jpg')
  assert.equal(app.data.regie.reports[0].photos[0].queued, undefined)
  assert.equal(scheduled, 1, 'persist()')
  assert.equal(uploadDone('matten/fotos/2026/p1/x.jpg', 'https://sp/x.jpg'), true, 'das angemeldete Modul kennt die Datei')
  assert.equal(scheduled, 1, 'nichts in app.data geändert: nicht gespeichert')
  assert.equal(uploadDone('exporte/2026/plan.pdf', 'https://sp/plan.pdf'), false, 'kein Modul kennt sie: die Ablage merkt sie sich')
  assert.deepEqual(seen.map(([p]) => p), ['regie/nachweise/2026/a.jpg', 'matten/fotos/2026/p1/x.jpg', 'exporte/2026/plan.pdf'])
  // ein Fehler in einem Modul hält den Vermerk in den anderen nicht auf
  const offBad = registerUploadHook(() => {
    throw new Error('kaputt')
  })
  const warn = console.warn
  console.warn = noop
  try {
    assert.equal(uploadDone('anlagen/nachweise/2026/c1_1.jpg', 'https://sp/c.jpg'), true)
  } finally {
    console.warn = warn
  }
  assert.equal(scheduled, 2)
  offBad()
  off()
  assert.equal(UPLOAD_HOOKS.length, hooksBefore, 'abgemeldet')
})

test('Nachgeholte Uploads: „Zu erledigen“ zeigt Dateien mit echtem Fehler – für jede Rolle, mit „Erneut versuchen“', () => {
  const src = SOURCES.find((s) => s.id === 'uploads')
  assert.ok(src, 'Quelle angemeldet')
  assert.equal(src.module, null, 'betrifft nur dieses Gerät: kein Modul-Recht nötig')
  assert.deepEqual(src.compute('2026-11-09'), [])
  // Browser-Ablage: keine Warteschlange, nichts anzuhängen
  assert.equal(startUploads({ service: { store: {} } }), false)
  let flushed = 0
  const service = { store: { flushUploads: noop }, flushQueuedUploads: async () => (flushed++, 0) }
  assert.equal(startUploads({ service }), true)
  assert.equal(service.onUploaded, uploadDone, 'Vermerk im Modul hängt am DataService')
  assert.equal(flushed, 1, 'nach dem Start gleich nachholen')
  service.onUploads({ done: 0, left: 2, failed: [{ path: 'regie/nachweise/2026/a.jpg', error: 'Zugriff verweigert', tries: 3 }] })
  assert.equal(uploadState.queued, 2)
  const items = src.compute('2026-11-09')
  assert.equal(items.length, 1)
  assert.equal(items[0].id, 'fehl:regie/nachweise/2026/a.jpg', 'Kennung bleibt bei weiteren Versuchen gleich (kein neues Aufpoppen)')
  const html = src.render(items)
  assert.match(html, /<strong>a\.jpg<\/strong>/)
  assert.match(html, /Regieberichte/)
  assert.match(html, /Zugriff verweigert · 3 Versuche/)
  assert.match(html, /data-action="uploads-retry"/)
  service.onUploads({ done: 0, left: 1, failed: [] })
  assert.deepEqual(src.compute('2026-11-09'), [], 'wartet nur auf Netz: kein Punkt')
})

test('Nachgeholte Uploads: Bereich zum Pfad (Ordner in SharePoint)', () => {
  assert.equal(uploadLabel('regie/nachweise/2026/a.jpg'), 'Regieberichte')
  assert.equal(uploadLabel('anlagen/nachweise/2026/x.pdf'), 'Anlagen & Prüffristen je Objekt')
  assert.equal(uploadLabel('arbeitsschutz/dokumente/sdb/x.pdf'), 'Sicherheitsdatenblätter')
  assert.equal(uploadLabel('matten/fotos/2026/p/x.jpg'), 'Mattenwechsel')
  assert.equal(uploadLabel('sonstiges/x.jpg'), 'sonstiges')
})
