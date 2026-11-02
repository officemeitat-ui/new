// Objektkalkulation: aus Flächen, Häufigkeit und Leistungswerten (m² je Stunde) die Stunden im Monat,
// dann über eine Zuschlagskalkulation den Verrechnungssatz und den Monatspreis.
//
// Leistungswerte sind Richtwerte (Ausschreibungen nennen z. B. Büro 150–250, Sanitär 35–120,
// Treppenhaus 130–200 m²/h); jeder Betrieb passt sie an seine Erfahrung an.
// Zuschläge laufen nacheinander: Stundenlohn → + Lohnnebenkosten (Sonderzahlungen, Ausfallzeiten,
// Dienstgeberabgaben; WKO-Merkblatt „Lohnnebenkosten Gebäudereiniger“) → + Material und Geräte →
// + Verwaltung und Gemeinkosten → + Gewinn und Wagnis = Verrechnungssatz netto.

export const AREA_TYPES = {
  buero: ['Büro', 200],
  sanitaer: ['Sanitär (WC, Dusche)', 60],
  stiege: ['Stiegenhaus', 150],
  gang: ['Gang, Verkehrsfläche', 250],
  eingang: ['Eingang, Foyer', 120],
  kueche: ['Küche, Teeküche', 80],
  lager: ['Lager, Technik', 300],
  sonst: ['Sonstiges', 150],
}

/** Häufigkeit: Reinigungen je Woche. */
export const FREQUENCIES = [
  [5, 'täglich (Mo–Fr)'],
  [6, 'Mo–Sa'],
  [3, '3× pro Woche'],
  [2, '2× pro Woche'],
  [1, '1× pro Woche'],
  [0.5, '14-tägig'],
  [12 / 52, 'monatlich'],
  [4 / 52, 'quartalsweise'],
]
export const frequencyLabel = (perWeek) => FREQUENCIES.find(([f]) => Math.abs(f - perWeek) < 1e-6)?.[1] || `${String(Math.round(perWeek * 100) / 100).replace('.', ',')}× pro Woche`

export const WEEKS_PER_MONTH = 52 / 12

export const CALC_DEFAULTS = {
  performance: Object.fromEntries(Object.entries(AREA_TYPES).map(([k, [, v]]) => [k, v])),
  wageGroup: '2', // KV-Lohngruppe für den Stundenlohn (leer: eigener Stundenlohn)
  wage: null, // eigener Stundenlohn in €
  lnkPct: 90, // Lohnnebenkosten in % des Stundenlohns (WKO-Merkblatt bzw. eigene Berechnung)
  setupPct: 10, // Rüst- und Nebenzeiten (Material holen, Wege im Objekt)
  materialPct: 8,
  overheadPct: 15,
  profitPct: 5,
  vatPct: 20,
}

const round2 = (n) => Math.round(n * 100) / 100

/** Minuten im Monat für eine Fläche. */
export function areaMinutes(area, performance = CALC_DEFAULTS.performance) {
  const value = Number(area.value) > 0 ? Number(area.value) : performance[area.type] || CALC_DEFAULTS.performance[area.type] || 150
  const m2 = Math.max(0, Number(area.m2) || 0)
  return { value, minutes: (m2 / value) * 60 * (Number(area.perWeek) || 0) * WEEKS_PER_MONTH }
}

/** Verrechnungssatz: Schritte mit Prozent und Betrag je Stunde. */
export function hourlyRate(wage, s = CALC_DEFAULTS) {
  const steps = [['Stundenlohn (KV)', null, wage]]
  let x = wage
  for (const [label, pct] of [['Lohnnebenkosten', s.lnkPct], ['Material und Geräte', s.materialPct], ['Verwaltung und Gemeinkosten', s.overheadPct], ['Gewinn und Wagnis', s.profitPct]]) {
    const add = (x * (Number(pct) || 0)) / 100
    x += add
    steps.push([label, Number(pct) || 0, add])
  }
  return { steps: steps.map(([label, pct, amount]) => ({ label, pct, amount: round2(amount) })), rate: round2(x), cost: round2(x / (1 + (Number(s.profitPct) || 0) / 100)) }
}

/**
 * Kalkulation eines Objekts: Zeilen je Fläche, Stunden im Monat (mit Rüstzeit), Verrechnungssatz,
 * Monatspreis netto und brutto, Preis je m² (gereinigte Fläche, ohne Häufigkeit).
 */
export function calculate({ areas = [], settings = {}, wage }) {
  const s = { ...CALC_DEFAULTS, ...settings, performance: { ...CALC_DEFAULTS.performance, ...(settings.performance || {}) } }
  const rows = areas.map((a) => ({ area: a, ...areaMinutes(a, s.performance) }))
  const cleaning = rows.reduce((sum, r) => sum + r.minutes, 0)
  const minutes = cleaning * (1 + (Number(s.setupPct) || 0) / 100)
  const { steps, rate, cost } = hourlyRate(wage, s)
  const hours = minutes / 60
  const net = round2(hours * rate)
  const totalM2 = areas.reduce((sum, a) => sum + (Number(a.m2) || 0), 0)
  return {
    rows: rows.map((r) => ({ ...r, minutes: Math.round(r.minutes) })),
    cleaningMinutes: Math.round(cleaning),
    minutes: Math.round(minutes),
    hours: round2(hours),
    steps,
    rate,
    costMonth: round2(hours * cost),
    net,
    vat: round2((net * (Number(s.vatPct) || 0)) / 100),
    gross: round2(net * (1 + (Number(s.vatPct) || 0) / 100)),
    totalM2,
    perM2: totalM2 ? round2(net / totalM2) : null,
    margin: round2(net - hours * cost),
  }
}

/** Stundenlohn für die Kalkulation: eigener Wert, sonst KV-Lohngruppe aus den Regeln. */
export const calcWage = (settings, wages = {}) => (Number(settings?.wage) > 0 ? Number(settings.wage) : Number(wages[settings?.wageGroup || CALC_DEFAULTS.wageGroup]) || 0)
