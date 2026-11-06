// Angebot online annehmen (kunden.php?a=…): Unterschrift mit Finger, Stift oder Maus. Die Striche gehen
// als Pfad („M12 30L14 31…“, ganze Zahlen im Feld 600 × 200) im versteckten Feld mit, kein Bild. Ohne
// JavaScript bleibt das Feld verborgen; die Unterschrift ist freiwillig.
;(() => {
  const form = document.querySelector('form[data-unterschrift]')
  const box = form && form.querySelector('.unterschrift')
  const canvas = box && box.querySelector('canvas')
  const feld = form && form.querySelector('input[name=unterschrift]')
  if (!canvas || !feld || !canvas.getContext || !window.PointerEvent) return
  const W = canvas.width
  const H = canvas.height
  const MAX = 15000 // Zeichen; so viel nimmt kunden.php
  const ctx = canvas.getContext('2d')
  const striche = []
  let strich = null
  box.hidden = false

  const zeichnen = () => {
    ctx.clearRect(0, 0, W, H)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#13232f'
    for (const s of striche) {
      ctx.beginPath()
      ctx.moveTo(s[0][0], s[0][1])
      for (const [x, y] of s.length > 1 ? s.slice(1) : [[s[0][0] + 0.5, s[0][1]]]) ctx.lineTo(x, y)
      ctx.stroke()
    }
  }
  const pfad = () => striche.map((s) => `M${s.map((p) => p.join(' ')).join('L')}${s.length === 1 ? `L${s[0].join(' ')}` : ''}`).join('')
  const punkt = (ev) => {
    const r = canvas.getBoundingClientRect()
    const x = Math.round(((ev.clientX - r.left) / r.width) * W)
    const y = Math.round(((ev.clientY - r.top) / r.height) * H)
    return [Math.max(0, Math.min(W, x)), Math.max(0, Math.min(H, y))]
  }
  const fertig = () => {
    strich = null
    const p = pfad()
    feld.value = p.length <= MAX ? p : ''
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (pfad().length > MAX) return
    ev.preventDefault()
    canvas.setPointerCapture(ev.pointerId)
    strich = [punkt(ev)]
    striche.push(strich)
    zeichnen()
  })
  canvas.addEventListener('pointermove', (ev) => {
    if (!strich) return
    const p = punkt(ev)
    const [lx, ly] = strich[strich.length - 1]
    if (Math.abs(p[0] - lx) + Math.abs(p[1] - ly) < 3) return
    strich.push(p)
    zeichnen()
  })
  canvas.addEventListener('pointerup', fertig)
  canvas.addEventListener('pointercancel', fertig)
  box.querySelector('[data-loeschen]').addEventListener('click', () => {
    striche.length = 0
    feld.value = ''
    zeichnen()
  })
  form.addEventListener('submit', () => {
    if (strich) fertig()
  })
})()
