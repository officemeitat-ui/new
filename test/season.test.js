// Cleo: Jahreszeiten-Looks (Datum → Anlass), Posen, Kostüme und Plaudern über Saison und Leistungen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { easter, firstAdvent, pickSeason, seasonOn, SEASONS, viennaDay } from '../src/core/season.js'
import { cleo, cleoIcon, MOODS, moodFor, OUTFITS, SERVICES } from '../src/ui/mascot.js'
import { smalltalk } from '../src/help/match.js'

test('Ostersonntag: bekannte Jahre', () => {
  assert.equal(easter(2024), '2024-03-31')
  assert.equal(easter(2025), '2025-04-20')
  assert.equal(easter(2026), '2026-04-05')
  assert.equal(easter(2027), '2027-03-28')
  assert.equal(easter(2038), '2038-04-25')
  assert.equal(easter(2008), '2008-03-23')
})

test('1. Adventsonntag', () => {
  assert.equal(firstAdvent(2025), '2025-11-30')
  assert.equal(firstAdvent(2026), '2026-11-29')
  assert.equal(firstAdvent(2027), '2027-11-28')
  assert.equal(firstAdvent(2028), '2028-12-03')
})

test('Anlass nach Datum', () => {
  const cases = [
    ['2026-10-23', ''],
    ['2026-10-24', 'halloween'],
    ['2026-10-31', 'halloween'],
    ['2026-11-01', 'halloween'],
    ['2026-11-02', ''],
    ['2026-11-11', 'fasching'],
    ['2026-11-28', ''],
    ['2026-11-29', 'advent'],
    ['2026-12-24', 'advent'],
    ['2026-12-26', 'advent'],
    ['2026-12-27', 'silvester'],
    ['2026-12-31', 'silvester'],
    ['2027-01-01', 'silvester'],
    ['2027-01-06', 'silvester'],
    ['2027-01-07', ''],
    ['2027-02-04', 'fasching'], // Unsinniger Donnerstag (Ostern 28.3.)
    ['2027-02-09', 'fasching'], // Faschingsdienstag
    ['2027-02-10', ''], // Aschermittwoch
    ['2027-03-15', 'fruehjahr'],
    ['2027-03-21', 'ostern'], // Palmsonntag
    ['2027-03-29', 'ostern'], // Ostermontag
    ['2027-03-30', 'fruehjahr'],
    ['2027-04-20', 'fruehjahr'],
    ['2027-04-21', ''],
    ['2026-07-15', ''],
  ]
  for (const [day, want] of cases) assert.equal(seasonOn(day), want, day)
})

test('Jeder Tag eines Jahres hat höchstens einen gültigen Anlass', () => {
  let d = new Date(Date.UTC(2026, 0, 1))
  for (let i = 0; i < 730; i++) {
    const s = seasonOn(d.toISOString().slice(0, 10))
    assert.ok(s === '' || SEASONS[s], s)
    d = new Date(d.getTime() + 86400000)
  }
})

test('Wiener Datum statt Gerätezeit', () => {
  assert.equal(viennaDay(new Date('2026-10-23T22:30:00Z')), '2026-10-24', 'kurz nach Mitternacht in Wien')
  assert.equal(viennaDay(new Date('2026-07-01T21:59:00Z')), '2026-07-01', 'Sommerzeit: 23:59 in Wien')
})

test('Auswahl: aus, Vorschau, ?saison=', () => {
  assert.equal(pickSeason({ day: '2026-10-31' }), 'halloween')
  assert.equal(pickSeason({ day: '2026-10-31', pref: 'aus' }), '')
  assert.equal(pickSeason({ day: '2026-07-01', pref: 'ostern' }), 'ostern', 'Vorschau über die Einstellung')
  assert.equal(pickSeason({ day: '2026-07-01', query: 'advent' }), 'advent', 'Vorschau über die Adresse')
  assert.equal(pickSeason({ day: '2026-10-31', pref: 'aus', query: 'silvester' }), 'silvester', 'Adresse geht vor')
  assert.equal(pickSeason({ day: '2026-10-31', query: 'quatsch' }), '')
})

