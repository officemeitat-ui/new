import AsyncStorage from '@react-native-async-storage/async-storage';
import { EQUIPMENT, MACHINES } from './engine/equipment';
import { hasExercise } from './engine/exercises';
import { generatePlan } from './engine/plan';
import type { Plan, Profile, Session, Walk, WeightEntry } from './engine/types';

const KEY = 'aifitcoach.v2';
const OLD_KEY = 'aifitcoach.mvp.v1';

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
  /** Eigene Notizen je Übung. */
  notes: Record<string, string>;
  /** Name aus einer älteren App-Version, als Vorschlag fürs Onboarding. */
  draftName?: string;
};

export const EMPTY: AppState = { profile: null, plan: null, history: [], weights: [], nextDay: 0, notes: {}, walks: [] };

const known = new Set<string>(EQUIPMENT.map((e) => e.id));

function clean(raw: unknown): AppState {
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
  return { profile, plan, history, weights, nextDay, notes, walks };
}

export async function loadState(): Promise<AppState> {
  const raw = await AsyncStorage.getItem(KEY);
  if (raw) return clean(JSON.parse(raw));
  const old = await AsyncStorage.getItem(OLD_KEY);
  if (old) {
    const name = JSON.parse(old)?.profile?.name;
    if (typeof name === 'string') return { ...EMPTY, draftName: name };
  }
  return EMPTY;
}

export const saveState = ({ profile, plan, history, weights, nextDay, notes, walks }: AppState) =>
  AsyncStorage.setItem(KEY, JSON.stringify({ profile, plan, history, weights, nextDay, notes, walks }));
