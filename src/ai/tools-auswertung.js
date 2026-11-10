// Werkzeuge des KI-Assistenten für die Auswertungen der letzten Runde: Rentabilität je Objekt, Nachkalkulation,
// Fahrtenbuch, Zusatzleistungen aus dem Kundenbereich und Checklisten mit „nicht möglich“. Nur lesen; Rechte wie die
// Ansichten (Rentabilität: Fakturierung und Auswertung; Kalkulation: Vollzugriff). Geladen mit dem Assistenten.
// Rückgaben knapp, ohne Namen von Mitarbeitenden, ohne Löhne je Person und ohne Kontaktdaten von Kunden.

import { addDays, formatDate, todayISO, viennaDate } from '../core/dates.js'
import { CALC_DEFAULTS, calcWage } from '../core/calculation.js'
import * as fb from '../core/fahrtenbuch.js'
import { nachkalkulation, suggestPerformance } from '../core/nachkalkulation.js'
import { hoursByObject, RENT_LEVELS, rentability, ratesOf, rentSettings, rentSpan } from '../core/rentabilitaet.js'
import { mergeRules } from '../core/rules.js'
import { STATUS as ZL_STATUS, isOpenRequest, offerOfRequest, requestStatus, wishText } from '../core/zusatzleistungen.js'
import { app, computeRange, ensureRange } from '../ui/context.js'
import { registerAgentTool } from './registry.js'
import { findObject, ToolError } from './tools.js'

const DATE = { type: 'string', format: 'date', description: 'Datum JJJJ-MM-TT' }
const day = (d) => (d ? formatDate(d, { year: true }) : '')
const eur = (n) => Math.round(Number(n || 0) * 100) / 100
const pct = (r) => (r === null || r === undefined ? null : Math.round(r * 1000) / 10)
const sees = (m) => !app.access || app.access.sees(m)
const all = () => !app.access || !!app.access.all
const SPAN = { type: 'string', enum: ['3', '6', '12'], description: 'Zeitraum in Monaten bis gestern (Vorgabe 6)' }

// ---------------------------------------------------------------- Rentabilität je Objekt

registerAgentTool({
  name: 'rentabilitaet_abfragen',
  label: 'Rentabilität je Objekt nachgeschlagen',
  modules: '*',
  when: () => all() || (sees('fakturierung') && sees('auswertung')),
  description:
    'Deckungsbeitrag je Objekt wie in der Ansicht „Rentabilität“: Umsatz netto (Rechnungen, Sammelrechnungen nach Stunden verteilt), Kosten (Lohnkosten aus Ist-Stunden, Material, Fremdleistungen), Deckungsbeitrag in Euro und Prozent, Stufe (Ziel erreicht, unter Ziel, kritisch, Kosten ohne Umsatz), Vorperiode, nötiger Umsatz für das Ziel. Für Fragen wie „Welche Objekte sind unrentabel?“.',
  input_schema: { type: 'object', properties: { monate: SPAN, objekt: { type: 'string', description: 'nur dieses Objekt (optional)' }, nur_unter_ziel: { type: 'boolean' } } },
  async run({ monate = '6', objekt, nur_unter_ziel }) {
    const sp = rentSpan(['3', '6', '12'].includes(String(monate)) ? String(monate) : '6', todayISO())
    await ensureRange(sp.prev.from, sp.to)
    const r = computeRange(sp.prev.from, sp.to)
    const k = app.data.kalkulation?.settings || {}
    const costPerHour = calcWage(k, mergeRules(app.data.rules).wages) * (1 + (Number(k.lnkPct ?? CALC_DEFAULTS.lnkPct) || 0) / 100)
    const base = { objects: app.data.objects || [], fak: app.data.fakturierung || null, material: sees('material') ? app.data.material || null : null, einkauf: sees('einkauf') ? app.data.einkauf || null : null, costPerHour, settings: rentSettings(app.data.fakturierung?.settings?.rent || {}), contracts: app.data.fakturierung?.contracts || [] }
    const hrs = (from, to) => hoursByObject({ instances: r.instances, state: r.state, stamps: app.data.stamps, from, to })
    const prev = rentability({ ...base, hours: hrs(sp.prev.from, sp.prev.to), from: sp.prev.from, to: sp.prev.to })
    const res = rentability({ ...base, hours: hrs(sp.from, sp.to), from: sp.from, to: sp.to, prevRates: ratesOf(prev) })
    const obj = objekt ? findObject(objekt) : null
    const rows = res.rows.filter((x) => (!obj || x.objectId === obj.id) && (!nur_unter_ziel || x.level !== 'gut'))
    return {
      zeitraum: `${day(sp.from)} bis ${day(sp.to)}`,
      ziel_prozent: res.settings.target,
      gesamt: { umsatz: eur(res.totals.revenue), kosten: eur(res.totals.cost), deckungsbeitrag: eur(res.totals.margin), prozent: pct(res.totals.rate), unter_ziel: res.totals.below, ohne_objekt_verteilt_nicht: eur(res.unassigned) },
      objekte: rows.slice(0, 40).map((x) => ({
        objekt: x.name,
        kunde: x.customer || '',
        umsatz: eur(x.revenue),
        kosten: eur(x.cost),
        davon_lohn: eur(x.labor),
        deckungsbeitrag: eur(x.margin),
        prozent: pct(x.rate),
        stufe: RENT_LEVELS[x.level] || x.level,
        vorperiode_prozent: pct(x.prevRate),
        ist_stunden: x.usedHours,
        gestempelt_anteil: x.stampedShare === null ? null : Math.round(x.stampedShare * 100),
        noetiger_umsatz_fuer_ziel: x.raise !== null ? eur(x.needed) : null,
        preiserhoehung_prozent: x.raise !== null ? Math.round(x.raise * 1000) / 10 : null,
        vertrag: !!x.contractId,
      })),
      weitere: Math.max(0, rows.length - 40),
    }
  },
})

