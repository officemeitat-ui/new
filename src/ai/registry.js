// Werkzeuge des KI-Assistenten: Module melden ihre Werkzeuge hier an, der Assistent bekommt nur die,
// die die angemeldete Person nutzen darf (Lesen: Bereich sichtbar, Ändern: Schreibrecht im Bereich).
//
// registerAgentTool({ name, description, input_schema, modules: ['planung'] | '*', write: false, when?() → false blendet aus,
//                     label?: 'Offene Posten nachgeschlagen' (Zeile im Chat), summary?(input) → { title, lines[] } für die
//                     Bestätigung, run(input, ctx) → Text oder Objekt })
// Werkzeuge mit write: true laufen erst, wenn die Person im Chat „Ausführen“ tippt.

import { app } from '../ui/context.js'

const TOOLS = []

export function registerAgentTool(tool) {
  const i = TOOLS.findIndex((t) => t.name === tool.name)
  if (i >= 0) TOOLS.splice(i, 1, tool)
  else TOOLS.push(tool)
}

/** Bezeichnungen der Werkzeuge, die eine mitbringen: { name: label } (Zeile im Chat). */
export const toolLabels = () => Object.fromEntries(TOOLS.filter((t) => t.label).map((t) => [t.name, t.label]))

const sees = (m) => !app.access || app.access.sees(m)
const edits = (m) => !app.access || app.access.canEdit(m)

/** Werkzeuge, die diese Person nutzen darf (in fester Reihenfolge, damit der Zwischenspeicher der API greift). */
export function availableTools() {
  return TOOLS.filter((t) => {
    const modules = t.modules === '*' ? null : [].concat(t.modules || [])
    if (t.write && app.readOnly) return false
    if (!modules) return !t.when || t.when()
    return modules.some((m) => (t.write ? edits(m) : sees(m))) && (!t.when || t.when())
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/** Eingaben grob gegen das Schema prüfen (Pflichtfelder, Typen, Aufzählungen, Datumsformat). Liefert Fehlertext oder ''. */
export function validateInput(schema, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Eingabe fehlt.'
  for (const key of schema.required || []) if (input[key] === undefined || input[key] === null || input[key] === '') return `Angabe „${key}“ fehlt.`
  for (const [key, value] of Object.entries(input)) {
    const p = schema.properties?.[key]
    if (!p) return `Unbekannte Angabe „${key}“.`
    if (value === undefined || value === null) continue
    const type = Array.isArray(value) ? 'array' : typeof value
    if (p.type === 'integer' ? !Number.isInteger(value) : p.type === 'number' ? type !== 'number' : p.type !== type) return `„${key}“ hat den falschen Typ (${p.type} erwartet).`
    if (p.enum && !p.enum.includes(value)) return `„${key}“ muss eines von ${p.enum.join(', ')} sein.`
    if (p.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `„${key}“ bitte als JJJJ-MM-TT.`
    if (p.pattern && !new RegExp(p.pattern).test(value)) return `„${key}“ hat das falsche Format.`
    if (p.type === 'array' && p.items?.type && value.some((v) => typeof v !== p.items.type)) return `„${key}“: Einträge müssen ${p.items.type} sein.`
  }
  return ''
}
