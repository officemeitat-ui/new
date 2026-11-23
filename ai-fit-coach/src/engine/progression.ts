import { exercise } from './exercises';
import type { Exercise, ExerciseLog, Muscle, PlanItem, Session } from './types';

export type Suggestion = {
  /** null = noch kein Gewicht bekannt. */
  weight: number | null;
  reps: number;
  kind: 'start' | 'up' | 'hold' | 'down' | 'harder';
  note: string;
};

const done = (log: ExerciseLog) => log.sets.filter((x) => x.done);
const kg = (n: number) => `${String(Math.round(n * 100) / 100).replace('.', ',')} kg`;
const roundTo = (value: number, step: number) => Math.max(step, Math.round(value / step) * step);

/** Logs einer Übung, neueste zuerst. */
export function logsFor(history: Session[], exerciseId: string): ExerciseLog[] {
  return history.flatMap((sn) => sn.exercises.filter((e) => e.exerciseId === exerciseId && e.sets.some((x) => x.done)));
}

/**
 * Doppelte Progression: erst im Wiederholungsbereich nach oben arbeiten,
 * dann das Gewicht erhöhen und wieder unten im Bereich beginnen.
 */
export function suggest(ex: Exercise, item: Pick<PlanItem, 'sets' | 'lo' | 'hi'>, logs: ExerciseLog[], start: number | null = null): Suggestion {
  const unit = ex.mode === 'time' ? 'Sek.' : 'Wdh.';
  const last = logs[0] ? done(logs[0]) : [];
  const weight = last.length ? Math.max(...last.map((x) => x.weight)) : 0;
  const external = ex.load === 'external';
  if ((!last.length || (external && weight <= 0)) && external && start) {
    return { weight: start, reps: item.lo, kind: 'start', note: `Erstes Mal: Starte mit etwa ${kg(start)} (aus deinen Angaben geschätzt). Zu leicht oder zu schwer? Einfach anpassen, ab dann rechne ich mit deinen echten Werten.` };
  }
  if (!last.length || (external && weight <= 0)) {
    return {
      weight: null, reps: ex.mode === 'time' ? item.lo : Math.round((item.lo + item.hi) / 2), kind: 'start',
      note: external
        ? `Erstes Mal: Wähle ein Gewicht, mit dem du ${item.hi} saubere ${unit} schaffst und noch 2 übrig hättest.`
        : ex.mode === 'time' ? `Erstes Mal: Halte sauber, mindestens ${item.lo} Sek.` : 'Erstes Mal: Saubere Wiederholungen, 1–2 vor dem Limit aufhören.',
    };
  }
  const worst = Math.min(...last.map((x) => x.reps));
  const needed = Math.min(item.sets, logs[0].targetSets || item.sets);
  const top = worst >= item.hi && last.length >= needed;
  if (top && external) {
    return { weight: weight + ex.step, reps: item.lo, kind: 'up', note: `Letztes Mal alle Sätze mit ${item.hi} ${unit} bei ${kg(weight)} geschafft: heute ${kg(weight + ex.step)}.` };
  }
  if (top) {
    const harder = ex.harder ? exercise(ex.harder).name : null;
    return {
      weight: null, reps: item.hi, kind: 'harder',
      note: harder ? `Oberes Ziel erreicht. Zeit für die schwerere Variante: ${harder} (im Plan tauschen).`
        : ex.mode === 'time' ? 'Oberes Ziel erreicht. Mach es schwerer: Füße erhöhen oder Zusatzgewicht.'
        : 'Oberes Ziel erreicht. Mach es schwerer: 3 Sekunden absenken und unten kurz halten.',
    };
  }
  const prev = logs[1] ? done(logs[1]) : [];
  const failedBefore = prev.length > 0 && Math.min(...prev.map((x) => x.reps)) < item.lo && Math.max(...prev.map((x) => x.weight)) >= weight;
  if (external && worst < item.lo && failedBefore) {
    const lighter = roundTo(weight * 0.9, ex.step);
    return { weight: lighter, reps: item.lo, kind: 'down', note: `Zweimal unter ${item.lo} ${unit} geblieben: heute ${kg(lighter)} und sauber neu aufbauen.` };
  }
  const reps = Math.min(item.hi, Math.max(item.lo, worst + (ex.mode === 'time' ? 5 : 1)));
  return {
    weight: external ? weight : null, reps, kind: 'hold',
    note: `Letztes Mal: ${last.map((x) => x.reps).join(' / ')} ${unit}${external ? ` bei ${kg(weight)}` : ''}. Ziel heute: ${reps} ${unit} pro Satz.`,
  };
}

/** Geschätztes Maximum für eine Wiederholung (Epley), sinnvoll bis 12 Wiederholungen. */
export const e1rm = (weight: number, reps: number) => (reps <= 0 || weight <= 0 ? 0 : reps === 1 ? weight : weight * (1 + Math.min(reps, 12) / 30));

