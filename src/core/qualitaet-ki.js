// KI-Fotoprüfung bei der Qualitätsmessung (Kürzel qm-ki): Die Person fotografiert den Raum der Stichprobe, die KI
// schlägt je Prüfobjekt „in Ordnung“, „Mangel“ (mit Fehlerarten aus der Liste) oder „unklar“ vor, mit kurzem Hinweis.
// Nur ein Vorschlag: übernommen wird je Prüfobjekt per Knopf, die Person entscheidet (keine automatisierte Bewertung).
// An die KI gehen nur das Foto, die Raumgruppe und die Namen der Prüfobjekte und Fehlerarten – keine Namen von
// Personen, kein Objektname. Rein und getestet (test/qualitaet-ki.test.js); Oberfläche: ui/views/qualitaet.js.

export const FOTO_SCHEMA = {
  type: 'object',
  properties: {
    punkte: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          punkt: { type: 'string' },
          zustand: { type: 'string', enum: ['ok', 'mangel', 'unklar'] },
          fehler: { type: 'array', items: { type: 'string' } },
          hinweis: { type: 'string' },
        },
        required: ['punkt', 'zustand', 'fehler', 'hinweis'],
        additionalProperties: false,
      },
    },
    allgemein: { type: 'string' },
  },
  required: ['punkte', 'allgemein'],
  additionalProperties: false,
}

const SYSTEM = `Du hilfst bei einer Qualitätsmessung in der Gebäudereinigung (in Anlehnung an EN 13549). Du siehst ein Foto eines Raums.
Bewerte je Prüfobjekt aus der Liste nur, was auf dem Foto sichtbar ist:
- "ok": sichtbar sauber,
- "mangel": sichtbarer Mangel; nenne die Fehlerarten nur mit Namen aus der Liste der Fehlerarten,
- "unklar": Prüfobjekt nicht oder nicht deutlich zu sehen (Winkel, Licht, Entfernung) – im Zweifel immer "unklar".
Hinweis je Punkt: höchstens ein kurzer Satz auf Deutsch, was zu sehen ist (z. B. "Kaffeeflecken neben dem Drucker").
Keine Aussagen über Personen; sind Personen oder Dokumente zu sehen, ignoriere sie. Keine Prüfobjekte erfinden.
"allgemein": ein Satz zur Bildqualität bzw. was nicht beurteilbar ist (leer, wenn nichts).
Antworte nur mit JSON nach dem Schema.`

const norm = (s) => String(s || '').trim().toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/\s+/g, ' ')
const cut = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

/**
 * Anfrage an ki.php: photo { mediaType, data (base64) }, group (Raumgruppe, z. B. „Büro“), items [{ name }],
 * defects [{ id, name }].
 */
export function fotoPruefungRequest({ photo, group = '', items = [], defects = [] }) {
  const list = items.map((it) => `- ${cut(it.name, 80)}`).join('\n')
  const errs = defects.map((d) => `- ${cut(d.name, 60)}`).join('\n')
  return {
    system: [{ type: 'text', text: SYSTEM }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: photo?.mediaType || 'image/jpeg', data: photo?.data || '' } },
          { type: 'text', text: `Raumgruppe: ${cut(group, 60) || 'Raum'}\nPrüfobjekte:\n${list}\nFehlerarten:\n${errs}` },
        ],
      },
    ],
    output_config: { format: { type: 'json_schema', schema: FOTO_SCHEMA } },
  }
}

/**
 * Antwort prüfen: { suggestions: [{ k, state, defects (ids), hint }], general, problems }. k = Index des Prüfobjekts.
 * Unbekannte Prüfobjekte und Fehlerarten fallen weg; ein Mangel ohne bekannte Fehlerart bleibt ein Mangel ohne Art
 * (die Person wählt sie). Doppelte Punkte: der erste zählt.
 */
export function checkFotoPruefung(data, { items = [], defects = [] } = {}) {
  const problems = []
  const byName = new Map(items.map((it, k) => [norm(it.name), k]))
  const defByName = new Map(defects.flatMap((d) => [[norm(d.name), d.id], [norm(d.id), d.id]]))
  const seen = new Set()
  const suggestions = []
  for (const p of Array.isArray(data?.punkte) ? data.punkte : []) {
    const k = byName.get(norm(p?.punkt))
    if (k === undefined) {
      if (p?.punkt) problems.push(`Unbekanntes Prüfobjekt „${cut(p.punkt, 40)}“ übergangen`)
      continue
    }
    if (seen.has(k)) continue
    seen.add(k)
    const state = ['ok', 'mangel', 'unklar'].includes(p.zustand) ? p.zustand : 'unklar'
    const ids = state === 'mangel' ? [...new Set((Array.isArray(p.fehler) ? p.fehler : []).map((f) => defByName.get(norm(f))).filter(Boolean))] : []
    suggestions.push({ k, state, defects: ids, hint: cut(p.hinweis, 160) })
  }
  suggestions.sort((a, b) => a.k - b.k)
  if (!suggestions.length) problems.push('Kein Prüfobjekt beurteilt')
  return { suggestions, general: cut(data?.allgemein, 200), problems }
}

/** Vorschlag auf ein Prüfobjekt anwenden (nur ok/mangel; unklar ändert nichts). Liefert true, wenn geändert. */
export function applySuggestion(item, s, at = new Date().toISOString()) {
  if (!item || !s || s.state === 'unklar') return false
  item.state = s.state
  item.defects = s.state === 'mangel' ? [...s.defects] : []
  if (s.state === 'mangel' && s.hint && !item.note) item.note = s.hint
  item.ki = { at, state: s.state }
  return true
}
