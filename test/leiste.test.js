// Leiste unten am Handy (src/ui/leiste.js): Vorgabe je Rolle, Vorgabe des Büros aus config.json,
// eigene Wahl je Konto, Rechte-Filter, höchstens 4 Plätze, kurze Beschriftungen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ROLES, resolveAccess, roleOptions } from '../src/core/access.js'
import { ABSENCE, accountKey, defaultSlots, leisteSlots, MAX_SLOTS, moveSlot, ownViews, PLAN_DEFAULT, ROLE_DEFAULTS, sameSlots, sectionLabels, setSlot, SHORT_LABELS, storeChoice, validSlot, viewLabels } from '../src/ui/leiste.js'

const v = (id, module, section, extra = {}) => ({ id, module, section, ...extra })
const GENERAL = [v('home', '*', 'start', { mobile: true }), v('assistenz', '*', 'start'), v('kennzahlen', '*', 'start'), v('anleitung', '*', 'start')]
const PLAN = [v('week', 'planung', 'planung'), v('coverage', 'planung', 'planung'), v('absences', 'planung', 'planung'), v('sheet', 'planung', 'einsatz')]
const FIN = [v('fakturierung', 'fakturierung', 'finanzen'), v('einkauf', 'einkauf', 'finanzen'), v('kassenbuch', 'einkauf', 'finanzen'), v('umsatzsteuer', '*', 'finanzen')]
const TOOLS = [v('zaehler', 'zaehler', 'objekte'), v('kontrolle', 'kontrolle', 'objekte'), v('objektmappe', 'objektmappe', 'objekte'), v('matten', 'matten', 'objekte')]
const ALL = [...GENERAL, ...PLAN, ...FIN, ...TOOLS, v('material', 'material', 'betrieb')]

test('Vorgabe mit Einsatzplanung: Woche, Vertretung, „+ Abwesend“, Zettel (wie bisher)', () => {
  assert.deepEqual(defaultSlots({ views: ALL, roles: ['disposition'], absence: true }), PLAN_DEFAULT)
  assert.deepEqual(defaultSlots({ views: ALL, roles: ['disposition'], absence: true }), ['week', 'coverage', ABSENCE, 'sheet'])
  // Objektleitung, „Nur lesen“: sehen die Planung, dürfen keine Abwesenheit eintragen
  assert.deepEqual(defaultSlots({ views: [...GENERAL, ...PLAN, ...TOOLS], roles: ['objektleitung'], absence: false }), ['week', 'coverage', 'sheet'])
  // mehrere Rollen, eine mit Planung: die Planungs-Vorgabe
  assert.deepEqual(defaultSlots({ views: [...GENERAL, ...PLAN, ...TOOLS], roles: ['lesen', 'ableser'] }), ['week', 'coverage', 'sheet'])
})

test('Vorgabe ohne Einsatzplanung: nur die eigenen Bereiche, nichts Allgemeines', () => {
  const only = (roles, views) => defaultSlots({ views: [...GENERAL, ...views], roles })
  assert.deepEqual(only(['ableser'], [TOOLS[0]]), ['zaehler'])
  assert.deepEqual(only(['vorarbeiter'], [TOOLS[0]]), ['zaehler'])
  assert.deepEqual(only(['mattenwechsel'], [TOOLS[3]]), ['matten'])
  assert.deepEqual(only(['pruefer'], [TOOLS[1], TOOLS[2]]), ['kontrolle', 'objektmappe'])
  assert.deepEqual(only(['buchhaltung'], FIN), ['fakturierung', 'einkauf', 'kassenbuch', 'umsatzsteuer'])
  assert.deepEqual(only(['lager'], [v('material', 'material', 'betrieb')]), ['material'])
  // mehrere Rollen addieren sich, jeder Platz einmal
  assert.deepEqual(only(['ableser', 'pruefer', 'vorarbeiter'], TOOLS.slice(0, 3)), ['zaehler', 'kontrolle', 'objektmappe'])
  // was die Rolle nicht sieht, fehlt (z. B. Werkzeuge in config.json ausgeschaltet): dann die Übersicht
  assert.deepEqual(only(['ableser'], []), ['home'])
})

test('Eigene Rolle aus config.json: ihre eigenen Ansichten, mit Handy-Eintrag zuerst, höchstens 4', () => {
  const views = [...GENERAL, v('schluessel', 'schluessel', 'objekte'), v('zaehler', 'zaehler', 'objekte'), v('anlagen', 'anlagen', 'objekte', { mobile: true }), v('regie', 'regie', 'objekte', { mobile: true }), v('reklamationen', 'reklamationen', 'objekte')]
  assert.deepEqual(defaultSlots({ views, roles: ['hausbetreuung'] }), ['anlagen', 'regie', 'schluessel', 'zaehler'])
  assert.deepEqual(ownViews(views).slice(0, 2), ['anlagen', 'regie'])
  assert.ok(!ownViews(views).some((id) => ['home', 'kennzahlen', 'anleitung', 'assistenz'].includes(id)))
  // eingebaute plus eigene Rolle: erst die Vorgabe der eingebauten, dann die eigenen Ansichten
  assert.deepEqual(defaultSlots({ views, roles: ['ableser', 'hausbetreuung'] }), ['zaehler', 'anlagen', 'regie', 'schluessel'])
})

