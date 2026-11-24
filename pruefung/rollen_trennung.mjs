// Trennung der Rollen im SharePoint-Betrieb (Graph-Attrappe), für alle eingebauten Rollen:
//  - jede Rolle liest und schreibt nur Dateien, die ihr die Rechte der Ablage erlauben (dataRights) – gemessen an den
//    tatsächlichen Anfragen an das Laufwerk, nachdem alle sichtbaren Ansichten einmal geöffnet wurden;
//  - Ansichten des Bereichs „Objekte, Regeln & Berechtigungen“ sieht nur der Vollzugriff;
//  - die Personalverwaltung sieht „Mitarbeitende“, aber nicht Objekte, Regeln und Berechtigungen;
//  - versteckte Ansichten sind auch über die Adresszeile (#ansicht) nicht erreichbar.
// Port 19803.
import { chromium, check, finish, note, sharepoint, startServer, wait, mondayOf, todayVienna } from './ablauf-lib.mjs'

const PORT = 19803
const server = startServer(PORT)
await wait(800)
const browser = await chromium.launch()
const errors = []
try {
  const { DEFAULT_ROLES, resolveAccess } = await import('../src/core/access.js')
  const { dataRights, OLD_PATHS, splitData } = await import('../src/storage/data-service.js')
  const { createDemoData } = await import('../src/data/demo.js')
  const docs = splitData(createDemoData(mondayOf(todayVienna())), [])
  const roles = Object.keys(DEFAULT_ROLES)
  check('15 eingebaute Rollen', roles.length === 15, roles.join(', '))
  let allViews = []
  const summary = []
  for (const role of roles) {
    const email = role === 'disposition' ? 'office@cleanos.at' : 'rolle@cleanos.at'
    const SP = sharepoint({ access: { planners: ['office@cleanos.at'], members: role === 'disposition' ? {} : { [role]: [email] } } })
    SP.seed(docs)
    const rights = dataRights(resolveAccess({ email, access: SP.config.access }))
    const before = errors.length
    const X = await SP.open(browser, PORT, { email, name: `Rolle ${DEFAULT_ROLES[role].label}`, errors })
    const info = await X.state(async () => {
      const c = await import('/src/ui/context.js')
      return { roles: c.app.access?.roles || [], all: !!c.app.access?.all, views: c.visibleViews().map((v) => ({ id: v.id, module: c.moduleOf(v) })) }
    })
    if (role === 'disposition') allViews = info.views.map((v) => v.id)
    check(`${role}: als diese Rolle angemeldet`, role === 'disposition' ? info.all : info.roles.includes(role) && !info.all, JSON.stringify(info.roles))
    // alle sichtbaren Ansichten einmal öffnen (lädt, was die Rolle laden darf)
    for (const v of info.views) {
      await X.view(v.id)
      await wait(120)
    }
    await wait(1500)
    // Anfragen an das Laufwerk gegen die Rechte der Ablage
    const rel = (p) => p.replace(/^\/drives\/drive1\/root:\/Plattform\//, '').replace(/:\/(children|content)$/, '').replace(/:$/, '')
    const inApp = SP.drive.log.filter((x) => x.p.startsWith('/drives/drive1/root:/Plattform/'))
    // frühere Ablage der Wochen (daten/plaene/…) gilt wie die heutige (plaene/…)
    const norm = (p) => p.replace(/^daten\/plaene\//, 'plaene/')
    const mayRead = (p) => rights.read(norm(p)) || rights.read(`${norm(p)}/x`)
    const badRead = [...new Set(inApp.filter((x) => x.method === 'GET' && !mayRead(rel(x.p))).map((x) => rel(x.p)))]
    // Aufräumen der früheren Ablage (daten/abwesenheiten.json, daten/zeitkonto.json): löschen darf, wer die heutige Datei schreibt
    const oldCleanup = (x) => x.method === 'DELETE' && Object.entries(OLD_PATHS).some(([now, was]) => was === rel(x.p) && rights.write(now))
    const badWrite = [...new Set(inApp.filter((x) => ['PUT', 'DELETE', 'POST', 'PATCH'].includes(x.method) && !oldCleanup(x) && !rights.write(norm(rel(x.p))) && !rights.write(`${norm(rel(x.p))}/x`)).map((x) => `${x.method} ${rel(x.p)}`))]
    check(`${role}: liest nur Erlaubtes`, !badRead.length, badRead.slice(0, 8).join(', '))
    check(`${role}: schreibt nur Erlaubtes`, !badWrite.length, badWrite.slice(0, 8).join(', '))
    const admin = info.views.filter((v) => v.module === 'verwaltung').map((v) => v.id)
    if (role === 'disposition') check('Vollzugriff sieht den Bereich „Objekte, Regeln & Berechtigungen“', ['sites', 'rules', 'berechtigungen'].every((id) => admin.includes(id)), admin.join(', '))
    else check(`${role}: keine Ansicht aus „Objekte, Regeln & Berechtigungen“`, !admin.length, admin.join(', '))
    if (role === 'personalverwaltung') check('Personalverwaltung: „Mitarbeitende“ ja, Objekte, Regeln und Berechtigungen nein', info.views.some((v) => v.id === 'staff') && !info.views.some((v) => ['sites', 'rules', 'berechtigungen', 'assign'].includes(v.id)), info.views.map((v) => v.id).join(', '))
    // versteckte Ansichten über die Adresszeile
    const hidden = allViews.filter((id) => !info.views.some((v) => v.id === id))
    const reached = []
    for (const id of hidden) {
      // die App nimmt die Adresse an und fällt beim Zeichnen auf eine erlaubte Ansicht zurück (bei später geladenen
      // Bereichen erst nach deren Laden): bis zu 3 Sekunden warten, ob sie die versteckte Ansicht verlässt
      const now = await X.state(async (v) => {
        const c = await import('/src/ui/context.js')
        location.hash = `#${v}`
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 50))
          if (c.app.ui.view !== v) break
        }
        return c.app.ui.view
      }, id)
      if (now === id) reached.push(id)
    }
    if (role !== 'disposition') check(`${role}: ${hidden.length} versteckte Ansichten über die Adresszeile nicht erreichbar`, hidden.length > 0 && !reached.length, reached.join(', '))
    check(`${role}: keine Fehler im Browser`, errors.length === before, errors.slice(before).join(' | ').slice(0, 400))
    summary.push(`${DEFAULT_ROLES[role].label}: ${info.views.length} Ansichten, ${new Set(inApp.filter((x) => x.method === 'GET').map((x) => rel(x.p))).size} Dateien gelesen`)
    if (SP.drive.unknown.length) note(`${role}: nicht nachgebildete Anfragen: ${[...new Set(SP.drive.unknown)].slice(0, 5).join(' | ')}`)
    await X.ctx.close()
  }
  for (const s of summary) note(s)
} catch (err) {
  check('Ablauf ohne Ausnahme', false, String(err?.stack || err).slice(0, 900))
}
errors.length = 0 // je Rolle schon gewertet
await finish(browser, [server], errors)
