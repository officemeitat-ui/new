// Aufklappmenüs als HTML (shared.js): leere Einträge, Überschriften, einzelner Eintrag als Knopf,
// Daten-Attribute, Reiter-Gruppen mit Summe der Zähler.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { menu, rowMenu, tabBar } from '../src/ui/shared.js'

const count = (html, re) => (html.match(re) || []).length

test('menu: leer ergibt nichts', () => {
  assert.equal(menu({ label: 'Export', items: [false, null, '', { heading: 'X' }, '-'] }), '')
})

test('menu: ein Eintrag wird ein normaler Knopf (ohne Aufklappen)', () => {
  const html = menu({ label: 'Export', items: [{ heading: 'Export' }, { label: 'CSV', action: 'x-csv', data: { monthKey: '2026-11' } }] })
  assert.ok(!html.includes('<details'))
  assert.match(html, /<button class="btn[^"]*" data-action="x-csv" data-month-key="2026-11">CSV<\/button>/)
})

test('menu: Überschriften nur mit Einträgen darunter, keine doppelten Trennlinien', () => {
  const html = menu({
    label: 'Mehr',
    items: ['-', { heading: 'Leer' }, { heading: 'A' }, { label: 'Eins', action: 'a1' }, '-', '-', { label: 'Zwei', action: 'a2', hint: 'Hinweis', danger: true }, { heading: 'Ohne' }, '-'],
  })
  assert.ok(html.startsWith('<details class="menu-wrap dd'))
  assert.equal(count(html, /class="menu-head"/g), 1)
  assert.equal(count(html, /menu-sep/g), 1)
  assert.match(html, /role="menuitem" data-action="a2"/)
  assert.match(html, /class="btn ghost danger"/)
  assert.match(html, /<small>Hinweis<\/small>/)
  assert.match(html, /aria-haspopup="menu"/)
})

test('menu: Werte in data und title werden maskiert', () => {
  const html = menu({ label: 'x', title: 'a"b', single: false, items: [{ label: 'L', action: 'go', data: { v: '"><script>' } }] })
  assert.ok(!html.includes('"><script>'))
  assert.match(html, /data-v="&quot;&gt;&lt;script&gt;"/)
  assert.match(html, /title="a&quot;b"/)
})

test('rowMenu: Symbol ohne Pfeil, Titel als Beschriftung', () => {
  const html = rowMenu([{ label: 'PDF', action: 'p' }, { label: 'Mail', action: 'm' }], 'Aktionen für A')
  assert.match(html, /row-menu/)
  assert.match(html, /aria-label="Aktionen für A"/)
  assert.ok(!html.includes('class="caret"'))
})

test('tabBar: Gruppe zeigt gewählten Unterpunkt und Summe der Zähler', () => {
  const tabs = [{ id: 'start', label: 'Übersicht' }, { label: 'Zahlungen', items: [{ id: 'offen', label: 'Offene Posten', flag: 2 }, { id: 'bank', label: 'Bank', flag: 3 }] }]
  const html = tabBar({ action: 'fak-tab', current: 'bank', tabs })
  assert.match(html, /class="menu-wrap dd tab-group start active"/)
  assert.match(html, /<span class="tab-sub">: Bank<\/span>/)
  assert.match(html, /<span class="flag ">5<\/span>/)
  assert.match(html, /role="menuitemradio" aria-checked="true" data-action="fak-tab" data-v="bank"/)
  // mit Gruppen keine Reiter-Rollen (ein <details> darf nicht in einer tablist stehen), aktiver Knopf mit aria-current
  assert.match(html, /class="seg tabbar " role="group"/)
  assert.ok(!html.includes('role="tab"'))
  assert.match(tabBar({ action: 'fak-tab', current: 'start', tabs }), /data-action="fak-tab" data-v="start" aria-current="true"/)
  assert.match(tabBar({ action: 'x', current: 'a', tabs: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }), /role="tablist">.*data-v="a" role="tab" aria-selected="true"/)
  const other = tabBar({ action: 'fak-tab', current: 'start', tabs })
  assert.ok(!other.includes('tab-sub'))
  assert.match(other, /flag warning">5</)
})

test('menu: Exporte mit mail: true bekommen „Per E-Mail senden“ mit data-of', () => {
  const html = menu({
    label: 'Export',
    items: [
      { label: 'Lagerbestand (CSV)', action: 'mat-stock-csv', mail: true },
      { label: 'Angebot', action: 'calc-pdf', data: { kind: 'Angebot' }, mail: { hint: 'an die Kundschaft', subject: 'Angebot Lehen' } },
      { label: 'Gesperrt', action: 'x-csv', mail: true, disabled: true },
      { label: 'Ohne', action: 'y-csv' },
    ],
  })
  assert.match(html, /Per E-Mail senden/)
  assert.equal((html.match(/data-action="mail-export"/g) || []).length, 2, 'gesperrte und unmarkierte nicht')
  assert.match(html, /data-action="mail-export" data-of="mat-stock-csv"/)
  assert.match(html, /data-kind="Angebot" data-of="calc-pdf" data-subject="Angebot Lehen"/)
  assert.match(html, /an die Kundschaft/)
  // ein einzelner Export mit mail: true wird zum Menü (Download + E-Mail)
  const single = menu({ label: 'Export', items: [{ label: 'CSV', action: 'a-csv', mail: true }] })
  assert.match(single, /<details class="menu-wrap/)
})