test('Jeder Anlass hat Kostüm, Pose und Gruß', () => {
  for (const [id, s] of Object.entries(SEASONS)) {
    assert.ok(OUTFITS.includes(s.outfit), `${id}: Kostüm`)
    assert.ok(MOODS.includes(s.mood), `${id}: Pose`)
    assert.ok(s.label && s.hello, `${id}: Texte`)
  }
})

test('Cleo: jede Pose und jedes Kostüm ergibt gültiges SVG ohne doppelte Attribute und ohne ids', () => {
  const combos = [...MOODS.map((m) => [m, '']), ...OUTFITS.map((o) => ['hallo', o])]
  for (const [mood, outfit] of combos) {
    const s = cleo({ mood, outfit, size: 80 })
    assert.match(s, new RegExp(`class="cleo cleo-${mood}`), mood)
    assert.equal((s.match(/<svg/g) || []).length, 1)
    assert.ok(!/\sid="/.test(s), `${mood}: keine ids`)
    assert.ok(!/NaN|undefined/.test(s), `${mood}/${outfit}: keine kaputten Werte`)
    for (const tag of s.match(/<[a-z]+\s[^>]*>/g) || []) {
      const names = [...tag.matchAll(/\s([a-z-]+)="/g)].map((x) => x[1])
      assert.equal(new Set(names).size, names.length, `${mood}/${outfit}: doppeltes Attribut in ${tag.slice(0, 80)}`)
    }
  }
  assert.match(cleo({ mood: 'gibtsnicht' }), /cleo-hallo/, 'unbekannte Pose → hallo')
  assert.match(cleo({ mood: 'bau' }), /cleo-helm/, 'Bau: Helm')
  assert.match(cleo({ mood: 'tatort', outfit: 'nikolaus' }), /cleo-schutz/, 'Schutzanzug geht vor Saison')
  assert.match(cleo({ label: 'Cleo "der" Held' }), /aria-label="Cleo &quot;der&quot; Held"/)
  assert.match(cleoIcon(), /class="cleo-icon"/)
})

test('Cleo: alle Leistungen haben eine Pose (kein Autowaschen)', () => {
  assert.ok(SERVICES.length >= 18)
  for (const [mood, label] of SERVICES) assert.ok(MOODS.includes(mood), label)
  assert.ok(!MOODS.some((m) => /auto|wasch/.test(m)))
  for (const need of ['tatort', 'event', 'graffiti', 'pv', 'tiefgarage', 'bau', 'glas', 'sanitaer', 'schnee', 'gruen']) assert.ok(MOODS.includes(need), need)
})

test('moodFor: Nacht, Schnee, Saison, offene Punkte', () => {
  assert.equal(moodFor({ hour: 23 }), 'schlaeft')
  assert.equal(moodFor({ hour: 10, snow: true }), 'schnee')
  assert.equal(moodFor({ hour: 10, season: 'kuerbis', open: 3 }), 'kuerbis')
  assert.equal(moodFor({ hour: 10, open: 2 }), 'liste')
  assert.equal(moodFor({ hour: 10 }), 'daumen')
})

test('Plaudern: Saison und Leistungen, ohne echte Fragen zu kapern', () => {
  assert.equal(smalltalk('Halloween')?.mood, 'kuerbis')
  assert.equal(smalltalk('Cleo, was ziehst du zu Weihnachten an?')?.mood, 'geschenk')
  assert.match(smalltalk('Fasching')?.text || '', /Darstellung/)
  assert.equal(smalltalk('Ist Ostermontag ein Feiertag?'), null)
  assert.equal(smalltalk('Ostern Zuschlag'), null)
  assert.equal(smalltalk('Tatortreinigung')?.mood, 'tatort')
  assert.equal(smalltalk('Was reinigt ihr alles?')?.mood, 'stark')
  assert.equal(smalltalk('graffiti')?.mood, 'graffiti')
  assert.equal(smalltalk('Fenster putzen eintragen'), null, 'Fenster hat eigene Hilfe-Themen')
  assert.equal(smalltalk('Tiefgarage'), null)
})
