// Werkzeuge des KI-Assistenten für den Mattenwechsel. Geladen mit dem Assistenten (agent.js), nicht beim Start. Rechte
// wie überall (registry.js): Lesen nur mit sichtbarem Bereich, Ändern nur mit Schreibrecht und erst nach „Ausführen“.
//
// Nachschlagen: fällige und überfällige Liegeplätze eines Zeitraums, Touren eines Tages (Fahrer nur die eigenen), die
// neun Zahlen der Büro-Übersicht, Lieferscheine (mit Preisen nur mit Leserecht auf die Fakturierung, sonst der Stand
// aus den Touren) und die Vorschau des Abrechnungslaufs (nichts wird angelegt).
// Ändern: einen Einsatz verschieben oder aussetzen (applyJobAction, wie der Kalender) und eine Pause am Liegeplatz
// eintragen (geplante Wechsel darin wie beim Betriebsurlaub über applyPauses). Keine Werkzeuge zum Freigeben von
// Touren, Senden von Lieferscheinen oder Festschreiben von Rechnungen – das macht das Büro in der App.
// Gerechnet wird nur mit den Rechenkernen des Moduls (core/matten-*.js), keine eigene Fälligkeit. Rückgaben knapp.

import { addDays, formatDate, todayISO } from '../core/dates.js'
import { customerName } from '../core/invoicing.js'
import { BILL_STATES, billingIndex, billingText, isMattenNote, noteBillState, noteNet, notePieces, planRun, prevMonth } from '../core/matten-abrechnung.js'
import { actionProblem, applyJobAction, applyPauses, canApply, DISPLAY, displayStatus, JOB_ACTIONS, mergeJobs, planSettings, withId, yearsFor } from '../core/matten-einsaetze.js'
import { employeeIdsFor, isMyTour, orderedStops, placementsOf, STOP_STATUS, TOUR_STATUS, tourProgress } from '../core/matten-fahrt.js'
import { ARCHIVE_STATES, archiveState, mailState, NOTE_STATES, noteRows } from '../core/matten-lieferschein.js'
import { isOpen, jobDate, jobsFor, nextDue, plannable } from '../core/matten-plan.js'
import { emptyMatten, matDisplay, upgradeMatten } from '../core/matten.js'
import { tourYears } from '../core/matten-touren.js'
import { mattenStateOf, overviewOf, overviewRights } from '../core/matten-uebersicht.js'
import { app, persist } from '../ui/context.js'
import { tourStore } from '../ui/matten-tourablage.js'
import { registerAgentTool } from './registry.js'
import { findOne, ToolError } from './tools.js'

const DATE = { type: 'string', format: 'date', description: 'Datum JJJJ-MM-TT' }
const PLACE = { type: 'string', description: 'Liegeplatz mit Objekt oder Kunde, z. B. „Haupteingang Wohnanlage Lehen“' }
const day = (d) => (d ? formatDate(d, { year: true }) : '')
const eur = (n) => Math.round(Number(n || 0) * 100) / 100
const sees = (m) => !app.access || app.access.sees(m)
const by = () => `${app.user?.name || 'Browser'} (KI-Assistent)`
const doc = () => upgradeMatten((app.data.matten ||= emptyMatten()))
const storedJobs = () => app.data.mattenJobs || []
const objName = (id) => (app.data.objects || []).find((o) => o.id === id)?.name || ''
const placeLabel = (p) => `${p?.name || 'Liegeplatz'}${p?.floor ? ` (${p.floor})` : ''}`
const placeFull = (p) => [placeLabel(p), objName(p.objectId) || p.customer?.name].filter(Boolean).join(', ')
/** Mattentypen aus der Fakturierung nur mit Leserecht, sonst die Kopie am Liegeplatz. */
const articles = () => (sees('fakturierung') ? app.data.fakturierung?.articles || null : null)
const matsText = (p) => (p?.mats || []).map((m) => `${Number(m.qty) || 0} × ${matDisplay(m, articles()).label}`).join(', ')

/** Einsätze der Jahre für den Zeitraum laden (eine Datei je Jahr, wie der Kalender). */
async function ensureJobs(von, bis) {
  try {
    await app.service?.ensureYears?.('mattenJobs', yearsFor(von, bis))
  } catch {
    /* ohne Netz: bekannter Stand */
  }
}

