// Werkzeuge des KI-Assistenten: Nachschlagen (Plan, Personen, Objekte, Abwesenheiten, Zu erledigen, Kalender,
// Vertretungsvorschläge, Material, Schlüssel) und Handeln (Termin in Outlook, Abwesenheit, Vertretungen
// verteilen, Einteilen, Reklamation, Material anfordern, E-Mail). Handeln immer erst nach Bestätigung im Chat
// (registry.js, write: true) und nur mit den Rechten der angemeldeten Person.
// Rückgaben sind knapp gehalten (nur nötige Felder, keine Löhne, keine Diagnosen).

import { sendMail } from '../auth/graph-mail.js'
import { createEvent, listEvents } from '../auth/graph-calendar.js'
import { absenceImpact } from '../core/attention.js'
import { defaultDue, KINDS, SOURCES } from '../core/complaints.js'
import { addDays, formatDate, formatHours, mondayOf, todayISO } from '../core/dates.js'
import { isActive, keysOf, objectKeys } from '../core/keys.js'
import { stockRows } from '../core/material.js'
import { PlanState } from '../core/plan.js'
import { evaluateCandidate, explain, rankCandidates } from '../core/scheduler.js'
import { ACTIONS, addLog, app, canEdit, computeRange, empName, ensureRange, persist, recordUndo, renderNow } from '../ui/context.js'
import { saveAppointment } from '../ui/views/appointments.js'
import { AGENTS, proposals } from '../ui/views/disponent.js'
import { computeTodo } from '../ui/modals/todo.js'
import { uid } from '../ui/shared.js'
import { registerAgentTool } from './registry.js'

const ABSENCE_TYPES = ['Urlaub', 'Krankenstand', 'Zeitausgleich', 'Pflegefreistellung', 'Sonstiges']
const day = (d) => formatDate(d, { year: true })
const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const emailOk = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim())
const DATE = { type: 'string', format: 'date', description: 'Datum JJJJ-MM-TT' }

class ToolError extends Error {}

/** Treffer nach Name: genau einer, sonst Fehler mit Auswahl. */
function findOne(list, text, what, fields) {
  const q = norm(text)
  if (!q) throw new ToolError(`Bitte ${what} angeben.`)
  const exact = list.filter((x) => fields(x).some((f) => norm(f) === q))
  if (exact.length === 1) return exact[0]
  const words = q.split(/\s+/)
  const hits = list.filter((x) => words.every((w) => fields(x).some((f) => norm(f).includes(w))))
  if (hits.length === 1) return hits[0]
  if (!hits.length) throw new ToolError(`${what} „${text}“ nicht gefunden.`)
  throw new ToolError(`„${text}“ ist nicht eindeutig: ${hits.slice(0, 8).map((x) => fields(x)[0]).join(', ')}. Bitte genauer angeben.`)
}
const activeEmployees = () => app.data.employees.filter((e) => !e.exitDate || e.exitDate >= todayISO())
const findEmployee = (text) => findOne(activeEmployees(), text, 'Person', (e) => [e.name, e.personnelNo || '', e.email || ''])
const findObject = (text) => findOne(app.data.objects, text, 'Objekt', (o) => [o.name, o.short || '', o.address || ''])

function range(von, bis, max = 31) {
  if (bis < von) throw new ToolError('„bis“ liegt vor „von“.')
  if (addDays(von, max) < bis) throw new ToolError(`Höchstens ${max} Tage auf einmal.`)
}

async function plan(von, bis) {
  await ensureRange(von, bis)
  return computeRange(von, bis)
}

const shiftRow = (inst, state, ctx) => {
  const assigned = state.assigned(inst.key).map((a) => a.employeeId).filter((id) => ctx.employeesById.has(id))
  return {
    datum: inst.status === 'cancelled' ? inst.origDate : inst.date,
    zeit: `${inst.startTime}–${inst.endTime}`,
    objekt: ctx.objectsById.get(inst.objectId)?.name || '',
    leistung: inst.label || '',
    eingeteilt: assigned.map(empName),
    offen: inst.status === 'cancelled' ? 0 : Math.max(0, (inst.staff || 1) - assigned.length),
    ...(inst.status === 'cancelled' ? { entfaellt: inst.reason === 'holiday' ? 'Feiertag' : 'abgesagt' } : {}),
    ...(inst.status === 'moved' ? { verschoben_von: inst.origDate } : {}),
  }
}