test('Vorgabe des Büros (config.json → access.roles.<rolle>.leiste) vor der Vorgabe der Rolle', () => {
  const roleConfig = { disposition: { leiste: ['sec:finanzen', 'zaehler', 'kontrolle', 'objektmappe', 'material'] }, ableser: { leiste: ['fakturierung'] } }
  assert.deepEqual(defaultSlots({ views: ALL, roles: ['disposition'], roleConfig, absence: true }), ['sec:finanzen', 'zaehler', 'kontrolle', 'objektmappe'], 'höchstens 4')
  // Ableser sieht die Fakturierung nicht: Büro-Vorgabe leer → Vorgabe der Rolle
  assert.deepEqual(defaultSlots({ views: [...GENERAL, TOOLS[0]], roles: ['ableser'], roleConfig }), ['zaehler'])
  // kaputte Angaben stören nicht
  assert.deepEqual(defaultSlots({ views: ALL, roles: ['disposition'], roleConfig: { disposition: { leiste: 'zaehler' } }, absence: true }), PLAN_DEFAULT)
  assert.deepEqual(defaultSlots({ views: ALL, roles: ['disposition'], roleConfig: { disposition: { leiste: [null, 7, '', 'gibtsnicht', 'zaehler', 'zaehler'] } } }), ['zaehler'])
})

test('Eigene Wahl: gilt vor allem, ungültige Plätze fallen still heraus und die Vorgabe füllt auf', () => {
  const input = { views: ALL, roles: ['disposition'], absence: true }
  const mine = ['sec:finanzen', 'zaehler', 'kontrolle', 'objektmappe']
  assert.deepEqual(leisteSlots({ ...input, choice: mine }), mine)
  assert.deepEqual(leisteSlots({ ...input, choice: null }), PLAN_DEFAULT)
  assert.deepEqual(leisteSlots({ ...input, choice: [] }), PLAN_DEFAULT, 'leer = Vorgabe')
  assert.deepEqual(leisteSlots({ ...input, choice: ['zaehler', 'fakturierung', 'material', 'kontrolle', 'objektmappe', 'week'] }), ['zaehler', 'fakturierung', 'material', 'kontrolle'], 'höchstens 4')
  // dieselbe Wahl, jetzt als Prüfer/in: Finanzen und Wasserzähler fallen weg, aufgefüllt mit der Vorgabe der Rolle
  const pruefer = { views: [...GENERAL, TOOLS[1], TOOLS[2]], roles: ['pruefer'] }
  assert.deepEqual(leisteSlots({ ...pruefer, choice: mine }), ['kontrolle', 'objektmappe'])
  // auffüllen nur bis zur gewählten Zahl
  assert.deepEqual(leisteSlots({ ...input, choice: ['gibtsnicht', 'zaehler'] }), ['zaehler', 'week'])
  // „+ Abwesend“ nur mit Planungsrecht
  assert.deepEqual(leisteSlots({ ...input, absence: false, choice: [ABSENCE, 'zaehler'] }), ['zaehler', 'week'])
  assert.deepEqual(leisteSlots({ ...input, choice: ['zaehler', ABSENCE, 'kontrolle'] }), ['zaehler', ABSENCE, 'kontrolle'], 'Reihenfolge bleibt')
})

test('Plätze: Ansicht, Bereich, „+ Abwesend“', () => {
  const ctx = { views: ALL, absence: true }
  assert.ok(validSlot('zaehler', ctx) && validSlot('home', ctx) && validSlot('sec:finanzen', ctx) && validSlot(ABSENCE, ctx))
  assert.ok(!validSlot('sec:start', ctx), 'kein Bereich „Start“')
  assert.ok(!validSlot('sec:verwaltung', ctx), 'Bereich ohne sichtbare Ansicht')
  assert.ok(!validSlot(ABSENCE, { views: ALL }), 'ohne Planungsrecht')
  assert.ok(!validSlot('payroll', ctx) && !validSlot(undefined, ctx) && !validSlot({}, ctx))
})

