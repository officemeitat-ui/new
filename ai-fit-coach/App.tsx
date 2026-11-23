import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { addExercise, generatePlan, removeExercise, swapExercise } from './src/engine/plan';
import type { Profile, Session } from './src/engine/types';
import { Nutrition } from './src/screens/Nutrition';
import { Onboarding } from './src/screens/Onboarding';
import { Coach, Home, Message, ProfileTab, Progress, Shared, Training } from './src/screens/Tabs';
import { Workout } from './src/screens/Workout';
import { defaultTrainDays } from './src/engine/progression';
import { syncReminders } from './src/services/reminders';
import { AppState, EMPTY, exportState, importState, loadState, saveState } from './src/store';
import { colors as c } from './src/theme';
import { Bolt, ConfirmProvider, IconName, s } from './src/ui';

type Tab = 'Home' | 'Training' | 'Essen' | 'Coach' | 'Fortschritt' | 'Profil';
const TABS: { name: Tab; icon: IconName; active: IconName }[] = [
  { name: 'Home', icon: 'home-outline', active: 'home' },
  { name: 'Training', icon: 'barbell-outline', active: 'barbell' },
  { name: 'Essen', icon: 'restaurant-outline', active: 'restaurant' },
  { name: 'Coach', icon: 'sparkles-outline', active: 'sparkles' },
  { name: 'Fortschritt', icon: 'stats-chart-outline', active: 'stats-chart' },
  { name: 'Profil', icon: 'person-outline', active: 'person' },
];