async function graphToken(scope) {
  if (!app.auth?.tokenFor) throw new ToolError('Nur mit Microsoft-Anmeldung (Betrieb mit SharePoint) möglich.')
  try {
    return (await app.auth.tokenFor([scope])).accessToken
  } catch {
    throw new ToolError(`Das Recht „${scope}“ fehlt noch: In der App-Registrierung (Entra) unter API-Berechtigungen „${scope}“ (delegiert) hinzufügen, Administratorzustimmung erteilen, dann im Assistenten „Neu anmelden“.`)
  }
}

// ---------------------------------------------------------------- Nachschlagen

registerAgentTool({
  name: 'plan_abfragen',
  modules: ['planung'],
  description: 'Einsätze laut Dienstplan in einem Zeitraum (höchstens 31 Tage), optional nur für eine Person oder ein Objekt oder nur unbesetzte. Liefert je Einsatz Datum, Zeit, Objekt, Leistung, eingeteilte Personen, offene Plätze und ob er entfällt.',
  input_schema: { type: 'object', properties: { von: DATE, bis: DATE, person: { type: 'string', description: 'Name der Person (optional)' }, objekt: { type: 'string', description: 'Name des Objekts (optional)' }, nur_offen: { type: 'boolean', description: 'nur Einsätze mit offenen Plätzen' } }, required: ['von', 'bis'] },
  async run({ von, bis, person, objekt, nur_offen }) {
    range(von, bis)
    const emp = person ? findEmployee(person) : null
    const obj = objekt ? findObject(objekt) : null
    const r = await plan(von, bis)
    const rows = r.instances
      .filter((i) => (i.status === 'cancelled' ? i.origDate : i.date) >= von && (i.status === 'cancelled' ? i.origDate : i.date) <= bis)
      .filter((i) => (!obj || i.objectId === obj.id) && (!emp || r.state.has(emp.id, i.key)))
      .sort((a, b) => a.start - b.start)
      .map((i) => shiftRow(i, r.state, r.ctx))
      .filter((x) => !nur_offen || x.offen > 0)
    return { anzahl: rows.length, einsaetze: rows.slice(0, 150), ...(rows.length > 150 ? { hinweis: 'Nur die ersten 150; Zeitraum verkleinern.' } : {}) }
  },
})

registerAgentTool({
  name: 'personen_suchen',
  modules: ['planung', 'stammdaten', 'material', 'schluessel', 'unterweisungen'],
  description: 'Mitarbeitende suchen (Teil des Namens; leer = alle aktiven). Liefert Name, Team, Beschäftigung, Wochenstunden, E-Mail, Telefon, Qualifikationen und ob die Person heute abwesend ist.',
  input_schema: { type: 'object', properties: { suche: { type: 'string', description: 'Teil des Namens (optional)' } } },
  run({ suche }) {
    const q = norm(suche)
    const today = todayISO()
    const list = activeEmployees()
      .filter((e) => !q || q.split(/\s+/).every((w) => norm(e.name).includes(w)))
      .slice(0, 40)
      .map((e) => {
        const away = (app.data.absences || []).find((a) => a.employeeId === e.id && a.from <= today && a.to >= today)
        return { name: e.name, team: e.team || '', beschaeftigung: e.type || '', wochenstunden: e.weeklyHours ?? null, email: e.email || '', telefon: e.phone || '', qualifikationen: e.skills || [], ...(away ? { heute_abwesend: `${away.type} bis ${day(away.to)}` } : {}) }
      })
    return { anzahl: list.length, personen: list }
  },
})

