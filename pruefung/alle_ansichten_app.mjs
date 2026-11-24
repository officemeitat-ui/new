// Alle Ansichten im Browser-Modus (Beispieldaten) einmal öffnen, am PC (1400 px) und am Handy (390 px): keine
// Ausnahme und keine Fehlermeldung in der Konsole, die Ansicht hat Inhalt, kein „undefined“ oder „NaN“ im Text, am
// Handy kein Querscrollen der Seite. Später geladene Bereiche (eigene Pakete) werden dabei mitgeladen.
// Port 19801.
import { chromium, check, finish, note, openApp, startServer, wait } from './ablauf-lib.mjs'

const PORT = 19801
const server = startServer(PORT)
await wait(800)
const browser = await chromium.launch()
const errors = []
try {
  for (const mobile of [false, true]) {
    const where = mobile ? 'Handy' : 'PC'
    const A = await openApp(browser, PORT, { errors, mobile })
    const views = await A.state(async () => (await import('/src/ui/context.js')).visibleViews().map((v) => ({ id: v.id, label: v.label || v.id })))
    check(`${where}: Ansichten gefunden`, views.length >= 50, String(views.length))
    const bad = []
    for (const v of views) {
      const before = errors.length
      await A.view(v.id)
      // später geladene Ansicht: warten, bis der Text steht
      let t = ''
      // Werkzeuge (Wasserzähler, Objektkontrolle, Objektdoku, Mattenwechsel alt): Platzhalter, das Fenster hängt daneben
      const framed = () => A.state(() => !!document.querySelector('main .tool-slot, main iframe'))
      await A.waitFor(async () => {
        const now = await A.text('main')
        const same = (now === t && now.length > 20 && !/wird geladen/i.test(now)) || (await framed())
        t = now
        return same
      }, 12000, 250)
      const problems = []
      if (t.length <= 20 && !(await framed())) problems.push('ohne Inhalt')
      if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(t)) problems.push(`Text: ${(t.match(/.{0,30}(\bundefined\b|\bNaN\b|\[object Object\]).{0,30}/) || [''])[0]}`)
      if (errors.length > before) problems.push(`Fehler: ${errors.slice(before).join(' | ').slice(0, 200)}`)
      if (mobile) {
        const over = await A.state(() => document.documentElement.scrollWidth - window.innerWidth)
        if (over > 1) problems.push(`Querscrollen ${over} px`)
      }
      if (problems.length) bad.push(`${v.label} (${v.id}): ${problems.join('; ')}`)
    }
    check(`${where}: ${views.length} Ansichten ohne Fehler, mit Inhalt${mobile ? ', ohne Querscrollen' : ''}`, !bad.length, bad.join(' ‖ ').slice(0, 1500))
    if (bad.length) for (const b of bad) note(b)
    await A.ctx.close()
  }
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
errors.length = 0 // je Ansicht schon gewertet
await finish(browser, [server], errors)
