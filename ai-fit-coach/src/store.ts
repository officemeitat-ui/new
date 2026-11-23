import AsyncStorage from '@react-native-async-storage/async-storage';
import { EQUIPMENT } from './engine/equipment';
import { hasExercise } from './engine/exercises';
import { generatePlan } from './engine/plan';
import type { Plan, Profile, Session } from './engine/types';

const KEY = 'aifitcoach.v2';
const OLD_KEY = 'aifitcoach.mvp.v1';

export type AppState = {
  profile: Profile | null;
  plan: Plan | null;
  history: Session[];
  /** Index des nächsten Trainingstags im Plan. */
  nextDay: number;
  /** Name aus einer älteren App-Version, als Vorschlag fürs Onboarding. */
  draftName?: string;
};

export const EMPTY: AppState = { profile: null, plan: null, history: [], nextDay: 0 };

const known = new Set<string>(EQUIPMENT.map((e) => e.id));

function clean(raw: unknown): AppState {
  const data = (raw ?? {}) as Partial<AppState>;
  const p = data.profile;
  const profile: Profile | null = p && typeof p.name === 'string' && Array.isArray(p.equipment)
    ? { ...p, equipment: p.equipment.filter((e) => known.has(e)), limitations: Array.isArray(p.limitations) ? p.limitations : [] }
    : null;
  const history = Array.isArray(data.history) ? data.history.filter((sn) => sn && Array.isArray(sn.exercises)) : [];
  let plan = profile && data.plan && Array.isArray(data.plan.days) ? data.plan : null;
  // Plan aus einer Version mit anderer Übungsbibliothek: neu erstellen statt abstürzen.
  if (profile && (!plan || !plan.days.length || plan.days.some((d) => d.items.some((i) => !hasExercise(i.exerciseId))))) plan = generatePlan(profile);
  const nextDay = plan && Number.isInteger(data.nextDay) ? (data.nextDay as number) % plan.days.length : 0;
  return { profile, plan, history, nextDay };
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

export const saveState = ({ profile, plan, history, nextDay }: AppState) =>
  AsyncStorage.setItem(KEY, JSON.stringify({ profile, plan, history, nextDay }));