test('Bearbeiten: jeden Platz einzeln tauschen, leeren, anhängen, keine Doppel, verschieben mit Pfeilen', () => {
  // „Abwesend“ (Platz 3) lange drücken → Wasserzähler
  assert.deepEqual(setSlot(PLAN_DEFAULT, 2, 'zaehler'), ['week', 'coverage', 'zaehler', 'sheet'])
  assert.deepEqual(setSlot(PLAN_DEFAULT, 0, 'sec:finanzen'), ['sec:finanzen', 'coverage', ABSENCE, 'sheet'])
  assert.deepEqual(setSlot(PLAN_DEFAULT, 1, 'week'), PLAN_DEFAULT, 'schon auf Platz 1: keine Doppel')
  assert.deepEqual(setSlot(PLAN_DEFAULT, 1, 'coverage'), PLAN_DEFAULT, 'derselbe Platz: nichts ändert sich')
  assert.deepEqual(setSlot(PLAN_DEFAULT, 1, ''), ['week', ABSENCE, 'sheet'], 'leer: die übrigen rücken nach links')
  assert.deepEqual(setSlot(['zaehler'], 3, 'kontrolle'), ['zaehler', 'kontrolle'], 'freier Platz rechts: hängt an')
  assert.deepEqual(setSlot(['zaehler'], 2, null), ['zaehler'])
  assert.deepEqual(setSlot(PLAN_DEFAULT, 4, 'zaehler'), PLAN_DEFAULT, 'nur 4 Plätze')
  assert.deepEqual(setSlot(PLAN_DEFAULT, -1, 'zaehler'), PLAN_DEFAULT)
  let list = []
  for (const [i, s] of ['zaehler', 'sec:finanzen', 'kontrolle', 'objektmappe', 'material'].entries()) list = setSlot(list, i, s)
  assert.deepEqual(list, ['zaehler', 'sec:finanzen', 'kontrolle', 'objektmappe'], 'der fünfte passt nicht mehr')
  assert.equal(list.length, MAX_SLOTS)
  list = setSlot(list, 3, '')
  assert.deepEqual(list, ['zaehler', 'sec:finanzen', 'kontrolle'])
  assert.deepEqual(moveSlot(list, 'sec:finanzen', -1), ['sec:finanzen', 'zaehler', 'kontrolle'])
  assert.deepEqual(moveSlot(list, 'kontrolle', 1), list, 'ganz rechts bleibt rechts')
  assert.deepEqual(moveSlot(list, 'zaehler', -1), list, 'ganz links bleibt links')
  assert.deepEqual(moveSlot(list, 'gibtsnicht', 1), list)
  assert.ok(sameSlots(['a', 'b'], ['a', 'b']) && !sameSlots(['a', 'b'], ['b', 'a']))
})

test('Gespeichert je Gerät und Konto: E-Mail im Schlüssel, Vorgabe nicht gespeichert', () => {
  const office = accountKey({ email: ' Office@Cleanos.at ' })
  assert.equal(office, 'konto:office@cleanos.at')
  assert.notEqual(accountKey({ email: 'max@cleanos.at' }), office, 'geteiltes Handy: getrennt je Konto')
  assert.equal(accountKey({ email: 'max@cleanos.at', previewRole: 'ableser' }), 'konto:max@cleanos.at', 'angemeldet zählt das Konto')
  assert.equal(accountKey({ previewRole: 'ableser' }), 'vorschau:ableser')
  assert.equal(accountKey({}), 'vorschau:disposition')
  let store = storeChoice({ 'konto:max@cleanos.at': ['zaehler'] }, office, ['sec:finanzen', 'zaehler'], PLAN_DEFAULT)
  assert.deepEqual(store, { 'konto:max@cleanos.at': ['zaehler'], [office]: ['sec:finanzen', 'zaehler'] })
  store = storeChoice(store, office, [...PLAN_DEFAULT], PLAN_DEFAULT)
  assert.deepEqual(store, { 'konto:max@cleanos.at': ['zaehler'] }, 'gleich der Vorgabe: Eintrag weg')
  assert.deepEqual(storeChoice(undefined, office, null, PLAN_DEFAULT), {}, 'zurücksetzen')
})

