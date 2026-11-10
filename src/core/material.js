// Material & Lager: Artikel, Lager, Bestand aus Buchungen, Meldebestand, Bestellvorschlag je
// Lieferant, Bestellungen mit Wareneingang (auch Teillieferungen), Anforderungen aus den Objekten
// (App oder Handy), Ausgabe an Objekte und Personen, Verbrauch je Objekt, Inventur.
//
// Datei material/material.json:
//   { articles:  [{ id, name, category, unit, packSize, articleNo, supplierId, price, min, target, note, sds, active }],
//     locations: [{ id, name }],
//     suppliers: [{ id, name, email, phone, customerNo, contact, note }],
//     moves:     [{ id, at, date, kind, articleId, loc, qty, price, objectId, employeeId, orderId, requestId, pair, by, note }],
//     orders:    [{ id, no, supplierId, status, createdAt, orderedAt, expected, lines: [{ articleId, qty, price, received }], note, by, sent }],
//     requests:  [{ id, at, source, by, employeeId, name, objectId, lines: [{ articleId, qty, text }], note, status, answer, doneAt, portalId, orderId }],
//     settings:  { deliveryAddress, contact } }
//
// Der Bestand wird nie gespeichert, sondern immer aus den Buchungen gerechnet (Menge mit Vorzeichen
// je Lager). So kann er nicht auseinanderlaufen, und zwei Personen können gleichzeitig buchen:
// Buchungen haben eine id und werden beim Speichern zusammengeführt (merge.js).

import { parseTable } from './importer.js'

export const CATEGORIES = ['Reinigungsmittel', 'Desinfektion', 'Papier & Hygiene', 'Müllsäcke', 'Tücher & Mopps', 'Geräte & Zubehör', 'Arbeitskleidung & Schutz', 'Sonstiges']
export const UNITS = ['Stk', 'Pkg', 'Karton', 'Rolle', 'Fl.', 'l', 'kg', 'Kanister', 'Paar', 'Box']
export const MOVE_KINDS = { eingang: 'Wareneingang', ausgabe: 'Ausgabe', umbuchung: 'Umbuchung', inventur: 'Inventur', korrektur: 'Korrektur', saldo: 'Übertrag' }
export const ORDER_STATUS = { entwurf: 'Entwurf', bestellt: 'bestellt', teilweise: 'teilweise geliefert', geliefert: 'geliefert', storniert: 'storniert' }
export const REQUEST_STATUS = { offen: 'offen', bestellt: 'bestellt', ausgegeben: 'ausgegeben', abgelehnt: 'abgelehnt' }
export const MAIN_LOCATION = { id: 'lager', name: 'Hauptlager' }

/** Grundsortiment einer Gebäudereinigung zum schnellen Start (ohne Preise, Lieferanten, Bestände). */
export const STARTER_ARTICLES = [
  ['Allzweckreiniger', 'Reinigungsmittel', 'Fl.', 1, 6, 12],
  ['Sanitärreiniger (sauer)', 'Reinigungsmittel', 'Fl.', 1, 6, 12],
  ['Glasreiniger', 'Reinigungsmittel', 'Fl.', 1, 4, 8],
  ['Wischpflege / Bodenreiniger 10 l', 'Reinigungsmittel', 'Kanister', 1, 2, 4],
  ['Flächendesinfektion', 'Desinfektion', 'Fl.', 1, 4, 8],
  ['Händedesinfektion', 'Desinfektion', 'Fl.', 1, 4, 8],
  ['Handseife 5 l', 'Papier & Hygiene', 'Kanister', 1, 2, 4],
  ['Papierhandtücher Zickzack', 'Papier & Hygiene', 'Karton', 1, 3, 6],
  ['Toilettenpapier', 'Papier & Hygiene', 'Pkg', 1, 4, 10],
  ['Müllsäcke 60 l', 'Müllsäcke', 'Rolle', 1, 10, 25],
  ['Müllsäcke 120 l', 'Müllsäcke', 'Rolle', 1, 10, 25],
  ['Mikrofasertücher', 'Tücher & Mopps', 'Pkg', 1, 4, 10],
  ['Wischbezüge (Mopps)', 'Tücher & Mopps', 'Stk', 1, 10, 30],
  ['Einweghandschuhe Nitril', 'Arbeitskleidung & Schutz', 'Box', 1, 5, 12],
].map(([name, category, unit, packSize, min, target]) => ({ name, category, unit, packSize, min, target }))