registerAgentTool({
  name: 'objekte_suchen',
  modules: ['planung', 'stammdaten', 'reklamationen', 'schluessel', 'material'],
  description: 'Objekte (Kunden-Standorte) suchen nach Name oder Adresse (leer = alle). Liefert Name, Adresse, Revier, Ansprechperson, Anweisungen fürs Personal, wer welchen Schlüssel hat, offene Reklamationen.',
  input_schema: { type: 'object', properties: { suche: { type: 'string', description: 'Teil des Namens oder der Adresse (optional)' } } },
  run({ suche }) {
    const q = norm(suche)
    const book = app.data.schluessel?.keys || []
    const list = app.data.objects
      .filter((o) => !q || q.split(/\s+/).every((w) => norm(`${o.name} ${o.short || ''} ${o.address || ''}`).includes(w)))
      .slice(0, 40)
      .map((o) => {
        const keys = book.some((k) => k.objectId === o.id) ? objectKeys(book, o.id) : o.keys || []
        const complaints = (app.data.reklamationen?.items || []).filter((c) => c.objectId === o.id && c.status !== 'erledigt').length
        return { name: o.name, adresse: o.address || '', revier: o.region || '', ansprechperson: o.contact || '', anweisungen: String(o.instructions || '').slice(0, 300), schluessel: keys.map((k) => `${k.label}${k.no ? ` ${k.no}` : ''}: ${k.holderId ? empName(k.holderId) : 'Büro'}`), offene_reklamationen: complaints }
      })
    return { anzahl: list.length, objekte: list }
  },
})

registerAgentTool({
  name: 'abwesenheiten_abfragen',
  modules: ['planung'],
  when: () => !app.access || app.access.canEdit('planung') || app.access.sees('stammdaten'),
  description: 'Wer ist in einem Zeitraum abwesend (Urlaub, Krankenstand, Zeitausgleich …), optional für eine Person. Keine Diagnosen, nur Art und Zeitraum.',
  input_schema: { type: 'object', properties: { von: DATE, bis: DATE, person: { type: 'string' } }, required: ['von', 'bis'] },
  run({ von, bis, person }) {
    const emp = person ? findEmployee(person) : null
    const list = (app.data.absences || []).filter((a) => a.from <= bis && a.to >= von && (!emp || a.employeeId === emp.id)).sort((a, b) => a.from.localeCompare(b.from))
    return { anzahl: list.length, abwesenheiten: list.map((a) => ({ name: empName(a.employeeId), art: a.type, von: a.from, bis: a.to })) }
  },
})

registerAgentTool({
  name: 'digitale_mitarbeiter',
  modules: '*',
  description: 'Was die digitalen Mitarbeiter (Disponent, Buchhaltung, Lager, Fristen) vorbereitet haben: Vorschläge mit Begründung und ob sie mit einem Klick ausführbar sind. Ausführen tut die Person in der Ansicht „Digitale Mitarbeiter“ oder du mit den passenden Werkzeugen.',
  input_schema: { type: 'object', properties: {} },
  run() {
    const list = proposals()
    return {
      anzahl: list.length,
      vorschlaege: list.slice(0, 30).map((p) => ({ von: AGENTS.find((a) => a.id === p.agent)?.name, dringend: p.prio === 1, was: p.title, warum: p.text, details: p.lines?.slice(0, 6), mit_einem_klick: p.run?.label || null })),
    }
  },
})

registerAgentTool({
  name: 'zu_erledigen',
  modules: '*',
  description: 'Was gerade ansteht (wie „Zu erledigen“ in der App): Abwesenheiten mit offenen Einsätzen, periodische Leistungen, geänderte Wochen und Punkte der Module (Fahrzeuge, Reklamationen, Material, Schlüssel, Fristen …).',
  input_schema: { type: 'object', properties: {} },
  run() {
    const t = computeTodo()
    return {
      anzahl: t.count,
      abwesenheiten: t.absences.map((a) => `${empName(a.absence.employeeId)} (${a.absence.type} ${day(a.absence.from)}–${day(a.absence.to)}): ${a.count} Einsätze betroffen`),
      periodische_leistungen: t.periodic.slice(0, 20).map((d) => `${formatDate(d.inst.date)} ${app.data.objects.find((o) => o.id === d.inst.objectId)?.name || ''}: ${d.inst.label}${d.overdue ? ' (überfällig)' : ''}`),
      geaenderte_wochen: t.weeks.map((w) => `KW ab ${day(w.monday)}: ${w.changed.length} Personen mit geändertem Plan`),
      module: t.extra.map((x) => ({ bereich: x.source.title, punkte: x.items.length })),
    }
  },
})

registerAgentTool({
  name: 'kalender_lesen',
  modules: '*',
  when: () => !!app.auth,
  description: 'Termine im Outlook-Kalender der angemeldeten Person für einen Zeitraum (höchstens 31 Tage). Vor dem Anlegen eines Termins nützlich, um Überschneidungen zu sehen.',
  input_schema: { type: 'object', properties: { von: DATE, bis: DATE }, required: ['von', 'bis'] },
  async run({ von, bis }) {
    range(von, bis)
    const events = await listEvents(await graphToken('Calendars.ReadWrite'), { from: von, to: bis })
    return { anzahl: events.length, termine: events }
  },
})

