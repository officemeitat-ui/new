// Zulagen je Tätigkeit (z. B. Schmutzzulage für Grundreinigung, Erschwerniszulage für Glasreinigung außen, Höhenzulage):
// je Zulage, für welche Einsätze sie gilt (Leistungen, ganze Objekte, Stichwort in der Bezeichnung, nur Sonderleistungen)
// und wie sie gerechnet wird (Euro je Stunde bzw. je Einsatz). Je Person und Monat aus dem Wochenzettel (gearbeitete
// Einsätze laut Plan, wie die übrigen Kennzahlen der Monatsauswertung); im Export fürs Lohnprogramm je Zulage eine Zeile
// mit ihrer Lohnart. Reine Funktionen (Tests: test/zulagen.test.js); Oberfläche: ui/modals/zulagen.js.
//
// Gespeichert in lohn/zeitkonto.json (wie Löhne, gleiche Rechte):
//   allowances: [{ id, name, wageType (Lohnart), mode: 'stunde' | 'einsatz', rate (Euro), taskIds: [], objectIds: [],
//                  keyword, onlySpecial, active, createdAt, createdBy, updatedAt, updatedBy }]
// Höhe und Anspruch laut Kollektivvertrag bzw. Vereinbarung legt das Büro fest; die App rechnet nur.

export const ALLOWANCE_MODES = { stunde: 'je Stunde', einsatz: 'je Einsatz' }

const text = (v) => String(v ?? '').trim()
const cents = (v) => Math.round((Number(String(v ?? '').replace(',', '.')) || 0) * 100)
const round2 = (x) => Math.round(x * 100) / 100

/** Fehler der Zulage als Text oder ''. */
export function allowanceProblem(a) {
  if (!text(a?.name)) return 'Bitte den Namen der Zulage eintragen (z. B. Schmutzzulage).'
  if (!Object.hasOwn(ALLOWANCE_MODES, a.mode || '')) return 'Bitte wählen: je Stunde oder je Einsatz.'
  if (cents(a.rate) <= 0) return 'Bitte den Betrag eintragen.'
  if (cents(a.rate) > 100000) return 'Der Betrag ist sehr hoch – bitte prüfen (höchstens 1000 €).'
  if (!(a.taskIds || []).length && !(a.objectIds || []).length && !text(a.keyword) && !a.onlySpecial) return 'Bitte wählen, wofür die Zulage gilt: Leistungen, Objekte oder ein Stichwort.'
  return ''
}

/** Gilt die Zulage für diesen Einsatz? (aktiv; Leistung, Objekt oder Stichwort; bei onlySpecial nur Sonderleistungen) */
export function matchesAllowance(a, inst) {
  if (!a || a.active === false || !inst) return false
  if (a.onlySpecial && inst.category !== 'sonder') return false
  const tasks = a.taskIds || []
  const objects = a.objectIds || []
  const kw = text(a.keyword).toLowerCase()
  const any = tasks.length || objects.length || kw
  if (!any) return !!a.onlySpecial
  return tasks.includes(inst.taskId) || objects.includes(inst.objectId) || (!!kw && String(inst.label || '').toLowerCase().includes(kw))
}

/**
 * Zulagen aus den Tagen eines Wochenzettels (buildTimesheet().days), nur gearbeitete Einsätze (nicht angerechnete
 * Abwesenheit) im Zeitraum [from, to]: [{ id, name, wageType, mode, rate, minutes, count, menge, einheit, amount }]
 * (nur Zulagen mit mindestens einem Einsatz).
 */
export function allowancesFromDays(days = [], allowances = [], { from = '', to = '9999-12-31' } = {}) {
  const out = []
  for (const a of allowances || []) {
    if (a?.active === false) continue
    let minutes = 0
    let count = 0
    for (const d of days || []) {
      if ((from && d.date < from) || d.date > to) continue
      for (const l of d.lines || []) {
        if (l.kind !== 'work' || !l.inst || !matchesAllowance(a, l.inst)) continue
        minutes += Number(l.hours) || 0
        count++
      }
    }
    if (!count) continue
    const rate = cents(a.rate) / 100
    const menge = a.mode === 'einsatz' ? count : round2(minutes / 60)
    out.push({ id: a.id, name: text(a.name), wageType: text(a.wageType), mode: a.mode, rate, minutes, count, menge, einheit: a.mode === 'einsatz' ? 'Stk' : 'h', amount: Math.round(menge * rate * 100) / 100 })
  }
  return out
}

/** Summe der Zulagen-Beträge (Euro). */
export const allowancesTotal = (list = []) => round2((list || []).reduce((s, z) => s + (Number(z.amount) || 0), 0))

/** Neue Zulage (Vorgaben). */
export const newAllowance = ({ id, now = new Date().toISOString(), by = '' } = {}) => ({ id, name: '', wageType: '', mode: 'stunde', rate: '', taskIds: [], objectIds: [], keyword: '', onlySpecial: false, active: true, createdAt: now, createdBy: by })