export const emptyMaterial = () => ({ articles: [], locations: [{ ...MAIN_LOCATION }], suppliers: [], moves: [], orders: [], requests: [], settings: {} })

const r3 = (n) => Math.round(n * 1000) / 1000
// kaufmännisch auf Cent, ohne Gleitkomma-Fehler (1,005 → 1,01 wie in der Anzeige, nicht 1,00)
const r2 = (n) => (Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-7)) / 100
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const lower = (s) => String(s || '').trim().toLowerCase()

/** Lager (mindestens das Hauptlager). */
export const locationsOf = (doc) => (doc?.locations?.length ? doc.locations : [{ ...MAIN_LOCATION }])

// ---------------------------------------------------------------- Bestand

/** Bestand je Artikel und Lager: Map „artikel|lager“ → Menge. */
export function stockMap(moves = []) {
  const map = new Map()
  for (const m of moves) {
    const key = `${m.articleId}|${m.loc}`
    map.set(key, r3((map.get(key) || 0) + num(m.qty)))
  }
  return map
}

/** Bestand eines Artikels (in einem Lager oder gesamt). */
export function stockOf(moves, articleId, loc = null, map = stockMap(moves)) {
  if (loc) return map.get(`${articleId}|${loc}`) || 0
  let sum = 0
  for (const [key, qty] of map) if (key.startsWith(`${articleId}|`)) sum += qty
  return r3(sum)
}

const OPEN_ORDER = ['bestellt', 'teilweise']
/** Bestellt und noch nicht geliefert (offene Bestellungen); inDraft: in Entwürfen. */
export function onOrder(orders = [], articleId) {
  let open = 0
  let draft = 0
  for (const o of orders) {
    for (const l of o.lines || []) {
      if (l.articleId !== articleId) continue
      if (OPEN_ORDER.includes(o.status)) open += Math.max(0, num(l.qty) - num(l.received))
      else if (o.status === 'entwurf') draft += num(l.qty)
    }
  }
  return { open: r3(open), draft: r3(draft) }
}

/** Zustand eines Artikels: leer, niedrig (am oder unter dem Meldebestand) oder ok. */
export function stockStatus(total, min) {
  if (total <= 0 && (num(min) > 0 || total < 0)) return 'leer'
  if (num(min) > 0 && total <= num(min)) return 'niedrig'
  return 'ok'
}
export const STOCK_STATUS = { leer: 'leer', niedrig: 'nachbestellen', ok: 'ok' }

/**
 * Bestandsliste: [{ article, total, byLoc, open, draft, status, value }] gefiltert nach Kategorie,
 * Suchtext und Zustand (only: 'niedrig' zeigt leer und niedrig).
 */
export function stockRows(doc, { category = '', search = '', only = '', includeInactive = false } = {}) {
  const map = stockMap(doc.moves)
  const q = lower(search)
  const supplierName = new Map((doc.suppliers || []).map((s) => [s.id, s.name]))
  return (doc.articles || [])
    .filter((a) => (includeInactive || a.active !== false) && (!category || a.category === category))
    .filter((a) => !q || [a.name, a.articleNo, a.category, supplierName.get(a.supplierId)].some((x) => lower(x).includes(q)))
    .map((a) => {
      const byLoc = Object.fromEntries(locationsOf(doc).map((l) => [l.id, map.get(`${a.id}|${l.id}`) || 0]))
      const total = stockOf(doc.moves, a.id, null, map)
      const { open, draft } = onOrder(doc.orders, a.id)
      const status = stockStatus(total, a.min)
      return { article: a, total, byLoc, open, draft, status, value: r2(Math.max(0, total) * num(a.price)) }
    })
    .filter((r) => !only || (only === 'niedrig' ? r.status !== 'ok' : r.status === only))
    .sort((x, y) => x.article.category?.localeCompare(y.article.category || '') || x.article.name.localeCompare(y.article.name, 'de'))
}

