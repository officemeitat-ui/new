import { EQUIPMENT, MACHINES } from './engine/equipment';
import { hasExercise } from './engine/exercises';
import { generatePlan } from './engine/plan';
import type { Plan, Profile, Session, Walk, WeightEntry } from './engine/types';

export type Reminder = { on: boolean; hour: number; minute: number };
export const DEFAULT_REMINDER: Reminder = { on: false, hour: 18, minute: 0 };

export type AppState = {
  profile: Profile | null;
  plan: Plan | null;
  history: Session[];
  /** Körpergewicht im Verlauf, älteste zuerst. */
  weights: WeightEntry[];
  /** Index des nächsten Trainingstags im Plan. */
  nextDay: number;
  /** Eingetragenes Gehen und andere Alltagsbewegung. */
  walks: Walk[];
  reminder: Reminder;
  /** Eigene Notizen je Übung. */
  notes: Record<string, string>;
  /** Name aus einer älteren App-Version, als Vorschlag fürs Onboarding. */
  draftName?: string;
};

export const EMPTY: AppState = { profile: null, plan: null, history: [], weights: [], nextDay: 0, notes: {}, walks: [], reminder: DEFAULT_REMINDER };

const known = new Set<string>(EQUIPMENT.map((e) => e.id));

/** Prüft und repariert gespeicherte oder importierte Daten. */
export function clean(raw: unknown): AppState {
  const data = (raw ?? {}) as Partial<AppState>;
  const p = data.profile;
  const profile: Profile | null = p && typeof p.name === 'string' && Array.isArray(p.equipment)
    ? { ...p, equipment: [...new Set(p.equipment.flatMap((e) => ((e as string) === 'machines' ? MACHINES : [e])))].filter((e) => known.has(e)), limitations: Array.isArray(p.limitations) ? p.limitations : [], focus: Array.isArray(p.focus) ? p.focus : [] }
    : null;
  const history = Array.isArray(data.history) ? data.history.filter((sn) => sn && Array.isArray(sn.exercises)) : [];
  let plan = profile && data.plan && Array.isArray(data.plan.days) ? data.plan : null;
  // Plan aus einer Version mit anderer Übungsbibliothek: neu erstellen statt abstürzen.
  if (profile && (!plan || !plan.days.length || plan.days.some((d) => d.items.some((i) => !hasExercise(i.exerciseId))))) plan = generatePlan(profile);
  const nextDay = plan && Number.isInteger(data.nextDay) ? (data.nextDay as number) % plan.days.length : 0;
  const weights = Array.isArray(data.weights) ? data.weights.filter((w) => w && typeof w.kg === 'number' && typeof w.date === 'string') : [];
  const notes = data.notes && typeof data.notes === 'object' ? data.notes : {};
  const walks = Array.isArray(data.walks) ? data.walks.filter((w) => w && typeof w.minutes === 'number' && typeof w.date === 'string') : [];
  const r = data.reminder;
  const reminder = r && typeof r.hour === 'number' && typeof r.minute === 'number' ? { on: !!r.on, hour: r.hour, minute: r.minute } : DEFAULT_REMINDER;
  return { profile, plan, history, weights, nextDay, notes, walks, reminder };
}

/** Sicherung als Text (JSON). */
export const exportState = ({ profile, plan, history, weights, nextDay, notes, walks, reminder }: AppState) =>
  JSON.stringify({ app: 'ai-fit-coach', version: 1, exportedAt: new Date().toISOString(), profile, plan, history, weights, nextDay, notes, walks, reminder });

/** Liest eine Sicherung; null, wenn der Text keine gültige Sicherung mit Profil ist. */
export function importState(text: string): AppState | null {
  try {
    const raw = JSON.parse(text);
    if (!raw || raw.app !== 'ai-fit-coach') return null;
    const state = clean(raw);
    return state.profile && state.plan ? state : null;
  } catch {
    return null;
  }
}
