import { EQUIPMENT } from './equipment';
import { COMPOUND, EXERCISES, PATTERN_NAME, exercise } from './exercises';
import type { EquipmentId, Exercise, FocusArea, Muscle, Pattern, Plan, PlanDay, PlanItem, Profile } from './types';

export const FOCUS_MUSCLES: Record<FocusArea, Muscle[]> = {
  Rücken: ['Rücken'], Schultern: ['Schultern'], Arme: ['Bizeps', 'Trizeps'], Brust: ['Brust'],
  Bauch: ['Rumpf'], Gesäß: ['Gesäß'], Beine: ['Quadrizeps', 'Beinbeuger', 'Waden'],
};
const FOCUS_EXTRA: Record<FocusArea, Pattern[]> = {
  Rücken: ['pull_h'], Schultern: ['delts_side'], Arme: ['biceps', 'triceps'], Brust: ['chest_iso'],
  Bauch: ['core'], Gesäß: ['glutes'], Beine: ['quad_iso', 'hamstring_iso'],
};
const focusMuscles = (profile: Pick<Profile, 'focus'>) => new Set((profile.focus ?? []).flatMap((f) => FOCUS_MUSCLES[f]));

type Slot = { p: Pattern; prio: 1 | 2 | 3 };
type Template = { id: string; name: string; focus: string; slots: Slot[] };

const s = (p: Pattern, prio: 1 | 2 | 3 = 1): Slot => ({ p, prio });

const T: Record<string, Template> = {
  gkA: { id: 'gkA', name: 'Ganzkörper A', focus: 'Kniebeuge, Drücken, Rudern', slots: [s('squat'), s('push_h'), s('pull_h'), s('hinge', 2), s('push_v', 2), s('core', 2), s('biceps', 3), s('calves', 3)] },
  gkB: { id: 'gkB', name: 'Ganzkörper B', focus: 'Hüfte, Schultern, Ziehen', slots: [s('hinge'), s('push_v'), s('pull_v'), s('lunge', 2), s('push_h', 2), s('core', 2), s('triceps', 3), s('delts_side', 3)] },
  gkC: { id: 'gkC', name: 'Ganzkörper C', focus: 'Einbeinig, Brust, Rücken', slots: [s('lunge'), s('push_h'), s('pull_v'), s('glutes', 2), s('pull_h', 2), s('delts_side', 2), s('core', 3), s('hamstring_iso', 3)] },
  okA: { id: 'okA', name: 'Oberkörper A', focus: 'Brust und Rücken schwer', slots: [s('push_h'), s('pull_h'), s('push_v'), s('pull_v'), s('delts_side', 2), s('triceps', 2), s('biceps', 3)] },
  okB: { id: 'okB', name: 'Oberkörper B', focus: 'Schultern und Latissimus', slots: [s('pull_v'), s('push_v'), s('pull_h'), s('push_h'), s('delts_rear', 2), s('biceps', 2), s('triceps', 3)] },
  ukA: { id: 'ukA', name: 'Unterkörper A', focus: 'Kniebeuge im Mittelpunkt', slots: [s('squat'), s('hinge'), s('lunge'), s('hamstring_iso', 2), s('calves', 2), s('core', 3)] },
  ukB: { id: 'ukB', name: 'Unterkörper B', focus: 'Hüftstreckung im Mittelpunkt', slots: [s('hinge'), s('squat'), s('glutes'), s('quad_iso', 2), s('calves', 2), s('core', 3)] },
  pushA: { id: 'pushA', name: 'Push A', focus: 'Brust, Schultern, Trizeps', slots: [s('push_h'), s('push_v'), s('chest_iso', 2), s('delts_side'), s('triceps'), s('core', 3)] },
  pushB: { id: 'pushB', name: 'Push B', focus: 'Schultern, Brust, Trizeps', slots: [s('push_v'), s('push_h'), s('delts_side'), s('chest_iso', 2), s('triceps'), s('core', 3)] },
  pullA: { id: 'pullA', name: 'Pull A', focus: 'Rücken und Bizeps', slots: [s('pull_v'), s('pull_h'), s('delts_rear', 2), s('biceps'), s('pull_h', 3), s('core', 2)] },
  pullB: { id: 'pullB', name: 'Pull B', focus: 'Rücken und Bizeps', slots: [s('pull_h'), s('pull_v'), s('delts_rear'), s('biceps'), s('biceps', 3), s('core', 2)] },
  legsA: { id: 'legsA', name: 'Beine A', focus: 'Quadrizeps, Gesäß, Waden', slots: [s('squat'), s('hinge'), s('lunge'), s('hamstring_iso', 2), s('quad_iso', 3), s('calves', 2)] },
  legsB: { id: 'legsB', name: 'Beine B', focus: 'Beinbeuger, Gesäß, Waden', slots: [s('hinge'), s('lunge'), s('glutes'), s('quad_iso', 2), s('hamstring_iso', 2), s('calves', 3)] },
};