function AppContent() {
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<AppState>(EMPTY);
  const [saveFailed, setSaveFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('Home');
  const [editing, setEditing] = useState(false);
  const [workoutDay, setWorkoutDay] = useState<number | 'free' | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => { loadState().then(setState).catch(() => setSaveFailed(true)).finally(() => setLoaded(true)); }, []);
  const [reminderStatus, setReminderStatus] = useState<string>('');
  const remindDays = state.profile ? (state.profile.trainDays?.length ? state.profile.trainDays : defaultTrainDays(state.profile.daysPerWeek)) : [];
  const remindKey = `${state.reminder.on}-${state.reminder.hour}-${state.reminder.minute}-${remindDays.join('')}-${state.profile?.name ?? ''}`;
  useEffect(() => {
    if (!loaded || !state.profile) return;
    syncReminders(state.reminder, remindDays, state.profile.name).then((r) => {
      setReminderStatus(r);
      if (r === 'denied' || r === 'error') setState((old) => (old.reminder.on ? { ...old, reminder: { ...old.reminder, on: false } } : old));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, remindKey]);
  useEffect(() => { if (loaded) saveState(state).then(() => setSaveFailed(false)).catch(() => setSaveFailed(true)); }, [state, loaded]);

  if (!loaded) return <View style={st.center}><Bolt size={140} /><Text style={s.muted}>AI FIT COACH lädt …</Text></View>;

  const { profile, plan, history, nextDay } = state;
  if (!profile || !plan || editing) {
    return (
      <Onboarding initial={editing ? profile : null} draftName={state.draftName} onCancel={editing ? () => setEditing(false) : undefined}
        onDone={(p: Profile) => {
          setState((old) => {
            const last = old.weights[old.weights.length - 1];
            const weights = p.weightKg && (!last || Math.abs(last.kg - p.weightKg) > 0.05) ? [...old.weights, { date: new Date().toISOString(), kg: p.weightKg }] : old.weights;
            return { ...old, profile: p, plan: generatePlan(p), nextDay: 0, weights, draftName: undefined };
          });
          setEditing(false); setTab('Home');
        }} />
    );
  }

  const setNote = (exerciseId: string, text: string) => setState((old) => ({ ...old, notes: { ...old.notes, [exerciseId]: text } }));
  if (workoutDay !== null) {
    const free = workoutDay === 'free';
    const day = free ? { id: 'frei', name: 'Freies Training', focus: '', items: [], minutes: 0 } : plan.days[workoutDay];
    return (
      <Workout day={day} profile={profile} history={history}
        notes={state.notes} setNote={setNote}
        onCancel={() => setWorkoutDay(null)}
        onSwap={(index, exerciseId) => setState((old) => (old.plan && old.profile ? { ...old, plan: swapExercise(old.plan, old.profile, day.id, index, exerciseId) } : old))}
        onFinish={(session: Session) => {
          setState((old) => ({ ...old, history: [session, ...old.history], nextDay: free || !old.plan ? old.nextDay : ((workoutDay as number) + 1) % old.plan.days.length }));
          setWorkoutDay(null);
          setTab('Fortschritt');
        }} />
    );
  }

  const shared: Shared = {
    profile, plan, history, nextDay,
    start: setWorkoutDay,
    startFree: () => setWorkoutDay('free'),
    swap: (dayId, index, exerciseId) => setState((old) => (old.plan && old.profile ? { ...old, plan: swapExercise(old.plan, old.profile, dayId, index, exerciseId) } : old)),    notes: state.notes, setNote,
    add: (dayId, exerciseId) => setState((old) => (old.plan && old.profile ? { ...old, plan: addExercise(old.plan, old.profile, dayId, exerciseId) } : old)),
    remove: (dayId, index) => setState((old) => (old.plan ? { ...old, plan: removeExercise(old.plan, dayId, index) } : old)),
  };

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView key={tab} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.rowBetween}>
            <Text style={s.brand}>AI FIT COACH</Text>
            {saveFailed ? <Text style={[s.small, { color: c.danger }]}>Speichern fehlgeschlagen</Text> : null}
          </View>
          {tab === 'Home' && <Home {...shared} goTo={setTab} weights={state.weights} walks={state.walks} addWalk={(minutes, kmh) => setState((old) => ({ ...old, walks: [...old.walks, { date: new Date().toISOString(), minutes, kmh }] }))} />}
          {tab === 'Training' && <Training {...shared} regenerate={() => setState((old) => (old.profile ? { ...old, plan: generatePlan(old.profile), nextDay: 0 } : old))} />}
          {tab === 'Essen' && <Nutrition profile={profile} edit={() => setEditing(true)} setVegetarian={(v) => setState((old) => (old.profile ? { ...old, profile: { ...old.profile, vegetarian: v } } : old))} />}
          {tab === 'Coach' && <Coach {...shared} messages={messages} setMessages={setMessages} />}
          {tab === 'Fortschritt' && <Progress {...shared} removeSession={(id) => setState((old) => ({ ...old, history: old.history.filter((sn) => sn.id !== id) }))} weights={state.weights} addWeight={(kg) => setState((old) => ({ ...old, weights: [...old.weights, { date: new Date().toISOString(), kg }] }))} />}
          {tab === 'Profil' && <ProfileTab {...shared} edit={() => setEditing(true)} clearHistory={() => setState((old) => ({ ...old, history: [], weights: [], walks: [], nextDay: 0 }))} resetAll={() => { setState(EMPTY); setMessages([]); setTab('Home'); }} reminder={state.reminder} setReminder={(reminder) => setState((old) => ({ ...old, reminder }))} reminderStatus={reminderStatus} backup={() => exportState(state)} restore={(text) => { const next = importState(text); if (next) setState(next); return !!next; }} />}
        </ScrollView>
      </KeyboardAvoidingView>
      <View accessibilityRole="tablist" style={st.tabBar}>
        {TABS.map((t) => {
          const on = tab === t.name;
          return (
            <Pressable accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.name} key={t.name} onPress={() => setTab(t.name)} style={st.tab}>
              <View style={[st.tabIcon, on && { backgroundColor: c.limeSoft }]}><Ionicons name={on ? t.active : t.icon} size={21} color={on ? c.lime : c.muted} /></View>
              <Text style={[st.tabLabel, on && { color: c.lime }]}>{t.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <View style={st.outer}>
        <SafeAreaView style={st.root}>
          <StatusBar style="light" />
          <ConfirmProvider><AppContent /></ConfirmProvider>
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  outer: { flex: 1, backgroundColor: '#050605', alignItems: 'center' },
  // Im Browser auf großen Bildschirmen als Handy-Spalte darstellen.
  root: { flex: 1, width: '100%', maxWidth: 520, backgroundColor: c.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.surface, paddingTop: 8, paddingBottom: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 3, minHeight: 48 },
  tabIcon: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14 },
  tabLabel: { color: c.muted, fontSize: 10, fontWeight: '700' },
});
