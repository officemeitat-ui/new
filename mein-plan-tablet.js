// Stempeluhr am Tablet (mein-plan.php?tablet=1): Zifferntasten für die PIN, laufende Uhr mit der Zeit des Servers,
// nach ein paar Sekunden ohne Eingabe wieder das PIN-Feld, Bildschirm bleibt an. Ohne dieses Skript geht alles über das
// PIN-Feld mit der Tastatur des Geräts. Gespeichert wird hier nichts (keine PIN, kein Name).
;(() => {
  const box = document.getElementById('tb')
  if (!box) return
  const start = box.dataset.start || 'mein-plan.php?tablet=1'
  const home = () => location.replace(start)

  // Uhr: Zeit des Servers beim Laden, weitergezählt mit der Uhr des Geräts (nur der Abstand zählt)
  const clock = document.getElementById('tb-uhr')
  if (clock && Number(clock.dataset.ts) > 0) {
    const server = Number(clock.dataset.ts) * 1000
    const loaded = Date.now()
    const fmt = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const tick = () => {
      clock.textContent = fmt.format(new Date(server + (Date.now() - loaded)))
    }
    tick()
    setInterval(tick, 1000)
  }

  // Bildschirm an lassen, solange die Seite zu sehen ist (wo der Browser das kann)
  const awake = () => {
    if (document.visibilityState === 'visible' && navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {})
  }
  awake()
  document.addEventListener('pointerdown', awake, { once: true })

  const form = document.getElementById('tb-form')
  const pin = document.getElementById('tb-pin')
  const dots = document.getElementById('tb-punkte')
  const typing = () => !!(pin && pin.value)

  // Bestätigung, Hinweis oder Sperre: nach data-zurueck Sekunden wieder das PIN-Feld
  const back = Number(box.dataset.zurueck)
  if (back > 0) setTimeout(home, back * 1000)

  // nach einer Pause (Bildschirm war aus) und sonst alle 10 Minuten neu laden: Uhr stimmt, das Büro sieht das Tablet
  let hidden = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return void (hidden = Date.now())
    awake()
    if (hidden && Date.now() - hidden > 60e3 && !typing()) home()
  })
  if (form) setInterval(() => !typing() && home(), 600e3)

  if (!form || !pin || !dots) return
  const len = Math.max(4, Number(form.dataset.laenge) || 4)
  let sent = false
  let idle = 0
  pin.type = 'hidden' // kein „Passwort speichern?“ am gemeinsamen Gerät, keine Bildschirmtastatur über den Tasten
  pin.value = ''
  form.classList.add('tb-js')
  const show = () => {
    dots.textContent = '●'.repeat(pin.value.length) + '○'.repeat(Math.max(0, len - pin.value.length))
    dots.setAttribute('aria-label', `${pin.value.length} / ${len}`)
  }
  const send = () => {
    if (sent || pin.value.length < 4) return
    sent = true
    form.classList.add('tb-warten')
    form.submit()
  }
  const rest = () => {
    clearTimeout(idle)
    // halb getippt und weggegangen: nach 20 Sekunden leeren
    idle = setTimeout(() => {
      if (sent) return
      pin.value = ''
      show()
    }, 20e3)
  }
  const key = (z) => {
    if (sent) return
    if (z === 'weg') pin.value = pin.value.slice(0, -1)
    else if (pin.value.length < 8) pin.value += z
    show()
    rest()
    if (pin.value.length === len) setTimeout(send, 150) // kurz zeigen, dass alle Ziffern da sind
  }
  form.addEventListener('click', (ev) => {
    const b = ev.target.closest('button')
    if (!b || !form.contains(b)) return
    if (b.dataset.z) key(b.dataset.z)
    else if (b.dataset.weg) key('weg')
  })
  form.addEventListener('submit', (ev) => {
    ev.preventDefault()
    send()
  })
  // Tastatur (z. B. Nummernblock am Empfang)
  document.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return
    if (/^[0-9]$/.test(ev.key)) key(ev.key)
    else if (ev.key === 'Backspace') key('weg')
    else if (ev.key === 'Enter') send()
    else return
    ev.preventDefault()
  })
  show()
})()
