// Corporate Design aus einer Website lesen: Logo, Markenfarben, Schriften
// und Farbe der Kopfzeile. Arbeitet nur mit Text (HTML, CSS), damit es
// ohne Browser und in Tests läuft.

import { hueDistance, parseColor, toHex, toHsl } from '../../src/core/color.js'

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(2).find((v) => v !== undefined) ?? ''
const resolve = (url, base) => {
  try {
    return new URL(url.replace(/&amp;/g, '&'), base).href
  } catch {
    return ''
  }
}

/** CSS in Regeln { selector, decls: Map } zerlegen (innerste Blöcke, auch in @media). */
export function cssRules(css) {
  const rules = []
  for (const m of stripComments(css).matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    const decls = new Map()
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':')
      if (i > 0) decls.set(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).replace(/!important/i, '').trim())
    }
    rules.push({ selector: m[1].trim(), decls })
  }
  return rules
}

const COLOR_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi
const PROMINENT = /header|nav|menu|btn|button|primary|accent|brand|cta|logo|hero|title|\bh1\b|\bh2\b|\ba\b|:hover|elementor-button|wp-block-button|wp-element-button/i
const HEADER_SEL = /(^|[\s,>.#])(header|site-header|masthead|elementor-location-header|navbar|top-?bar|main-header|header-main)\b/i

/** Markenfarben: gesättigte Farben, gewichtet nach Häufigkeit und Wichtigkeit des Selektors. */
export function colorCandidates(rules) {
  const tally = new Map()
  for (const { selector, decls } of rules) {
    const weight = PROMINENT.test(selector) ? 3 : 1
    for (const [prop, value] of decls) {
      if (!/^(color|background|background-color|border(-\w+)?-color|border|fill|stroke|outline-color|--)/.test(prop)) continue
      for (const raw of value.match(COLOR_RE) || []) {
        const c = parseColor(raw)
        if (!c || c.a < 0.6) continue
        const { s, l } = toHsl(c)
        if (s < 0.22 || l < 0.1 || l > 0.92) continue // Grau, fast Schwarz/Weiß
        const hex = toHex(c)
        tally.set(hex, (tally.get(hex) || 0) + weight)
      }
    }
  }
  // Ähnliche Töne zusammenfassen
  const clusters = []
  for (const [hex, weight] of [...tally].sort((a, b) => b[1] - a[1])) {
    const c = parseColor(hex)
    const near = clusters.find((k) => Math.hypot(k.c.r - c.r, k.c.g - c.g, k.c.b - c.b) < 30)
    if (near) near.weight += weight
    else clusters.push({ hex, c, weight })
  }
  return clusters.sort((a, b) => b.weight - a.weight).map(({ hex, weight }) => ({ hex, weight }))
}

/** Benannte Farben aus Baukästen (Elementor, WordPress, eigene Variablen). */
export function namedColors(rules) {
  const out = {}
  for (const { decls } of rules) {
    for (const [prop, value] of decls) {
      const m = prop.match(/^--(?:e-global-color|wp--preset--color|color|brand|theme|bs)[-_]+(primary|secondary|accent|brand|main|text)$/)
      const c = m && parseColor(value)
      if (c && !out[m[1]]) out[m[1]] = toHex(c)
    }
  }
  return { primary: out.primary || out.brand || out.main, secondary: out.secondary, accent: out.accent, text: out.text }
}

/** Primär- und Akzentfarbe festlegen. */
export function pickPalette({ named, themeColor, candidates }) {
  const saturated = (hex) => hex && toHsl(parseColor(hex)).s >= 0.22
  const primary = [named.primary, saturated(themeColor) ? themeColor : null, candidates[0]?.hex].find(Boolean) || null
  if (!primary) return { primary: null, accent: null }
  const accent = [named.accent, named.secondary, candidates.find((c) => hueDistance(c.hex, primary) > 30)?.hex].find((c) => c && c !== primary) || primary
  return { primary, accent }
}

const unquote = (s) => s.trim().replace(/^['"]|['"]$/g, '')
const firstFamily = (value) => unquote(value.split(',')[0] || '')
const GENERIC = /^(inherit|initial|unset|sans-serif|serif|monospace|system-ui|-apple-system|var\()/i

/** Schriften: Google-Fonts-Links, @font-face und wo welche Schrift verwendet wird. */
export function fonts(html, css, rules, base) {
  const googleUrls = new Set()
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const href = attr(tag, 'href')
    if (/fonts\.googleapis\.com\/css/i.test(href)) googleUrls.add(resolve(href, base))
  }
  for (const m of stripComments(css).matchAll(/@import\s+(?:url\()?['"]?([^'")\s]+fonts\.googleapis\.com\/css[^'")\s]*)/gi)) googleUrls.add(resolve(m[1], base))
  const googleFamilies = new Set()
  for (const url of googleUrls) {
    for (const fam of new URL(url).searchParams.getAll('family')) for (const part of fam.split('|')) googleFamilies.add(part.split(':')[0].replace(/\+/g, ' ').trim())
  }
  const fontFaces = []
  for (const m of stripComments(css).matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
    const family = unquote(m[1].match(/font-family\s*:\s*([^;]+)/i)?.[1] || '')
    const src = m[1].match(/src\s*:\s*([^;]+)/i)?.[1] || ''
    const url = [...src.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)\s*format\(\s*['"]?(woff2|woff)/gi)][0] || src.match(/url\(\s*['"]?([^'")]+\.woff2?)[^'")]*['"]?\s*\)/i)
    if (family && url) fontFaces.push({ family, url: resolve(url[1], base), weight: m[1].match(/font-weight\s*:\s*([^;]+)/i)?.[1].trim() || '400', style: m[1].match(/font-style\s*:\s*([^;]+)/i)?.[1].trim() || 'normal' })
  }
  const used = (test) => {
    const score = new Map()
    for (const { selector, decls } of rules) {
      if (!test.test(selector)) continue
      const v = decls.get('font-family')
      const fam = v && firstFamily(v)
      if (fam && !GENERIC.test(fam)) score.set(fam, (score.get(fam) || 0) + 1)
    }
    return [...score].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
  }
  const named = (key) => {
    for (const { decls } of rules) for (const [p, v] of decls) if (new RegExp(`^--e-global-typography-${key}-font-family$`).test(p)) return firstFamily(v)
    return ''
  }
  const body = named('text') || used(/(^|,)\s*(body|html|p)\b/i) || [...googleFamilies][0] || fontFaces[0]?.family || ''
  const heading = named('primary') || used(/\bh[1-3]\b|heading|title/i) || body
  return { googleUrls: [...googleUrls], googleFamilies: [...googleFamilies], fontFaces, heading, body }
}

/** Logo: Bild oder SVG mit „logo“ im Namen, bevorzugt in der Kopfzeile. */
export function findLogo(html, base) {
  const headerEnd = html.search(/<\/header>/i)
  const candidates = []
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0]
    const src = attr(tag, 'src') || attr(tag, 'data-src') || (attr(tag, 'srcset') || '').split(/\s+/)[0]
    if (!src || src.startsWith('data:image/gif')) continue
    const hay = `${attr(tag, 'class')} ${attr(tag, 'id')} ${attr(tag, 'alt')} ${src}`.toLowerCase()
    let score = /logo/.test(hay) ? 5 : 0
    if (headerEnd > 0 && m.index < headerEnd) score += 3
    if (/custom-logo|site-logo|navbar-brand/.test(hay)) score += 2
    if (score) candidates.push({ score: score - m.index / 1e6, url: resolve(src, base), alt: attr(tag, 'alt') })
  }
  for (const m of html.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi)) {
    const open = m[0].match(/<svg\b[^>]*>/i)[0]
    const hay = `${attr(open, 'class')} ${attr(open, 'id')} ${attr(open, 'aria-label')}`.toLowerCase()
    if (/logo/.test(hay)) candidates.push({ score: 6 + (headerEnd > 0 && m.index < headerEnd ? 3 : 0) - m.index / 1e6, svg: m[0] })
  }
  candidates.sort((a, b) => b.score - a.score)
  if (candidates[0]) return candidates[0]
  const icon = (html.match(/<link\b[^>]*rel=["'][^"']*(apple-touch-icon|icon)[^"']*["'][^>]*>/i) || [])[0]
  return icon ? { url: resolve(attr(icon, 'href'), base), icon: true } : null
}

/** Hintergrund der Kopfzeile (hell oder in Markenfarbe?). */
export function headerBackground(rules) {
  for (const { selector, decls } of rules) {
    if (!HEADER_SEL.test(selector) || /\s(a|li|span|ul|button)\b|:hover|::/.test(selector)) continue
    const v = decls.get('background-color') || decls.get('background') || ''
    const raw = v.match(COLOR_RE)?.[0]
    const c = raw && parseColor(raw)
    if (c && c.a >= 0.6) return toHex(c)
  }
  return null
}

/** Alles zusammen. */
export function extractBrand({ html, css, base }) {
  const rules = cssRules(css + '\n' + [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n'))
  const inline = [...html.matchAll(/\sstyle=["']([^"']+)["']/gi)].map((m) => ({ selector: 'inline', decls: new Map(m[1].split(';').map((d) => [d.split(':')[0]?.trim().toLowerCase(), d.split(':').slice(1).join(':').trim()])) }))
  const themeColor = attr((html.match(/<meta\b[^>]*name=["']theme-color["'][^>]*>/i) || [''])[0], 'content') || null
  const named = namedColors(rules)
  const candidates = colorCandidates([...rules, ...inline])
  const palette = pickPalette({ named, themeColor: themeColor && parseColor(themeColor) ? toHex(parseColor(themeColor)) : null, candidates })
  return {
    title: (html.match(/<title>([^<]*)<\/title>/i)?.[1] || '').trim(),
    ...palette,
    named,
    themeColor,
    candidates: candidates.slice(0, 8),
    fonts: fonts(html, css, rules, base),
    logo: findLogo(html, base),
    header: headerBackground(rules),
  }
}

/** Stylesheets einer Seite (Links und @import). */
export function stylesheetUrls(html, base) {
  const urls = []
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/rel=["']?[^"'>]*stylesheet/i.test(tag)) continue
    const href = attr(tag, 'href')
    if (href && !/fonts\.googleapis\.com/i.test(href)) urls.push(resolve(href, base))
  }
  return urls.filter(Boolean)
}
