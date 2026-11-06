// Kosten weiterverrechnen: Eingangsrechnungen (Material, Subunternehmer) und Barausgaben aus dem Kassenbuch an einen
// Kunden der Fakturierung weitergeben, mit Aufschlag. Reine Funktionen (Oberfläche: ui/views/weiterverrechnung.js und
// ui/views/invoicing.js, Tests: test/recharge.test.js).
//
// Datenmodell (alle Felder optional, alte Dateien bleiben gültig):
//  einkauf.invoices[].recharge und kasse.entries[].recharge (nur Ausgaben ohne Bezug auf eine Eingangsrechnung)
//    { customerId, customer (Name beim Erfassen, für Rollen ohne Fakturierung), objectId, amount (Kosten netto, die
//      weiterverrechnet werden; Vorschlag: Netto des Belegs), markup (Aufschlag in %), text (eigener Text der Position),
//      status ('offen' | 'nicht'), reason (Grund bei „nicht verrechnen“), billed { docId, number, date } (Stand aus
//      der Fakturierung, von syncBilled geschrieben), by, at }
//    Im Kassenbuch zählt recharge nicht zur Prüfsumme (wie der nachgereichte Beleg): die Buchung bleibt unverändert.
//  fakturierung.documents[].lines[].source { type: 'einkauf' | 'kasse', id }: Position aus einer Weiterverrechnung.
//    Zeilen gehören zur Prüfsumme; source steht nur in neuen Belegen, festgeschriebene ändert niemand.
//
// Zustand (aus den Belegen der Fakturierung abgeleitet, nicht gespeichert):
//  offen       in keiner Rechnung
//  entwurf     Position in einem Rechnungsentwurf (vergeben, aber noch nicht verrechnet)
//  verrechnet  Position in einer festgeschriebenen, nicht stornierten Rechnung (mit Nummer)
//  nicht       „nicht verrechnen“ (mit Grund), z. B. Kulanz oder im Pauschalpreis enthalten
// Storno: Wird die Rechnung mit einer Stornorechnung zurückgenommen, ist die Weiterverrechnung wieder offen (neu
// verrechnen oder „nicht verrechnen“). Ein gelöschter Entwurf gibt sie ebenfalls frei. Eine Rechnungskorrektur ändert
// nichts: die Kosten bleiben verrechnet. Wer die Fakturierung nicht lesen darf (nur Einkauf & Kasse), sieht den Stand
// aus billed; ihn schreibt die App beim Festschreiben und beim Öffnen des Einkaufs mit, sobald jemand mit beiden
// Rechten arbeitet.

import { isCancelled as cashCancelled } from './cashbook.js'
import { deDate, isCancelled, lineType, parseNumber, round2 } from './invoicing.js'
import { invoiceTotals } from './purchase.js'

export const RECHARGE_MARKUP = 10 // Vorschlag für den Aufschlag in %, Einstellung der Fakturierung: settings.rechargeMarkup
export const RECHARGE_STATE = { offen: 'offen', entwurf: 'im Entwurf', verrechnet: 'verrechnet', nicht: 'nicht verrechnen' }
export const SOURCE_TYPES = { einkauf: 'Eingangsrechnung', kasse: 'Kassenbuch' }

/** Aufschlag laut Einstellungen der Fakturierung (fehlt die Einstellung oder ist sie nicht lesbar: 10 %). */
export function markupDefault(settings = {}) {
  const v = settings?.rechargeMarkup
  return v === undefined || v === null || v === '' ? RECHARGE_MARKUP : Math.max(0, parseNumber(v))
}

const key = (type, id) => `${type}:${id}`

