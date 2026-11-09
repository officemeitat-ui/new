// Wochenbriefing als E-Mail (Bericht „briefing“ in „Berichte automatisch“, ui/report-subscriptions.js): erst bei Bedarf
// geladen. Rechenkern und Prüfung der KI-Antwort: core/briefing.js.
import { briefingFacts, briefingForAi, briefingRequest, briefingText, checkBriefing } from '../core/briefing.js'
import { formatDate } from '../core/dates.js'
import { viennaNow } from '../core/report-schedule.js'
import { app, VIEWS } from './context.js'
import { readView, todoSections } from './mailer.js'
import { AGENTS, proposals } from './views/disponent.js'

/**
 * Wochenbriefing (core/briefing.js): dringende Vorschläge der digitalen Mitarbeiter, Abschnitte von „Zu erledigen“,
 * Kacheln der Kennzahlen; mit ki: true formuliert ki.php oben eine kurze Zusammenfassung (geprüft, sonst ohne).
 */
export async function buildBriefing({ ki = false, footer = '', renderOffscreen }) {
  const day = viennaNow().day
  let tiles = []
  if (VIEWS.some((v) => v.id === 'kennzahlen' && (!v.available || v.available()))) {
    const { box, monday } = await renderOffscreen({ view: 'kennzahlen' })
    try {
      tiles = readView(box.querySelector('main'), { viewId: 'kennzahlen', monday }).tiles || []
    } finally {
      box.remove()
    }
  }
  const { box } = await renderOffscreen({ modal: 'todo' })
  let todo = []
  try {
    todo = todoSections(null, box)
  } finally {
    box.remove()
  }
  const facts = briefingFacts({ day, proposals: proposals(), agents: AGENTS, todo, tiles })
  let intro = ''
  let note = ''
  if (ki) {
    try {
      // wie kixCheck (ui/kix.js), ohne dieses Modul in den Start zu ziehen
      const st = app.config?.assistant === false ? null : await (await import('../ai/agent.js')).kiRequest('status')
      if (st?.aktiv) {
        const ai = briefingForAi(facts, (app.data.employees || []).map((e) => e.name))
        const { kiSend } = await import('../ai/client.js')
        const res = checkBriefing(await kiSend(briefingRequest(ai), { maxTokens: 2000 }), ai)
        if (res.ok) intro = res.text
        else note = `\n\n(Die Zusammenfassung der KI wurde nicht übernommen: ${res.problems[0].startsWith('Zahlen') ? 'Zahlen nicht aus den Fakten' : res.problems[0]}.)`
      } else note = '\n\n(KI am Webspace nicht eingerichtet: Briefing ohne Zusammenfassung.)'
    } catch (err) {
      note = `\n\n(KI nicht erreichbar: ${String(err?.message || err).slice(0, 120)})`
    }
  }
  const text = briefingText(facts, { link: `${location.origin}${location.pathname}`, from: app.user?.name || '', intro })
  return { subject: `Wochenbriefing – ${formatDate(day, { weekday: false, year: true })}`, text: text + note + footer, files: [] }
}