const SPLITS: Record<number, { name: string; days: string[] }> = {
  2: { name: 'Ganzkörper 2×', days: ['gkA', 'gkB'] },
  3: { name: 'Ganzkörper 3×', days: ['gkA', 'gkB', 'gkC'] },
  4: { name: 'Oberkörper / Unterkörper', days: ['okA', 'ukA', 'okB', 'ukB'] },
  5: { name: 'Push / Pull / Beine + Ober / Unter', days: ['pushA', 'pullA', 'legsA', 'okB', 'ukB'] },
  6: { name: 'Push / Pull / Beine 2×', days: ['pushA', 'pullA', 'legsA', 'pushB', 'pullB', 'legsB'] },
};

/** Ersatzmuster, wenn für das eigentliche Muster nichts möglich ist. */
const FALLBACK: Partial<Record<Pattern, Pattern[]>> = {
  pull_v: ['pull_h'], push_v: ['delts_side', 'push_h'], hamstring_iso: ['hinge', 'glutes'],
  quad_iso: ['lunge', 'squat'], chest_iso: ['push_h'], delts_rear: ['pull_h'],
  delts_side: ['push_v'], glutes: ['hinge'], squat: ['lunge', 'glutes'], lunge: ['glutes', 'hinge'],
};

const FILLER: Pattern[] = ['core', 'hinge', 'squat', 'push_h', 'lunge', 'glutes', 'calves'];
const WARMUP_SECONDS = 240;

export function available(profile: Pick<Profile, 'equipment' | 'limitations'>, pattern: Pattern): Exercise[] {
  return EXERCISES.filter((e) => e.pattern === pattern
    && e.needs.every((n) => profile.equipment.includes(n))
    && !(e.stress ?? []).some((l) => profile.limitations.includes(l)));
}

function rate(e: Exercise, profile: Profile, used: Map<string, number>): number {
  const above = Math.max(0, e.level - profile.level);
  const repeat = (used.get(e.id) ?? 0) * (profile.challenge === 'variety' ? 22 : profile.goal === 'Kraft' ? 6 : 12);
  const barbell = profile.goal === 'Kraft' && e.needs.includes('barbell') ? 6 : 0;
  return e.quality * 10 - above * 25 - repeat + barbell;
}

function choose(profile: Profile, pattern: Pattern, used: Map<string, number>, taken: Set<string>): { ex: Exercise; fallback: boolean } | null {
  for (const [i, p] of [pattern, ...(FALLBACK[pattern] ?? [])].entries()) {
    const list = available(profile, p).filter((e) => !taken.has(e.id));
    if (!list.length) continue;
    let best = list[0];
    let bestScore = rate(best, profile, used);
    for (const e of list.slice(1)) {
      const sc = rate(e, profile, used);
      if (sc > bestScore) { best = e; bestScore = sc; }
    }
    return { ex: best, fallback: i > 0 };
  }
  return null;
}

