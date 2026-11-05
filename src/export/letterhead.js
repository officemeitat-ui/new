// Briefpapier für alle PDFs der Fakturierung (Rechnungen, Angebote, Mahnungen, Briefe, weitere Belegarten):
// eigenes Bild als Hintergrund (erste Seite und Folgeseiten), Ränder, damit der Text nicht in Kopf und Fuß des
// Briefpapiers läuft, Logo, Absender und Fußzeile der App wahlweise aus, eigene Fußzeile (bis 4 Spalten),
// Akzentfarbe und Schrift. Wie der Briefpapier-Designer in orgaMAX, nur einfacher.
//
// Reine Funktionen ohne Browser. Ein PDF-Baustein ruft pageSetup(settings) auf und nimmt daraus Seitenränder,
// Hintergrund, Kopfzeile, Fußzeile und Schrift (export/invoice-pdf.js → shell). Die Bilder lädt die Oberfläche
// (ui/views/invoicing-briefpapier.js → loadLetterhead) und legt sie mit setLetterheadImages() bereit; wer ein PDF
// der Fakturierung erzeugt, wartet vorher auf loadLetterhead().
//
// pdfmake kann kein PDF als Hintergrund einbetten (nur PNG, JPEG und SVG). Das Briefpapier kommt deshalb als Bild:
// A4 hoch, am besten 150 bis 200 dpi (1240 × 1754 bis 1654 × 2339 Pixel), z. B. aus der PDF-Vorlage exportiert.
//
// Einstellungen: fakturierung.json → settings.letterhead (alle Felder optional, ohne sie bleibt alles wie bisher)
//   first, next      { path, name, type, width, height, size, at }: Bild der ersten Seite bzw. der Folgeseiten
//                    (SharePoint: fakturierung/briefpapier/…, im Browser-Modus nur in diesem Browser)
//   nextMode         'same' Folgeseiten wie die erste (Standard) | 'own' eigenes Bild | 'none' ohne Briefpapier
//   margins          { top, topNext, bottom, left, right } in mm (top: erste Seite, topNext: Folgeseiten)
//   hideLogo, hideSender, hideReturnLine, hideFooter   Teile der App weglassen, wenn das Briefpapier sie schon hat
//   footer           bis 4 Spalten Text (mehrzeilig) statt der Fußzeile der App; leer: Fußzeile der App
//   pageNumbers      „Seite 1 von 2“ (Standard: ja)
//   accent           Akzentfarbe für Titel, Tabellenkopf und Linien (#rrggbb; leer: Hausfarbe)
//   font, fontSize   Schrift (nur in pdfmake eingebettete, LETTERHEAD_FONTS) und Grundgröße in pt

import { mix, parseColor, readableOn } from '../core/color.js'

/** Punkte je Millimeter (pdfmake rechnet in pt, 1 pt = 1/72 Zoll). */
export const MM = 72 / 25.4
export const A4 = { width: 595.28, height: 841.89, widthMm: 210, heightMm: 297 }
const round1 = (n) => Math.round(n * 10) / 10

/** Bisherige Ränder der Belege in pt (ohne Briefpapier bleibt das PDF gleich). */
export const DEFAULT_MARGINS_PT = { left: 40, top: 36, topNext: 36, right: 40, bottom: 54 }
/** Dieselben Ränder in mm (gerundet) für das Formular. */
export const DEFAULT_MARGINS_MM = Object.fromEntries(Object.entries(DEFAULT_MARGINS_PT).map(([k, v]) => [k, round1(v / MM)]))
const MARGIN_LIMITS = { top: [5, 150], topNext: [5, 150], bottom: [5, 120], left: [5, 60], right: [5, 60] }

/** Schriften, die pdfmake mitbringt (vendor/vfs_fonts.js). Roboto hat alle Sonderzeichen wie č, ć, ş, ğ. */
export const LETTERHEAD_FONTS = { Roboto: 'Roboto (in pdfmake eingebettet)' }
export const FONT_SIZES = [8.5, 9, 9.5, 10, 10.5, 11]
export const NEXT_MODES = { same: 'wie die erste Seite', own: 'eigenes Bild', none: 'ohne Briefpapier' }
export const FOOTER_COLUMNS = 4

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(String(v).replace(',', '.')))
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v))
const lines = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)

