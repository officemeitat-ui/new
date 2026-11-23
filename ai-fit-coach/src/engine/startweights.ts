import type { BenchmarkLift, Exercise, PlanItem, Profile } from './types';

/** Verhältnis des Maximums einer Übung zum Bankdrück-Maximum. Kurzhanteln und Kettlebells: je Hantel. Grobe Richtwerte. */
const RATIO: Record<string, number> = {
  goblet_squat: 0.4, kb_goblet_squat: 0.4, back_squat: 1.3, front_squat: 1.05, leg_press: 2.2,
  db_rdl: 0.42, bb_rdl: 1.15, deadlift: 1.6, kb_deadlift: 0.6, kb_swing: 0.35, cable_pullthrough: 0.6,
  db_reverse_lunge: 0.3, db_bulgarian: 0.28, db_step_up: 0.25, kb_reverse_lunge: 0.3, walking_lunge: 0.28,
  db_floor_press: 0.36, db_bench: 0.4, incline_db: 0.35, bb_bench: 1, machine_chest_press: 0.95,
  db_ohp: 0.27, bb_ohp: 0.62, kb_press: 0.25, machine_shoulder_press: 0.6,
  db_row: 0.45, db_chest_row: 0.35, kb_row: 0.45, bb_row: 0.85, cable_row: 0.8, machine_row: 0.8,
  lat_pulldown: 0.8, cable_pulldown: 0.75, db_pullover: 0.3, cable_crunch: 0.6,
  db_curl: 0.17, hammer_curl: 0.19, incline_curl: 0.14, bb_curl: 0.42, cable_curl: 0.4,
  db_overhead_ext: 0.2, db_skullcrusher: 0.14, cable_pushdown: 0.45, close_bench: 0.85,
  db_lateral: 0.1, cable_lateral: 0.08, db_reverse_fly: 0.09, face_pull: 0.35,
  db_calf_raise: 0.3, machine_calf_raise: 1.5, db_hip_thrust: 0.5, bb_hip_thrust: 1.5,
  leg_curl: 0.55, heel_goblet_squat: 0.33, leg_ext: 0.7, db_fly: 0.2, cable_fly: 0.22, machine_fly: 0.6,
};

const TO_BENCH: Record<BenchmarkLift, number> = { bench: 1, squat: 1 / 1.3, deadlift: 1 / 1.6 };
/** Vorsichtige Bankdrück-Schätzung als Anteil des Körpergewichts, nach Erfahrung. */
const BODY: Record<string, number[]> = { m: [0, 0.45, 0.75, 1.0], f: [0, 0.25, 0.45, 0.65], x: [0, 0.35, 0.6, 0.8] };

/** Geschätztes Bankdrück-Maximum: aus dem Kraftwert, sonst vorsichtig aus Körpergewicht und Erfahrung. */
export function benchEstimate(profile: Profile): number | null {
  if (profile.benchmark && profile.benchmark.oneRm > 0) return profile.benchmark.oneRm * TO_BENCH[profile.benchmark.lift];
  if (profile.weightKg && profile.weightKg > 0) return profile.weightKg * BODY[profile.sex ?? 'x'][profile.level];
  return null;
}

/** Startgewicht für eine Übung ohne Trainingsdaten; null, wenn keine Schätzung möglich ist. */
export function startWeight(ex: Exercise, item: Pick<PlanItem, 'hi'>, profile: Profile): number | null {
  const bench = benchEstimate(profile);
  const ratio = RATIO[ex.id];
  if (!bench || !ratio || ex.load !== 'external') return null;
  // Gewicht, mit dem das obere Wiederholungsziel mit Reserve machbar sein sollte.
  const raw = ((ratio * bench) / (1 + (item.hi + 3) / 30)) * 0.95;
  return Math.max(ex.step, Math.floor(raw / ex.step) * ex.step);
}

export const oneRmFrom = (weight: number, reps: number) => (weight <= 0 || reps <= 0 ? 0 : reps === 1 ? weight : Math.round(weight * (1 + Math.min(reps, 12) / 30)));
