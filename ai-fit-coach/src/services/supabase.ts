import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const supabase = url && anonKey ? createClient(url, anonKey, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
}) : null;

/** Fragt den KI-Coach am Server. Wirft, wenn Supabase fehlt oder niemand angemeldet ist. */
export async function askCoach(question: string, context?: string): Promise<string> {
  if (!supabase) throw new Error('Supabase ist noch nicht konfiguriert.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Bitte zuerst anmelden.');
  const { data, error } = await supabase.functions.invoke('coach', { body: { question, context } });
  if (error) throw error;
  if (typeof data?.answer !== 'string' || !data.answer.trim()) throw new Error('Ungültige Coach-Antwort.');
  return data.answer;
}
