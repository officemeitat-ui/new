// KI beim Erfassen (Kürzel „kix-“): gemeinsame Teile für „Aus Beleg lesen (KI)“ (Einkauf), „Diktieren“
// (Regiebericht), „Antwort mit KI entwerfen“ (Reklamation) und „Text mit KI verbessern“ (Mahnung).
//  - Knöpfe nur, wenn der KI-Assistent am Webspace eingerichtet und eingeschaltet ist (ki.php?aktion=status,
//    wie „Mit KI übersetzen“); sonst gibt es sie gar nicht.
//  - Vor dem ersten Senden einmal je Gerät der Hinweis „wird zur Auswertung an Anthropic übertragen“.
//  - Dateien vorher verkleinern bzw. begrenzen (core/ki-vorschlag.js, KI_LIMITS), Fehler verständlich anzeigen.
// Geladen nur mit den Modulen (views/lazy.js), nicht beim Start. Anfragen: src/ai/extract.js.

import { KI_LIMITS, maxUploadBytes, pdfPageCount } from '../core/ki-vorschlag.js'
import { speechAvailable, startSpeech } from './speech.js'
import { ACTIONS, app, onModalRender, registerActions } from './context.js'
import { esc } from './shared.js'

const STATUS = { ok: null, at: 0, postMax: 0, pending: null }
const STALE = 300e3
const CONSENT = 'kix-hinweis'
const off = () => app.config?.assistant === false
const fresh = () => Date.now() - STATUS.at < STALE

/** Ist die KI eingerichtet und eingeschaltet? (gemerkt; „nein“ wird nach 5 Minuten neu gefragt) */
export function kixCheck() {
  if (off()) return Promise.resolve(false)
  if (STATUS.ok === true || (STATUS.ok === false && fresh())) return Promise.resolve(STATUS.ok)
  STATUS.pending ||= import('../ai/agent.js')
    .then((m) => m.kiRequest('status'))
    .then(
      (st) => {
        STATUS.ok = !!st?.aktiv
        STATUS.postMax = Number(st?.php?.postMax) || 0
      },
      () => (STATUS.ok = false),
    )
    .then(() => {
      STATUS.at = Date.now()
      STATUS.pending = null
      reveal()
      return STATUS.ok
    })
  return STATUS.pending
}

/** Knopf (HTML) nur mit eingerichteter KI: bekannt → gleich da oder gar nicht, sonst verborgen bis zur Antwort. */
export function kixButton(html) {
  if (off() || (STATUS.ok === false && fresh())) return ''
  if (STATUS.ok === true) return html
  return `<span class="kix-wait" hidden>${html}</span>`
}

function reveal() {
  if (typeof document === 'undefined') return
  for (const el of document.querySelectorAll('.kix-wait')) STATUS.ok ? el.removeAttribute('hidden') : el.remove()
}
onModalRender(($modal) => {
  if ($modal.querySelector('.kix-wait')) kixCheck().then(reveal)
})

/** Nach einem Fehler: nicht eingerichtet → Knöpfe verschwinden beim nächsten Zeichnen. Liefert den Text für die Person. */
export function kixFailed(err) {
  if (err?.code === 'setup') Object.assign(STATUS, { ok: false, at: Date.now() })
  return err?.message || String(err)
}

// ---------------------------------------------------------------- Hinweis vor dem ersten Senden

function consented() {
  try {
    return localStorage.getItem(CONSENT) === '1'
  } catch {
    return false
  }
}

/**
 * Vor dem Senden: true, wenn der Hinweis auf diesem Gerät schon bestätigt ist. Sonst zeigt die Box den Hinweis
 * (what: was gesendet wird, z. B. „Der Beleg“) und nach „Verstanden, senden“ läuft retry ({ action, data }) erneut.
 */
export function kixConsent(kind, what, retry) {
  if (consented()) return true
  kixSet(kind, { consent: what, retry })
  return false
}

// ---------------------------------------------------------------- Box für Hinweis, Fortschritt, Fehler, Ergebnis

const LEVEL = { error: 'err-text', warning: 'warn-text', info: 'muted' }

function boxInner(kind, s = {}) {
  if (s.consent)
    return `<div class="kix-consent"><p><strong>Hinweis:</strong> ${esc(s.consent)} wird zur Auswertung an den KI-Dienst Anthropic übertragen (Auftragsverarbeiter, siehe Datenschutzinformation) und zählt zum Tageslimit. Gespeichert wird nichts davon in der App; das Ergebnis ist ein Vorschlag zum Prüfen. Diese Frage kommt auf diesem Gerät nur einmal.</p>
      <div class="actions"><button type="button" class="btn small" data-action="kix-cancel" data-kind="${esc(kind)}">Abbrechen</button><button type="button" class="btn small primary" data-action="kix-ok" data-kind="${esc(kind)}">Verstanden, senden</button></div></div>`
  if (s.busy) return `<p class="kix-busy"><span class="ai-dots"></span> ${esc(s.busy)}</p>`
  if (s.error) return `<p class="kix-error" role="alert">${esc(s.error)}</p>`
  if (s.notice)
    return `<div class="kix-note"><p><span class="pill info">KI</span> <strong>${esc(s.notice.title)}</strong></p>${s.notice.items?.length ? `<ul>${s.notice.items.map((p) => `<li class="${LEVEL[p.level] || ''}">${esc(p.text)}</li>`).join('')}</ul>` : ''}</div>`
  return ''
}

