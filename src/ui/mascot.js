// Cleo, der Sauberheld der Cleanos App: ein Wassertropfen als Superheld – Heldenmaske, Umhang in
// Cleanos-Grün, Wappen mit „C“, Gürtel mit goldener Schnalle, kleine Stiefel und als Heldenwaffe
// ein Fensterabzieher (im Winter die Schneeschaufel). Flacher Sticker mit kräftiger Kontur,
// reines SVG ohne ids (mehrfach auf einer Seite möglich), Farben aus dem Corporate Design.
// Stimmungen:
//   hallo (Heldenpose, Abzieher hoch), fliegt (im Flug, Faust voraus), froh (Siegerfaust, zwinkert),
//   denkt (Hand am Kinn, Braue hoch), zeigt (zeigt nach rechts), schnee (Schal, Schaufel, Schnee am Kopf),
//   schlaeft (Maske auf der Stirn, „z“), hoppla (Schweißtropfen, verlegen), fertig (= froh)
// Animation (Blinzeln, Umhang weht, Schweben) per CSS-Klasse; aus bei „Bewegung reduzieren“.

const INK = '#0e2433' // Nachtblau: Kontur, Maske, Stiefel
const BLUE = '#0c6cb4' // Cleanos-Blau: Körper
const SHINE = '#5aa6e0'
const GREEN = '#9cc654' // Umhang
const GREEN_DARK = '#6f9a2e'
const GOLD = '#f5c542'
const CHEEK = '#f29a9a'
const METAL = '#c9d6df'

export const MOODS = ['hallo', 'fliegt', 'froh', 'denkt', 'zeigt', 'schnee', 'schlaeft', 'hoppla', 'fertig']

const st = (w = 4) => `stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`
const BODY = 'M80 18C80 18 38 68 38 106a42 42 0 0 0 84 0C122 68 80 18 80 18z'

/** Arm als dicke Linie mit Kontur, Faust am Ende. */
const arm = (d, fist) => `<path d="${d}" fill="none" ${st(9)}/><path d="${d}" fill="none" stroke="${BLUE}" stroke-width="4.5" stroke-linecap="round"/>${fist ? `<circle cx="${fist[0]}" cy="${fist[1]}" r="7" fill="${BLUE}" ${st(3.5)}/>` : ''}`

function cape(mood) {
  if (mood === 'fliegt')
    return `<g class="cleo-cape"><path d="M50 80Q20 84 4 104Q18 104 22 110Q8 120 2 134Q22 128 32 132Q36 116 56 104z" fill="${GREEN}" ${st(3.5)}/><path d="M40 92Q26 104 22 110" fill="none" stroke="${GREEN_DARK}" stroke-width="3" stroke-linecap="round"/></g>`
  return `<g class="cleo-cape"><path d="M48 80Q28 116 30 156Q46 148 58 158Q72 148 82 160Q96 148 108 158Q120 148 134 154Q136 116 112 80z" fill="${GREEN}" ${st(3.5)}/><path d="M50 98Q40 124 42 150M110 98Q122 124 124 148" fill="none" stroke="${GREEN_DARK}" stroke-width="3" stroke-linecap="round"/></g>`
}

/** Heldenmaske mit Augen (oder geschlossenen Augen), Bänder wehen nach rechts. */
function face(mood) {
  const tails = `<g class="cleo-tails"><path d="M117 66q14-8 24-4q-8 4-10 10z" fill="${INK}"/><path d="M117 74q14 2 22 10q-9-1-14 4z" fill="${INK}"/></g>`
  const mask = (y = 0) => `<path transform="translate(0 ${y})" d="M40 70Q42 56 62 58Q73 59 80 65Q87 59 98 58Q118 56 120 70Q120 86 100 86Q87 86 80 77Q73 86 60 86Q40 86 40 70z" fill="${INK}"/>`
  if (mood === 'schlaeft') return `${mask(-22)}${tails.replace('class="cleo-tails"', 'class="cleo-tails" transform="translate(0 -22)"')}<path d="M52 74q9 5 18 0M90 74q9 5 18 0" fill="none" ${st(3.5)}/>`
  const happy = mood === 'froh' || mood === 'fertig'
  const look = mood === 'denkt' ? [-2, -3] : mood === 'zeigt' || mood === 'fliegt' ? [3, 0] : [0, 0]
  const eye = (cx, wink = false) =>
    wink
      ? `<path d="M${cx - 8} 73q8-7 16 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`
      : `<ellipse cx="${cx}" cy="72" rx="9" ry="8.5" fill="#fff"/><circle cx="${cx + look[0]}" cy="${73 + look[1]}" r="4.4" fill="${INK}"/><circle cx="${cx + look[0] + 1.6}" cy="${71 + look[1]}" r="1.5" fill="#fff"/>`
  const brows =
    mood === 'hoppla'
      ? `<path d="M52 52q9-4 16 2M92 54q7-6 16-2" fill="none" ${st(4)}/>`
      : mood === 'denkt'
        ? `<path d="M52 54q9-3 17 0M90 47q10-7 19 0" fill="none" ${st(4)}/>`
        : `<path d="M51 53q10-6 19 0M90 49q10-8 20-1" fill="none" ${st(4)}/>`
  return `<g class="cleo-eyes">${mask()}${eye(62, false)}${eye(98, happy)}</g>${tails}${brows}`
}

