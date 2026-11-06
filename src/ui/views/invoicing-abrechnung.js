// Fakturierung: „Winterdienst abrechnen“ (Entwürfe je Objekt und Monat aus dem Winterdienst-Protokoll, Preise je
// Einsatz oder als Pauschale) und „Aus Leistungsnachweis“ nach Ist-Zeiten aus der Zeiterfassung (Grundlage Plan oder
// Ist). Dazu die Beilage zur Rechnung – Winterdienst-Nachweis bzw. Einsatzliste – zum Herunterladen und als Anhang der
// E-Mail (Einzel- und Sammelversand). Rechenkern: core/fak-abrechnung.js; PDF: export/winter-pdf.js und
// export/abrechnung-pdf.js. Geladen mit invoicing.js; Entwurf und Kunde kommen von dort (abrechnungHooks, auch für den
// Rechnungsentwurf aus einem Regiebericht, views/regie.js, und aus den Prüfungen der Anlagen, views/anlagen.js).
// Beilage zum Regiebericht: export/regie-pdf.js aus den beim Erstellen eingefrorenen Angaben (source.beilage), damit
// die Buchhaltung sie ohne Zugriff auf regie/ senden kann. Dazu der Reiter „Winterdienst“ im Kundenblatt (Preise je
// Objekt, customers[].winterPrices) und die Wintersaison in den Einstellungen (settings.winterSeason).

import { formatDate, lastOfMonth, todayISO } from '../../core/dates.js'
import {
  activeBilling,
  billedBySource,
  cleanWinterPrices,
  freezeIst,
  freezeWinter,
  frozenLog,
  istFor,
  istRowsFor,
  kindSummary,
  linesFromIst,
  PRICE_LABELS,
  priceInput,
  ROUND_STEPS,
  roundStep,
  SEASON_MONTHS,
  seasonBilled,
  seasonPeriodText,
  seasonSettings,
  seasonText,
  WINTER_KINDS,
  WINTER_MODES,
  winterBill,
  winterEntries,
  winterKey,
  winterObjectIds,
  winterPriceInputs,
  winterPrices,
  winterPricesEmpty,
  winterRecurring,
  winterSeason,
} from '../../core/fak-abrechnung.js'
import { customerForObject, customerName, deDate, monthLabel, parseNumber, round2, settingsOf } from '../../core/invoicing.js'
import { objectsWithWork, proofFor } from '../../core/proof.js'
import { freezeRegie, namesOf as regieNames } from '../../core/regie.js'
import { absMinutes } from '../../core/timeclock.js'
import { logKey, workText } from '../../core/winterlog.js'
import { istListDocument, istListPdfName } from '../../export/abrechnung-pdf.js'
import { regieDocument, regiePdfName } from '../../export/regie-pdf.js'
import { winterLogDocument, winterLogPdfName } from '../../export/winter-pdf.js'
import { app, closeModal, computeRange, confirmStep, ensureRange, openModal, persist, registerActions, registerModal, renderModal, renderNow, toast } from '../context.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checked, download, esc, euro, ICON, modalFrame, options, uid, val } from '../shared.js'

const MODULE = 'fakturierung'
/** Aus invoicing.js (dort gesetzt): neuer Entwurf und Kunde in den Entwurf. */
export const abrechnungHooks = { newDraft: null, applyCustomer: null }

const F = () => app.data.fakturierung
const S = () => settingsOf(F())
/** Wintersaison laut Einstellungen (Vorgabe Juli bis Juni). */
const SEASON = () => seasonSettings(F()?.settings)
const sees = (m) => !app.access || app.access.sees(m)
const objOf = (id) => (app.data.objects || []).find((o) => o.id === id)
const docOf = (id) => F().documents.find((d) => d.id === id)
const money = (n) => euro(round2(n))
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const hoursText = (min) => String(round2(min / 60)).replace('.', ',')
const numText = (v) => (v === '' || v === null || v === undefined ? '' : String(v).replace('.', ','))
const prevMonth = () => {
  const t = todayISO()
  const d = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 2, 1))
  return d.toISOString().slice(0, 7)
}
const monthEnd = (ym) => lastOfMonth(`${ym}-01`)
/** Namen in Beilagen wie beim Leistungsnachweis eingestellt (Standard: keine). */
const proofNames = () => ({ names: 'keine', ...(app.data.nachweise?.settings || {}) }).names
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'de')
const billedPills = (list) =>
  list
    .map((b) => (b.state === 'storniert' ? `<span class="pill">storniert: ${esc(b.doc.number)}</span>` : b.state === 'entwurf' ? '<span class="pill warning">Entwurf vorhanden</span>' : `<span class="pill warning">schon abgerechnet: ${esc(b.doc.number)}</span>`))
    .join(' ')
const seg = (action, value, list, data = {}, label = '') =>
  `<div class="seg" role="radiogroup"${label ? ` aria-label="${esc(label)}"` : ''}>${list.map(([k, text]) => `<button type="button" class="btn small ${value === k ? 'primary' : ''}" role="radio" aria-checked="${value === k}" data-action="${action}" data-v="${k}" ${Object.entries(data).map(([a, b]) => `data-${a}="${esc(b)}"`).join(' ')}>${esc(text)}</button>`).join('')}</div>`

// ---------------------------------------------------------------- Winterdienst abrechnen