/**
 * Touren aus der gemeinsamen Ablage (wie Büro-Übersicht und Fahreransicht): Vorjahr, dieses Jahr und bis zu den Tagen
 * dates. Liefert { list, loaded, store }; ohne Netz der bekannte Stand.
 */
async function loadTours(today, dates = []) {
  const st = tourStore()
  if (!st) return { list: [], loaded: false, store: null }
  const all = [today, addDays(today, 14), ...dates].filter(Boolean).sort()
  const years = tourYears(all[0] < `${Number(today.slice(0, 4)) - 1}-01-01` ? all[0] : `${Number(today.slice(0, 4)) - 1}-01-01`, all.at(-1))
  const missing = years.filter((y) => !st.yearLoaded(y, 5 * 60_000))
  if (missing.length) {
    try {
      await st.load({ years: missing })
    } catch {
      /* ohne Netz oder ohne Recht: bekannter Stand */
    }
  }
  return { list: st.tours(), loaded: years.every((y) => st.yearLoaded(y)), store: st }
}

/** Stand wie in der Büro-Übersicht: Einsätze mit den Ergebnissen der Touren, bestätigte Wechsel, Überfällige. */
async function mattenState(today, dates = []) {
  const { list, loaded, store } = await loadTours(today, dates)
  return { tours: list, loaded, store, state: mattenStateOf({ doc: doc(), jobs: storedJobs(), tours: list, today, toursLoaded: loaded }) }
}

const uniqueBy = (list, key) => [...new Map(list.filter((x) => x && key(x)).map((x) => [key(x), x])).values()]

/** Filter für Liegeplätze nach Kunde, Objekt und Gebiet (Namen wie in der App; mehrdeutig: Rückfrage). */
function placementFilter({ kunde, objekt, gebiet } = {}) {
  const ps = doc().placements
  const cust = kunde ? findOne(uniqueBy(ps.map((p) => ({ id: p.customerId, name: p.customer?.name || '', no: p.customer?.no || '' })), (c) => c.id), kunde, 'Kunde', (c) => [c.name, c.no]) : null
  const obj = objekt ? findOne(uniqueBy(ps.map((p) => ({ id: p.objectId, name: objName(p.objectId), address: (app.data.objects || []).find((o) => o.id === p.objectId)?.address || '' })), (o) => o.id), objekt, 'Objekt', (o) => [o.name, o.address]) : null
  const area = gebiet ? findOne(doc().areas || [], gebiet, 'Gebiet', (a) => [a.name, a.legacyName || '']) : null
  return {
    keep: (p) => !!p && (!cust || p.customerId === cust.id) && (!obj || p.objectId === obj.id) && (!area || p.areaId === area.id),
    named: { ...(cust ? { kunde: cust.name } : {}), ...(obj ? { objekt: obj.name } : {}), ...(area ? { gebiet: area.name } : {}) },
  }
}

/** Liegeplatz über Name, Stockwerk, Objekt oder Kunde (aktive zuerst); mehrdeutig: Rückfrage mit Auswahl. */
function findPlacement(text) {
  const all = doc().placements
  const fields = (p) => [placeFull(p), p.name || '', `${p.name || ''} ${p.floor || ''}`, objName(p.objectId), p.customer?.name || '', p.legacyId || '']
  const active = all.filter((p) => p.active !== false)
  try {
    return findOne(active, text, 'Liegeplatz', fields)
  } catch (err) {
    if (!/nicht gefunden/.test(err.message)) throw err
    return findOne(all, text, 'Liegeplatz', fields)
  }
}

/** Stand eines Einsatzes in Worten (wie im Kalender; in Tour mit Fahrer). */
function jobText(job, today, tours = []) {
  const s = displayStatus(job, today)
  if (s === 'in-tour') {
    const t = tours.find((x) => x.id === job.tourId)
    return t ? `in Tour (${t.driverName || 'ohne Fahrer'}, ${TOUR_STATUS[t.status] || t.status})` : 'in Tour'
  }
  if (s === 'ueberfaellig') return `überfällig seit ${day(jobDate(job))}`
  if (s === 'verschoben') return `verschoben (Solltermin ${day(job.due)})`
  return DISPLAY[s] || s
}

