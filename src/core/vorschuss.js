// Lohnvorschuss: Vereinbarung je Person mit Betrag, Auszahlung und Rückzahlung in Raten (je Monat ein Abzug von der
// Lohnabrechnung), offener Rest, Abzug bei der Endabrechnung. Reine Funktionen ohne Browser (test/vorschuss.test.js);
// Oberfläche: ui/modals/vorschuss.js (aus „Überstunden & Auszahlung“ bzw. „Eintritt & Austritt“), PDF: export/vorschuss-pdf.js.
//
// Gespeichert in lohn/zeitkonto.json (wie Löhne und Monatsabschlüsse, gleiche Rechte):
//   advances: [{ id, empId, date (Auszahlung), amount, installments: [{ month: 'JJJJ-MM', amount }], note,
//                done: { date, note, by } | null (getilgt bzw. bei der Endabrechnung abgezogen), createdAt, createdBy }]
// Beträge in Euro mit zwei Nachkommastellen; gerechnet wird in Cent.
//
// Rechtliches (docs/RECHTSPRUEFUNG.md, Punkt 61): Vorschuss = Vorauszahlung auf schon verdientes bzw. künftiges Entgelt;
// die Raten werden vom Netto abgezogen. Was bei der Pfändung als Existenzminimum geschützt ist, darf auch der Arbeitgeber
// nicht einbehalten (§ 293 EO); Abzüge laut schriftlicher Vereinbarung.

const cents = (v) => Math.round((Number(String(v ?? '').replace(',', '.')) || 0) * 100)
const euro = (c) => Math.round(c) / 100
const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || ''))
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
const nextMonth = (m) => {
  const [y, mo] = m.split('-').map(Number)
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
}

/**
 * Ratenplan: erster Monat, erste Rate (optional anders), dann gleiche Raten bis der Betrag erreicht ist; die letzte Rate
 * ist der Rest. → [{ month, amount }] (höchstens 60 Raten).
 */
export function planInstallments(amount, { firstMonth, firstRate = null, rate }) {
  const total = cents(amount)
  const r = cents(rate)
  const first = firstRate === null || firstRate === '' ? r : cents(firstRate)
  if (total <= 0 || r <= 0 || first <= 0 || !isMonth(firstMonth)) return []
  const out = []
  let left = total
  let month = firstMonth
  for (let i = 0; left > 0 && i < 60; i++) {
    const x = Math.min(left, i === 0 ? first : r)
    out.push({ month, amount: euro(x) })
    left -= x
    month = nextMonth(month)
  }
  return out
}

/** Fehler der Vereinbarung als Text oder ''. */
export function advanceProblem(a) {
  if (!a?.empId) return 'Bitte die Person wählen.'
  if (cents(a.amount) <= 0) return 'Bitte den Betrag eintragen.'
  if (!isDate(a.date)) return 'Bitte das Datum der Auszahlung eintragen.'
  const sum = (a.installments || []).reduce((s, x) => s + cents(x.amount), 0)
  if (!(a.installments || []).length) return 'Bitte die Rückzahlung eintragen (Raten).'
  if ((a.installments || []).some((x) => !isMonth(x.month) || cents(x.amount) <= 0)) return 'Jede Rate braucht einen Monat und einen Betrag.'
  if (sum !== cents(a.amount)) return `Die Raten ergeben ${euro(sum).toFixed(2).replace('.', ',')} €, der Vorschuss ist ${euro(cents(a.amount)).toFixed(2).replace('.', ',')} €.`
  if ((a.installments || []).some((x) => x.month < a.date.slice(0, 7))) return 'Eine Rate liegt vor der Auszahlung.'
  return ''
}

/** Abzug in einem Monat (Summe aller laufenden Vorschüsse einer Person). */
export function deductionIn(advances = [], empId, month) {
  let c = 0
  for (const a of advances) {
    if (a.empId !== empId || (a.done && a.done.date && a.done.date.slice(0, 7) < month)) continue
    for (const x of a.installments || []) if (x.month === month) c += cents(x.amount)
  }
  return euro(c)
}

/** Abzüge eines Monats je Person: Map empId → Euro (nur > 0). */
export function deductionsIn(advances = [], month) {
  const out = new Map()
  for (const empId of new Set(advances.map((a) => a.empId))) {
    const v = deductionIn(advances, empId, month)
    if (v > 0) out.set(empId, v)
  }
  return out
}

/** Offener Rest nach dem Monat „afterMonth“ (Raten danach), ohne getilgte. */
export function openAfter(advance, afterMonth) {
  if (advance?.done) return 0
  return euro((advance?.installments || []).filter((x) => x.month > afterMonth).reduce((s, x) => s + cents(x.amount), 0))
}

/**
 * Beim Austritt: was bei der Endabrechnung abzuziehen ist (Raten nach dem Austrittsmonat), je laufendem Vorschuss.
 * → { total, items: [{ advance, open }] }
 */
export function openAtExit(advances = [], empId, exitDate) {
  const month = String(exitDate || '').slice(0, 7)
  const items = advances.filter((a) => a.empId === empId && !a.done).map((advance) => ({ advance, open: openAfter(advance, month) })).filter((x) => x.open > 0)
  return { total: euro(items.reduce((s, x) => s + cents(x.open), 0)), items }
}

/** Stand eines Vorschusses in einem Monat: { paid (bis einschließlich), open (danach), next: { month, amount } | null }. */
export function advanceState(advance, month) {
  const list = advance?.installments || []
  const paid = list.filter((x) => x.month <= month).reduce((s, x) => s + cents(x.amount), 0)
  const next = advance?.done ? null : list.find((x) => x.month > month) || null
  return { paid: euro(paid), open: advance?.done ? 0 : openAfter(advance, month), next }
}
