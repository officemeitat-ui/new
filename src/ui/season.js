// Saison-Deko: Cleo im passenden Kostüm und leichte, animierte Deko auf der Übersicht und im
// Cleo-Fenster (Halloween, Advent, Silvester, Fasching, Ostern, Frühjahrsputz). Nur Inline-SVG und
// CSS, liegt hinter dem Inhalt (pointer-events: none), keine Bewegung bei „Bewegung reduzieren“.
// Ein/aus und Vorschau unter Darstellung (gilt für dieses Gerät); zum Testen ?saison=halloween.

import { pickSeason, SEASONS, viennaDay } from '../core/season.js'

const KEY = 'cleanos-saison'

/** 'auto' (nach Datum), 'aus' oder ein Anlass (Vorschau). */
export function seasonPref() {
  try {
    return localStorage.getItem(KEY) || 'auto'
  } catch {
    return 'auto'
  }
}

export function setSeasonPref(value) {
  try {
    if (!value || value === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, value)
  } catch {
    /* Browser erlaubt keine Speicherung */
  }
}

const query = () => {
  try {
    return new URLSearchParams(globalThis.location?.search || '').get('saison') || ''
  } catch {
    return ''
  }
}

/** Anlass, der gerade gilt (oder ''). */
export const activeSeason = (now = new Date()) => pickSeason({ day: viennaDay(now), pref: seasonPref(), query: query() })
/** Kopfbedeckung für Cleo zur Saison (oder ''). */
export const seasonOutfit = () => SEASONS[activeSeason()]?.outfit || ''
export const seasonInfo = (id = activeSeason()) => (id ? { id, ...SEASONS[id] } : null)

// ---------------------------------------------------------------- Bausteine

const svg = (vb, body) => `<svg viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`
const INK = '#0e2433'
const item = (cls, style, inner) => `<span class="sd ${cls}" style="${style}">${inner}</span>`

const FLAKE = svg('-10 -10 20 20', `<g stroke="#8fc3ea" stroke-width="2.2" stroke-linecap="round"><path d="M0-8V8M-7-4L7 4M-7 4L7-4"/></g>`)
const BAT = svg('0 0 40 20', `<g class="sd-flap"><path d="M20 8Q14 0 2 4Q8 8 6 13Q12 10 16 14Q18 10 20 12Q22 10 24 14Q28 10 34 13Q32 8 38 4Q26 0 20 8Z" fill="#3b2f55" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/></g><circle cx="18" cy="8" r="1.1" fill="#fff"/><circle cx="22" cy="8" r="1.1" fill="#fff"/>`)
const GHOST = svg('0 0 40 46', `<path d="M6 42V20Q6 4 20 4Q34 4 34 20V42L29 38L25 42L20 38L15 42L11 38Z" fill="#f4f7fb" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/><circle cx="15" cy="20" r="2.6" fill="${INK}"/><circle cx="25" cy="20" r="2.6" fill="${INK}"/><path d="M16 27Q20 31 24 27" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/><ellipse cx="11" cy="25" rx="2.4" ry="1.6" fill="#f7a3b5"/><ellipse cx="29" cy="25" rx="2.4" ry="1.6" fill="#f7a3b5"/>`)
const PUMPKIN = svg('0 0 40 32', `<path d="M20 6q1-5 5-5" fill="none" stroke="#6f9a2e" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="20" cy="19" rx="17" ry="12" fill="#f08a24" stroke="${INK}" stroke-width="2"/><path d="M13 8q-5 11 0 22M27 8q5 11 0 22" fill="none" stroke="#c96a12" stroke-width="1.8"/><path d="M11 17l3-4l3 4zM23 17l3-4l3 4z" fill="${INK}"/><path d="M12 23q8 6 16 0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`)
const WEB = svg('0 0 60 60', `<g fill="none" stroke="#9aa7b0" stroke-width="1.2"><path d="M60 0L8 52M60 0L30 58M60 0L2 30M60 0L58 2"/><path d="M48 2Q50 10 58 12M36 2Q40 20 58 24M24 2Q30 30 58 36M12 2Q20 40 58 48"/></g><path d="M44 30v10" stroke="${INK}" stroke-width="1"/><circle cx="44" cy="42" r="3" fill="${INK}"/>`)
const BURST = (c1, c2) => svg('-24 -24 48 48', `<g stroke-linecap="round" stroke-width="2.6">${[0, 45, 90, 135, 180, 225, 270, 315].map((r, i) => `<path transform="rotate(${r})" d="M0-8V-19" stroke="${i % 2 ? c2 : c1}"/>`).join('')}</g><circle r="2.6" fill="${c1}"/>`)
const STREAMER = (c) => svg('0 0 80 30', `<path d="M2 6q10 18 20 4t20 6t20-2t16 12" fill="none" stroke="${c}" stroke-width="3.2" stroke-linecap="round"/>`)
const EGG = (c, dots) => svg('0 0 20 26', `<path d="M10 1C15 1 18 9 18 15C18 21 14.5 25 10 25C5.5 25 2 21 2 15C2 9 5 1 10 1Z" fill="${c}" stroke="${INK}" stroke-width="1.8"/><path d="M3.5 14q6.5-4 13 0" fill="none" stroke="${dots}" stroke-width="2"/><circle cx="7" cy="19" r="1.4" fill="${dots}"/><circle cx="13" cy="19" r="1.4" fill="${dots}"/>`)
const FLOWER = (c) => svg('-12 -12 24 36', `<path d="M0 6V24" stroke="#6f9a2e" stroke-width="2.4" stroke-linecap="round"/><path d="M0 18q6-6 9-2q-4 4-9 2z" fill="#9cc654"/>${[0, 72, 144, 216, 288].map((r) => `<ellipse cy="-5" rx="3.6" ry="5.4" transform="rotate(${r})" fill="${c}" stroke="${INK}" stroke-width="1.2"/>`).join('')}<circle r="3" fill="#f5c542" stroke="${INK}" stroke-width="1.2"/>`)
const BUTTERFLY = (c) => svg('0 0 30 24', `<g class="sd-flap"><path d="M15 12Q8 0 3 4Q0 10 8 13Q2 18 7 21Q12 21 15 14Q18 21 23 21Q28 18 22 13Q30 10 27 4Q22 0 15 12Z" fill="${c}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/></g><path d="M15 8V18" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`)
const BUBBLE = svg('0 0 20 20', `<circle cx="10" cy="10" r="8" fill="rgb(255 255 255 / 0.35)" stroke="#8fc3ea" stroke-width="1.6"/><path d="M6 8q1-3 4-3" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`)
const CONFETTI = ['#9cc654', '#0c6cb4', '#f5c542', '#f49ac1', '#6a4c9c', '#f08a24']