test('Beschriftung: Handy-Name, sonst voller Name mit kurzem für zu wenig Platz', () => {
  assert.deepEqual(viewLabels({ id: 'home', label: 'Übersicht', mobile: { label: 'Start' } }), { text: 'Start', short: null })
  assert.deepEqual(viewLabels({ id: 'zaehler', label: 'Wasserzähler' }), { text: 'Wasserzähler', short: 'Zähler' })
  assert.deepEqual(viewLabels({ id: 'kontrolle', label: 'Objektkontrolle' }), { text: 'Objektkontrolle', short: 'Kontrolle' })
  assert.deepEqual(viewLabels({ id: 'material', label: 'Material & Lager' }), { text: 'Material & Lager', short: 'Material' })
  assert.deepEqual(viewLabels({ id: 'einkauf', label: 'Einkauf' }), { text: 'Einkauf', short: null })
  assert.deepEqual(viewLabels({ id: 'week', label: 'Wochenübersicht' }), { text: 'Woche', short: null }, 'Planungs-Knöpfe wie seit jeher')
  assert.deepEqual(viewLabels({ id: 'eigene', label: 'Eine sehr lange Ansicht' }), { text: 'Eine sehr lange Ansicht', short: null }, 'nichts Kürzeres: CSS kürzt mit …')
  assert.deepEqual(sectionLabels('finanzen', 'Finanzen'), { text: 'Finanzen', short: null })
  assert.deepEqual(sectionLabels('einsatz', 'Einsätze & Zeiten'), { text: 'Einsätze & Zeiten', short: 'Einsätze' })
  for (const [id, label] of Object.entries(SHORT_LABELS)) assert.ok(label.length <= 11, `${id}: „${label}“ zu lang für 390 px`)
})

test('Rollen aus config.json: nur „leiste“ ergänzt, Bereiche und Rechte der eingebauten Rolle bleiben', () => {
  const access = { roles: { ableser: { leiste: ['zaehler'] }, buchhaltung: { label: 'Buchhaltung (Büro)', leiste: ['sec:finanzen'] } } }
  const a = resolveAccess({ preview: 'ableser', access })
  assert.ok(a.sees('zaehler') && a.canEdit('zaehler') && a.label === 'Ableser')
  const b = resolveAccess({ preview: 'buchhaltung', access })
  assert.ok(b.canEdit('fakturierung') && b.label === 'Buchhaltung (Büro)')
  assert.deepEqual(roleOptions(access).find(([id]) => id === 'ableser'), ['ableser', 'Ableser'])
})

// ---------------------------------------------------------------- mit den echten Ansichten der App

test('Echte Ansichten: Vorgabe jeder eingebauten Rolle passt zu ihren Rechten, Beschriftungen kurz', async () => {
  const noop = () => {}
  const el = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop }, append: noop, setAttribute: noop, addEventListener: noop })
  globalThis.window ??= globalThis
  globalThis.addEventListener ??= noop
  globalThis.localStorage ??= { getItem: () => null, setItem: noop, removeItem: noop }
  globalThis.document ??= { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: el, head: el(), body: el(), documentElement: el() }
  const timers = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval }
  globalThis.setTimeout = (...args) => timers.setTimeout(...args).unref()
  globalThis.setInterval = (...args) => timers.setInterval(...args).unref()
  try {
    const ctx = await import('../src/ui/context.js')
    await import('../src/ui/views/index.js')
    ctx.app.config = { access: {} }
    const input = () => ({ views: ctx.navSections(ctx.visibleViews()).flatMap((s) => s.views.map((x) => ({ id: x.id, module: ctx.moduleOf(x), section: s.id, mobile: !!x.mobile }))), roles: ctx.app.access.roles, absence: ctx.canEdit('planung') })
    const general = new Set(['home', 'assistenz', 'kennzahlen', 'anleitung'])
    for (const role of Object.keys(DEFAULT_ROLES)) {
      ctx.app.access = resolveAccess({ preview: role })
      const visible = new Set(ctx.visibleViews().map((x) => x.id))
      const slots = defaultSlots(input())
      assert.ok(slots.length >= 1 && slots.length <= MAX_SLOTS, `${role}: ${slots}`)
      if (visible.has('week')) assert.deepEqual(slots.filter((s) => s !== ABSENCE), ['week', 'coverage', 'sheet'], role)
      else assert.ok(!slots.some((s) => general.has(s)), `${role}: nichts Allgemeines (${slots})`)
      // jede eingebaute Vorgabe nennt nur Ansichten, die es gibt und die die Rolle sieht
      for (const id of ROLE_DEFAULTS[role] || []) assert.ok(visible.has(id), `${role}: Vorgabe „${id}“ nicht sichtbar`)
    }
    ctx.app.access = resolveAccess({ preview: 'ableser' })
    assert.deepEqual(defaultSlots(input()), ['zaehler'])
    ctx.app.access = resolveAccess({ preview: 'disposition' })
    assert.deepEqual(defaultSlots(input()), PLAN_DEFAULT)
    // bei 4 Plätzen (fünf Knöpfe auf 390 px) gibt es für jede Ansicht einen Namen mit höchstens 11 Zeichen
    const fits = ({ text, short }) => (short || text).length <= 11
    for (const view of ctx.VIEWS) assert.ok(fits(viewLabels(view)), `${view.id}: „${JSON.stringify(viewLabels(view))}“ zu lang`)
    for (const [id, label] of ctx.NAV_SECTIONS.filter(([id]) => id !== 'start')) assert.ok(fits(sectionLabels(id, label)), id)
  } finally {
    Object.assign(globalThis, timers)
  }
})