export function prescribe(profile: Pick<Profile, 'goal' | 'level'>, ex: Exercise, heavy: boolean): Pick<PlanItem, 'sets' | 'lo' | 'hi' | 'rest'> {
  const { goal, level } = profile;
  if (ex.pattern === 'conditioning') return { sets: level === 1 ? 4 : 6, lo: 30, hi: 30, rest: 30 };
  if (ex.mode === 'time') return { sets: level === 1 ? 2 : 3, lo: 20, hi: 45, rest: 45 };
  let r: Pick<PlanItem, 'sets' | 'lo' | 'hi' | 'rest'>;
  const compound = ex.kind === 'compound';
  if (goal === 'Kraft') {
    r = compound && heavy ? { sets: level === 1 ? 3 : 4, lo: level === 1 ? 5 : 3, hi: level === 1 ? 8 : 6, rest: 180 }
      : compound ? { sets: 3, lo: 6, hi: 10, rest: 120 }
      : { sets: level === 1 ? 2 : 3, lo: 10, hi: 15, rest: 75 };
  } else if (goal === 'Muskelaufbau') {
    r = compound && heavy ? { sets: level === 3 ? 4 : 3, lo: 6, hi: 10, rest: 120 }
      : compound ? { sets: 3, lo: 8, hi: 12, rest: 90 }
      : { sets: level === 1 ? 2 : 3, lo: 10, hi: 15, rest: 60 };
  } else if (goal === 'Fettabbau') {
    r = compound ? { sets: 3, lo: 8, hi: 12, rest: 75 } : { sets: 2, lo: 12, hi: 15, rest: 45 };
  } else {
    r = compound ? { sets: 3, lo: 8, hi: 12, rest: 90 } : { sets: 2, lo: 12, hi: 15, rest: 60 };
  }
  if (ex.load === 'bodyweight' && compound) {
    if (ex.pattern === 'pull_v') { r.lo = 4; r.hi = 10; }
    else if (ex.quality <= 2 && ex.level === 1 && ['squat', 'hinge', 'lunge'].includes(ex.pattern)) { r.lo = 12; r.hi = 20; }
    else { r.lo = 8; r.hi = 15; }
  }
  return r;
}

export function itemSeconds(item: PlanItem): number {
  const ex = exercise(item.exerciseId);
  const sides = ex.perSide ? 2 : 1;
  const work = ex.mode === 'time' ? item.hi * sides : ((item.lo + item.hi) / 2) * 2.5 * sides;
  return item.sets * (work + item.rest) + 45;
}

export const dayMinutes = (items: PlanItem[]) => Math.round((WARMUP_SECONDS + items.reduce((sum, i) => sum + itemSeconds(i), 0)) / 60);

function fit(items: (PlanItem & { prio: number })[], minutes: number, level: number): PlanItem[] {
  let list = items.map((i) => ({ ...i }));
  const over = () => dayMinutes(list) > minutes;
  for (const prio of [3, 2]) {
    while (over() && list.length > 3) {
      const idx = list.map((i) => i.prio).lastIndexOf(prio);
      if (idx < 0) break;
      list.splice(idx, 1);
    }
  }
  while (over()) {
    // Schwerpunkt-Übungen behalten ihre Sätze am längsten.
    const pool = list.some((i) => !i.focus && i.sets > 2) ? list.filter((i) => !i.focus) : list;
    const most = pool.reduce((a, b) => (b.sets > a.sets ? b : a), pool[0]);
    if (!most || most.sets <= 2) break;
    most.sets -= 1;
  }
  // Sehr kurze Einheiten: lieber kürzere Pausen als eine Übung weniger.
  while (over()) {
    const longest = list.reduce((x, y) => (y.rest > x.rest ? y : x), list[0]);
    if (!longest || longest.rest <= 60) break;
    longest.rest -= 15;
  }
  while (over() && list.length > 3) list = list.slice(0, -1);
  // Bleibt Zeit übrig, bekommen die Hauptübungen einen vierten Satz.
  if (level >= 2) {
    for (const item of list) {
      if (item.prio !== 1 || item.sets !== (item.focus ? 4 : 3) || exercise(item.exerciseId).kind !== 'compound') continue;
      item.sets += 1;
      if (over()) { item.sets -= 1; break; }
    }
  }
  return list.map(({ prio: _prio, ...rest }) => rest);
}

type Draft = { tpl: Template; items: (PlanItem & { prio: number })[]; missing: Pattern[]; replaced: Pattern[] };