/** Lagerwert (Bestand × Preis) gesamt. */
export const stockValue = (rows) => r2(rows.reduce((s, r) => s + r.value, 0))

// ---------------------------------------------------------------- Bestellvorschlag und Bestellungen

/** Menge auf ganze Packungen aufrunden. */
export const roundToPack = (qty, pack) => (num(pack) > 1 ? Math.ceil(qty / num(pack)) * num(pack) : Math.ceil(qty))

/**
 * Bestellvorschlag: Artikel mit Meldebestand, deren Bestand plus offene Bestellungen und Entwürfe
 * den Meldebestand erreicht oder unterschreitet. Menge bis zum Sollbestand (ohne Sollbestand: das
 * Doppelte des Meldebestands), auf Packungen gerundet. Gruppiert je Lieferant (ohne Lieferant: '').
 */
export function orderSuggestions(doc) {
  const map = stockMap(doc.moves)
  const groups = new Map()
  for (const a of doc.articles || []) {
    if (a.active === false || !(num(a.min) > 0)) continue
    const total = stockOf(doc.moves, a.id, null, map)
    const { open, draft } = onOrder(doc.orders, a.id)
    const available = total + open + draft
    if (available > num(a.min)) continue
    const target = num(a.target) > num(a.min) ? num(a.target) : num(a.min) * 2
    const qty = roundToPack(Math.max(target - available, 1), a.packSize)
    const key = a.supplierId || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ articleId: a.id, qty, price: num(a.price), total, open, draft, min: num(a.min), target })
  }
  return [...groups].map(([supplierId, lines]) => ({ supplierId, lines, sum: r2(lines.reduce((s, l) => s + l.qty * l.price, 0)) })).sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1))
}

/** Nächste Bestellnummer im Jahr: 2026-001, 2026-002, … */
export function nextOrderNo(orders = [], year) {
  const max = Math.max(0, ...orders.map((o) => String(o.no || '')).filter((no) => no.startsWith(`${year}-`)).map((no) => Number(no.slice(5)) || 0))
  return `${year}-${String(max + 1).padStart(3, '0')}`
}

/** Betrag einer Position (auf Cent). */
export const orderLineSum = (l) => r2(num(l.qty) * num(l.price))
/** Summe der Bestellung: Summe der gerundeten Positionen, damit sie zum Bestellschein passt. */
export const orderSum = (order) => r2((order.lines || []).reduce((s, l) => s + orderLineSum(l), 0))
export const isOverdue = (order, today) => OPEN_ORDER.includes(order.status) && !!order.expected && order.expected < today
export const openOrders = (orders = []) => orders.filter((o) => OPEN_ORDER.includes(o.status))

/**
 * Wareneingang: received = { Zeilennummer: Menge }. Liefert die geänderte Bestellung und die neuen
 * Buchungen (Zugang im Lager loc, Preis aus der Bestellung). Status: alles da → geliefert, sonst teilweise.
 */
export function receiveOrder(order, received, { loc = MAIN_LOCATION.id, date, at, by = '', newId }) {
  const moves = []
  const lines = (order.lines || []).map((l, i) => {
    const qty = Math.max(0, num(received[i]))
    if (!qty) return l
    moves.push({ id: newId(), at, date, kind: 'eingang', articleId: l.articleId, loc, qty: r3(qty), price: num(l.price), orderId: order.id, by, note: `Bestellung ${order.no}` })
    return { ...l, received: r3(num(l.received) + qty) }
  })
  const complete = lines.every((l) => num(l.received) >= num(l.qty))
  return { order: { ...order, lines, status: moves.length || order.status === 'teilweise' ? (complete ? 'geliefert' : 'teilweise') : order.status, deliveredAt: complete ? date : order.deliveredAt || null }, moves }
}

