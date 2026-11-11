// WhatsApp-Knöpfe der App: Link mit fertigem Text (wa.me, mit Nummer gleich beim Kontakt) und Datei senden
// (am Handy über „Teilen“ → WhatsApp, das PDF hängt dran; am PC: PDF speichern und WhatsApp mit dem Text öffnen).
// Gesendet wird immer von der Person selbst, die App verschickt nichts im Hintergrund.

import { mayWhatsApp, waNumber, waUrl } from '../core/whatsapp.js'
import { toast } from './context.js'
import { download, esc, ICON } from './shared.js'

export const canShareFiles = () => typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && typeof navigator.share === 'function'

/** Knopf (Link) „WhatsApp“: öffnet WhatsApp mit dem Text; mit brauchbarer Nummer gleich beim Kontakt. */
export function waLink({ kind, phone = '', text = '', label = 'WhatsApp', cls = 'btn small', title = '' } = {}) {
  if (!mayWhatsApp(kind)) return '' // Finanzen und nicht freigegebene Arten: kein Knopf
  const n = waNumber(phone)
  const tip = title || (n ? `Per WhatsApp an +${n}` : 'Per WhatsApp senden – den Kontakt in WhatsApp wählen')
  return `<a class="${cls} wa-btn" href="${esc(waUrl(phone, text))}" target="_blank" rel="noopener" title="${esc(tip)}">${ICON.chat} ${esc(label)}</a>`
}

/** WhatsApp in einem neuen Fenster öffnen (gleich beim Tippen, sonst sperrt der Browser das Fenster). */
function openWa(phone, text) {
  const win = window.open(waUrl(phone, text), '_blank')
  if (win) win.opener = null
  return !!win
}

/**
 * Datei (PDF) per WhatsApp. makeBlob erstellt die Datei erst hier.
 *  - Handy (Teilen mit Dateien möglich): „Teilen“ öffnen, dort WhatsApp und den Kontakt wählen – das PDF hängt dran.
 *  - sonst: WhatsApp mit dem Text öffnen (mit Nummer beim Kontakt) und das PDF speichern, zum Anhängen.
 * kind: Art (core/whatsapp.js mayWhatsApp) – Finanzen sind gesperrt.
 * → 'geteilt' | 'abgebrochen' | 'link' | 'nochmal' (Handy: Erstellen dauerte zu lange, noch einmal tippen) | 'gesperrt'
 */
export async function sendFileWhatsApp({ kind, makeBlob, name, text = '', phone = '', title = '' }) {
  if (!mayWhatsApp(kind)) {
    toast('Das darf nicht per WhatsApp hinaus (Finanzen).')
    return 'gesperrt'
  }
  const hint = `${text}${text ? '\n' : ''}(PDF „${name}“ im Anhang)`
  if (!canShareFiles()) {
    const opened = openWa(phone, hint)
    download(name, await makeBlob())
    toast(opened ? 'PDF gespeichert: in WhatsApp anhängen und senden.' : 'PDF gespeichert. Der Browser hat WhatsApp nicht geöffnet: Fenster erlauben oder WhatsApp selbst öffnen.')
    return 'link'
  }
  const blob = await makeBlob()
  const file = new File([blob], name, { type: blob.type || 'application/pdf' })
  if (!navigator.canShare({ files: [file] })) {
    download(name, blob)
    openWa(phone, hint)
    toast('PDF gespeichert: in WhatsApp anhängen und senden.')
    return 'link'
  }
  try {
    await navigator.share({ files: [file], title: title || name, text })
    return 'geteilt'
  } catch (err) {
    if (err?.name === 'AbortError') return 'abgebrochen'
    if (err?.name === 'NotAllowedError') {
      toast('Das PDF ist bereit: bitte noch einmal tippen und dann WhatsApp wählen.')
      return 'nochmal'
    }
    throw err
  }
}
