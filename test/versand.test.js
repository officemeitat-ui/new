import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

import { blobToBase64, sendMail } from '../src/auth/graph-mail.js'
import { holidayCalendar } from '../src/core/holidays.js'
import { buildInstances, PlanState } from '../src/core/plan.js'
import { createContext } from '../src/core/rules.js'
import { candidateFactors, evaluateCandidate, explain, rankCandidates } from '../src/core/scheduler.js'
import { buildTimesheet } from '../src/core/timesheet.js'
import { pdfFileName, timesheetDocument } from '../src/export/pdf.js'

const require = createRequire(import.meta.url)
const allDays = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { from: '00:00', to: '24:00' }]))
const emp = (id, extra = {}) => ({ id, name: id, type: 'Teilzeit', weeklyHours: 20, skills: [], trained: [], availability: allDays, ...extra })
const task = (id, objectId, weekdays, start, end, extra = {}) => ({ id, objectId, label: id, recurrence: { type: 'weekly', weekdays }, start, end, staff: 1, regulars: [], skills: [], holidayRule: 'entfaellt', ...extra })

function setup({ employees, objects, tasks, assignments = {}, published = {} }) {
  const data = { employees, objects, tasks, absences: [], rules: {}, travel: {}, trips: {}, overrides: {}, published }
  const holidays = holidayCalendar('2026-10-01', '2026-11-30')
  const ctx = createContext(data, holidays)
  const instances = buildInstances(data, '2026-10-01', '2026-11-30', holidays, ctx.rules)
  return { ctx, instances, state: new PlanState(instances, assignments) }
}

const objects = [
  { id: 'o1', name: 'Kanzlei Muster', address: '5020 Salzburg', region: 'Stadt', instructions: 'Schlüssel beim Portier' },
  { id: 'o2', name: 'Büro Probe', address: '5071 Wals', region: 'Stadt' },
]

test('PDF: eine Seite je Person, Feiertag durchgestrichen, Hinweise nur für Objekte mit Anweisungen', () => {
  const tasks = [task('a', 'o1', [1, 3], '17:30', '19:30', { regulars: ['jović'] }), task('b', 'o2', [2], '08:00', '12:00', { regulars: ['jović'] })]
  const asg = { '2026-10-28|a': [{ employeeId: 'jović' }], '2026-10-27|b': [{ employeeId: 'jović' }], '2026-10-27|x': [] }
  const { ctx, instances, state } = setup({ employees: [emp('jović', { name: 'Dragan Jović', personnelNo: '1004' }), emp('kovač', { name: 'Ivana Kovač' })], objects, tasks, assignments: asg })
  const entries = ctx.employees.map((e) => ({ ts: buildTimesheet(ctx, e, '2026-10-26', instances, state), account: -90 }))
  const doc = timesheetDocument(entries, { objects, employees: ctx.employees, brand: { name: 'Cleanos', product: 'Dienstplan' }, status: 'veröffentlicht am 24.10.2026' })
  const json = JSON.stringify(doc.content)
  assert.equal(doc.content.filter((b) => b.pageBreak === 'before').length, 1)
  assert.match(json, /Dragan Jović/)
  assert.match(json, /Personalnr\. 1004/)
  assert.match(json, /Feiertag: Nationalfeiertag/)
  assert.match(json, /lineThrough/) // Mo 26.10. entfällt
  assert.match(json, /Zeitkonto nach dieser Woche: −1,5 h/)
  assert.match(json, /Hinweise zu den Objekten/)
  assert.match(json, /Schlüssel beim Portier/)
  assert.doesNotMatch(json, /Büro Probe: /) // ohne Anweisungen kein Hinweis
  assert.equal(doc.footer(1, 2).columns[1].text, 'Seite 1 von 2')
  // ohne Sonderzeichen: Browser verwerfen sonst den Dateinamen
  assert.equal(pdfFileName('2026-10-26', 'Dragan Jović / Test'), 'Wochenplan_KW44_2026_Dragan_Jovic_Test.pdf')
})