// ---------------------------------------------------------------- Nachschlagen

registerAgentTool({
  name: 'matten_faellig',
  label: 'Fällige Liegeplätze nachgeschlagen',
  modules: ['matten'],
  description: 'Mattenwechsel: fällige Liegeplätze in einem Zeitraum (höchstens 62 Tage), dazu überfällige und nicht durchgeführte, optional je Kunde, Objekt oder Gebiet. Je Liegeplatz Tag, Objekt, Kunde, Gebiet, Matten und Stand (geplant, verschoben, in Tour, noch nicht im Kalender, überfällig).',
  input_schema: { type: 'object', properties: { von: DATE, bis: DATE, kunde: { type: 'string' }, objekt: { type: 'string' }, gebiet: { type: 'string', description: 'Gebiet (Tourrunde)' }, mit_ueberfaelligen: { type: 'boolean', description: 'Überfällige und nicht durchgeführte dazu (Standard ja)' } }, required: ['von', 'bis'] },
  async run({ von, bis, kunde, objekt, gebiet, mit_ueberfaelligen = true }) {
    if (bis < von) throw new ToolError('„bis“ liegt vor „von“.')
    if (addDays(von, 62) < bis) throw new ToolError('Höchstens 62 Tage auf einmal.')
    const today = todayISO()
    await ensureJobs(von < today ? von : today, bis)
    const { tours, state } = await mattenState(today, [von, bis])
    const d = doc()
    const { keep, named } = placementFilter({ kunde, objekt, gebiet })
    const byId = new Map(d.placements.map((p) => [p.id, p]))
    const rows = new Map()
    const add = (key, p, date, stand, extra = {}) => {
      if (!rows.has(key)) rows.set(key, { datum: date, liegeplatz: placeLabel(p), objekt: objName(p.objectId), kunde: p.customer?.name || '', gebiet: d.areas.find((a) => a.id === p.areaId)?.name || '', matten: matsText(p), stand, ...extra })
    }
    // offene Einsätze mit Tag im Zeitraum (mit dem Stand der Touren)
    for (const j of state.jobs) {
      const p = byId.get(j.placementId)
      if (!isOpen(j) || jobDate(j) < von || jobDate(j) > bis || !keep(p)) continue
      add(j.key, p, jobDate(j), jobText(j, today, tours), jobDate(j) < today ? { ueberfaellig: true } : {})
    }
    // laut Rhythmus fällig, aber noch nicht im Kalender (ab heute)
    const from = von > today ? von : today
    if (from <= bis) {
      const { closures, skip } = planSettings(d)
      for (const j of jobsFor({ placements: d.placements.filter(plannable), done: state.done, jobs: state.jobs, closures, skip, von: from, bis, now: '', by: '' }).added) {
        const p = byId.get(j.placementId)
        if (isOpen(j) && keep(p)) add(j.key, p, jobDate(j), 'noch nicht im Kalender (Einsätze planen)')
      }
    }
    if (mit_ueberfaelligen) {
      for (const x of state.overdue) if (keep(x.placement)) add(x.next.key, x.placement, x.next.date, `überfällig seit ${day(x.next.date)}`, { ueberfaellig: true })
      for (const x of state.notDone) {
        const p = byId.get(x.placementId)
        if (keep(p)) add(x.key, p, x.planned || x.date, `nicht durchgeführt am ${day(x.date)}${x.reason ? ` (${x.reason})` : ''}${x.planned ? `, nachholen am ${day(x.planned)}` : ''}`, { ueberfaellig: !x.planned })
      }
    }
    const list = [...rows.values()].sort((a, b) => a.datum.localeCompare(b.datum) || a.objekt.localeCompare(b.objekt, 'de') || a.liegeplatz.localeCompare(b.liegeplatz, 'de'))
    return {
      von,
      bis,
      ...named,
      anzahl: list.length,
      ueberfaellig: list.filter((r) => r.ueberfaellig).length,
      liegeplaetze: list.slice(0, 120),
      ...(list.length > 120 ? { hinweis: 'Nur die ersten 120; Zeitraum oder Filter verkleinern.' } : {}),
    }
  },
})

