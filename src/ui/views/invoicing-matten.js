// Fakturierung: Mattenwechsel-Stammdaten (docs/MATTENWECHSEL-PLAN.md, P2 und P3). Geladen mit invoicing.js.
//  - Reiter „Matten“ (Stammdaten): Mattentypen = Artikel der Gruppe „Matten“ mit Größe, Farbe, Art und Preis je
//    gewechselter Matte; schnell anlegen, Vorlage mit den üblichen Größen (ohne Preise), Kundenpreise für Matten.
//  - Kundenblatt, Reiter „Mattenwechsel“: E-Mail für Lieferscheine, Abrechnung (Sammel- oder Einzelrechnung, monatlich
//    oder quartalsweise), Preismodell (je gewechselter Matte oder Pauschale je Monat je Liegeplatz, Objekt oder Kunde),
//    Lieferschein automatisch senden.
//  - Kundenblatt, Reiter „Kundenpreise“: Preise je Artikel mit Gültigkeit (customerPrices[], für alle Artikel, nicht nur
//    Matten); geprüft wird beim Tippen und beim Speichern (keine Überschneidung, Preis ≥ 0, Dezimalkomma).
// Preise ermittelt nur core/invoicing.js (priceFor, monthlyFlatFor) – hier gibt es keine eigene Preislogik.
// Nur wer die Fakturierung sieht, sieht diese Reiter; ändern nur mit Recht zum Bearbeiten (Felder sonst gesperrt).

import { formatDate, todayISO } from '../../core/dates.js'
import {
  amountInput,
  articleActive,
  articleLabel,
  customerName,
  customerPriceInputs,
  deDate,
  isMatType,
  MAT_COLORS,
  MAT_GROUP,
  MAT_KINDS,
  MAT_SIZES,
  matLabel,
  matName,
  matSize,
  matTypes,
  MATTEN_BILLING,
  MATTEN_DEFAULTS,
  MATTEN_INTERVALS,
  MATTEN_PRICE_MODELS,
  mattenOf,
  priceFor,
  priceValidOn,
  round2,
  settingsOf,
  VAT_RATES,
} from '../../core/invoicing.js'
import { app, canEdit, persist, registerActions, renderModal, renderNow, toast } from '../context.js'
import { checked, esc, euro, ICON, options, uid, val } from '../shared.js'

const MODULE = 'fakturierung'
const F = () => {
  const d = app.data.fakturierung
  d.customerPrices ||= []
  return d
}
const S = () => settingsOf(F())
const editable = () => canEdit(MODULE) && !app.readOnly
const by = () => app.user?.name || 'Browser'
const money = (n) => euro(round2(n))
const numText = (v) => (v === '' || v === null || v === undefined ? '' : String(v).replace('.', ','))
const objName = (id) => (app.data.objects || []).find((o) => o.id === id)?.name || 'Objekt'
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const datalist = (id, values) => `<datalist id="${id}">${[...new Set(values.filter(Boolean))].map((v) => `<option value="${esc(v)}"></option>`).join('')}</datalist>`
const problemsHtml = (list) => (list?.length ? `<ul class="fak-problems" role="alert">${list.map((e) => `<li class="err-text">${esc(e.text)}</li>`).join('')}</ul>` : '')
/** Liegeplätze des Moduls Mattenwechsel, wenn geladen und lesbar (sonst keine Auswahl je Liegeplatz). */
const placementsOf = (objectId) => (Array.isArray(app.data.matten?.placements) ? app.data.matten.placements.filter((p) => p && p.objectId === objectId) : [])

// ---------------------------------------------------------------- Reiter „Matten“ (Mattentypen)

/** Kundenpreise je Artikel, die heute gelten. */
function pricesToday(articleId) {
  const today = todayISO()
  return F().customerPrices.filter((p) => p.articleId === articleId && priceValidOn(p, today))
}

