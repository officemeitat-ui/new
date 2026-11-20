// Daten-Startcheck: Sind die Stammdaten so weit, dass die Module arbeiten können? Reine Funktion ohne Oberfläche
// (Tests: test/startcheck.test.js); Anzeige im Systemcheck, Reiter „Daten“ (ui/views/system.js). Der Systemcheck
// selbst prüft die Technik (Webspace, Microsoft 365); hier geht es um den Inhalt: Mitarbeitende, Objekte und
// Leistungen, Fakturierung, Mattenwechsel, Unterweisungen, Schlüssel, Fahrzeuge.
//
// Jeder Punkt: { group, label, status, detail, fix, view }
//   status 'ok'    passt
//          'error' ohne das arbeitet der Bereich nicht (z. B. keine Mitarbeitenden)
//          'warn'  arbeitet, aber mit Lücken (z. B. Objekte ohne Adresse)
//          'info'  freiwillig bzw. Bereich noch nicht in Verwendung
//   view   Ansicht, in der sich der Punkt erledigen lässt

const ISO = /^\d{4}-\d{2}-\d{2}$/
const text = (v) => String(v ?? '').trim()
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** „A, B, C und 4 weitere“: höchstens max Namen, damit die Zeile lesbar bleibt. */
export function nameList(names = [], max = 4) {
  const list = names.map(text).filter(Boolean)
  if (list.length <= max) return list.join(', ')
  return `${list.slice(0, max).join(', ')} und ${plural(list.length - max, 'weitere', 'weitere')}`
}

const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

/**
 * Alle Punkte des Daten-Startchecks. data: app.data; today: 'JJJJ-MM-TT'.
 * Bereiche ohne Daten (z. B. Mattenwechsel ohne Liegeplätze) melden sich mit einem einzigen Hinweis 'info'.
 */