/** Objekte mit Protokoll im Monat: Einsätze, Preise, Positionen, Abrechnungsstand. */
function winterRows(month, m) {
  const d = F()
  const log = app.data.winterlog || {}
  const objectsById = new Map((app.data.objects || []).map((o) => [o.id, o]))
  const vat = S().vat
  return [...winterObjectIds(log, month)]
    .map((id) => objectsById.get(id) || { id, name: Object.values(log).find((e) => e.objectId === id)?.object || id })
    .sort(byName)
    .map((o) => {
      const customer = customerForObject(d, o.id)
      const entries = winterEntries(log, { objectId: o.id, month, objectsById })
      const prices = m.prices?.[o.id] || winterPrices(customer, o.id, d.articles)
      const seasonDoc = prices.mode === 'saison' ? seasonBilled(d.documents, o.id, month, SEASON()) : null
      const bill = winterBill({ entries, prices, objectName: o.name, month, vat, newId: () => uid('l'), seasonDoc, season: SEASON() })
      const billed = billedBySource(d.documents, winterKey(o.id, month))
      return { object: o, customer, entries, prices, seasonDoc, bill, billed, active: activeBilling(billed), rec: winterRecurring(d.recurring, o.id) }
    })
}
const billable = (r) => r.bill.lines.some((l) => !l.type)
const preselected = (r) => billable(r) && !r.active.length && !r.rec

/** Preis in Kurzform: je Einsatz die Arten, die vorkommen oder einen Preis haben; sonst die Pauschale. */
const priceLine = (p, entries = []) =>
  p.mode === 'einsatz'
    ? ['beides', 'raeumen', 'streuen', 'kontrolle']
        .filter((k) => p[k] || (k !== 'kontrolle' && entries.some((e) => e.kind === k)))
        .map((k) => `${WINTER_KINDS[k]} ${p[k] ? money(p[k]) : '–'}`)
        .join(' · ')
    : `${WINTER_MODES[p.mode]} ${p.pauschale ? money(p.pauschale) : '–'}`

/** „Winter 2026/27 (Leistungszeitraum 1.7.2026–30.6.2027)“ */
const seasonLabel = (month) => {
  const ss = winterSeason(month, SEASON())
  return `${ss.label} (${seasonPeriodText(ss)})`
}

function priceForm(r, i) {
  const p = r.prices
  const field = (k, label) => `<label class="field"><span>${label}</span><input type="text" inputmode="decimal" id="fw-${i}-${k}" value="${esc(numText(p[k]))}" placeholder="€ netto" data-change="fab-winter-price" data-i="${i}" data-obj="${esc(r.object.id)}"></label>`
  return `<div class="fab-prices"><p><strong>Preis für dieses Objekt</strong></p>
    ${seg('fab-winter-mode', p.mode, Object.entries(WINTER_MODES), { i, obj: r.object.id }, `Preis ${r.object.name}`)}
    <div class="form-grid">${
      p.mode === 'einsatz'
        ? `${field('beides', 'Räumen und Streuen (je Einsatz)')}${field('raeumen', 'Räumen (je Einsatz)')}${field('streuen', 'Streuen (je Einsatz)')}${field('kontrolle', 'Kontrolle ohne Einsatz (leer: nicht verrechnen)')}`
        : field('pauschale', p.mode === 'saison' ? `Pauschale ${seasonLabel(app.ui.modal?.month || todayISO().slice(0, 7))}` : 'Pauschale je Monat')
    }</div>
    <p class="muted">${r.customer ? `Wird beim Kunden ${esc(customerName(r.customer))} für dieses Objekt gespeichert.` : 'Ohne Kunde beim Objekt gilt der Preis nur für diesen Entwurf.'}${p.own ? '' : ' Vorbelegt aus den Artikeln „Winterdienst …“, falls vorhanden.'}</p></div>`
}

function winterModal(c, m) {
  const month = m.month || prevMonth()
  m.month = month
  const rows = winterRows(month, m)
  m.sel ||= {}
  const isSel = (r) => (billable(r) ? (m.sel[r.object.id] ?? preselected(r)) : false)
  const dupKey = app.ui.confirm?.startsWith('fab-wdup:') ? app.ui.confirm : ''
  const body = rows
    .map((r, i) => {
      const o = r.object
      const pills = [
        billedPills(r.billed),
        r.seasonDoc && !billable(r) ? `<span class="pill ok">Saisonpauschale verrechnet${r.seasonDoc.number ? `: ${esc(r.seasonDoc.number)}` : ' (Entwurf)'}</span>` : '',
        r.rec ? `<span class="pill info" title="${esc(r.rec.title || '')}">Dauerauftrag Winterdienst</span>` : '',
        r.bill.missing.length ? `<span class="pill warning">Preis fehlt: ${esc(r.bill.missing.map((k) => (k === 'pauschale' ? 'Pauschale' : WINTER_KINDS[k])).join(', '))}</span>` : '',
      ].filter(Boolean)
      const list = r.entries
        .map((e) => `<tr><td>${esc(formatDate(e.date))}</td><td>${esc(e.time)}</td><td>${esc(WINTER_KINDS[e.kind])}</td><td>${esc(workText(e))}</td><td>${esc(e.person || '')}</td><td>${esc(e.notiz || '')}</td></tr>`)
        .join('')
      return `<tr><td><label class="check"><input type="checkbox" name="fwo" value="${esc(o.id)}" data-change="fab-winter-pick" ${isSel(r) ? 'checked' : ''} ${billable(r) ? '' : 'disabled'}><span><strong>${esc(o.name)}</strong></span></label></td>
        <td>${esc((r.customer && customerName(r.customer)) || '–')}</td><td class="num">${r.entries.length}<br><span class="muted">${esc(kindSummary(r.entries))}</span></td>
        <td>${esc(priceLine(r.prices, r.entries))}</td><td class="num">${billable(r) ? money(r.bill.net) : '–'}</td><td>${pills.join(' ')}</td></tr>
        <tr class="fab-detail"><td colspan="6"><details ${m.open === o.id ? 'open' : ''}><summary>Einsätze prüfen und Preis</summary>
          <div class="table-wrap"><table class="data"><thead><tr><th>Tag</th><th>Uhrzeit</th><th>zählt als</th><th>Tätigkeit</th><th>Person</th><th>Notiz</th></tr></thead><tbody>${list}</tbody></table></div>
          ${priceForm(r, i)}</details></td></tr>`
    })
    .join('')
  const dup = rows.filter((r) => isSel(r) && r.active.length)
  return modalFrame({
    title: 'Winterdienst abrechnen',
    subtitle: monthLabel(month),
    wide: true,
    body: `<div class="filters"><label class="field inline"><span>Monat</span><input type="month" id="fw-month" value="${month}" data-change="fab-winter-month"></label></div>
      ${rows.length ? `<div class="table-wrap"><table class="data fab-winter"><thead><tr><th>Objekt</th><th>Kunde</th><th class="num">Einsätze</th><th>Preis</th><th class="num">netto</th><th></th></tr></thead><tbody>${body}</tbody></table></div>` : '<p class="empty">Kein Winterdienst-Protokoll in diesem Monat.</p>'}
      ${dupKey && dup.length ? `<div class="banner warn-banner"><p><strong>Schon abgerechnet:</strong> ${esc(dup.map((r) => `${r.object.name} (${r.active.map((b) => b.doc.number || 'Entwurf').join(', ')})`).join('; '))}. Ein weiterer Entwurf verrechnet den Monat doppelt.</p></div>` : ''}
      <p class="note">Je Objekt ein Rechnungsentwurf. Jeder Eintrag im Protokoll zählt als ein Einsatz: Räumen, Streuen oder Räumen und Streuen; reine Kontrollgänge nur mit eigenem Preis. Bei einer Pauschale stehen die Einsätze als Text auf der Rechnung. Den Entwurf kannst du danach noch ändern; beim Versand hängt der Winterdienst-Nachweis an.</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary ${dupKey ? 'confirm' : ''}" data-action="fab-winter-create" data-month="${month}" ${rows.some(billable) ? '' : 'disabled'}>${dupKey ? 'Trotzdem erstellen?' : 'Entwürfe erstellen'}</button></div>`,
  })
}
registerModal('fab-winter', winterModal, { module: MODULE })

