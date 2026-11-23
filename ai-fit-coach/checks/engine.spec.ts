import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EQUIPMENT, PRESETS } from '../src/engine/equipment';
import { EXERCISES, exercise, hasExercise } from '../src/engine/exercises';
import { alternatives, dayMinutes, equipmentScore, generatePlan, swapExercise, upgrades, weeklyVolume } from '../src/engine/plan';
import { activeWeeks, e1rm, newRecords, records, suggest, weekStart } from '../src/engine/progression';
import type { EquipmentId, ExerciseLog, Goal, Level, Profile, Session } from '../src/engine/types';

const base: Profile = { name: 'Test', goal: 'Muskelaufbau', level: 2, daysPerWeek: 4, minutes: 60, equipment: [], limitations: [] };
const gym = EQUIPMENT.map((e) => e.id);
const log = (exerciseId: string, sets: [number, number][], lo = 6, hi = 10): ExerciseLog => ({ exerciseId, lo, hi, targetSets: 3, sets: sets.map(([weight, reps]) => ({ weight, reps, done: true })) });
const session = (date: string, exercises: ExerciseLog[]): Session => ({ id: date, date, dayId: 'okA', dayName: 'Oberkörper A', durationSeconds: 3000, exercises });

test('Übungsbibliothek: eindeutige IDs, gültige Verweise', () => {
  assert.equal(new Set(EXERCISES.map((e) => e.id)).size, EXERCISES.length);
  for (const e of EXERCISES) {
    if (e.harder) assert.ok(hasExercise(e.harder), `${e.id} → ${e.harder}`);
    assert.ok(e.quality >= 1 && e.quality <= 5);
    assert.ok(e.cue.length > 10);
  }
});

test('Jede Kombination aus Ziel, Level, Tagen, Zeit und Equipment ergibt einen gültigen Plan', () => {
  const goals: Goal[] = ['Muskelaufbau', 'Fettabbau', 'Kraft', 'Allgemeine Fitness'];
  for (const goal of goals) for (const level of [1, 2, 3] as Level[]) for (const daysPerWeek of [2, 3, 4, 5, 6]) for (const minutes of [20, 30, 45, 60, 90]) for (const preset of PRESETS) {
    const profile = { ...base, goal, level, daysPerWeek, minutes, equipment: preset.items };
    const plan = generatePlan(profile);
    assert.equal(plan.days.length, daysPerWeek);
    for (const day of plan.days) {
      const label = `${goal}/${level}/${daysPerWeek}/${minutes}/${preset.id}/${day.id}`;
      assert.ok(day.items.length >= 3, `${label}: zu wenige Übungen`);
      assert.equal(new Set(day.items.map((i) => i.exerciseId)).size, day.items.length, `${label}: doppelte Übung`);
      assert.ok(day.minutes <= minutes + 6, `${label}: ${day.minutes} Min. bei ${minutes}`);
      assert.equal(day.minutes, dayMinutes(day.items));
      for (const item of day.items) {
        const ex = exercise(item.exerciseId);
        assert.ok(ex.needs.every((n) => preset.items.includes(n)), `${label}: ${ex.name} braucht fehlendes Equipment`);
        assert.ok(item.sets >= 2 && item.lo <= item.hi);
      }
    }
  }
});

test('Problemzonen schließen belastende Übungen aus', () => {
  const plan = generatePlan({ ...base, equipment: gym, limitations: ['knee', 'shoulder', 'back'] });
  for (const day of plan.days) for (const item of day.items) assert.deepEqual(exercise(item.exerciseId).stress ?? [], []);
});

test('Mehr Equipment ergibt einen besseren Score, Studio ist das Maximum', () => {
  const none = equipmentScore(base);
  const home = equipmentScore({ ...base, equipment: PRESETS[1].items });
  const full = equipmentScore({ ...base, equipment: gym });
  assert.ok(none < home && home < full, `${none} < ${home} < ${full}`);
  assert.ok(full >= 95);
});

