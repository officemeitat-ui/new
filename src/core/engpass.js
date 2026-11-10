// Engpass-Vorschau: je Woche der nächsten Wochen der Bedarf an Arbeitsstunden aus den Einsätzen (Stammplan,
// verschobene und entfallene berücksichtigt, je Einsatz die Zahl der Personen) gegen die verfügbaren Stunden der
// Mitarbeitenden (Vertrag der Woche, minus Abwesenheiten an Werktagen, nur in der Zeit der Beschäftigung). Dazu, wie
// viel schon eingeteilt ist und was offen bleibt. Ampel: rot, wenn der Bedarf die verfügbaren Stunden übersteigt;
// gelb unter 10 % Reserve. Nur ein Hinweis zum Vorausplanen (Vertretung, Mehrstunden, Neueinstellung) – Mehrarbeit
// von Teilzeitkräften ist nicht eingerechnet. Rein rechnend (test/engpass.test.js).

import { employedOn, weeklyHoursAt } from './contract.js'
import { addDays, eachDay } from './dates.js'

/** Reserve unter diesem Anteil des Bedarfs: gelb. */
export const RESERVE_WARN = 0.1

/**
 * Verfügbare Minuten einer Person in der Woche: Vertragsstunden je Werktag (Mo–Fr, ein Fünftel der Wochenstunden),
 * ohne Tage der Abwesenheit (alle Arten) und ohne Tage außerhalb der Beschäftigung. Liefert { min, absentDays }.
 */
export function availableMinutes(emp, monday, absences = []) {
  const own = absences.filter((a) => a?.employeeId === emp.id && a.from <= addDays(monday, 6) && a.to >= monday)
  let min = 0
  let absentDays = 0
  for (const d of eachDay(monday, addDays(monday, 4))) {
    if (!employedOn(emp, d)) continue
    if (own.some((a) => a.from <= d && a.to >= d)) {
      absentDays++
      continue
    }
    min += (weeklyHoursAt(emp, d) * 60) / 5
  }
  return { min: Math.round(min), absentDays }
}

/**
 * Vorschau je Woche. weeks: [{ monday, instances, state? }] (instances: Einsätze der Woche aus buildInstances; state:
 * PlanState mit den gespeicherten Einteilungen, falls die Woche geladen ist), employees, absences.
 * Liefert je Woche { monday, demand, available, reserve, ratio, assigned, open, planned, absent, level }
 * (Minuten; planned: es gibt schon Einteilungen; level: 'rot' | 'gelb' | 'gruen').
 */
export function capacityForecast({ weeks = [], employees = [], absences = [] }) {
  const active = employees.filter((e) => !e.inactive)
  return weeks.map(({ monday, instances = [], state = null }) => {
    const sunday = addDays(monday, 6)
    let demand = 0
    let assigned = 0
    for (const i of instances) {
      if (i.status === 'cancelled' || i.date < monday || i.date > sunday) continue
      const staff = Math.max(1, Number(i.staff) || 1)
      const net = Math.max(0, Number(i.net) || 0)
      demand += net * staff
      if (state) assigned += net * Math.min(staff, state.assigned(i.key).length)
    }
    let available = 0
    let absent = 0
    for (const e of active) {
      const a = availableMinutes(e, monday, absences)
      available += a.min
      if (a.absentDays) absent++
    }
    const reserve = available - demand
    const ratio = demand ? reserve / demand : 1
    const level = reserve < 0 ? 'rot' : ratio < RESERVE_WARN ? 'gelb' : 'gruen'
    return { monday, demand: Math.round(demand), available, reserve: Math.round(reserve), ratio, assigned: Math.round(assigned), open: Math.round(demand - assigned), planned: assigned > 0, absent, level }
  })
}

/** Wochen mit Engpass (rot) in der Vorschau, die frühestens heute enden. */
export const shortWeeks = (forecast = [], today = '') => forecast.filter((w) => w.level === 'rot' && addDays(w.monday, 6) >= today)