/** Preis-Eingaben eines Objekts lesen (fehlende Felder behalten ihren Wert). */
function readPrices(m, i, objectId, mode) {
  const r = winterRows(m.month, m).find((x) => x.object.id === objectId)
  if (!r) return
  const prev = r.prices
  const read = (k) => {
    if (!document.getElementById(`fw-${i}-${k}`)) return prev[k]
    const x = priceInput(val(`fw-${i}-${k}`))
    if (x.error) toast(`${PRICE_LABELS[k]}: ${x.error}`)
    return x.error ? prev[k] : x.value
  }
  m.prices ||= {}
  m.prices[objectId] = { ...cleanWinterPrices({ ...prev, mode: mode || prev.mode, ...Object.fromEntries(['beides', 'raeumen', 'streuen', 'kontrolle', 'pauschale'].map((k) => [k, read(k)])) }), own: prev.own, edited: true }
  m.open = objectId
}

// ---------------------------------------------------------------- Kundenblatt: Winterdienst je Objekt

const PRICE_KEYS = ['beides', 'raeumen', 'streuen', 'kontrolle', 'pauschale']
const objName = (id) => objOf(id)?.name || 'Objekt'

/** Eingaben des Reiters je Objekt (Text, wie getippt), beim ersten Zeichnen aus den gespeicherten Preisen. */
function winterInputs(m, v) {
  m.winterRaw ||= {}
  for (const id of v.objectIds || []) {
    if (m.winterRaw[id]) continue
    const own = v.winterPrices?.[id]
    m.winterRaw[id] = { mode: own?.mode && WINTER_MODES[own.mode] ? own.mode : 'einsatz', ...Object.fromEntries(PRICE_KEYS.map((k) => [k, numText(own?.[k] ?? '')])) }
  }
  return m.winterRaw
}

const winterProblems = (m) => (m.winterErrors?.length ? `<ul class="fak-problems" role="alert">${m.winterErrors.map((e) => `<li class="err-text">${esc(e.text)}</li>`).join('')}</ul>` : '')

/** Reiter „Winterdienst“ im Kundenblatt: je Objekt des Kunden Abrechnungsart und Preise netto. */
export function customerWinterTab(v, x, dis) {
  const m = app.ui.modal
  const raw = winterInputs(m, v)
  const ids = v.objectIds || []
  const bad = new Set((m.winterErrors || []).map((e) => `${e.objectId}:${e.field}`))
  const ss = winterSeason(todayISO().slice(0, 7), SEASON())
  const blocks = ids
    .map((id, i) => {
      const r = raw[id]
      const art = winterPrices(null, id, F().articles)
      const field = (k, label) =>
        `<label class="field"><span>${label}</span><input type="text" inputmode="decimal" id="fcw-${i}-${k}" value="${esc(r[k] ?? '')}" placeholder="${art[k] ? `Artikel: ${esc(numText(art[k]))}` : '€ netto'}" autocomplete="off" data-change="fab-cust-winter-check" ${bad.has(`${id}:${k}`) ? 'aria-invalid="true"' : ''} ${dis}></label>`
      return `<fieldset class="fab-cw"><legend>${esc(objName(id))}</legend><div class="form-grid">
          <label class="field"><span>Abrechnungsart</span><select id="fcw-${i}-mode" data-change="fab-cust-winter" ${dis}>${options(Object.entries(WINTER_MODES), r.mode)}</select></label>
          ${
            r.mode === 'einsatz'
              ? `${field('beides', 'Räumen und Streuen (je Einsatz)')}${field('raeumen', 'Räumen (je Einsatz)')}${field('streuen', 'Streuen (je Einsatz)')}${field('kontrolle', 'Kontrolle ohne Einsatz (leer: nicht verrechnen)')}`
              : field('pauschale', r.mode === 'saison' ? 'Pauschale je Saison' : 'Pauschale je Monat')
          }</div></fieldset>`
    })
    .join('')
  return `<h3>Winterdienst je Objekt</h3>
    <p class="muted">Preise netto für „Winterdienst abrechnen“ (Fakturierung → Rechnungen). Leer gelassen gelten die Artikel „Winterdienst …“, falls vorhanden. Beträge mit Komma, z. B. 65,50.</p>
    <div id="fcw-problems" aria-live="polite">${winterProblems(m)}</div>
    ${ids.length ? blocks : '<p class="empty">Diesem Kunden ist noch kein Objekt zugeordnet (Stammdaten → Objekte dieses Kunden).</p>'}
    <p class="note">Je Einsatz: jeder Eintrag im Winterdienst-Protokoll zählt als ein Einsatz. Pauschale je Saison: einmal je Saison (${esc(seasonText(SEASON()))}, einstellbar unter Einstellungen); auf der Rechnung steht der Leistungszeitraum, derzeit ${esc(seasonPeriodText(ss).replace('Leistungszeitraum ', ''))}.</p>`
}