test('Kraft bevorzugt die Langhantel, Einsteiger bekommen keine Technikübungen', () => {
  const kraft = generatePlan({ ...base, goal: 'Kraft', equipment: gym });
  const ids = kraft.days.flatMap((d) => d.items.map((i) => i.exerciseId));
  for (const id of ['back_squat', 'bb_bench', 'deadlift']) assert.ok(ids.includes(id), id);
  const first = kraft.days[0].items[0];
  assert.deepEqual([first.sets, first.lo, first.hi, first.rest], [4, 3, 6, 180]);
  const beginner = generatePlan({ ...base, level: 1, equipment: gym });
  for (const day of beginner.days) for (const item of day.items) assert.equal(exercise(item.exerciseId).level, 1);
});

test('Upgrade-Empfehlung: ohne Geräte lohnt sich eine Anschaffung, im Studio keine', () => {
  const up = upgrades(base);
  assert.ok(up.length > 0 && up[0].gain > 0);
  assert.ok(up.every((u) => u.items.every((i: EquipmentId) => !base.equipment.includes(i))));
  assert.deepEqual(upgrades({ ...base, equipment: gym }), []);
});

test('Tauschen: Alternativen passen zum Equipment und der Tausch hält den Plan gültig', () => {
  const profile = { ...base, equipment: PRESETS[2].items };
  const plan = generatePlan(profile);
  const day = plan.days[0];
  const alts = alternatives(profile, day.items[0], day);
  assert.ok(alts.length > 0);
  assert.ok(alts.every((a) => a.needs.every((n) => profile.equipment.includes(n)) && !day.items.some((i) => i.exerciseId === a.id)));
  const swapped = swapExercise(plan, profile, day.id, 0, alts[0].id);
  assert.equal(swapped.days[0].items[0].exerciseId, alts[0].id);
  assert.equal(swapped.days[1], plan.days[1]);
});

test('Wochenvolumen: große Muskelgruppen bekommen im Studio genug Sätze', () => {
  const v = weeklyVolume(generatePlan({ ...base, equipment: gym }));
  for (const m of ['Brust', 'Rücken', 'Quadrizeps', 'Beinbeuger', 'Schultern'] as const) assert.ok(v[m] >= 7, `${m}: ${v[m]}`);
});

test('Progression: Start, halten, steigern, zurücknehmen, schwerere Variante', () => {
  const bench = exercise('db_bench');
  const item = { sets: 3, lo: 6, hi: 10 };
  assert.equal(suggest(bench, item, []).kind, 'start');
  const hold = suggest(bench, item, [log('db_bench', [[20, 9], [20, 8], [20, 7]])]);
  assert.deepEqual([hold.kind, hold.weight, hold.reps], ['hold', 20, 8]);
  const up = suggest(bench, item, [log('db_bench', [[20, 10], [20, 10], [20, 10]])]);
  assert.deepEqual([up.kind, up.weight, up.reps], ['up', 22, 6]);
  const notAllSets = suggest(bench, item, [log('db_bench', [[20, 10], [20, 10]])]);
  assert.equal(notAllSets.kind, 'hold');
  const down = suggest(bench, item, [log('db_bench', [[30, 5], [30, 4], [30, 4]]), log('db_bench', [[30, 5], [30, 5], [30, 4]])]);
  assert.deepEqual([down.kind, down.weight], ['down', 28]);
  const once = suggest(bench, item, [log('db_bench', [[30, 5], [30, 4], [30, 4]])]);
  assert.equal(once.kind, 'hold');
  const pushup = suggest(exercise('pushup'), { sets: 3, lo: 8, hi: 15 }, [log('pushup', [[0, 15], [0, 15], [0, 16]], 8, 15)]);
  assert.equal(pushup.kind, 'harder');
  assert.match(pushup.note, /erhöhten Füßen/);
});