registerAgentTool({
  name: 'matten_touren',
  label: 'Matten-Touren nachgeschlagen',
  modules: ['matten', 'mattentour'],
  description: 'Mattenwechsel: Touren eines Tages (ohne Datum: heute) mit Fahrer, Fahrzeug, Stand und Fortschritt (Stopps erledigt/offen, Matten geplant/gewechselt, nächster Stopp) und den Stopps in der Reihenfolge. Fahrer bekommen nur ihre eigenen Touren.',
  input_schema: { type: 'object', properties: { datum: DATE } },
  async run({ datum }) {
    const today = todayISO()
    const date = datum || today
    const { list } = await loadTours(today, [date])
    const office = sees('matten')
    const me = { email: app.user?.email || '', employeeIds: employeeIdsFor(app.data.employees || [], app.user?.email) }
    const tours = list
      .filter((t) => t?.date === date && (office || (t.status !== 'entwurf' && isMyTour(t, me))))
      .sort((a, b) => String(a.driverName || '').localeCompare(String(b.driverName || ''), 'de') || String(a.id).localeCompare(String(b.id)))
    return {
      datum: date,
      anzahl: tours.length,
      ...(office ? {} : { hinweis: 'Nur deine eigenen Touren.' }),
      touren: tours.map((t) => {
        const pr = tourProgress(t)
        return {
          fahrer: t.driverName || 'ohne Fahrer',
          fahrzeug: t.vehicleLabel || '',
          stand: TOUR_STATUS[t.status] || t.status,
          stopps_gesamt: pr.stops,
          stopps_erledigt: pr.done,
          stopps_offen: pr.open,
          matten_geplant: pr.planned,
          matten_gewechselt: pr.actual,
          naechster_stopp: pr.next ? [pr.next.objectName, pr.next.customer?.name].filter(Boolean).join(', ') : null,
          stopps: orderedStops(t).slice(0, 40).map((s, i) => ({
            nr: i + 1,
            objekt: s.objectName || '',
            kunde: s.customer?.name || '',
            adresse: s.address || '',
            ankunft: s.times?.arrival || '',
            zeitfenster: s.window && (s.window.from || s.window.to) ? `${s.window.from || ''}–${s.window.to || ''}` : '',
            liegeplaetze: placementsOf(s).length,
            stand: STOP_STATUS[s.status] || s.status,
          })),
        }
      }),
    }
  },
})

registerAgentTool({
  name: 'matten_uebersicht',
  label: 'Mattenwechsel-Übersicht nachgeschlagen',
  modules: ['matten'],
  description: 'Mattenwechsel: die neun Zahlen der Büro-Übersicht für heute – heute fällig, geplante Touren, Touren in Durchführung, abgeschlossene Touren (7 Tage), überfällig, nicht durchgeführt, nicht versendete Lieferscheine, fehlerhafte SharePoint-Übertragungen, offene Rechnungsentwürfe (die beiden Zahlen der Fakturierung nur mit deren Leserecht).',
  input_schema: { type: 'object', properties: {} },
  async run() {
    const today = todayISO()
    await ensureJobs(today, today)
    const { list, loaded, store } = await loadTours(today)
    const fak = overviewRights(app.access).fak && app.data.fakturierung ? app.data.fakturierung.documents || [] : null
    const tourErrors = store ? [...store.pending.entries()].filter(([, e]) => e?.error).map(([path, e]) => ({ id: e.doc?.id || '', path, error: e.error, tour: e.doc || null })) : []
    const c = overviewOf({ doc: doc(), jobs: storedJobs(), tours: list, toursLoaded: loaded, docs: fak, tourErrors, today }).cards
    return {
      stichtag: today,
      heute_faellig: c.heute.n,
      geplante_touren: c.geplant.n,
      touren_in_durchfuehrung: c.unterwegs.n,
      abgeschlossene_touren_7_tage: c.fertig.n,
      ueberfaellig: c.ueberfaellig.n,
      nicht_durchgefuehrt: c.nicht.n,
      ...(c.unversendet ? { nicht_versendete_lieferscheine: c.unversendet.n } : {}),
      fehlerhafte_uebertragungen: c.fehler.n,
      ...(c.entwuerfe ? { offene_rechnungsentwuerfe: c.entwuerfe.n } : {}),
      ...(fak ? {} : { ohne_fakturierung: 'Lieferscheine und Rechnungsentwürfe nur mit Recht auf die Fakturierung.' }),
      ...(loaded ? {} : { hinweis: 'Die Touren sind noch nicht gelesen (ohne Netz?): Zahlen nur aus den gespeicherten Einsätzen.' }),
    }
  },
})