function mouth(mood) {
  if (mood === 'hoppla') return `<path d="M64 98q8-4 16 0q8 4 16 0" fill="none" ${st(3.5)}/>`
  if (mood === 'denkt') return `<path d="M66 99q8 3 16 -1" fill="none" ${st(3.5)}/>`
  if (mood === 'schlaeft') return `<ellipse cx="80" cy="99" rx="4.5" ry="3.5" fill="${INK}"/>`
  // breites Heldengrinsen mit Zähnen
  return `<path d="M61 92q19 22 38 0z" fill="${INK}" ${st(3)}/><path d="M64 94h32q-2 4-4 5h-24q-2-1-4-5z" fill="#fff"/><path d="M71 105q9 4 18 0" fill="none" stroke="${CHEEK}" stroke-width="3.2" stroke-linecap="round"/>`
}

function body(mood) {
  const emblem = `<path d="M69 110h22v7q0 9-11 14q-11-5-11-14z" fill="#fff" ${st(3)}/><path d="M85 116.5a5.5 5.5 0 1 0 0 7" fill="none" stroke="${BLUE}" stroke-width="3.2" stroke-linecap="round"/>`
  const belt = `<path d="M54 138q26 9 52 0" fill="none" ${st(8)}/><rect x="74" y="135" width="12" height="10" rx="2.5" fill="${GOLD}" ${st(2.5)}/>`
  const boots = `<path d="M54 146q0-8 10-8q10 0 10 8v6q-10 3-20 0z" fill="${INK}"/><path d="M86 146q0-8 10-8q10 0 10 8v6q-10 3-20 0z" fill="${INK}"/>`
  const scarf = mood === 'schnee' ? `<path d="M46 86q34 14 68 0" fill="none" ${st(13)}/><path d="M46 86q34 14 68 0" fill="none" stroke="#e05a5a" stroke-width="8" stroke-linecap="round"/><path d="M104 92l6 22" ${st(9)}/><path d="M104 92l6 22" stroke="#e05a5a" stroke-width="5" stroke-linecap="round"/>` : ''
  return `${boots}<path d="${BODY}" fill="${BLUE}" ${st(4.5)}/><path d="M60 44q-12 18-14 40" fill="none" stroke="${SHINE}" stroke-width="5" stroke-linecap="round"/>${belt}${emblem}${scarf}
    <circle cx="46" cy="90" r="5.5" fill="${CHEEK}" opacity="0.85"/><circle cx="114" cy="90" r="5.5" fill="${CHEEK}" opacity="0.85"/>
    <circle cx="50" cy="82" r="4" fill="${GOLD}" ${st(2.5)}/><circle cx="110" cy="82" r="4" fill="${GOLD}" ${st(2.5)}/>`
}

/** Abzieher (Fenster) oder Schneeschaufel, Griff unten bei (x, y). */
function gadget(x, y, snow = false) {
  if (snow)
    return `<g class="cleo-gadget"><path d="M${x} ${y}l2-30" ${st(6)}/><path d="M${x} ${y}l2-30" stroke="#a0703c" stroke-width="2.5" stroke-linecap="round"/><path d="M${x - 12} ${y - 30}h28l-3 14h-22z" fill="${METAL}" ${st(3)}/></g>`
  return `<g class="cleo-gadget"><path d="M${x} ${y}l1-26" ${st(6)}/><path d="M${x} ${y}l1-26" stroke="${METAL}" stroke-width="2.5" stroke-linecap="round"/><rect x="${x - 15}" y="${y - 33}" width="32" height="7" rx="2" fill="${METAL}" ${st(3)}/><rect x="${x - 15}" y="${y - 27}" width="32" height="4" rx="1.5" fill="${INK}"/><path d="M${x - 22} ${y - 40}l-5-5M${x + 1} ${y - 44}v-7M${x + 24} ${y - 40}l5-5" ${st(3)}/></g>`
}