/** Fallende Teilchen (Schnee, Konfetti) mit fester Verteilung; --y = Platz ohne Bewegung. */
function falling(n, piece, { dur = 9, size = 12 } = {}) {
  let out = ''
  for (let i = 0; i < n; i++) {
    const left = (i * 37 + 7) % 100
    const y = (i * 53 + 11) % 80
    out += item('sd-fall', `left:${left}%;--y:${y}%;width:${size}px;height:${size}px;animation-duration:${dur + (i % 4) * 1.7}s;animation-delay:-${((i * 1.9) % dur).toFixed(1)}s`, piece(i))
  }
  return out
}
const confettiPiece = (i) => `<i style="background:${CONFETTI[i % CONFETTI.length]}"></i>`

function lights(n) {
  const colors = ['#f5c542', '#e2574c', '#9cc654', '#4aa3e8']
  let bulbs = ''
  for (let i = 0; i < n; i++) bulbs += `<i class="sd-bulb" style="left:${((i + 0.5) * 100) / n}%;background:${colors[i % 4]};animation-delay:${(i % 3) * 0.6}s"></i>`
  return `<span class="sd sd-lights"><svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><path d="M0 1${Array.from({ length: n }, (_, i) => ` Q${((i + 0.5) * 100) / n} 9 ${((i + 1) * 100) / n} 1`).join('')}" fill="none" stroke="#2f4b3a" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>${bulbs}</span>`
}

