// Werkzeuge des KI-Assistenten für die Module Fakturierung, Einkauf, Anlagen & Prüffristen, Qualitätsmessung und
// Regieberichte. Geladen mit dem Assistenten (agent.js), nicht beim Start. Rechte wie überall: Lesen nur mit
// sichtbarem Bereich, Ändern nur mit Schreibrecht (registry.js, modules/write/when); Ändern erst nach „Ausführen“.
//
// Ändern heißt hier: dieselbe Funktion wie der Knopf im Modul (Rechnungsentwurf aus dem Regiebericht über die
// Aktion „reg-invoice“, Erinnerungs-Dialog „fak-remind-open“, Termin über das Modul Termine). Nichts wird hier
// nachgebaut, und nichts wird verschickt: Die Zahlungserinnerung öffnet nur den Dialog, gesendet wird dort.
// Rückgaben sind knapp (nur nötige Felder; keine Bankdaten, keine Namen von Mitarbeitenden).

import { anlagenRows, RESULTS, STATES as ANL_STATES } from '../core/anlagen.js'
import { addDays, formatDate, todayISO } from '../core/dates.js'
import { customerForObject, customerName, isInvoice, openItems, reminderFor, round2, settingsOf, totals } from '../core/invoicing.js'
import { payables, PAY_STATE, purchaseState, supplierName } from '../core/purchase.js'
import { objectStatus, measurementsOf, resultOf, settingsOf as qmSettings } from '../core/qualitaet.js'
import { BILL_STATES, regieState, regieStates, regieTotals, REGIE_KINDS } from '../core/regie.js'
import { app, ensureAction } from '../ui/context.js'
import { saveAppointment } from '../ui/views/appointments.js'
import { registerAgentTool } from './registry.js'
import { findObject, findOne, ToolError } from './tools.js'

const DATE = { type: 'string', format: 'date', description: 'Datum JJJJ-MM-TT' }
const day = (d) => (d ? formatDate(d, { year: true }) : '')
const eur = (n) => Math.round(Number(n || 0) * 100) / 100
const sees = (m) => !app.access || app.access.sees(m)
const fak = () => app.data.fakturierung || { documents: [], customers: [], settings: {} }
const objName = (id) => (app.data.objects || []).find((o) => o.id === id)?.name || ''
const isWeekend = (d) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())
/** Nächster Werktag (Mo–Fr) ab einem Tag. */
const workday = (d) => {
  while (isWeekend(d)) d = addDays(d, 1)
  return d
}
/** Frist am Wochenende: lieber der Freitag davor, aber nicht vor earliest. */
const workdayBefore = (d, earliest) => {
  while (isWeekend(d) && d > earliest) d = addDays(d, -1)
  return workday(d)
}

function findCustomer(text) {
  return findOne(fak().customers || [], text, 'Kunde', (c) => [customerName(c), c.customerNo || '', c.email || ''])
}

/** Rechnung über die Nummer (RE-2026-0012; auch „2026-12“ oder nur „12“, wenn eindeutig). Nur festgeschriebene. */
function findInvoice(text) {
  const q = String(text || '').trim().toUpperCase()
  if (!q) throw new ToolError('Bitte die Rechnungsnummer angeben.')
  const docs = fak().documents.filter((d) => d.kind === 'rechnung' && d.number)
  const exact = docs.filter((d) => d.number.toUpperCase() === q)
  if (exact.length === 1) return exact[0]
  const groups = (s) => (s.match(/\d+/g) || []).map(Number)
  const want = groups(q)
  const hits = want.length ? docs.filter((d) => groups(d.number).slice(-want.length).join() === want.join()) : []
  if (hits.length === 1) return hits[0]
  if (!hits.length) throw new ToolError(`Rechnung „${text}“ nicht gefunden (nur festgeschriebene Rechnungen).`)
  throw new ToolError(`„${text}“ ist nicht eindeutig: ${hits.slice(0, 6).map((d) => d.number).join(', ')}.`)
}