registerAgentTool({
  name: 'matten_lieferscheine',
  label: 'Matten-Lieferscheine nachgeschlagen',
  modules: ['matten', 'fakturierung'],
  description: 'Mattenwechsel: Lieferscheine eines Zeitraums (ohne Angabe die letzten 31 Tage, höchstens ein Jahr), optional eines Kunden: Nummer, Tag, Kunde, Objekt, Matten, versendet, Ablage, verrechnet. Netto mit den eingefrorenen Preisen nur mit Recht auf die Fakturierung, sonst ohne Preise aus den Touren.',
  input_schema: { type: 'object', properties: { kunde: { type: 'string', description: 'Name oder Kundennummer (optional)' }, von: DATE, bis: DATE } },
  async run({ kunde, von, bis }) {
    const today = todayISO()
    const to = bis || today
    const from = von || addDays(to, -30)
    if (to < from) throw new ToolError('„bis“ liegt vor „von“.')
    if (addDays(from, 366) < to) throw new ToolError('Höchstens ein Jahr auf einmal.')
    const f = sees('fakturierung') ? app.data.fakturierung : null
    if (f) {
      const docs = f.documents || []
      const all = docs.filter(isMattenNote)
      const cu = kunde ? findOne((f.customers || []).filter((c) => all.some((d) => d.customerId === c.id)), kunde, 'Kunde', (c) => [customerName(c), c.customerNo || '']) : null
      const index = billingIndex(docs)
      const rows = all.filter((d) => d.date >= from && d.date <= to && (!cu || d.customerId === cu.id)).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)))
      return {
        von: from,
        bis: to,
        ...(cu ? { kunde: customerName(cu) } : {}),
        anzahl: rows.length,
        summe_netto: eur(rows.reduce((s, d) => s + noteNet(d), 0)),
        lieferscheine: rows.slice(0, 80).map((d) => {
          const st = noteBillState(d, docs, index)
          const mail = mailState(d)
          return { nummer: d.number, datum: d.date, kunde: d.recipient?.name || '', objekt: d.objectName || '', matten: notePieces(d), netto: eur(noteNet(d)), versendet: mail === 'ok' ? 'ja' : mail === 'fehler' ? 'Versand fehlgeschlagen' : 'nein', ablage: ARCHIVE_STATES[archiveState(d)] || 'noch nicht abgelegt', verrechnung: `${BILL_STATES[st.state]}${st.number ? ` ${st.number}` : ''}` }
        }),
        ...(rows.length > 80 ? { hinweis: 'Nur die ersten 80.' } : {}),
      }
    }
    // ohne Fakturierung: Stand aus der Kopie am Stopp (Nummer, versendet), ohne Preise
    const { list } = await loadTours(today, [from, to])
    const rows = noteRows({ tours: list, docs: null, from, to }).filter((r) => r.number)
    const cu = kunde ? findOne(uniqueBy(rows.map((r) => ({ id: r.stop.customer?.id || r.customerName, name: r.customerName, no: r.customerNo })), (c) => c.id), kunde, 'Kunde', (c) => [c.name, c.no]) : null
    const mine = rows.filter((r) => !cu || (r.stop.customer?.id || r.customerName) === cu.id)
    return {
      von: from,
      bis: to,
      ...(cu ? { kunde: cu.name } : {}),
      anzahl: mine.length,
      hinweis: 'Ohne Recht auf die Fakturierung: Stand aus den Touren, ohne Preise.',
      lieferscheine: mine.slice(0, 80).map((r) => ({ nummer: r.number, datum: r.date, kunde: r.customerName, objekt: r.objectName, matten: r.actual, stand: NOTE_STATES[r.state] || r.state })),
    }
  },
})

const DRAFT_KIND = { einzel: 'Einzelrechnung je Lieferschein', sammel: 'Sammelrechnung', pauschale: 'Pauschale je Monat' }

