// Spracheingabe im Browser (Deutsch/Österreich): Mikrofon im Chat des KI-Assistenten und „Diktieren“ beim
// Regiebericht. Ohne Spracheingabe im Browser geht am Handy das Mikrofon der Tastatur.

import { toast } from './context.js'

const speech = () => typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
/** Gibt es Spracheingabe im Browser? */
export const speechAvailable = () => !!speech()

/**
 * Spracheingabe starten: onText(fertig, vorläufig) während des Sprechens, onEnd(fertig) am Ende. Liefert die laufende
 * Erkennung (stop() beendet) oder null ohne Spracheingabe (mit Hinweis).
 */
export function startSpeech({ onText = () => {}, onEnd = () => {}, continuous = false } = {}) {
  const Rec = speech()
  if (!Rec) {
    toast('Spracheingabe gibt es in diesem Browser nicht. Am Handy geht das Mikrofon der Tastatur.')
    return null
  }
  const rec = new Rec()
  rec.lang = 'de-AT'
  rec.interimResults = true
  rec.continuous = continuous
  let finalText = ''
  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) (e.results[i].isFinal ? (finalText += e.results[i][0].transcript) : (interim += e.results[i][0].transcript))
    onText(finalText, interim)
  }
  rec.onerror = (e) => toast(e.error === 'not-allowed' ? 'Mikrofon nicht erlaubt (Browser-Einstellungen).' : `Spracheingabe: ${e.error}`)
  rec.onend = () => onEnd(finalText)
  rec.start()
  return rec
}
