// Cleo, das Maskottchen der Cleanos App: ein Wassertropfen mit grünem Stirnband (Cleanos-Grün),
// gezeichnet als flacher Sticker mit kräftiger Kontur. Reines SVG ohne ids (mehrfach auf einer
// Seite möglich), Farben aus dem Corporate Design. Stimmungen:
//   hallo (winkt), froh (lacht), denkt (Hand am Kinn, Fragezeichen), zeigt (Arm nach rechts),
//   schnee (Mütze und Flocke), schlaeft (zu, „z“), hoppla (Schweißtropfen), fertig (Daumen hoch)
// Animation (Blinzeln, Winken, leichtes Schweben) nur per CSS-Klasse und nie bei „Bewegung reduzieren“.

const INK = '#0e2433' // Nachtblau: Kontur
const BLUE = '#0c6cb4' // Cleanos-Blau
const LIGHT = '#5aa6e0'
const GREEN = '#9cc654'
const CHEEK = '#f29a9a'

export const MOODS = ['hallo', 'froh', 'denkt', 'zeigt', 'schnee', 'schlaeft', 'hoppla', 'fertig']

const st = (w = 4) => `stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`
const stroke = st()

function eyes(mood) {
  if (mood === 'froh' || mood === 'fertig') return `<path d="M44 78q6-7 12 0M70 78q6-7 12 0" fill="none" ${stroke}/>`
  if (mood === 'schlaeft') return `<path d="M44 80q6 4 12 0M70 80q6 4 12 0" fill="none" ${stroke}/>`
  const look = mood === 'denkt' ? -3 : mood === 'zeigt' ? 2 : 0
  const pupil = (cx) => `<circle cx="${cx + (mood === 'zeigt' ? 2 : 0)}" cy="${79 + look}" r="4.2" fill="${INK}"/><circle cx="${cx + 1.6}" cy="${77 + look}" r="1.4" fill="#fff"/>`
  return `<g class="cleo-eyes"><ellipse cx="50" cy="78" rx="8.5" ry="10" fill="#fff" ${st(3.5)}/><ellipse cx="76" cy="78" rx="8.5" ry="10" fill="#fff" ${st(3.5)}/>${pupil(50)}${pupil(76)}</g>`
}

function mouth(mood) {
  if (mood === 'denkt') return `<path d="M101 100q-4 8-22 8" fill="none" ${st(7)}/><path d="M101 100q-4 8-22 8" fill="none" stroke="${BLUE}" stroke-width="3.2" stroke-linecap="round"/><circle cx="77" cy="107" r="6" fill="${BLUE}" ${st(3.5)}/>`
  if (mood === 'hoppla') return `<path d="M56 100q7-5 14 0" fill="none" ${stroke}/>`
  if (mood === 'denkt') return `<path d="M57 100h12" fill="none" ${stroke}/>`
  if (mood === 'schlaeft') return `<ellipse cx="63" cy="100" rx="4" ry="3" fill="${INK}"/>`
  if (mood === 'froh' || mood === 'fertig' || mood === 'hallo') return `<path d="M52 96q11 13 22 0z" fill="${INK}" ${st(3)}/><path d="M57 101q6 4 12 0" fill="none" stroke="${CHEEK}" stroke-width="3" stroke-linecap="round"/>`
  return `<path d="M53 97q10 9 20 0" fill="none" ${stroke}/>`
}

function arms(mood) {
  const arm = (d, cls = '') => `<path class="${cls}" d="${d}" fill="none" ${st(7)}/><path class="${cls}" d="${d}" fill="none" stroke="${BLUE}" stroke-width="3.2" stroke-linecap="round"/>`
  const left = arm('M26 100q-10 4-12 14')
  switch (mood) {
    case 'hallo':
      return left + `<g class="cleo-wave">${arm('M100 96q12-6 16-22')}<circle cx="117" cy="70" r="6.5" fill="${BLUE}" ${st(3.5)}/></g>`
    case 'zeigt':
      return left + `${arm('M100 98q10-2 20-6')}<circle cx="122" cy="91" r="6" fill="${BLUE}" ${st(3.5)}/>`
    case 'denkt':
      return left + `<path d="M110 30q0-9 8-9t8 8q0 6-7 8v5" fill="none" ${st(4)}/><circle cx="119" cy="52" r="2.6" fill="${INK}"/>` // Hand am Kinn: in extras (vor dem Körper)
    case 'fertig':
      return left + `${arm('M100 100q10 0 14-12')}<rect x="108" y="74" width="14" height="14" rx="5" fill="${BLUE}" ${st(3.5)}/><path d="M114 74v-8" ${st(5)}/>`
    default:
      return left + arm('M100 100q10 4 12 14')
  }
}

