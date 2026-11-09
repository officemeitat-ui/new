// Wochenbriefing (Bericht in „Berichte automatisch“): eine kurze E-Mail am Montag früh mit dem, was diese Woche zählt –
// die dringenden Vorschläge der digitalen Mitarbeiter, die Abschnitte von „Zu erledigen“ mit Anzahl und die Kacheln der
// Kennzahlen. Ohne KI als feste Gliederung; mit KI (Häkchen im Abo) formuliert ki.php eine kurze Zusammenfassung.
// Für die KI: Namen der Mitarbeitenden und Arten der Abwesenheit (Krankenstand …) werden vorher ersetzt, nur Titel und
// Zahlen gehen hinaus; die Antwort wird geprüft (jede Zahl muss aus den Fakten stammen, Länge), sonst bleibt der Text
// ohne KI. Rein und getestet (test/briefing.test.js); Versand: ui/report-subscriptions.js.

export const BRIEFING_MAX = 1400
const ABSENCE_WORDS = /\b(Krankenstand|Krankenstände|krank|Kur|Pflegeurlaub|Pflegefreistellung|Arztbesuch|Arzttermin|Spitalsaufenthalt|Unfall|Mutterschutz|Karenz|Urlaub|Sonderurlaub|Zeitausgleich|Abwesenheit)\b/gi

/**
 * Fakten fürs Briefing: { day, urgent: [{ title, text, agent }], todo: [{ title, count, first }], tiles: [{ label, value }] }.
 * proposals: Vorschläge der digitalen Mitarbeiter (prio 1 = dringend), todo: Abschnitte aus „Zu erledigen“, tiles:
 * Kacheln der Kennzahlen.
 */
export function briefingFacts({ day = '', proposals = [], agents = [], todo = [], tiles = [] }) {
  const agentName = new Map(agents.map((a) => [a.id, a.name]))
  const urgent = proposals
    .filter((p) => p.prio === 1)
    .slice(0, 8)
    .map((p) => ({ title: String(p.title || '').trim(), text: String(p.text || '').trim(), agent: agentName.get(p.agent) || '' }))
  return {
    day,
    urgent,
    more: Math.max(0, proposals.filter((p) => p.prio === 1).length - urgent.length),
    todo: todo.filter((s) => s.items?.length).map((s) => ({ title: s.title, count: s.items.length, first: s.items.slice(0, 2) })),
    tiles: tiles.filter((t) => t.label && t.value).slice(0, 12).map((t) => ({ label: String(t.label), value: String(t.value) })),
  }
}

/** Text ohne KI: feste Gliederung. */
export function briefingText(facts, { link = '', from = '', brand = 'Cleanos App', intro = '' } = {}) {
  const lines = ['Guten Morgen,', '', intro || `hier das Wichtigste für die Woche ab ${dayText(facts.day)}.`]
  if (facts.urgent.length) {
    lines.push('', 'Diese Woche wichtig:')
    for (const u of facts.urgent) lines.push(`• ${u.title}${u.agent ? ` (${u.agent})` : ''}`)
    if (facts.more) lines.push(`• … und ${facts.more} weitere dringende Vorschläge`)
  } else lines.push('', 'Keine dringenden Vorschläge der digitalen Mitarbeiter.')
  if (facts.todo.length) {
    lines.push('', 'Zu erledigen:')
    for (const t of facts.todo) lines.push(`• ${t.title}: ${t.count}`)
  }
  if (facts.tiles.length) {
    lines.push('', 'Kennzahlen:')
    for (const t of facts.tiles) lines.push(`• ${t.label}: ${t.value}`)
  }
  if (link) lines.push('', `In der App: ${link}`)
  lines.push('', from ? `Liebe Grüße\n${from}` : 'Liebe Grüße', '', `– gesendet aus der ${brand}`)
  return lines.join('\n')
}

function dayText(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}` : 'heute'
}

/** Namen ersetzen (längste zuerst) und Arten der Abwesenheit neutral machen. */
export function anonymize(text, names = []) {
  let out = String(text || '')
  const list = [...new Set(names.map((n) => String(n || '').trim()).filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length)
  for (const n of list) {
    out = out.split(n).join('eine Person')
    const first = n.split(/\s+/)[0]
    if (first.length >= 3) out = out.replace(new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), 'eine Person')
  }
  return out.replace(ABSENCE_WORDS, 'abwesend')
}

/** Fakten für die KI, ohne Namen und Abwesenheitsarten. */
export function briefingForAi(facts, names = []) {
  const a = (s) => anonymize(s, names)
  return {
    day: facts.day,
    urgent: facts.urgent.map((u) => ({ title: a(u.title), agent: u.agent })),
    more: facts.more,
    todo: facts.todo.map((t) => ({ title: a(t.title), count: t.count })),
    tiles: facts.tiles,
  }
}

/** Anfrage an ki.php (Nachrichten-Format der Claude-API). */
export function briefingRequest(aiFacts) {
  return {
    system:
      'Du schreibst für die Geschäftsführung einer Salzburger Gebäudereinigung ein kurzes Wochenbriefing auf Deutsch (österreichisch, „Jänner“). ' +
      'Nur die übergebenen Fakten verwenden, keine Zahl erfinden oder ausrechnen, keine Namen. Höchstens 120 Wörter, drei bis sechs Sätze, ' +
      'das Dringendste zuerst, sachlich und freundlich, ohne Anrede und ohne Gruß, keine Aufzählungszeichen, kein Markdown. ' +
      'Antworte nur mit JSON: {"text": "…"}.',
    messages: [{ role: 'user', content: `Fakten für die Woche:\n${JSON.stringify(aiFacts)}` }],
  }
}

/**
 * Antwort prüfen: { ok, text, problems }. Jede Zahl im Text muss in den Fakten vorkommen (Zahlen der Kennzahlen,
 * Anzahlen, Daten), keine Aufzählung oder Markdown, Länge begrenzt.
 */
export function checkBriefing(raw, aiFacts) {
  const problems = []
  let text = ''
  try {
    const m = String(raw || '').match(/\{[\s\S]*\}/)
    text = String(JSON.parse(m ? m[0] : raw).text || '').trim()
  } catch {
    problems.push('keine lesbare Antwort')
  }
  if (!text) problems.push('leer')
  if (text.length > BRIEFING_MAX) problems.push('zu lang')
  if (/^\s*[-*•#]/m.test(text)) problems.push('Aufzählung oder Markdown')
  // Zahl vergleichbar machen: Tausenderpunkte weg, Komma als Dezimalpunkt, führende Nullen weg (09 = 9)
  const norm = (n) => {
    const v = Number(String(n).replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))
    return Number.isFinite(v) ? String(v) : String(n)
  }
  const known = new Set((JSON.stringify(aiFacts).match(/\d+(?:[.,]\d+)*/g) || []).map(norm))
  const unknown = (text.match(/\d+(?:[.,]\d+)*/g) || []).filter((n) => !known.has(norm(n)))
  if (unknown.length) problems.push(`Zahlen nicht aus den Fakten: ${unknown.slice(0, 3).join(', ')}`)
  return { ok: !problems.length, text: problems.length ? '' : text, problems }
}