const openRow = (x) => ({ rechnung: x.doc.number, kunde: x.doc.recipient?.name || '', datum: x.doc.date, faellig: x.doc.dueDate || '', offen: eur(x.open), ueberfaellig_tage: x.overdueDays, mahnstufe: x.level, naechste_stufe_faellig: x.next ? x.next.step.name : null, ...(x.skonto ? { skonto_bis: x.skonto.until } : {}) })

// ---------------------------------------------------------------- Fakturierung (lesen)

registerAgentTool({
  name: 'offene_posten',
  label: 'Offene Posten nachgeschlagen',
  modules: ['fakturierung'],
  description: 'Offene Rechnungen (offene Posten) aller Kunden oder eines Kunden, optional nur überfällige: Rechnungsnummer, Kunde, Datum, Fälligkeit, offener Betrag in Euro, Tage überfällig, Mahnstufe und ob die nächste Stufe fällig ist. Dazu die Summe.',
  input_schema: { type: 'object', properties: { kunde: { type: 'string', description: 'Name oder Kundennummer (optional)' }, nur_ueberfaellig: { type: 'boolean' } } },
  run({ kunde, nur_ueberfaellig }) {
    const d = fak()
    const today = todayISO()
    const cu = kunde ? findCustomer(kunde) : null
    const rows = openItems(d.documents, today, d.settings).filter((x) => (!cu || x.doc.customerId === cu.id) && (!nur_ueberfaellig || x.overdueDays > 0))
    return { ...(cu ? { kunde: customerName(cu) } : {}), anzahl: rows.length, summe_offen: eur(rows.reduce((s, x) => s + x.open, 0)), ueberfaellig: rows.filter((x) => x.overdueDays > 0).length, rechnungen: rows.slice(0, 60).map(openRow), ...(rows.length > 60 ? { hinweis: 'Nur die ersten 60.' } : {}) }
  },
})

registerAgentTool({
  name: 'umsatz_abfragen',
  label: 'Umsatz nachgeschlagen',
  modules: ['fakturierung'],
  description: 'Umsatz aus festgeschriebenen Rechnungen (samt Storno und Korrekturen) in einem Zeitraum nach Rechnungsdatum, höchstens ein Jahr, optional für einen Kunden: netto, brutto, Anzahl, je Monat und die größten Kunden. Beträge in Euro.',
  input_schema: { type: 'object', properties: { von: DATE, bis: DATE, kunde: { type: 'string' } }, required: ['von', 'bis'] },
  run({ von, bis, kunde }) {
    if (bis < von) throw new ToolError('„bis“ liegt vor „von“.')
    if (addDays(von, 366) < bis) throw new ToolError('Höchstens ein Jahr auf einmal.')
    const d = fak()
    const s = settingsOf(d)
    const cu = kunde ? findCustomer(kunde) : null
    const months = new Map()
    const customers = new Map()
    let net = 0
    let gross = 0
    let count = 0
    for (const x of d.documents) {
      if (!isInvoice(x) || !x.number || x.date < von || x.date > bis || (cu && x.customerId !== cu.id)) continue
      const t = x.total || totals(x, s)
      net += t.net
      gross += t.gross
      if (x.kind === 'rechnung') count++
      const m = x.date.slice(0, 7)
      months.set(m, round2((months.get(m) || 0) + t.net))
      const key = x.recipient?.name || '–'
      customers.set(key, round2((customers.get(key) || 0) + t.net))
    }
    return {
      von,
      bis,
      ...(cu ? { kunde: customerName(cu) } : {}),
      netto: eur(net),
      brutto: eur(gross),
      rechnungen: count,
      je_monat: [...months].sort().map(([monat, netto]) => ({ monat, netto })),
      ...(cu ? {} : { groesste_kunden: [...customers].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, netto]) => ({ name, netto })) }),
    }
  },
})

// ---------------------------------------------------------------- Einkauf (lesen)

