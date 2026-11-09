// Objektkalkulation (Auswertung): Flächen je Objekt mit Art, m², Häufigkeit und Leistungswert;
// Stunden im Monat, Verrechnungssatz über Zuschläge, Monatspreis; Vergleich mit Budget und
// Reinigungsplan; „Als Budget übernehmen“; PDF-Angebot für den Kunden und internes Kalkulationsblatt.
// Datei kalkulation/kalkulation.json (nur Auswertung & Lohn), weil sie Löhne und Margen enthält.
// Reiter „Nachkalkulation“: kalkulierte gegen geplante und gestempelte Stunden je Objekt, Vorschlag für die
// Leistungswerte je Raumart aus den Ist-Zeiten (core/nachkalkulation.js), übernommen nur nach Bestätigung.
// Vertrieb: Fälle ohne Objekt stehen unter cases[Fall] (Auswahl „vt:<Fall>“); Speichern schreibt Preis und Stunden
// zurück in den Fall (core/vertrieb.js → applyCalc). Wird aus dem Fall ein Objekt, kommen die Flächen dorthin.

import { AREA_TYPES, CALC_DEFAULTS, calcWage, calculate, FREQUENCIES } from '../../core/calculation.js'
import { applyCalc, calcSummary } from '../../core/vertrieb.js'
import { nachkalkulation, NK_MIN_STAMPED, suggestPerformance } from '../../core/nachkalkulation.js'
import { hoursByObject, rentSpan } from '../../core/rentabilitaet.js'
import { lastOfMonth, todayISO } from '../../core/dates.js'
import { objectControlling } from '../../core/reports.js'
import { mergeRules } from '../../core/rules.js'
import { calcDocument, calcPdfName, offerDocument } from '../../export/calc-pdf.js'
import { app, canEdit, closeModal, computeRange, memo, openModal, persist, registerActions, registerModal, registerView, render, renderNow, toast } from '../context.js'
import { loadLogo, pdfBlob } from '../pdf.js'
import { checkedValues, download, esc, ICON, menu, modalFrame, options, tabBar, uid, val } from '../shared.js'

