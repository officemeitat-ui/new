// Objektanweisungen mit dem KI-Assistenten übersetzen: eine Anfrage über ki.php (wie der Assistent, der
// Schlüssel liegt nur am Webspace), nur nach Klick auf „Mit KI übersetzen“. Das Ergebnis ist ein
// Vorschlag: Der Dialog zeigt ihn zur Prüfung, gespeichert wird erst mit „Übernehmen“ und „Speichern“.
// Anfrage und Auswertung stehen in core/sprachen.js (dort getestet).

import { parseTranslation, translationRequest } from '../core/sprachen.js'
import { app } from '../ui/context.js'
import { kiRequest, MODEL } from './agent.js'

/** Ist der KI-Assistent am Webspace eingerichtet und eingeschaltet? (Fehler: nein) */
export async function kiReady() {
  try {
    return !!(await kiRequest('status'))?.aktiv
  } catch {
    return false
  }
}

/** Text in die Sprachen übersetzen: { tr: 'Text', … }. Wirft mit lesbarer Meldung. */
export async function translateText(text, langs) {
  const { Anthropic } = await import('./sdk.js')
  const token = app.auth ? await app.auth.getToken() : ''
  const client = new Anthropic({ apiKey: 'ueber-ki-php', baseURL: new URL('ki.php', location.href).href.replace(/\/$/, ''), dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 180_000, defaultHeaders: { 'X-Microsoft-Token': token } })
  let res
  try {
    res = await client.beta.messages.create({ model: MODEL, max_tokens: 8000, ...translationRequest(text, langs), betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
  } catch (err) {
    throw new Error(err?.error?.error?.message || err?.message || String(err))
  }
  if (res.stop_reason === 'refusal') throw new Error('Die KI hat diese Übersetzung abgelehnt. Bitte von Hand übersetzen.')
  if (res.stop_reason === 'max_tokens') throw new Error('Der Text ist für eine Übersetzung zu lang. Bitte kürzen oder von Hand übersetzen.')
  return parseTranslation(res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), langs)
}