registerAgentTool({
  name: 'eingangsrechnungen_offen',
  label: 'Offene Eingangsrechnungen nachgeschlagen',
  modules: ['einkauf'],
  description: 'Offene Eingangsrechnungen (noch nicht oder nur teilweise bezahlt), optional eines Lieferanten oder nur fällige der nächsten Tage: Eingangsnummer, Lieferant, Rechnungsnummer, Datum, Fälligkeit, offen, Skonto bis, ob geprüft.',
  input_schema: { type: 'object', properties: { lieferant: { type: 'string' }, faellig_in_tagen: { type: 'integer', description: 'nur was bis in so vielen Tagen zu zahlen ist (samt Überfälligem)' } } },
  run({ lieferant, faellig_in_tagen }) {
    const e = app.data.einkauf || { invoices: [], suppliers: [] }
    const today = todayISO()
    const sup = lieferant ? findOne((e.suppliers || []).filter((s) => s.active !== false), lieferant, 'Lieferant', (s) => [supplierName(s), s.supplierNo || '']) : null
    const limit = Number.isInteger(faellig_in_tagen) && faellig_in_tagen >= 0 ? addDays(today, faellig_in_tagen) : null
    const rows = payables(e.invoices || [], today).filter((x) => (!sup || x.inv.supplierId === sup.id) && (!limit || (x.deadline && x.deadline <= limit)))
    return {
      anzahl: rows.length,
      summe_offen: eur(rows.reduce((s, x) => s + x.open, 0)),
      rechnungen: rows.slice(0, 60).map((x) => ({ eingangsnummer: x.inv.no || '', lieferant: x.inv.supplier?.name || '', rechnungsnummer: x.inv.number || '', datum: x.inv.date || '', faellig: x.inv.dueDate || '', offen: eur(x.open), zustand: PAY_STATE[purchaseState(x.inv, today)], ...(x.skonto ? { skonto_bis: x.skonto.until, mit_skonto_zu_zahlen: eur(x.skonto.payable) } : {}), geprueft: !!x.inv.approval })),
    }
  },
})

// ---------------------------------------------------------------- Anlagen & Prüffristen (lesen)

registerAgentTool({
  name: 'anlagen_pruefungen',
  label: 'Anlagen und Prüffristen nachgeschlagen',
  modules: ['anlagen'],
  description: 'Anlagen mit fälligen oder überfälligen Prüfungen und offenen Mängeln (Feuerlöscher, Notbeleuchtung, Spielplatz …), optional für ein Objekt: Objekt, Art, Bezeichnung, Zustand, nächste Prüfung, wer prüft, offene Mängel.',
  input_schema: { type: 'object', properties: { objekt: { type: 'string' }, nur_ueberfaellig: { type: 'boolean' } } },
  run({ objekt, nur_ueberfaellig }) {
    const today = todayISO()
    const obj = objekt ? findObject(objekt) : null
    const rows = anlagenRows({ doc: app.data.anlagen, objects: app.data.objects || [], today }).filter((r) => r.state !== 'inaktiv' && (!obj || r.item.objectId === obj.id) && (nur_ueberfaellig ? r.state === 'ueberfaellig' : r.state === 'ueberfaellig' || r.state === 'faellig' || r.defects.length))
    return {
      anzahl: rows.length,
      ueberfaellig: rows.filter((r) => r.state === 'ueberfaellig').length,
      maengel_offen: rows.filter((r) => r.defects.length).length,
      anlagen: rows.slice(0, 60).map((r) => ({
        objekt: r.object?.name || objName(r.item.objectId),
        art: r.type?.name || '',
        bezeichnung: r.item.label || '',
        zustand: ANL_STATES[r.state] || r.state,
        naechste_pruefung: r.next || (r.unknown ? 'unbekannt (noch nie geprüft)' : ''),
        prueft: r.item.by === 'fremd' ? r.item.company || 'Fremdfirma' : 'eigene Leute',
        maengel: r.defects.map((c) => `${RESULTS[c.result] || c.result} seit ${day(c.date)}${c.defects ? `: ${String(c.defects).slice(0, 120)}` : ''}`),
      })),
    }
  },
})