// ---------------------------------------------------------------- Nachkalkulation

registerAgentTool({
  name: 'nachkalkulation_abfragen',
  label: 'Nachkalkulation nachgeschlagen',
  modules: '*',
  when: all,
  description:
    'Nachkalkulation wie im Reiter der Kalkulation: je Objekt mit Kalkulation die kalkulierten Stunden im Monat gegen die tatsächlich gerechneten (gestempelt, sonst laut Plan), Abweichung in Prozent, Anteil gestempelt; dazu der Vorschlag für die Leistungswerte (m² je Stunde) je Raumart. Nur ein Vorschlag – übernommen wird in der Kalkulation.',
  input_schema: { type: 'object', properties: { monate: SPAN } },
  async run({ monate = '3' }) {
    const sp = rentSpan(['3', '6', '12'].includes(String(monate)) ? String(monate) : '3', todayISO())
    await ensureRange(sp.from, sp.to)
    const r = computeRange(sp.from, sp.to)
    const k = app.data.kalkulation || {}
    const s = { ...CALC_DEFAULTS, ...(k.settings || {}), performance: { ...CALC_DEFAULTS.performance, ...(k.settings?.performance || {}) } }
    const rows = nachkalkulation({ objects: app.data.objects || [], calcObjects: k.objects || {}, settings: s, hours: hoursByObject({ instances: r.instances, state: r.state, stamps: app.data.stamps, from: sp.from, to: sp.to }), months: Number(sp.kind) || 3, wage: calcWage(s, mergeRules(app.data.rules).wages) })
    const sug = suggestPerformance(rows, s.performance)
    return {
      zeitraum: `${day(sp.from)} bis ${day(sp.to)}`,
      objekte: rows.slice(0, 40).map((x) => ({
        objekt: x.name,
        kalkuliert_h_monat: x.calcHours,
        gerechnet_h_monat: x.usedHours,
        abweichung_prozent: x.deviation === null || x.deviation === undefined ? null : Math.round(x.deviation * 1000) / 10,
        gestempelt_prozent: x.stampedShare === null || x.stampedShare === undefined ? null : Math.round(x.stampedShare * 100),
        verlaesslich: !!x.reliable,
      })),
      vorschlag_leistungswerte: sug.map((x) => ({ raumart: x.label, bisher_m2_h: x.current, vorschlag_m2_h: x.suggested, objekte: x.objects })),
    }
  },
})

// ---------------------------------------------------------------- Fahrtenbuch