export function mattenTab() {
  const d = F()
  const ed = editable()
  const list = matTypes(d.articles, { all: !!app.ui.fakArtAll })
  const inactive = matTypes(d.articles, { all: true }).length - matTypes(d.articles).length
  const have = new Set(matTypes(d.articles, { all: true }).map((a) => matSize(a.size)))
  const missing = MAT_SIZES.filter((s) => !have.has(s))
  const rows = list
    .map((a) => {
      const own = pricesToday(a.id)
      return `<tr class="clickable" data-action="fak-art-open" data-id="${esc(a.id)}"><td data-label="Größe"><strong>${esc(a.size ? matSize(a.size) : '–')}</strong></td><td data-label="Farbe">${esc(a.color || '')}</td><td data-label="Art">${esc(a.matKind || 'Standard')}</td>
        <td data-label="Bezeichnung">${esc(a.name)}${a.articleNo ? ` <span class="muted">${esc(a.articleNo)}</span>` : ''}${articleActive(a) ? '' : ' <span class="pill">inaktiv</span>'}</td><td class="num" data-label="je Wechsel netto">${a.price ? money(a.price) : '<span class="muted">kein Preis</span>'}</td><td class="num" data-label="USt">${a.vat ?? S().vat} %</td><td class="num" data-label="Kundenpreise">${own.length || ''}</td></tr>`
    })
    .join('')
  const custPrices = d.customerPrices
    .filter((p) => isMatType(d.articles.find((a) => a.id === p.articleId)) && priceValidOn(p, todayISO()))
    .map((p) => ({ p, c: d.customers.find((c) => c.id === p.customerId), a: d.articles.find((a) => a.id === p.articleId) }))
    .filter((x) => x.c)
    .sort((x, y) => customerName(x.c).localeCompare(customerName(y.c), 'de') || matLabel(x.a).localeCompare(matLabel(y.a), 'de'))
  return `<div class="filters"><p class="muted mwp-lead">Mattentypen sind Artikel der Gruppe „${MAT_GROUP}“: Größe, Farbe und Preis je gewechselter Matte. Kundenpreise mit Gültigkeit gehen vor (Kundenblatt → „Kundenpreise“).</p><span class="spacer"></span>
      ${inactive ? `<label class="check"><input type="checkbox" id="fak-art-all" data-change="fak-art-all" ${app.ui.fakArtAll ? 'checked' : ''}><span>auch inaktive (${inactive})</span></label>` : ''}
      ${ed && missing.length ? `<button class="btn small" data-action="mwp-mat-starter" title="${esc(missing.join(', '))}">Übliche Größen anlegen (${missing.length})</button>` : ''}</div>
    ${ed ? matForm() : ''}
    ${rows ? `<div class="table-wrap"><table class="data mwp-mat-table"><thead><tr><th>Größe</th><th>Farbe</th><th>Art</th><th>Bezeichnung</th><th class="num">je Wechsel netto</th><th class="num">USt</th><th class="num">Kundenpreise</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">Noch keine Mattentypen.${ed ? ' Oben anlegen oder „Übliche Größen anlegen“ (ohne Preise).' : ''}</p>`}
    <h3>Kundenpreise für Matten (heute gültig)</h3>
    ${
      custPrices.length
        ? `<div class="table-wrap"><table class="data mwp-cp-table"><thead><tr><th>Kunde</th><th>Mattentyp</th><th class="num">Preis netto</th><th class="num">Standard</th><th>gültig</th></tr></thead><tbody>${custPrices
            .map(({ p, c, a }) => `<tr class="clickable" data-action="fak-cust-open" data-id="${esc(c.id)}" data-tab="preise"><td data-label="Kunde"><strong>${esc(customerName(c))}</strong></td><td data-label="Mattentyp">${esc(matLabel(a))}</td><td class="num" data-label="Preis netto">${money(p.price)}</td><td class="num" data-label="Standard">${a.price ? money(a.price) : '–'}</td><td data-label="gültig">${esc(validText(p))}</td></tr>`)
            .join('')}</tbody></table></div>`
        : '<p class="empty">Keine Kundenpreise für Matten. Ohne Kundenpreis gilt der Preis des Mattentyps.</p>'
    }
    <p class="note">Abgerechnet wird je Kunde nach Einstellung im Kundenblatt (Reiter „Mattenwechsel“): je gewechselter Matte (Stückzahl × Preis) oder als Pauschale je Monat. Der Preis wird beim Lieferschein eingefroren; spätere Preisänderungen ändern alte Lieferscheine nicht.</p>`
}

/** Schnell anlegen: Größe, Farbe, Art, Preis je Wechsel, USt (nach einer Meldung bleiben die Eingaben stehen). */
function matForm() {
  const colors = [...MAT_COLORS, ...F().articles.filter(isMatType).map((a) => a.color)]
  return `<fieldset class="mwp-new"><legend>Mattentyp anlegen</legend><div class="form-grid">
      <label class="field"><span>Größe</span><input type="text" id="mwp-size" list="mwp-size-list" placeholder="z. B. 85 × 150 cm" autocomplete="off">${datalist('mwp-size-list', MAT_SIZES)}</label>
      <label class="field"><span>Farbe</span><input type="text" id="mwp-color" list="mwp-color-list" placeholder="z. B. grau" autocomplete="off">${datalist('mwp-color-list', colors)}</label>
      <label class="field"><span>Art</span><input type="text" id="mwp-kind" list="mwp-kind-list" value="Standard" autocomplete="off">${datalist('mwp-kind-list', MAT_KINDS)}</label>
      <label class="field"><span>Preis je Wechsel netto (€)</span><input type="text" inputmode="decimal" id="mwp-price" placeholder="z. B. 4,90" autocomplete="off"></label>
      <label class="field"><span>USt</span><select id="mwp-vat">${options(VAT_RATES.map((r) => [String(r), `${r} %`]), String(S().vat))}</select></label>
      <div class="field mwp-new-go"><button class="btn primary" data-action="mwp-mat-create">${ICON.plus} Mattentyp anlegen</button></div>
    </div></fieldset>`
}

// ---------------------------------------------------------------- Artikel-Dialog: Felder für Mattentypen

/** Größe, Farbe und Art im Artikel-Dialog (bei Mattentypen bzw. Gruppe „Matten“). */
export const articleMatFields = (v, dis) => `<fieldset class="mwp-art"><legend>Mattentyp</legend><div class="form-grid">
    <label class="field"><span>Größe</span><input type="text" id="fa-size" list="fa-size-list" value="${esc(v.size || '')}" placeholder="z. B. 85 × 150 cm" ${dis}>${datalist('fa-size-list', MAT_SIZES)}</label>
    <label class="field"><span>Farbe</span><input type="text" id="fa-color" list="fa-color-list" value="${esc(v.color || '')}" ${dis}>${datalist('fa-color-list', MAT_COLORS)}</label>
    <label class="field"><span>Art</span><input type="text" id="fa-kind" list="fa-kind-list" value="${esc(v.matKind || '')}" placeholder="Standard" ${dis}>${datalist('fa-kind-list', MAT_KINDS)}</label>
  </div><p class="muted">Der Verkaufspreis ist der Standardpreis je gewechselter Matte; Kundenpreise gehen vor.</p></fieldset>`

/** Felder des Mattentyps aus dem Artikel-Dialog (nur wenn sie im Dialog stehen). */
export function readArticleMat(fields) {
  if (String(fields.group || '').trim().toLowerCase() === MAT_GROUP.toLowerCase()) fields.group = MAT_GROUP
  if (!document.getElementById('fa-size')) return fields
  return { ...fields, size: matSize(val('fa-size')), color: val('fa-color').trim(), matKind: val('fa-kind').trim() }
}

// ---------------------------------------------------------------- Kundenblatt: Reiter „Mattenwechsel“

function mattenInputs(m, v) {
  if (m.mattenRaw) return m.mattenRaw
  const s = mattenOf(v)
  m.mattenRaw = { email: v.deliveryNoteEmail || '', ...s, monthlyFlat: s.monthlyFlat.map((x) => ({ objectId: x.objectId || '', placementId: x.placementId || '', amount: numText(x.amount ?? ''), vat: String(x.vat ?? S().vat) })) }
  return m.mattenRaw
}

export function customerMattenTab(v, x, dis) {
  const m = app.ui.modal
  const r = mattenInputs(m, v)
  const ids = v.objectIds || []
  const bad = new Set((m.mattenErrors || []).map((e) => `fcm-${e.i}-amount`))
  const flatRows = r.monthlyFlat
    .map((f, i) => {
      const places = f.objectId ? placementsOf(f.objectId) : []
      return `<div class="form-grid mwp-flat"><label class="field"><span>Objekt</span><select id="fcm-${i}-obj" data-change="mwp-cust-redraw" ${dis}>${options([...new Set([...ids, f.objectId].filter(Boolean))].map((id) => [id, objName(id)]), f.objectId, { empty: 'ganzer Kunde' })}</select></label>
        ${places.length || f.placementId ? `<label class="field"><span>Liegeplatz</span><select id="fcm-${i}-place" data-change="mwp-cust-read" ${dis}>${options([...places.map((p) => [p.id, p.name || p.legacyId || p.id]), ...(f.placementId && !places.some((p) => p.id === f.placementId) ? [[f.placementId, f.placementId]] : [])], f.placementId, { empty: 'alle des Objekts' })}</select></label>` : ''}
        <label class="field"><span>Pauschale je Monat netto (€)</span><input type="text" inputmode="decimal" id="fcm-${i}-amount" value="${esc(f.amount)}" placeholder="z. B. 39,00" autocomplete="off" data-input="mwp-cust-read" data-change="mwp-cust-check" ${bad.has(`fcm-${i}-amount`) ? 'aria-invalid="true"' : ''} ${dis}></label>
        <label class="field"><span>USt</span><select id="fcm-${i}-vat" data-change="mwp-cust-read" ${dis}>${options(VAT_RATES.map((n) => [String(n), `${n} %`]), f.vat)}</select></label>
        ${dis ? '' : `<div class="field fak-contact-del"><button class="btn small ghost" data-action="mwp-flat-del" data-i="${i}">${ICON.trash} entfernen</button></div>`}</div>`
    })
    .join('')
  const today = todayISO()
  const mats = matTypes(F().articles)
  const priceRows = mats
    .map((a) => {
      const p = x ? priceFor(F(), x.id, a.id, today) : null
      return `<tr><td data-label="Mattentyp">${esc(matLabel(a))}</td><td class="num" data-label="Standard">${a.price ? money(a.price) : '–'}</td><td class="num" data-label="für diesen Kunden">${p ? `${money(p.price)}${p.source === 'kunde' ? ' <span class="pill info">Kundenpreis</span>' : ''}` : '–'}</td></tr>`
    })
    .join('')
  return `<h3>Lieferscheine</h3>
    <div class="form-grid">
      <label class="field wide"><span>E-Mail für Lieferscheine</span><input type="email" id="fcm-email" value="${esc(r.email)}" placeholder="${esc(v.email ? `leer: ${v.email}` : 'leer: E-Mail für Rechnungen')}" data-input="mwp-cust-read" data-change="mwp-cust-check" ${dis}></label>
      <label class="check wide"><input type="checkbox" id="fcm-auto" ${r.autoSend ? 'checked' : ''} data-change="mwp-cust-read" ${dis}><span>Lieferschein nach dem Wechsel automatisch senden (sonst erst nach Prüfung im Büro)</span></label>
    </div>
    <h3>Abrechnung</h3>
    <div class="form-grid">
      <label class="field"><span>Rechnung</span><select id="fcm-billing" data-change="mwp-cust-read" ${dis}>${options(Object.entries(MATTEN_BILLING), r.billing)}</select></label>
      <label class="field"><span>Abrechnungszeitraum</span><select id="fcm-interval" data-change="mwp-cust-read" ${dis}>${options(Object.entries(MATTEN_INTERVALS), r.billingInterval)}</select></label>
      <label class="field"><span>Preismodell</span><select id="fcm-model" data-change="mwp-cust-redraw" ${dis}>${options(Object.entries(MATTEN_PRICE_MODELS), r.priceModel)}</select></label>
    </div>
    <div id="fcm-problems" aria-live="polite">${problemsHtml(m.mattenErrors)}</div>
    ${
      r.priceModel === 'pauschale'
        ? `<h3>Pauschale je Monat</h3><p class="muted">Je Liegeplatz, Objekt oder für den ganzen Kunden; je Eintrag eine Position auf der Rechnung (quartalsweise der dreifache Betrag). Beträge mit Komma, z. B. 39,00.</p>
          ${flatRows || '<p class="empty">Noch keine Pauschale eingetragen.</p>'}
          ${dis ? '' : `<p><button class="btn small" data-action="mwp-flat-add">${ICON.plus} Pauschale</button></p>`}`
        : `<h3>Preise je gewechselter Matte (heute)</h3>
          ${priceRows ? `<div class="table-wrap"><table class="data mwp-cust-prices"><thead><tr><th>Mattentyp</th><th class="num">Standard</th><th class="num">für diesen Kunden</th></tr></thead><tbody>${priceRows}</tbody></table></div>` : `<p class="empty">Noch keine Mattentypen (Fakturierung → Stammdaten → Matten).</p>`}
          <p>${x ? `<button class="btn small" data-action="fak-cust-tab" data-v="preise">Kundenpreise bearbeiten</button>` : '<span class="muted">Kundenpreise nach dem ersten Speichern im Reiter „Kundenpreise“.</span>'}</p>`
    }
    <p class="note">Sammelrechnung: alle offenen Lieferscheine des Zeitraums in einer Rechnung; Einzelrechnung: je Lieferschein eine. Rechnungen entstehen immer als Entwurf und werden nie von selbst versendet.</p>`
}

/** Eingaben des Reiters (wie getippt) in m.mattenRaw. */
function readMattenDom(m) {
  const r = mattenInputs(m, m.draft)
  r.email = val('fcm-email').trim()
  r.autoSend = checked('fcm-auto')
  r.billing = val('fcm-billing')
  r.billingInterval = val('fcm-interval')
  r.priceModel = val('fcm-model')
  r.monthlyFlat = r.monthlyFlat.map((f, i) =>
    document.getElementById(`fcm-${i}-amount`) ? { objectId: val(`fcm-${i}-obj`), placementId: document.getElementById(`fcm-${i}-place`) ? val(`fcm-${i}-place`) : '', amount: val(`fcm-${i}-amount`).trim(), vat: val(`fcm-${i}-vat`) } : f,
  )
  // der Liegeplatz gehört zum Objekt: anderes Objekt gewählt → Liegeplatz leer
  for (const f of r.monthlyFlat) if (f.placementId && f.objectId && placementsOf(f.objectId).length && !placementsOf(f.objectId).some((p) => p.id === f.placementId)) f.placementId = ''
}

/**
 * Eingaben prüfen und in den Entwurf des Kunden: deliveryNoteEmail und matten (matten nur, wenn der Kunde schon
 * Einstellungen hatte oder etwas von den Vorgaben abweicht). Fehler (Pauschale keine Zahl, negativ, doppelt) in m.mattenErrors.
 */
function applyMatten(m) {
  const v = m.draft
  const r = mattenInputs(m, v)
  const errors = []
  const flat = []
  const where = (f) => (f.placementId ? 'Liegeplatz' : f.objectId ? objName(f.objectId) : 'ganzer Kunde')
  r.monthlyFlat.forEach((f, i) => {
    const a = amountInput(f.amount)
    if (a.error) errors.push({ i, text: `Pauschale (${where(f)}) ${a.error}` })
    else if (a.value === '') errors.push({ i, text: `Pauschale (${where(f)}): Betrag fehlt` })
    else flat.push({ ...(f.objectId ? { objectId: f.objectId } : {}), ...(f.placementId ? { placementId: f.placementId } : {}), amount: a.value, vat: Number(f.vat) })
  })
  const keys = flat.map((f) => `${f.objectId || ''}|${f.placementId || ''}`)
  keys.forEach((k, i) => {
    if (keys.indexOf(k) !== i) errors.push({ i, text: `Pauschale doppelt: ${where(flat[i])} steht zweimal da` })
  })
  if (r.priceModel === 'pauschale' && !r.monthlyFlat.length) errors.push({ i: -1, text: 'Preismodell Pauschale: bitte mindestens eine Pauschale eintragen' })
  if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) errors.push({ i: -1, text: 'E-Mail für Lieferscheine ist ungültig' })
  m.mattenErrors = errors
  if (r.email || 'deliveryNoteEmail' in v) v.deliveryNoteEmail = r.email
  const next = { billing: r.billing, billingInterval: r.billingInterval, priceModel: r.priceModel, monthlyFlat: flat, autoSend: !!r.autoSend }
  if (v.matten || JSON.stringify(next) !== JSON.stringify(MATTEN_DEFAULTS)) v.matten = next
  return v
}

/** Reiter „Mattenwechsel“ lesen (nur wenn er im Dialog steht) und prüfen. */
export function readCustomerMatten(m) {
  if (!m?.draft || !document.getElementById('fcm-model')) return m?.draft
  readMattenDom(m)
  return applyMatten(m)
}

// ---------------------------------------------------------------- Kundenblatt: Reiter „Kundenpreise“

const validText = (p) => (p.validFrom && p.validTo ? `${deDate(p.validFrom)} – ${deDate(p.validTo)}` : p.validFrom ? `ab ${deDate(p.validFrom)}` : p.validTo ? `bis ${deDate(p.validTo)}` : 'immer')

/** Zeilen prüfen (ohne Dialog): m.priceErrors. */
const checkPrices = (m) => {
  m.priceErrors = customerPriceInputs(m.priceRows, { customerId: m.id || 'neu', articles: F().articles, settings: S() }).errors
}

function priceInputs(m, x) {
  if (m.priceRows) return m.priceRows
  const mine = x ? F().customerPrices.filter((p) => p.customerId === x.id) : []
  m.priceRows = mine.sort((a, b) => String(a.validFrom || '').localeCompare(String(b.validFrom || ''))).map((p) => ({ id: p.id, articleId: p.articleId, price: numText(p.price), vat: p.vat === undefined || p.vat === null ? '' : String(p.vat), validFrom: p.validFrom || '', validTo: p.validTo || '', note: p.note || '' }))
  return m.priceRows
}

/** Artikel zur Auswahl: Mattentypen zuerst, dann die übrigen aktiven (ein inaktiver bleibt sichtbar, wenn gewählt). */
function articleChoices(selected) {
  const list = F().articles.filter((a) => articleActive(a) || a.id === selected)
  const mats = matTypes(list, { all: true })
  const rest = list.filter((a) => !isMatType(a)).sort((a, b) => articleLabel(a).localeCompare(articleLabel(b), 'de'))
  return [...mats.map((a) => [a.id, `Matte ${matLabel(a)}`]), ...rest.map((a) => [a.id, articleLabel(a)])]
}

const stateOf = (p, today) => (!p.articleId ? '' : p.validTo && p.validTo < today ? '<span class="pill">abgelaufen</span>' : p.validFrom && p.validFrom > today ? `<span class="pill warning">ab ${formatDate(p.validFrom, { year: true })}</span>` : '<span class="pill ok">gilt heute</span>')

export function customerPricesTab(v, x, dis) {
  const m = app.ui.modal
  const rows = priceInputs(m, x)
  const today = todayISO()
  const bad = new Map((m.priceErrors || []).map((e) => [`${e.id}:${e.field}`, true]))
  const inv = (r, f) => (bad.has(`${r.id}:${f}`) ? 'aria-invalid="true"' : '')
  const html = rows
    .map((r, i) => {
      const a = F().articles.find((y) => y.id === r.articleId)
      return `<fieldset class="mwp-cp"><legend>${a ? esc(isMatType(a) ? `Matte ${matLabel(a)}` : a.name) : 'Neuer Kundenpreis'} ${stateOf(r, today)}</legend><div class="form-grid">
        <label class="field wide"><span>Artikel</span><select id="fcp-${i}-art" data-change="mwp-price-art" ${inv(r, 'articleId')} ${dis}>${options(articleChoices(r.articleId), r.articleId, { empty: '– Artikel wählen –' })}</select></label>
        <label class="field"><span>Preis netto (€)</span><input type="text" inputmode="decimal" id="fcp-${i}-price" value="${esc(r.price)}" placeholder="${a && a.price ? `Standard ${esc(numText(a.price))}` : 'z. B. 4,50'}" autocomplete="off" data-input="mwp-cust-read" data-change="mwp-price-check" ${inv(r, 'price')} ${dis}></label>
        <label class="field"><span>USt</span><select id="fcp-${i}-vat" data-change="mwp-price-check" ${inv(r, 'vat')} ${dis}>${options(VAT_RATES.map((n) => [String(n), `${n} %`]), r.vat, { empty: a ? `wie Artikel (${a.vat ?? S().vat} %)` : 'wie Artikel' })}</select></label>
        <label class="field"><span>gültig ab</span><input type="date" id="fcp-${i}-from" value="${esc(r.validFrom)}" data-change="mwp-price-check" ${inv(r, 'validFrom')} ${dis}></label>
        <label class="field"><span>gültig bis (leer: ohne Ende)</span><input type="date" id="fcp-${i}-to" value="${esc(r.validTo)}" data-change="mwp-price-check" ${inv(r, 'validTo')} ${dis}></label>
        <label class="field wide"><span>Notiz</span><input type="text" id="fcp-${i}-note" value="${esc(r.note)}" placeholder="z. B. Rahmenvertrag 2026" data-input="mwp-cust-read" data-change="mwp-cust-read" ${dis}></label>
        ${dis ? '' : `<div class="field fak-contact-del"><button class="btn small ghost" data-action="mwp-price-del" data-i="${i}">${ICON.trash} entfernen</button></div>`}
      </div></fieldset>`
    })
    .join('')
  return `<h3>Kundenpreise</h3>
    <p class="muted">Eigener Preis netto je Artikel mit Gültigkeit (von und bis je einschließlich). Er geht dem Preis des Artikels vor; der Kundenrabatt wird dazu nicht abgezogen. Je Artikel dürfen sich die Zeiträume nicht überschneiden – für eine Preiserhöhung den alten Preis mit „gültig bis“ beenden und einen neuen anlegen.</p>
    <div id="fcp-problems" aria-live="polite">${problemsHtml(m.priceErrors)}</div>
    ${html || '<p class="empty">Noch keine Kundenpreise. Es gelten die Preise der Artikel.</p>'}
    ${dis ? '' : `<p><button class="btn small" data-action="mwp-price-add">${ICON.plus} Kundenpreis</button></p>`}`
}

/** Zeilen des Reiters lesen (Text wie getippt) und prüfen: m.priceRows, m.priceErrors. */
export function readCustomerPrices(m) {
  if (!m?.priceRows) return
  m.priceRows = m.priceRows.map((r, i) =>
    document.getElementById(`fcp-${i}-art`) ? { ...r, articleId: val(`fcp-${i}-art`), price: val(`fcp-${i}-price`).trim(), vat: val(`fcp-${i}-vat`), validFrom: val(`fcp-${i}-from`), validTo: val(`fcp-${i}-to`), note: val(`fcp-${i}-note`) } : r,
  )
  checkPrices(m)
}

/**
 * Kundenpreise des Kunden speichern (nur wenn der Reiter offen war): ersetzt seine Einträge in customerPrices[],
 * behält Anlage-Vermerke und setzt updatedAt/By bei geänderten. Liefert die Anzahl.
 */
export function saveCustomerPrices(m, customerId) {
  if (!m?.priceRows) return null
  const d = F()
  const now = new Date().toISOString()
  const { prices } = customerPriceInputs(m.priceRows, { customerId, articles: d.articles, settings: S() })
  const old = new Map(d.customerPrices.filter((p) => p.customerId === customerId).map((p) => [p.id, p]))
  const same = (a, b) => ['articleId', 'price', 'vat', 'validFrom', 'validTo', 'note'].every((k) => String(a[k] ?? '') === String(b[k] ?? ''))
  const next = prices.map((p) => {
    const prev = old.get(p.id)
    const base = { id: p.id, customerId, articleId: p.articleId, price: p.price, currency: p.currency, vat: p.vat, validFrom: p.validFrom, validTo: p.validTo, note: p.note }
    if (prev && same(prev, base)) return prev
    return prev ? { ...prev, ...base, updatedAt: now, updatedBy: by() } : { ...base, createdAt: now, createdBy: by() }
  })
  d.customerPrices = [...d.customerPrices.filter((p) => p.customerId !== customerId), ...next]
  return next.length
}

// ---------------------------------------------------------------- Aktionen

const custModal = () => (app.ui.modal?.type === 'fak-cust' ? app.ui.modal : null)

registerActions(
  {
    // Kundenblatt „Mattenwechsel“: Preismodell oder Objekt gewechselt → neu zeichnen; Betrag prüfen
    'mwp-cust-redraw': () => {
      const m = custModal()
      if (!m) return
      readCustomerMatten(m)
      renderModal()
    },
    // beim Tippen: Eingaben beider Reiter still in den Entwurf (ohne Meldungen und ohne Neuzeichnen)
    'mwp-cust-read': () => {
      const m = custModal()
      if (!m) return
      readCustomerMatten(m)
      readCustomerPrices(m)
    },
    'mwp-cust-check': () => {
      const m = custModal()
      if (!m) return
      readCustomerMatten(m)
      const box = document.getElementById('fcm-problems')
      if (box) box.innerHTML = problemsHtml(m.mattenErrors)
      const bad = new Set((m.mattenErrors || []).map((e) => `fcm-${e.i}-amount`))
      for (const el of document.querySelectorAll('.mwp-flat input[id^="fcm-"]')) {
        if (bad.has(el.id)) el.setAttribute('aria-invalid', 'true')
        else el.removeAttribute('aria-invalid')
      }
    },
    'mwp-flat-add': () => {
      const m = custModal()
      if (!m) return
      readMattenDom(m)
      const ids = m.draft.objectIds || []
      mattenInputs(m, m.draft).monthlyFlat.push({ objectId: ids.length === 1 ? ids[0] : '', placementId: '', amount: '', vat: String(S().vat) })
      applyMatten(m)
      m.mattenErrors = m.mattenErrors.filter((e) => !/Betrag fehlt|mindestens eine/.test(e.text)) // die neue Zeile ist noch leer
      renderModal()
    },
    'mwp-flat-del': (el) => {
      const m = custModal()
      if (!m) return
      readMattenDom(m)
      mattenInputs(m, m.draft).monthlyFlat.splice(Number(el.dataset.i), 1)
      applyMatten(m)
      renderModal()
    },
    // Kundenblatt „Kundenpreise“
    'mwp-price-add': () => {
      const m = custModal()
      if (!m) return
      readCustomerPrices(m)
      priceInputs(m, m.id ? F().customers.find((c) => c.id === m.id) : null).push({ id: uid('cp'), articleId: '', price: '', vat: '', validFrom: todayISO(), validTo: '', note: '' })
      checkPrices(m) // die neue, leere Zeile zählt noch nicht
      renderModal()
    },
    'mwp-price-del': (el) => {
      const m = custModal()
      if (!m?.priceRows) return
      readCustomerPrices(m)
      m.priceRows.splice(Number(el.dataset.i), 1)
      checkPrices(m)
      renderModal()
    },
    'mwp-price-art': () => {
      const m = custModal()
      if (!m) return
      readCustomerPrices(m)
      renderModal()
    },
    'mwp-price-check': () => {
      const m = custModal()
      if (!m) return
      readCustomerPrices(m)
      const box = document.getElementById('fcp-problems')
      if (box) box.innerHTML = problemsHtml(m.priceErrors)
      const bad = new Set((m.priceErrors || []).map((e) => `${e.id}:${e.field}`))
      const ids = { articleId: 'art', price: 'price', vat: 'vat', validFrom: 'from', validTo: 'to' }
      m.priceRows.forEach((r, i) => {
        for (const [f, s] of Object.entries(ids)) {
          const el = document.getElementById(`fcp-${i}-${s}`)
          if (!el) continue
          if (bad.has(`${r.id}:${f}`)) el.setAttribute('aria-invalid', 'true')
          else el.removeAttribute('aria-invalid')
        }
      })
    },
    // Reiter „Matten“: Mattentyp anlegen und übliche Größen
    'mwp-mat-create': () => {
      const raw = { size: val('mwp-size'), color: val('mwp-color'), matKind: val('mwp-kind').trim() || 'Standard', price: val('mwp-price'), vat: val('mwp-vat') }
      const size = matSize(raw.size)
      if (!size) return toast('Bitte die Größe eintragen, z. B. 85 × 150 cm.')
      const price = amountInput(raw.price)
      if (price.error) return toast(`Preis je Wechsel ${price.error}.`)
      const d = F()
      const color = raw.color.trim()
      const dup = matTypes(d.articles, { all: true }).find((a) => matSize(a.size) === size && String(a.color || '').toLowerCase() === color.toLowerCase() && String(a.matKind || 'Standard').toLowerCase() === raw.matKind.toLowerCase())
      if (dup) return toast(`Diesen Mattentyp gibt es schon: ${dup.name}.`)
      d.articles.push({ id: uid('a'), name: matName({ size, color, matKind: raw.matKind }), group: MAT_GROUP, size, color, matKind: raw.matKind, unit: 'Stk', price: price.value === '' ? 0 : price.value, vat: Number(raw.vat), active: true })
      persist()
      renderNow()
      for (const [id, v] of [['mwp-size', ''], ['mwp-color', ''], ['mwp-kind', 'Standard'], ['mwp-price', '']]) {
        const el = document.getElementById(id)
        if (el) el.value = v
      }
      toast(`Mattentyp ${size}${color ? ` ${color}` : ''} angelegt${price.value === '' || price.value === 0 ? ' (noch ohne Preis)' : ` (${money(price.value)} je Wechsel)`}.`)
    },
    'mwp-mat-starter': () => {
      const d = F()
      const have = new Set(matTypes(d.articles, { all: true }).map((a) => matSize(a.size)))
      const add = MAT_SIZES.filter((s) => !have.has(s))
      for (const size of add) d.articles.push({ id: uid('a'), name: matName({ size }), group: MAT_GROUP, size, color: '', matKind: 'Standard', unit: 'Stk', price: 0, vat: S().vat, active: true })
      persist()
      renderNow()
      toast(add.length ? `${plural(add.length, 'Mattentyp', 'Mattentypen')} angelegt (ohne Preise): ${add.join(', ')}. Preise und Farben bitte ergänzen.` : 'Die üblichen Größen gibt es schon.')
    },
  },
  { edit: MODULE },
)