// ---------------------------------------------------------------- Qualitätsmessung (lesen)

registerAgentTool({
  name: 'qualitaet_abfragen',
  label: 'Qualitätsmessungen nachgeschlagen',
  modules: ['qualitaet'],
  description: 'Qualitätskennzahl je Objekt (in Anlehnung an EN 13549) und die letzten Messungen: Kennzahl in Prozent, Zielwert, erfüllt oder nicht, Nachkontrolle bis wann, Reklamationsgefahr. Ohne Objekt: alle Objekte mit Messungen.',
  input_schema: { type: 'object', properties: { objekt: { type: 'string' }, letzte: { type: 'integer', description: 'wie viele Messungen je Objekt (Standard 3)' } } },
  run({ objekt, letzte }) {
    const doc = app.data.qualitaet || { measurements: [] }
    const today = todayISO()
    const settings = qmSettings(doc)
    const obj = objekt ? findObject(objekt) : null
    const ids = obj ? [obj.id] : [...new Set((doc.measurements || []).filter((m) => m.status === 'fertig').map((m) => m.objectId))]
    const n = Number.isInteger(letzte) && letzte > 0 ? Math.min(letzte, 10) : 3
    const objekte = ids.map((id) => {
      const st = objectStatus({ doc, objectId: id, today, settings })
      return {
        objekt: objName(id),
        kennzahl: st.result?.score ?? null,
        zielwert: st.result?.target ?? settings.target,
        erfuellt: st.result ? st.result.ok !== false && !st.result.poor : null,
        nachkontrolle: st.recheck ? `${st.recheck.overdue ? 'überfällig seit' : 'bis'} ${st.recheck.due}` : null,
        reklamationsgefahr: st.risk,
        messungen: measurementsOf(doc, id)
          .slice(-n)
          .reverse()
          .map((m) => {
            const r = resultOf(m)
            return { datum: m.date, kennzahl: r.score, erfuellt: r.ok, raeume: r.rooms, nicht_in_ordnung: r.bad, nachkontrolle: !!m.recheckOf }
          }),
      }
    })
    return { anzahl: objekte.length, hinweis: 'Kennzahl: gewichteter Anteil der Prüfobjekte ohne Mangel (Vorschlag in Anlehnung an EN 13549, ohne Gewähr).', objekte: objekte.slice(0, 40) }
  },
})

// ---------------------------------------------------------------- Regieberichte (lesen)

registerAgentTool({
  name: 'regieberichte_abfragen',
  label: 'Regieberichte nachgeschlagen',
  modules: ['regie'],
  description: 'Regieberichte (Sonderleistungen nach Auftrag): offene (noch nicht unterschrieben bzw. abgeschlossen), unverrechnete (abgeschlossen, in keiner Rechnung) oder alle, optional je Objekt: Nummer, Datum, Objekt, Leistung, Stunden, Stand, Verrechnung.',
  input_schema: { type: 'object', properties: { stand: { type: 'string', enum: ['offen', 'unverrechnet', 'alle'] }, objekt: { type: 'string' } } },
  run({ stand = 'unverrechnet', objekt }) {
    const reports = app.data.regie?.reports || []
    const obj = objekt ? findObject(objekt) : null
    const states = regieStates(reports, sees('fakturierung') ? fak().documents : null)
    const rows = reports
      .filter((r) => (!obj || r.objectId === obj.id) && (stand === 'alle' || (stand === 'offen' ? r.status !== 'abgeschlossen' : states.get(r.id)?.state === 'offen')))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    return {
      anzahl: rows.length,
      berichte: rows.slice(0, 60).map((r) => {
        const st = states.get(r.id)
        return { nummer: r.no, datum: r.date, objekt: objName(r.objectId), art: REGIE_KINDS[r.kind] || '', leistung: r.title || '', stunden: regieTotals(r).hours, stand: r.status !== 'abgeschlossen' ? 'offen (nicht unterschrieben)' : r.signature ? 'unterschrieben' : 'ohne Unterschrift abgeschlossen', verrechnung: st ? `${BILL_STATES[st.state]}${st.number ? ` ${st.number}` : ''}` : '–' }
      }),
    }
  },
})