/** Belege, die sich weiterverrechnen lassen: Eingangsrechnungen (nicht storniert) und Barausgaben (ohne Storno, ohne Bezug). */
export function rechargeSources({ purchase = null, cash = null } = {}) {
  const out = []
  for (const inv of purchase?.invoices || []) {
    if (inv.cancelled) continue
    out.push({ type: 'einkauf', id: inv.id, ref: inv.no || '', supplier: inv.supplier?.name || '', number: inv.number || '', date: inv.date || '', text: inv.text || '', net: invoiceTotals(inv).net, objectId: inv.objectId || '', recharge: inv.recharge || null, target: inv })
  }
  for (const e of cash?.entries || []) {
    if (e.kind !== 'ausgabe' || (e.type && e.type !== 'buchung') || e.ref || cashCancelled(cash, e.id)) continue
    out.push({ type: 'kasse', id: e.id, ref: `Kassenbuch Nr. ${e.no}`, supplier: '', number: e.receipt || '', date: e.date || '', text: e.text || '', net: round2(parseNumber(e.amount) - parseNumber(e.vat)), objectId: '', recharge: e.recharge || null, target: e })
  }
  return out
}

/** Positionen aus Weiterverrechnungen in Rechnungen: Map „type:id“ → [Beleg]. */
function billedIn(docs = []) {
  const map = new Map()
  for (const d of docs) {
    if (d.kind !== 'rechnung') continue
    for (const l of d.lines || []) if (l.source?.type && l.source.id) map.set(key(l.source.type, l.source.id), [...(map.get(key(l.source.type, l.source.id)) || []), d])
  }
  return map
}

/**
 * Zustand einer Weiterverrechnung: { state, docId?, number?, date? } oder null (keine Weiterverrechnung).
 * docs: Belege der Fakturierung; null = nicht lesbar (dann gilt billed).
 */
export function rechargeState(src, docs, index = null) {
  const r = src?.recharge
  if (!r) return null
  if (r.status === 'nicht') return { state: 'nicht' }
  if (!docs) return r.billed?.number ? { state: 'verrechnet', docId: r.billed.docId || '', number: r.billed.number, date: r.billed.date || '' } : { state: 'offen' }
  const hits = (index || billedIn(docs)).get(key(src.type, src.id)) || []
  const fixed = hits.find((d) => d.number && !isCancelled(d, docs))
  if (fixed) return { state: 'verrechnet', docId: fixed.id, number: fixed.number, date: fixed.date || '' }
  const draft = hits.find((d) => !d.number)
  if (draft) return { state: 'entwurf', docId: draft.id }
  return { state: 'offen' }
}

/** Beträge: { cost (Kosten netto), markup (%), net (Kosten × (1 + Aufschlag), auf Cent) }. */
export function rechargeAmount(r = {}) {
  const cost = round2(parseNumber(r.amount))
  const markup = Math.max(0, parseNumber(r.markup))
  return { cost, markup, net: round2(cost * (1 + markup / 100)) }
}

/**
 * Alle Weiterverrechnungen mit Zustand und Beträgen: [{ …Quelle, state, doc, amount }], neueste zuerst.
 * customerId: nur die eines Kunden; states: nur diese Zustände.
 */
export function rechargeList({ purchase = null, cash = null, docs = null, customerId = '', states = null } = {}) {
  const index = docs ? billedIn(docs) : null
  return rechargeSources({ purchase, cash })
    .filter((s) => s.recharge && (!customerId || s.recharge.customerId === customerId))
    .map((s) => {
      const st = rechargeState(s, docs, index)
      return { ...s, state: st.state, doc: st.docId ? { id: st.docId, number: st.number || '', date: st.date || '' } : null, amount: rechargeAmount(s.recharge) }
    })
    .filter((x) => !states || states.includes(x.state))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.ref).localeCompare(String(b.ref)))
}

/** Offene Weiterverrechnungen (noch in keiner Rechnung, nicht „nicht verrechnen“). */
export const openRecharges = (data = {}) => rechargeList({ ...data, states: ['offen'] })

/** Text der Position: eigener Text bzw. die Leistung des Belegs; darunter Lieferant, Belegnummer und Datum. */
export function rechargeTexts(src) {
  const r = src.recharge || {}
  const text = String(r.text || '').trim() || String(src.text || '').trim() || (src.type === 'kasse' ? 'Barauslage' : 'Material und Fremdleistung')
  const beleg = src.type === 'kasse' ? [src.number ? `Beleg ${src.number}` : '', src.ref].filter(Boolean).join(', ') : src.number ? `Rechnung ${src.number}` : src.ref
  const longText = [src.supplier, beleg, src.date ? `vom ${deDate(src.date)}` : ''].filter(Boolean).join(', ').replace(/, vom /, ' vom ')
  return { text, longText }
}

