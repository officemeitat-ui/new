// Eigene, vereinfachte Zeichen für die neun Gefahrenpiktogramme (GHS01–GHS09): rote Raute auf Weiß mit einem
// schlichten schwarzen Symbol. Keine fremden Grafiken: für Bildschirm und PDF (pdfmake liest SVG). Die Kennung
// steht immer daneben bzw. im Titel, das Zeichen ersetzt das amtliche Piktogramm auf dem Gebinde nicht.

import { ghsOf } from '../core/arbeitsschutz.js'

const RED = '#c8102e'
const INK = '#111111'
const GLYPH = {
  // explodierende Bombe: Kugel mit Splittern
  GHS01: `<circle cx="20" cy="23" r="4.6" fill="${INK}"/><g stroke="${INK}" stroke-width="2" stroke-linecap="round"><path d="M20 15.5v-4M14.6 17.2l-2.6-2.6M25.4 17.2l2.6-2.6M13.2 23h-3.6M26.8 23h3.6M15 28.4l-2.4 2.2M25 28.4l2.4 2.2"/></g>`,
  // Flamme
  GHS02: `<path d="M20 10.5c2.6 4.4 6.6 6.4 6 12.2-.4 4-3.2 6.6-6 6.6s-5.6-2.6-6-6.4c-.4-4 2.6-5.8 3-9.4 1.6 1.6 2 3.6 2.4 5 1.2-2.2 1.6-5 .6-8z" fill="${INK}"/><path d="M13 30.5h14" stroke="${INK}" stroke-width="1.8"/>`,
  // Flamme über einem Kreis
  GHS03: `<circle cx="20" cy="25.5" r="4.6" fill="none" stroke="${INK}" stroke-width="2.2"/><path d="M20 10c2 3 4.2 4.4 3.8 8-.3 2.4-2 3.6-3.8 3.6s-3.5-1.2-3.8-3.4c-.3-2.6 1.6-3.8 2-6 .9 1 1.3 2.2 1.5 3.2.8-1.4 1-3.2.3-5.4z" fill="${INK}"/>`,
  // Gasflasche
  GHS04: `<g transform="rotate(-50 20 21)"><rect x="16.5" y="12" width="7" height="17" rx="3.5" fill="${INK}"/><rect x="18.5" y="9.5" width="3" height="3" fill="${INK}"/></g>`,
  // Ätzwirkung: Tropfen auf Fläche und Hand
  GHS05: `<g fill="${INK}"><path d="M13 11.5h3.4l1 6h-5.4z"/><path d="M23.6 11.5H27l-.4 6h-5.4z"/><circle cx="14.8" cy="20.6" r="1.4"/><circle cx="24.8" cy="20.6" r="1.4"/><path d="M10.5 27.5h9v2.4h-9zM21.5 26.5h7.8l1.2 1.8-1.2 1.6h-7.8z"/></g>`,
  // Totenkopf mit gekreuzten Knochen
  GHS06: `<circle cx="20" cy="17" r="5.4" fill="${INK}"/><rect x="17.4" y="20.5" width="5.2" height="3.4" rx="1" fill="${INK}"/><circle cx="18" cy="16.5" r="1.4" fill="#fff"/><circle cx="22" cy="16.5" r="1.4" fill="#fff"/><path d="M12.5 25.5l15 5.5M27.5 25.5l-15 5.5" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`,
  // Ausrufezeichen
  GHS07: `<rect x="18.4" y="10.5" width="3.2" height="12.5" rx="1.6" fill="${INK}"/><circle cx="20" cy="27.3" r="2" fill="${INK}"/>`,
  // Gesundheitsgefahr: Oberkörper mit Stern
  GHS08: `<circle cx="20" cy="12.4" r="2.8" fill="${INK}"/><path d="M12.5 30.5c0-7.4 3.2-14.5 7.5-14.5s7.5 7.1 7.5 14.5z" fill="${INK}"/><path d="M20 19.5l1.2 2.6 2.8.3-2.1 1.9.6 2.8-2.5-1.4-2.5 1.4.6-2.8-2.1-1.9 2.8-.3z" fill="#fff"/>`,
  // Umwelt: Baum und Fisch
  GHS09: `<path d="M14 11l-4.5 9h3l-3.5 6h10l-3.5-6h3z" fill="${INK}"/><rect x="13.2" y="26" width="1.6" height="4" fill="${INK}"/><path d="M20.5 27c2-2.4 4.6-3 7-1.6l2-1.6v5.4l-2-1.6c-2.4 1.4-5 .8-7-.6z" fill="${INK}"/>`,
}

/** SVG eines Piktogramms (size in Pixel, nur für den Bildschirm; im PDF steuert width die Größe). */
export function ghsSvg(id, size = 32) {
  const g = ghsOf(id)
  if (!g) return ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${size}" height="${size}" role="img" aria-label="${id} ${g.name}"><title>${id}: ${g.name} (${g.short})</title><path d="M20 1.8 38.2 20 20 38.2 1.8 20z" fill="#fff" stroke="${RED}" stroke-width="3.2" stroke-linejoin="round"/>${GLYPH[id]}</svg>`
}