// ---------------------------------------------------------------- Ändern (nach „Ausführen“)

function reportByNo(text) {
  const q = String(text || '').trim().toUpperCase()
  const reports = app.data.regie?.reports || []
  return findOne(reports, q, 'Regiebericht', (r) => [r.no || '', `${objName(r.objectId)} ${r.date}`])
}

registerAgentTool({
  name: 'rechnung_aus_regiebericht',
  label: 'Rechnungsentwurf aus Regiebericht',
  modules: ['fakturierung'],
  write: true,
  when: () => sees('regie'),
  description: 'Rechnungsentwurf aus einem abgeschlossenen Regiebericht erzeugen, genau wie „Rechnungsentwurf“ im Modul Regieberichte (Regiestunden und Material als Positionen, Kunde des Objekts, Leistungsdatum, Bericht als Beilage). Nur ein Entwurf: festgeschrieben und versendet wird in der Fakturierung. Die App fragt vorher selbst nach.',
  input_schema: { type: 'object', properties: { regiebericht: { type: 'string', description: 'Nummer, z. B. RB-2026-0003' } }, required: ['regiebericht'] },
  summary({ regiebericht }) {
    const r = reportByNo(regiebericht)
    if (r.status !== 'abgeschlossen') throw new ToolError(`${r.no} ist noch nicht abgeschlossen (unterschrieben): erst abschließen, dann verrechnen.`)
    const st = regieState(r, fak().documents)
    if (st?.state === 'entwurf') throw new ToolError(`Für ${r.no} gibt es schon einen Rechnungsentwurf.`)
    if (st?.state === 'verrechnet') throw new ToolError(`${r.no} ist schon mit ${st.number} verrechnet.`)
    if (st?.state === 'nicht') throw new ToolError(`${r.no} steht auf „nicht verrechnen“.`)
    const cu = customerForObject(fak(), r.objectId)
    const t = regieTotals(r)
    return { title: 'Rechnungsentwurf aus Regiebericht', lines: [`${r.no} vom ${day(r.date)}: ${r.title || REGIE_KINDS[r.kind] || ''}`, `${objName(r.objectId)} · ${String(t.hours).replace('.', ',')} Std.${(r.material || []).length ? ` · ${(r.material || []).length} Material` : ''}`, cu ? `Kunde: ${customerName(cu)}` : 'Achtung: Kunde zum Objekt fehlt (im Entwurf ergänzen)', 'Nur ein Entwurf: Festschreiben und Senden in der Fakturierung.'] }
  },
  async run({ regiebericht }) {
    const r = reportByNo(regiebericht)
    const action = await ensureAction('reg-invoice')
    const res = await action({ dataset: { id: r.id, quiet: '1' } })
    if (!res) throw new ToolError('Keine Berechtigung für Rechnungsentwürfe.')
    if (res.error) throw new ToolError(res.error)
    return { erstellt: true, entwurf: true, titel: res.x.title, kunde: res.customer ? customerName(res.customer) : null, netto: eur(totals(res.x, settingsOf(fak())).net), hinweis: res.message, in_app: 'Fakturierung → Rechnungen → Entwurf' }
  },
})