/** Bestwert eines Logs: geschätztes Maximum bei Gewichten, sonst beste Wiederholungszahl/Zeit. */
export function bestOf(log: ExerciseLog): number {
  const sets = done(log);
  if (!sets.length) return 0;
  return exercise(log.exerciseId).load === 'external'
    ? Math.max(...sets.map((x) => e1rm(x.weight, x.reps)))
    : Math.max(...sets.map((x) => x.reps));
}

export const sessionVolume = (sn: Session) => sn.exercises.reduce((sum, e) => sum + done(e).reduce((v, x) => v + x.weight * x.reps, 0), 0);
export const sessionSets = (sn: Session) => sn.exercises.reduce((sum, e) => sum + done(e).length, 0);

export type RecordEntry = { exerciseId: string; best: number; date: string; series: number[] };

/** Bestwerte je Übung mit Verlauf (älteste zuerst). */
export function records(history: Session[]): RecordEntry[] {
  const map = new Map<string, RecordEntry>();
  for (const sn of [...history].reverse()) {
    for (const log of sn.exercises) {
      const value = bestOf(log);
      if (value <= 0) continue;
      const entry = map.get(log.exerciseId) ?? { exerciseId: log.exerciseId, best: 0, date: sn.date, series: [] };
      entry.series.push(value);
      if (value > entry.best) { entry.best = value; entry.date = sn.date; }
      map.set(log.exerciseId, entry);
    }
  }
  return [...map.values()].sort((a, b) => b.series.length - a.series.length);
}

/** Übungen, bei denen diese Einheit einen neuen Bestwert gebracht hat. */
export function newRecords(session: Session, earlier: Session[]): string[] {
  const before = new Map(records(earlier).map((r) => [r.exerciseId, r.best]));
  return session.exercises
    .filter((log) => { const b = before.get(log.exerciseId); return b !== undefined && bestOf(log) > b + 1e-9; })
    .map((log) => log.exerciseId);
}

export function weekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export const inWeek = (sn: Session, start: Date) => {
  const t = new Date(sn.date).getTime();
  return t >= start.getTime() && t < start.getTime() + 7 * 86400000;
};

export const sessionsThisWeek = (history: Session[], now = new Date()) => history.filter((sn) => inWeek(sn, weekStart(now)));

export function weeklyCounts(history: Session[], weeks = 8, now = new Date()): { label: string; count: number }[] {
  const current = weekStart(now);
  return Array.from({ length: weeks }, (_, i) => {
    const start = new Date(current);
    start.setDate(start.getDate() - 7 * (weeks - 1 - i));
    return { label: `${start.getDate()}.${start.getMonth() + 1}.`, count: history.filter((sn) => inWeek(sn, start)).length };
  });
}

/** Wochen in Folge mit mindestens einem Training (die laufende Woche darf noch offen sein). */
export function activeWeeks(history: Session[], now = new Date()): number {
  const start = weekStart(now);
  let n = 0;
  for (let i = 0; i < 520; i += 1) {
    const s = new Date(start);
    s.setDate(s.getDate() - 7 * i);
    if (history.some((sn) => inWeek(sn, s))) n += 1;
    else if (i > 0) break;
  }
  return n;
}

export function muscleSets(sessions: Session[]): Partial<Record<Muscle, number>> {
  const out: Partial<Record<Muscle, number>> = {};
  for (const sn of sessions) for (const log of sn.exercises) {
    const n = done(log).length;
    const ex = exercise(log.exerciseId);
    ex.primary.forEach((m) => { out[m] = (out[m] ?? 0) + n; });
    ex.secondary.forEach((m) => { out[m] = (out[m] ?? 0) + n / 2; });
  }
  return out;
}

const DEFAULT_DAYS: Record<number, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
/** Sinnvolle Verteilung der Trainingstage über die Woche (0 = Montag). */
export const defaultTrainDays = (n: number) => DEFAULT_DAYS[Math.min(6, Math.max(2, n))];
export const weekdayIndex = (date: Date) => (date.getDay() + 6) % 7;
/** Wochentage (0 = Montag), an denen in der laufenden Woche trainiert wurde. */
export const doneWeekdays = (history: Session[], now = new Date()) => [...new Set(sessionsThisWeek(history, now).map((sn) => weekdayIndex(new Date(sn.date))))];
/** Minuten in der laufenden Woche. */
export const weekMinutes = (entries: { date: string; minutes: number }[], now = new Date()) => {
  const start = weekStart(now).getTime();
  return entries.filter((e) => { const t = new Date(e.date).getTime(); return t >= start && t < start + 7 * 86400000; }).reduce((n, e) => n + e.minutes, 0);
};
