// Farben lesen, mischen und auf Lesbarkeit (WCAG-Kontrast) prüfen.

const clamp = (v, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, v))

/** "#0a3d6b", "#fff", "rgb(10 61 107 / .5)", "rgba(10,61,107,0.5)", "hsl(210 80% 30%)" → { r, g, b, a } */
export function parseColor(input) {
  const s = String(input || '').trim().toLowerCase()
  let m = s.match(/^#([0-9a-f]{3,8})$/)
  if (m) {
    let hex = m[1]
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('')
    if (hex.length !== 6 && hex.length !== 8) return null
    const n = (i) => parseInt(hex.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 }
  }
  m = s.match(/^rgba?\(([^)]+)\)$/)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean)
    const ch = (v) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v))
    const [r, g, b] = parts.slice(0, 3).map(ch)
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
    return [r, g, b, a].every(Number.isFinite) ? { r: clamp(r), g: clamp(g), b: clamp(b), a } : null
  }
  m = s.match(/^hsla?\(([^)]+)\)$/)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean)
    const h = parseFloat(parts[0])
    const sat = parseFloat(parts[1]) / 100
    const l = parseFloat(parts[2]) / 100
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
    if (![h, sat, l, a].every(Number.isFinite)) return null
    const k = (n) => (n + h / 30) % 12
    const f = (n) => l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
    return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255), a }
  }
  return null
}

export const toHex = ({ r, g, b }) => `#${[r, g, b].map((v) => Math.round(clamp(v)).toString(16).padStart(2, '0')).join('')}`

export function toHsl({ r, g, b }) {
  const [R, G, B] = [r, g, b].map((v) => v / 255)
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
  return { h: h * 60, s, l }
}

export function luminance(color) {
  const c = typeof color === 'string' ? parseColor(color) : color
  const lin = (v) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Mischt a mit b (t = Anteil von b). */
export function mix(a, b, t) {
  const A = typeof a === 'string' ? parseColor(a) : a
  const B = typeof b === 'string' ? parseColor(b) : b
  return toHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t })
}

/** Farbe so lange zu Schwarz bzw. Weiß hin verschieben, bis sie auf `bg` lesbar ist. */
export function readableOn(color, bg, ratio = 4.5) {
  const towards = luminance(bg) > 0.5 ? '#000000' : '#ffffff'
  for (let t = 0; t <= 1.0001; t += 0.04) {
    const c = mix(color, towards, t)
    if (contrast(c, bg) >= ratio) return c
  }
  return towards
}

/** Weiß oder fast Schwarz als Schrift auf dieser Farbe. */
export const textOn = (bg) => (contrast('#ffffff', bg) >= contrast('#111827', bg) ? '#ffffff' : '#111827')

export const hueDistance = (a, b) => {
  const d = Math.abs(toHsl(parseColor(a)).h - toHsl(parseColor(b)).h) % 360
  return d > 180 ? 360 - d : d
}