/**
 * Felder des Reiters in den Entwurf des Kunden (customer.winterPrices je Objekt). Fehler (negativ, keine Zahl) stehen in
 * m.winterErrors, die Eingaben bleiben wie getippt (m.winterRaw); ganz leer: keine eigenen Preise.
 */
export function readCustomerWinter(m) {
  const v = m?.draft
  if (!v || !document.getElementById('fcw-0-mode')) return v
  const raw = winterInputs(m, v)
  const errors = []
  const prices = { ...(v.winterPrices || {}) }
  ;(v.objectIds || []).forEach((id, i) => {
    if (!document.getElementById(`fcw-${i}-mode`)) return
    const r = raw[id]
    r.mode = WINTER_MODES[val(`fcw-${i}-mode`)] ? val(`fcw-${i}-mode`) : 'einsatz'
    for (const k of PRICE_KEYS) if (document.getElementById(`fcw-${i}-${k}`)) r[k] = val(`fcw-${i}-${k}`).trim()
    const res = winterPriceInputs(r)
    for (const e of res.errors) errors.push({ objectId: id, field: e.field, i, text: `${objName(id)}, ${e.text}` })
    if (winterPricesEmpty(res.prices)) delete prices[id]
    else prices[id] = res.prices
  })
  m.winterErrors = errors
  if (Object.keys(prices).length) v.winterPrices = prices
  else delete v.winterPrices
  return v
}

// ---------------------------------------------------------------- Einstellungen: Wintersaison

/** Felder „Wintersaison“ im Reiter Einstellungen der Fakturierung. */
export function winterSettingsHtml(s, dis) {
  const season = seasonSettings(s)
  const ss = winterSeason(todayISO().slice(0, 7), season)
  return `<h3>Winterdienst</h3>
    <div class="form-grid">
      <label class="field"><span>Wintersaison von (Monat)</span><select id="fs-winter-start" ${dis}>${options(SEASON_MONTHS, String(season.start))}</select></label>
      <label class="field"><span>bis (Monat)</span><select id="fs-winter-end" ${dis}>${options(SEASON_MONTHS, String(season.end))}</select></label>
    </div>
    <p class="muted">Gilt für die Saisonpauschale im Winterdienst: einmal je Saison verrechnet, auf der Rechnung mit Leistungszeitraum (jetzt: ${esc(seasonPeriodText(ss).replace('Leistungszeitraum ', ''))}). Vorgabe Juli bis Juni.</p>`
}

/** Einstellung aus den Feldern (für fak-settings-save). */
export function readWinterSettings() {
  if (!document.getElementById('fs-winter-start')) return {}
  return { winterSeason: seasonSettings({ winterSeason: { start: val('fs-winter-start'), end: val('fs-winter-end') } }) }
}

// ---------------------------------------------------------------- Ist-Zeiten (Leistungsnachweis mit Grundlage Ist)

/** Objekte mit Einsätzen oder Stempelungen im Monat, mit Ist-Zeiten und Plan zum Vergleich. */
function istList(month, { round, planFallback, names = 'voll' }) {
  const from = `${month}-01`
  const to = monthEnd(month)
  const r = computeRange(from, to)
  const stamps = app.data.stamps || {}
  const ids = objectsWithWork(r.instances, { from, to })
  for (const s of Object.values(stamps)) if (s?.objectId && s.date >= from && s.date <= to) ids.add(s.objectId)
  const d = F()
  const today = todayISO()
  const now = absMinutes(new Date().toISOString())
  return (app.data.objects || [])
    .filter((o) => ids.has(o.id))
    .map((o) => {
      const ist = istFor({ objectId: o.id, from, to, stamps, instances: r.instances, state: r.state, employeesById: r.ctx.employeesById, round, planFallback, today, now, names })
      const proof = proofFor({ objectId: o.id, from, to, instances: r.instances, state: r.state, stamps, employeesById: r.ctx.employeesById, today, now })
      const rec = d.recurring.some((x) => x.objectId === o.id && x.active !== false)
      const billed = billedBySource(d.documents, `nachweis:${o.id}:${month}`)
      const minutes = istRowsFor(ist, { special: rec }).reduce((s, x) => s + x.billed, 0)
      return { object: o, ist, proof, rec, billed, active: activeBilling(billed), customer: customerForObject(d, o.id), minutes }
    })
}

const istOpts = (m) => ({ round: roundStep(m.round ?? F().settings.istRound), planFallback: !!m.plan })
/** Gewählte Objekte merken, bevor der Dialog neu gezeichnet wird (Rundung, Nachfrage); gelten nur für diesen Monat. */
function keepPicks(m) {
  if (!document.querySelector('input[name="fpo"]')) return
  m.picked = { month: m.month, ids: [...document.querySelectorAll('input[name="fpo"]:checked')].map((x) => x.value) }
}