// ---------------------------------------------------------------- Ausgabe, Umbuchung, Inventur

/**
 * Ausgabe an ein Objekt oder eine Person: lines = [{ articleId, qty }] → Buchungen mit negativer Menge
 * und dem aktuellen Artikelpreis (für den Verbrauch je Objekt).
 */
export function issueMoves(lines, { articles = [], loc = MAIN_LOCATION.id, objectId = '', employeeId = '', requestId = '', date, at, by = '', note = '', newId }) {
  const price = new Map(articles.map((a) => [a.id, num(a.price)]))
  return lines
    .filter((l) => l.articleId && num(l.qty) > 0)
    .map((l) => ({ id: newId(), at, date, kind: 'ausgabe', articleId: l.articleId, loc, qty: -r3(num(l.qty)), price: price.get(l.articleId) || 0, objectId: objectId || '', employeeId: employeeId || '', requestId: requestId || '', by, note }))
}

/** Umbuchung zwischen zwei Lagern (zwei Buchungen mit gemeinsamer pair-Kennung). */
export function transferMoves(lines, { from, to, date, at, by = '', note = '', newId }) {
  const out = []
  for (const l of lines.filter((x) => x.articleId && num(x.qty) > 0)) {
    const pair = newId()
    out.push({ id: newId(), at, date, kind: 'umbuchung', articleId: l.articleId, loc: from, qty: -r3(num(l.qty)), pair, by, note })
    out.push({ id: newId(), at, date, kind: 'umbuchung', articleId: l.articleId, loc: to, qty: r3(num(l.qty)), pair, by, note })
  }
  return out
}

/**
 * Inventur: counts = { articleId: gezählte Menge } für ein Lager. Bucht nur Differenzen
 * (Art „inventur“); nicht gezählte Artikel (leer gelassen) bleiben unverändert.
 */
export function inventoryMoves(moves, counts, { loc, date, at, by = '', articles = [], newId }) {
  const map = stockMap(moves)
  const price = new Map(articles.map((a) => [a.id, num(a.price)]))
  const out = []
  for (const [articleId, counted] of Object.entries(counts)) {
    if (counted === '' || counted === null || counted === undefined || !Number.isFinite(Number(counted))) continue
    const diff = r3(Number(counted) - (map.get(`${articleId}|${loc}`) || 0))
    if (diff) out.push({ id: newId(), at, date, kind: 'inventur', articleId, loc, qty: diff, price: price.get(articleId) || 0, by, note: `gezählt ${r3(Number(counted))}` })
  }
  return out
}

/**
 * Alte Buchungen zusammenfassen, damit die Datei klein bleibt: alles vor `before` wird je Artikel und
 * Lager zu einer Buchung „saldo“ am Tag davor. Der Bestand bleibt gleich; der Verbrauch je Objekt
 * vor diesem Tag ist danach nicht mehr auswertbar.
 */
export function compactMoves(moves = [], before, { at, newId }) {
  const old = moves.filter((m) => m.date < before)
  if (!old.length) return moves
  const sums = stockMap(old)
  const saldo = [...sums].filter(([, qty]) => qty).map(([key, qty]) => {
    const [articleId, loc] = key.split('|')
    return { id: newId(), at, date: before, kind: 'saldo', articleId, loc, qty, by: '', note: `Übertrag aller Buchungen vor ${before}` }
  })
  return [...saldo, ...moves.filter((m) => m.date >= before)]
}

// ---------------------------------------------------------------- Verbrauch

