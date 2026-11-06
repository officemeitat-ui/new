// Prüfungen der Anlagen in die Fakturierung übernehmen (Anlagen & Prüffristen ↔ Fakturierung), nach dem Muster der
// Weiterverrechnung (core/recharge.js) und des Regieberichts (core/regie.js). Reine Funktionen (Oberfläche:
// ui/views/anlagen.js, Reiter „Verrechnung“; Festschreiben in ui/views/invoicing.js; Tests: test/anlagen.test.js).
//
// Datenmodell (alle Felder optional, alte Dateien bleiben gültig):
//  anlagen.checks[]  billable, price (beim Erfassen vermerkt), billed { docId, number, date } (Stand aus der
//                    Fakturierung, von syncAnlagenBilled geschrieben, damit Rollen ohne Fakturierung „verrechnet mit …“
//                    sehen)
//  fakturierung.documents[].lines[].source { type: 'anlage', id: <Prüfung> }  Position aus einer Prüfung. Zeilen gehören
//                    zur Prüfsumme; source steht nur in neuen Belegen, festgeschriebene ändert niemand.
//
// Zustand (aus den Belegen der Fakturierung abgeleitet, nicht gespeichert):
//  offen       verrechenbar, in keiner Rechnung
//  entwurf     Position in einem Rechnungsentwurf (vergeben, aber noch nicht verrechnet)
//  verrechnet  Position in einer festgeschriebenen, nicht stornierten Rechnung (mit Nummer)
// Wird der Entwurf gelöscht oder die Rechnung storniert, ist die Prüfung wieder offen. Eine Rechnungskorrektur ändert
// nichts (die Prüfung bleibt verrechnet).

import { typeOf } from './anlagen.js'
import { customerForObject, customerName, deDate, isCancelled, lineType, parseNumber, round2 } from './invoicing.js'

export const ANLAGE_STATES = { offen: 'offen', entwurf: 'im Entwurf', verrechnet: 'verrechnet' }
export const SOURCE_TYPE = 'anlage'

const isAnlage = (l) => l?.source?.type === SOURCE_TYPE && !!l.source.id

/** Positionen aus Prüfungen in Rechnungen: Map Prüfung → [Beleg]. */
export function anlageIndex(docs = []) {
  const map = new Map()
  for (const d of docs) {
    if (d.kind !== 'rechnung') continue
    for (const l of d.lines || []) if (isAnlage(l)) map.set(l.source.id, [...(map.get(l.source.id) || []), d])
  }
  return map
}

/**
 * Zustand einer Prüfung: { state: offen | entwurf | verrechnet, docId?, number?, date? }; null, wenn sie nicht
 * verrechenbar ist. docs: Belege der Fakturierung; null = nicht lesbar (dann gilt billed).
 */
export function checkBillState(check, docs, index = null) {
  if (!check?.billable) return null
  if (!docs) return check.billed?.number ? { state: 'verrechnet', docId: check.billed.docId || '', number: check.billed.number, date: check.billed.date || '' } : { state: 'offen' }
  const hits = (index || anlageIndex(docs)).get(check.id) || []
  const fixed = hits.find((d) => d.number && !isCancelled(d, docs))
  if (fixed) return { state: 'verrechnet', docId: fixed.id, number: fixed.number, date: fixed.date || '' }
  const draft = hits.find((d) => !d.number)
  if (draft) return { state: 'entwurf', docId: draft.id }
  return { state: 'offen' }
}

/**
 * Verrechenbare Prüfungen je Kunde der Fakturierung (Kunde des Objekts), nur im Zustand states (Standard: offen):
 * [{ customerId, customer (oder null), name, rows: [{ check, item, type, object, state }], sum, from, to }].
 * Prüfungen ohne Kunden zum Objekt stehen unter customerId ''. Sortiert nach Kundenname (ohne Kunde zuletzt),
 * Zeilen nach Objekt und Datum.
 */
export function checksToBill({ doc, objects = [], fak, states = ['offen'] }) {
  const items = new Map((doc?.items || []).map((i) => [i.id, i]))
  const byObj = new Map(objects.map((o) => [o.id, o]))
  const docs = fak ? fak.documents || [] : null
  const index = docs ? anlageIndex(docs) : null
  const groups = new Map()
  for (const check of doc?.checks || []) {
    const item = items.get(check.itemId)
    if (!item || !check.billable) continue
    const st = checkBillState(check, docs, index)
    if (!st || !states.includes(st.state)) continue
    const cu = fak ? customerForObject(fak, item.objectId) : null
    const key = cu?.id || ''
    if (!groups.has(key)) groups.set(key, { customerId: key, customer: cu, name: cu ? customerName(cu) : '', rows: [], sum: 0, from: '', to: '' })
    const g = groups.get(key)
    g.rows.push({ check, item, type: typeOf(doc, item.typeId), object: byObj.get(item.objectId) || null, state: st })
    g.sum = round2(g.sum + (Number(check.price) || 0))
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => (a.object?.name || '').localeCompare(b.object?.name || '', 'de') || String(a.check.date).localeCompare(String(b.check.date)))
    const dates = g.rows.map((r) => r.check.date).filter(Boolean).sort()
    g.from = dates[0] || ''
    g.to = dates.at(-1) || ''
  }
  return [...groups.values()].sort((a, b) => Number(!a.customerId) - Number(!b.customerId) || a.name.localeCompare(b.name, 'de'))
}