/** Position für die Rechnung: Menge 1, Preis = Kosten × (1 + Aufschlag), Steuersatz wie jede Position (vat). */
export function rechargeLine(src, { id, vat = 20 } = {}) {
  const { text, longText } = rechargeTexts(src)
  return { id, text, ...(longText ? { longText } : {}), qty: 1, unit: 'Pauschale', price: rechargeAmount(src.recharge).net, vat, discount: 0, source: { type: src.type, id: src.id } }
}

/**
 * Weiterverrechnungen als Positionen in einen Rechnungsentwurf: leere letzte Position wird ersetzt, schon enthaltene
 * kommen nicht doppelt. Liefert die Zahl der neuen Positionen.
 */
export function addRechargeLines(draft, sources, { newId, vat = 20 } = {}) {
  if (draft.number) throw new Error('Beleg ist schon festgeschrieben.')
  if (draft.kind !== 'rechnung') throw new Error('Weiterverrechnungen gehören in eine Rechnung.')
  draft.lines ||= []
  const have = new Set(draft.lines.filter((l) => l.source?.id).map((l) => key(l.source.type, l.source.id)))
  const fresh = sources.filter((s) => s.recharge && !have.has(key(s.type, s.id)))
  for (const s of fresh) {
    const line = rechargeLine(s, { id: newId(), vat })
    const empty = draft.lines.findIndex((l) => lineType(l) === 'item' && !String(l.text || '').trim() && !parseNumber(l.price))
    if (empty >= 0) draft.lines[empty] = line
    else draft.lines.push(line)
  }
  return fresh.length
}

/** Zeilen ohne Bezug auf die Weiterverrechnung (Vorlage kopieren: die Kosten nicht ein zweites Mal verrechnen). */
export const withoutSource = (lines = []) => lines.map((l) => {
  if (!l.source) return l
  const { source, ...rest } = l
  return rest
})

/**
 * Vor dem Festschreiben: Weiterverrechnungen im Entwurf, die schon anderswo verrechnet, auf „nicht verrechnen“ gesetzt
 * oder einem anderen Kunden zugeordnet sind (z. B. gleichzeitig von zwei Personen). sources: rechargeSources() oder
 * null (Einkauf nicht lesbar: dann nur die Prüfung über die Belege). Liefert Meldungen (leer: in Ordnung).
 */
export function rechargeConflicts(draft, docs = [], sources = null) {
  const out = []
  if (draft.kind !== 'rechnung') return out // Storno und Korrektur nehmen zurück, sie verrechnen nichts
  const index = billedIn(docs.filter((d) => d.id !== draft.id))
  const byKey = new Map((sources || []).map((s) => [key(s.type, s.id), s]))
  for (const l of draft.lines || []) {
    if (!l.source?.id) continue
    const k = key(l.source.type, l.source.id)
    const label = byKey.get(k)?.ref || l.text || 'Weiterverrechnung'
    const other = (index.get(k) || []).find((d) => d.number && !isCancelled(d, docs))
    if (other) {
      out.push(`${label} ist schon mit ${other.number} verrechnet: Position entfernen.`)
      continue
    }
    if (!sources) continue
    const src = byKey.get(k)
    if (!src || !src.recharge) out.push(`${label}: die Weiterverrechnung gibt es im Einkauf nicht mehr (Beleg storniert oder Weiterverrechnung entfernt). Position entfernen.`)
    else if (src.recharge.status === 'nicht') out.push(`${label} steht auf „nicht verrechnen“: Position entfernen oder im Einkauf wieder öffnen.`)
    else if (draft.customerId && src.recharge.customerId && src.recharge.customerId !== draft.customerId) out.push(`${label} ist für einen anderen Kunden (${src.recharge.customer || 'siehe Einkauf'}) vorgesehen.`)
  }
  return out
}

/**
 * Eingaben prüfen: Meldungen (leer: in Ordnung). fields: { customerId, amount, markup, status, reason }; net: Netto des
 * Belegs (Kosten über dem Netto: Hinweis, kein Fehler).
 */
