// Beispieldaten: wie viele Wochen zurück geplant wird, damit der Vormonat nie leer ist (core/dates.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addDays, mondayOf, weeksBackToPrevMonth } from '../src/core/dates.js'

test('Beispieldaten reichen immer bis in die letzte volle Woche des Vormonats', () => {
  // Anfang des Monats: vier Wochen genügen (wie bisher)
  assert.equal(weeksBackToPrevMonth('2026-11-09', '2026-11-03'), 4)
  assert.equal(weeksBackToPrevMonth('2026-12-07', '2026-12-01'), 4)
  // letzte Woche des Monats: weiter zurück, bis zur Woche 19.–25.10.2026
  assert.equal(weeksBackToPrevMonth('2026-11-30', '2026-11-23'), 6)
  assert.equal(weeksBackToPrevMonth('2026-12-07', '2026-11-30'), 7)
  // für jeden Tag eines Jahres: die erste geplante Woche liegt ganz im Vormonat oder davor
  for (let d = '2026-01-01'; d <= '2027-01-31'; d = addDays(d, 1)) {
    const monday = mondayOf(addDays(d, 7))
    const first = addDays(monday, -7 * weeksBackToPrevMonth(monday, d))
    assert.ok(addDays(first, 6) < `${d.slice(0, 7)}-01`, `${d}: erste Woche ${first}`)
    assert.ok(weeksBackToPrevMonth(monday, d) <= 9, `${d}: höchstens neun Wochen`)
  }
})