function draft(profile: Profile): { split: string; drafts: Draft[] } {
  const split = SPLITS[Math.min(6, Math.max(2, Math.round(profile.daysPerWeek)))];
  const used = new Map<string, number>();
  const focus = focusMuscles(profile);
  const drafts = split.days.map((key) => {
    const tpl = T[key];
    const taken = new Set<string>();
    const d: Draft = { tpl, items: [], missing: [], replaced: [] };
    let heavyLeft = 2;
    // Schwerpunkt: an passenden Tagen kommt eine gezielte Zusatzübung dazu.
    const slots = [...tpl.slots];
    for (const area of profile.focus ?? []) {
      const dayHits = tpl.slots.some((sl) => sl.prio === 1 && EXERCISES.some((e) => e.pattern === sl.p && e.primary.some((m) => FOCUS_MUSCLES[area].includes(m))));
      if (!dayHits) continue;
      for (const p of FOCUS_EXTRA[area]) if (!slots.some((sl) => sl.p === p)) slots.push({ p, prio: 1 });
    }
    for (const slot of slots) {
      const pick = choose(profile, slot.p, used, taken);
      if (!pick) { d.missing.push(slot.p); continue; }
      if (pick.fallback) d.replaced.push(slot.p);
      taken.add(pick.ex.id);
      used.set(pick.ex.id, (used.get(pick.ex.id) ?? 0) + 1);
      const heavy = COMPOUND.includes(pick.ex.pattern) && heavyLeft > 0;
      if (heavy) heavyLeft -= 1;
      const rx = prescribe(profile, pick.ex, heavy);
      const focused = pick.ex.mode === 'reps' && pick.ex.primary.some((m) => focus.has(m));
      d.items.push({ exerciseId: pick.ex.id, slot: slot.p, prio: focused ? 1 : slot.prio, fallback: pick.fallback || undefined, focus: focused || undefined, ...rx, sets: rx.sets + (focused ? 1 : 0) });
    }
    // Reicht das Equipment für den Schwerpunkt nicht, wird der Tag mit Grundübungen aufgefüllt.
    for (const p of FILLER) {
      if (d.items.length >= 4) break;
      if (d.items.some((i) => exercise(i.exerciseId).pattern === p)) continue;
      const pick = choose(profile, p, used, taken);
      if (!pick || pick.fallback) continue;
      taken.add(pick.ex.id);
      used.set(pick.ex.id, (used.get(pick.ex.id) ?? 0) + 1);
      d.items.push({ exerciseId: pick.ex.id, slot: p, prio: 1, ...prescribe(profile, pick.ex, false) });
    }
    d.missing = d.missing.filter((p) => !d.items.some((i) => exercise(i.exerciseId).pattern === p));
    return d;
  });
  return { split: split.name, drafts };
}

const ALL: EquipmentId[] = EQUIPMENT.map((e) => e.id);
const bestQuality = (p: Pattern) => Math.max(1, ...EXERCISES.filter((e) => e.pattern === p).map((e) => e.quality));

function scoreOf(drafts: Draft[]): number {
  let sum = 0;
  let n = 0;
  for (const d of drafts) {
    for (const item of d.items) {
      const q = exercise(item.exerciseId).quality / bestQuality(item.slot);
      sum += Math.min(1, q) * (item.fallback ? 0.6 : 1);
      n += 1;
    }
    n += d.missing.length;
  }
  return n ? Math.round((sum / n) * 100) : 0;
}

/** 0–100: wie gut das Equipment die Bewegungsmuster des Plans abdeckt. */
export const equipmentScore = (profile: Profile) => scoreOf(draft(profile).drafts);

export function generatePlan(profile: Profile, now = new Date()): Plan {
  const { split, drafts } = draft(profile);
  const finisher = profile.goal === 'Fettabbau' && profile.minutes >= 30;
  const days: PlanDay[] = drafts.map((d) => {
    const items = fit(d.items, profile.minutes - (finisher ? 6 : 0), profile.level);
    if (finisher || (profile.goal === 'Allgemeine Fitness' && profile.minutes - dayMinutes(items) >= 6)) {
      const c = choose(profile, 'conditioning', new Map(), new Set());
      if (c) items.push({ exerciseId: c.ex.id, slot: 'conditioning', ...prescribe(profile, c.ex, false) });
    }
    return { id: d.tpl.id, name: d.tpl.name, focus: d.tpl.focus, items, minutes: dayMinutes(items) };
  });
  const gaps = new Set<Pattern>();
  drafts.forEach((d) => [...d.missing, ...d.replaced].forEach((p) => gaps.add(p)));
  const notes: string[] = [];
  if (gaps.size) notes.push(`Mit deinem Equipment nicht direkt trainierbar: ${[...gaps].map((p) => PATTERN_NAME[p]).join(', ')}. Der Plan nutzt die nächstbeste Übung.`);
  if (profile.limitations.length) notes.push('Übungen, die deine angegebenen Problemzonen stark belasten, sind ausgelassen.');
  return { createdAt: now.toISOString(), split, days, score: scoreOf(drafts), notes };
}

