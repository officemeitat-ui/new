// Unterschrift am Bildschirm (Finger, Stift, Maus) für Dialoge: Schlüsselübergabe, Unterweisungen.
// Gespeichert wird keine Grafik, sondern eine kleine SVG-Linie (300 × 100), die auch ins PDF kommt.
//
//   signatureField('sig-key', 'Unterschrift Empfänger:in')  → HTML im Dialog
//   signatureSvg('sig-key')                                → '<svg …>' oder '' (nicht unterschrieben)
//   clearSignatures()                                      → beim Schließen bzw. nach dem Speichern
//
// Die Striche bleiben erhalten, wenn der Dialog neu gezeichnet wird.

import { onModalRender, registerActions } from './context.js'
import { esc } from './shared.js'

const W = 300
const H = 100
const strokes = new Map() // Name → [[[x, y], …], …]

export function signatureField(name, label = 'Unterschrift') {
  return `<div class="sig-field"><span class="sig-label">${esc(label)}</span><canvas class="sig-pad" data-sig="${esc(name)}" width="${W * 2}" height="${H * 2}" aria-label="${esc(label)}" role="img"></canvas>
    <button type="button" class="btn small ghost" data-action="sig-clear" data-sig="${esc(name)}">Löschen</button></div>`
}

/** Unterschrift als SVG (leer, wenn nichts gezeichnet). */
export function signatureSvg(name) {
  const lines = (strokes.get(name) || []).filter((s) => s.length > 1)
  if (!lines.length || lines.reduce((n, s) => n + s.length, 0) < 4) return ''
  const d = lines.map((s) => `M${s.map(([x, y]) => `${x} ${y}`).join('L')}`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><path d="${d}" fill="none" stroke="#13232f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

export const hasSignature = (name) => signatureSvg(name) !== ''
export const clearSignatures = (prefix = '') => {
  for (const k of [...strokes.keys()]) if (k.startsWith(prefix)) strokes.delete(k)
}

function draw(canvas) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(canvas.width / W, canvas.height / H)
  ctx.strokeStyle = '#13232f'
  ctx.lineWidth = 2.2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // Hilfslinie
  ctx.save()
  ctx.strokeStyle = '#c9d6df'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(12, H - 18)
  ctx.lineTo(W - 12, H - 18)
  ctx.stroke()
  ctx.restore()
  for (const s of strokes.get(canvas.dataset.sig) || []) {
    ctx.beginPath()
    s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    if (s.length === 1) ctx.lineTo(s[0][0] + 0.5, s[0][1])
    ctx.stroke()
  }
  ctx.restore()
}

function attach(canvas) {
  if (canvas.dataset.ready) return
  canvas.dataset.ready = '1'
  const name = canvas.dataset.sig
  let current = null
  const point = (e) => {
    const r = canvas.getBoundingClientRect()
    return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)]
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    canvas.setPointerCapture?.(e.pointerId)
    current = [point(e)]
    if (!strokes.has(name)) strokes.set(name, [])
    strokes.get(name).push(current)
    draw(canvas)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!current) return
    e.preventDefault()
    const p = point(e)
    const last = current.at(-1)
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) >= 2) {
      current.push(p)
      draw(canvas)
    }
  })
  const end = () => (current = null)
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener('pointerleave', end)
  draw(canvas)
}

onModalRender(($modal) => {
  for (const canvas of $modal.querySelectorAll('canvas.sig-pad')) attach(canvas)
})

registerActions({
  'sig-clear': (el) => {
    strokes.delete(el.dataset.sig)
    const canvas = document.querySelector(`canvas.sig-pad[data-sig="${CSS.escape(el.dataset.sig)}"]`)
    if (canvas) draw(canvas)
  },
})