registerAgentTool({
  name: 'matten_abrechnung_vorschau',
  label: 'Mattenwechsel-Abrechnung (Vorschau)',
  modules: ['fakturierung'],
  description: 'Mattenwechsel abrechnen, nur Vorschau: was der Lauf „Mattenwechsel abrechnen“ für einen Monat (Standard Vormonat) erzeugen würde – je Kunde Abrechnungsart, offene Lieferscheine, Entwürfe mit Netto und Brutto, Fehler und Hinweise. Legt nichts an.',
  input_schema: { type: 'object', properties: { monat: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'JJJJ-MM (Standard: Vormonat)' }, kunde: { type: 'string' }, aeltere_mitnehmen: { type: 'boolean', description: 'ältere offene Lieferscheine mitnehmen (Standard ja)' } } },
  run({ monat, kunde, aeltere_mitnehmen = true }) {
    const today = todayISO()
    const ym = monat || prevMonth(today)
    if (ym > today.slice(0, 7)) throw new ToolError('Der Monat liegt in der Zukunft.')
    const plan = planRun(app.data.fakturierung || {}, { ym, today, includeOlder: aeltere_mitnehmen })
    const one = kunde ? findOne(plan.plans, kunde, 'Kunde', (p) => [p.name, p.customerNo || '']) : null
    const list = one ? [one] : plan.todo
    const ready = list.flatMap((p) => p.drafts.filter((d) => !d.errors.length))
    return {
      monat: ym,
      nur_vorschau: true,
      kunden_mit_offenem: list.filter((p) => plan.todo.includes(p)).length,
      entwuerfe: ready.length,
      netto_gesamt: eur(ready.reduce((s, d) => s + (d.net || 0), 0)),
      schon_verrechnet: one ? one.billed.length : plan.done.length,
      kunden: list.slice(0, 40).map((p) => ({
        kunde: p.name,
        kundennummer: p.customerNo || '',
        abrechnung: billingText(p),
        zeitraum: p.period.label,
        lieferscheine: p.notes.map((n) => n.number),
        ...(p.older.length ? { aeltere_offen: p.older.map((n) => n.number) } : {}),
        entwuerfe: p.drafts.map((d) => ({ art: DRAFT_KIND[d.kind] || d.kind, lieferscheine: d.notes.length, ...(d.months?.length ? { monate: d.months } : {}), netto: eur(d.net), brutto: eur(d.gross), ...(d.errors.length ? { fehler: d.errors } : {}) })),
        hinweise: p.hints.map((h) => h.text),
      })),
      hinweis: 'Nichts wurde angelegt. Die Entwürfe erzeugt die Fakturierung unter „Läufe ▾“ → „Mattenwechsel abrechnen“; festgeschrieben wird erst nach Prüfen und Freigeben.',
    }
  },
})

// ---------------------------------------------------------------- Ändern (nach „Ausführen“)

/** Geänderte Einsätze speichern (eine Datei je Jahr, wie der Kalender). */
function storeJobs(changed) {
  if (!changed.length) return
  app.data.mattenJobs = mergeJobs(storedJobs(), changed)
  persist()
}

/**
 * Einsatz zum Verschieben oder Aussetzen finden: am Tag datum (Tag oder Solltermin) bzw. ohne Tag der nächste offene. Steht
 * der Wechsel laut Rhythmus noch nicht im Kalender, kommt er aus dem Fälligkeitsrechner (jobsFor) und wird mit der
 * Änderung angelegt – wie „Einsätze planen“ und danach die Aktion im Kalender.
 */