registerAgentTool({
  name: 'zahlungserinnerung_vorbereiten',
  label: 'Zahlungserinnerung vorbereitet',
  modules: ['fakturierung'],
  write: true,
  description: 'Zahlungserinnerung oder Mahnung zu einer offenen Rechnung vorbereiten: öffnet den Dialog der Fakturierung mit Text, Betrag, Zinsen und Frist der nächsten Mahnstufe. Gesendet wird nichts – die Person prüft und sendet dort selbst. Die App fragt vorher nach.',
  input_schema: { type: 'object', properties: { rechnung: { type: 'string', description: 'Rechnungsnummer, z. B. RE-2026-0012' } }, required: ['rechnung'] },
  summary({ rechnung }) {
    const x = findInvoice(rechnung)
    const d = fak()
    const today = todayISO()
    const r = reminderFor(x, d.documents, { today, settings: d.settings })
    if (!(r.open > 0.004)) throw new ToolError(`${x.number} ist bezahlt; nichts zu erinnern.`)
    return { title: `${r.name} vorbereiten`, lines: [`${x.number} · ${x.recipient?.name || ''}`, `offen ${eur(r.open).toFixed(2).replace('.', ',')} €${x.dueDate ? `, fällig seit ${day(x.dueDate)}` : ''}`, 'Öffnet den Dialog zum Prüfen – gesendet wird erst dort.'] }
  },
  async run({ rechnung }) {
    const x = findInvoice(rechnung)
    const action = await ensureAction('fak-remind-open')
    await action({ dataset: { id: x.id } })
    return { geoeffnet: true, rechnung: x.number, hinweis: 'Der Dialog ist offen; nichts wurde gesendet. Den Chat holt Strg+J oder „Assistent“ zurück.' }
  },
})

const TIME = { type: 'string', pattern: '^\\d{2}:\\d{2}$', description: 'HH:MM (Standard 08:00)' }