/** Einstellungen des Briefpapiers mit Standardwerten (Ränder in mm, nur gültige Werte). */
export function letterheadOf(settings = {}) {
  const raw = settings?.letterhead || {}
  const margins = {}
  for (const [k, lim] of Object.entries(MARGIN_LIMITS)) {
    const v = num(raw.margins?.[k])
    margins[k] = Number.isFinite(v) ? clamp(v, lim) : DEFAULT_MARGINS_MM[k]
  }
  // ohne eigenen Wert für die Folgeseiten gilt der obere Rand der ersten Seite
  if (!Number.isFinite(num(raw.margins?.topNext)) && Number.isFinite(num(raw.margins?.top))) margins.topNext = margins.top
  const image = (x) => (x && x.path ? x : null)
  const footer = Array.from({ length: FOOTER_COLUMNS }, (_, i) => String(raw.footer?.[i] ?? '').trim())
  const size = Number(raw.fontSize)
  return {
    first: image(raw.first),
    next: image(raw.next),
    nextMode: ['same', 'own', 'none'].includes(raw.nextMode) ? raw.nextMode : 'same',
    margins,
    custom: !!raw.margins && Object.values(raw.margins).some((v) => Number.isFinite(num(v))),
    hideLogo: !!raw.hideLogo,
    hideSender: !!raw.hideSender,
    hideReturnLine: !!raw.hideReturnLine,
    hideFooter: !!raw.hideFooter,
    footer,
    pageNumbers: raw.pageNumbers !== false,
    accent: parseColor(raw.accent || '') ? String(raw.accent) : '',
    font: raw.font in LETTERHEAD_FONTS ? raw.font : 'Roboto',
    fontSize: FONT_SIZES.includes(size) ? size : 9,
  }
}

/** Ist überhaupt etwas eingestellt (Bild, Ränder, Ausblenden, Fußzeile, Farbe, Schrift)? */
export const letterheadActive = (settings) => {
  const lh = letterheadOf(settings)
  return !!(lh.first || lh.custom || lh.hideLogo || lh.hideSender || lh.hideReturnLine || lh.hideFooter || lh.footer.some(Boolean) || !lh.pageNumbers || lh.accent || lh.fontSize !== 9)
}

/** Erkennung der geladenen Bilder: passt der Zwischenspeicher noch zu den Einstellungen? */
export const letterheadKey = (lh) => [lh.first?.path, lh.first?.at, lh.nextMode === 'own' ? lh.next?.path : '', lh.nextMode === 'own' ? lh.next?.at : ''].map((x) => x || '').join('|')

/**
 * Seitenränder in pt: pageMargins für pdfmake und der Abstand, der nur auf der ersten Seite über dem Text
 * dazukommt (pdfmake kennt nur einen Rand für alle Seiten). Ist der obere Rand der ersten Seite kleiner als der
 * der Folgeseiten, gilt auch auf der ersten Seite der größere (der Text läuft nie in den Kopf).
 */
export function marginsPt(lh) {
  const m = lh.margins
  const custom = lh.custom
  const pt = (k) => (custom ? m[k] * MM : DEFAULT_MARGINS_PT[k])
  const top = Math.max(pt('top'), pt('topNext'))
  const next = pt('topNext')
  return { pageMargins: [pt('left'), next, pt('right'), pt('bottom')], firstExtra: Math.max(0, top - next), firstTop: top }
}

/** Höhe einer Zeile in der Fußzeile (7 pt, Roboto, Zeilenhöhe 1,15) in pt. */
const FOOT_LINE = 7 * 1.172 * 1.15
/** Wie viel Platz (mm) braucht die Fußzeile? (unterer Rand muss mindestens so groß sein) */
export function footerNeedMm(lh) {
  if (lh.hideFooter) return lh.pageNumbers ? round1((10 + FOOT_LINE + 2) / MM) : 0
  const n = lh.footer.some(Boolean) ? Math.max(1, ...lh.footer.map((t) => lines(t).length)) : 2
  return round1((10 + n * FOOT_LINE + 2) / MM)
}

/** Hinweise zu den Rändern (leer: alles passt). */
export function marginProblems(lh) {
  const m = lh.margins
  const out = []
  if (A4.widthMm - m.left - m.right < 100) out.push(`Zwischen den Rändern links und rechts bleiben nur ${round1(A4.widthMm - m.left - m.right)} mm für den Text (mindestens 100 mm).`)
  if (A4.heightMm - Math.max(m.top, m.topNext) - m.bottom < 120) out.push(`Zwischen oben und unten bleiben nur ${round1(A4.heightMm - Math.max(m.top, m.topNext) - m.bottom)} mm für den Text (mindestens 120 mm).`)
  const need = footerNeedMm(lh)
  if (lh.custom && need > m.bottom) out.push(`Die Fußzeile braucht unten ${String(need).replace('.', ',')} mm, der Rand ist ${String(m.bottom).replace('.', ',')} mm: Rand vergrößern oder Fußzeile kürzen.`)
  if (lh.custom && m.top < m.topNext) out.push('Oben auf der ersten Seite ist weniger Rand als auf den Folgeseiten: es gilt auf allen Seiten der größere Wert.')
  return out
}