async function jobChange({ liegeplatz, aktion, datum, neuer_tag, grund }) {
  const today = todayISO()
  await ensureJobs(datum && datum < today ? datum : today, addDays(datum || today, 120))
  const { state } = await mattenState(today, datum ? [datum] : [])
  const d = doc()
  const p = findPlacement(liegeplatz)
  // mit dem Stand der Touren (ein schon gewechselter Einsatz einer Tour gilt als erledigt); gespeichert wird nur der geänderte
  const jobs = state.jobs
  const mine = jobs.filter((j) => j.placementId === p.id)
  const { closures, skip } = planSettings(d)
  const fromPlan = (date) => jobsFor({ placements: [p].filter(plannable), done: state.done, jobs, closures, skip, von: date, bis: date, now: new Date().toISOString(), by: by() }).added.find((j) => j.due === date && isOpen(j)) || null
  let job = null
  if (datum) job = mine.find((j) => isOpen(j) && jobDate(j) === datum) || mine.find((j) => isOpen(j) && j.due === datum) || mine.find((j) => jobDate(j) === datum || j.due === datum) || fromPlan(datum)
  else {
    const next = nextDue(p, { done: state.done, jobs, closures, skip, today })
    job = next ? next.job || fromPlan(next.due) : null
  }
  if (!job) {
    const next = nextDue(p, { done: state.done, jobs, closures, skip, today })
    throw new ToolError(`${placeFull(p)}: ${datum ? `am ${day(datum)} ist kein Wechsel` : 'kein nächster Wechsel (inaktiv oder Pause ohne Ende)'}.${next ? ` Nächster Wechsel: ${day(next.date)}.` : ''}`)
  }
  const problem = actionProblem(aktion, { date: neuer_tag || '', reason: grund || '', today })
  if (problem) throw new ToolError(problem)
  if (!canApply(aktion, job, today)) {
    if (job.status === 'in-tour') throw new ToolError(`Der Wechsel am ${day(jobDate(job))} steht schon in einer freigegebenen Tour: in der Tourenplanung ändern („Freigabe zurücknehmen“).`)
    throw new ToolError(`Der Wechsel am ${day(jobDate(job))} ist ${DISPLAY[displayStatus(job, today)] || job.status}; ändern lassen sich nur offene.`)
  }
  if (aktion === 'verschieben' && neuer_tag === jobDate(job)) throw new ToolError(`Der Wechsel ist schon am ${day(neuer_tag)}.`)
  const stored = storedJobs().some((j) => j.key === job.key)
  const r = applyJobAction(stored ? jobs : [...jobs, withId(job)], [job.key], aktion, { date: neuer_tag || '', reason: grund || '', today, now: new Date().toISOString(), by: by() })
  return { p, job, stored, changed: r.changed }
}

registerAgentTool({
  name: 'matten_einsatz_aendern',
  label: 'Mattenwechsel-Einsatz geändert',
  modules: ['matten'],
  write: true,
  description: 'Mattenwechsel: einen Einsatz eines Liegeplatzes verschieben (nur dieser Termin, der Rhythmus bleibt) oder aussetzen (Wechsel entfällt, Grund Pflicht) – wie im Matten-Kalender. Ohne Datum: der nächste Wechsel. Einsätze in einer freigegebenen Tour ändert nur die Tourenplanung. Die App fragt vorher selbst nach.',
  input_schema: {
    type: 'object',
    properties: { liegeplatz: PLACE, aktion: { type: 'string', enum: ['verschieben', 'aussetzen'] }, datum: { ...DATE, description: 'Tag des Wechsels, der sich ändert (ohne: der nächste)' }, neuer_tag: { ...DATE, description: 'beim Verschieben: neuer Tag (ab heute)' }, grund: { type: 'string', description: 'beim Aussetzen Pflicht, z. B. Kunde geschlossen' } },
    required: ['liegeplatz', 'aktion'],
  },
  async summary(input) {
    const { p, job, stored } = await jobChange(input)
    const a = JOB_ACTIONS[input.aktion]
    return {
      title: `Mattenwechsel ${input.aktion === 'verschieben' ? 'verschieben' : 'aussetzen'}`,
      lines: [
        `${placeFull(p)}${p.customer?.name ? ` · ${p.customer.name}` : ''}`,
        `Wechsel am ${day(jobDate(job))}${job.planned && job.planned !== job.due ? ` (Solltermin ${day(job.due)})` : ''}${stored ? '' : ' – noch nicht im Kalender, wird dabei angelegt'}`,
        input.aktion === 'verschieben' ? `Neuer Tag: ${day(input.neuer_tag)}${input.grund ? ` (${input.grund})` : ''}` : `Grund: ${input.grund}`,
        a.hint,
      ],
    }
  },
  async run(input) {
    const { p, job, changed } = await jobChange(input)
    storeJobs(changed)
    const out = changed[0] || job
    return { geaendert: true, liegeplatz: placeLabel(p), objekt: objName(p.objectId), aktion: JOB_ACTIONS[input.aktion].verb, solltermin: job.due, tag: jobDate(out), ...(input.grund ? { grund: input.grund } : {}), in_app: 'Matten-Kalender' }
  },
})

