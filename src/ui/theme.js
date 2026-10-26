// Darstellung: Farbschema, hell/dunkel und Schriftgröße. Jede Person wählt
// für ihr Gerät; die Voreinstellung für alle kommt aus config.json
// (brand.theme). Marken-Farbschemata (nach der Website der Firma) stehen
// in themes/<marke>.css und sind in brand.themes beschrieben; die
// eingebauten (Standard, Ruhig, Hoher Kontrast) haben keinen Markenbezug.

import { app, closeModal, openModal, registerActions, registerModal, renderModal, renderNow } from './context.js'
import { esc, ICON, modalFrame } from './shared.js'

/** preview: Farben für die Vorschaukarte (header, headerLine, logo, bg, line, primary, text, ok, okSoft) */
export const BUILTIN_THEMES = {
  standard: { label: 'Standard', note: 'Blau und Grau, schmale Schrift', preview: { header: '#ffffff', headerLine: '#d2d9e1', logo: '#1d4ea6', bg: '#f1f3f6', line: '#d2d9e1', primary: '#1d4ea6', text: '#142030', ok: '#1d7646', okSoft: '#e1f2e8' }, dark: '#0e141b' },
  ruhig: { label: 'Ruhig', note: 'Petrol und warme Grautöne, wenig Farbe', preview: { header: '#ffffff', headerLine: '#dcdad4', logo: '#1f6f78', bg: '#f4f4f2', line: '#dcdad4', primary: '#1f6f78', text: '#1f2421', ok: '#2e6b3a', okSoft: '#e3f0e5' }, dark: '#121413' },
  kontrast: { label: 'Hoher Kontrast', note: 'Schwarz auf Weiß, kräftige Rahmen: für Sonne am Handy', preview: { header: '#ffffff', headerLine: '#000000', logo: '#000000', bg: '#ffffff', line: '#000000', primary: '#0047ab', text: '#000000', ok: '#00602b', okSoft: '#dcf2e3' }, dark: '#000000' },
}

export const MODES = { auto: 'Wie das Gerät', hell: 'Hell', dunkel: 'Dunkel' }
export const SCALES = { normal: 'Normal', gross: 'Groß' }

/** Alle wählbaren Farbschemata: Marke zuerst, dann die eingebauten. */
export function themeList(brand = {}) {
  const own = Object.entries(brand.themes || {}).map(([id, t]) => ({ id, ...t, brand: true }))
  if (brand.theme && !own.some((t) => t.id === brand.theme)) own.unshift({ id: brand.theme, label: brand.name || brand.theme, note: 'Hausfarben', brand: true })
  return [...own, ...Object.entries(BUILTIN_THEMES).map(([id, t]) => ({ id, ...t }))]
}

/** Gültige Auswahl: gespeichert, sonst Voreinstellung der Marke, sonst Standard. */
export function resolveTheme(prefs = {}, brand = {}) {
  const ids = themeList(brand).map((t) => t.id)
  const fallback = brand.theme && ids.includes(brand.theme) ? brand.theme : 'standard'
  return {
    skin: ids.includes(prefs.skin) ? prefs.skin : fallback,
    mode: MODES[prefs.mode] ? prefs.mode : 'auto',
    scale: SCALES[prefs.scale] ? prefs.scale : 'normal',
  }
}

const darkNow = (mode) => mode === 'dunkel' || (mode === 'auto' && globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches)

/** Auf die Seite anwenden (data-skin, data-theme, data-scale, Farbe der Statusleiste am Handy). */
export function applyTheme(prefs, brand, root = document.documentElement) {
  const t = resolveTheme(prefs, brand)
  root.dataset.skin = t.skin
  if (t.mode === 'auto') delete root.dataset.theme
  else root.dataset.theme = t.mode === 'dunkel' ? 'dark' : 'light'
  if (t.scale === 'normal') delete root.dataset.scale
  else root.dataset.scale = t.scale
  const theme = themeList(brand).find((x) => x.id === t.skin)
  const meta = document.querySelector('meta[name="theme-color"]') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'theme-color' }))
  meta.content = darkNow(t.mode) ? theme?.dark || '#0e141b' : theme?.preview?.header || '#ffffff'
  return t
}

// ---------------------------------------------------------------- Dialog

const current = () => resolveTheme(app.ui, app.config.brand)

function previewStyle(p = {}) {
  const v = { h: p.header, hl: p.headerLine, logo: p.logo, bg: p.bg, line: p.line, p: p.primary, t: p.text, ok: p.ok, 'ok-soft': p.okSoft }
  return Object.entries(v)
    .filter(([, x]) => x)
    .map(([k, x]) => `--tp-${k}: ${x}`)
    .join('; ')
}

function appearanceModal() {
  const t = current()
  const seg = (name, list, value) => `<div class="seg" role="radiogroup">${Object.entries(list).map(([k, label]) => `<button type="button" class="btn ${value === k ? 'primary' : ''}" role="radio" aria-checked="${value === k}" data-action="theme-${name}" data-v="${k}">${esc(label)}</button>`).join('')}</div>`
  return modalFrame({
    title: 'Darstellung',
    subtitle: 'Gilt für dieses Gerät',
    wide: true,
    body: `<section><h3>Farbschema</h3><div class="theme-grid">${themeList(app.config.brand)
      .map(
        (x) => `<button type="button" class="theme-card" data-action="theme-skin" data-v="${esc(x.id)}" aria-pressed="${t.skin === x.id}">
          <span class="theme-preview" style="${esc(previewStyle(x.preview))}" aria-hidden="true"><span class="tp-head"><span class="tp-logo"></span></span><span class="tp-body"><span class="tp-line"></span><span class="tp-pill"></span><span class="tp-line short"></span><span class="tp-btn"></span></span></span>
          <strong>${esc(x.label)}${t.skin === x.id ? ' <span class="theme-check">✓</span>' : ''}</strong><span class="muted">${esc(x.note || '')}</span></button>`,
      )
      .join('')}</div></section>
      <section><h3>Hell oder dunkel</h3>${seg('mode', MODES, t.mode)}</section>
      <section><h3>Schriftgröße</h3>${seg('scale', SCALES, t.scale)}</section>
      <p class="note">Die Voreinstellung für alle steht in config.json (brand.theme). Was hier gewählt ist, gilt nur auf diesem Gerät und bleibt gespeichert.</p>`,
    foot: '<button class="btn" data-action="theme-reset">Voreinstellung</button><div class="actions"><button class="btn primary" data-action="close-modal">Fertig</button></div>',
  })
}

registerModal('appearance', appearanceModal)

function set(key, value) {
  app.ui[key] = value
  applyTheme(app.ui, app.config.brand)
  app.savePrefs?.()
  renderNow()
  renderModal()
}

registerActions({
  'theme-open': () => openModal({ type: 'appearance' }),
  'theme-skin': (el) => set('skin', el.dataset.v),
  'theme-mode': (el) => set('mode', el.dataset.v),
  'theme-scale': (el) => set('scale', el.dataset.v),
  'theme-reset': () => {
    for (const k of ['skin', 'mode', 'scale']) delete app.ui[k]
    applyTheme(app.ui, app.config.brand)
    app.savePrefs?.()
    renderNow()
    closeModal()
  },
})

export const themeButton = () => `<button class="btn small icon" data-action="theme-open" aria-label="Darstellung" title="Darstellung: Farbschema, hell/dunkel, Schriftgröße">${ICON.palette}</button>`