/** Bild für das Briefpapier prüfen: { error } (nicht verwendbar) oder { warnings: [] }. */
export function checkLetterheadImage({ type = '', name = '', width = 0, height = 0 } = {}) {
  const t = String(type).toLowerCase()
  if (t === 'application/pdf' || /\.pdf$/i.test(name)) return { error: 'pdf', warnings: [] }
  if (!/^image\/(png|jpe?g)$/.test(t) && !/\.(png|jpe?g)$/i.test(name)) return { error: 'type', warnings: [] }
  const warnings = []
  if (!(width > 0 && height > 0)) return { error: 'size', warnings }
  const ratio = height / width
  if (ratio < 1) warnings.push('Das Bild ist im Querformat. Das Briefpapier muss A4 hoch sein (210 × 297 mm).')
  else if (Math.abs(ratio / (A4.heightMm / A4.widthMm) - 1) > 0.03) warnings.push(`Das Bild hat nicht das Seitenverhältnis von A4 (${width} × ${height} Pixel); es wird auf A4 gestreckt.`)
  const dpi = Math.round(width / (A4.widthMm / 25.4))
  if (dpi < 120) warnings.push(`Das Bild hat nur etwa ${dpi} dpi (${width} Pixel breit) und wirkt im Druck unscharf. Besser 150 bis 200 dpi (1240 bis 1654 Pixel breit).`)
  return { warnings }
}

/** Ablage des Bildes: fakturierung/briefpapier/erste-seite.jpg bzw. folgeseiten.png */
export const letterheadPath = (which, type) => `fakturierung/briefpapier/${which === 'next' ? 'folgeseiten' : 'erste-seite'}.${/png/i.test(type) ? 'png' : 'jpg'}`

/** Vorschlag für die Fußzeile aus den Firmendaten: Anschrift, Kontakt, Bank, Firmenbuch und UID. */
export function suggestFooter(sender = {}, bank = {}) {
  const iban = String(bank.iban || '').replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim()
  return [
    [sender.name, ...lines(sender.address)].filter(Boolean).join('\n'),
    [sender.phone ? `Tel. ${sender.phone}` : '', sender.email, sender.web].filter(Boolean).join('\n'),
    [bank.name, iban ? `IBAN ${iban}` : '', bank.bic ? `BIC ${bank.bic}` : ''].filter(Boolean).join('\n'),
    [sender.register, sender.uid ? `UID ${sender.uid}` : '', sender.taxNo ? `St.-Nr. ${sender.taxNo}` : ''].filter(Boolean).join('\n'),
  ]
}

/** Farben mit der Akzentfarbe (lesbar auf Weiß und auf dem hellen Tabellenkopf, Kontrast ≥ 4,5:1). */
export function accentColors(colors, accent) {
  if (!parseColor(accent || '')) return colors
  const soft = mix('#ffffff', accent, 0.1)
  return { ...colors, ink: readableOn(readableOn(accent, '#ffffff', 4.5), soft, 4.5), soft, line: mix('#ffffff', accent, 0.45) }
}

// ---------------------------------------------------------------- geladene Bilder (von der Oberfläche)

let loaded = { key: '', first: null, next: null }
/** Bilder bereitlegen: { key: letterheadKey(lh), first: dataUrl, next: dataUrl }. */
export const setLetterheadImages = (images) => void (loaded = { key: '', first: null, next: null, ...(images || {}) })
export const letterheadImages = () => loaded

// ---------------------------------------------------------------- Seite einrichten

/**
 * Seite für ein PDF der Fakturierung: Ränder, Hintergrund, Kopf, Fußzeile, Farben und Schrift aus den Einstellungen.
 * images: { key, first, next } (data-URLs; Standard: von setLetterheadImages), colors: Farben aus inkColors(brand).
 * Liefert {
 *   lh, colors, pageMargins, images (für pdfmake), background(page) | null, defaultStyle(base),
 *   head(logoNode, senderNode) → Kopfzeile oder '' (beides ausgeblendet), returnLine (Absenderzeile zeigen?),
 *   wrap(content) → Inhalt mit Abstand oben auf der ersten Seite, footer(appFooter) → Fußzeile für pdfmake,
 *   pageOf(page) → { page, pages } je Brief (Sammel-PDF: starts = erste Seite jedes Briefs) }
 */
