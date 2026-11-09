// Werkzeuge des KI-Assistenten für Rentabilität, Nachkalkulation, Fahrtenbuch, Zusatzleistungen und Checklisten
// (src/ai/tools-auswertung.js): Rechte wie die Ansichten, nur lesen, knappe Rückgaben ohne Kontaktdaten und Namen.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { availableTools } from '../src/ai/registry.js'
import '../src/ai/tools.js'
import '../src/ai/tools-auswertung.js'
import { addDays, todayISO } from '../src/core/dates.js'
import { app } from '../src/ui/context.js'

const NEW = ['checklisten_nicht_moeglich', 'fahrtenbuch_abfragen', 'nachkalkulation_abfragen', 'rentabilitaet_abfragen', 'zusatzleistungen_offen']
const role = (seen, edited = [], all = false) => ({ all, sees: (m) => seen.includes(m) || edited.includes(m), canEdit: (m) => edited.includes(m) })
async function withApp(patch, fn) {
  const keys = ['access', 'readOnly', 'data', 'service']
  const before = Object.fromEntries(keys.map((k) => [k, app[k]]))
  Object.assign(app, patch)
  try {
    return await fn()
  } finally {
    Object.assign(app, before)
  }
}
const names = () => availableTools().map((t) => t.name).filter((n) => NEW.includes(n))
const tool = (name) => availableTools().find((t) => t.name === name)

test('KI-Auswertung: Werkzeuge beschrieben, nur lesen, Rechte wie die Ansichten', async () => {
  await withApp({ access: null, readOnly: false }, () => {
    assert.deepEqual(names(), NEW)
    for (const t of availableTools().filter((x) => NEW.includes(x.name))) {
      assert.ok(!t.write, `${t.name} nur lesen`)
      assert.ok(t.description.length >= 60 && t.label, t.name)
      assert.ok(!/claude|opus|sonnet|haiku/i.test(t.description), 'keine Modellnamen')
    }
  })
  // Buchhaltung mit Auswertung: Rentabilität und Zusatzleistungen, nicht Kalkulation, Fahrtenbuch, Checklisten
  await withApp({ access: role(['fakturierung', 'auswertung']), readOnly: false }, () => assert.deepEqual(names(), ['rentabilitaet_abfragen', 'zusatzleistungen_offen']))
  // Fuhrpark: nur das Fahrtenbuch
  await withApp({ access: role(['fahrzeuge']), readOnly: false }, () => assert.deepEqual(names(), ['fahrtenbuch_abfragen']))
  // Planung (bearbeitet Planung): Checklisten und Zusatzleistungen
  await withApp({ access: role([], ['planung']), readOnly: false }, () => assert.deepEqual(names(), ['checklisten_nicht_moeglich', 'zusatzleistungen_offen']))
  // Vollzugriff als Rolle: alles
  await withApp({ access: role([], [], true), readOnly: false }, () => assert.deepEqual(names(), NEW.filter((n) => !['fahrtenbuch_abfragen', 'checklisten_nicht_moeglich'].includes(n))))
  // Lager: nichts
  await withApp({ access: role(['material']), readOnly: false }, () => assert.deepEqual(names(), []))
})

const service = { ensureWeeks: async () => {}, ensureYears: async () => false, yearLoaded: () => true }

test('KI-Auswertung: Zusatzleistungen offen ohne Kontaktdaten, Stand aus dem Angebot', async () => {
  const req = (id, no, extra = {}) => ({ id, no, objectName: 'Wohnanlage Rif', kindName: 'Grundreinigung', from: '2026-11-20', to: '', area: 120, text: 'Bitte Stiegenhaus', contact: { name: 'Maria Huber', phone: '0662 1', email: 'm@example.com' }, received: '2026-11-05T10:00:00.000Z', ...extra })
  const data = {
    zusatz: { requests: [req('zl1', 'ZL-2026-001'), req('zl2', 'ZL-2026-002', { declined: { reason: 'nicht möglich' } }), req('zl3', 'ZL-2026-003', { offer: { id: 'an1', number: 'AN-2026-0004', state: 'offen', sent: true } })] },
    fakturierung: { documents: [], customers: [], settings: {} },
  }
  await withApp({ access: null, readOnly: false, data, service }, async () => {
    const r = await tool('zusatzleistungen_offen').run({})
    assert.equal(r.anzahl, 2)
    assert.deepEqual(r.anfragen.map((a) => [a.nummer, a.stand, a.angebot]), [['ZL-2026-001', 'eingegangen', null], ['ZL-2026-003', 'Angebot gesendet', 'AN-2026-0004']])
    assert.ok(!JSON.stringify(r).includes('Maria') && !JSON.stringify(r).includes('example.com'), 'keine Kontaktdaten')
    assert.equal((await tool('zusatzleistungen_offen').run({ nur_offen: false })).anzahl, 3)
  })
})