export function startCheck(data = {}, { today = '' } = {}) {
  const out = []
  const add = (group, label, status, detail = '', fix = '', view = '') => out.push({ group, label, status, detail, fix, view })

  // ---------------------------------------------------------------- Mitarbeitende
  const M = 'Mitarbeitende'
  const emps = (data.employees || []).filter((e) => !e.inactive && !(ISO.test(e.exitDate || '') && today && e.exitDate < today))
  if (!emps.length) add(M, 'Mitarbeitende angelegt', 'error', 'noch niemand', '„Mitarbeitende“ → „Aus Excel einfügen“ übernimmt die ganze Liste auf einmal.', 'staff')
  else {
    add(M, 'Mitarbeitende angelegt', 'ok', plural(emps.length, 'Person', 'Personen'), '', 'staff')
    const miss = (test) => emps.filter(test).map((e) => e.name)
    const line = (label, names, status, okText, fix) => add(M, label, names.length ? status : 'ok', names.length ? `fehlt bei ${names.length}: ${nameList(names)}` : okText, fix, 'staff')
    line('Wochenstunden', miss((e) => !(Number(e.weeklyHours) > 0)), 'warn', 'bei allen eingetragen', 'Ohne Wochenstunden rechnet das Zeitkonto mit 0 Stunden Soll. In „Mitarbeitende“ die Person öffnen.')
    line('Handynummer', miss((e) => !text(e.phone)), 'warn', 'bei allen eingetragen', 'Für WhatsApp und „Plan am Handy“. „Aus Excel einfügen“ mit der Spalte „Handy“ ergänzt nur die fehlenden Nummern.')
    line('Eintrittsdatum', miss((e) => !ISO.test(e.entryDate || '')), 'info', 'bei allen eingetragen', 'Für den Urlaubsanspruch im ersten Jahr und für Auswertungen.')
    line('Urlaubsanspruch', miss((e) => !(Number(e.vacationDaysYear) > 0) && !e.vacationBase), 'info', 'bei allen eingetragen', 'Ohne Angabe rechnet die App mit dem Wert aus den Regeln. Der Resturlaub zum Stichtag steht in der Spalte „Resturlaub“.')
    line('Personalnummer', miss((e) => !text(e.personnelNo)), 'info', 'bei allen eingetragen', 'Nur für den Export an die Lohnverrechnung nötig.')
  }

  // ---------------------------------------------------------------- Objekte und Leistungen
  const O = 'Objekte und Leistungen'
  const objects = (data.objects || []).filter((o) => !o.inactive)
  // beendete Leistungen (Rhythmus mit „bis“ in der Vergangenheit) zählen nicht
  const tasks = (data.tasks || []).filter((t) => !(t.recurrence?.until && today && t.recurrence.until < today) && objects.some((o) => o.id === t.objectId))
  if (!objects.length) add(O, 'Objekte angelegt', 'error', 'noch keines', '„Objekte & Leistungen“ → „Aus Excel einfügen“ legt Objekte und Leistungen aus einer Liste an.', 'sites')
  else {
    add(O, 'Objekte angelegt', 'ok', plural(objects.length, 'Objekt', 'Objekte'), '', 'sites')
    const noAddr = objects.filter((o) => !text(o.address)).map((o) => o.name)
    add(O, 'Adresse je Objekt', noAddr.length ? 'warn' : 'ok', noAddr.length ? `fehlt bei ${noAddr.length}: ${nameList(noAddr)}` : 'bei allen eingetragen', 'Die Adresse braucht es für Fahrzeiten, Wetter und die Navigation am Handy.', 'sites')
    const withTask = new Set(tasks.map((t) => t.objectId))
    const noTask = objects.filter((o) => !withTask.has(o.id)).map((o) => o.name)
    if (!tasks.length) add(O, 'Leistungen angelegt', 'error', 'noch keine', 'Ohne Leistungen bleibt der Dienstplan leer. Je Objekt „+ Leistung“ oder „Aus Excel einfügen“.', 'sites')
    else {
      add(O, 'Leistungen angelegt', 'ok', plural(tasks.length, 'Leistung', 'Leistungen'), '', 'sites')
      add(O, 'Leistung je Objekt', noTask.length ? 'warn' : 'ok', noTask.length ? `${noTask.length} ohne Leistung: ${nameList(noTask)}` : 'jedes Objekt hat mindestens eine', 'Objekte ohne Leistung erscheinen in keinem Plan. Nicht mehr betreute Objekte auf „inaktiv“ stellen.', 'sites')
      const noReg = tasks.filter((t) => !(t.regulars || []).length)
      add(O, 'Stammkraft je Leistung', noReg.length ? 'info' : 'ok', noReg.length ? `${noReg.length} von ${tasks.length} ohne Stammkraft` : 'überall eingetragen', 'Ohne Stammkraft sucht die Automatik jede Woche neu. Mit Stammkraft bleibt der Plan ruhig.', 'sites')
    }
  }

  // ---------------------------------------------------------------- Fakturierung
  const F = 'Fakturierung'
  const fak = data.fakturierung || {}
  const customers = fak.customers || []
  const used = customers.length || (fak.documents || []).length
  const sender = fak.settings?.sender || {}
  const missing = [!text(sender.name) && 'Firmenname', !text(sender.address) && 'Anschrift', !text(sender.uid) && 'UID-Nummer'].filter(Boolean)
  if (!used && missing.length === 3) add(F, 'Fakturierung', 'info', 'noch nicht in Verwendung', '', 'fakturierung')
  else {
    // rot erst, wenn die Fakturierung in Verwendung ist (Kunden oder Belege); davor ist es eine Lücke
    add(F, 'Absender auf Rechnungen', missing.length ? (used ? 'error' : 'warn') : 'ok', missing.length ? `fehlt: ${missing.join(', ')}` : text(sender.name), 'Ohne Firmenname, Anschrift und UID-Nummer ist eine Rechnung nicht gültig. „Fakturierung“ → „Einstellungen“.', 'fakturierung')
    add(F, 'Bankverbindung', text(fak.settings?.bank?.iban) ? 'ok' : 'warn', text(fak.settings?.bank?.iban) ? 'IBAN eingetragen' : 'IBAN fehlt', 'Die IBAN steht auf jeder Rechnung und im Zahlschein-Code. „Fakturierung“ → „Einstellungen“.', 'fakturierung')
    if (!customers.length) add(F, 'Kunden angelegt', 'warn', 'noch keine', '„Fakturierung“ → „Kunden“, einzeln oder über den Import.', 'fakturierung')
    else {
      add(F, 'Kunden angelegt', 'ok', plural(customers.length, 'Kunde', 'Kunden'), '', 'fakturierung')
      const noAddr = customers.filter((c) => !text(c.street) || !text(c.city)).map((c) => c.name)
      add(F, 'Anschrift je Kunde', noAddr.length ? 'warn' : 'ok', noAddr.length ? `fehlt bei ${noAddr.length}: ${nameList(noAddr)}` : 'bei allen eingetragen', 'Ohne Anschrift fehlt der Empfänger auf der Rechnung.', 'fakturierung')
      const noMail = customers.filter((c) => !text(c.email)).map((c) => c.name)
      add(F, 'E-Mail je Kunde', noMail.length ? 'info' : 'ok', noMail.length ? `fehlt bei ${noMail.length}: ${nameList(noMail)}` : 'bei allen eingetragen', 'Nur für den Versand per E-Mail nötig.', 'fakturierung')
    }
  }

  // ---------------------------------------------------------------- Mattenwechsel
  const W = 'Mattenwechsel'
  const matten = data.matten || {}
  const places = (matten.placements || []).filter((p) => p.active !== false)
  if (!places.length) add(W, 'Mattenwechsel', 'info', 'noch keine Liegeplätze', '', 'mw-liegeplaetze')
  else {
    const s = matten.settings || {}
    add(W, 'Liegeplätze angelegt', 'ok', plural(places.length, 'Liegeplatz', 'Liegeplätze'), '', 'mw-liegeplaetze')
    const noGeo = places.filter((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lon)).length
    add(W, 'Koordinaten je Liegeplatz', noGeo ? 'warn' : 'ok', noGeo ? `fehlen bei ${noGeo}` : 'bei allen vorhanden', 'Ohne Koordinaten kommt der Liegeplatz in keinen Tourvorschlag. „Matten-Liegeplätze“ → „Mehr“ → „Koordinaten für alle fehlenden suchen“.', 'mw-liegeplaetze')
    const noRhythm = places.filter((p) => !(Number(p.intervalDays) >= 1) || !ISO.test(p.startDate || '')).length
    add(W, 'Intervall und Starttermin', noRhythm ? 'warn' : 'ok', noRhythm ? `fehlen bei ${noRhythm}` : 'bei allen eingetragen', 'Ohne Intervall und Starttermin entsteht kein Einsatz. „Matten-Kalender“ → „Mehr“ → „Rhythmus je Gebiet“ setzt beides für ein ganzes Gebiet.', 'mw-kalender')
    const articles = new Map((fak.articles || []).map((a) => [a.id, a]))
    const mats = places.flatMap((p) => p.mats || [])
    const noType = mats.filter((m) => !m.articleId || !articles.has(m.articleId)).length
    add(W, 'Mattentyp je Matte', noType ? 'warn' : 'ok', noType ? `fehlt bei ${plural(noType, 'Zeile', 'Zeilen')}` : 'überall zugeordnet', 'Ohne Mattentyp fehlt der Preis in der Abrechnung. Den Liegeplatz öffnen und den Typ wählen.', 'mw-liegeplaetze')
    const free = [...new Set(mats.map((m) => m.articleId).filter((id) => articles.has(id) && !(Number(articles.get(id).price) > 0)))]
    add(W, 'Preis je Mattentyp', free.length ? 'warn' : 'ok', free.length ? `${plural(free.length, 'Mattentyp', 'Mattentypen')} ohne Preis: ${nameList(free.map((id) => articles.get(id).name))}` : 'überall eingetragen', 'Ohne Preis rechnet die Mattenabrechnung mit 0 Euro. „Fakturierung“ → „Mattentypen“.', 'fakturierung')
    add(W, 'Betriebshof', Number.isFinite(s.depot?.lat) ? 'ok' : 'warn', Number.isFinite(s.depot?.lat) ? text(s.depot.name) || 'eingetragen' : 'fehlt', 'Der Betriebshof ist Start und Ziel jeder Tour. „Matten-Tourenplanung“ → „Betriebshof eintragen“.', 'mw-planung')
    const drivers = (s.drivers || []).filter((d) => d.active !== false)
    if (!drivers.length) add(W, 'Fahrer', 'warn', 'noch keine', '„Matten-Tourenplanung“ → „Mehr“ → „Fahrer“.', 'mw-planung')
    else {
      const blind = drivers.filter((d) => !text(d.email) && !d.webspace).map((d) => d.name)
      add(W, 'Fahrer', blind.length ? 'warn' : 'ok', blind.length ? `${plural(drivers.length, 'Fahrer', 'Fahrer')}; ohne E-Mail: ${nameList(blind)}` : plural(drivers.length, 'Fahrer', 'Fahrer'), 'Ohne E-Mail erkennt die App die Tour am Handy nicht als die des Fahrers. Fahrer ohne Microsoft-Konto bekommen die Fahrerseite am Webspace.', 'mw-planung')
    }
    const until = text(s.planning?.bis)
    const enough = until && today && until >= addDays(today, 14)
    add(W, 'Einsätze geplant', enough ? 'ok' : 'warn', until ? `bis ${until.slice(8, 10)}.${until.slice(5, 7)}.${until.slice(0, 4)}` : 'noch nie', 'Im „Matten-Kalender“ auf „Einsätze planen“ klicken; die App plant acht Wochen voraus.', 'mw-kalender')
    add(W, 'Büro-Adresse für Lieferscheine', text(s.officeEmail) ? 'ok' : 'info', text(s.officeEmail) || 'nicht eingetragen', 'Nur für den Versand „An Büro“. „Matten-Lieferscheine“ → „Einstellungen“.', 'mw-lieferscheine')
  }

  // ---------------------------------------------------------------- Sicherheit, Schlüssel, Fuhrpark
  const X = 'Unterweisungen, Schlüssel, Fahrzeuge'
  // Arten sind vorgegeben (core/trainings.js); gefragt ist, ob schon Nachweise da sind
  const records = data.unterweisungen?.records || []
  add(X, 'Unterweisungen', records.length ? 'ok' : 'info', records.length ? plural(records.length, 'Nachweis', 'Nachweise') : 'noch kein Nachweis', 'Vorhandene Nachweise übernimmt „Unterweisungen“ → „Aus Excel einfügen“ auf einmal.', 'unterweisungen')
  const keys = data.schluessel?.keys || []
  add(X, 'Schlüsselbuch', keys.length ? 'ok' : 'info', keys.length ? plural(keys.length, 'Schlüssel', 'Schlüssel') : 'noch leer', '', 'schluessel')
  const vehicles = (data.fahrzeuge?.vehicles || []).filter((v) => !v.inactive)
  add(X, 'Fahrzeuge', vehicles.length ? 'ok' : 'info', vehicles.length ? plural(vehicles.length, 'Fahrzeug', 'Fahrzeuge') : 'noch keine', '', 'fahrzeuge')
  return out
}

/** Zähler je Status und die Zeile für den Kopf: „2 Punkte fehlen, 5 Hinweise“ bzw. „Die Daten sind startklar.“ */
export function startSummary(items = []) {
  const count = (s) => items.filter((x) => x.status === s).length
  const error = count('error')
  const warn = count('warn')
  const text = error
    ? `${plural(error, 'Punkt fehlt', 'Punkte fehlen')} noch${warn ? `, dazu ${plural(warn, 'Lücke', 'Lücken')}` : ''}.`
    : warn
      ? `Die Daten reichen für den Start; ${plural(warn, 'Lücke', 'Lücken')} noch schließen.`
      : 'Die Daten sind startklar.'
  return { error, warn, info: count('info'), ok: count('ok'), text }
}

/** Bericht als Text (für „Bericht kopieren“). */
export const startReport = (items = []) => items.map((x) => `[${{ ok: 'passt', error: 'fehlt', warn: 'Lücke', info: 'Hinweis' }[x.status] || x.status}] ${x.group} · ${x.label}: ${x.detail}`).join('\n')