/** Box im Dialog (Platz für Hinweis, „liest …“, Fehler, Ergebnis); Zustand liegt im Dialog (übersteht Neuzeichnen). */
export const kixBox = (kind) => `<div class="kix-box" id="kix-box-${esc(kind)}" aria-live="polite">${boxInner(kind, app.ui.modal?.kix?.[kind])}</div>`

/** Zustand der Box setzen und an Ort und Stelle zeigen (ohne den Dialog neu zu zeichnen). */
export function kixSet(kind, state = {}) {
  const m = app.ui.modal
  if (!m) return
  m.kix = { ...(m.kix || {}), [kind]: state }
  const el = typeof document !== 'undefined' ? document.getElementById(`kix-box-${kind}`) : null
  if (el) el.innerHTML = boxInner(kind, state)
}

registerActions({
  'kix-ok': (el) => {
    try {
      localStorage.setItem(CONSENT, '1')
    } catch {
      // ohne Speicher fragt die App beim nächsten Mal wieder
    }
    const kind = el.dataset.kind
    const s = app.ui.modal?.kix?.[kind]
    kixSet(kind, {})
    if (s?.retry?.action) return ACTIONS[s.retry.action]?.({ dataset: { ...(s.retry.data || {}), consent: '1' } })
  },
  'kix-cancel': (el) => kixSet(el.dataset.kind, {}),
})

// ---------------------------------------------------------------- Dateien

const fail = (message, code = 'size') => Object.assign(new Error(message), { code })
const mb = (n) => `${String(Math.round((n / 1048576) * 10) / 10).replace('.', ',')} MB`

function base64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Bild für die KI: längste Seite höchstens 1568 Pixel, JPEG (weniger Daten, gleiche Lesbarkeit). */
async function imageForKi(file) {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, KI_LIMITS.imageSide / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
    if (blob) return blob
  } catch {
    // unten: Bild unverändert, wenn das Format passt
  }
  if (/^image\/(jpeg|png|gif|webp)$/.test(file.type)) return file
  throw fail('Dieses Bildformat kann die KI nicht lesen. Bitte als Foto (JPEG) oder PDF.', 'format')
}

/**
 * Datei für die KI vorbereiten → { kind: 'image' | 'pdf', mediaType, data (base64) }. Bilder verkleinert, PDFs bis
 * zur Grenze (Größe, Seiten, post_max_size des Webspace). Wirft mit verständlicher Meldung.
 */
export async function kixFile(file, { pages = KI_LIMITS.pdfPages } = {}) {
  if (!file) throw fail('Bitte zuerst eine Datei wählen.', 'file')
  const max = maxUploadBytes(STATUS.postMax)
  if (/^image\//.test(file.type)) {
    const blob = await imageForKi(file)
    if (blob.size > max) throw fail(`Das Bild ist zu groß für die KI (${mb(blob.size)}, höchstens ${mb(max)}).`)
    return { kind: 'image', mediaType: blob.type || 'image/jpeg', data: base64(new Uint8Array(await blob.arrayBuffer())) }
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
    if (file.size > max) throw fail(`Das PDF ist zu groß für die KI (${mb(file.size)}, höchstens ${mb(max)}). Bitte nur die nötigen Seiten als PDF speichern oder ein Foto nehmen.`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const n = pdfPageCount(bytes)
    if (n > pages) throw fail(`Das PDF hat ${n} Seiten; für die KI höchstens ${pages}. Bitte nur die nötigen Seiten nehmen.`, 'pages')
    return { kind: 'pdf', mediaType: 'application/pdf', data: base64(bytes) }
  }
  throw fail('Für die KI bitte ein Foto oder ein PDF nehmen.', 'format')
}

/** Eigene Firma (Name, UID) aus den Einstellungen der Fakturierung, sonst der Name der Marke. Keine Personen. */
export function kixOurs() {
  const s = app.data?.fakturierung?.settings?.sender || {}
  return { name: s.name || app.config?.brand?.name || '', uid: s.uid || '' }
}

// ---------------------------------------------------------------- Spracheingabe (wie im Assistenten-Chat)

let recognizer = null
export const kixSpeech = speechAvailable

/** Diktieren in ein Textfeld (an den vorhandenen Text anhängen); noch einmal: aufhören. */
export function kixDictate(fieldId, onState = () => {}) {
  if (recognizer) return recognizer.stop()
  const field = document.getElementById(fieldId)
  const before = field?.value.trim() ? `${field.value.trim()} ` : ''
  recognizer = startSpeech({
    continuous: true,
    onText: (done, interim) => {
      const el = document.getElementById(fieldId)
      if (el) el.value = `${before}${done}${interim}`.trim()
    },
    onEnd: () => {
      recognizer = null
      onState(false)
    },
  })
  if (recognizer) onState(true)
}
export const kixListening = () => !!recognizer