function extras(mood) {
  if (mood === 'schnee')
    return `<path d="M30 54q33-26 66 0" fill="#fff" ${st(3.5)}/><path d="M33 52q30-6 60 0" fill="none" stroke="${GREEN}" stroke-width="6" stroke-linecap="round"/><circle cx="63" cy="22" r="7" fill="#fff" ${st(3.5)}/><g ${st(2.6)}><path d="M112 40v18M103 49h18M106 43l12 12M118 43l-12 12"/></g>`
  if (mood === 'schlaeft') return `<g fill="none" ${st(3.2)}><path d="M100 30h10l-10 12h10"/><path d="M114 14h7l-7 8h7"/></g>`
  if (mood === 'hoppla') return `<path d="M30 40q6 8 0 12q-6-4 0-12z" fill="${LIGHT}" ${st(2.8)}/>`
  return ''
}

/**
 * Cleo als SVG. size: Breite in px (Höhe passend). anim: Blinzeln/Winken/Schweben per CSS.
 * label: Beschriftung für Vorleseprogramme (sonst nur Schmuck).
 */
export function cleo({ mood = 'hallo', size = 96, anim = true, label = '' } = {}) {
  const m = MOODS.includes(mood) ? mood : 'hallo'
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"'
  const band = m === 'schnee' ? '' : `<path d="M31 56q32-14 64 0" fill="none" ${st(12)}/><path d="M31 56q32-14 64 0" fill="none" stroke="${GREEN}" stroke-width="6.5" stroke-linecap="round"/><path d="M93 54l12-6M93 56l11 6" ${st(4)}/>`
  return `<svg class="cleo cleo-${m}${anim ? ' cleo-anim' : ''}" viewBox="0 0 130 140" width="${size}" height="${Math.round((size * 140) / 130)}" ${a11y}>
    <ellipse cx="63" cy="134" rx="30" ry="4.5" fill="${INK}" opacity="0.12"/>
    <g class="cleo-body">
      ${arms(m)}
      <path d="M63 8C63 8 24 56 24 88a39 39 0 0 0 78 0C102 56 63 8 63 8z" fill="${BLUE}" ${stroke}/>
      <path d="M44 42q-10 16-12 34" fill="none" stroke="${LIGHT}" stroke-width="5" stroke-linecap="round"/>
      ${band}
      ${eyes(m)}
      <circle cx="38" cy="92" r="5" fill="${CHEEK}" opacity="0.85"/><circle cx="88" cy="92" r="5" fill="${CHEEK}" opacity="0.85"/>
      ${mouth(m)}
      ${extras(m)}
    </g>
  </svg>`
}

/** Kleines Gesicht für Knöpfe (nur Tropfen mit Augen), 1em groß. */
export function cleoIcon() {
  return `<svg class="cleo-icon" viewBox="0 0 64 70" aria-hidden="true"><path d="M32 4C32 4 8 32 8 48a24 24 0 0 0 48 0C56 32 32 4 32 4z" fill="${BLUE}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M14 30q18-8 36 0" fill="none" stroke="${GREEN}" stroke-width="5" stroke-linecap="round"/><circle cx="24" cy="44" r="4.5" fill="#fff"/><circle cx="40" cy="44" r="4.5" fill="#fff"/><circle cx="24.6" cy="44.6" r="2.2" fill="${INK}"/><circle cx="40.6" cy="44.6" r="2.2" fill="${INK}"/><path d="M25 54q7 6 14 0" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>`
}

/** Stimmung zur Tageszeit und Lage (Übersicht). */
export function moodFor({ hour = new Date().getHours(), snow = false, open = 0 } = {}) {
  if (snow) return 'schnee'
  if (hour < 6 || hour >= 22) return 'schlaeft'
  if (!open) return 'fertig'
  return 'hallo'
}
