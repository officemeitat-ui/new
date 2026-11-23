import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { generatePlan, swapExercise } from './src/engine/plan';
import type { Profile, Session } from './src/engine/types';
import { Onboarding } from './src/screens/Onboarding';
import { Coach, Home, Message, ProfileTab, Progress, Shared, Training } from './src/screens/Tabs';
import { Workout } from './src/screens/Workout';
import { AppState, EMPTY, loadState, saveState } from './src/store';
import { colors as c } from './src/theme';
import { Bolt, ConfirmProvider, IconName, s } from './src/ui';

type Tab = 'Home' | 'Training' | 'Coach' | 'Fortschritt' | 'Profil';
const TABS: { name: Tab; icon: IconName; active: IconName }[] = [
  { name: 'Home', icon: 'home-outline', active: 'home' },
  { name: 'Training', icon: 'barbell-outline', active: 'barbell' },
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
  const [workoutDay, setWorkoutDay] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => { loadState().then(setState).catch(() => setSaveFailed(true)).finally(() => setLoaded(true)); }, []);
  useEffect(() => { if (loaded) saveState(state).then(() => setSaveFailed(false)).catch(() => setSaveFailed(true)); }, [state, loaded]);

  if (!loaded) return <View style={st.center}><Bolt size={140} /><Text style={s.muted}>AI FIT COACH lädt …</Text></View>;

  const { profile, plan, history, nextDay } = state;
  if (!profile || !plan || editing) {
    return (
      <Onboarding initial={editing ? profile : null} draftName={state.draftName} onCancel={editing ? () => setEditing(false) : undefined}
        onDone={(p: Profile) => { setState((old) => ({ ...old, profile: p, plan: generatePlan(p), nextDay: 0, draftName: undefined })); setEditing(false); setTab('Home'); }} />
    );
  }

  if (workoutDay !== null) {
    const day = plan.days[workoutDay];
    return (
      <Workout day={day} profile={profile} history={history}
        onCancel={() => setWorkoutDay(null)}
        onSwap={(index, exerciseId) => setState((old) => (old.plan && old.profile ? { ...old, plan: swapExercise(old.plan, old.profile, day.id, index, exerciseId) } : old))}
        onFinish={(session: Session) => {
          setState((old) => ({ ...old, history: [session, ...old.history], nextDay: old.plan ? (workoutDay + 1) % old.plan.days.length : 0 }));
          setWorkoutDay(null);
          setTab('Fortschritt');
        }} />
    );
  }

  const shared: Shared = {
    profile, plan, history, nextDay,
    start: setWorkoutDay,
    swap: (dayId, index, exerciseId) => setState((old) => (old.plan && old.profile ? { ...old, plan: swapExercise(old.plan, old.profile, dayId, index, exerciseId) } : old)),
  };

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView key={tab} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.rowBetween}>
            <Text style={s.brand}>AI FIT COACH</Text>
            {saveFailed ? <Text style={[s.small, { color: c.danger }]}>Speichern fehlgeschlagen</Text> : null}
          </View>
          {tab === 'Home' && <Home {...shared} goTo={setTab} />}
          {tab === 'Training' && <Training {...shared} regenerate={() => setState((old) => (old.profile ? { ...old, plan: generatePlan(old.profile), nextDay: 0 } : old))} />}
          {tab === 'Coach' && <Coach {...shared} messages={messages} setMessages={setMessages} />}
          {tab === 'Fortschritt' && <Progress {...shared} removeSession={(id) => setState((old) => ({ ...old, history: old.history.filter((sn) => sn.id !== id) }))} />}
          {tab === 'Profil' && <ProfileTab {...shared} edit={() => setEditing(true)} clearHistory={() => setState((old) => ({ ...old, history: [], nextDay: 0 }))} resetAll={() => { setState(EMPTY); setMessages([]); setTab('Home'); }} />}
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
  tabIcon: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 14 },
  tabLabel: { color: c.muted, fontSize: 10.5, fontWeight: '700' },
});