test('PDF in der Sprache der Person: Überschriften, Wochentage, Summen, Hinweise; Namen bleiben; Deutsch Standard', () => {
  const tasks = [task('a', 'o1', [1, 3], '17:30', '19:30', { regulars: ['jović'] }), task('b', 'o2', [2], '08:00', '12:00', { regulars: ['jović'] })]
  const asg = { '2026-10-28|a': [{ employeeId: 'kaya' }], '2026-10-27|b': [{ employeeId: 'jović' }] }
  const { ctx, instances, state } = setup({ employees: [emp('jović', { name: 'Dragan Jović' }), emp('kaya', { name: 'Elif Kaya', lang: 'tr', personnelNo: '1007' })], objects, tasks, assignments: asg })
  const ts = (id) => buildTimesheet(ctx, ctx.employees.find((e) => e.id === id), '2026-10-26', instances, state)
  const trDoc = timesheetDocument([{ ts: ts('kaya'), account: 90 }], { objects, employees: ctx.employees, brand: { name: 'Cleanos' }, status: { kind: 'veroeffentlicht', date: '2026-10-24' } })
  const tr = JSON.stringify(trDoc.content)
  for (const word of ['Saat', 'İş yeri / iş', 'Pazartesi 26.10', 'Çarşamba 28.10', 'Toplam', 'Bakiye', 'Personel no. 1007', 'Yarı zamanlı', 'yayınlandı: 24.10.2026', 'Bu haftadan sonra saat hesabı: +1,5 sa', 'Yerine çalışılan: Dragan Jović', 'İş yeri bilgileri', 'üstü çizili']) assert.ok(tr.includes(word), word)
  assert.match(tr, /Kanzlei Muster/, 'Objektname bleibt')
  assert.match(tr, /Schlüssel beim Portier/, 'Anweisung ohne Übersetzung: deutsch')
  assert.doesNotMatch(tr, /Montag|Gesamt|Zeitkonto|Hinweise zu den Objekten/)
  assert.equal(trDoc.footer(1, 1).columns[1].text, 'Sayfa 1 / 1')
  assert.equal(trDoc.info.title, 'Haftalık plan 44. hafta – Elif Kaya')
  // mehrere Personen: jede Seite in ihrer Sprache, Fußzeile deutsch
  const both = timesheetDocument([{ ts: ts('jović') }, { ts: ts('kaya') }], { objects, employees: ctx.employees, brand: { name: 'Cleanos' }, status: { kind: 'entwurf' } })
  const json = JSON.stringify(both.content)
  assert.match(json, /Montag 26\.10\./)
  assert.match(json, /Pazartesi 26\.10/)
  assert.match(json, /"Entwurf"|   Entwurf/)
  assert.match(json, /Taslak/)
  assert.equal(both.footer(1, 2).columns[1].text, 'Seite 1 von 2')
  assert.match(json, /Gesamt/)
})

test('PDF: pdfmake erzeugt ein gültiges PDF (Schrift mit č, ć, ş)', async () => {
  const pdfMake = require('pdfmake/build/pdfmake.js')
  pdfMake.addVirtualFileSystem(require('pdfmake/build/vfs_fonts.js'))
  const { ctx, instances, state } = setup({ employees: [emp('k', { name: 'Ivana Kovač Çelik' })], objects, tasks: [task('a', 'o1', [2], '08:00', '12:00', { regulars: ['k'] })], assignments: { '2026-10-27|a': [{ employeeId: 'k' }] } })
  const doc = timesheetDocument([{ ts: buildTimesheet(ctx, ctx.employees[0], '2026-10-26', instances, state) }], { objects, employees: ctx.employees, brand: { name: 'Cleanos' } })
  const buffer = await new Promise((resolve) => pdfMake.createPdf(doc).getBuffer(resolve))
  assert.equal(Buffer.from(buffer.slice(0, 5)).toString(), '%PDF-')
  assert.ok(buffer.length > 10000)
})

