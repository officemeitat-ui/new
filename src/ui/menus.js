// Verhalten der Aufklappmenüs (details.menu-wrap, HTML aus shared.js: menu, rowMenu, tabBar):
//
// - immer nur eines offen; Klick daneben oder auf einen Eintrag schließt (app.js)
// - Lage: unter dem Knopf, rechts- oder linksbündig wie im CSS; passt es nicht, nach oben bzw.
//   zur anderen Seite; in Tabellen und Dialogen mit Bildlauf nicht abgeschnitten (fest am Bildschirm)
// - Tastatur: Pfeil runter öffnet und springt in die Liste, Pfeile/Pos1/Ende wandern,
//   Esc schließt und gibt den Fokus an den Knopf zurück, Tab verlässt das Menü
// - am Handy (bis 700 px) als Blatt von unten mit abgedunkeltem Hintergrund (nur CSS)

const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches
const itemsOf = (d) => [...d.querySelectorAll(':scope > .menu > .btn:not([disabled])')]

let pointer = false // zuletzt mit Maus/Finger bedient (dann nicht in die Liste springen)

/** Menü an den Knopf legen; bei wenig Platz nach oben oder zur anderen Seite. */
export function place(d) {
  const m = d.querySelector(':scope > .menu')
  const s = d.querySelector(':scope > summary')
  if (!m || !s) return
  m.style.cssText = ''
  if (narrow()) return
  m.style.animation = 'none' // beim Messen ohne Einblend-Bewegung, danach startet sie neu
  const vw = document.documentElement.clientWidth || innerWidth
  const vh = innerHeight
  const sr = s.getBoundingClientRect()
  const natural = m.getBoundingClientRect()
  const start = d.classList.contains('start') || Math.abs(natural.left - d.getBoundingClientRect().left) < 2 // CSS sagt linksbündig
  const w = natural.width
  const h = Math.min(natural.height, vh - 16)
  let left = start ? sr.left : sr.right - w
  if (left + w > vw - 8) left = sr.right - w
  if (left < 8) left = Math.min(sr.left, vw - w - 8)
  left = Math.max(8, left)
  let top = sr.bottom + 6
  if (top + h > vh - 8 && sr.top - 6 - h >= 8) top = sr.top - 6 - h
  else if (top + h > vh - 8) top = Math.max(8, vh - 8 - h)
  // fest am Bildschirm; Ursprung messen, falls ein Vorfahr einen eigenen Bezugsrahmen bildet
  m.style.position = 'fixed'
  m.style.right = 'auto'
  m.style.bottom = 'auto'
  m.style.left = '0px'
  m.style.top = '0px'
  const origin = m.getBoundingClientRect()
  m.style.left = `${Math.round(left - origin.left)}px`
  m.style.top = `${Math.round(top - origin.top)}px`
  m.style.maxHeight = `${Math.round(vh - 16)}px`
  m.style.overflowY = natural.height > vh - 16 ? 'auto' : ''
  m.style.removeProperty('animation')
}

/** Alle offenen Menüs schließen; Anzahl. keep: dieses offen lassen. */
export function closeMenus(keep = null) {
  let n = 0
  for (const d of document.querySelectorAll('details.menu-wrap[open]')) {
    if (d === keep) continue
    d.open = false
    n++
  }
  return n
}

function focusItem(d, which) {
  const list = itemsOf(d)
  if (!list.length) return
  const i = list.indexOf(document.activeElement)
  const next = which === 'first' ? 0 : which === 'last' ? list.length - 1 : which === 'next' ? (i + 1) % list.length : (i - 1 + list.length) % list.length
  const current = list.findIndex((b) => b.getAttribute('aria-checked') === 'true')
  list[which === 'first' && current >= 0 ? current : next].focus({ preventScroll: true })
}

let openedAt = 0
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', () => (pointer = true), true)
  document.addEventListener(
    'toggle',
    (e) => {
      const d = e.target
      if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('menu-wrap')) return
      if (!d.open) return
      closeMenus(d)
      openedAt = Date.now()
      place(d)
      if (!pointer) focusItem(d, 'first')
    },
    true,
  )
  document.addEventListener(
    'keydown',
    (e) => {
      pointer = false
      const d = e.target.closest?.('details.menu-wrap')
      if (!d) return
      const onSummary = e.target.tagName === 'SUMMARY'
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!d.open) {
          d.open = true // toggle springt in die Liste
          return
        }
        focusItem(d, onSummary ? (e.key === 'ArrowDown' ? 'first' : 'last') : e.key === 'ArrowDown' ? 'next' : 'prev')
      } else if (d.open && (e.key === 'Home' || e.key === 'End')) {
        e.preventDefault()
        focusItem(d, e.key === 'Home' ? 'first' : 'last')
      } else if (d.open && e.key === 'Escape') {
        // nur das Menü schließen, nicht auch den Dialog dahinter
        e.preventDefault()
        e.stopImmediatePropagation()
        d.open = false
        d.querySelector(':scope > summary')?.focus({ preventScroll: true })
      } else if (d.open && e.key === 'Tab') {
        d.open = false
      }
    },
    true,
  )
  // Bildlauf außerhalb des offenen Menüs oder neue Fenstergröße: schließen (Lage stimmt sonst nicht mehr)
  document.addEventListener(
    'scroll',
    (e) => {
      if (narrow()) return
      // Nachlauf vom Trackpad oder Mausrad direkt nach dem Öffnen nicht als Bildlauf werten
      if (Date.now() - openedAt < 200) return
      for (const d of document.querySelectorAll('details.menu-wrap[open]')) if (!(e.target instanceof Node && d.contains(e.target))) d.open = false
    },
    true,
  )
  window.addEventListener('resize', () => !narrow() && closeMenus())
}