/**
 * Ausgaben im Zeitraum: je Objekt (Wert, Positionen), je Person und je Kategorie. Wert = Menge × Preis
 * zum Zeitpunkt der Ausgabe.
 */
export function consumption(doc, { from, to }) {
  const articles = new Map((doc.articles || []).map((a) => [a.id, a]))
  const objects = new Map()
  const people = new Map()
  const categories = new Map()
  let total = 0
  for (const m of doc.moves || []) {
    if (m.kind !== 'ausgabe' || m.date < from || m.date > to) continue
    const qty = -num(m.qty)
    const value = r2(qty * num(m.price))
    total += value
    const a = articles.get(m.articleId)
    const cat = a?.category || 'Sonstiges'
    categories.set(cat, r2((categories.get(cat) || 0) + value))
    const bucket = (map, key) => {
      if (!map.has(key)) map.set(key, { key, value: 0, lines: new Map() })
      const b = map.get(key)
      b.value = r2(b.value + value)
      const line = b.lines.get(m.articleId) || { articleId: m.articleId, qty: 0, value: 0 }
      line.qty = r3(line.qty + qty)
      line.value = r2(line.value + value)
      b.lines.set(m.articleId, line)
    }
    if (m.objectId) bucket(objects, m.objectId)
    if (m.employeeId) bucket(people, m.employeeId)
    if (!m.objectId && !m.employeeId) bucket(objects, '')
  }
  const list = (map) => [...map.values()].map((b) => ({ id: b.key, value: b.value, lines: [...b.lines.values()].sort((x, y) => y.value - x.value) })).sort((x, y) => y.value - x.value)
  return { total: r2(total), objects: list(objects), people: list(people), categories: [...categories].map(([category, value]) => ({ category, value })).sort((a, b) => b.value - a.value) }
}

/**
 * Materialbudget eines Objekts im Monat aus der Kalkulation: kalkulierte Stunden × Zuschlag
 * „Material und Geräte“ je Stunde (calculation.js → calculate).
 */
export function materialBudget(calc) {
  if (!calc?.hours) return 0
  const step = (calc.steps || []).find((s) => /material/i.test(s.label))
  return r2(calc.hours * num(step?.amount))
}

// ---------------------------------------------------------------- Anforderungen

export const isOpenRequest = (r) => r.status === 'offen'
/** Noch nicht erledigt: offen oder bestellt (wartet auf die Lieferung, dann Ausgabe). */
export const isPendingRequest = (r) => r.status === 'offen' || r.status === 'bestellt'

/** Anforderung aus „Mein Dienstplan“ (Handy): Antrag der Art „Material“. */
export function requestFromPortal(a, { employeeId = null, objects = [], newId }) {
  const obj = objects.find((o) => o.id === a.objekt) || objects.find((o) => o.name === a.text)
  return {
    id: newId(),
    at: new Date((Number(a.erstellt) || 0) * 1000).toISOString(),
    source: 'handy',
    by: a.name || '',
    name: a.name || '',
    employeeId: employeeId || '',
    objectId: obj?.id || '',
    objectName: obj ? '' : String(a.text || ''),
    lines: [{ articleId: '', qty: 0, text: String(a.notiz || '').trim() }],
    note: '',
    status: 'offen',
    answer: '',
    portalId: a.id,
  }
}