registerAgentTool({
  name: 'vertretung_vorschlagen',
  modules: ['planung'],
  description: 'Wer kann einen Einsatz übernehmen? Für Objekt und Datum (bei mehreren Einsätzen am Tag mit Beginn) die besten erlaubten Kandidat:innen mit Gründen, geprüft nach Arbeitszeitgesetz, Verfügbarkeit, Einschulung, Abwesenheiten.',
  input_schema: { type: 'object', properties: { objekt: { type: 'string' }, datum: DATE, beginn: { type: 'string', pattern: '^\\d{2}:\\d{2}$', description: 'HH:MM, nur bei mehreren Einsätzen am Tag' } }, required: ['objekt', 'datum'] },
  async run({ objekt, datum, beginn }) {
    const obj = findObject(objekt)
    const r = await plan(datum, datum)
    const inst = pickInstance(r, obj, datum, beginn)
    const list = rankCandidates(r.ctx, r.state, inst)
      .filter((c) => c.allowed)
      .slice(0, 5)
      .map((c) => {
        const why = explain(c.factors)
        return { name: c.emp.name, dafuer: why.pro, dagegen: why.contra, hinweise: c.issues.filter((i) => i.severity === 'warning').map((i) => i.message).slice(0, 3) }
      })
    return { einsatz: shiftRow(inst, r.state, r.ctx), vorschlaege: list }
  },
})

function pickInstance(r, obj, datum, beginn) {
  const list = r.instances.filter((i) => i.objectId === obj.id && i.date === datum && i.status !== 'cancelled').sort((a, b) => a.start - b.start)
  if (!list.length) throw new ToolError(`Am ${day(datum)} hat ${obj.name} keinen Einsatz laut Plan.`)
  if (beginn) {
    const hit = list.find((i) => i.startTime === beginn)
    if (!hit) throw new ToolError(`Kein Einsatz um ${beginn}. Einsätze an dem Tag: ${list.map((i) => `${i.startTime}–${i.endTime} ${i.label}`).join('; ')}.`)
    return hit
  }
  if (list.length > 1) throw new ToolError(`${obj.name} hat am ${day(datum)} mehrere Einsätze: ${list.map((i) => `${i.startTime}–${i.endTime} ${i.label}`).join('; ')}. Bitte den Beginn angeben.`)
  return list[0]
}

registerAgentTool({
  name: 'material_bestand',
  modules: ['material'],
  description: 'Lagerbestand von Material (Reinigungsmittel, Papier, Müllsäcke …): Bestand, Einheit, Melde- und Sollbestand, Zustand (ok, nachbestellen, leer), bestellte Mengen.',
  input_schema: { type: 'object', properties: { suche: { type: 'string', description: 'Teil des Artikelnamens (optional)' } } },
  run({ suche }) {
    const rows = stockRows(app.data.material || { articles: [], moves: [], orders: [] }, { search: suche || '' }).slice(0, 40)
    return { artikel: rows.map((r) => ({ name: r.article.name, bestand: r.total, einheit: r.article.unit || '', meldebestand: r.article.min || 0, sollbestand: r.article.target || 0, zustand: r.status, bestellt: r.open })) }
  },
})

registerAgentTool({
  name: 'schluessel_abfragen',
  modules: ['schluessel'],
  description: 'Schlüsselbuch: welche Schlüssel ein Objekt hat und wer sie hat, oder welche Schlüssel eine Person hat.',
  input_schema: { type: 'object', properties: { objekt: { type: 'string' }, person: { type: 'string' } } },
  run({ objekt, person }) {
    const book = app.data.schluessel?.keys || []
    let keys = book.filter(isActive)
    if (objekt) {
      const obj = findObject(objekt)
      keys = objectKeys(book, obj.id)
    }
    if (person) keys = keysOf(keys, findEmployee(person).id)
    return { schluessel: keys.slice(0, 60).map((k) => ({ objekt: app.data.objects.find((o) => o.id === k.objectId)?.name || '', schluessel: `${k.label}${k.no ? ` Nr. ${k.no}` : ''}`, bei: k.holderId ? empName(k.holderId) : 'Büro', seit: k.since || '', rueckgabe_bis: k.due || '' })) }
  },
})

