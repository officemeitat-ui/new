import { test } from 'node:test'
import assert from 'node:assert/strict'

import { sendMail } from '../src/auth/graph-mail.js'
import { fileSafe } from '../src/core/filename.js'
import { mailtoUrl, parseRecipients, payoutEntries, payoutListText, payoutPersonFile, payoutPersonText, payoutSig } from '../src/core/payout.js'
import { payoutListDocument, payoutStatementDocument } from '../src/export/payout-pdf.js'

const emp = (id, name, extra = {}) => ({ id, name, type: 'Teilzeit', weeklyHours: 30, personnelNo: id.replace('e', '10'), ...extra })
const row = (e, { amount = 0, accountDelta = 0, zaBonus = 0, lines = [], ue = 0, mehr = 0, open = [] } = {}) => ({
  employee: e,
  wage: 12.37,
  amount,
  taxFree: 0,
  accountDelta,
  zaBonus,
  ueMode: zaBonus ? 'za' : 'auszahlen',
  mehrMode: 'zeitkonto',
  lines,
  total: { normal: 0, mehr, ue, ue11: 0 },
  mehr: { open, openMin: open.reduce((s, x) => s + x.min, 0) },
})
const ana = emp('e1', 'Ana Popescu')
const ben = emp('e2', 'Ben Huber')
const cem = emp('e3', 'Cem Yılmaz')
const rows = [
  row(ana, { amount: 64.94, accountDelta: -210, ue: 210, lines: [{ key: 'ue-tag', label: 'Überstunden (+50 %)', min: 210, pct: 50, base: true, amount: 64.94 }] }),
  row(ben, { zaBonus: 60, accountDelta: 60, ue: 120 }),
  row(cem, { mehr: 120, open: [{ date: '2026-10-14', min: 120, deadline: '2027-01-14' }] }),
]

test('Auszahlungen: wer bekommt wie viel, nach dem Abschluss gelten die festgehaltenen Beträge', () => {
  const live = payoutEntries(rows)
  assert.deepEqual(live.map((e) => [e.employee.name, e.amount, e.accountDelta]), [['Ana Popescu', 64.94, -210], ['Ben Huber', 0, 60]])
  const closure = { closedAt: '2026-11-02', rows: { e1: { wage: 12.37, amount: 70, taxFree: 0, accountDelta: -210, zaBonus: 0, ueMode: 'auszahlen', lines: [{ key: 'ue-tag', label: 'Überstunden (+50 %)', min: 210, pct: 50, base: true, amount: 70 }] } } }
  const fixed = payoutEntries(rows, closure)
  assert.deepEqual(fixed.map((e) => [e.employee.name, e.amount, e.fixed]), [['Ana Popescu', 70, true]])
  assert.notEqual(payoutSig(live), payoutSig(fixed), 'geänderter Betrag ändert die Kennung')
})

test('Auszahlungen: Text an die Lohnverrechnung und an die Person', () => {
  const entries = payoutEntries(rows)
  const text = payoutListText(entries, { month: '2026-10', status: 'abgeschlossen am 2.11.2026', sender: 'Planung', brand: 'Cleanos' })
  assert.match(text, /Auszahlungen für Überstunden und Mehrarbeit im Oktober 2026 \(abgeschlossen am 2\.11\.2026\)/)
  assert.match(text, /101 Ana Popescu: 64,94 € {2}\(3,5 h Überstunden \(\+50 %\)\)/)
  assert.match(text, /Summe: 64,94 € brutto für 1 Person\./)
  assert.match(text, /Nur Zeitausgleich \(keine Auszahlung\):\n102 Ben Huber: Zeitkonto \+1 h/)
  assert.ok(text.endsWith('Liebe Grüße\nPlanung\nCleanos'))
  const person = payoutPersonText(entries[0], { month: '2026-10', sender: 'Planung' })
  assert.match(person, /^Hallo Ana,\n\nmit der Abrechnung für Oktober 2026 bekommst du für Überstunden und Mehrarbeit 64,94 € brutto ausbezahlt:\n- 3,5 h Überstunden \(\+50 %\): 64,94 €/)
  assert.match(person, /Zeitkonto ändert sich dadurch um −3,5 h \(ausbezahlte Stunden\)/)
  const za = payoutPersonText(entries[1], { month: '2026-10' })
  assert.match(za, /Als Zeitausgleich \(Zeitausgleich 1:1,5\) bekommst du 1 h Zuschlag ins Zeitkonto\./)
})

test('Auszahlungen: Empfänger, mailto-Link und Dateinamen', () => {
  assert.deepEqual(parseRecipients('lohn@kanzlei.at; chef@firma.at,  falsch, x@y.at'), ['lohn@kanzlei.at', 'chef@firma.at', 'x@y.at'])
  const url = mailtoUrl('lohn@kanzlei.at; chef@firma.at', 'Auszahlungen Oktober', 'Zeile 1\nAna: 64,94 €')
  assert.ok(url.startsWith('mailto:lohn@kanzlei.at,chef@firma.at?'))
  const q = new URLSearchParams(url.split('?')[1])
  assert.equal(q.get('subject'), 'Auszahlungen Oktober')
  assert.equal(q.get('body'), 'Zeile 1\nAna: 64,94 €')
  assert.ok(!url.includes('+'), 'Leerzeichen als %20, nicht als +')
  assert.equal(payoutPersonFile('2026-10', 'Ivana Kovač'), 'Auszahlung_2026-10_Ivana_Kovac.pdf')
  assert.equal(fileSafe('Gül Öztürk'), 'Guel_Oeztuerk')
})

test('Auszahlungen: PDF-Übersicht mit Summe und Einzelaufstellung, je Person eine Seite', () => {
  const entries = payoutEntries(rows)
  const doc = payoutListDocument(entries, { month: '2026-10', status: 'abgeschlossen', brand: { name: 'Cleanos', product: 'Dienstplan', colors: { primary: '#0f70b7' } } })
  const table = doc.content.find((c) => c.table).table
  assert.equal(table.body.length, 1 + entries.length + 1)
  assert.equal(table.body.at(-1).at(-1).text, '64,94 €')
  assert.ok(JSON.stringify(doc.content).includes('Einzelaufstellung'))
  const statement = payoutStatementDocument(entries, { month: '2026-10', brand: { name: 'Cleanos' } })
  assert.equal(statement.content.filter((c) => c.pageBreak === 'before').length, entries.length - 1)
  assert.equal(statement.info.title, 'Auszahlungen Oktober 2026')
})

test('E-Mail: mehrere Empfänger und Kopie über Microsoft Graph', async () => {
  let body = null
  const fetchImpl = async (url, opts) => {
    body = JSON.parse(opts.body)
    return { ok: true, status: 202 }
  }
  await sendMail(async () => 'T', { to: 'lohn@kanzlei.at, chef@firma.at', cc: ['buchhaltung@firma.at'], subject: 'S', text: 'x', attachments: [{ name: 'a.csv', blob: new Blob(['a;b']), type: 'text/csv' }] }, { fetchImpl })
  assert.deepEqual(body.message.toRecipients.map((r) => r.emailAddress.address), ['lohn@kanzlei.at', 'chef@firma.at'])
  assert.deepEqual(body.message.ccRecipients.map((r) => r.emailAddress.address), ['buchhaltung@firma.at'])
  assert.equal(body.message.attachments[0].contentType, 'text/csv')
})
