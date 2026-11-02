import { test } from 'node:test'
import assert from 'node:assert/strict'

import { areaMinutes, calcWage, calculate, frequencyLabel, hourlyRate } from '../src/core/calculation.js'
import { calcDocument, calcPdfName, offerDocument } from '../src/export/calc-pdf.js'

test('Kalkulation: Minuten je Fläche aus m², Leistungswert und Häufigkeit', () => {
  // 200 m² Büro, 200 m²/h, 5× pro Woche: 1 h × 5 × 52/12 = 21,67 h
  assert.equal(Math.round(areaMinutes({ type: 'buero', m2: 200, perWeek: 5 }).minutes), 1300)
  assert.equal(areaMinutes({ type: 'buero', m2: 200, perWeek: 5, value: 100 }).value, 100, 'eigener Leistungswert')
  assert.equal(areaMinutes({ type: 'sanitaer', m2: 30, perWeek: 5 }, { sanitaer: 60 }).minutes, 30 * 5 * 52 / 12)
  assert.equal(frequencyLabel(0.5), '14-tägig')
  assert.equal(frequencyLabel(12 / 52), 'monatlich')
  assert.equal(frequencyLabel(4), '4× pro Woche')
})

test('Kalkulation: Zuschläge nacheinander bis zum Verrechnungssatz', () => {
  const r = hourlyRate(10, { lnkPct: 100, materialPct: 10, overheadPct: 10, profitPct: 10 })
  assert.deepEqual(r.steps.map((s) => s.amount), [10, 10, 2, 2.2, 2.42])
  assert.equal(r.rate, 26.62)
  assert.equal(r.cost, 24.2, 'Selbstkosten ohne Gewinn')
})

test('Kalkulation: Stunden mit Rüstzeit, Monatspreis, je m², Lohn aus Lohngruppe', () => {
  const settings = { lnkPct: 90, setupPct: 10, materialPct: 8, overheadPct: 15, profitPct: 5, vatPct: 20 }
  const wage = calcWage({ wageGroup: '2' }, { 1: 15.2, 2: 13.54 })
  assert.equal(wage, 13.54)
  assert.equal(calcWage({ wageGroup: '2', wage: 16 }, { 2: 13.54 }), 16, 'eigener Lohn vor Lohngruppe')
  const c = calculate({ areas: [{ type: 'buero', m2: 200, perWeek: 5 }, { type: 'sanitaer', m2: 30, perWeek: 5 }], settings, wage })
  const cleaning = 200 / 200 * 60 * 5 * 52 / 12 + 30 / 60 * 60 * 5 * 52 / 12
  assert.equal(c.cleaningMinutes, Math.round(cleaning))
  assert.equal(c.minutes, Math.round(cleaning * 1.1))
  assert.equal(c.rate, hourlyRate(wage, settings).rate)
  assert.equal(c.net, Math.round((cleaning * 1.1) / 60 * c.rate * 100) / 100)
  assert.equal(c.gross, Math.round(c.net * 1.2 * 100) / 100)
  assert.equal(c.totalM2, 230)
  assert.equal(c.perM2, Math.round(c.net / 230 * 100) / 100)
  assert.ok(c.margin > 0 && Math.abs(c.net - c.costMonth - c.margin) < 0.02)
  assert.deepEqual(calculate({ areas: [], settings, wage }).net, 0)
})

test('Kalkulation als PDF: Angebot ohne Stunden und Zuschläge, intern mit allem', () => {
  const c = calculate({ areas: [{ name: 'Büros 1. OG', type: 'buero', m2: 200, perWeek: 5 }], settings: {}, wage: 13.54 })
  const offer = JSON.stringify(offerDocument({ object: { name: 'Steuerkanzlei', address: 'Schallmoos' }, calc: c, brand: { name: 'Firma' } }).content)
  assert.match(offer, /Angebot Unterhaltsreinigung/)
  assert.match(offer, /Büros 1\. OG.*200 m².*täglich \(Mo–Fr\)/)
  assert.match(offer, /Preis je Monat, netto/)
  assert.ok(!/Lohnnebenkosten|Verrechnungssatz|m²\/h/.test(offer), 'keine internen Werte im Angebot')
  const internal = JSON.stringify(calcDocument({ object: { name: 'Steuerkanzlei' }, calc: c, settings: { setupPct: 10 }, wage: 13.54, plannedMonth: 20, budgetMonth: 22, brand: {} }).content)
  assert.match(internal, /Lohnnebenkosten/)
  assert.match(internal, /Verrechnungssatz netto/)
  assert.match(internal, /Laut Reinigungsplan/)
  assert.equal(calcPdfName('Angebot', 'Steuerkanzlei Schallmoos'), 'Angebot_Steuerkanzlei-Schallmoos.pdf')
})