test('Bestwerte und Wochen in Folge', () => {
  assert.equal(e1rm(100, 1), 100);
  assert.equal(Math.round(e1rm(100, 6)), 120);
  const older = session('2026-11-02T18:00:00', [log('db_bench', [[20, 8]])]);
  const newer = session('2026-11-10T18:00:00', [log('db_bench', [[22, 8]]), log('db_row', [[24, 10]])]);
  assert.deepEqual(newRecords(newer, [older]), ['db_bench']);
  const rec = records([newer, older]).find((r) => r.exerciseId === 'db_bench');
  assert.deepEqual(rec?.series.map(Math.round), [25, 28]);
  assert.equal(weekStart(new Date('2026-11-15T12:00:00')).getDate(), 9);
  assert.equal(activeWeeks([newer, older], new Date('2026-11-18T12:00:00')), 2);
  assert.equal(activeWeeks([newer, older], new Date('2026-11-25T12:00:00')), 0);
});

test('Schwerpunkte: gewählte Muskelgruppen bekommen mehr Wochenvolumen und werden zuletzt gekürzt', async () => {
  const p = { ...base, equipment: gym };
  const plain = weeklyVolume(generatePlan(p));
  for (const [focus, muscle] of [['Brust', 'Brust'], ['Arme', 'Bizeps'], ['Gesäß', 'Gesäß'], ['Schultern', 'Schultern']] as const) {
    const v = weeklyVolume(generatePlan({ ...p, focus: [focus] }));
    assert.ok(v[muscle] > plain[muscle], `${focus}: ${v[muscle]} > ${plain[muscle]}`);
  }
  const short = generatePlan({ ...p, minutes: 30, focus: ['Arme'] });
  assert.ok(short.days.some((d) => d.items.some((i) => ['biceps', 'triceps'].includes(exercise(i.exerciseId).pattern))));
  for (const d of short.days) assert.ok(d.minutes <= 36);
});

test('Startgewichte: aus Kraftwert oder Körpergewicht, vorsichtig und im Raster der Übung', async () => {
  const { startWeight, benchEstimate, oneRmFrom } = await import('../src/engine/startweights');
  assert.equal(oneRmFrom(30, 5), 35);
  const p: Profile = { ...base, equipment: gym, benchmark: { lift: 'bench', oneRm: 100 } };
  const bench = startWeight(exercise('bb_bench'), { hi: 10 }, p)!;
  assert.ok(bench >= 55 && bench <= 70 && bench % 2.5 === 0, String(bench));
  assert.ok(startWeight(exercise('back_squat'), { hi: 10 }, p)! > bench);
  assert.ok(startWeight(exercise('db_lateral'), { hi: 15 }, p)! <= 8);
  assert.equal(startWeight(exercise('pushup'), { hi: 15 }, p), null);
  assert.equal(startWeight(exercise('bb_bench'), { hi: 10 }, base), null);
  assert.equal(Math.round(benchEstimate({ ...base, benchmark: { lift: 'squat', oneRm: 130 } })!), 100);
  const byBody = benchEstimate({ ...base, level: 1, sex: 'f', weightKg: 60 })!;
  assert.equal(byBody, 15);
  const sg = suggest(exercise('bb_bench'), { sets: 3, lo: 6, hi: 10 }, [], bench);
  assert.deepEqual([sg.kind, sg.weight, sg.reps], ['start', bench, 6]);
  assert.equal(suggest(exercise('bb_bench'), { sets: 3, lo: 6, hi: 10 }, [log('bb_bench', [[80, 8], [80, 8], [80, 7]])], bench).weight, 80);
});

test('Abwechslung: bei „schnell gelangweilt“ wiederholen sich weniger Übungen in der Woche', () => {
  const count = (p: Profile) => { const ids = generatePlan(p).days.flatMap((d) => d.items.map((i) => i.exerciseId)); return ids.length - new Set(ids).size; };
  const p = { ...base, daysPerWeek: 6, equipment: gym };
  assert.ok(count({ ...p, challenge: 'variety' }) <= count(p));
});

test('Jede Übung hat Anleitung und Bewegungsbild', async () => {
  const { guide, hasGuide } = await import('../src/engine/guides');
  const { ANIMS, ANIM_OF } = await import('../src/figure/poses');
  for (const e of EXERCISES) {
    assert.ok(hasGuide(e.id), `Anleitung fehlt: ${e.id}`);
    const g = guide(e);
    assert.ok(g.setup.length > 15 && g.steps.length >= 2 && g.tips.length >= 3, e.id);
    assert.ok(ANIMS[ANIM_OF[e.id]], `Bewegungsbild fehlt: ${e.id}`);
  }
});