const MODULE = 'auswertung'
const doc = () => (app.data.kalkulation ||= { settings: {}, objects: {} })
const settings = () => ({ ...CALC_DEFAULTS, ...(doc().settings || {}), performance: { ...CALC_DEFAULTS.performance, ...(doc().settings?.performance || {}) } })
/** Fall aus dem Vertrieb (noch ohne Objekt): Auswahl „vt:<Fall>“, Flächen unter cases[Fall]. */
const caseKey = (id) => (String(id || '').startsWith('vt:') ? String(id).slice(3) : '')
const caseCalc = (id) => doc().cases?.[caseKey(id)] || null
const objOf = (id) => {
  const k = caseKey(id)
  if (!k) return app.data.objects.find((o) => o.id === id)
  const c = caseCalc(id)
  return c ? { id, name: `${c.name || 'Vertrieb'}${c.no ? ` (${c.no})` : ''}`, address: c.address || '', fromCase: k } : null
}
const areasOf = (id) => (caseKey(id) ? caseCalc(id)?.areas || [] : doc().objects?.[id]?.areas || [])
const editable = () => canEdit(MODULE) && !app.readOnly
const eur = (n) => `${(n ?? 0).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const de = (n, d = 1) => (n ?? 0).toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: d })
const wageNow = () => calcWage(settings(), mergeRules(app.data.rules).wages)

/** Stunden laut Reinigungsplan im laufenden Monat (Leistungen × Personen). */
function plannedHours(objectId) {
  if (caseKey(objectId)) return null
  const from = `${todayISO().slice(0, 7)}-01`
  const r = computeRange(from, lastOfMonth(from))
  const obj = objOf(objectId)
  return obj ? objectControlling(r.ctx, [obj], from.slice(0, 7), r.instances, r.state)[0].planned / 60 : null
}

function current() {
  const id = app.ui.calcObject && objOf(app.ui.calcObject) ? app.ui.calcObject : app.data.objects[0]?.id || Object.keys(doc().cases || {}).map((k) => `vt:${k}`)[0]
  return id
}

// ---------------------------------------------------------------- Ansicht

const calcTab = () => (app.ui.calcTab === 'nach' ? 'nach' : 'objekt')
const tabs = () => `<div class="calc-tabs" role="tablist">${tabBar({ action: 'calc-tab', current: calcTab(), tabs: [{ id: 'objekt', label: 'Objekt kalkulieren' }, { id: 'nach', label: 'Nachkalkulation' }] })}</div>`
const NK_SPANS = [['3', '3 Monate'], ['6', '6 Monate'], ['12', '12 Monate']]
const nkSpan = () => rentSpan(app.ui.nkSpan || '3', todayISO())

function calcView(c) {
  return calcTab() === 'nach' ? nachView(c) : objectView()
}

/** Nachkalkulation: Stunden je Monat kalkuliert, geplant, gerechnet; Vorschlag für die Leistungswerte. */
function nachView(c) {
  const sp = nkSpan()
  const months = Number(sp.kind) || 3
  const s = settings()
  const { rows, sug } = memo(c, `nk:${sp.from}:${sp.to}:${JSON.stringify(s.performance)}`, () => {
    const r = computeRange(sp.from, sp.to)
    const hours = hoursByObject({ instances: r.instances, state: r.state, stamps: app.data.stamps, from: sp.from, to: sp.to })
    const rows = nachkalkulation({ objects: app.data.objects, calcObjects: doc().objects || {}, settings: s, hours, months, wage: wageNow() })
    return { rows, sug: suggestPerformance(rows, s.performance) }
  })
  const pct = (v) => (v === null || v === undefined ? '–' : `${de(v * 100, 0)} %`)
  const dev = (r) => (r.deviation === null ? '<span class="muted">keine Stunden</span>' : Math.abs(r.deviation) < 0.05 ? '<span class="ok-text">passt</span>' : `<span class="${r.deviation > 0 ? 'warn-text' : 'info-text'}">${r.deviation > 0 ? '+' : '−'}${de(Math.abs(r.deviation) * 100, 0)} % ${r.deviation > 0 ? 'länger' : 'kürzer'}</span>`)
  const body = rows
    .map((r) => `<tr><td><strong>${esc(r.name)}</strong></td><td class="num">${de(r.calcHours)} h</td><td class="num">${de(r.plannedHours)} h</td><td class="num">${de(r.usedHours)} h</td><td class="num">${pct(r.stampedShare)}</td><td>${dev(r)}${r.reliable || r.deviation === null ? '' : '<br><span class="muted small">zu wenig gestempelt</span>'}</td>
      <td><button class="btn small" data-action="calc-nk-open" data-id="${esc(r.objectId)}">Kalkulation</button></td></tr>`)
    .join('')
  const ed = editable()
  const sugRows = sug
    .map((x) => `<tr><td>${ed ? `<label class="check"><input type="checkbox" name="nk-type" value="${esc(x.type)}" ${Math.abs(x.suggested - x.current) >= 5 ? 'checked' : ''}> ${esc(x.label)}</label>` : esc(x.label)}</td><td class="num">${de(x.current, 0)}</td><td class="num"><strong>${de(x.suggested, 0)}</strong></td><td class="num">${x.factor >= 1 ? '+' : '−'}${de(Math.abs(x.factor - 1) * 100, 0)} %</td><td class="num">${x.objects}</td></tr>`)
    .join('')
  return `<div class="section-head"><div><h2>Kalkulation</h2><p>Nachkalkulation: Wie viele Stunden kalkuliert sind und wie viele die Objekte wirklich brauchen (gestempelt, sonst laut Plan). Daraus ein Vorschlag für die Leistungswerte je Raumart – die Kalkulation lernt aus der Praxis.</p></div></div>
    ${tabs()}
    <div class="filters" role="group" aria-label="Zeitraum">${NK_SPANS.map(([id, label]) => `<button class="filter" data-action="calc-nk-span" data-v="${id}" aria-pressed="${sp.kind === id}">${label}</button>`).join('')}</div>
    <p class="muted">${esc(sp.label)}: Stunden je Monat (Durchschnitt). „Gerechnet“ = gestempelte Zeit je eingeteilter Person und Einsatz, sonst die geplante.</p>
    ${rows.length ? `<div class="table-wrap"><table class="data nk-table"><thead><tr><th>Objekt</th><th class="num">kalkuliert</th><th class="num">geplant</th><th class="num">gerechnet</th><th class="num">gestempelt</th><th>Abweichung</th><th></th></tr></thead><tbody>${body}</tbody></table></div>` : '<p class="empty">Noch keine Objekte mit Kalkulation. Im Reiter „Objekt kalkulieren“ Flächen erfassen und speichern.</p>'}
    <h3>Vorschlag für die Leistungswerte (m² je Stunde)</h3>
    ${sug.length ? `<p class="note">Aus ${rows.filter((r) => r.reliable).length} Objekten, in denen mindestens ${de(NK_MIN_STAMPED * 100, 0)} % der Einsätze gestempelt sind; je Schritt höchstens ± 40 %. Gilt für alle neuen und bestehenden Kalkulationen ohne eigenen Leistungswert der Fläche – die Preise der bestehenden Verträge ändern sich dadurch nicht.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Raumart</th><th class="num">bisher</th><th class="num">Vorschlag</th><th class="num">Änderung</th><th class="num">Objekte</th></tr></thead><tbody>${sugRows}</tbody></table></div>
      ${ed ? '<div class="actions"><button class="btn primary" data-action="calc-nk-apply">Ausgewählte übernehmen</button></div>' : ''}`
      : `<p class="empty">Noch kein Vorschlag: Dafür braucht es Objekte mit Kalkulation, in denen mindestens ${de(NK_MIN_STAMPED * 100, 0)} % der Einsätze gestempelt sind (Zeiterfassung im Objekt).</p>`}`
}

function objectView() {
  const id = current()
  if (!id) return '<p class="empty">Noch keine Objekte.</p>'
  const obj = objOf(id)
  const s = settings()
  const ed = editable()
  const areas = app.ui.calcDraft?.id === id ? app.ui.calcDraft.areas : areasOf(id)
  const wage = wageNow()
  const calc = calculate({ areas, settings: s, wage })
  const planned = plannedHours(id)
  const budget = obj.budgetHoursMonth || null
  const cases = Object.entries(doc().cases || {}).filter(([, x]) => x?.areas?.length && !x.objectId)
  const objSelect = `<select id="calc-obj" data-change="calc-object">${options(app.data.objects.map((o) => [o.id, `${o.name}${areasOf(o.id).length ? ' ✓' : ''}`]), id)}${cases.length ? `<optgroup label="Vertrieb (noch ohne Objekt)">${options(cases.map(([k, x]) => [`vt:${k}`, `${x.name || 'Fall'}${x.no ? ` (${x.no})` : ''}`]), id)}</optgroup>` : ''}</select>`
  const typeOpts = Object.entries(AREA_TYPES).map(([k, [l]]) => [k, l])
  const freqOpts = FREQUENCIES.map(([f, l]) => [String(f), l])
  const rows = areas
    .map((a, i) => {
      const r = calc.rows[i]
      const dis = ed ? '' : 'disabled'
      return `<tr><td><input type="text" id="ca-name-${i}" value="${esc(a.name || '')}" placeholder="z. B. Büros 1. OG" ${dis}></td>
        <td><select id="ca-type-${i}" ${dis}>${options(typeOpts, a.type)}</select></td>
        <td class="num"><input type="number" id="ca-m2-${i}" min="0" step="1" value="${esc(a.m2 ?? '')}" style="width:6rem" ${dis}></td>
        <td><select id="ca-freq-${i}" ${dis}>${options(freqOpts, String(FREQUENCIES.find(([f]) => Math.abs(f - a.perWeek) < 1e-6)?.[0] ?? 1))}</select></td>
        <td class="num"><input type="number" id="ca-value-${i}" min="1" step="5" value="${esc(a.value || '')}" placeholder="${esc(s.performance[a.type] || 150)}" style="width:5rem" ${dis}></td>
        <td class="num">${de(r.minutes / 60, 2)}</td>
        <td>${ed ? `<button class="btn small danger" data-action="calc-remove" data-idx="${i}" aria-label="Fläche entfernen">${ICON.trash}</button>` : ''}</td></tr>`
    })
    .join('')
  const tile = (label, value, sub = '') => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<small class="muted">${sub}</small>` : ''}</div>`
  const diff = (h) => (h === null || !calc.hours ? '' : Math.abs(h - calc.hours) < 0.05 ? 'passt zur Kalkulation' : `${h > calc.hours ? '+' : '−'}${de(Math.abs(h - calc.hours))} h zur Kalkulation`)
  return `<div class="section-head"><div><h2>Kalkulation</h2><p>Aus Flächen, Häufigkeit und Leistungswerten (m² je Stunde) die Stunden im Monat, dann über Zuschläge der Verrechnungssatz und der Monatspreis. Vergleich mit Budget und Reinigungsplan, Angebot als PDF.</p></div>
      <div class="actions"><button class="btn" data-action="calc-settings">Grundlagen</button></div></div>
    ${tabs()}
    <div class="filters"><label class="field inline"><span>Objekt</span>${objSelect}</label><span class="muted">${esc(obj.address || '')}</span>${obj.fromCase ? `<button class="btn small" data-action="vt-goto" data-id="${esc(obj.fromCase)}">Zum Fall im Vertrieb</button>` : ''}</div>
    <div class="table-wrap"><table class="data calc-table"><thead><tr><th>Bereich</th><th>Art</th><th class="num">Fläche m²</th><th>Häufigkeit</th><th class="num">m²/h</th><th class="num">h/Monat</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="muted">Noch keine Flächen. „Fläche hinzufügen“, z. B. Büros, Sanitär, Stiegenhaus.</td></tr>'}</tbody></table></div>
    ${ed ? `<div class="actions" style="margin:8px 0 16px"><button class="btn" data-action="calc-add">${ICON.plus} Fläche hinzufügen</button><button class="btn primary" data-action="calc-save">Speichern</button></div>` : ''}
    <div class="impact-stats tc-stats">
      ${tile('Stunden je Monat', de(calc.hours), `inkl. ${de(s.setupPct, 0)} % Rüstzeit`)}
      ${tile('Verrechnungssatz', eur(calc.rate), `Lohn ${eur(wage)}`)}
      ${tile('Preis je Monat netto', eur(calc.net), `brutto ${eur(calc.gross)}`)}
      ${tile('Je m² und Monat', calc.perM2 === null ? '–' : eur(calc.perM2), `${de(calc.totalM2, 0)} m²`)}
      ${tile('Budget im Objekt', budget ? `${de(budget)} h` : '–', diff(budget))}
      ${tile('Laut Reinigungsplan', planned === null ? '–' : `${de(planned)} h`, diff(planned))}
    </div>
    <div class="actions">${menu({
      label: 'Mehr',
      single: false,
      items: [
        { label: 'Kalkulation (intern, PDF)', icon: ICON.download, action: 'calc-pdf', data: { kind: 'Kalkulation' }, disabled: !calc.hours, hint: 'mit Lohn, Zuschlägen und Marge', mail: { hint: 'intern, nicht an Kunden' } },
        { label: 'Angebot (PDF)', icon: ICON.download, action: 'calc-pdf', data: { kind: 'Angebot' }, disabled: !calc.hours, mail: { hint: 'an die Kundschaft' } },
        (canEdit('stammdaten') || canEdit('planung')) && !obj.fromCase && { label: 'Als Budget übernehmen', action: 'calc-budget', disabled: !calc.hours, hint: 'Sollstunden je Monat ins Objekt' },
      ],
    })}<button class="btn primary" data-action="calc-pdf" data-kind="Angebot" ${calc.hours ? '' : 'disabled'}>${ICON.download} Angebot (PDF)</button></div>
    <details class="calc-steps"><summary>So rechnet die Kalkulation</summary><table class="data"><tbody>${calc.steps.map((st) => `<tr><td>${esc(st.label)}</td><td class="num">${st.pct === null ? '' : `${de(st.pct)} %`}</td><td class="num">${eur(st.amount)}</td></tr>`).join('')}<tr><td><strong>Verrechnungssatz netto</strong></td><td></td><td class="num"><strong>${eur(calc.rate)}</strong></td></tr></tbody></table>
      <p class="note">Je Fläche: m² ÷ Leistungswert × Reinigungen je Woche × 4,33 Wochen; dazu Rüst- und Nebenzeiten. Die Zuschläge laufen nacheinander (jeder auf die Summe davor). Leistungswerte und Zuschläge unter „Grundlagen“; Richtwerte, mit der eigenen Erfahrung abgleichen.</p></details>`
}

registerView({
  id: 'kalkulation',
  order: 62,
  label: 'Kalkulation',
  group: 'auswertung',
  module: MODULE,
  noWeek: true,
  available: () => !app.access || !!app.access.all,
  text: 'Stunden und Preis je Objekt',
  // Nachkalkulation: Wochen des Zeitraums laden (Einteilungen und Stempelungen)
  range: () => {
    if (calcTab() !== 'nach') return null
    const sp = nkSpan()
    return { from: sp.from, to: sp.to }
  },
  render: calcView,
})

// ---------------------------------------------------------------- Formular lesen

function readAreas() {
  const id = current()
  const areas = (app.ui.calcDraft?.id === id ? app.ui.calcDraft.areas : areasOf(id)).map((a) => ({ ...a }))
  areas.forEach((a, i) => {
    if (!document.getElementById(`ca-m2-${i}`)) return
    a.name = val(`ca-name-${i}`).trim()
    a.type = val(`ca-type-${i}`)
    a.m2 = Math.max(0, Number(val(`ca-m2-${i}`)) || 0)
    a.perWeek = Number(val(`ca-freq-${i}`)) || 1
    const v = Number(val(`ca-value-${i}`))
    if (v > 0) a.value = v
    else delete a.value
  })
  app.ui.calcDraft = { id, areas }
  return areas
}

// ---------------------------------------------------------------- Grundlagen (Dialog)

function settingsModal() {
  const s = settings()
  const ed = editable()
  const dis = ed ? '' : 'disabled'
  const wages = mergeRules(app.data.rules).wages
  const field = (key, label, hint = '') => `<label class="field"><span>${label}</span><input type="number" id="cs-${key}" step="0.5" min="0" value="${esc(s[key])}" ${dis}>${hint ? `<small class="muted">${hint}</small>` : ''}</label>`
  return modalFrame({
    title: 'Grundlagen der Kalkulation',
    wide: true,
    body: `<h3>Leistungswerte (m² je Stunde)</h3><p class="note">Richtwerte für die Unterhaltsreinigung; Ausschreibungen nennen etwa Büro 150–250, Sanitär 35–120, Treppenhaus 130–200 m²/h. Je Fläche lässt sich ein eigener Wert eintragen.</p>
      <div class="form-grid">${Object.entries(AREA_TYPES).map(([k, [l]]) => `<label class="field"><span>${esc(l)}</span><input type="number" id="cs-perf-${k}" min="1" step="5" value="${esc(s.performance[k])}" ${dis}></label>`).join('')}</div>
      <h3>Stundenlohn und Zuschläge</h3>
      <div class="form-grid">
        <label class="field"><span>KV-Lohngruppe</span><select id="cs-wageGroup" ${dis}>${options(Object.entries(wages).map(([g, w]) => [g, `Lohngruppe ${g} · ${w.toLocaleString('de-AT', { minimumFractionDigits: 2 })} €`]), s.wageGroup, { empty: 'eigener Stundenlohn' })}</select></label>
        <label class="field"><span>Eigener Stundenlohn (€)</span><input type="number" id="cs-wage" step="0.01" min="0" value="${esc(s.wage ?? '')}" placeholder="leer = Lohngruppe" ${dis}></label>
        ${field('lnkPct', 'Lohnnebenkosten (%)', 'Sonderzahlungen, Urlaub, Feiertage, Krankenstand, Dienstgeberabgaben; Wert aus dem WKO-Merkblatt „Lohnnebenkosten Gebäudereiniger“ oder von der Steuerberatung')}
        ${field('setupPct', 'Rüst- und Nebenzeiten (%)', 'Material holen, Wege im Objekt')}
        ${field('materialPct', 'Material und Geräte (%)')}
        ${field('overheadPct', 'Verwaltung und Gemeinkosten (%)')}
        ${field('profitPct', 'Gewinn und Wagnis (%)')}
        ${field('vatPct', 'Umsatzsteuer (%)')}
      </div>`,
    foot: `<span></span><div class="actions"><button class="btn" data-action="close-modal">${ed ? 'Abbrechen' : 'Schließen'}</button>${ed ? '<button class="btn primary" data-action="calc-settings-save">Speichern</button>' : ''}</div>`,
  })
}

registerModal('calc-settings', settingsModal, { module: MODULE })

// ---------------------------------------------------------------- Aktionen

registerActions({
  'calc-tab': (el) => {
    app.ui.calcTab = el.dataset.v === 'nach' ? 'nach' : 'objekt'
    render()
  },
  'calc-nk-span': (el) => {
    app.ui.nkSpan = el.dataset.v
    render()
  },
  'calc-nk-open': (el) => {
    app.ui.calcTab = 'objekt'
    app.ui.calcObject = el.dataset.id
    app.ui.calcDraft = null
    render()
  },
  'calc-nk-apply': () => {
    if (!editable()) return toast('Ändern nur mit Recht auf die Auswertung.')
    const picked = new Set(checkedValues('nk-type'))
    if (!picked.size) return toast('Bitte mindestens eine Raumart anhaken.')
    const s = settings()
    const r = computeRange(nkSpan().from, nkSpan().to)
    const hours = hoursByObject({ instances: r.instances, state: r.state, stamps: app.data.stamps, from: nkSpan().from, to: nkSpan().to })
    const sug = suggestPerformance(nachkalkulation({ objects: app.data.objects, calcObjects: doc().objects || {}, settings: s, hours, months: Number(nkSpan().kind) || 3, wage: wageNow() }), s.performance).filter((x) => picked.has(x.type))
    const d = doc()
    d.settings = { ...(d.settings || {}), performance: { ...(d.settings?.performance || {}) } }
    for (const x of sug) d.settings.performance[x.type] = x.suggested
    persist()
    toast(`Leistungswerte übernommen: ${sug.map((x) => `${x.label} ${x.current} → ${x.suggested} m²/h`).join(', ')}.`)
    renderNow()
  },
  'calc-object': () => {
    app.ui.calcObject = val('calc-obj')
    app.ui.calcDraft = null
    renderNow()
  },
  'calc-settings': () => openModal({ type: 'calc-settings' }),
  'calc-pdf': async (el) => {
    const id = current()
    const obj = objOf(id)
    const areas = editable() ? readAreas() : areasOf(id)
    const s = settings()
    const wage = wageNow()
    const calc = calculate({ areas, settings: s, wage })
    const logo = await loadLogo().catch(() => null)
    const kind = el.dataset.kind
    const docDef = kind === 'Angebot' ? offerDocument({ object: obj, calc, brand: app.config.brand, logo }) : calcDocument({ object: obj, calc, settings: s, wage, plannedMonth: plannedHours(id), budgetMonth: obj.budgetHoursMonth ?? null, brand: app.config.brand, logo })
    download(calcPdfName(kind, obj.name), await pdfBlob(docDef))
  },
})

registerActions(
  {
    'calc-add': () => {
      const areas = readAreas()
      areas.push({ id: uid('f'), name: '', type: 'buero', m2: 0, perWeek: 5 })
      renderNow()
    },
    'calc-remove': (el) => {
      const areas = readAreas()
      areas.splice(Number(el.dataset.idx), 1)
      renderNow()
    },
    'calc-save': () => {
      const id = current()
      const areas = readAreas().filter((a) => a.m2 > 0 || a.name)
      const k = caseKey(id)
      if (k) {
        doc().cases = { ...(doc().cases || {}), [k]: { ...(doc().cases?.[k] || {}), areas, updatedAt: new Date().toISOString() } }
        // Ergebnis zurück in den Fall des Vertriebs (Preis je Monat, Stunden), wer dort bearbeiten darf
        const list = app.data.vertrieb?.cases || []
        const i = list.findIndex((x) => x.id === k)
        if (i >= 0 && canEdit('vertrieb')) {
          const at = new Date().toISOString()
          list[i] = { ...applyCalc(list[i], calcSummary(calculate({ areas, settings: settings(), wage: wageNow() }), { at, by: app.user?.name || '' })), updatedAt: at, updatedBy: app.user?.name || '' }
        }
      } else doc().objects = { ...(doc().objects || {}), [id]: { ...(doc().objects?.[id] || {}), areas, updatedAt: new Date().toISOString() } }
      app.ui.calcDraft = null
      persist()
      renderNow()
      toast(k ? 'Kalkulation gespeichert; Preis und Stunden stehen im Fall des Vertriebs.' : 'Kalkulation gespeichert.')
    },
    'calc-settings-save': () => {
      const s = settings()
      for (const k of Object.keys(AREA_TYPES)) {
        const v = Number(val(`cs-perf-${k}`))
        if (v > 0) s.performance[k] = v
      }
      s.wageGroup = val('cs-wageGroup')
      s.wage = Number(val('cs-wage')) > 0 ? Number(val('cs-wage')) : null
      for (const k of ['lnkPct', 'setupPct', 'materialPct', 'overheadPct', 'profitPct', 'vatPct']) {
        const v = Number(val(`cs-${k}`))
        if (Number.isFinite(v) && v >= 0) s[k] = v
      }
      if (!s.wage && !s.wageGroup) return toast('Bitte eine Lohngruppe wählen oder einen eigenen Stundenlohn eintragen.')
      doc().settings = s
      persist()
      closeModal()
      renderNow()
      toast('Grundlagen gespeichert.')
    },
  },
  { edit: MODULE },
)

registerActions(
  {
    'calc-budget': () => {
      const id = current()
      const obj = objOf(id)
      const calc = calculate({ areas: editable() ? readAreas() : areasOf(id), settings: settings(), wage: wageNow() })
      obj.budgetHoursMonth = Math.round(calc.hours * 10) / 10
      persist()
      renderNow()
      toast(`Budget ${obj.name}: ${de(obj.budgetHoursMonth)} h je Monat (Objekt-Controlling vergleicht damit).`)
    },
  },
  { edit: ['stammdaten', 'planung'] },
)

