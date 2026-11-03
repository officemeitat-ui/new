// Kleine Karte für das Niederschlagsradar: Kacheln (OpenStreetMap oder
// basemap.at), darüber das Radarbild auf einem <canvas>, Orte und Objekte als
// Punkte. Ziehen, Mausrad, Doppelklick, zwei Finger und +/− zum Zoomen.
// Ohne Bibliothek; Kacheln im Web-Mercator-Raster (256 px). Zoom auch in
// Zwischenstufen (Kacheln der nächsten Stufe, gestreckt), damit der Ausschnitt
// genau in die Karte passt.

import { framePixels } from '../core/nowcast.js'

export const TILE_SOURCES = {
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: 'Karte © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a>', maxZoom: 13 },
  // Verwaltungsgrundkarte Österreich (grau): nur Österreich, außerhalb leer
  basemap: { url: 'https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png', attribution: 'Karte: <a href="https://basemap.at" target="_blank" rel="noopener">basemap.at</a> (CC BY 4.0)', maxZoom: 13 },
}

const TILE = 256
const MIN_ZOOM = 6
const escape = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const worldX = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z
const worldY = (lat, z) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z
}

export class RadarMap {
  /** tiles: Schlüssel aus TILE_SOURCES oder { url, attribution, maxZoom } */
  constructor(root, { tiles = 'osm' } = {}) {
    this.src = typeof tiles === 'string' ? TILE_SOURCES[tiles] || TILE_SOURCES.osm : { ...TILE_SOURCES.osm, ...tiles }
    this.root = root
    this.root.classList.add('wx-map')
    this.root.innerHTML = `<div class="wx-map-tiles"></div><canvas class="wx-map-radar"></canvas><div class="wx-map-marks"></div>
      <div class="wx-map-zoom"><button type="button" class="btn small" data-zoom="1" aria-label="Vergrößern">+</button><button type="button" class="btn small" data-zoom="-1" aria-label="Verkleinern">−</button></div>
      <div class="wx-map-attr"></div>`
    this.tilesEl = root.querySelector('.wx-map-tiles')
    this.canvas = root.querySelector('.wx-map-radar')
    this.marksEl = root.querySelector('.wx-map-marks')
    this.attrEl = root.querySelector('.wx-map-attr')
    this.tileImgs = new Map()
    this.z = 9 // auch Zwischenstufen
    this.cx = 0 // Mitte in Weltpixeln bei Stufe z
    this.cy = 0
    this.frame = null
    this.marks = []
    this.#bind()
    this.resizer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.draw()) : null
    this.resizer?.observe(root)
  }

  get size() {
    return { w: this.root.clientWidth || 600, h: this.root.clientHeight || 360 }
  }

  setAttribution(html) {
    this.attrEl.innerHTML = [html, this.src.attribution].filter(Boolean).join(' · ')
  }

  /** Ausschnitt genau einpassen (mit etwas Rand). */
  fit(bbox, pad = 0.96) {
    const { w, h } = this.size
    const dx = worldX(bbox.e, 0) - worldX(bbox.w, 0)
    const dy = worldY(bbox.s, 0) - worldY(bbox.n, 0)
    const z = Math.log2(Math.min((w * pad) / dx, (h * pad) / dy))
    this.z = Math.max(MIN_ZOOM, Math.min(this.src.maxZoom, z))
    this.cx = (worldX(bbox.w, this.z) + worldX(bbox.e, this.z)) / 2
    this.cy = (worldY(bbox.n, this.z) + worldY(bbox.s, this.z)) / 2
    this.draw()
  }

  /** Punkte: [{ lat, lon, label, kind: 'ort'|'objekt', title }] */
  setMarks(marks) {
    this.marks = marks
    this.#drawMarks()
  }

  /** Radarbild zeigen (oder null). Das Bild wird einmal je Zeitpunkt in Rastergröße gemalt. */
  show(frame) {
    if (frame && !frame.bitmap) {
      const { w, h } = frame.raster
      const off = document.createElement('canvas')
      off.width = w
      off.height = h
      off.getContext('2d').putImageData(new ImageData(framePixels(frame), w, h), 0, 0)
      frame.bitmap = off
    }
    this.frame = frame
    this.#drawRadar()
  }

  /** Zoomen um dz Stufen (auch halbe); der Punkt unter (px, py) bleibt stehen. */
  zoomBy(dz, px, py) {
    const z = Math.max(MIN_ZOOM, Math.min(this.src.maxZoom, this.z + dz))
    if (Math.abs(z - this.z) < 1e-6) return
    const { w, h } = this.size
    const ax = px ?? w / 2
    const ay = py ?? h / 2
    const f = 2 ** (z - this.z)
    const wx = this.cx - w / 2 + ax
    const wy = this.cy - h / 2 + ay
    this.cx = wx * f - ax + w / 2
    this.cy = wy * f - ay + h / 2
    this.z = z
    this.draw()
  }

  draw() {
    this.#drawTiles()
    this.#drawRadar()
    this.#drawMarks()
  }

  destroy() {
    this.resizer?.disconnect()
  }

  #screen(lat, lon) {
    const { w, h } = this.size
    return [worldX(lon, this.z) - this.cx + w / 2, worldY(lat, this.z) - this.cy + h / 2]
  }

  #drawTiles() {
    const { w, h } = this.size
    const tz = Math.max(0, Math.min(this.src.maxZoom, Math.round(this.z)))
    const scale = 2 ** (this.z - tz)
    const size = TILE * scale
    const x0 = this.cx - w / 2
    const y0 = this.cy - h / 2
    const n = 2 ** tz
    const want = new Set()
    for (let ty = Math.floor(y0 / size); ty <= Math.floor((y0 + h) / size); ty++) {
      if (ty < 0 || ty >= n) continue
      for (let tx = Math.floor(x0 / size); tx <= Math.floor((x0 + w) / size); tx++) {
        const key = `${tz}/${tx}/${ty}`
        want.add(key)
        let img = this.tileImgs.get(key)
        if (!img) {
          img = document.createElement('img')
          img.alt = ''
          img.decoding = 'async'
          img.draggable = false
          img.referrerPolicy = 'origin' // OpenStreetMap verlangt die Herkunft der Seite
          const wrap = ((tx % n) + n) % n
          img.src = this.src.url.replace('{z}', tz).replace('{x}', wrap).replace('{y}', ty)
          img.addEventListener('error', () => img.classList.add('missing'))
          this.tileImgs.set(key, img)
          this.tilesEl.append(img)
        }
        // eine Spur größer, damit zwischen gestreckten Kacheln keine Haarlinien bleiben
        img.style.transform = `translate(${(tx * size - x0).toFixed(1)}px, ${(ty * size - y0).toFixed(1)}px) scale(${((size + 0.6) / TILE).toFixed(4)})`
      }
    }
    for (const [key, img] of this.tileImgs) {
      if (want.has(key)) continue
      img.remove()
      this.tileImgs.delete(key)
    }
  }

  #drawRadar() {
    const { w, h } = this.size
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr)
      this.canvas.height = Math.round(h * dpr)
      this.canvas.style.width = `${w}px`
      this.canvas.style.height = `${h}px`
    }
    const ctx = this.canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const f = this.frame
    if (!f?.bitmap) return
    const b = f.raster.bbox
    const [x1, y1] = this.#screen(b.n, b.w)
    const [x2, y2] = this.#screen(b.s, b.e)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(f.bitmap, x1, y1, x2 - x1, y2 - y1)
    // Rand des Ausschnitts (außerhalb gibt es keine Daten)
    ctx.strokeStyle = 'rgba(90, 100, 120, 0.45)'
    ctx.setLineDash([4, 4])
    ctx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1 - 1, y2 - y1 - 1)
    ctx.setLineDash([])
  }

  #drawMarks() {
    const { w, h } = this.size
    this.marksEl.innerHTML = this.marks
      .map((m) => {
        const [x, y] = this.#screen(m.lat, m.lon)
        if (x < -40 || y < -20 || x > w + 40 || y > h + 20) return ''
        const label = m.kind === 'ort' ? `<span class="wx-mark-label">${escape(m.label)}</span>` : ''
        return `<span class="wx-mark ${m.kind}" style="transform:translate(${Math.round(x)}px, ${Math.round(y)}px)" title="${escape(m.title || m.label)}"><i></i>${label}</span>`
      })
      .join('')
  }

  #bind() {
    const el = this.root
    const pointers = new Map()
    let pinch = null
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-zoom]')
      if (b) this.zoomBy(Number(b.dataset.zoom))
    })
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, a')) return
      el.setPointerCapture?.(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }
      }
      el.classList.add('dragging')
    })
    el.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId)
      if (!p) return
      if (pointers.size === 1) {
        this.cx -= e.clientX - p.x
        this.cy -= e.clientY - p.y
        p.x = e.clientX
        p.y = e.clientY
        this.draw()
        return
      }
      p.x = e.clientX
      p.y = e.clientY
      const [a, b] = [...pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch && pinch.d > 0 && Math.abs(Math.log2(d / pinch.d)) > 0.05) {
        // zwei Finger: stufenlos
        const r = el.getBoundingClientRect()
        this.zoomBy(Math.log2(d / pinch.d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top)
        pinch.d = d
      }
    })
    const up = (e) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinch = null
      if (!pointers.size) el.classList.remove('dragging')
    }
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const r = el.getBoundingClientRect()
        this.zoomBy(Math.max(-0.5, Math.min(0.5, -e.deltaY / 240)), e.clientX - r.left, e.clientY - r.top)
      },
      { passive: false },
    )
    el.addEventListener('dblclick', (e) => {
      const r = el.getBoundingClientRect()
      this.zoomBy(1, e.clientX - r.left, e.clientY - r.top)
    })
    el.addEventListener('keydown', (e) => {
      const step = 60
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      if (moves[e.key]) {
        e.preventDefault()
        this.cx += moves[e.key][0]
        this.cy += moves[e.key][1]
        this.draw()
      } else if (e.key === '+' || e.key === '=') this.zoomBy(1)
      else if (e.key === '-') this.zoomBy(-1)
    })
  }
}