test('KI-Auswertung: Checklisten „nicht möglich“ je Objekt ohne Namen', async () => {
  const today = todayISO()
  const d = addDays(today, -2)
  const data = {
    objects: [{ id: 'o1', name: 'Wohnanlage Rif' }],
    checks: {
      [`${d}|k1`]: { id: 'k1', date: d, instKey: 'i1', empId: 'e1', name: 'Anna Berger', objectId: 'o1', objectName: 'Wohnanlage Rif', label: 'Unterhaltsreinigung', items: [{ id: 'p1', text: 'Böden', status: 'ok' }, { id: 'p2', text: 'Keller', status: 'nicht', reason: 'Raum versperrt' }], finished: 'x' },
      [`${addDays(today, -40)}|k2`]: { id: 'k2', date: addDays(today, -40), instKey: 'i2', objectId: 'o1', objectName: 'Wohnanlage Rif', items: [{ id: 'p1', text: 'Böden', status: 'nicht', reason: 'alt' }] },
    },
  }
  await withApp({ access: null, readOnly: false, data, service }, async () => {
    const r = await tool('checklisten_nicht_moeglich').run({})
    assert.equal(r.objekte.length, 1)
    assert.deepEqual([r.objekte[0].punkte, r.objekte[0].erledigt], [2, 1])
    assert.match(r.objekte[0].nicht_moeglich[0], /Keller – Raum versperrt/)
    assert.ok(!JSON.stringify(r).includes('Anna'), 'keine Namen')
    await assert.rejects(() => tool('checklisten_nicht_moeglich').run({ von: today, bis: addDays(today, -1) }), /liegt nach/)
  })
})

test('KI-Auswertung: Fahrtenbuch je Fahrzeug (Summen, Lücke, Privat-Schnitt, Kennzeichen-Suche)', async () => {
  const m = todayISO().slice(0, 7)
  const t = (id, date, kind, kmStart, kmEnd) => ({ id, vehicleId: 'v1', date, kind, route: 'A – B', purpose: 'Reinigung', kmStart, kmEnd, km: kmEnd - kmStart, confirmedAt: 'x' })
  const data = {
    fahrzeuge: { vehicles: [{ id: 'v1', plate: 'S-284 KL' }, { id: 'v2', plate: 'S-511 TR' }] },
    fahrtenbuch: [t('a', `${m}-01`, 'dienst', 1000, 1040), t('b', `${m}-01`, 'privat', 1100, 1130)],
    objects: [],
    employees: [],
  }
  await withApp({ access: null, readOnly: false, data, service }, async () => {
    const r = await tool('fahrtenbuch_abfragen').run({ fahrzeug: 's284kl' })
    assert.equal(r.fahrzeuge.length, 1)
    const f = r.fahrzeuge[0]
    assert.deepEqual([f.kennzeichen, f.fahrten, f.km_dienstlich, f.km_privat], ['S-284 KL', 2, 40, 30])
    assert.ok(f.pruefung.some((x) => /60 km zwischen den Fahrten/.test(x)), JSON.stringify(f.pruefung))
    await assert.rejects(() => tool('fahrtenbuch_abfragen').run({ fahrzeug: 'S-' }), /nicht eindeutig/)
    await assert.rejects(() => tool('fahrtenbuch_abfragen').run({ fahrzeug: 'W-1' }), /nicht gefunden/)
  })
})