export function rechargeProblems(fields = {}, net = null) {
  const out = []
  if (fields.status === 'nicht') {
    if (!String(fields.reason || '').trim()) out.push('Bitte den Grund angeben, warum nicht verrechnet wird.')
    return out
  }
  if (!fields.customerId) out.push('Bitte den Kunden wählen.')
  const amount = round2(parseNumber(fields.amount))
  if (!(amount > 0)) out.push('Bitte die Kosten (netto) über 0 eingeben.')
  if (parseNumber(fields.markup) < 0) out.push('Der Aufschlag darf nicht negativ sein.')
  if (net !== null && net > 0 && amount > round2(net) + 0.004) out.push(`Die Kosten sind höher als der Beleg netto (${round2(net).toFixed(2).replace('.', ',')} €).`)
  return out
}

/**
 * Weiterverrechnung setzen oder ändern (Zustand offen) bzw. „nicht verrechnen“. Wirft bei Fehlern oder wenn sie schon in
 * einem Entwurf steht bzw. verrechnet ist. target: Eingangsrechnung oder Kassenbuch-Eintrag; state: aktueller Zustand.
 */
export function setRecharge(target, fields, { state = null, net = null, customerName = '', by = '', at = new Date().toISOString() } = {}) {
  if (state === 'verrechnet') throw new Error('Schon verrechnet: Änderungen nur über ein Storno der Rechnung.')
  if (state === 'entwurf') throw new Error('Steht schon in einem Rechnungsentwurf: dort die Position entfernen, dann ändern.')
  const nicht = fields.status === 'nicht'
  const list = rechargeProblems(fields, nicht ? null : net)
  if (list.length) throw new Error(list[0])
  const before = target.recharge || {}
  target.recharge = nicht
    ? { ...before, status: 'nicht', reason: String(fields.reason).trim(), by, at }
    : {
        customerId: fields.customerId,
        customer: customerName || before.customer || '',
        ...(fields.objectId ? { objectId: fields.objectId } : {}),
        amount: round2(parseNumber(fields.amount)),
        markup: Math.max(0, parseNumber(fields.markup)),
        ...(String(fields.text || '').trim() ? { text: String(fields.text).trim() } : {}),
        status: 'offen',
        by,
        at,
      }
  delete target.recharge.billed
  return target.recharge
}

/**
 * „nicht verrechnen“ zurücknehmen: wieder offen (Kunde und Beträge bleiben). War noch kein Kunde gewählt, ist danach
 * keine Weiterverrechnung mehr eingetragen (sie wird neu angelegt).
 */
export function reopenRecharge(target, { by = '', at = new Date().toISOString() } = {}) {
  if (!target.recharge || target.recharge.status !== 'nicht') return false
  const { reason, ...rest } = target.recharge
  if (!rest.customerId) delete target.recharge
  else target.recharge = { ...rest, status: 'offen', by, at }
  return true
}

/** Weiterverrechnung entfernen (nur offen oder „nicht verrechnen“). */
export function removeRecharge(target, { state = null } = {}) {
  if (state === 'verrechnet' || state === 'entwurf') throw new Error(state === 'verrechnet' ? 'Schon verrechnet: bleibt stehen.' : 'Steht in einem Rechnungsentwurf: dort zuerst die Position entfernen.')
  if (!target.recharge) return false
  delete target.recharge
  return true
}

/**
 * Stand der Fakturierung in den Einkauf schreiben (billed), damit Rollen ohne Fakturierung „verrechnet mit …“ sehen.
 * Liefert die Zahl der geänderten Belege.
 */
export function syncBilled({ purchase = null, cash = null, docs = [] } = {}) {
  const index = billedIn(docs)
  let n = 0
  for (const s of rechargeSources({ purchase, cash })) {
    const r = s.recharge
    if (!r) continue
    const st = rechargeState(s, docs, index)
    if (st.state === 'verrechnet') {
      if (r.billed?.docId === st.docId && r.billed?.number === st.number) continue
      s.target.recharge = { ...r, billed: { docId: st.docId, number: st.number, date: st.date } }
      n++
    } else if (r.billed) {
      const { billed, ...rest } = r
      s.target.recharge = rest
      n++
    }
  }
  return n
}
