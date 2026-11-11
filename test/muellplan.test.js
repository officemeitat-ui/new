import { test } from 'node:test'
import assert from 'node:assert/strict'
import { joinStreets, personWastePlan, splitAddress, wastePlanTitle } from '../src/core/muellplan.js'
import { wastePlanDocument, wastePlanPdfName } from '../src/export/muellplan-pdf.js'

test('Adresse zerlegen: Straße, Hausnummer, Ort – mit und ohne Komma bzw. Postleitzahl', () => {
  assert.deepEqual(splitAddress('Davisstraße 9, 5400 Hallein'), { street: 'Davisstraße', no: '9', town: 'Hallein' })
  assert.deepEqual(splitAddress('Markt 303 5441 Abtenau'), { street: 'Markt', no: '303', town: 'Abtenau' })
  assert.deepEqual(splitAddress('Am Einlass 10, Ebensee'), { street: 'Am Einlass', no: '10', town: 'Ebensee' })
  assert.deepEqual(splitAddress('Davisstraße 7/2, A-5400 Hallein'), { street: 'Davisstraße', no: '7/2', town: 'Hallein' })
  assert.deepEqual(splitAddress('Bayerhammerplatz'), { street: 'Bayerhammerplatz', no: '', town: '' })
  assert.deepEqual(splitAddress(''), { street: '', no: '', town: '' })
})

test('Straßen zusammenfassen: gleiche Straße mit allen Nummern, in Zahlenfolge', () => {
  const p = (street, no = '') => ({ street, no })
  assert.equal(joinStreets([p('Davisstraße', '11'), p('Davisstraße', '7'), p('Thunstraße'), p('Davisstraße', '9'), p('Davisstraße', '9')]), 'Davisstraße 7, 9, 11, Thunstraße')
  assert.equal(joinStreets([]), '')
})

const objects = [
  { id: 'a', name: 'Wohnanlage A', address: 'Davisstraße 7, 5400 Hallein' },
  { id: 'b', name: 'Wohnanlage B', address: 'Davisstraße 9, 5400 Hallein' },
  { id: 'c', name: 'Wohnanlage C', address: 'Durchlassstraße 4, 5440 Golling' },
  { id: 'd', name: 'Büro ohne Adresse', short: 'Büro D' },
]
const MO = '2026-11-16'

test('Plan einer Person: je Tag und Ort, „zurück“ vor „raus“, kurze Namen, Straßen zusammengefasst', () => {
  const duties = [
    { date: MO, action: 'out', types: ['Biomüll'], objectId: 'a' },
    { date: MO, action: 'out', types: ['Biomüll'], objectId: 'b' },
    { date: MO, action: 'in', types: ['Altpapier'], objectId: 'c' },
    { date: MO, action: 'in', types: ['Leichtverpackung', 'Restmüll'], objectId: 'a' },
    { date: '2026-11-18', action: 'out', types: ['Restmüll'], objectId: 'd' },
    { date: '2026-11-30', action: 'out', types: ['Restmüll'], objectId: 'a' },
  ]
  const plan = personWastePlan(duties, objects, MO)
  assert.deepEqual(plan.towns, ['Hallein', 'Golling'])
  assert.equal(wastePlanTitle(plan), 'Müllplan Hallein + Golling')
  assert.equal(plan.days.length, 7)
  const mo = plan.days[0]
  assert.deepEqual(mo.groups.map((g) => g.town), ['Hallein', 'Golling'])
  assert.deepEqual(mo.groups[0].lines.map((l) => [l.label, l.action, l.text]), [
    ['Restmüll', 'in', 'Davisstraße 7'],
    ['Plastik', 'in', 'Davisstraße 7'],
    ['Biomüll', 'out', 'Davisstraße 7, 9'],
  ])
  assert.deepEqual(mo.groups[1].lines.map((l) => [l.label, l.action, l.text]), [['Papier', 'in', 'Durchlassstraße 4']])
  assert.deepEqual(plan.days[2].groups[0].lines[0], { type: 'Restmüll', label: 'Restmüll', action: 'out', text: 'Büro D' })
  assert.ok(plan.days.slice(3).every((d) => !d.groups.length), 'Gang außerhalb der Woche fällt weg')
  assert.equal(wastePlanTitle(personWastePlan([], objects, MO)), 'Müllplan')
})

test('PDF: eine Seite je Person mit Name, Datum der Woche und Raster der Tage', () => {
  const plan = personWastePlan([{ date: MO, action: 'out', types: ['Biomüll'], objectId: 'a' }], objects, MO)
  const doc = wastePlanDocument({ sheets: [{ name: 'Person Eins', plan }, { name: 'Person Zwei', plan: personWastePlan([], objects, MO) }], monday: MO, brand: { name: 'Cleanos' } })
  const text = JSON.stringify(doc.content)
  assert.match(text, /Müllplan Hallein/)
  assert.match(text, /Person Eins/)
  assert.match(text, /16\.11\.2026 bis 22\.11\.2026/)
  assert.match(text, /"Montag:"/)
  assert.match(text, /"Sonntag:"/)
  assert.match(text, /"raus"/)
  assert.match(text, /In dieser Woche keine Müll-Gänge/)
  assert.equal(doc.content.filter((x) => x.pageBreak === 'before').length, 1)
  assert.equal(wastePlanPdfName(MO), 'Muellplan_KW47_2026-11-16.pdf')
})

test('PDF-Name: Umlaute ausgeschrieben, nur einfache Zeichen', () => {
  assert.equal(wastePlanPdfName('2026-11-16', 'Gül Arslan-Öztürk'), 'Muellplan_KW47_2026-11-16_Guel_Arslan-Oeztuerk.pdf')
  assert.equal(wastePlanPdfName('2026-11-16', 'Ştefan Dumitraşcu'), 'Muellplan_KW47_2026-11-16_Stefan_Dumitrascu.pdf')
})