/** Freitext einer Anforderung grob den Artikeln zuordnen („Müllsäcke 120“ → Müllsäcke 120 l). */
export function matchArticle(text, articles = []) {
  const t = lower(text).replace(/[^a-z0-9äöüß ]+/g, ' ')
  if (!t.trim()) return null
  let best = null
  for (const a of articles) {
    if (a.active === false) continue
    const words = lower(a.name).replace(/[^a-z0-9äöüß ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1)
    if (!words.length) continue
    const hits = words.filter((w) => t.includes(w)).length
    const score = hits / words.length
    if (hits && (!best || score > best.score)) best = { article: a, score }
  }
  return best && best.score >= 0.5 ? best.article : null
}

// ---------------------------------------------------------------- Bestell-Text

const money = (n) => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(num(n))
const qtyText = (n) => String(r3(num(n))).replace('.', ',')

/** Text der Bestell-E-Mail an den Lieferanten. */
export function orderMailText(order, { supplier = {}, articles = [], company = '', sender = '', deliveryAddress = '', contact = '', formatDate = (d) => d }) {
  const byId = new Map(articles.map((a) => [a.id, a]))
  const lines = (order.lines || []).map((l) => {
    const a = byId.get(l.articleId) || {}
    return `- ${qtyText(l.qty)} ${a.unit || 'Stk'} ${a.name || l.articleId}${a.articleNo ? ` (Art.-Nr. ${a.articleNo})` : ''}`
  })
  return [
    supplier.contact ? `Guten Tag ${supplier.contact},` : 'Sehr geehrte Damen und Herren,',
    '',
    `wir bestellen${supplier.customerNo ? ` (Kundennummer ${supplier.customerNo})` : ''}:`,
    '',
    ...lines,
    '',
    order.expected ? `Gewünschte Lieferung bis ${formatDate(order.expected)}.` : '',
    deliveryAddress ? `Lieferadresse: ${deliveryAddress}` : '',
    contact ? `Rückfragen: ${contact}` : '',
    order.note ? `\n${order.note}` : '',
    '',
    `Bitte bestätigen Sie die Bestellung ${order.no} kurz per E-Mail. Die Bestellung liegt auch als PDF bei.`,
    '',
    'Mit freundlichen Grüßen',
    sender || '',
    company || '',
  ]
    .filter((x, i, all) => x !== '' || all[i - 1] !== '')
    .join('\n')
    .trim()
}

export { money as euro }

// ---------------------------------------------------------------- Artikel aus Excel

const NAMES = {
  name: ['artikel', 'bezeichnung', 'name', 'material'],
  unit: ['einheit', 'me', 'mengeneinheit'],
  category: ['kategorie', 'gruppe', 'warengruppe'],
  supplier: ['lieferant', 'hersteller', 'handler', 'haendler'],
  articleNo: ['artikelnummer', 'artnr', 'artikelnr', 'nummer', 'nr'],
  price: ['preis', 'einzelpreis', 'ek', 'einkaufspreis', 'preisnetto'],
  min: ['mindestbestand', 'meldebestand', 'min'],
  target: ['sollbestand', 'hochstbestand', 'hoechstbestand', 'soll', 'max'],
  packSize: ['packung', 'verpackungseinheit', 've', 'gebinde'],
  stock: ['bestand', 'menge', 'lagerstand'],
}
const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const toNum = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Artikelliste aus Excel (kopieren und einfügen) oder CSV mit Semikolon. Spalten nach Überschrift:
 * Artikel, Einheit, Kategorie, Lieferant, Artikelnummer, Preis, Mindestbestand, Sollbestand, Packung, Bestand.
 * Liefert [{ name, unit, category, supplier, articleNo, price, min, target, packSize, stock }].
 */
export function parseArticles(text) {
  return parseTable(text)
    .map((row) => {
      const get = (field) => {
        const key = Object.keys(row).find((k) => NAMES[field].includes(norm(k)))
        return key === undefined ? '' : String(row[key] ?? '').trim()
      }
      const category = CATEGORIES.find((c) => lower(c) === lower(get('category'))) || CATEGORIES.find((c) => get('category') && lower(c).startsWith(lower(get('category')).slice(0, 4))) || 'Sonstiges'
      return { name: get('name'), unit: get('unit') || 'Stk', category, supplier: get('supplier'), articleNo: get('articleNo'), price: toNum(get('price')), min: toNum(get('min')), target: toNum(get('target')), packSize: toNum(get('packSize')), stock: toNum(get('stock')) }
    })
    .filter((a) => a.name)
}