/** Deko-Schicht als HTML. where: 'hero' (Übersicht) oder 'panel' (Kopf des Cleo-Fensters). */
export function seasonDeco(id = activeSeason(), where = 'hero') {
  if (!id || !SEASONS[id]) return ''
  const hero = where === 'hero'
  let body = ''
  switch (id) {
    case 'halloween':
      body = hero
        ? item('sd-corner', 'right:0;top:0;width:70px;height:70px', WEB) +
          item('sd-bob sd-bat sd-wide', 'left:48%;top:8px;width:36px;height:18px', BAT) +
          item('sd-bob sd-bat sd-wide', 'left:62%;top:26px;width:26px;height:13px;animation-delay:-1.4s', BAT) +
          item('sd-ghost', 'right:26%;bottom:6px;width:30px;height:35px', GHOST) +
          item('', 'left:38%;bottom:0;width:30px;height:24px', PUMPKIN) +
          item('', 'left:43%;bottom:0;width:20px;height:16px', PUMPKIN)
        : item('sd-bob sd-bat', 'left:42%;top:4px;width:24px;height:12px', BAT) + item('sd-bob sd-bat', 'left:56%;top:16px;width:18px;height:9px;animation-delay:-1.2s', BAT)
      break
    case 'advent':
      body = hero ? lights(12) + falling(12, () => FLAKE, { dur: 10, size: 12 }) : lights(8) + falling(5, () => FLAKE, { dur: 7, size: 9 })
      break
    case 'silvester':
      body = hero
        ? falling(16, confettiPiece, { dur: 8, size: 8 }) + item('sd-burst sd-wide', 'right:6%;top:4px;width:48px;height:48px', BURST('#f5c542', '#f08a24')) + item('sd-burst sd-wide', 'left:56%;top:2px;width:36px;height:36px;animation-delay:-1.1s', BURST('#9cc654', '#4aa3e8'))
        : falling(8, confettiPiece, { dur: 6, size: 6 }) + item('sd-burst', 'left:46%;top:2px;width:26px;height:26px', BURST('#f5c542', '#f08a24'))
      break
    case 'fasching':
      body = hero
        ? falling(14, confettiPiece, { dur: 8, size: 8 }) + item('sd-wide', 'left:0;top:0;width:90px;height:34px', STREAMER('#f49ac1')) + item('sd-wide', 'right:0;top:4px;width:90px;height:34px;transform:scaleX(-1)', STREAMER('#9cc654'))
        : falling(8, confettiPiece, { dur: 6, size: 6 })
      break
    case 'ostern':
      body = hero
        ? item('', 'right:30%;bottom:2px;width:18px;height:24px', EGG('#f49ac1', '#fff')) + item('', 'right:27%;bottom:2px;width:16px;height:21px', EGG('#f5c542', '#0c6cb4')) + item('', 'right:24.5%;bottom:2px;width:18px;height:24px', EGG('#8fc3ea', '#9cc654')) +
          [8, 44, 52, 70].map((l, i) => item('sd-sway', `left:${l}%;bottom:-4px;width:18px;height:28px;animation-delay:-${i * 0.7}s`, FLOWER(['#f49ac1', '#fff', '#f5c542', '#8fc3ea'][i]))).join('') +
          item('sd-flutter sd-wide', 'left:60%;top:10px;width:28px;height:22px', BUTTERFLY('#f5c542'))
        : item('', 'left:46%;top:8px;width:14px;height:18px', EGG('#f49ac1', '#fff')) + item('', 'left:52%;top:10px;width:12px;height:16px', EGG('#f5c542', '#0c6cb4'))
      break
    case 'fruehjahr':
      body = hero
        ? [6, 40, 48, 66, 74].map((l, i) => item('sd-sway', `left:${l}%;bottom:-4px;width:18px;height:28px;animation-delay:-${i * 0.6}s`, FLOWER(['#f49ac1', '#f5c542', '#fff', '#8fc3ea', '#f08a24'][i]))).join('') +
          item('sd-flutter sd-wide', 'left:56%;top:8px;width:28px;height:22px', BUTTERFLY('#8fc3ea')) + item('sd-flutter sd-wide', 'right:8%;top:16px;width:22px;height:18px;animation-delay:-1.3s', BUTTERFLY('#f49ac1')) +
          [30, 36, 82, 90].map((l, i) => item('sd-rise', `left:${l}%;--y:${30 + i * 12}%;width:${10 + (i % 2) * 6}px;height:${10 + (i % 2) * 6}px;animation-delay:-${i * 1.6}s`, BUBBLE)).join('')
        : item('sd-flutter', 'left:46%;top:6px;width:20px;height:16px', BUTTERFLY('#8fc3ea')) + [40, 58].map((l, i) => item('sd-rise', `left:${l}%;--y:40%;width:10px;height:10px;animation-delay:-${i * 1.5}s`, BUBBLE)).join('')
      break
  }
  return `<div class="season-deco season-${id} season-${where}" aria-hidden="true">${body}</div>`
}
