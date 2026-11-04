// Cleo, der Sauberheld der Cleanos App: ein Wassertropfen-Kopf mit geschwungener Spitze und
// weicher Haartolle, schwarze Heldenmaske mit großen Augen, rosa Bäckchen und breitem Lachen,
// Anzug in Cleanos-Blau, Umhang in Cleanos-Grün, gelber Gürtel und Wappen mit „C“.
// Flacher Sticker mit kräftiger nachtblauer Kontur; reines SVG ohne ids (mehrfach auf einer
// Seite möglich), Farben aus dem Corporate Design.
//
// Posen (mood):
//   Gesten:   hallo, fliegt, froh, fertig (= froh), denkt, zeigt, schlaeft, hoppla, daumen, stark,
//             idee, liste, herz, handy
//   Leistungen: wischt (Unterhaltsreinigung), buero (Staubsauger), glas (Fenster), fassade,
//             sanitaer, teppich, treppe, grund (Einscheibenmaschine), bau (Bauendreinigung),
//             desinfektion, haus (Hausbetreuung), gruen (Rasen), laub, schnee (Winterdienst),
//             muell, graffiti, pv (Photovoltaik), tiefgarage, tatort (Schutzanzug), event
//   Saison:   kuerbis (Halloween), geschenk (Advent), feiert (Silvester), krapfen (Fasching),
//             korb (Ostern), wedel (Frühjahrsputz)
// Outfit (Kopfbedeckung): nikolaus, hexe, party, narr, hase, tuch, helm, schutz – per
// cleo({ outfit }) oder aus der Pose (bau → helm, tatort → schutz).
// Animation (Blinzeln, Umhang, Winken, Glitzern …) per CSS-Klasse; aus bei „Bewegung reduzieren“.

const INK = '#0e2433' // Nachtblau: Kontur, Maske
const BLUE = '#0c6cb4' // Cleanos-Blau
const BLUE_DARK = '#0a5592'
const SHINE = '#6ab4ea'
const GREEN = '#9cc654' // Umhang
const GREEN_DARK = '#6f9a2e'
const GOLD = '#f5c542'
const CHEEK = '#f7a3b5'
const MOUTH = '#6b2335'
const TONGUE = '#f2829a'
const METAL = '#c9d6df'
const GLASS = '#d9eefb'
const WOOD = '#c98b4e'
const RED = '#e2574c'
const ORANGE = '#f08a24'
const PURPLE = '#6a4c9c'
const PINK = '#f49ac1'
const WHITE = '#fff'
const SUIT_WHITE = '#eef3f6'

export const MOODS = [
  'hallo', 'fliegt', 'froh', 'denkt', 'zeigt', 'schnee', 'schlaeft', 'hoppla', 'fertig',
  'daumen', 'stark', 'idee', 'liste', 'herz', 'handy',
  'wischt', 'buero', 'glas', 'fassade', 'sanitaer', 'teppich', 'treppe', 'grund', 'bau', 'desinfektion',
  'haus', 'gruen', 'laub', 'muell', 'graffiti', 'pv', 'tiefgarage', 'tatort', 'event',
  'kuerbis', 'geschenk', 'feiert', 'krapfen', 'korb', 'wedel',
]
export const OUTFITS = ['nikolaus', 'hexe', 'party', 'narr', 'hase', 'tuch', 'helm', 'schutz']

/** Leistungen der Gebäudereinigung → Pose (Hilfe, Anleitung, Übersicht). */
export const SERVICES = [
  ['wischt', 'Unterhaltsreinigung'], ['buero', 'Büroreinigung'], ['glas', 'Glas- und Fensterreinigung'], ['fassade', 'Fassadenreinigung'],
  ['sanitaer', 'Sanitärreinigung'], ['teppich', 'Teppich- und Polsterreinigung'], ['treppe', 'Stiegenhausreinigung'], ['grund', 'Grundreinigung'],
  ['bau', 'Bauendreinigung'], ['desinfektion', 'Desinfektion und Praxisreinigung'], ['haus', 'Hausbetreuung'], ['gruen', 'Grünflächenpflege'],
  ['laub', 'Laub und Dachrinne'], ['schnee', 'Winterdienst'], ['muell', 'Müllraum'], ['graffiti', 'Graffiti-Entfernung'],
  ['pv', 'Photovoltaik-Reinigung'], ['tiefgarage', 'Tiefgaragenreinigung'], ['tatort', 'Tatortreinigung'], ['event', 'Veranstaltungsreinigung'],
]