registerAgentTool({
  name: 'fahrtenbuch_abfragen',
  label: 'Fahrtenbuch nachgeschlagen',
  modules: ['fahrzeuge'],
  description:
    'Fahrtenbuch je Fahrzeug für einen Monat: Fahrten, km dienstlich und privat, offene Vorschläge aus Dienstplan und Winterdienst zum Bestätigen (älter als 7 Tage = nachtragen; Touren des Mattenwechsels zeigt der Reiter), Lücken im km-Stand, Privat-km im Jahresschnitt (500-km-Grenze für den halben Sachbezug). Bestätigt wird im Reiter „Fahrtenbuch“.',
  input_schema: { type: 'object', properties: { monat: { type: 'string', description: 'JJJJ-MM (Vorgabe: dieser Monat)' }, fahrzeug: { type: 'string', description: 'Kennzeichen (optional)' } } },
  async run({ monat, fahrzeug }) {
    const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(monat || '')) ? String(monat) : todayISO().slice(0, 7)
    const fz = (app.data.fahrzeuge?.vehicles || []).filter((v) => !v.inactive)
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const veh = fahrzeug ? fz.filter((v) => norm(v.plate).includes(norm(fahrzeug))) : fz
    if (fahrzeug && veh.length !== 1) throw new ToolError(veh.length ? `„${fahrzeug}“ ist nicht eindeutig: ${veh.map((v) => v.plate).join(', ')}.` : `Fahrzeug „${fahrzeug}“ nicht gefunden.`)
    if (app.service?.ensureYears) await app.service.ensureYears('fahrtenbuch', [m.slice(0, 4)])
    const from = `${m}-01`
    const to = addDays(Number(m.slice(5)) === 12 ? `${Number(m.slice(0, 4)) + 1}-01-01` : `${m.slice(0, 4)}-${String(Number(m.slice(5)) + 1).padStart(2, '0')}-01`, -1)
    await ensureRange(from, to < todayISO() ? to : todayISO())
    const trips = app.data.fahrtenbuch || []
    // Vorschläge aus Dienstplan und Winterdienst (die Touren des Mattenwechsels zählt der Reiter „Fahrtenbuch“)
    const last = to < todayISO() ? to : todayISO()
    const drivers = new Set(fz.map((v) => v.driverId).filter(Boolean))
    const r = drivers.size && from <= last ? computeRange(from, last) : null
    const plan = r ? r.instances.filter((i) => i.status !== 'cancelled').map((i) => ({ key: i.key, date: i.date, start: i.startTime, objectId: i.objectId, empIds: r.state.assigned(i.key).map((a) => a.employeeId) })) : []
    const winter = Object.entries(app.data.winterlog || {}).filter(([key]) => key.slice(0, 10) >= from && key.slice(0, 10) <= last).map(([key, e]) => ({ ...e, id: e.id || key, date: e.date || key.slice(0, 10), objectId: e.objectId || key.split('|')[1] }))
    const visits = [...fb.visitsFromWinter(winter, { employees: app.data.employees || [], objects: app.data.objects || [] }), ...fb.visitsFromPlan(plan, { objects: app.data.objects || [], employees: app.data.employees || [], drivers })]
    const sug = from <= last ? fb.suggestTrips({ visits, vehicles: fz, trips, from, to: last, today: todayISO() }) : []
    return {
      monat: m,
      fahrzeuge: veh.map((v) => {
        const list = fb.tripsIn(trips, { from, to, vehicleId: v.id })
        const sums = fb.kmSums(list)
        const p = fb.privateAverage(trips, v.id, m)
        const open = sug.filter((s) => s.vehicleId === v.id)
        return {
          kennzeichen: v.plate,
          fahrten: sums.count,
          km_dienstlich: sums.dienst,
          km_privat: Math.round((sums.privat + sums.weg) * 10) / 10,
          zum_bestaetigen: open.length,
          davon_nachtragen: open.filter((s) => s.late).length,
          storniert: list.filter((t) => t.cancelled).length,
          geaendert: list.filter((t) => t.history?.length).length,
          pruefung: fb.tripChecks(trips, v.id).filter((c) => c.date >= from && c.date <= to && c.level !== 'info').map((c) => `${day(c.date)}: ${c.text}`),
          privat_jahresschnitt_km: p.months ? p.perMonth : null,
          ueber_500_km: p.over,
        }
      }),
    }
  },
})

