// Theme-Datei (themes/<name>.css) aus den Markenwerten erzeugen. Alle
// Farben werden auf Lesbarkeit geprüft (Kontrast ≥ 4,5:1 für Text).

import { luminance, mix, readableOn, textOn } from '../../src/core/color.js'

const fontStack = (family, fallback) => (family ? `'${family.replace(/'/g, '')}', ${fallback}` : fallback)

/** Eintrag für config.json → brand.themes (Vorschau im Dialog „Darstellung“). */
export function themeEntry(brand) {
  const P = brand.primary
  const lightHeader = !brand.header || luminance(brand.header) > 0.6
  return {
    label: brand.label || brand.name,
    note: brand.source ? `Aus ${brand.source} übernommen` : 'Hausfarben',
    preview: { header: lightHeader ? '#ffffff' : brand.header, headerLine: brand.accent || P, logo: lightHeader ? P : '#ffffff', bg: mix('#f3f5f8', P, 0.03), line: mix('#d6dde5', P, 0.06), primary: readableOn(P, '#ffffff', 4.5), text: mix('#141c26', P, 0.12), ok: '#1d7646', okSoft: '#e1f2e8' },
    dark: mix('#0c131a', P, 0.04),
  }
}

/**
 * Theme-Datei: Farbschema „name“ (data-skin, wählbar unter „Darstellung“)
 * und Markenregeln für Logo (data-brand).
 * @param brand { name, primary, accent, heading, body, imports[], fontFaces[{family,file,weight,style}], header, logoHeight, source }
 * header: Hintergrund der Kopfzeile auf der Website (null/hell → helle Kopfzeile)
 */
export function themeCss(brand) {
  const name = brand.name
  const P = brand.primary
  const A = brand.accent || P
  const lightHeader = !brand.header || luminance(brand.header) > 0.6
  const sel = `:root[data-skin='${name}']`
  const darkSurface = '#151d26'
  const tokens = {
    '--brand-primary': P,
    '--brand-primary-2': brand.header && !lightHeader ? mix(brand.header, '#000000', 0.12) : mix(P, '#000000', 0.15),
    '--brand-accent': A,
    '--brand-on-primary': textOn(P),
    '--brand-on-accent': textOn(A),
    '--bg': mix('#f3f5f8', P, 0.03),
    '--surface': '#ffffff',
    '--surface-2': mix('#e9edf2', P, 0.05),
    '--line': mix('#d6dde5', P, 0.06),
    '--line-strong': mix('#95a3b2', P, 0.1),
    '--fg': mix('#141c26', P, 0.12),
    '--muted': '#55606e',
    '--accent': readableOn(P, '#ffffff', 4.5),
    '--accent-fg': '#ffffff',
    '--accent-soft': mix('#ffffff', P, 0.12),
    '--band': mix('#ffffff', P, 0.18),
    '--font-display': fontStack(brand.heading, "'Segoe UI', system-ui, sans-serif"),
    '--font-body': fontStack(brand.body, "'Segoe UI', system-ui, sans-serif"),
  }
  const dark = {
    '--brand-primary': mix(P, '#000000', 0.45),
    '--brand-primary-2': mix(P, '#000000', 0.55),
    '--bg': mix('#0c131a', P, 0.04),
    '--surface': mix(darkSurface, P, 0.03),
    '--surface-2': mix('#1b2633', P, 0.05),
    '--line': mix('#283545', P, 0.06),
    '--line-strong': '#4c5d70',
    '--fg': '#e4eaf1',
    '--muted': '#98a6b6',
    '--accent': readableOn(mix(P, '#ffffff', 0.25), darkSurface, 4.5),
    '--accent-fg': '#0b1322',
    '--accent-soft': mix(darkSurface, P, 0.25),
    '--band': mix('#1e2a3a', P, 0.2),
  }
  const block = (vars) => Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')
  const faces = (brand.fontFaces || []).map((f) => `@font-face { font-family: '${f.family}'; src: url('${f.file}') format('${f.file.endsWith('.woff') ? 'woff' : 'woff2'}'); font-weight: ${f.weight}; font-style: ${f.style}; font-display: swap; }`).join('\n')
  const imports = (brand.imports || []).map((u) => `@import url('${u}');`).join('\n')

  // Kopfzeile wie auf der Website: hell mit farbiger Linie oder in Markenfarbe
  const topbar = lightHeader
    ? `/* Kopfzeile hell wie auf der Website (Logo bleibt auch im Dunkelmodus gut sichtbar) */
[data-skin='${name}'] .topbar { background: #ffffff; color: #141c26; border-bottom: 3px solid var(--brand-accent); }
[data-skin='${name}'] body::before { background: #ffffff; }
[data-skin='${name}'] .topbar .btn { background: #ffffff; border-color: #d6dde5; color: #141c26; }
[data-skin='${name}'] .topbar .btn:hover { border-color: ${P}; }
[data-skin='${name}'] .topbar .btn.primary { background: var(--brand-primary); border-color: var(--brand-primary); color: var(--brand-on-primary); }
[data-skin='${name}'] .topbar .kw small, [data-skin='${name}'] .topbar .brand-text small, [data-skin='${name}'] .userbox { color: #55606e; }
[data-skin='${name}'] .topbar .flag { color: #ffffff; }`
    : `/* Kopfzeile in Markenfarbe wie auf der Website */
[data-skin='${name}'] .topbar { background: linear-gradient(100deg, var(--brand-primary), var(--brand-primary-2)); border-bottom: 0; color: var(--brand-on-primary); }
[data-skin='${name}'] body::before { background: var(--brand-primary); }
[data-skin='${name}'] .topbar .btn { background: rgb(255 255 255 / 0.08); border-color: rgb(255 255 255 / 0.28); color: var(--brand-on-primary); }
[data-skin='${name}'] .topbar .btn:hover { background: rgb(255 255 255 / 0.16); }
[data-skin='${name}'] .topbar .btn.primary { background: var(--brand-accent); border-color: var(--brand-accent); color: var(--brand-on-accent); font-weight: 700; }
[data-skin='${name}'] .topbar .kw small, [data-skin='${name}'] .topbar .brand-text small, [data-skin='${name}'] .userbox { color: rgb(255 255 255 / 0.75); }
[data-skin='${name}'] .topbar .pill.info { background: rgb(255 255 255 / 0.14); color: var(--brand-on-primary); }`

  return `/* Corporate Design „${name}“, erzeugt mit „npm run theme“${brand.source ? ` aus ${brand.source}` : ''}.
   Primärfarbe ${P}, Akzent ${A}${brand.heading ? `, Schrift ${brand.heading}${brand.body && brand.body !== brand.heading ? ` / ${brand.body}` : ''}` : ''}.
   Werte bei Bedarf hier anpassen; neu erzeugen überschreibt die Datei. */
${imports}
${faces}

${sel} {
${block(tokens)}
}
@media (prefers-color-scheme: dark) {
  ${sel}:not([data-theme='light']) {
${block(dark).replace(/^/gm, '  ')}
  }
}
${sel}[data-theme='dark'] {
${block(dark)}
}

${topbar}
[data-brand='${name}'] .brand-logo { height: ${brand.logoHeight || 34}px; }
[data-brand='${name}'] .brand-text { border-left: 1px solid currentColor; border-left-color: rgb(127 127 127 / 0.35); padding-left: 12px; }
[data-skin='${name}'] .tab[aria-current='page'] { border-bottom-color: var(--brand-accent); }
[data-skin='${name}'] .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
[data-skin='${name}'] .flow-step.next b { color: var(--accent); }
`
}