/** Pause am Liegeplatz prüfen und die betroffenen geplanten Einsätze rechnen (applyPauses wie beim Betriebsurlaub). */
async function pauseChange({ liegeplatz, von, bis, grund }) {
  const today = todayISO()
  if (von < today) throw new ToolError('Eine Pause beginnt frühestens heute.')
  if (bis && bis < von) throw new ToolError('Die Pause endet vor ihrem Beginn.')
  const reason = String(grund || '').trim()
  if (!reason) throw new ToolError('Bitte den Grund angeben, z. B. Umbau oder Betriebsurlaub des Kunden.')
  await ensureJobs(today, bis && bis < addDays(today, 366) ? bis : addDays(today, 366))
  const d = doc()
  const p = findPlacement(liegeplatz)
  const clash = (p.pauses || []).find((x) => x?.from && x.from <= (bis || '9999-12-31') && (!x.to || x.to >= von))
  if (clash) throw new ToolError(`${placeFull(p)} hat schon eine Pause ${day(clash.from)} bis ${clash.to ? day(clash.to) : 'auf Weiteres'}${clash.reason ? ` (${clash.reason})` : ''}: im Liegeplatz ändern.`)
  const now = new Date().toISOString()
  const next = { ...p, pauses: [...(p.pauses || []), { from: von, to: bis || '', reason }], updatedAt: now, updatedBy: by() }
  const after = { ...d, placements: d.placements.map((x) => (x.id === p.id ? next : x)) }
  const mine = storedJobs().filter((j) => j.placementId === p.id)
  const changed = applyPauses(mine, { doc: after, from: today, now, by: by() })
  const inPause = (date) => date >= von && (!bis || date <= bis)
  const inTour = mine.filter((j) => j.status === 'in-tour' && inPause(jobDate(j)))
  return { p, next, changed, inTour }
}

registerAgentTool({
  name: 'matten_pause_eintragen',
  label: 'Pause am Liegeplatz eingetragen',
  modules: ['matten'],
  write: true,
  description: 'Mattenwechsel: Pause eines Liegeplatzes eintragen (von, optional bis, Grund), z. B. Umbau oder Urlaub des Kunden. Geplante Wechsel in der Pause werden wie beim Betriebsurlaub ausgesetzt bzw. zum Nachholen eingeplant; Einsätze in einer Tour bleiben. Die App fragt vorher selbst nach.',
  input_schema: { type: 'object', properties: { liegeplatz: PLACE, von: DATE, bis: { ...DATE, description: 'letzter Tag der Pause (ohne: bis auf Weiteres)' }, grund: { type: 'string' } }, required: ['liegeplatz', 'von', 'grund'] },
  async summary(input) {
    const { p, changed, inTour } = await pauseChange(input)
    const effect = (j) => `${day(j.due)} ${j.status === 'ausgesetzt' ? 'entfällt' : `nachholen am ${day(jobDate(j))}`}`
    return {
      title: 'Pause am Liegeplatz eintragen',
      lines: [
        `${placeFull(p)}${p.customer?.name ? ` · ${p.customer.name}` : ''}`,
        `Pause ${day(input.von)} bis ${input.bis ? day(input.bis) : 'auf Weiteres'}: ${String(input.grund).trim()}`,
        changed.length ? `Geplante Wechsel: ${changed.map(effect).join('; ')}` : 'Keine geplanten Wechsel in dieser Zeit.',
        ...(inTour.length ? [`Achtung: ${inTour.map((j) => day(jobDate(j))).join(', ')} steht schon in einer Tour – in der Tourenplanung klären.`] : []),
      ],
    }
  },
  async run(input) {
    const { p, next, changed, inTour } = await pauseChange(input)
    const d = doc()
    d.placements = d.placements.map((x) => (x.id === p.id ? next : x))
    storeJobs(changed)
    persist()
    return { eingetragen: true, liegeplatz: placeLabel(p), objekt: objName(p.objectId), von: input.von, bis: input.bis || 'auf Weiteres', grund: String(input.grund).trim(), geplante_wechsel_angepasst: changed.length, ...(inTour.length ? { in_tour: inTour.map((j) => jobDate(j)) } : {}), in_app: 'Matten-Liegeplätze' }
  },
})