// ---------------------------------------------------------------- Zusatzleistungen aus dem Kundenbereich

registerAgentTool({
  name: 'zusatzleistungen_offen',
  label: 'Anfragen für Zusatzleistungen nachgeschlagen',
  modules: '*',
  when: () => all() || sees('fakturierung') || (app.access?.canEdit && (app.access.canEdit('reklamationen') || app.access.canEdit('planung'))),
  description:
    'Anfragen für Zusatzleistungen, die Kunden über den Kundenbereich gestellt haben (Grundreinigung, Glas, Sonderreinigung …): Nummer, Objekt, Art, Wunschtermin, Fläche, Stand (eingegangen, Angebot gesendet, beauftragt, erledigt, abgelehnt), seit wann offen. Ohne Kontaktdaten. Bearbeitet wird im Kundenbereich.',
  input_schema: { type: 'object', properties: { nur_offen: { type: 'boolean', description: 'Vorgabe ja' }, seit: DATE } },
  run({ nur_offen = true, seit }) {
    const docs = app.data.fakturierung?.documents || []
    const list = (app.data.zusatz?.requests || [])
      .filter((r) => (!nur_offen || isOpenRequest(r)) && (!seit || (viennaDate(r.received) || String(r.received).slice(0, 10)) >= seit))
      .sort((a, b) => String(a.received).localeCompare(String(b.received)))
    return {
      anzahl: list.length,
      anfragen: list.slice(0, 40).map((r) => {
        const offer = offerOfRequest(r, docs)
        const st = requestStatus(r, { offer })
        return { nummer: r.no, eingegangen: day(viennaDate(r.received) || String(r.received).slice(0, 10)), objekt: r.objectName, art: r.kindName, wunsch: wishText(r), flaeche_m2: r.area, stand: ZL_STATUS[st] || st, angebot: offer?.number || r.offer?.number || null, beschreibung: String(r.text || '').slice(0, 200) }
      }),
    }
  },
})

// ---------------------------------------------------------------- Checklisten am Handy

registerAgentTool({
  name: 'checklisten_nicht_moeglich',
  label: 'Checklisten nachgeschlagen',
  modules: ['planung'],
  description:
    'Leistungs-Checklisten aus dem „Plan am Handy“ in einem Zeitraum: je Objekt, wie viele Punkte erledigt waren, und welche „nicht möglich“ waren (mit Grund, z. B. Raum versperrt, Material fehlt). Ohne Namen der Reinigungskräfte. Vorgabe: die letzten 14 Tage.',
  input_schema: { type: 'object', properties: { von: DATE, bis: DATE, objekt: { type: 'string' } } },
  async run({ von, bis, objekt }) {
    const to = bis || todayISO()
    const from = von || addDays(to, -13)
    if (from > to) throw new ToolError('„von“ liegt nach „bis“.')
    await ensureRange(from, to)
    const obj = objekt ? findObject(objekt) : null
    const by = new Map()
    for (const c of Object.values(app.data.checks || {})) {
      if (!c?.items?.length || c.date < from || c.date > to || (obj && c.objectId !== obj.id)) continue
      const k = c.objectId || c.objectName
      if (!by.has(k)) by.set(k, { objekt: c.objectName || '', einsaetze: new Set(), punkte: 0, erledigt: 0, nicht: [] })
      const x = by.get(k)
      x.einsaetze.add(c.instKey)
      for (const it of c.items) {
        x.punkte++
        if (it.status === 'ok') x.erledigt++
        else if (it.status === 'nicht') x.nicht.push(`${day(c.date)} ${c.label || ''}: ${it.text}${it.reason ? ` – ${it.reason}` : ''}`)
      }
    }
    const rows = [...by.values()].sort((a, b) => b.nicht.length - a.nicht.length || a.objekt.localeCompare(b.objekt, 'de'))
    return {
      zeitraum: `${day(from)} bis ${day(to)}`,
      objekte: rows.slice(0, 40).map((x) => ({ objekt: x.objekt, einsaetze: x.einsaetze.size, punkte: x.punkte, erledigt: x.erledigt, nicht_moeglich: x.nicht.slice(0, 15) })),
    }
  },
})