export function pageSetup(settings = {}, { images = letterheadImages(), colors = {}, starts = null } = {}) {
  const lh = letterheadOf(settings)
  const { pageMargins, firstExtra } = marginsPt(lh)
  const [left, , right] = pageMargins
  const match = images && images.key === letterheadKey(lh)
  const firstImg = lh.first && match ? images.first || null : null
  const nextImg = lh.nextMode === 'none' ? null : lh.nextMode === 'own' ? (lh.next && match ? images.next || null : null) : firstImg
  const pdfImages = { ...(firstImg ? { briefpapier1: firstImg } : {}), ...(nextImg && nextImg !== firstImg ? { briefpapier2: nextImg } : {}) }
  const ink = accentColors(colors, lh.accent)
  // Sammel-PDF: Seiten je Brief (starts: Seite 1 jedes Briefs, aufsteigend; total: Seiten insgesamt)
  const pageOf = (page, total) => {
    if (!starts?.length) return { page, pages: total, first: page === 1 }
    let i = starts.length - 1
    while (i > 0 && starts[i] > page) i--
    const end = (starts[i + 1] || total + 1) - 1
    return { page: page - starts[i] + 1, pages: end - starts[i] + 1, first: page === starts[i] }
  }
  const bgNode = (name) => ({ image: name, width: A4.width, height: A4.height, absolutePosition: { x: 0, y: 0 } })
  const background =
    firstImg || nextImg
      ? (page) => {
          const first = pageOf(page, Infinity).first
          const name = first ? (firstImg ? 'briefpapier1' : null) : nextImg ? (nextImg === firstImg ? 'briefpapier1' : 'briefpapier2') : null
          return name ? bgNode(name) : null
        }
      : null
  const footText = (text) => ({ text, fontSize: 7, color: ink.grey })
  const pageText = (p) => ({ text: `Seite ${p.page} von ${p.pages}`, alignment: 'right', fontSize: 7, color: ink.grey, width: 70 })
  const footer = (appFooter) => (page, pages) => {
    const p = pageOf(page, pages)
    if (lh.hideFooter) return lh.pageNumbers ? { margin: [left, 10, right, 0], columns: [{ text: '' }, pageText(p)] } : null
    if (lh.footer.some(Boolean)) {
      const cols = lh.footer.filter(Boolean).map((t) => ({ width: '*', ...footText(t) }))
      return { margin: [left, 10, right, 0], columnGap: 10, columns: [...cols, ...(lh.pageNumbers ? [pageText(p)] : [])] }
    }
    const node = appFooter ? appFooter(p.page, p.pages) : null
    if (!node) return null
    // Fußzeile der App mit den eingestellten Rändern; Seitenzahl je nach Einstellung
    const columns = (node.columns || []).filter((c, i, all) => lh.pageNumbers || i < all.length - 1)
    return { ...node, margin: [left, 10, right, 0], ...(node.columns ? { columns } : {}) }
  }
  const spacer = firstExtra > 0.5 ? { canvas: [], margin: [0, firstExtra, 0, 0] } : null
  return {
    lh,
    colors: ink,
    pageMargins,
    images: pdfImages,
    background,
    returnLine: !lh.hideReturnLine,
    defaultStyle: (base = {}) => ({ ...base, font: lh.font, fontSize: lh.fontSize }),
    head(logoNode, senderNode) {
      const cols = [lh.hideLogo ? { text: '' } : logoNode, lh.hideSender ? { text: '' } : senderNode]
      return lh.hideLogo && lh.hideSender ? '' : { columns: cols }
    },
    /** Inhalt eines Briefs: auf der ersten Seite zusätzlicher Abstand oben (Kopf des Briefpapiers). */
    wrap(content, { pageBreak = false } = {}) {
      const list = content.filter(Boolean)
      const top = spacer ? { ...spacer } : { canvas: [], margin: [0, 0, 0, 0] }
      if (!spacer && !pageBreak) return list
      return [{ ...top, ...(pageBreak ? { pageBreak: 'before' } : {}) }, ...list]
    },
    footer,
    pageOf,
  }
}
