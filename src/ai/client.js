// Eine einzelne Anfrage an die KI außerhalb des Chats (Beleg lesen, Diktat, Texte), wie „Mit KI übersetzen“:
// offizielles SDK im Browser mit baseURL ki.php (dort liegt der Schlüssel; Modell, Aufwand, Obergrenze und
// Tageslimit bestimmt der Webspace). Nur nach einem Klick der Person, zählt zum Tageslimit.

import { kiErrorInfo } from '../core/ki-vorschlag.js'
import { app } from '../ui/context.js'
import { MODEL } from './agent.js'

export class KixError extends Error {
  constructor(message, code = '') {
    super(message)
    this.code = code
  }
}

/** Anfrage senden, Text der Antwort zurück. Wirft KixError mit lesbarer Meldung (Limit, nicht eingerichtet, zu groß …). */
export async function kiSend(params, { maxTokens = 8000, signal } = {}) {
  const { Anthropic } = await import('./sdk.js')
  const token = app.auth ? await app.auth.getToken() : ''
  const client = new Anthropic({ apiKey: 'ueber-ki-php', baseURL: new URL('ki.php', location.href).href.replace(/\/$/, ''), dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 180_000, defaultHeaders: { 'X-Microsoft-Token': token } })
  let res
  try {
    res = await client.beta.messages.create({ model: MODEL, max_tokens: maxTokens, ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
  } catch (err) {
    const info = kiErrorInfo({ status: err?.status, message: err?.error?.error?.message || err?.message || String(err), aborted: !!signal?.aborted })
    throw new KixError(info.text, info.code)
  }
  if (res.stop_reason === 'refusal') throw new KixError('Die KI hat diese Anfrage abgelehnt. Bitte von Hand ausfüllen.', 'refusal')
  if (res.stop_reason === 'max_tokens') throw new KixError('Die Antwort der KI wurde abgeschnitten. Bitte noch einmal versuchen oder von Hand ausfüllen.', 'long')
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
}