// Kontur in einem Attribut-Satz (keine doppelten Attribute je Element)
const st = (w = 4) => `stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`
const paint = (color, w) => `stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`
/** Dicke Linie mit Kontur (Arme, Stiele, Griffe). */
const bar = (d, color, w = 7) => `<path d="${d}" fill="none" ${st(w + 4.5)}/><path d="${d}" fill="none" ${paint(color, w)}/>`
const shape = (d, fill, w = 3) => `<path d="${d}" fill="${fill}" ${st(w)}/>`
const dot = (x, y, r, fill, w = 2.5) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${st(w)}/>`
const sparkle = (x, y, s = 1, color = BLUE) => `<path class="cleo-spark" d="M${x} ${y - 7 * s}Q${x + 1.2 * s} ${y - 1.2 * s} ${x + 7 * s} ${y}Q${x + 1.2 * s} ${y + 1.2 * s} ${x} ${y + 7 * s}Q${x - 1.2 * s} ${y + 1.2 * s} ${x - 7 * s} ${y}Q${x - 1.2 * s} ${y - 1.2 * s} ${x} ${y - 7 * s}Z" fill="${color}"/>`
const rays = (x, y, r = 12) => `<path d="M${x - r} ${y - r * 0.4}l-6-3M${x} ${y - r}v-7M${x + r} ${y - r * 0.4}l6-3" fill="none" ${st(3)}/>`
const bubble = (x, y, r) => `<circle class="cleo-bubble-rise" cx="${x}" cy="${y}" r="${r}" fill="${WHITE}" ${paint(SHINE, 2)}/>`

// ---------------------------------------------------------------- Körper

const HEAD = 'M62 4C82 12 134 38 134 78C134 104 113 122 88 122C63 122 42 104 42 78C42 54 58 40 64 28C67 20 66 12 62 4Z'
const SHOULDER_L = [68, 127]
const SHOULDER_R = [108, 127]

/** Handschuh: fist (Faust), mitt (offene Hand mit Daumen), thumb (Daumen hoch), grip (hält einen Stiel). */
function hand(kind, x, y, rot = 0, color = BLUE) {
  const g = (inner) => `<g transform="translate(${x} ${y})${rot ? ` rotate(${rot})` : ''}">${inner}</g>`
  if (kind === 'mitt') return g(`<path d="M-7 1Q-14 0-13-6Q-12-10-7-7" fill="${color}" ${st(3.2)}/><path d="M-7 5V-6Q-7-13 0-13Q7-13 7-6V5Q7 10 0 10Q-7 10-7 5Z" fill="${color}" ${st(3.2)}/><path d="M-2-12V-5M3-12V-5" fill="none" ${paint(BLUE_DARK, 1.8)}/>`)
  if (kind === 'thumb') return g(`<path d="M-6-6Q-9-18-2-20Q4-21 3-12L3-7" fill="${color}" ${st(3.2)}/><path d="M-8-3Q-8-8-3-8H5Q9-8 9-3V5Q9 10 4 10H-3Q-8 10-8 5Z" fill="${color}" ${st(3.2)}/><path d="M4-2H9M4 3H9" fill="none" ${st(2)}/>`)
  return g(`<circle r="8.5" fill="${color}" ${st(3.2)}/><path d="M-3-4Q2-6 5-2" fill="none" ${paint(BLUE_DARK, 2)}/>`)
}
const arm = (d, color = BLUE) => bar(d, color, 7.5)

function cape(m) {
  if (m === 'fliegt')
    return `<g class="cleo-cape"><path d="M72 118Q44 108 4 122Q18 128 20 134Q4 142 0 158Q22 150 34 156Q48 138 74 136Z" fill="${GREEN}" ${st(3.5)}/><path d="M60 122Q36 122 22 132M60 132Q42 140 32 152" fill="none" ${paint(GREEN_DARK, 3)}/></g>`
  return `<g class="cleo-cape"><path d="M62 112Q34 140 24 184Q40 176 54 185Q70 176 88 185Q106 176 122 185Q136 176 152 184Q142 140 114 112Z" fill="${GREEN}" ${st(3.5)}/><path d="M52 134Q40 156 36 176M124 134Q136 156 140 176" fill="none" ${paint(GREEN_DARK, 3)}/></g>`
}

function suit(m, color) {
  const legs = m === 'fliegt'
    ? `${bar('M76 156Q70 168 60 172', color, 9)}${bar('M100 156Q98 168 90 176', color, 9)}<path d="M50 168q8-6 14 2l-2 8q-10 0-12-10z" fill="${BLUE_DARK}" ${st(3)}/><path d="M80 174q8-6 14 0l-2 8q-10 1-12-8z" fill="${BLUE_DARK}" ${st(3)}/>`
    : `${bar('M76 160V174', color, 11)}${bar('M100 160V174', color, 11)}<path d="M61 182Q61 171 72 171H80Q86 171 86 177V184H63Q61 184 61 182Z" fill="${BLUE_DARK}" ${st(3)}/><path d="M115 182Q115 171 104 171H96Q90 171 90 177V184H113Q115 184 115 182Z" fill="${BLUE_DARK}" ${st(3)}/>`
  const torso = `<path d="M66 112Q56 114 56 128V154Q56 164 68 164H108Q120 164 120 154V128Q120 114 110 112Z" fill="${color}" ${st(4)}/>`
  const belt = `<path d="M57 150H119V158H57Z" fill="${GOLD}" ${st(3)}/><rect x="82" y="148" width="12" height="12" rx="2.5" fill="#ffe9a3" ${st(2.6)}/>`
  const tools = m === 'haus' ? `<path d="M64 154q-4 10 2 14h10q4-6 0-14z" fill="${WOOD}" ${st(2.6)}/><path d="M104 154q-2 12 4 14h6q4-6 2-14z" fill="${WOOD}" ${st(2.6)}/><path d="M70 152v-8M110 151l3-9" ${st(3)}/>` : ''
  const emblem = `<path d="M77 125H99V133Q99 142 88 147Q77 142 77 133Z" fill="${WHITE}" ${st(2.8)}/><path d="M93 131.6A5 5 0 1 0 93 138.6" fill="none" ${paint(BLUE, 3)}/>`
  return `${legs}${torso}${belt}${tools}${emblem}`
}

function head(m, outfit) {
  const tuft = `<path d="M60 36Q50 24 36 24Q33 25 35 28Q42 36 48 42Q36 40 26 46Q24 48 27 50Q38 54 46 56Q38 60 33 68Q32 71 35 70Q42 68 46 66Z" fill="${BLUE}" ${st(3.5)}/>`
  const shine = `<path d="M58 54Q51 64 51 76" fill="none" ${paint(SHINE, 6)}/><circle cx="63" cy="42" r="3.4" fill="${SHINE}"/>`
  const hood = outfit === 'schutz' ? `<path d="M36 88Q34-8 88-8Q142-8 140 88Q138 124 88 128Q38 124 36 88Z" fill="${SUIT_WHITE}" ${st(4.5)}/><ellipse cx="88" cy="84" rx="45" ry="32" fill="${BLUE}" ${st(3.5)}/><path d="M52 34Q88 18 124 34" fill="none" ${paint('#cfdbe3', 3)}/>` : ''
  return `${outfit === 'schutz' ? '' : tuft}<path d="${HEAD}" fill="${BLUE}" ${st(4.5)}/>${hood}${outfit === 'schutz' ? '' : shine}`
}

/** Gesicht: Maske, Augen (blinzeln), Brauen, Bäckchen, Mund. */
function face(m, outfit) {
  const F = FACE[m] || {}
  const look = F.look || [1, 0]
  const sleep = m === 'schlaeft'
  const mask = (dy = 0) => `<path${dy ? ` transform="translate(0 ${dy})"` : ''} d="M46 73Q47 57 66 57Q80 57 88 65Q96 57 110 57Q129 57 130 73Q130 91 110 91Q96 91 88 83Q80 91 66 91Q46 91 46 73Z" fill="${INK}"/>`
  const eye = (cx, wink) =>
    wink
      ? `<path d="M${cx - 9} 77Q${cx} 66 ${cx + 9} 77" fill="none" ${paint(WHITE, 4.5)}/>`
      : `<ellipse cx="${cx}" cy="74" rx="12" ry="13" fill="${WHITE}"/><circle cx="${cx + look[0] * 3}" cy="${75 + look[1] * 3}" r="7.4" fill="${INK}"/><circle cx="${cx + look[0] * 3 + 2.8}" cy="${72 + look[1] * 3}" r="2.9" fill="${WHITE}"/><circle cx="${cx + look[0] * 3 - 2.4}" cy="${78.5 + look[1] * 3}" r="1.3" fill="${WHITE}"/>`
  const closed = `<path d="M58 77Q67 83 76 77M100 77Q109 83 118 77" fill="none" ${paint(WHITE, 4)}/>`
  const brows =
    F.brows === 'worried'
      ? `<path d="M56 50Q66 42 76 50M100 50Q110 42 120 50" fill="none" ${st(4.5)}/>`
      : F.brows === 'up'
        ? `<path d="M55 48Q66 38 78 45M98 44Q110 37 121 47" fill="none" ${st(4.5)}/>`
        : `<path d="M56 51Q66 43 78 49M98 48Q110 42 120 51" fill="none" ${st(4.5)}/>`
  const cheeks = `<ellipse cx="54" cy="99" rx="7.5" ry="5" fill="${CHEEK}"/><ellipse cx="122" cy="99" rx="7.5" ry="5" fill="${CHEEK}"/>`
  let mouth
  if (outfit === 'schutz') mouth = `<path d="M68 100Q88 90 108 100Q110 118 88 120Q66 118 68 100Z" fill="#a8bccb" ${st(3.2)}/><circle cx="66" cy="110" r="7.5" fill="#5d7280" ${st(3)}/><circle cx="110" cy="110" r="7.5" fill="#5d7280" ${st(3)}/><path d="M80 106H96M80 112H96" fill="none" ${paint('#5d7280', 2.4)}/>`
  else if (F.mouth === 'o') mouth = `<ellipse cx="88" cy="105" rx="6" ry="5" fill="${MOUTH}" ${st(3)}/>`
  else if (F.mouth === 'wavy') mouth = `<path d="M72 106Q80 100 88 106Q96 112 104 106" fill="none" ${st(3.6)}/>`
  else if (F.mouth === 'smile') mouth = `<path d="M72 101Q88 116 104 101" fill="none" ${st(4)}/>`
  else mouth = `<path d="M67 97Q88 131 109 97Q88 103 67 97Z" fill="${MOUTH}" ${st(3.6)}/><path d="M70.5 99.4Q88 104.5 105.5 99.4L104 103.2Q88 107.6 72 103.2Z" fill="${WHITE}"/><path d="M79 109.5Q88 102 97 109.5Q88 114.5 79 109.5Z" fill="${TONGUE}"/>`
  if (sleep) return `${mask(-24)}${closed}${cheeks}<ellipse cx="88" cy="104" rx="5" ry="4" fill="${MOUTH}" ${st(2.6)}/>`
  return `${mask()}<g class="cleo-eyes">${eye(67, false)}${eye(109, !!F.wink)}</g>${outfit === 'schutz' || outfit === 'helm' || outfit === 'hexe' || outfit === 'nikolaus' ? '' : brows}${cheeks}${mouth}`
}

// Blickrichtung [x, y], Zwinkern, Brauen, Mund je Pose (Standard: Grinsen, Blick leicht rechts)
const FACE = {
  froh: { wink: true, brows: 'up' }, fertig: { wink: true, brows: 'up' }, herz: { wink: true, brows: 'up' }, daumen: { brows: 'up' },
  denkt: { look: [-1, -1.2], brows: 'up', mouth: 'smile' }, idee: { look: [1, -1.2], brows: 'up' }, hoppla: { look: [0, 0], brows: 'worried', mouth: 'wavy' },
  zeigt: { look: [1.4, 0] }, fliegt: { look: [1.4, -0.4] }, handy: { look: [1.4, 0.6], mouth: 'smile' }, liste: { look: [1.4, 0.4] },
  glas: { look: [1.4, -0.6] }, fassade: { look: [1.4, -0.4] }, graffiti: { look: [1.4, -0.4] }, sanitaer: { look: [1.4, 1] }, teppich: { look: [1.2, 1.2] },
  wischt: { look: [1.2, 1.2] }, grund: { look: [1.2, 1.2] }, laub: { look: [-1, 1] }, gruen: { look: [1.4, 1] }, pv: { look: [1.4, -0.6] },
  stark: { brows: 'up', mouth: 'smile' }, kuerbis: { look: [0, 1] }, korb: { look: [-1, 1] }, krapfen: { look: [1.2, -1.2] }, feiert: { look: [1.2, -1.2], wink: true },
}

// ---------------------------------------------------------------- Posen

const hipL = () => arm('M62 129Q42 134 46 150') + hand('fist', 47, 152)
const hipR = () => arm('M114 129Q134 134 130 150') + hand('fist', 129, 152)

/** Pose → { back: hinter Cleo, arms: Arme und Geräte, front: davor, extra: Glanz, Funken …, outfit } */
function pose(m) {
  switch (m) {
    case 'hallo':
      return { arms: hipL() + `<g class="cleo-wave">${arm('M114 129Q138 120 142 98')}${hand('mitt', 143, 90, 16)}</g>`, extra: `<path d="M158 78q6 4 6 12M164 70q10 8 10 22" fill="none" ${st(3)}/>` }
    case 'fliegt':
      return { arms: arm('M114 129Q128 114 146 102') + hand('fist', 150, 100) + arm('M62 129Q52 137 40 146') + hand('fist', 37, 148), extra: `<g class="cleo-speed" fill="none" ${st(3.5)} opacity="0.5"><path d="M0 70h24M6 86h18M2 176h26"/></g>`, tilt: 14 }
    case 'froh':
    case 'fertig':
      return { arms: hipL() + arm('M114 129Q140 120 140 100') + hand('fist', 140, 93), extra: rays(140, 88, 14) + sparkle(166, 62, 0.9, GOLD) }
    case 'denkt':
      return { arms: hipL() + arm('M114 129Q128 128 110 117') + hand('fist', 106, 116), extra: `<path d="M138 30q0-11 10-11t10 10q0 8-9 10v6" fill="none" ${st(4.5)}/><circle cx="149" cy="55" r="3.2" fill="${INK}"/>` }
    case 'zeigt':
      return { arms: hipL() + arm('M114 129Q128 124 146 116') + hand('mitt', 153, 113, 70), extra: `<path d="M166 98l7 4l-7 4" fill="none" ${st(3.4)}/>` + sparkle(170, 128, 0.7, GOLD) }
    case 'hoppla':
      return { arms: hipL() + arm('M114 129Q136 112 124 84') + hand('mitt', 121, 76, -24), extra: `<path d="M38 36Q46 46 38 52Q30 46 38 36Z" fill="${SHINE}" ${st(2.8)}/>` }
    case 'schlaeft':
      return { arms: arm('M62 129Q58 140 62 154') + hand('fist', 62, 156) + arm('M114 129Q118 140 114 154') + hand('fist', 114, 156), extra: `<g fill="none" ${st(3.5)}><path d="M134 36h12l-12 14h12"/><path d="M152 14h9l-9 11h9"/></g>` }
    case 'daumen':
      return { arms: hipL() + arm('M114 129Q136 128 140 112') + hand('thumb', 142, 106), extra: rays(142, 84, 12) + sparkle(166, 112, 0.8, GOLD) }
    case 'stark':
      return { arms: arm('M62 129Q72 142 102 138') + hand('fist', 104, 137) + arm('M114 129Q104 146 74 140') + hand('fist', 72, 140), extra: sparkle(146, 70, 0.9, GOLD) + sparkle(30, 96, 0.6, GOLD) }
    case 'idee':
      return { arms: hipL() + arm('M114 129Q128 118 130 100') + hand('mitt', 131, 92, 10), extra: `<g class="cleo-bulb"><circle cx="150" cy="38" r="17" fill="${GOLD}" opacity="0.28"/><path d="M150 24a11 11 0 0 0-6 20v6h12v-6a11 11 0 0 0-6-20z" fill="#ffe27a" ${st(3)}/><path d="M145 54h10M146 58h8" fill="none" ${st(3)}/>${rays(150, 30, 16)}</g>` }
    case 'liste':
      return { arms: hipL() + arm('M114 129Q114 140 120 140'), front: `<g transform="rotate(8 138 130)"><rect x="118" y="102" width="40" height="52" rx="4" fill="${WOOD}" ${st(3)}/><rect x="123" y="110" width="30" height="40" rx="1.5" fill="${WHITE}"/><rect x="130" y="98" width="16" height="9" rx="2" fill="${METAL}" ${st(2.5)}/>${[118, 129, 140].map((y) => `<path d="M126 ${y}l3 3l5-6" fill="none" ${paint(GREEN_DARK, 2.8)}/><path d="M137 ${y}h12" fill="none" ${paint(SHINE, 2.6)}/>`).join('')}</g>` + hand('fist', 121, 140) }
    case 'herz':
      return { arms: arm('M62 129Q58 142 74 142') + arm('M114 129Q118 142 102 142'), front: `<g class="cleo-heart"><path d="M88 156Q66 142 70 130Q74 120 88 128Q102 120 106 130Q110 142 88 156Z" fill="${PINK}" ${st(3.2)}/></g>` + hand('fist', 72, 140) + hand('fist', 104, 140), extra: `<g class="cleo-heart"><path d="M152 52Q140 44 142 37Q145 31 152 36Q159 31 162 37Q164 44 152 52Z" fill="${PINK}" ${st(2.8)}/></g>` + sparkle(28, 92, 0.6, PINK) }
    case 'handy':
      return { arms: hipL() + arm('M114 129Q124 128 128 116'), front: `<rect x="120" y="82" width="26" height="42" rx="5" fill="${INK}" ${st(2.5)}/><rect x="123.5" y="87" width="19" height="31" rx="2" fill="${BLUE}"/><path d="M127 96H139V101Q139 107 133 110Q127 107 127 101Z" fill="${WHITE}"/><path d="M136 100a2.8 2.8 0 1 0 0 4" fill="none" ${paint(BLUE, 1.8)}/>` + hand('fist', 129, 118), extra: sparkle(156, 80, 0.7, GOLD) }

    // ------------------------------------------------ Leistungen
    case 'wischt':
      return {
        back: `<path d="M144 148h38l-5 36h-28z" fill="${BLUE}" ${st(3.2)}/><ellipse cx="163" cy="148" rx="19" ry="5" fill="${SHINE}" ${st(3)}/><path d="M150 162h26" fill="none" ${paint(BLUE_DARK, 2.4)}/>${bubble(156, 138, 3.4)}${bubble(168, 128, 2.6)}${bubble(176, 140, 2)}`,
        arms: hipL() + arm('M114 129Q130 134 137 126') + bar('M150 92L116 176', WOOD, 4.5) + `<path d="M96 172q20-10 40 0l-3 12h-34z" fill="${WHITE}" ${st(3.2)}/><path d="M103 175v8M110 174v10M117 174v10M124 174v10M130 175v8" fill="none" ${paint(METAL, 2.2)}/>` + hand('grip', 138, 124),
        extra: `<path d="M86 190q26-6 54 0" fill="none" ${paint(SHINE, 3)}/>` + sparkle(88, 160, 0.7) + sparkle(76, 178, 0.5),
      }
    case 'buero':
      return {
        arms: hipL() + arm('M114 129Q132 130 138 118') + bar('M140 108L142 146', METAL, 4) + `<rect x="126" y="138" width="32" height="36" rx="10" fill="${GREEN}" ${st(3.2)}/><path d="M133 148h18M133 155h18" fill="none" ${paint(GREEN_DARK, 2.6)}/><path d="M116 174h52q6 0 6 6v5h-64v-5q0-6 6-6z" fill="${INK}"/><path d="M120 178h46" fill="none" ${paint(SHINE, 2)}/><path d="M158 150q22 4 24 34" fill="none" ${st(2.4)}/>` + hand('grip', 140, 115),
        extra: sparkle(104, 176, 0.6) + sparkle(178, 128, 0.7),
      }
    case 'glas':
      return {
        back: `<rect x="124" y="34" width="56" height="112" rx="3" fill="${GLASS}" ${st(3.5)}/><path d="M152 34v112M124 90h56" fill="none" ${st(3)}/><path d="M130 50l12-10M130 64l20-18M158 108l14-12M158 122l18-16" fill="none" ${paint(WHITE, 4)}/>`,
        arms: hipL() + arm('M114 129Q134 120 140 104') + `<path d="M142 102L147 82" fill="none" ${st(5.5)}/><g transform="rotate(-12 150 76)"><rect x="134" y="72" width="32" height="7" rx="2" fill="${METAL}" ${st(2.8)}/><rect x="134" y="79" width="32" height="3.5" rx="1.5" fill="${INK}"/></g>` + hand('grip', 141, 102),
        extra: sparkle(172, 60, 0.8) + sparkle(134, 128, 0.6),
      }
    case 'fassade':
      return {
        back: `<rect x="134" y="30" width="48" height="154" fill="#f0c9a8" ${st(3.5)}/><path d="M134 54h48M134 78h48M134 102h48M134 126h48M134 150h48M152 30v24M168 54v24M152 78v24M168 102v24M152 126v24M168 150v34" fill="none" ${paint('#d39a73', 2.2)}/><path d="M136 32h44v44h-44z" fill="#fbe7d6"/>`,
        arms: arm('M62 129Q88 148 116 130') + arm('M114 129Q118 128 124 122') + bar('M108 136L140 104', METAL, 4) + `<rect x="102" y="130" width="14" height="10" rx="3" fill="${GOLD}" ${st(2.6)}/>` + hand('grip', 116, 130) + hand('grip', 126, 120),
        extra: `<g class="cleo-spray" fill="none" ${paint(SHINE, 3)}><path d="M144 98l14-14M146 102l18-8M144 94l8-18"/></g>` + sparkle(158, 44, 0.7),
      }
    case 'sanitaer':
      return {
        back: `<rect x="152" y="96" width="30" height="38" rx="5" fill="${WHITE}" ${st(3.2)}/><rect x="162" y="102" width="10" height="5" rx="2" fill="${METAL}"/><path d="M128 134h54q0 24-20 32v18h-20v-18q-14-6-14-32z" fill="${WHITE}" ${st(3.2)}/><ellipse cx="155" cy="134" rx="27" ry="6" fill="${GLASS}" ${st(3)}/>`,
        arms: hipL() + arm('M114 129Q130 130 138 122') + bar('M140 118L154 140', WOOD, 4) + `<ellipse cx="156" cy="143" rx="6" ry="8.5" transform="rotate(-35 156 143)" fill="${GREEN}" ${st(2.8)}/>` + hand('grip', 139, 120),
        extra: bubble(150, 120, 3.4) + bubble(160, 112, 2.6) + bubble(170, 122, 2) + sparkle(180, 84, 0.7),
      }
    case 'teppich':
      return {
        back: `<path d="M4 172H182L172 190H-4Z" fill="#7aa6c8" ${st(3)}/><path d="M118 172h52l-6 18h-52z" fill="#bcd6e8"/><path d="M8 178H176M4 185H173" fill="none" ${paint('#a9c8df', 2.2)}/><path d="M118 172h52l-6 18h-52z" fill="none" ${paint('#e6f1f8', 2)}/>`,
        arms: hipL() + arm('M114 129Q130 132 138 124') + bar('M140 120L156 170', METAL, 4) + `<rect x="140" y="168" width="34" height="8" rx="3" fill="${INK}"/>` + hand('grip', 139, 122),
        extra: sparkle(126, 180, 0.6, WHITE) + sparkle(178, 156, 0.7),
      }
    case 'treppe':
      return {
        back: `<path d="M116 190V172H138V154H160V136H184V190Z" fill="#dfe8ee" ${st(3.2)}/><path d="M116 172H138M138 154H160M160 136H184" fill="none" ${paint(WHITE, 3)}/><path d="M130 146L186 98" fill="none" ${st(6)}/><path d="M130 146L186 98" fill="none" ${paint(WOOD, 2.5)}/><path d="M134 143v29M156 124v30M178 105v31" fill="none" ${st(2.6)}/>`,
        arms: hipL() + arm('M114 129Q134 130 146 118') + bar('M144 98L154 150', WOOD, 4.5) + `<path d="M140 150q16-8 32 0l-3 6h-26z" fill="${WHITE}" ${st(3)}/>` + hand('grip', 147, 116),
        extra: sparkle(176, 124, 0.6) + sparkle(130, 164, 0.5),
      }
    case 'grund':
      return {
        back: `${bubble(122, 180, 3.5)}${bubble(184, 174, 3)}${bubble(178, 184, 2.4)}`,
        arms: arm('M62 129Q96 150 130 132') + arm('M114 129Q120 124 122 118') + bar('M118 110L152 162', METAL, 4.5) + `<path d="M110 114L128 106" fill="none" ${st(7)}/><path d="M134 166q18-22 36 0z" fill="${METAL}" ${st(3.2)}/><ellipse cx="152" cy="170" rx="28" ry="8" fill="${GREEN}" ${st(3.2)}/>` + hand('grip', 130, 131) + hand('grip', 122, 117),
        extra: `<path d="M120 190q32 4 64 0" fill="none" ${paint(SHINE, 3)}/>`,
      }
    case 'bau':
      return {
        outfit: 'helm',
        arms: hipL() + arm('M114 129Q132 134 142 122') + bar('M142 104L152 172', WOOD, 4.5) + `<rect x="128" y="170" width="48" height="9" rx="2.5" fill="${INK}"/><path d="M132 179v7M140 179v7M148 179v7M156 179v7M164 179v7M172 179v7" fill="none" ${st(2.6)}/>` + hand('grip', 144, 120),
        extra: `<path d="M0 186L13 144L26 186Z" fill="${ORANGE}" ${st(3)}/><path d="M7 166h12" fill="none" ${paint(WHITE, 4)}/><g class="cleo-dust" fill="#d8cfc0" ${st(2.4)}><circle cx="180" cy="168" r="6"/><circle cx="184" cy="154" r="4"/><circle cx="118" cy="184" r="3.5"/></g>`,
      }
    case 'desinfektion':
      return {
        arms: hipL() + arm('M114 129Q130 122 134 112'),
        front: `<path d="M128 98h14v-6h-10q-6 0-8 6z" fill="${METAL}" ${st(2.6)}/><path d="M126 104q0-6 6-6h8q6 0 6 6v28q0 4-4 4h-12q-4 0-4-4z" fill="${WHITE}" ${st(3)}/><path d="M136 110v12M130 116h12" fill="none" ${paint(BLUE, 3.4)}/>` + hand('fist', 132, 114),
        extra: `<g class="cleo-spray" fill="none" ${paint(SHINE, 2.6)}><path d="M146 92l10-4M146 96l12 0M146 100l10 4"/></g><circle cx="172" cy="92" r="9" fill="#a5d26b" ${st(2.4)}/><path d="M172 80v-3M172 104v3M160 92h-3M184 92h3" fill="none" ${st(2.4)}/><circle cx="172" cy="92" r="14" fill="none" ${paint(RED, 3)}/><path d="M162 82l20 20" fill="none" ${paint(RED, 3)}/>`,
      }
    case 'haus':
      return {
        arms: hipL() + arm('M114 129Q134 124 138 106') + `<g transform="rotate(-25 140 86)"><path d="M140 106V66" fill="none" ${st(8)}/><path d="M140 106V66" fill="none" ${paint(METAL, 4)}/><path d="M130 66q0-14 10-14q10 0 10 14h-6v-7h-8v7z" fill="${METAL}" ${st(2.8)}/></g>` + hand('grip', 139, 103),
        extra: rays(148, 58, 13),
      }
    case 'gruen':
      return {
        back: `<path d="M-6 190q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0q5-12 9 0z" fill="${GREEN}" ${st(2.4)}/>`,
        arms: arm('M62 129Q96 150 130 132') + arm('M114 129Q120 124 122 118') + bar('M118 110L150 158', METAL, 4) + `<path d="M110 114L128 106" fill="none" ${st(7)}/><path d="M132 156h42q6 0 6 8v8h-54v-8q0-8 6-8z" fill="${GREEN}" ${st(3.2)}/><path d="M138 164h34" fill="none" ${paint(GREEN_DARK, 2.6)}/><rect x="146" y="146" width="18" height="10" rx="3" fill="${INK}"/><circle cx="136" cy="176" r="7" fill="${INK}"/><circle cx="172" cy="176" r="7" fill="${INK}"/><circle cx="136" cy="176" r="2.4" fill="${GOLD}"/><circle cx="172" cy="176" r="2.4" fill="${GOLD}"/>` + hand('grip', 130, 131) + hand('grip', 122, 117),
        extra: `<g class="cleo-spray" fill="${GREEN}" ${st(2)}><path d="M180 140l4-9l2 9z"/><path d="M170 130l3-9l3 8z"/><path d="M184 124l2-7l3 7z"/></g>`,
      }
    case 'laub':
      return {
        back: [[156, 182, ORANGE, 10], [168, 184, GOLD, -40], [178, 180, RED, 60], [146, 186, GOLD, 80], [184, 186, ORANGE, -20]].map(([x, y, c, r]) => leaf(x, y, c, r)).join(''),
        arms: hipL() + arm('M114 129Q132 134 143 124') + bar('M150 98L132 168', WOOD, 4.5) + `<path d="M124 160l18 4l12 22l-40-4z" fill="${GOLD}" ${st(3)}/><path d="M128 170l-3 12M136 168l0 16M144 170l5 15" fill="none" ${paint('#c99a2e', 2)}/>` + hand('grip', 143, 124),
        extra: `<g class="cleo-leaf">${leaf(170, 104, ORANGE, 30)}${leaf(182, 138, GOLD, -30)}</g>`,
      }
    case 'schnee':
      return {
        outfit: 'schal',
        arms: hipL() + arm('M114 129Q132 132 140 120') + bar('M140 100L148 160', WOOD, 4.5) + `<path d="M132 99h16" fill="none" ${st(7)}/><path d="M130 158h36l-4 26h-28z" fill="${METAL}" ${st(3.2)}/><path d="M128 160q8-12 18-6q10-10 20 2q2 6-4 6h-30q-6 0-4-2z" fill="${WHITE}" ${st(2.6)}/>` + hand('grip', 142, 118),
        extra: `<g class="cleo-flake" ${st(2.6)}><path d="M20 40v14M13 47h14M15 42l10 10M25 42l-10 10"/><path d="M168 74v12M162 80h12M164 76l8 8M172 76l-8 8"/></g><path d="M52 22q6-14 18-12q10-6 16 4q4 6-2 8q-6 6-14 2q-10 4-18-2z" fill="${WHITE}" ${st(3)}/>`,
      }
    case 'muell':
      return {
        back: `<path d="M138 120h42l-4 60h-34z" fill="${GREEN}" ${st(3.2)}/><path d="M134 112h50v9h-50z" fill="${GREEN_DARK}" ${st(3)}/><circle cx="146" cy="184" r="4.5" fill="${INK}"/><circle cx="172" cy="184" r="4.5" fill="${INK}"/><path d="M152 150l7-9l7 9M166 160l-7 9l-7-9" fill="none" ${paint(WHITE, 3.2)}/>`,
        arms: hipL() + arm('M114 129Q126 138 124 146') + `<path d="M108 158q-8 24 12 30h12q18-6 8-30q-4-10-16-10t-16 10z" fill="#3a4a56" ${st(3.2)}/><path d="M118 150l6-8l6 8" fill="none" ${st(3.2)}/>` + hand('fist', 124, 146),
        extra: sparkle(180, 96, 0.7) + sparkle(130, 104, 0.5),
      }
    case 'graffiti':
      return {
        back: `<rect x="124" y="40" width="60" height="146" fill="#e2e6e9" ${st(3.5)}/><path d="M150 64l8 12l8-14l8 12" fill="none" ${paint(RED, 6)}/><path d="M148 100q14-16 32 0" fill="none" ${paint(PURPLE, 6)}/><path d="M152 132q10-12 24 2" fill="none" ${paint(GREEN_DARK, 6)}/><path d="M126 42h22v142h-22z" fill="#f7f9fa"/><path d="M148 42v142" fill="none" ${paint('#cfd6db', 2)}/>`,
        arms: hipL() + arm('M114 129Q134 122 140 104') + `<rect x="131" y="86" width="22" height="15" rx="5" fill="${GOLD}" ${st(3)}/><path d="M131 91h22" fill="none" ${paint(GREEN, 4)}/>` + hand('fist', 140, 104),
        extra: bubble(158, 112, 3.4) + bubble(150, 122, 2.4) + sparkle(136, 60, 0.8) + sparkle(136, 160, 0.6),
      }
    case 'pv':
      return {
        back: `<circle cx="168" cy="34" r="10" fill="${GOLD}" ${st(2.6)}/><path d="M168 16v-5M186 34h5M181 21l4-4M155 21l-4-4" fill="none" ${st(2.6)}/><path d="M126 118L186 94V148L126 172Z" fill="#2d5f9e" ${st(3.2)}/><path d="M146 110V164M166 102V156M126 145L186 121" fill="none" ${paint('#8fb6e0', 2)}/><path d="M156 160v26" fill="none" ${st(5)}/>`,
        arms: hipL() + arm('M114 129Q132 130 140 120') + bar('M134 124L166 104', METAL, 4) + `<rect x="160" y="94" width="20" height="11" rx="3" transform="rotate(-22 170 99)" fill="${GREEN}" ${st(2.8)}/>` + hand('grip', 140, 120),
        extra: sparkle(176, 136, 0.7, WHITE) + sparkle(144, 150, 0.5, WHITE),
      }
    case 'tiefgarage':
      return {
        back: `<path d="M-6 188H186" fill="none" ${paint('#9aa7b0', 3)}/><path d="M172 188V74" fill="none" ${st(5)}/><rect x="154" y="40" width="34" height="34" rx="5" fill="${BLUE}" ${st(3)}/><path d="M165 66V48h8a6 6 0 0 1 0 12h-8" fill="none" ${paint(WHITE, 4.5)}/>`,
        arms: hipL() + arm('M114 129Q132 134 142 122') + bar('M142 104L150 172', WOOD, 4.5) + `<rect x="124" y="170" width="46" height="9" rx="2.5" fill="${INK}"/><path d="M128 179v6M136 179v6M144 179v6M152 179v6M160 179v6M166 179v6" fill="none" ${st(2.4)}/>` + hand('grip', 144, 120),
        extra: sparkle(112, 182, 0.6) + sparkle(182, 162, 0.6),
      }
    case 'tatort':
      return {
        outfit: 'schutz',
        suit: SUIT_WHITE,
        back: tape(),
        arms: hipL() + arm('M114 129Q130 122 134 112', SUIT_WHITE),
        front: `<path d="M128 98h14v-6h-10q-6 0-8 6z" fill="${METAL}" ${st(2.6)}/><path d="M126 104q0-6 6-6h8q6 0 6 6v28q0 4-4 4h-12q-4 0-4-4z" fill="${GLASS}" ${st(3)}/><path d="M131 112h10" fill="none" ${paint(BLUE, 3)}/>` + hand('fist', 132, 114),
        extra: `<g class="cleo-spray" fill="none" ${paint(SHINE, 2.6)}><path d="M146 92l10-4M146 96l12 0M146 100l10 4"/></g>` + sparkle(172, 70, 0.7),
      }
    case 'event':
      return {
        back: `<g class="cleo-balloons"><path d="M24 104q-4 30 8 80M42 94q2 40-8 90M10 112q10 30 22 72" fill="none" ${paint(INK, 1.6)}/><ellipse cx="24" cy="88" rx="13" ry="16" fill="${GREEN}" ${st(3)}/><ellipse cx="44" cy="76" rx="13" ry="16" fill="${BLUE}" ${st(3)}/><ellipse cx="9" cy="98" rx="11" ry="14" fill="${GOLD}" ${st(3)}/><path d="M18 80q2-6 6-7M38 68q2-6 6-7" fill="none" ${paint(WHITE, 2.4)}/></g>`,
        arms: hipL() + arm('M114 129Q132 134 142 122') + bar('M142 104L150 168', WOOD, 4.5) + `<path d="M128 166h40l-4 12h-32z" fill="${GOLD}" ${st(3)}/>` + hand('grip', 144, 120),
        extra: confetti([[154, 182, GREEN], [170, 184, BLUE], [180, 172, PINK], [118, 186, GOLD], [166, 150, PURPLE], [176, 120, GREEN], [158, 96, PINK]]),
      }


    // ------------------------------------------------ Saison
    case 'kuerbis':
      return { outfit: 'hexe', arms: arm('M62 129Q48 146 62 154') + arm('M114 129Q128 146 114 154'), front: `<g transform="translate(88 154) scale(1.3) translate(-88 -154)">${pumpkin(88, 154)}</g>` + hand('fist', 62, 154) + hand('fist', 114, 154), extra: `<g class="cleo-confetti">${sparkle(152, 70, 0.7, ORANGE)}</g>` }
    case 'geschenk':
      return { outfit: 'nikolaus', arms: arm('M62 129Q58 146 72 150') + arm('M114 129Q118 146 104 150'), front: `<rect x="70" y="136" width="36" height="32" rx="3" fill="${RED}" ${st(3)}/><path d="M88 136v32M70 150h36" fill="none" ${paint(GOLD, 5)}/><path d="M88 136q-12-12-14-2q2 6 14 2q12 4 14-2q-2-10-14 2z" fill="${GOLD}" ${st(2.6)}/>` + hand('fist', 70, 150) + hand('fist', 106, 150), extra: sparkle(150, 70, 0.8, GOLD) }
    case 'feiert':
      return { outfit: 'party', arms: hipL() + arm('M114 129Q130 116 132 96') + `<path d="M134 92L144 54" fill="none" ${st(3.4)}/>` + hand('fist', 132, 92), extra: `<g class="cleo-spark-burst">${sparkle(146, 46, 1.2, GOLD)}${sparkle(160, 36, 0.7, ORANGE)}${sparkle(132, 32, 0.6, GOLD)}${sparkle(156, 60, 0.5, ORANGE)}</g>` }
    case 'krapfen':
      return { outfit: 'narr', arms: hipL() + arm('M114 129Q128 118 130 102'), front: `<ellipse cx="134" cy="92" rx="16" ry="11" fill="#d89048" ${st(3)}/><path d="M120 88q14-8 28 0" fill="none" ${paint('#f2d9b5', 6)}/><circle cx="134" cy="92" r="3" fill="${RED}"/><path d="M124 84l2 1M132 82l1 2M142 84l-1 2" fill="none" ${paint(WHITE, 2.2)}/>` + hand('fist', 130, 104), extra: confetti([[22, 60, GREEN], [36, 42, PINK], [160, 130, BLUE], [170, 60, GOLD]]) }
    case 'korb':
      return { outfit: 'hase', arms: arm('M62 129Q50 136 44 148') + hipR(), front: `<path d="M40 128q8-22 26 0" fill="none" ${st(4)}/><path d="M28 136h48l-6 26h-36z" fill="${WOOD}" ${st(3)}/><path d="M32 146h40M34 154h36" fill="none" ${paint('#a86f37', 2)}/><ellipse cx="40" cy="134" rx="6" ry="8" fill="${PINK}" ${st(2.4)}/><ellipse cx="52" cy="132" rx="6" ry="8" fill="${GOLD}" ${st(2.4)}/><ellipse cx="64" cy="134" rx="6" ry="8" fill="${SHINE}" ${st(2.4)}/>` + hand('fist', 44, 146) }
    case 'wedel':
      return { outfit: 'tuch', arms: hipL() + arm('M114 129Q128 118 132 100') + bar('M132 100L140 66', WOOD, 3) + `<path d="M140 66q-14-10-6-24q6 8 8 2q4-10 12-6q-2 8 4 8q12 2 2 16q-8 8-20 4z" fill="${PINK}" ${st(2.6)}/>` + hand('grip', 132, 98), extra: sparkle(166, 46, 0.7, GOLD) + flower(20, 168, PINK) + flower(34, 176, GOLD) }
    default:
      return { arms: hipL() + hipR() }
  }
}

function tape() {
  const y = (x) => 164 - 0.12 * (x + 6)
  let stripes = ''
  for (let x = -4; x < 186; x += 16) stripes += `<path d="M${x} ${y(x) - 6}L${x + 7} ${y(x + 7) - 6}L${x + 3} ${y(x + 3) + 6}L${x - 4} ${y(x - 4) + 6}Z" fill="${INK}"/>`
  return `<path d="M-6 ${y(-6) - 6}L186 ${y(186) - 6}L186 ${y(186) + 6}L-6 ${y(-6) + 6}Z" fill="${GOLD}" ${st(2)}/>${stripes}`
}

const leaf = (x, y, c, r = 0) => `<g transform="rotate(${r} ${x} ${y})"><path d="M${x} ${y - 8}q9 8 0 16q-9-8 0-16z" fill="${c}" ${st(2.2)}/><path d="M${x} ${y - 5}v11" fill="none" ${paint(INK, 1.4)}/></g>`
const confetti = (list) => `<g class="cleo-confetti">${list.map(([x, y, c], i) => `<rect x="${x}" y="${y}" width="8" height="4.5" rx="1.2" transform="rotate(${(i * 47) % 180} ${x + 4} ${y + 2})" fill="${c}"/>`).join('')}</g>`
const flower = (x, y, c) => `<g>${[0, 72, 144, 216, 288].map((r) => `<ellipse cx="${x}" cy="${y - 5}" rx="3.4" ry="5" transform="rotate(${r} ${x} ${y})" fill="${c}" ${st(1.8)}/>`).join('')}<circle cx="${x}" cy="${y}" r="2.6" fill="${GOLD}" ${st(1.6)}/></g>`
const pumpkin = (x, y) => `<g><path d="M${x} ${y - 16}q2-8 8-8" fill="none" ${paint(GREEN_DARK, 4)}/><ellipse cx="${x}" cy="${y}" rx="20" ry="15" fill="${ORANGE}" ${st(3)}/><path d="M${x - 8} ${y - 14}q-6 14 0 28M${x + 8} ${y - 14}q6 14 0 28" fill="none" ${paint('#c96a12', 2.4)}/><path d="M${x - 10} ${y - 4}l4-5l4 5zM${x + 2} ${y - 4}l4-5l4 5z" fill="${INK}"/><path d="M${x - 10} ${y + 4}q10 8 20 0" fill="none" ${paint(INK, 3)}/></g>`

/** Kopfbedeckung über dem Kopf. */
function hat(outfit) {
  switch (outfit) {
    case 'nikolaus':
      return `<path d="M54 44Q58 12 84 4Q104 0 112 14Q118 26 122 42Z" fill="${RED}" ${st(3.5)}/><path d="M84 4Q60 2 42 24Q54 18 68 20" fill="${RED}" ${st(3.5)}/>${bar('M52 46Q88 34 124 42', WHITE, 9)}<circle cx="40" cy="26" r="7.5" fill="${WHITE}" ${st(3)}/>`
    case 'hexe':
      return `<path d="M60 42Q72 20 82 0Q90-14 102-10Q92-4 94 10L114 40Z" fill="${PURPLE}" ${st(3.5)}/><path d="M34 46Q88 30 142 42Q146 48 136 50Q88 42 40 54Q30 52 34 46Z" fill="${PURPLE}" ${st(3.5)}/><path d="M64 38Q88 30 112 36" fill="none" ${paint(ORANGE, 5)}/>${sparkle(98, 16, 0.5, GOLD)}`
    case 'party':
      return `<path d="M76 40L96-6L116 36Q96 44 76 40Z" fill="${GOLD}" ${st(3.5)}/><path d="M82 30L104 24M88 16L108 12" fill="none" ${paint(BLUE, 3.5)}/><circle cx="96" cy="-8" r="6" fill="${GREEN}" ${st(2.8)}/>`
    case 'narr':
      return `<path d="M54 44Q48 20 30 12Q48 8 66 24Q72 0 90-6Q96 12 100 22Q114 4 138 8Q124 18 122 42Q88 32 54 44Z" fill="${GREEN}" ${st(3.5)}/><path d="M66 24Q80 30 100 22" fill="none" ${paint(BLUE, 4)}/>${bar('M52 46Q88 34 124 42', GOLD, 7)}${dot(30, 12, 5, GOLD)}${dot(90, -6, 5, GOLD)}${dot(138, 8, 5, GOLD)}`
    case 'hase':
      return `<g class="cleo-ears"><path d="M72 30Q60 0 66-16Q76-22 80-4Q82 12 82 30Z" fill="${WHITE}" ${st(3.2)}/><path d="M72 22Q66 2 70-10Q76-10 76 4Z" fill="${PINK}"/><path d="M98 30Q104 0 116-14Q126-14 122 4Q116 18 108 32Z" fill="${WHITE}" ${st(3.2)}/><path d="M104 22Q110 2 118-6Q120 4 112 20Z" fill="${PINK}"/></g>${bar('M56 42Q88 26 120 38', PINK, 5)}`
    case 'tuch':
      return `<path d="M52 46Q54 22 70 8Q90 18 122 42Q88 34 52 46Z" fill="${GREEN}" ${st(3.5)}/>${[[66, 26], [82, 22], [98, 30], [74, 38], [108, 38], [62, 40]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.4" fill="${WHITE}"/>`).join('')}<path d="M52 44Q38 38 34 46Q42 50 52 46ZM52 46Q40 54 42 62Q50 56 54 48Z" fill="${GREEN}" ${st(3)}/>`
    case 'helm':
      return `<path d="M50 46Q50 0 88 0Q126 2 126 44Z" fill="${GOLD}" ${st(3.5)}/><path d="M88 2V44M70 8Q64 24 64 44M106 6Q112 24 112 44" fill="none" ${paint('#d9a521', 3)}/>${bar('M40 47Q88 38 136 45', GOLD, 5.5)}`
    case 'schal':
      return ''
    default:
      return ''
  }
}