export type Upgrade = { items: EquipmentId[]; score: number; gain: number };

/** Welche Anschaffung bringt dem Plan am meisten? */
export function upgrades(profile: Profile): Upgrade[] {
  const base = equipmentScore(profile);
  const owned = new Set(profile.equipment);
  const bundles: EquipmentId[][] = [
    ...ALL.filter((e) => e !== 'cardio').map((e) => [e]),
    ['dumbbells', 'bench'], ['barbell', 'rack'], ['barbell', 'rack', 'bench'], ['pullup_bar', 'bands'],
  ];
  const seen = new Set<string>();
  const out: Upgrade[] = [];
  for (const bundle of bundles) {
    const add = bundle.filter((e) => !owned.has(e));
    const key = [...add].sort().join('+');
    if (!add.length || seen.has(key)) continue;
    seen.add(key);
    const score = equipmentScore({ ...profile, equipment: [...profile.equipment, ...add] });
    if (score - base >= 2) out.push({ items: add, score, gain: score - base });
  }
  // Mehr Gewinn zuerst; bei ähnlichem Gewinn die kleinere Anschaffung.
  return out.sort((a, b) => b.gain / (1 + 0.35 * (b.items.length - 1)) - a.gain / (1 + 0.35 * (a.items.length - 1))).slice(0, 3);
}

/** Tauschmöglichkeiten für einen Platz im Plan, beste zuerst. */
export function alternatives(profile: Profile, item: PlanItem, day: PlanDay): Exercise[] {
  const taken = new Set(day.items.map((i) => i.exerciseId));
  const used = new Map<string, number>();
  for (const p of [item.slot, ...(FALLBACK[item.slot] ?? [])]) {
    const list = available(profile, p).filter((e) => !taken.has(e.id));
    if (list.length) return list.sort((a, b) => rate(b, profile, used) - rate(a, profile, used)).slice(0, 8);
  }
  return [];
}

export function swapExercise(plan: Plan, profile: Profile, dayId: string, index: number, exerciseId: string): Plan {
  return {
    ...plan,
    days: plan.days.map((d) => {
      if (d.id !== dayId) return d;
      const items = d.items.map((item, i) => {
        if (i !== index) return item;
        const ex = exercise(exerciseId);
        const heavy = COMPOUND.includes(ex.pattern) && i < 2;
        const rx = prescribe(profile, ex, heavy);
        const focused = ex.mode === 'reps' && ex.primary.some((m) => focusMuscles(profile).has(m));
        return { ...item, exerciseId, ...rx, sets: rx.sets + (focused ? 1 : 0), focus: focused || undefined, fallback: ex.pattern !== item.slot || undefined };
      });
      return { ...d, items, minutes: dayMinutes(items) };
    }),
  };
}

export const MUSCLE_ORDER: Muscle[] = ['Brust', 'Rücken', 'Schultern', 'Bizeps', 'Trizeps', 'Quadrizeps', 'Beinbeuger', 'Gesäß', 'Waden', 'Rumpf'];

/** Sätze pro Muskel und Woche; Hilfsmuskeln zählen halb. */
export function weeklyVolume(plan: Plan): Record<Muscle, number> {
  const out = Object.fromEntries(MUSCLE_ORDER.map((m) => [m, 0])) as Record<Muscle, number>;
  for (const d of plan.days) for (const item of d.items) {
    const ex = exercise(item.exerciseId);
    ex.primary.forEach((m) => { out[m] += item.sets; });
    ex.secondary.forEach((m) => { out[m] += item.sets / 2; });
  }
  return out;
}
