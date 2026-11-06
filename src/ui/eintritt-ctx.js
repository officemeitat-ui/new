// Verknüpfungen der Eintritts- und Austritts-Checklisten (core/bewerber.js, linkContext) mit den Leserechten der
// Rolle: Was die Rolle nicht lesen darf (Unterweisungen, Schlüsselbuch, Wochenpläne), gilt nie „von selbst“ als
// erledigt. Für die Ansicht (views/eintritt.js) und den digitalen Mitarbeiter „Fristen“ (views/disponent.js).

import { linkContext } from '../core/bewerber.js'
import { mondayOf, todayISO } from '../core/dates.js'
import { dataRights, DOC, MODULE_DOCS, weekPath } from '../storage/data-service.js'
import { app } from './context.js'

/** Daten für linkedOf/checklistAttention mit den Rechten der angemeldeten Person (ohne Rollen: alles). */
export function eintrittContext(today = todayISO()) {
  const r = dataRights(app.access)
  return linkContext(app.data, {
    today,
    can: { trainings: r.read(MODULE_DOCS.unterweisungen.path), keys: r.read(MODULE_DOCS.schluessel.path), plans: r.read(weekPath(mondayOf(today))), portal: r.read(DOC.master) },
  })
}