const SCARF = `${bar('M50 112Q88 132 126 112', RED, 9)}${bar('M112 120L120 146', RED, 7)}<path d="M114 140l12-2M116 146l10-1" fill="none" ${paint(WHITE, 2)}/>`

/**
 * Cleo als SVG. size: Breite in px (Höhe passend). anim: Blinzeln, Umhang, Glitzern per CSS.
 * outfit: Kopfbedeckung (z. B. zur Jahreszeit). label: Beschriftung für Vorleseprogramme (sonst nur Schmuck).
 */
export function cleo({ mood = 'hallo', size = 96, anim = true, label = '', outfit = '' } = {}) {
  const m = MOODS.includes(mood) ? mood : 'hallo'
  const p = pose(m)
  // eigene Ausrüstung der Pose (Helm, Schutzanzug, Schal) geht vor
  const o = p.outfit || (OUTFITS.includes(outfit) ? outfit : '')
  const suitColor = p.suit || BLUE
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"'
  const tilt = p.tilt ? ` transform="rotate(${p.tilt} 88 110)"` : ''
  const w = 198
  const h = 212
  return `<svg class="cleo cleo-${m}${o ? ` cleo-${o}` : ''}${anim ? ' cleo-anim' : ''}" viewBox="-8 -18 ${w} ${h}" width="${size}" height="${Math.round((size * h) / w)}" ${a11y}>
    <ellipse cx="88" cy="189" rx="40" ry="4.5" fill="${INK}" opacity="0.12"/>
    ${p.back || ''}
    <g class="cleo-body"${tilt}>
      ${cape(m)}
      ${suit(m, suitColor)}
      ${o === 'schal' ? SCARF : ''}
      ${head(m, o)}
      ${face(m, o)}
      ${hat(o)}
      ${p.arms || ''}
      ${p.front || ''}
    </g>
    ${p.extra || ''}
  </svg>`
}

