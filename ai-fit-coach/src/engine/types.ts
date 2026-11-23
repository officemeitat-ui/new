export type EquipmentId =
  | 'dumbbells' | 'barbell' | 'rack' | 'bench' | 'pullup_bar' | 'dip_bars'
  | 'kettlebell' | 'bands' | 'trx' | 'cable' | 'cardio'
  | 'leg_press' | 'lat_machine' | 'row_m' | 'chest_press_m' | 'fly_m' | 'shoulder_press_m' | 'leg_curl_m' | 'leg_ext_m' | 'back_ext_m';

export type Goal = 'Muskelaufbau' | 'Fettabbau' | 'Kraft' | 'Allgemeine Fitness';
export type Level = 1 | 2 | 3;
export type Limitation = 'knee' | 'shoulder' | 'back';

export type Muscle =
  | 'Brust' | 'Rücken' | 'Schultern' | 'Bizeps' | 'Trizeps'
  | 'Quadrizeps' | 'Beinbeuger' | 'Gesäß' | 'Waden' | 'Rumpf';

export type Pattern =
  | 'squat' | 'hinge' | 'lunge' | 'push_h' | 'push_v' | 'pull_h' | 'pull_v' | 'core'
  | 'biceps' | 'triceps' | 'delts_side' | 'delts_rear' | 'calves' | 'glutes'
  | 'hamstring_iso' | 'quad_iso' | 'chest_iso' | 'conditioning';

export type Exercise = {
  id: string;
  name: string;
  pattern: Pattern;
  primary: Muscle[];
  secondary: Muscle[];
  /** Alles davon wird gebraucht. Leer = nur Körpergewicht. */
  needs: EquipmentId[];
  level: Level;
  kind: 'compound' | 'isolation';
  mode: 'reps' | 'time';
  /** external = Gewicht wird eingetragen, bodyweight = nur Wiederholungen. */
  load: 'external' | 'bodyweight';
  /** Kleinster sinnvoller Gewichtssprung in kg. */
  step: number;
  /** Reizqualität 1–5: wie gut sich die Übung belasten und steigern lässt. */
  quality: number;
  perSide?: boolean;
  stress?: Limitation[];
  /** Schwerere Variante, wenn das obere Ende des Wiederholungsbereichs erreicht ist. */
  harder?: string;
  cue: string;
};

export type Profile = {
  name: string;
  goal: Goal;
  level: Level;
  daysPerWeek: number;
  minutes: number;
  equipment: EquipmentId[];
  limitations: Limitation[];
  /** Muskelgruppen, die mehr Volumen bekommen. Leer = ganzer Körper gleichmäßig. */
  focus?: FocusArea[];
  sex?: 'm' | 'f' | null;
  heightCm?: number | null;
  weightKg?: number | null;
  targetKg?: number | null;
  /** Geschätztes Maximum für eine Wiederholung in einer Grundübung. */
  benchmark?: { lift: BenchmarkLift; oneRm: number } | null;
  challenge?: Challenge | null;
};

export type FocusArea = 'Rücken' | 'Schultern' | 'Arme' | 'Brust' | 'Bauch' | 'Gesäß' | 'Beine';
export type BenchmarkLift = 'bench' | 'squat' | 'deadlift';
export type Challenge = 'motivation' | 'guidance' | 'variety';
export type WeightEntry = { date: string; kg: number };

export type PlanItem = {
  exerciseId: string;
  /** Bewegungsmuster des Platzes im Plan (für den Übungstausch). */
  slot: Pattern;
  sets: number;
  lo: number;
  hi: number;
  rest: number;
  /** true, wenn für das eigentliche Muster keine Übung möglich war. */
  fallback?: boolean;
  /** Trifft einen gewählten Schwerpunkt: ein Satz mehr, wird zuletzt gekürzt. */
  focus?: boolean;
};

export type PlanDay = { id: string; name: string; focus: string; items: PlanItem[]; minutes: number };

export type Plan = {
  createdAt: string;
  split: string;
  days: PlanDay[];
  /** 0–100: wie gut das vorhandene Equipment den Plan trägt. */
  score: number;
  notes: string[];
};

export type SetLog = { weight: number; reps: number; done: boolean };
export type ExerciseLog = { exerciseId: string; lo: number; hi: number; targetSets: number; sets: SetLog[] };
export type Session = {
  id: string;
  date: string;
  dayId: string;
  dayName: string;
  durationSeconds: number;
  exercises: ExerciseLog[];
};