// ---------------------------------------------------------------- Handeln (nach Bestätigung)

/** Teilnehmende: E-Mail-Adressen direkt, Namen über die Mitarbeitenden. */
function attendees(list = []) {
  const found = []
  const unknown = []
  const employeeIds = []
  for (const t of list) {
    const s = String(t || '').trim()
    if (!s) continue
    if (emailOk(s)) found.push({ email: s.toLowerCase(), name: '' })
    else {
      try {
        const e = findEmployee(s)
        employeeIds.push(e.id)
        if (e.email) found.push({ email: e.email.toLowerCase(), name: e.name })
        else unknown.push(`${e.name} (keine E-Mail hinterlegt)`)
      } catch {
        unknown.push(s)
      }
    }
  }
  return { found, unknown, employeeIds }
}

function eventTimes({ beginn, ende, dauer_minuten }) {
  const start = beginn
  let end = ende
  if (!end) {
    const [d, t] = start.split('T')
    const [h, m] = t.split(':').map(Number)
    const total = h * 60 + m + (Number(dauer_minuten) > 0 ? Number(dauer_minuten) : 60)
    const endDay = addDays(d, Math.floor(total / 1440))
    end = `${endDay}T${String(Math.floor((total % 1440) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }
  if (end <= start) throw new ToolError('Das Ende liegt vor dem Beginn.')
  return { start, end }
}
const when = (start, end) => `${formatDate(start.slice(0, 10))} ${start.slice(11)}–${end.slice(0, 10) === start.slice(0, 10) ? end.slice(11) : `${formatDate(end.slice(0, 10))} ${end.slice(11)}`}`

registerAgentTool({
  name: 'termin_erstellen',
  modules: '*',
  write: true,
  when: () => !!app.auth,
  description: 'Termin im Outlook-Kalender der angemeldeten Person anlegen, mit Ort, Teilnehmenden (Namen von Mitarbeitenden oder E-Mail-Adressen bekommen eine Einladung) und optional als Teams-Besprechung. Ohne Ende: Dauer in Minuten, sonst 60 Minuten. Die App fragt vor dem Anlegen selbst nach.',
  input_schema: {
    type: 'object',
    properties: {
      titel: { type: 'string' },
      beginn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$', description: 'Ortszeit Wien, JJJJ-MM-TTTHH:MM' },
      ende: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
      dauer_minuten: { type: 'integer' },
      ort: { type: 'string' },
      teilnehmer: { type: 'array', items: { type: 'string' }, description: 'Namen von Mitarbeitenden oder E-Mail-Adressen' },
      notiz: { type: 'string' },
      teams: { type: 'boolean', description: 'als Teams-Besprechung' },
      art: { type: 'string', enum: ['kunde', 'begehung', 'kontrolle', 'schulung', 'werkstatt', 'bewerbung', 'intern', 'sonstiges'], description: 'Art des Termins' },
    },
    required: ['titel', 'beginn'],
  },
  summary(input) {
    const { start, end } = eventTimes(input)
    const a = attendees(input.teilnehmer)
    return { title: 'Termin anlegen', lines: [input.titel, when(start, end), input.ort ? `Ort: ${input.ort}` : '', a.found.length ? `Einladung an: ${a.found.map((x) => x.name || x.email).join(', ')}` : '', a.unknown.length ? `Ohne Einladung (im Text vermerkt): ${a.unknown.join(', ')}` : '', input.teams ? 'als Teams-Besprechung' : '', input.notiz || ''].filter(Boolean) }
  },
  async run(input) {
    const { start, end } = eventTimes(input)
    const a = attendees(input.teilnehmer)
    const body = [input.notiz || '', a.unknown.length ? `Mit: ${a.unknown.join(', ')}` : ''].filter(Boolean).join('\n')
    if (canEdit('termine')) {
      // über das Modul Termine: steht in der App (Kalender, Zeitlinie) und in Outlook mit Einladung
      const external = a.found.filter((x) => !a.employeeIds.some((id) => app.data.employees.find((e) => e.id === id)?.email?.toLowerCase() === x.email))
      const saved = await saveAppointment({ title: input.titel, kind: input.art || 'sonstiges', start, end, location: input.ort || '', note: body, attendees: external.map((x) => ({ email: x.email, name: x.name || x.email })), employeeIds: a.employeeIds, online: !!input.teams, reminder: 15, responseRequested: true }, { quiet: true })
      if (saved?.outlook?.error) throw new ToolError(`In der App gespeichert, aber nicht in Outlook: ${saved.outlook.error}`)
      return { angelegt: true, wann: when(start, end), eingeladen: a.found.map((x) => x.name || x.email), nicht_eingeladen: a.unknown, link: saved?.outlook?.webLink || undefined, teams: saved?.outlook?.onlineMeetingUrl || undefined, in_app: 'Termine' }
    }
    const res = await createEvent(await graphToken('Calendars.ReadWrite'), { subject: input.titel, start, end, location: input.ort || '', body, attendees: a.found, online: !!input.teams })
    return { angelegt: true, wann: when(start, end), eingeladen: a.found.map((x) => x.name || x.email), nicht_eingeladen: a.unknown, link: res.webLink, teams: res.onlineMeetingUrl || undefined }
  },
})

registerAgentTool({
  name: 'abwesenheit_eintragen',
  modules: ['planung'],
  write: true,
  description: 'Urlaub, Krankenstand, Zeitausgleich, Pflegefreistellung oder Sonstiges für eine Person eintragen. Liefert, wie viele Einsätze betroffen und noch offen sind (danach kann vertretungen_verteilen helfen). Keine Diagnosen in die Notiz. Die App fragt vor dem Eintragen selbst nach.',
  input_schema: { type: 'object', properties: { person: { type: 'string' }, art: { type: 'string', enum: ABSENCE_TYPES }, von: DATE, bis: DATE, notiz: { type: 'string' } }, required: ['person', 'art', 'von', 'bis'] },
  summary(input) {
    const e = findEmployee(input.person)
    range(input.von, input.bis, 366)
    const overlap = (app.data.absences || []).find((a) => a.employeeId === e.id && a.from <= input.bis && a.to >= input.von)
    return { title: `${input.art} eintragen`, lines: [e.name, `${day(input.von)} – ${day(input.bis)}`, input.notiz || '', overlap ? `Achtung: schon ${overlap.type} ${day(overlap.from)}–${day(overlap.to)} eingetragen` : ''].filter(Boolean) }
  },
  async run(input) {
    const e = findEmployee(input.person)
    const saved = { id: uid('a'), employeeId: e.id, type: input.art, from: input.von, to: input.bis, ...(input.notiz ? { note: input.notiz } : {}), by: 'KI-Assistent' }
    app.data.absences.push(saved)
    addLog(mondayOf(input.von), `Abwesenheit: ${e.name} ${formatDate(input.von)}–${formatDate(input.bis)} (über den KI-Assistenten)`)
    persist()
    const r = await plan(input.von, input.bis)
    const impact = absenceImpact(r.ctx, r.instances, r.state, saved)
    const open = impact.rows.filter((x) => !x.cancelled && (x.open > 0 || x.stillAssigned))
    renderNow()
    return { eingetragen: true, abwesenheit_id: saved.id, betroffene_einsaetze: impact.rows.filter((x) => !x.cancelled).length, noch_zu_besetzen: open.length, stunden: formatHours(impact.minutes), hinweis: open.length ? 'Mit vertretungen_verteilen können die Einsätze automatisch an passende Personen gehen.' : 'Alles besetzt.' }
  },
})

registerAgentTool({
  name: 'vertretungen_verteilen',
  modules: ['planung'],
  write: true,
  description: 'Die Einsätze einer eingetragenen Abwesenheit automatisch an passende Personen verteilen (wie „Automatisch verteilen“ im Abwesenheits-Assistenten: Arbeitszeitgesetz, Verfügbarkeit, Einschulung). Die App fragt vorher selbst nach.',
  input_schema: { type: 'object', properties: { abwesenheit_id: { type: 'string', description: 'aus abwesenheit_eintragen' } }, required: ['abwesenheit_id'] },
  summary({ abwesenheit_id }) {
    const a = (app.data.absences || []).find((x) => x.id === abwesenheit_id)
    if (!a) throw new ToolError('Abwesenheit nicht gefunden.')
    return { title: 'Vertretungen automatisch verteilen', lines: [`${empName(a.employeeId)}: ${a.type} ${day(a.from)}–${day(a.to)}`] }
  },
  async run({ abwesenheit_id }) {
    const a = (app.data.absences || []).find((x) => x.id === abwesenheit_id)
    if (!a) throw new ToolError('Abwesenheit nicht gefunden.')
    await ensureRange(a.from, a.to)
    ACTIONS['impact-auto']({ dataset: { id: a.id } })
    const r = await plan(a.from, a.to)
    const rows = absenceImpact(r.ctx, r.instances, r.state, a).rows.filter((x) => !x.cancelled)
    return { verteilt: true, besetzt: rows.filter((x) => x.open === 0).length, offen: rows.filter((x) => x.open > 0).map((x) => `${formatDate(x.inst.date)} ${x.inst.startTime} ${r.ctx.objectsById.get(x.inst.objectId)?.name || ''}`), vertretungen: rows.filter((x) => x.covering.length).map((x) => `${formatDate(x.inst.date)} ${x.inst.startTime}: ${x.covering.map(empName).join(', ')}`) }
  },
})

registerAgentTool({
  name: 'einteilen',
  modules: ['planung'],
  write: true,
  description: 'Eine Person für einen Einsatz einteilen oder austragen (Objekt, Datum, bei mehreren Einsätzen am Tag mit Beginn). Vorher wird nach Arbeitszeitgesetz, Verfügbarkeit und Einschulung geprüft; bei einem Verstoß wird nicht eingeteilt. Die App fragt vorher selbst nach.',
  input_schema: { type: 'object', properties: { person: { type: 'string' }, objekt: { type: 'string' }, datum: DATE, beginn: { type: 'string', pattern: '^\\d{2}:\\d{2}$' }, aktion: { type: 'string', enum: ['einteilen', 'austragen'] } }, required: ['person', 'objekt', 'datum'] },
  async summary(input) {
    const e = findEmployee(input.person)
    const obj = findObject(input.objekt)
    const r = await plan(input.datum, input.datum)
    const inst = pickInstance(r, obj, input.datum, input.beginn)
    const out = input.aktion === 'austragen'
    if (out && !r.state.has(e.id, inst.key)) throw new ToolError(`${e.name} ist dort nicht eingeteilt.`)
    if (!out && r.state.has(e.id, inst.key)) throw new ToolError(`${e.name} ist dort schon eingeteilt.`)
    const ev = out ? null : evaluateCandidate(r.ctx, r.state, e, inst)
    if (ev && !ev.allowed) throw new ToolError(`Nicht möglich: ${ev.blocking.map((i) => i.message).join('; ')}`)
    return { title: out ? 'Austragen' : 'Einteilen', lines: [e.name, `${obj.name}: ${formatDate(inst.date)} ${inst.startTime}–${inst.endTime} ${inst.label || ''}`, ...(ev?.issues.filter((i) => i.severity === 'warning').map((i) => `Hinweis: ${i.message}`) || [])] }
  },
  async run(input) {
    const e = findEmployee(input.person)
    const obj = findObject(input.objekt)
    const r = await plan(input.datum, input.datum)
    const inst = pickInstance(r, obj, input.datum, input.beginn)
    const out = input.aktion === 'austragen'
    const text = `${out ? 'Ausgetragen' : 'Eingeteilt'} (KI-Assistent): ${e.name} ${obj.short || obj.name} ${formatDate(inst.date)} ${inst.startTime}`
    recordUndo(text)
    const state = new PlanState(r.instances, app.data.assignments)
    if (out) state.unassign(e.id, inst.key)
    else state.assign(e.id, inst.key, true)
    app.data.assignments = state.toObject()
    addLog(mondayOf(inst.origDate), text)
    persist()
    renderNow()
    return { erledigt: true, einsatz: shiftRow(inst, state, r.ctx), hinweis: app.data.published?.[mondayOf(inst.date)] ? 'Die Woche ist veröffentlicht: Änderung im Plan noch veröffentlichen, damit die Person sie am Handy sieht.' : '' }
  },
})

registerAgentTool({
  name: 'reklamation_erfassen',
  modules: ['reklamationen'],
  write: true,
  description: `Reklamation eines Kunden zu einem Objekt erfassen (Frist wird nach der Art vorgeschlagen). Arten: ${KINDS.join(', ')}. Eingang: ${SOURCES.join(', ')}. Die App fragt vorher selbst nach.`,
  input_schema: { type: 'object', properties: { objekt: { type: 'string' }, art: { type: 'string', enum: KINDS }, beschreibung: { type: 'string' }, datum: { ...DATE, description: 'Tag des Mangels (Standard heute)' }, eingang: { type: 'string', enum: SOURCES }, ansprechperson: { type: 'string' } }, required: ['objekt', 'art', 'beschreibung'] },
  summary(input) {
    const obj = findObject(input.objekt)
    return { title: 'Reklamation erfassen', lines: [obj.name, `${input.art}: ${input.beschreibung}`, `Frist: ${day(defaultDue(input.art, todayISO()))}`, input.ansprechperson ? `Ansprechperson: ${input.ansprechperson}` : ''].filter(Boolean) }
  },
  run(input) {
    const obj = findObject(input.objekt)
    const now = new Date().toISOString()
    const by = app.user?.name || 'Browser'
    const item = { id: uid('r'), objectId: obj.id, date: input.datum || todayISO(), received: now, source: input.eingang || SOURCES[0], kind: input.art, text: input.beschreibung, contact: input.ansprechperson || '', employees: [], measure: '', due: defaultDue(input.art, todayISO()), status: 'offen', result: '', informed: false, by, history: [{ at: now, by, text: `erfasst über den KI-Assistenten (${input.art})` }] }
    app.data.reklamationen ||= { items: [] }
    app.data.reklamationen.items = [...(app.data.reklamationen.items || []), item]
    persist()
    renderNow()
    return { erfasst: true, objekt: obj.name, frist: item.due }
  },
})

registerAgentTool({
  name: 'material_anfordern',
  modules: ['material'],
  write: true,
  description: 'Material für ein Objekt anfordern (landet unter Material & Lager → Anforderungen). Die App fragt vorher selbst nach.',
  input_schema: { type: 'object', properties: { objekt: { type: 'string' }, was: { type: 'string', description: 'was gebraucht wird, z. B. „5 Rollen Müllsäcke 120 l“' }, notiz: { type: 'string' } }, required: ['objekt', 'was'] },
  summary(input) {
    return { title: 'Material anfordern', lines: [findObject(input.objekt).name, input.was, input.notiz || ''].filter(Boolean) }
  },
  run(input) {
    const obj = findObject(input.objekt)
    app.data.material ||= { articles: [], locations: [], suppliers: [], moves: [], orders: [], requests: [], settings: {} }
    app.data.material.requests ||= []
    const by = app.user?.name || 'Browser'
    app.data.material.requests.push({ id: uid('m'), at: new Date().toISOString(), source: 'app', by, employeeId: '', name: by, objectId: obj.id, lines: [{ articleId: '', qty: 0, text: input.was }], note: input.notiz || '', status: 'offen', answer: '' })
    persist()
    renderNow()
    return { angefordert: true, objekt: obj.name }
  },
})

registerAgentTool({
  name: 'email_senden',
  modules: '*',
  write: true,
  when: () => !!app.auth,
  description: 'E-Mail aus dem Postfach der angemeldeten Person senden. Empfänger: E-Mail-Adresse oder Name einer Mitarbeiterin bzw. eines Mitarbeiters mit hinterlegter Adresse. Die App zeigt die E-Mail vor dem Senden zur Bestätigung.',
  input_schema: { type: 'object', properties: { an: { type: 'string' }, betreff: { type: 'string' }, text: { type: 'string' } }, required: ['an', 'betreff', 'text'] },
  summary(input) {
    const to = recipient(input.an)
    return { title: 'E-Mail senden', lines: [`An: ${to.label}`, `Betreff: ${input.betreff}`, input.text] }
  },
  async run(input) {
    const to = recipient(input.an)
    const token = await graphToken('Mail.Send')
    await sendMail(async () => token, { to: to.email, subject: input.betreff, text: input.text })
    return { gesendet: true, an: to.label }
  },
})

function recipient(text) {
  if (emailOk(text)) return { email: text.trim(), label: text.trim() }
  const e = findEmployee(text)
  if (!e.email) throw new ToolError(`Für ${e.name} ist keine E-Mail-Adresse hinterlegt.`)
  return { email: e.email, label: `${e.name} <${e.email}>` }
}

export { findObject, findOne, ToolError }