test('Plan von Hand ändern: hinzufügen, nicht doppelt, entfernen', async () => {
  const { addExercise, removeExercise } = await import('../src/engine/plan');
  const p = { ...base, equipment: gym };
  const plan = generatePlan(p);
  const day = plan.days[0];
  const added = addExercise(plan, p, day.id, 'cable_crunch');
  assert.equal(added.days[0].items.length, day.items.length + 1);
  assert.ok(added.days[0].minutes > day.minutes);
  assert.equal(addExercise(added, p, day.id, 'cable_crunch').days[0].items.length, day.items.length + 1);
  const removed = removeExercise(added, day.id, 0);
  assert.equal(removed.days[0].items.length, day.items.length);
  assert.notEqual(removed.days[0].items[0].exerciseId, day.items[0].exerciseId);
});

test('Sanfter Abnehm-Modus: gültige Pläne ohne Sprünge, Boden- und Hängeübungen, mit ruhiger Ausdauer', async () => {
  const { NOT_GENTLE } = await import('../src/engine/exercises');
  for (const preset of PRESETS) for (const daysPerWeek of [2, 3, 4, 5]) for (const minutes of [20, 30, 45]) for (const level of [1, 2] as Level[]) {
    const p: Profile = { ...base, goal: 'Fettabbau', gentle: true, level, daysPerWeek, minutes, equipment: preset.items };
    const plan = generatePlan(p);
    assert.equal(plan.days.length, daysPerWeek);
    assert.equal(new Set(plan.days.map((d) => d.id)).size, daysPerWeek);
    assert.match(plan.split, /Ganzkörper/);
    for (const day of plan.days) {
      const label = `${preset.id}/${daysPerWeek}/${minutes}/${day.id}`;
      assert.ok(day.items.length >= 3, `${label}: zu wenige Übungen`);
      assert.ok(day.minutes <= minutes + 8, `${label}: ${day.minutes} Min.`);
      assert.equal(exercise(day.items[day.items.length - 1].exerciseId).pattern, 'conditioning', `${label}: Ausdauer fehlt`);
      for (const item of day.items) {
        assert.ok(!NOT_GENTLE.has(item.exerciseId), `${label}: ${item.exerciseId}`);
        assert.ok(item.sets <= 6 && item.rest <= 75);
      }
    }
  }
  const none = generatePlan({ ...base, goal: 'Fettabbau', gentle: true, level: 1, daysPerWeek: 3, minutes: 30 });
  const ids = none.days.flatMap((d) => d.items.map((i) => i.exerciseId));
  for (const id of ['chair_squat', 'incline_pushup', 'march']) assert.ok(ids.includes(id), id);
});

test('Wochenplanung: Standardtage, erledigte Wochentage, Geh-Minuten der Woche', async () => {
  const { defaultTrainDays, doneWeekdays, weekMinutes, weekdayIndex } = await import('../src/engine/progression');
  for (const n of [2, 3, 4, 5, 6]) assert.equal(defaultTrainDays(n).length, n);
  assert.equal(weekdayIndex(new Date('2026-11-23T10:00:00')), 0);
  assert.equal(weekdayIndex(new Date('2026-11-29T10:00:00')), 6);
  const now = new Date('2026-11-26T12:00:00');
  const hist = [session('2026-11-25T18:00:00', [log('db_bench', [[20, 8]])]), session('2026-11-23T18:00:00', [log('db_bench', [[20, 8]])]), session('2026-11-20T18:00:00', [log('db_bench', [[20, 8]])])];
  assert.deepEqual(doneWeekdays(hist, now).sort(), [0, 2]);
  assert.equal(weekMinutes([{ date: '2026-11-24T08:00:00', minutes: 20 }, { date: '2026-11-26T08:00:00', minutes: 15 }, { date: '2026-11-21T08:00:00', minutes: 60 }], now), 35);
});