/** Kleines Gesicht für Knöpfe: Tropfenkopf mit Heldenmaske und Lachen, 1em groß. */
export function cleoIcon() {
  return `<svg class="cleo-icon" viewBox="36 2 104 126" aria-hidden="true"><path d="${HEAD}" fill="${BLUE}" ${st(6)}/><path d="M46 73Q47 57 66 57Q80 57 88 65Q96 57 110 57Q129 57 130 73Q130 91 110 91Q96 91 88 83Q80 91 66 91Q46 91 46 73Z" fill="${INK}"/><circle cx="67" cy="74" r="10" fill="${WHITE}"/><circle cx="109" cy="74" r="10" fill="${WHITE}"/><circle cx="69" cy="75" r="5.5" fill="${INK}"/><circle cx="111" cy="75" r="5.5" fill="${INK}"/><path d="M67 97Q88 131 109 97Q88 103 67 97Z" fill="${MOUTH}" ${st(4)}/></svg>`
}

/** Stimmung zur Tageszeit und Lage (Übersicht). season: Pose der Jahreszeit, wenn die Deko an ist. */
export function moodFor({ hour = new Date().getHours(), snow = false, open = 0, season = '' } = {}) {
  if (snow) return 'schnee'
  if (hour < 6 || hour >= 22) return 'schlaeft'
  if (season) return season
  if (open) return 'liste'
  return 'daumen'
}
