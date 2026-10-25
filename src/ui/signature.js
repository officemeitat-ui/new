// Unterschriftsfeld für Finger oder Stift. <canvas class="sig-pad" data-sig="…">
// im Dialog; das Bild landet als PNG-Daten-URL in app.ui.modal.sig[…] und
// bleibt beim Neuzeichnen des Dialogs erhalten.

import { ACTIONS, app, onModalRender, registerActions } from './context.js'
import { esc } from './shared.js'

/** Feld zum Unterschreiben; das Bild kommt aus app.ui.modal.sig[key]. Änderungen meldet die Aktion „sig-changed“. */
export function signaturePad(key, { label, name = '', disabled = false, nameChange = '' }) {
  return `<div class="sig-box"><div class="sig-head"><span>${esc(label)}</span>${disabled ? '' : `<button type="button" class="btn small" data-action="sig-clear" data-sig="${key}">Löschen</button>`}</div>
    <canvas class="sig-pad ${disabled ? 'disabled' : ''}" data-sig="${key}" width="600" height="200" aria-label="${esc(label)}: mit Finger oder Stift unterschreiben"></canvas>
    <input type="text" id="sig-name-${key}" value="${esc(name)}" placeholder="Name in Blockschrift" ${disabled ? 'disabled' : ''} ${nameChange ? `data-change="${nameChange}" data-sig="${key}"` : ''}></div>`
}

const store = () => (app.ui.modal.sig ||= {})

function paint(canvas, data) {
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!data) return
  const img = new Image()
  img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  img.src = data
}

onModalRender(($modal) => {
  for (const canvas of $modal.querySelectorAll('canvas.sig-pad')) paint(canvas, app.ui.modal?.sig?.[canvas.dataset.sig] ?? null)
})

let drawing = null
document.addEventListener('pointerdown', (e) => {
  const canvas = e.target.closest?.('canvas.sig-pad')
  if (!canvas || canvas.classList.contains('disabled')) return
  e.preventDefault()
  canvas.setPointerCapture(e.pointerId)
  const r = canvas.getBoundingClientRect()
  const ctx = canvas.getContext('2d')
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#1b2a3a'
  const pos = (ev) => [((ev.clientX - r.left) / r.width) * canvas.width, ((ev.clientY - r.top) / r.height) * canvas.height]
  ctx.beginPath()
  ctx.moveTo(...pos(e))
  drawing = { canvas, ctx, pos }
})
document.addEventListener('pointermove', (e) => {
  if (!drawing) return
  drawing.ctx.lineTo(...drawing.pos(e))
  drawing.ctx.stroke()
})
document.addEventListener('pointerup', () => {
  if (!drawing) return
  const { canvas } = drawing
  store()[canvas.dataset.sig] = canvas.toDataURL('image/png')
  drawing = null
  ACTIONS['sig-changed']?.(canvas)
})

registerActions({
  'sig-clear': (el) => {
    store()[el.dataset.sig] = null
    const canvas = document.querySelector(`canvas.sig-pad[data-sig="${el.dataset.sig}"]`)
    if (canvas) paint(canvas, null)
    ACTIONS['sig-changed']?.(canvas || el)
  },
})