/** Umschalter „Grundlage: Plan | Ist-Zeiten“ im Dialog „Rechnungen aus dem Leistungsnachweis“. */
export const basisSwitch = (m) => `<div class="filters"><span class="muted">Grundlage</span>${seg('fab-proof-basis', m.basis === 'ist' ? 'ist' : 'plan', [['plan', 'Plan'], ['ist', 'Ist-Zeiten (Zeiterfassung)']], {}, 'Grundlage')}</div>`

/** Dialog „Rechnungen aus dem Leistungsnachweis“ mit Grundlage Ist-Zeiten (die Plan-Fassung bleibt in invoicing.js). */
export function istProofModal(c, m) {
  const month = m.month
  const d = F()
  const { round, planFallback } = istOpts(m)
  const list = istList(month, { round, planFallback })
  const dupKey = app.ui.confirm?.startsWith('fab-idup:') ? app.ui.confirm : ''
  const rows = list
    .map(({ object: o, ist, proof, rec, billed, active, customer, minutes }) => {
      const on = minutes > 0 && (m.picked?.month === month ? m.picked.ids.includes(o.id) : !active.length)
      const t = ist.totals
      return `<tr><td><label class="check"><input type="checkbox" name="fpo" value="${esc(o.id)}" ${on ? 'checked' : ''} ${minutes > 0 ? '' : 'disabled'}><span><strong>${esc(o.name)}</strong></span></label></td><td>${esc((customer && customerName(customer)) || '–')}</td>
        <td class="num">${t.ist}${t.plan ? `<br><span class="muted">+ ${t.plan} laut Plan</span>` : ''}</td><td class="num">${hoursText(minutes)}</td><td class="num">${hoursText(proof.totals.planMinutes)}</td>
        <td class="num">${t.problems ? `<span class="pill warning">${t.problems}</span>` : ''}</td>
        <td>${billedPills(billed)} ${rec ? '<span class="pill info">Dauerauftrag: nur Sonderleistungen</span>' : ''}${!t.ist && !t.plan ? ' <span class="pill">keine Zeiterfassung</span>' : ''}</td></tr>`
    })
    .join('')
  const problems = list.flatMap(({ object: o, ist }) => ist.problems.map((p) => ({ ...p, objectName: o.name })))
  const dup = list.filter((x) => x.active.length && x.minutes > 0)
  return modalFrame({
    title: 'Rechnungen aus dem Leistungsnachweis',
    subtitle: monthLabel(month),
    wide: true,
    body: `<div class="filters"><label class="field inline"><span>Monat</span><input type="month" id="fpo-month" value="${month}" data-change="fak-proof-month"></label><label class="field inline"><span>Stundensatz netto (€)</span><input type="text" inputmode="decimal" id="fpo-rate" value="${esc(numText(m.rate ?? d.settings.hourRate ?? ''))}" placeholder="z. B. 32,50" style="width:7rem"></label></div>
      ${basisSwitch(m)}
      <div class="filters"><label class="field inline"><span>Rundung je Stempelung</span><select id="fpo-round" data-change="fab-proof-opts">${options(Object.entries(ROUND_STEPS), String(round))}</select></label>
        <label class="check"><input type="checkbox" id="fpo-plan" data-change="fab-proof-opts" ${planFallback ? 'checked' : ''}><span>Einsätze ohne vollständige Stempelung mit der Planzeit verrechnen</span></label></div>
      ${rows ? `<div class="table-wrap"><table class="data fab-ist"><thead><tr><th>Objekt</th><th>Kunde</th><th class="num">Stempelungen</th><th class="num">Stunden Ist</th><th class="num">Stunden Plan</th><th class="num">nicht gezählt</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Keine Einsätze und keine Stempelungen in diesem Monat.</p>'}
      ${problems.length ? `<h3>Nicht gezählt: bitte prüfen</h3><div class="table-wrap"><table class="data fab-ist-problems"><thead><tr><th>Objekt</th><th>Tag</th><th>Kommen</th><th>Person</th><th>Leistung</th><th>Grund</th></tr></thead><tbody>${problems.map((p) => `<tr><td>${esc(p.objectName)}</td><td>${esc(formatDate(p.date))}</td><td>${esc(p.in)}</td><td>${esc(p.person || '')}</td><td>${esc(p.label)}</td><td>${esc(p.text)}</td></tr>`).join('')}</tbody></table></div><p class="muted">„Gehen“ in der Zeiterfassung nachtragen lassen oder oben die Planzeit wählen. Ohne diese Wahl zählen die Einsätze nicht.</p>` : ''}
      ${dupKey && dup.length ? `<div class="banner warn-banner"><p><strong>Schon abgerechnet:</strong> ${esc(dup.map((x) => `${x.object.name} (${x.active.map((b) => b.doc.number || 'Entwurf').join(', ')})`).join('; '))}. Ein weiterer Entwurf verrechnet den Monat doppelt.</p></div>` : ''}
      <p class="note">Ist-Zeiten: Summe der gestempelten Zeiten je Objekt (Kommen bis Gehen), je Stempelung gerundet auf das nächste Vielfache (ab der Hälfte aufwärts). Stempelungen ohne „Gehen“ zählen nicht. Winterdienst geht über „Winterdienst abrechnen“. Beim Versand hängt die Einsatzliste an (Namen wie beim Leistungsnachweis eingestellt).</p>`,
    foot: `<button class="btn" data-action="close-modal">Abbrechen</button><div class="actions"><button class="btn primary ${dupKey ? 'confirm' : ''}" data-action="fak-proof-create" data-month="${month}">${dupKey ? 'Trotzdem erstellen?' : 'Entwürfe erstellen'}</button></div>`,
  })
}

/** Entwürfe nach Ist-Zeiten (aus „fak-proof-create“, wenn die Grundlage Ist ist). */
export function createIstDrafts(el) {
  const m = app.ui.modal
  const month = el.dataset.month || m.month
  const chosen = new Set([...document.querySelectorAll('input[name="fpo"]:checked')].map((x) => x.value))
  const rate = parseNumber(val('fpo-rate'))
  const d = F()
  const { round, planFallback } = istOpts(m)
  const names = proofNames()
  const list = istList(month, { round, planFallback }).filter((x) => chosen.has(x.object.id))
  const dup = list.filter((x) => x.active.length && x.minutes > 0)
  keepPicks(m)
  if (rate) m.rate = rate
  if (dup.length && !confirmStep(`fab-idup:${month}:${dup.map((x) => x.object.id).join(',')}`, renderModal)) return
  if (rate) d.settings.hourRate = rate
  d.settings.istRound = round
  const created = []
  for (const { object: o, ist, rec, customer: cu, minutes } of list) {
    const lines = linesFromIst({ ist, objectName: o.name, month, rate: Number(cu?.hourRate) || rate, vat: S().vat, newId: () => uid('l'), special: rec })
    if (!lines.length) continue
    const x = abrechnungHooks.newDraft('rechnung', {
      objectId: o.id,
      objectName: o.name,
      serviceFrom: `${month}-01`,
      serviceTo: monthEnd(month),
      title: `${rec ? 'Sonderleistungen' : 'Reinigung'} ${o.name} ${monthLabel(month)}`,
      lines,
      // rows: Kennungen der verrechneten Zeilen (Stempelung bzw. „plan:<Einsatz>“), damit die Einsatzliste zur Rechnung passt
      source: {
        type: 'nachweis',
        key: `nachweis:${o.id}:${month}`,
        objectId: o.id,
        month,
        basis: 'ist',
        round,
        minutes,
        rows: istRowsFor(ist, { special: rec }).map((r) => r.key),
        ...(planFallback ? { plan: true } : {}),
        ...(rec ? { special: true } : {}),
        beilage: freezeIst({ object: o, rows: istRowsFor(ist, { special: rec }), names, round }),
      },
    })
    if (cu) abrechnungHooks.applyCustomer(x, cu.id)
    x.objectId = o.id
    d.documents.push(x)
    created.push(x)
  }
  closeModal()
  if (!created.length) return toast('Nichts übernommen (keine gezählten Zeiten gewählt).')
  app.ui.fakTab = 'rechnungen'
  app.ui.fakState = 'entwurf'
  persist()
  renderNow()
  toast(`${plural(created.length, 'Rechnungsentwurf', 'Rechnungsentwürfe')} nach Ist-Zeiten ${monthLabel(month)}. Preise prüfen und festschreiben.`)
}

// ---------------------------------------------------------------- Beilage zur Rechnung

/** Quelle eines Belegs (auch alte Entwürfe mit nur key: „nachweis:o5:2026-10“). */
function sourceOf(x) {
  const s = x?.source
  if (!s?.key) return null
  const [, objectId = '', month = ''] = String(s.key).split(':')
  return { ...s, objectId: s.objectId || objectId, month: s.month || month }
}

/** Beilage eines Belegs: Winterdienst-Nachweis, Einsatzliste (nur bei Ist-Zeiten) bzw. Regiebericht; sonst null. */
export function beilageOf(x) {
  const s = x?.source?.type === 'regie' ? x.source : sourceOf(x)
  if (s?.type === 'regie' && s.reportId) return { kind: 'regie', label: 'Regiebericht', name: regiePdfName(s.no || s.beilage?.no, s.beilage?.object?.name || objOf(s.objectId)?.name || ''), source: s }
  if (!s?.objectId || !/^\d{4}-\d{2}$/.test(s.month)) return null
  const name = s.beilage?.object?.name || objOf(s.objectId)?.name || ''
  if (s.type === 'winterdienst') return { kind: 'winter', label: 'Winterdienst-Nachweis', name: winterLogPdfName(s.month, name), source: s }
  if (s.type === 'nachweis' && s.basis === 'ist') return { kind: 'ist', label: 'Einsatzliste', name: istListPdfName(name, s.month), source: s }
  return null
}
/** Eingefroren beim Erstellen (source.beilage): ohne Wochen der Planung erzeugbar, z. B. für die Buchhaltung. */
const frozen = (b) => !!b?.source?.beilage && typeof b.source.beilage === 'object'
/** Regiebericht zu einer Beilage, wenn die Rolle die Regieberichte lesen darf (sonst null). */
const regieReport = (b) => (sees('regie') ? (app.data.regie?.reports || []).find((r) => r.id === b.source.reportId && r.status === 'abgeschlossen') || null : null)
/**
 * Beilage erzeugbar? Eingefroren immer; ältere Belege brauchen die Wochen der Planung (Protokoll bzw. Zeiterfassung),
 * ein Regiebericht ohne eingefrorene Angaben das Recht auf die Regieberichte.
 */
const beilageReady = (x) => {
  const b = beilageOf(x)
  if (!b) return false
  if (frozen(b)) return true
  return b.kind === 'regie' ? !!regieReport(b) : sees('planung')
}

/**
 * Beilage als PDF: aus den beim Erstellen eingefrorenen Angaben (Objekt, Namen-Einstellung, Einträge bzw. Zeilen);
 * ältere Belege ohne diese Angaben aus dem aktuellen Protokoll bzw. der Zeiterfassung (Namen wie jetzt eingestellt).
 */
export async function beilageBlob(x) {
  const b = beilageOf(x)
  if (!b) return null
  if (b.kind === 'regie') {
    const r = frozen(b) ? null : regieReport(b)
    const fz = frozen(b) ? b.source.beilage : r ? freezeRegie(r, { object: objOf(r.objectId) || {}, names: regieNames(app.data.regie) }) : null
    if (!fz) return null
    return pdfBlob(regieDocument({ report: fz, invoiceNumber: x.number || '', brand: app.config.brand || {}, logo: await loadLogo().catch(() => null) }))
  }
  const { objectId, month } = b.source
  if (frozen(b)) {
    const fz = b.source.beilage
    const brand = app.config.brand || {}
    const logo = await loadLogo().catch(() => null)
    if (b.kind === 'winter') return pdfBlob(winterLogDocument({ month, log: frozenLog(fz), objects: [{ id: objectId, ...fz.object }], objectId, names: fz.names, brand, logo }))
    return pdfBlob(istListDocument({ object: fz.object, monthLabel: monthLabel(month), rows: fz.rows || [], round: roundStep(fz.round ?? b.source.round), names: fz.names, invoiceNumber: x.number || '', brand, logo }))
  }
  const from = `${month}-01`
  const to = monthEnd(month)
  await ensureRange(from, to).catch(() => {})
  const names = proofNames()
  const brand = app.config.brand || {}
  const logo = await loadLogo().catch(() => null)
  // nur die verrechneten Einträge bzw. Zeilen (später Nachgetragenes gehört nicht zu dieser Rechnung)
  const keep = (list) => (k) => !Array.isArray(list) || list.includes(k)
  if (b.kind === 'winter') {
    const log = Object.fromEntries(Object.entries(app.data.winterlog || {}).filter(([k]) => keep(b.source.entries)(k)))
    return pdfBlob(winterLogDocument({ month, log, objects: app.data.objects || [], objectId, names, brand, logo }))
  }
  const r = computeRange(from, to)
  const ist = istFor({ objectId, from, to, stamps: app.data.stamps || {}, instances: r.instances, state: r.state, employeesById: r.ctx.employeesById, round: b.source.round, planFallback: !!b.source.plan, today: todayISO(), now: absMinutes(new Date().toISOString()), names })
  return pdfBlob(istListDocument({ object: objOf(objectId) || {}, monthLabel: monthLabel(month), rows: istRowsFor(ist, { special: !!b.source.special }).filter((r) => keep(b.source.rows)(r.key)), round: ist.round, names, invoiceNumber: x.number || '', brand, logo }))
}

/** Anhänge für die E-Mail: [{ name, blob, type }] (leer ohne Beilage oder ohne Zugriff auf die Planung). */
export async function beilageFiles(x) {
  if (!beilageReady(x)) return []
  const b = beilageOf(x)
  return [{ name: b.name, blob: await beilageBlob(x), type: 'application/pdf' }]
}
/** Dateiname der Ablage neben der Rechnung (archivePath): fakturierung/belege/2026/RE-2026-0005_Winterdienst-Protokoll_….pdf */
export const beilageArchiveName = (x, name) => `${x.number || 'Entwurf'}_${name}`

/** Knopf neben „PDF“ im Beleg (Entwurf und festgeschrieben). */
export const beilageButton = (x) => (beilageReady(x) ? `<button class="btn" data-action="fab-beilage" data-id="${esc(x.id)}" title="${esc(beilageOf(x).name)}">${ICON.download} ${esc(beilageOf(x).label)}</button>` : '')

/** Häkchen im Dialog „senden“. */
export function beilageOption(x) {
  const b = beilageOf(x)
  if (!b) return ''
  if (!beilageReady(x)) return `<p class="muted wide">Beilage ${esc(b.label)}: braucht bei diesem älteren Beleg Zugriff auf ${b.kind === 'regie' ? 'die Regieberichte' : 'die Planung'}, hängt hier nicht an.</p>`
  return `<label class="check wide"><input type="checkbox" id="fm-beilage" checked><span>Beilage anhängen: ${esc(b.label)} (${esc(b.name)})</span></label>`
}
export const beilageWanted = (x) => beilageReady(x) && checked('fm-beilage')

/** Herkunft im Beleg: „aus dem Winterdienst-Protokoll“, „nach Ist-Zeiten“ … */
export function sourceNote(x) {
  if (x?.source?.type === 'regie') {
    const s = x.source
    const o = objOf(s.objectId)
    return `<p class="fak-doc-head">Aus dem Regiebericht ${esc(s.no || '')}${s.date ? ` vom ${esc(deDate(s.date))}` : ''}${o || s.beilage?.object?.name ? ` · ${esc(o?.name || s.beilage.object.name)}` : ''}${s.beilage?.signature ? ` · unterschrieben von ${esc(s.beilage.signature.name)}` : ''}</p>`
  }
  const s = sourceOf(x)
  if (!s || !['winterdienst', 'nachweis'].includes(s.type) || !/^\d{4}-\d{2}$/.test(s.month)) return ''
  const o = objOf(s.objectId)
  if (s.type === 'winterdienst') return `<p class="fak-doc-head">Aus dem Winterdienst-Protokoll ${esc(monthLabel(s.month))}${o ? ` · ${esc(o.name)}` : ''}${s.entries ? ` · ${plural(s.entries.length, 'Einsatz', 'Einsätze')}` : ''}${s.mode ? ` · ${esc(WINTER_MODES[s.mode] || '')}` : ''}</p>`
  if (s.basis === 'ist') return `<p class="fak-doc-head">Nach Ist-Zeiten (Zeiterfassung) ${esc(monthLabel(s.month))}${s.minutes ? ` · ${hoursText(s.minutes)} Std.` : ''} · ${esc(ROUND_STEPS[roundStep(s.round)])} gerundet${s.plan ? ' · ohne vollständige Stempelung laut Plan' : ''}</p>`
  return ''
}

/** Untertitel im Entwurf: woher er kommt. */
export function sourceLabel(x) {
  const t = x.source?.type
  return t === 'dauerauftrag' ? 'aus Dauerauftrag' : t === 'winterdienst' ? 'aus dem Winterdienst-Protokoll' : t === 'nachweis' ? (x.source.basis === 'ist' ? 'aus Leistungsnachweis, Ist-Zeiten' : 'aus Leistungsnachweis') : t === 'regie' ? `aus Regiebericht ${esc(x.source.no || '')}`.trim() : ''
}

// ---------------------------------------------------------------- Aktionen

registerActions({
  // Kundenblatt, Reiter „Winterdienst“: Abrechnungsart gewechselt (andere Felder) bzw. Betrag prüfen
  'fab-cust-winter': () => {
    const m = app.ui.modal
    if (m?.type !== 'fak-cust') return
    readCustomerWinter(m)
    renderModal()
  },
  'fab-cust-winter-check': () => {
    const m = app.ui.modal
    if (m?.type !== 'fak-cust') return
    readCustomerWinter(m)
    const box = document.getElementById('fcw-problems')
    if (box) box.innerHTML = winterProblems(m)
    const bad = new Set((m.winterErrors || []).map((e) => `fcw-${e.i}-${e.field}`))
    for (const el of document.querySelectorAll('.fab-cw input[id^="fcw-"]')) {
      if (bad.has(el.id)) el.setAttribute('aria-invalid', 'true')
      else el.removeAttribute('aria-invalid')
    }
  },
  'fab-beilage': async (el) => {
    const m = app.ui.modal
    const x = m?.draft?.id === el.dataset.id ? m.draft : docOf(el.dataset.id)
    const b = beilageOf(x)
    if (!b) return
    el.disabled = true
    try {
      download(b.name, await beilageBlob(x))
    } catch (err) {
      toast(`${b.label} nicht erstellt: ${err.message || err}`)
    } finally {
      el.disabled = false
    }
  },
})

registerActions(
  {
    'fab-winter-open': async () => {
      const month = prevMonth()
      await ensureRange(`${month}-01`, monthEnd(month)).catch(() => {})
      openModal({ type: 'fab-winter', month })
    },
    'fab-winter-month': async () => {
      const m = app.ui.modal
      const month = val('fw-month')
      if (!/^\d{4}-\d{2}$/.test(month)) return
      Object.assign(m, { month, sel: {}, prices: {}, open: '' })
      app.ui.confirm = null
      await ensureRange(`${month}-01`, monthEnd(month)).catch(() => {})
      renderModal()
    },
    'fab-winter-pick': (el) => {
      const m = app.ui.modal
      m.sel ||= {}
      m.sel[el.value] = el.checked
      if (!app.ui.confirm) return
      app.ui.confirm = null
      renderModal()
    },
    'fab-winter-price': (el) => {
      readPrices(app.ui.modal, el.dataset.i, el.dataset.obj)
      renderModal()
    },
    'fab-winter-mode': (el) => {
      readPrices(app.ui.modal, el.dataset.i, el.dataset.obj, el.dataset.v)
      renderModal()
    },
    'fab-winter-create': (el) => {
      const m = app.ui.modal
      const month = el.dataset.month || m.month
      const d = F()
      const chosen = new Set([...document.querySelectorAll('input[name="fwo"]:checked')].map((x) => x.value))
      const rows = winterRows(month, m)
      const list = rows.filter((r) => chosen.has(r.object.id) && billable(r))
      if (!list.length) return toast('Bitte mindestens ein Objekt wählen.')
      const dup = list.filter((r) => r.active.length)
      if (dup.length && !confirmStep(`fab-wdup:${month}:${dup.map((r) => r.object.id).join(',')}`, renderModal)) return
      // geänderte Preise beim Kunden merken (je Objekt)
      for (const r of rows) {
        if (!m.prices?.[r.object.id]?.edited || !r.customer) continue
        r.customer.winterPrices = { ...(r.customer.winterPrices || {}), [r.object.id]: cleanWinterPrices(m.prices[r.object.id]) }
      }
      const created = []
      for (const r of list) {
        const o = r.object
        // Saisonpauschale: Leistungszeitraum der ganzen Saison (§ 11 UStG), sonst der Monat
        const period = r.bill.period || { from: `${month}-01`, to: monthEnd(month) }
        const x = abrechnungHooks.newDraft('rechnung', {
          objectId: o.id,
          objectName: o.name,
          serviceFrom: period.from,
          serviceTo: period.to,
          title: `Winterdienst ${o.name} ${r.bill.period ? winterSeason(month, SEASON()).label : monthLabel(month)}`,
          lines: r.bill.lines,
          source: {
            type: 'winterdienst',
            key: winterKey(o.id, month),
            objectId: o.id,
            month,
            mode: r.prices.mode,
            ...(r.prices.mode === 'saison' ? { season: winterSeason(month, SEASON()).key } : {}),
            entries: r.entries.map(logKey),
            beilage: freezeWinter({ object: o, entries: r.entries, names: proofNames() }),
          },
        })
        if (r.customer) abrechnungHooks.applyCustomer(x, r.customer.id)
        x.objectId = o.id
        d.documents.push(x)
        created.push(x)
      }
      closeModal()
      app.ui.fakTab = 'rechnungen'
      app.ui.fakState = 'entwurf'
      persist()
      renderNow()
      toast(`${plural(created.length, 'Rechnungsentwurf', 'Rechnungsentwürfe')} für den Winterdienst ${monthLabel(month)}. Bitte prüfen und festschreiben.`)
    },
    'fab-proof-basis': (el) => {
      const m = app.ui.modal
      if (document.getElementById('fpo-rate')) m.rate = parseNumber(val('fpo-rate')) || ''
      m.basis = el.dataset.v === 'ist' ? 'ist' : 'plan'
      m.picked = null
      app.ui.confirm = null
      renderModal()
    },
    'fab-proof-opts': () => {
      const m = app.ui.modal
      if (document.getElementById('fpo-rate')) m.rate = parseNumber(val('fpo-rate')) || ''
      keepPicks(m)
      m.round = roundStep(val('fpo-round'))
      m.plan = checked('fpo-plan')
      app.ui.confirm = null
      renderModal()
    },
  },
  { edit: MODULE },
)