/** Ende eines Termins am selben Tag: „08:00“ + 60 → „09:00“. */
function endOf(time, minutes = 60) {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + (Number(minutes) > 0 ? Number(minutes) : 60)
  if (total >= 1440) throw new ToolError('Der Termin muss am selben Tag enden.')
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Kontrolle als Termin über das Modul Termine (in der App und, falls verbunden, in Outlook). */
async function plannedCheck({ title, date, time = '08:00', objectId, note }) {
  const saved = await saveAppointment({ title, kind: 'kontrolle', start: `${date}T${time}`, end: `${date}T${endOf(time)}`, location: (app.data.objects || []).find((o) => o.id === objectId)?.address || '', note, objectId, attendees: [], employeeIds: [], online: false, reminder: 15, responseRequested: false }, { quiet: true })
  return { angelegt: true, titel: title, wann: `${day(date)} ${time}–${endOf(time)}`, in_app: 'Termine', ...(saved?.outlook?.error ? { outlook: `nicht in Outlook: ${saved.outlook.error}` } : {}) }
}

/** Anlage am Objekt: über Bezeichnung oder Art; ohne Angabe die einzige mit Handlungsbedarf. */
function anlageRow(objekt, anlage) {
  const obj = findObject(objekt)
  const rows = anlagenRows({ doc: app.data.anlagen, objects: app.data.objects || [], today: todayISO() }).filter((r) => r.item.objectId === obj.id && r.state !== 'inaktiv')
  if (!rows.length) throw new ToolError(`Für ${obj.name} sind keine Anlagen eingetragen.`)
  if (anlage) return findOne(rows, anlage, 'Anlage', (r) => [r.item.label || '', r.type?.name || '', `${r.type?.name || ''} ${r.item.label || ''}`])
  const need = rows.filter((r) => r.state === 'ueberfaellig' || r.state === 'faellig' || r.defects.length)
  if (need.length === 1) return need[0]
  throw new ToolError(`Welche Anlage? ${(need.length ? need : rows).slice(0, 8).map((r) => `${r.type?.name || 'Anlage'} ${r.item.label}`).join('; ')}.`)
}

function anlagePlan({ objekt, anlage, datum, beginn }) {
  const r = anlageRow(objekt, anlage)
  const today = todayISO()
  const defect = r.defects.length && r.state === 'ok'
  const date = datum || workday(r.next && r.next > today ? r.next : addDays(today, 1))
  if (date < today) throw new ToolError('Das Datum liegt in der Vergangenheit.')
  const title = `${defect ? 'Mangel beheben' : 'Prüfung'} ${r.type?.name || 'Anlage'}: ${r.item.label}${r.item.by === 'fremd' && r.item.company ? ` (${r.item.company})` : ''}`
  const note = [r.next ? `Nächste Prüfung laut Prüffristen: ${day(r.next)}` : '', ...r.defects.map((c) => `Offener Mangel seit ${day(c.date)}${c.defects ? `: ${c.defects}` : ''}`)].filter(Boolean).join('\n')
  return { r, date, time: beginn || '08:00', title, note }
}

registerAgentTool({
  name: 'anlage_termin',
  label: 'Termin für eine Anlage',
  modules: ['termine'],
  write: true,
  when: () => sees('anlagen'),
  description: 'Termin für die Prüfung einer Anlage oder die Nachkontrolle eines offenen Mangels anlegen (wie „Termin in Outlook“ bei Anlagen & Prüffristen). Ohne Datum: die nächste Prüfung bzw. der nächste Werktag. Die App fragt vorher selbst nach.',
  input_schema: { type: 'object', properties: { objekt: { type: 'string' }, anlage: { type: 'string', description: 'Bezeichnung oder Art, z. B. „Feuerlöscher EG“ (ohne: die einzige mit Handlungsbedarf)' }, datum: DATE, beginn: TIME }, required: ['objekt'] },
  summary(input) {
    const p = anlagePlan(input)
    return { title: 'Termin anlegen', lines: [p.title, `${day(p.date)} ${p.time}–${endOf(p.time)}`, p.r.object?.name || objName(p.r.item.objectId), ...p.note.split('\n').filter(Boolean)] }
  },
  run(input) {
    const p = anlagePlan(input)
    return plannedCheck({ title: p.title, date: p.date, time: p.time, objectId: p.r.item.objectId, note: p.note })
  },
})

function qmPlan({ objekt, datum, beginn }) {
  const obj = findObject(objekt)
  const doc = app.data.qualitaet || { measurements: [] }
  const today = todayISO()
  const st = objectStatus({ doc, objectId: obj.id, today })
  if (!st.last) throw new ToolError(`Für ${obj.name} gibt es noch keine Qualitätsmessung.`)
  const tomorrow = addDays(today, 1)
  const date = datum || workdayBefore(st.recheck?.due && st.recheck.due > today ? st.recheck.due : tomorrow, tomorrow)
  if (date < today) throw new ToolError('Das Datum liegt in der Vergangenheit.')
  const r = st.result
  const title = `${st.recheck ? 'Nachkontrolle' : 'Qualitätsmessung'}: ${obj.name}`
  const note = `Letzte Messung ${day(st.last.date)}: Kennzahl ${r?.score ?? '–'} % (Ziel ${r?.target ?? '–'} %)${r?.ok === false ? ', nicht erfüllt' : ''}.${st.recheck ? ` Nachkontrolle bis ${day(st.recheck.due)}.` : ''}`
  return { obj, date, time: beginn || '08:00', title, note }
}

registerAgentTool({
  name: 'nachkontrolle_termin',
  label: 'Termin für die Nachkontrolle',
  modules: ['termine'],
  write: true,
  when: () => sees('qualitaet'),
  description: 'Termin für die Nachkontrolle nach einer schlechten Qualitätsmessung (oder die nächste Messung) in einem Objekt anlegen, wie „Nachkontrolle als Termin“ in der Qualitätsmessung. Ohne Datum: Werktag vor Ablauf der Nachkontrolle, sonst morgen. Die App fragt vorher selbst nach.',
  input_schema: { type: 'object', properties: { objekt: { type: 'string' }, datum: DATE, beginn: TIME }, required: ['objekt'] },
  summary(input) {
    const p = qmPlan(input)
    return { title: 'Termin anlegen', lines: [p.title, `${day(p.date)} ${p.time}–${endOf(p.time)}`, p.note] }
  },
  run(input) {
    const p = qmPlan(input)
    return plannedCheck({ title: p.title, date: p.date, time: p.time, objectId: p.obj.id, note: p.note })
  },
})
