import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, EMPTY, clean } from './state';

export * from './state';

const KEY = 'aifitcoach.v2';
const OLD_KEY = 'aifitcoach.mvp.v1';

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

export const saveState = ({ profile, plan, history, weights, nextDay, notes, walks, reminder, mealLog }: AppState) =>
  AsyncStorage.setItem(KEY, JSON.stringify({ profile, plan, history, weights, nextDay, notes, walks, reminder, mealLog }));