/**
 * Position für die Rechnung: eine je Prüfung mit Anlage (Art und Standort), Objekt und Datum; Preis wie beim Erfassen.
 * „Prüfung Feuerlöscher: Stiege 2, EG (6 Stück)“, Langtext „Wohnanlage Lehen · geprüft am 12.10.2026“.
 */
export function anlageLine({ check, item, type, object }, { id, vat = 20 } = {}) {
  const what = check.kind === 'operativ' ? 'Operative Inspektion' : 'Prüfung'
  const count = Number(item?.count) > 1 ? ` (${item.count} Stück)` : ''
  return {
    id,
    text: `${what} ${type?.name || 'Anlage'}${item?.label ? `: ${item.label}` : ''}${count}`,
    longText: `${object?.name || 'Objekt'} · geprüft am ${deDate(check.date)}`,
    qty: 1,
    unit: 'Pauschale',
    price: round2(Number(check.price) || 0),
    vat,
    discount: 0,
    source: { type: SOURCE_TYPE, id: check.id },
  }
}

/**
 * Prüfungen als Positionen in einen Rechnungsentwurf: leere letzte Position wird ersetzt, schon enthaltene kommen nicht
 * doppelt. rows wie aus checksToBill. Liefert die Zahl der neuen Positionen.
 */
export function addAnlageLines(draft, rows, { newId, vat = 20 } = {}) {
  if (draft.number) throw new Error('Beleg ist schon festgeschrieben.')
  if (draft.kind !== 'rechnung') throw new Error('Prüfungen gehören in eine Rechnung.')
  draft.lines ||= []
  const have = new Set(draft.lines.filter(isAnlage).map((l) => l.source.id))
  const fresh = rows.filter((r) => r.check?.billable && !have.has(r.check.id))
  for (const r of fresh) {
    const line = anlageLine(r, { id: newId(), vat })
    const empty = draft.lines.findIndex((l) => lineType(l) === 'item' && !String(l.text || '').trim() && !parseNumber(l.price))
    if (empty >= 0) draft.lines[empty] = line
    else draft.lines.push(line)
  }
  return fresh.length
}

/**
 * Vor dem Festschreiben: Prüfungen im Entwurf, die schon mit einer anderen Rechnung verrechnet sind (z. B. gleichzeitig
 * von zwei Personen), gelöscht oder nicht mehr verrechenbar. checks: Prüfungen der Anlagen oder null (nicht lesbar: nur
 * die Prüfung über die Belege). Liefert Meldungen (leer: in Ordnung).
 */
export function anlageConflicts(draft, docs = [], checks = null) {
  if (draft?.kind !== 'rechnung') return [] // Storno und Korrektur nehmen zurück, sie verrechnen nichts
  const out = []
  const index = anlageIndex(docs.filter((d) => d.id !== draft.id))
  const byId = new Map((checks || []).map((c) => [c.id, c]))
  for (const l of draft.lines || []) {
    if (!isAnlage(l)) continue
    const label = l.text || 'Prüfung'
    const other = (index.get(l.source.id) || []).find((d) => d.number && !isCancelled(d, docs))
    if (other) {
      out.push(`${label} ist schon mit ${other.number} verrechnet: Position entfernen.`)
      continue
    }
    if (!checks) continue
    const c = byId.get(l.source.id)
    if (!c) out.push(`${label}: die Prüfung gibt es unter „Anlagen & Prüffristen“ nicht mehr. Position entfernen.`)
    else if (!c.billable) out.push(`${label} ist nicht mehr als verrechenbar eingetragen: Position entfernen.`)
  }
  return out
}

/**
 * Stand der Fakturierung in die Prüfungen schreiben (billed), damit Rollen ohne Fakturierung „verrechnet mit …“ sehen;
 * nach einem Storno wieder weg. Liefert die Zahl der geänderten Prüfungen.
 */
export function syncAnlagenBilled(checks = [], docs = []) {
  const index = anlageIndex(docs)
  let n = 0
  for (const c of checks) {
    const st = checkBillState(c, docs, index)
    if (st?.state === 'verrechnet') {
      if (c.billed?.docId === st.docId && c.billed?.number === st.number) continue
      c.billed = { docId: st.docId, number: st.number, date: st.date }
      n++
    } else if (c.billed) {
      delete c.billed
      n++
    }
  }
  return n
}

/** Prüfung löschen erlaubt? Steht sie in einem Entwurf oder in einer Rechnung: Hinweis, sonst ''. */
export function anlageLock(check, docs) {
  const st = checkBillState(check, docs)
  if (st?.state === 'verrechnet') return `Mit ${st.number} verrechnet: die Prüfung bleibt (zuerst die Rechnung stornieren).`
  if (st?.state === 'entwurf') return 'Steht in einem Rechnungsentwurf: zuerst dort die Position entfernen oder den Entwurf löschen.'
  return ''
}
