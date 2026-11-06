// Umsatzsteuer-Übersicht für die Umsatzsteuervoranmeldung (UVA, Formular U30): Umsatzsteuer aus festgeschriebenen
// Rechnungen, Stornorechnungen und Rechnungskorrekturen je Steuersatz, Skonto als Entgeltminderung, Reverse-Charge-
// Umsätze, Vorsteuer aus Eingangsrechnungen je Steuersatz, Reverse Charge als Empfänger (Steuer und gleich hohe
// Vorsteuer), Kassenbuch, Zahllast bzw. Gutschrift. Reine Funktionen (Oberfläche: ui/views/uva.js, PDF:
// export/uva-pdf.js, Tests: test/vat-return.test.js). Eine Hilfe für die Buchhaltung, keine Steuerberatung.
//
// Annahmen (stehen auch in der Ansicht; mit der Steuerberatung abstimmen, docs/RECHTSPRUEFUNG.md offener Punkt 27):
//  - Sollbesteuerung (Standard): Rechnung, Storno und Korrektur zählen im Monat des Rechnungsdatums (vereinfacht;
//    genau entsteht die Steuer mit Ablauf des Monats der Leistung, bei späterer Rechnung einen Monat später,
//    § 19 Abs 2 Z 1 lit a UStG). Abschlagsrechnungen ebenso nach Rechnungsdatum, mit Hinweis, wenn sie im Zeitraum
//    noch nicht bezahlt sind (Steuer entsteht erst mit der Zahlung). Skonto mindert im Monat der Zahlung (§ 16 Abs 1).
//    Vorsteuer nach Rechnungsdatum, Skonto der Lieferanten mindert sie im Monat der Zahlung.
//  - Istbesteuerung (§ 17 UStG): Umsatzsteuer nach Zahlungseingang, jede Zahlung anteilig auf die Steuersätze der
//    Rechnung; Skonto, Storno und Korrektur wirken über die Zahlungen (es geht weniger Geld ein). Rücklastschriften
//    zählen negativ. Vorsteuer erst mit der Zahlung (§ 12 Abs 1 Z 1 lit a UStG).
//  - Reverse Charge als Empfänger (§ 19 Abs 1a, Bauleistungen): Steuer und Vorsteuer im Monat des Rechnungsdatums,
//    auch bei Istbesteuerung.
//  - Kassenbuch: Einnahmen mit Steuer (Barverkauf) als Umsatz, Ausgaben mit Steuer (Barkauf) als Vorsteuer, nach dem
//    Datum der Buchung; Storno mit umgekehrtem Vorzeichen. Zahlungen von Rechnungen (Bezug) zählen dort nicht doppelt.
//  - Kennzahlen des U30 nur, wo sicher: 000, 021, 022 (20 %), 029 (10 %), 006 (13 %), 048, 060, 082.

import { isInvoice, kindLabel, parseNumber, round2, settingsOf, skontoSplit, totals } from './invoicing.js'
import { invoiceProblems, invoiceTotals, skontoSplitPurchase, vatDeductible } from './purchase.js'

export const VAT_BASIS = { soll: 'Sollbesteuerung (nach Rechnungsdatum)', ist: 'Istbesteuerung (nach Zahlungseingang)' }
/** Kennzahlen des Formulars U30 (nur die sicheren; mit der Steuerberatung abstimmen). */
export const KZ = { total: '000', rcOut: '021', 20: '022', 10: '029', 13: '006', rcTax: '048', input: '060', rcInput: '082' }

const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const lastDay = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10)
const de = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '')

/** Besteuerungsart aus den Einstellungen der Fakturierung: 'soll' (Standard) oder 'ist'. */
export const vatBasisOf = (settings = {}) => (settings?.vatBasis === 'ist' ? 'ist' : 'soll')

/**
 * Zeitraum: mode 'monat' (value 'JJJJ-MM') oder 'quartal' (value 'JJJJ-Qn' oder ein Monat daraus).
 * Liefert { from, to, label, mode, value }.
 */