function arms(mood) {
  const hipL = arm('M42 100Q22 104 30 124', [32, 125])
  const hipR = arm('M118 100Q138 104 130 124', [128, 125])
  switch (mood) {
    case 'hallo':
      return hipL + `<g class="cleo-wave">${arm('M118 98Q134 84 138 66', [138, 62])}${gadget(139, 58)}</g>`
    case 'fliegt':
      return arm('M118 94Q136 82 150 70', [152, 68]) + arm('M44 104Q30 112 22 124', [21, 125])
    case 'froh':
    case 'fertig':
      // Siegerfaust hoch, mit Glanz („Auftrag erledigt!“)
      return hipL + arm('M118 98Q138 88 136 66', [136, 61]) + `<path d="M124 48l-5-5M136 43v-7M148 48l5-5" ${st(3)}/>`
    case 'denkt':
      return hipL + `<path d="M121 100q-2 12-24 10" fill="none" ${st(9)}/><path d="M121 100q-2 12-24 10" fill="none" stroke="${BLUE}" stroke-width="4.5" stroke-linecap="round"/><circle cx="94" cy="110" r="7" fill="${BLUE}" ${st(3.5)}/><path d="M132 30q0-10 9-10t9 9q0 7-8 9v6" fill="none" ${st(4.5)}/><circle cx="142" cy="54" r="3" fill="${INK}"/>`
    case 'zeigt':
      return hipL + arm('M118 98Q136 96 150 90', [152, 89]) + `<path d="M159 86h9" ${st(5)}/>`
    case 'schnee':
      return hipL + arm('M118 100Q134 96 136 78', [136, 76]) + gadget(137, 74, true)
    case 'hoppla':
      return hipL + arm('M118 96Q134 78 116 62', [113, 60])
    default:
      return hipL + hipR
  }
}

function extras(mood) {
  if (mood === 'schnee')
    return `<g ${st(2.6)}><path d="M20 40v14M13 47h14M15 42l10 10M25 42l-10 10"/><path d="M150 112v12M144 118h12M146 114l8 8M154 114l-8 8"/><path d="M24 118v8M20 122h8"/></g><path d="M67 38q13-16 26 0q-3 6-9 4q-4 4-8 0q-6 3-9-4z" fill="#fff" ${st(3)}/>`
  if (mood === 'schlaeft') return `<g fill="none" ${st(3.5)}><path d="M128 34h12l-12 14h12"/><path d="M146 14h8l-8 10h8"/></g>`
  if (mood === 'hoppla') return `<path d="M40 42q7 9 0 14q-7-5 0-14z" fill="${SHINE}" ${st(2.8)}/>`
  if (mood === 'fliegt') return `<g class="cleo-speed" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round" opacity="0.55"><path d="M2 62h22M8 76h18M0 150h26"/></g>`
  return ''
}

/**
 * Cleo als SVG. size: Breite in px (Höhe passend). anim: Blinzeln, Umhang, Schweben per CSS.
 * label: Beschriftung für Vorleseprogramme (sonst nur Schmuck).
 */
export function cleo({ mood = 'hallo', size = 96, anim = true, label = '' } = {}) {
  const m = MOODS.includes(mood) ? mood : 'hallo'
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"'
  const tilt = m === 'fliegt' ? ' transform="rotate(14 80 100)"' : ''
  return `<svg class="cleo cleo-${m}${anim ? ' cleo-anim' : ''}" viewBox="-4 0 176 172" width="${size}" height="${Math.round((size * 172) / 176)}" ${a11y}>
    <ellipse cx="82" cy="166" rx="34" ry="4.5" fill="${INK}" opacity="0.12"/>
    <g class="cleo-body"${tilt}>
      ${cape(m)}
      ${body(m)}
      ${face(m)}
      ${mouth(m)}
      ${arms(m)}
    </g>
    ${extras(m)}
  </svg>`
}

/** Kleines Gesicht für Knöpfe: Tropfen mit Heldenmaske, 1em groß. */
export function cleoIcon() {
  return `<svg class="cleo-icon" viewBox="0 0 64 70" aria-hidden="true"><path d="M32 4C32 4 8 32 8 48a24 24 0 0 0 48 0C56 32 32 4 32 4z" fill="${BLUE}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M10 42q2-8 12-7q6 0 10 4q4-4 10-4q10-1 12 7q0 9-11 9q-7 0-11-5q-4 5-11 5q-11 0-11-9z" fill="${INK}"/><circle cx="21" cy="43" r="4" fill="#fff"/><circle cx="43" cy="43" r="4" fill="#fff"/><path d="M24 55q8 7 16 0" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>`
}

/** Stimmung zur Tageszeit und Lage (Übersicht). */
export function moodFor({ hour = new Date().getHours(), snow = false, open = 0 } = {}) {
  if (snow) return 'schnee'
  if (hour < 6 || hour >= 22) return 'schlaeft'
  if (!open) return 'froh'
  return 'hallo'
}
