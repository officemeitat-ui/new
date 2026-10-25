import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addMonths, checklistItems, checklistToText, findings, inspectionDue, itemText, openDefects, progress, reworkTask, suggestOverall, summaryText, textToChapters } from '../src/core/inspections.js'
import { OBJEKTKONTROLLE_CHECKLIST } from '../src/data/checklist-objektkontrolle.js'

const cl = OBJEKTKONTROLLE_CHECKLIST
const insp = (id, date, items, extra = {}) => ({ id, objectId: 'o1', checklistId: cl.id, date, status: 'abgeschlossen', items, ...extra })

test('Kontrolle: Katalog mit 9 Kapiteln und 39 Punkten, Nummer = Kapitel.Position', () => {
  const items = checklistItems(cl)
  assert.equal(items.length, 39)
  assert.deepEqual(cl.chapters.map((c) => c.items.length), [12, 3, 3, 1, 3, 4, 4, 5, 4])
  assert.equal(items.find((x) => x.id === '8.2').text, 'Gehwege, Zugänge und Zufahrten frei, eben und ohne Stolperstellen')
  assert.equal(itemText(cl, '4.1'), 'Alle Leuchtmittel funktionieren')
})

test('Kontrolle: Vorschlag Gesamtzustand wie im Prüfprotokoll-Tool', () => {
  const r = (...list) => Object.fromEntries(list.map((x, i) => [`1.${i + 1}`, { rating: x }]))
  assert.equal(suggestOverall(r('OK', 'OK', 'NA')), 'Sehr gut')
  assert.equal(suggestOverall(r('R', 'R', 'R')), 'Sehr gut')
  assert.equal(suggestOverall(r('R', 'R', 'R', 'R')), 'Gut')
  assert.equal(suggestOverall(r('M')), 'Gut')
  assert.equal(suggestOverall(r('M', 'M', 'M')), 'Handlungsbedarf')
  assert.equal(suggestOverall(r('OK', 'G')), 'Kritisch')
})

test('Kontrolle: Fortschritt je Kapitel und Feststellungen nach Priorität', () => {
  const items = { '1.1': { rating: 'OK' }, '1.2': { rating: 'R' }, '8.2': { rating: 'G', note: 'Platte lose' }, '4.1': { rating: 'M', prio: '4' } }
  const p = progress(cl, items)
  assert.deepEqual([p.rated, p.total, p.chapters[0].rated, p.chapters[0].worst, p.chapters[7].worst, p.chapters[1].worst], [4, 39, 2, 'R', 'G', null])
  assert.deepEqual(findings({ items }, cl).map((f) => [f.id, f.prio]), [['8.2', '1'], ['1.2', '3'], ['4.1', '4']])
  const text = summaryText({ items, summary: {} }, cl)
  assert.match(text, /4 von 39 Prüfpunkten bewertet, 1 in Ordnung\. 3 Feststellungen: 1 × Gefahr, 1 × Mangel, 1 × Reinigung\. Sofort: Gehwege.*\(Platte lose\)\. Gesamtzustand: Kritisch\./)
})

test('Kontrolle: Mängel werden fortgeschrieben, OK oder „erledigt“ schließt sie', () => {
  const list = [
    insp('a', '2026-03-10', { '8.3': { rating: 'M', note: 'Außenlicht defekt' }, '1.4': { rating: 'M' }, '7.3': { rating: 'R' } }),
    insp('b', '2026-06-12', { '8.3': { rating: 'NA' }, '1.4': { rating: 'OK' }, '7.3': { rating: 'R', note: 'wieder' }, '2.1': { rating: 'G', assignee: 'e5', due: '2026-06-13' } }),
    insp('c', '2026-09-20', { '2.1': { rating: 'G', done: { at: '2026-09-21', by: 'Büro' } } }, { status: 'offen' }),
  ]
  const open = openDefects(list)
  assert.deepEqual(open.map((d) => d.itemId).sort(), ['2.1', '7.3', '8.3'])
  assert.equal(open.find((d) => d.itemId === '8.3').note, 'Außenlicht defekt', 'N/A ändert nichts')
  assert.equal(open.find((d) => d.itemId === '7.3').since, '2026-03-10', 'offen seit der ersten Feststellung')
  assert.equal(open[0].itemId, '2.1', 'Gefahr zuerst')
  assert.equal(open[0].assignee, 'e5')
  // Kontrolle c abgeschlossen: Haken „erledigt“ schließt den Mangel
  list[2].status = 'abgeschlossen'
  assert.ok(!openDefects(list).some((d) => d.itemId === '2.1'))
  assert.equal(openDefects(list, { exclude: 'b' }).length, 3, 'ohne Kontrolle b gelten die Befunde von a')
})

test('Kontrolle: Fälligkeit nach Rhythmus, Nachkontrolle geht vor', () => {
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28')
  const list = [insp('a', '2026-07-01', {})]
  assert.deepEqual(['due', 'status'].map((k) => inspectionDue(list, 'o1', { months: 3 }, '2026-09-10')[k]), ['2026-10-01', 'ok'])
  assert.equal(inspectionDue(list, 'o1', { months: 3 }, '2026-09-20').status, 'faellig')
  assert.equal(inspectionDue(list, 'o1', { months: 3 }, '2026-10-05').status, 'ueberfaellig')
  const first = inspectionDue([], 'o1', { months: 3 }, '2026-09-10')
  assert.deepEqual([first.due, first.reason, first.status], ['2026-09-10', 'Erstaufnahme', 'faellig'])
  const follow = [insp('a', '2026-07-01', {}, { summary: { followUp: true, followUpDate: '2026-07-20' } })]
  const d = inspectionDue(follow, 'o1', { months: 3 }, '2026-07-10')
  assert.deepEqual([d.due, d.reason, d.status], ['2026-07-20', 'Nachkontrolle', 'faellig'])
})

test('Kontrolle: Nacharbeit als Einsatz für die Stammkraft', () => {
  const t = reworkTask({ inspectionId: 'b', itemId: '7.3', note: 'Müllraum' }, { text: 'Müllraum sauber', objectId: 'o1', assignee: 'e5', date: '2026-10-28', id: 't-x', minutes: 45 })
  assert.deepEqual([t.label, t.recurrence, t.start, t.end, t.regulars, t.category, t.defectRef], ['Nacharbeit: Müllraum sauber', { type: 'once', date: '2026-10-28' }, '08:00', '08:45', ['e5'], 'sonder', 'b|7.3'])
})

test('Kontrolle: Checkliste als Text bearbeiten', () => {
  const text = checklistToText(cl)
  assert.match(text, /^# Allgemeiner Objektzustand und Allgemeinflächen\nAllgemeiner Reinigungszustand/)
  assert.deepEqual(textToChapters(text), cl.chapters)
  assert.deepEqual(textToChapters('Punkt ohne Kapitel\n# 2 Lift\n- Kabine sauber\n\n# Leer'), [{ title: 'Allgemein', items: ['Punkt ohne Kapitel'] }, { title: 'Lift', items: ['Kabine sauber'] }])
})