export function periodRange(mode, value) {
  const v = String(value || '')
  if (mode === 'quartal') {
    const m = /^(\d{4})-(?:Q([1-4])|(\d{2}))$/.exec(v)
    if (!m) throw new Error('Ungültiges Quartal.')
    const q = m[2] ? Number(m[2]) : Math.floor((Number(m[3]) - 1) / 3) + 1
    const first = `${m[1]}-${String(q * 3 - 2).padStart(2, '0')}`
    const last = `${m[1]}-${String(q * 3).padStart(2, '0')}`
    return { mode, value: `${m[1]}-Q${q}`, from: `${first}-01`, to: lastDay(last), label: `${q}. Quartal ${m[1]}` }
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new Error('Ungültiger Monat.')
  return { mode: 'monat', value: v, from: `${v}-01`, to: lastDay(v), label: `${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}` }
}

const blank = () => ({ net: 0, vat: 0 })
const addTo = (o, net, vat = 0) => {
  o.net = round2(o.net + net)
  o.vat = round2(o.vat + vat)
}
/** Steuersatz-Topf: { 20: { net, vat }, … } */
const pot = (map, rate) => (map[rate] ||= blank())

/**
 * Umsatzsteuer und Vorsteuer im Zeitraum.
 *  docs      Belege der Fakturierung (null: nicht lesbar), settings: Einstellungen der Fakturierung
 *  purchase  einkauf.json (null: nicht lesbar), cash: kassenbuch.json (null: nicht lesbar)
 *  basis     'soll' | 'ist'
 * Liefert { from, to, basis, has, sales, input, totals, rows, notes }:
 *  sales  { rates: { Satz: { net, vat } }, free { net }, rc { net }, skonto { net, vat }, cash { net, vat } }
 *  input  { rates, rc { net, vat } (Bemessungsgrundlage und Steuer), skonto, cash }
 *  totals { base (KZ 000), salesVat (Umsatzsteuer der Steuersätze), rcTax (KZ 048), tax (Summe Umsatzsteuer),
 *           input (KZ 060), rcInput (KZ 082), inputTotal, payable (> 0 Zahllast, < 0 Gutschrift), complete }
 *  rows   Belege im Detail [{ area ('ust' | 'vst' | 'kasse'), date, ref, partner, kind, rate, net, vat, kz }]
 *  notes  Hinweise zu den Daten des Zeitraums (fehlende Rechte, offene Abschläge, Vorsteuer fraglich …)
 */
export function vatReturn({ docs = null, settings = {}, purchase = null, cash = null, from, to, basis = 'soll' } = {}) {
  const s = settingsOf({ settings })
  const ist = basis === 'ist'
  const inPeriod = (date) => !!date && date >= from && date <= to
  const sales = { rates: {}, free: blank(), rc: blank(), skonto: blank(), cash: blank() }
  const input = { rates: {}, rc: blank(), skonto: blank(), cash: blank() }
  const rows = []
  const notes = []

  // ------------------------------------------------ Umsatzsteuer aus der Fakturierung
  const addSale = (d, { rate, net, vat }, row) => {
    const rc = !!d.reverseCharge
    const free = !rc && !(rate > 0)
    if (rc) addTo(sales.rc, net)
    else if (free) addTo(sales.free, net)
    else addTo(pot(sales.rates, rate), net, vat)
    rows.push({ area: 'ust', date: row.date, ref: d.number, partner: d.recipient?.name || '', kind: row.kind, rate: rc || free ? 0 : rate, net: round2(net), vat: rc || free ? 0 : round2(vat), kz: rc ? KZ.rcOut : free ? '' : KZ[rate] || '' })
    return { rc, free }
  }
  if (docs) {
    for (const d of docs) {
      if (!isInvoice(d) || !d.number) continue
      const t = d.total || totals(d, s)
      if (!ist) {
        if (inPeriod(d.date)) for (const g of t.groups || []) addSale(d, g, { date: d.date, kind: kindLabel(d) })
        if (d.kind === 'rechnung')
          for (const p of (d.payments || []).filter((x) => x.kind === 'skonto' && inPeriod(x.date)))
            for (const g of skontoSplit(d, parseNumber(p.amount), s)) {
              const r = addSale(d, { rate: g.rate, net: -g.net, vat: -g.vat }, { date: p.date, kind: 'Skonto' })
              if (!r.rc && !r.free) addTo(sales.skonto, -g.net, -g.vat)
              else addTo(sales.skonto, -g.net)
            }
        // Abschlag im Zeitraum, aber am Ende noch nicht ganz bezahlt: die Steuer entsteht erst mit der Zahlung
        if (d.kind === 'rechnung' && d.stage === 'abschlag' && inPeriod(d.date)) {
          const paid = round2((d.payments || []).filter((x) => x.date && x.date <= to).reduce((a, x) => a + parseNumber(x.amount), 0))
          if (paid < round2(t.gross) - 0.004) notes.push(`Abschlagsrechnung ${d.number} ist im Zeitraum noch nicht (ganz) bezahlt: die Umsatzsteuer einer Anzahlung entsteht erst mit der Zahlung (§ 19 Abs. 2 Z 1 lit. a UStG). Hier zählt sie nach dem Rechnungsdatum – mit der Steuerberatung abstimmen.`)
        }
      } else if (d.kind === 'rechnung') {
        for (const p of (d.payments || []).filter((x) => x.kind !== 'skonto' && inPeriod(x.date)))
          for (const g of skontoSplit(d, parseNumber(p.amount), s)) addSale(d, { rate: g.rate, net: g.net, vat: g.vat }, { date: p.date, kind: p.kind === 'ruecklastschrift' ? 'Rücklastschrift' : 'Zahlung' })
      }
    }
    const drafts = docs.filter((d) => isInvoice(d) && !d.number && inPeriod(d.date)).length
    if (drafts) notes.push(`${drafts === 1 ? '1 Rechnungsentwurf' : `${drafts} Rechnungsentwürfe`} mit Datum im Zeitraum ${drafts === 1 ? 'zählt' : 'zählen'} nicht: erst festschreiben.`)
  }

  // ------------------------------------------------ Vorsteuer aus Eingangsrechnungen (ohne 0 %: keine Vorsteuer)
  const withTax = (g) => g.rate > 0 || !!g.vat
  if (purchase) {
    let doubtful = 0
    for (const inv of purchase.invoices || []) {
      if (inv.cancelled) continue
      const t = invoiceTotals(inv)
      const partner = inv.supplier?.name || ''
      const ref = inv.no || inv.number || ''
      let counted = false
      if (inv.reverseCharge) {
        // Reverse Charge: Steuer und Vorsteuer im Monat des Rechnungsdatums (auch bei Istbesteuerung)
        if (inPeriod(inv.date))
          for (const g of t.groups) {
            const rate = g.rate || 20
            const tax = round2((g.net * rate) / 100)
            addTo(input.rc, g.net, tax)
            rows.push({ area: 'vst', date: inv.date, ref, partner, kind: 'Reverse Charge', rate, net: g.net, vat: tax, kz: `${KZ.rcTax}/${KZ.rcInput}` })
            counted = true
          }
        for (const p of (inv.payments || []).filter((x) => x.kind === 'skonto' && inPeriod(x.date)))
          for (const g of skontoSplitPurchase(inv, parseNumber(p.amount))) {
            const rate = g.rate || 20
            const tax = round2((g.net * rate) / 100)
            addTo(input.rc, -g.net, -tax)
            rows.push({ area: 'vst', date: p.date, ref, partner, kind: 'Skonto (Reverse Charge)', rate, net: -g.net, vat: -tax, kz: `${KZ.rcTax}/${KZ.rcInput}` })
          }
      } else if (!ist) {
        if (inPeriod(inv.date))
          for (const g of t.groups.filter(withTax)) {
            addTo(pot(input.rates, g.rate), g.net, g.vat)
            rows.push({ area: 'vst', date: inv.date, ref, partner, kind: 'Eingangsrechnung', rate: g.rate, net: g.net, vat: g.vat, kz: KZ.input })
            counted = true
          }
        for (const p of (inv.payments || []).filter((x) => x.kind === 'skonto' && inPeriod(x.date)))
          for (const g of skontoSplitPurchase(inv, parseNumber(p.amount)).filter(withTax)) {
            addTo(pot(input.rates, g.rate), -g.net, -g.vat)
            addTo(input.skonto, -g.net, -g.vat)
            rows.push({ area: 'vst', date: p.date, ref, partner, kind: 'Skonto', rate: g.rate, net: -g.net, vat: -g.vat, kz: KZ.input })
          }
      } else {
        for (const p of (inv.payments || []).filter((x) => x.kind !== 'skonto' && inPeriod(x.date)))
          for (const g of skontoSplitPurchase(inv, parseNumber(p.amount)).filter(withTax)) {
            addTo(pot(input.rates, g.rate), g.net, g.vat)
            rows.push({ area: 'vst', date: p.date, ref, partner, kind: 'Zahlung', rate: g.rate, net: g.net, vat: g.vat, kz: KZ.input })
            counted = true
          }
      }
      if (counted && !vatDeductible(invoiceProblems(inv, { suppliers: purchase.suppliers || [] }))) doubtful++
    }
    if (doubtful) notes.push(`${doubtful === 1 ? '1 Eingangsrechnung' : `${doubtful} Eingangsrechnungen`} im Zeitraum mit fehlenden Angaben für den Vorsteuerabzug (Einkauf, „Vorsteuer?“): bitte vor der Abgabe prüfen.`)
  }

  // ------------------------------------------------ Kassenbuch (Datum der Buchung)
  if (cash) {
    for (const e of cash.entries || []) {
      if (!inPeriod(e.date) || e.ref || !['buchung', 'storno', undefined].includes(e.type)) continue
      const storno = e.type === 'storno'
      const kind = storno ? (e.kind === 'einnahme' ? 'ausgabe' : 'einnahme') : e.kind
      const sign = storno ? -1 : 1
      const vat = round2(sign * parseNumber(e.vat))
      const net = round2(sign * (parseNumber(e.amount) - parseNumber(e.vat)))
      const rate = parseNumber(e.rate)
      const ref = `Kassenbuch Nr. ${e.no}`
      if (kind === 'einnahme') {
        if (!vat && e.category !== 'verkauf') continue
        if (rate > 0) addTo(pot(sales.rates, rate), net, vat)
        else addTo(sales.free, net)
        addTo(sales.cash, net, rate > 0 ? vat : 0)
        rows.push({ area: 'kasse', date: e.date, ref, partner: e.text || '', kind: storno ? 'Storno Einnahme' : 'Einnahme', rate, net, vat: rate > 0 ? vat : 0, kz: rate > 0 ? KZ[rate] || '' : '' })
      } else {
        if (!vat) continue
        addTo(pot(input.rates, rate), net, vat)
        addTo(input.cash, net, vat)
        rows.push({ area: 'kasse', date: e.date, ref, partner: e.text || '', kind: storno ? 'Storno Ausgabe' : 'Ausgabe', rate, net, vat, kz: KZ.input })
      }
    }
    const months = new Set((cash.closings || []).map((c) => c.month))
    const open = []
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = nextMonth(m)) if ((cash.entries || []).some((e) => String(e.date).startsWith(m)) && !months.has(m)) open.push(m)
    if (open.length) notes.push(`Kassenbuch ${open.map((m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`).join(', ')} noch nicht abgeschlossen: die Zahlen können sich noch ändern.`)
  }

  if (!docs) notes.unshift('Die Fakturierung ist für deine Rolle nicht lesbar: Umsatzsteuer aus Rechnungen fehlt, die Zahllast ist nicht vollständig.')
  if (!purchase && !cash) notes.unshift('Einkauf & Kasse ist für deine Rolle nicht lesbar: nur Umsatzsteuer aus der Fakturierung, ohne Vorsteuer und Kassenbuch – die Zahllast ist nicht vollständig.')

  const sum = (map, f) => round2(Object.values(map).reduce((a, x) => a + x[f], 0))
  const salesVat = sum(sales.rates, 'vat')
  const base = round2(sum(sales.rates, 'net') + sales.free.net + sales.rc.net)
  const inputVat = sum(input.rates, 'vat')
  const t = {
    base,
    salesVat,
    rcTax: input.rc.vat,
    tax: round2(salesVat + input.rc.vat),
    input: inputVat,
    rcInput: input.rc.vat,
    inputTotal: round2(inputVat + input.rc.vat),
    complete: !!docs && !!purchase && !!cash,
  }
  t.payable = round2(t.tax - t.inputTotal)
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.ref).localeCompare(String(b.ref)))
  return { from, to, basis: ist ? 'ist' : 'soll', has: { sales: !!docs, purchase: !!purchase, cash: !!cash }, sales, input, totals: t, rows, notes }
}

const nextMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

const RATE_LABEL = { 20: '20 % Normalsteuersatz', 13: '13 % ermäßigter Steuersatz', 10: '10 % ermäßigter Steuersatz' }

/**
 * Zeilen der Übersicht (Ansicht, PDF, CSV): [{ key, kz, label, net, vat, level }] mit level 'head' (Überschrift),
 * 'line' (Betrag), 'sub' (davon/darin, zählt schon in der Zeile darüber), 'sum' (Summe), 'result' (Zahllast/Gutschrift).
 */
export function vatReturnLines(r) {
  const out = []
  const line = (key, kz, label, net, vat, level = 'line') => out.push({ key, kz, label, net: net === null ? null : round2(net), vat: vat === null ? null : round2(vat), level })
  const showSales = r.has.sales || r.has.cash
  const showInput = r.has.purchase || r.has.cash
  if (showSales || r.has.purchase) {
    line('ust', '', 'Umsatzsteuer', null, null, 'head')
    if (showSales) {
      line('base', KZ.total, 'Gesamtbetrag der Bemessungsgrundlagen (Lieferungen und Leistungen, netto)', r.totals.base, null)
      if (r.sales.rc.net || r.has.sales) line('rc-out', KZ.rcOut, 'davon Reverse Charge: Steuerschuld geht auf den Kunden über (§ 19 Abs. 1a UStG)', r.sales.rc.net, null, 'sub')
      if (r.sales.free.net) line('free', '', 'davon steuerfrei bzw. 0 % (Art der Befreiung mit der Steuerberatung klären)', r.sales.free.net, null, 'sub')
      const rates = [...new Set([20, 10, 13, ...Object.keys(r.sales.rates).map(Number)])]
      for (const rate of rates) {
        const g = r.sales.rates[rate] || blank()
        if (!RATE_LABEL[rate] && !g.net && !g.vat) continue
        line(`r${rate}`, KZ[rate] || '', RATE_LABEL[rate] || `${String(rate).replace('.', ',')} % (Steuersatz prüfen)`, g.net, g.vat)
      }
      if (r.sales.skonto.net || r.sales.skonto.vat) line('skonto-out', '', 'darin Skonto der Kunden (Entgeltminderung, § 16 UStG)', r.sales.skonto.net, r.sales.skonto.vat, 'sub')
      if (r.sales.cash.net || r.sales.cash.vat) line('cash-out', '', 'darin Kassenbuch (Bareinnahmen)', r.sales.cash.net, r.sales.cash.vat, 'sub')
    }
    if (r.has.purchase) line('rc-tax', KZ.rcTax, 'Steuerschuld als Empfänger: Reverse Charge Bauleistungen (§ 19 Abs. 1a UStG)', r.input.rc.net, r.input.rc.vat)
    line('tax', '', 'Summe Umsatzsteuer', null, r.totals.tax, 'sum')
  }
  if (showInput) {
    line('vst', '', 'Vorsteuer', null, null, 'head')
    const net = round2(Object.values(r.input.rates).reduce((a, x) => a + x.net, 0))
    line('input', KZ.input, 'Gesamtbetrag der Vorsteuern (Eingangsrechnungen und Kassenbuch)', net, r.totals.input)
    for (const [rate, g] of Object.entries(r.input.rates).sort((a, b) => Number(b[0]) - Number(a[0]))) if (g.vat || g.net) line(`vst${rate}`, '', `darin ${String(rate).replace('.', ',')} %`, g.net, g.vat, 'sub')
    if (r.input.skonto.net || r.input.skonto.vat) line('skonto-in', '', 'darin Skonto der Lieferanten (Berichtigung, § 16 UStG)', r.input.skonto.net, r.input.skonto.vat, 'sub')
    if (r.input.cash.net || r.input.cash.vat) line('cash-in', '', 'darin Kassenbuch (Barausgaben)', r.input.cash.net, r.input.cash.vat, 'sub')
    if (r.has.purchase) line('rc-input', KZ.rcInput, 'Vorsteuer aus Reverse Charge Bauleistungen (§ 19 Abs. 1a UStG)', r.input.rc.net, r.input.rc.vat)
    line('input-sum', '', 'Summe Vorsteuer', null, r.totals.inputTotal, 'sum')
  }
  const p = r.totals.payable
  line('result', '', `${p >= 0 ? 'Zahllast' : 'Gutschrift (Überschuss)'}${r.totals.complete ? '' : ' – unvollständig'}`, null, Math.abs(p), 'result')
  return out
}

/** Hinweise zu den Annahmen (für Ansicht und PDF). */
export function vatReturnAssumptions(basis) {
  return [
    'Vorläufige Übersicht aus den Daten der App, keine Steuerberatung: die Werte vor der Abgabe (FinanzOnline, Formular U30) mit der Steuerberatung abstimmen.',
    basis === 'ist'
      ? 'Istbesteuerung: Umsatzsteuer nach Zahlungseingang, jede Zahlung anteilig auf die Steuersätze der Rechnung; Skonto, Storno und Korrektur wirken über die Zahlungen. Vorsteuer erst mit der Zahlung (§ 12 Abs. 1 Z 1 lit. a UStG).'
      : 'Sollbesteuerung: Rechnungen, Storno und Korrekturen nach Rechnungsdatum (vereinfacht; genau entsteht die Steuer mit Ablauf des Monats der Leistung, bei späterer Rechnung einen Monat später). Skonto mindert im Monat der Zahlung. Vorsteuer nach Rechnungsdatum.',
    'Reverse Charge als Empfänger (Subunternehmer, Bauleistungen): Steuer und gleich hohe Vorsteuer im Monat des Rechnungsdatums.',
    'Kassenbuch nach dem Datum der Buchung; Barzahlungen von Rechnungen zählen bei der Rechnung, nicht doppelt.',
    'Kennzahlen (KZ) des Formulars U30 nur als Hinweis; die Zuordnung prüft die Steuerberatung.',
  ]
}

const AREA = { ust: 'Umsatzsteuer', vst: 'Vorsteuer', kasse: 'Kassenbuch' }

/** CSV (Strichpunkt, Dezimalkomma, CRLF): Übersicht mit Kennzahlen, darunter die Belege. */
export function vatReturnCsv(r, { label = '' } = {}) {
  const num = (n) => (n === null || n === undefined ? '' : Number(n).toFixed(2).replace('.', ','))
  const cell = (v) => {
    const t = String(v ?? '')
    return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const lines = [
    ['Umsatzsteuer-Übersicht', label || `${de(r.from)}–${de(r.to)}`, VAT_BASIS[r.basis]],
    ['Zeitraum', de(r.from), de(r.to)],
    [],
    ['Kennzahl', 'Bezeichnung', 'Bemessungsgrundlage', 'Steuer'],
    ...vatReturnLines(r)
      .filter((l) => l.level !== 'head')
      .map((l) => [l.kz, l.label, num(l.net), num(l.vat)]),
    [],
    ['Bereich', 'Datum', 'Beleg', 'Partner', 'Art', 'Steuersatz', 'Netto', 'Steuer', 'Kennzahl'],
    ...r.rows.map((x) => [AREA[x.area], de(x.date), x.ref, x.partner, x.kind, num(x.rate), num(x.net), num(x.vat), x.kz]),
    [],
    ...r.notes.map((n) => ['Hinweis', n]),
  ]
  return `${lines.map((l) => l.map(cell).join(';')).join('\r\n')}\r\n`
}

export const vatReturnFileName = (r, ext) => `Umsatzsteuer_${r.from}_${r.to}_${r.basis === 'ist' ? 'Ist' : 'Soll'}.${ext}`