test('E-Mail: Graph sendMail mit PDF-Anhang, gemeinsames Postfach, verständlicher Fehler', async () => {
  const calls = []
  const fakeFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), auth: opts.headers.Authorization })
    return calls.length === 3 ? { ok: false, status: 403, json: async () => ({ error: { message: 'Access denied' } }) } : { ok: true, status: 202 }
  }
  const blob = new Blob([new Uint8Array([37, 80, 68, 70, 45, 252])], { type: 'application/pdf' })
  const mail = { to: 'petra@example.at', subject: 'Dienstplan KW 44', text: 'Hallo', attachments: [{ name: 'plan.pdf', blob }] }
  await sendMail(async () => 'T', mail, { fetchImpl: fakeFetch })
  assert.equal(calls[0].url, 'https://graph.microsoft.com/v1.0/me/sendMail')
  assert.equal(calls[0].auth, 'Bearer T')
  assert.equal(calls[0].body.message.toRecipients[0].emailAddress.address, 'petra@example.at')
  assert.equal(calls[0].body.message.attachments[0].contentBytes, await blobToBase64(blob))
  assert.equal(Buffer.from(calls[0].body.message.attachments[0].contentBytes, 'base64')[5], 252)
  assert.equal(calls[0].body.saveToSentItems, true)
  await sendMail(async () => 'T', mail, { from: 'dienstplan@example.at', fetchImpl: fakeFetch })
  assert.equal(calls[1].url, 'https://graph.microsoft.com/v1.0/users/dienstplan%40example.at/sendMail')
  await assert.rejects(sendMail(async () => 'T', mail, { from: 'x@example.at', fetchImpl: fakeFetch }), /Mail\.Send\.Shared/)
})

test('Vorschläge: wer das Objekt kennt und Minusstunden hat, kommt zuerst, mit Begründung', () => {
  const tasks = [task('neu', 'o1', [4], '08:00', '10:00'), task('alt', 'o1', [4], '14:00', '16:00')]
  const employees = [emp('fremd', { team: 'Stadt' }), emp('kennt', { team: 'Stadt' }), emp('minus', { team: 'Stadt', startBalanceHours: -10 })]
  // "kennt" war in den zwei Wochen davor im Objekt
  const asg = { '2026-10-15|alt': [{ employeeId: 'kennt' }], '2026-10-22|alt': [{ employeeId: 'kennt' }] }
  const { ctx, state } = setup({ employees, objects, tasks, assignments: asg })
  const inst = state.instByKey.get('2026-10-29|neu')
  const ranking = rankCandidates(ctx, state, inst)
  const pos = (id) => ranking.findIndex((r) => r.emp.id === id)
  assert.ok(pos('kennt') < pos('fremd'))
  assert.ok(pos('minus') < pos('fremd'))
  const factors = candidateFactors(ctx, state, ctx.employeesById.get('kennt'), inst, evaluateCandidate(ctx, state, ctx.employeesById.get('kennt'), inst))
  const why = explain(factors)
  assert.ok(why.pro.some((t) => t.startsWith('kennt das Objekt (2×')))
  assert.ok(why.pro.some((t) => t === 'gleiches Revier'))
  const minus = explain(ranking.find((r) => r.emp.id === 'minus').factors)
  assert.ok(minus.pro.some((t) => /Zeitkonto −10 h/.test(t)))
})

test('Hosting: jede Seite nur nach Anmeldung, Sicherheitsheader gesetzt', () => {
  const swa = JSON.parse(readFileSync(new URL('../staticwebapp.config.json', import.meta.url), 'utf8'))
  const open = swa.routes.filter((r) => !r.allowedRoles && !r.route.startsWith('/.auth') && r.route !== '/logout')
  assert.deepEqual(open, [])
  assert.ok(swa.routes.some((r) => r.route === '/*' && r.allowedRoles.includes('authenticated')))
  assert.match(swa.responseOverrides['401'].redirect, /^\/\.auth\/login\/aad/)
  assert.match(swa.auth.identityProviders.azureActiveDirectory.registration.openIdIssuer, /__TENANT_ID__\/v2\.0$/)
  assert.match(swa.globalHeaders['Content-Security-Policy'], /script-src 'self';/)
  assert.ok(swa.navigationFallback.exclude.includes('/app/*'))
})
