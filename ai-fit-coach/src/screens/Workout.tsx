import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { ExerciseGuide, Library } from '../ExerciseGuide';
import { Figure } from '../figure/Figure';
import { equipmentName } from '../engine/equipment';
import { exercise } from '../engine/exercises';
import { alternatives, prescribe } from '../engine/plan';
import { startWeight } from '../engine/startweights';
import { logsFor, newRecords, sessionSets, sessionVolume, suggest } from '../engine/progression';
import type { ExerciseLog, PlanDay, PlanItem, Profile, Session } from '../engine/types';
import { colors as c } from '../theme';
import { Bolt, Button, Card, Eyebrow, Meter, Ring, Sheet, Stepper, Tile, fmt, fmtLoad, s, useConfirm } from '../ui';

type Timer = { kind: 'rest' | 'hold'; until: number; total: number; set?: number };
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec % 60)).padStart(2, '0')}`;
const buzz = (strong = false) => {
  const run = strong ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  run.catch(() => undefined);
};

function startLog(item: PlanItem, history: Session[], profile: Profile): ExerciseLog {
  const ex = exercise(item.exerciseId);
  const sg = suggest(ex, item, logsFor(history, item.exerciseId), startWeight(ex, item, profile));
  return {
    exerciseId: item.exerciseId, lo: item.lo, hi: item.hi, targetSets: item.sets,
    sets: Array.from({ length: item.sets }, () => ({ weight: sg.weight ?? 0, reps: sg.reps, done: false })),
  };
}

type Props = {
  notes: Record<string, string>; setNote: (exerciseId: string, text: string) => void;
  day: PlanDay; profile: Profile; history: Session[];
  onFinish: (session: Session) => void; onCancel: () => void;
  /** Tausch dauerhaft im Plan übernehmen. */
  onSwap: (index: number, exerciseId: string) => void;
};

const itemFor = (profile: Profile, exerciseId: string): PlanItem => {
  const ex = exercise(exerciseId);
  return { exerciseId, slot: ex.pattern, ...prescribe(profile, ex, false) };
};

/** Workout nach Plan oder freies Training: Ohne Übungen wählt man zuerst eine aus dem Katalog. */
export function Workout(props: Props) {
  const [first, setFirst] = useState<PlanItem[] | null>(props.day.items.length ? props.day.items : null);
  if (first) return <Session_ {...props} day={{ ...props.day, items: first }} />;
  return (
    <View style={{ flex: 1 }}>
      <View style={[s.rowBetween, { paddingHorizontal: 24, paddingTop: 16 }]}>
        <Text style={s.eyebrow}>{props.day.name}</Text>
        <Pressable accessibilityRole="button" hitSlop={10} onPress={props.onCancel}><Text style={{ color: c.danger, fontWeight: '700', fontSize: 13 }}>Abbrechen</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.hero}>Womit fängst du an?</Text>
        <Text style={s.muted}>Wähle die erste Übung. Weitere fügst du im Training mit dem Plus hinzu. Gewichte und Bestwerte zählen wie im Plan.</Text>
        <Library profile={props.profile} history={props.history} notes={props.notes} setNote={props.setNote} addLabel="Damit starten" onAdd={(id) => setFirst([itemFor(props.profile, id)])} />
      </ScrollView>
    </View>
  );
}

function Session_({ day, profile, history, onFinish, onCancel, onSwap, notes, setNote }: Props) {
  const confirm = useConfirm();
  const [items, setItems] = useState<PlanItem[]>(day.items);
  const [logs, setLogs] = useState<ExerciseLog[]>(() => day.items.map((i) => startLog(i, history, profile)));
  const [idx, setIdx] = useState(0);
  const [timer, setTimer] = useState<Timer | null>(null);
  const [now, setNow] = useState(Date.now());
  const guided = profile.challenge === 'guidance';
  const [showCue, setShowCue] = useState(guided);
  const [swapOpen, setSwapOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [summary, setSummary] = useState<Session | null>(null);
  const started = useRef(Date.now());
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    activateKeepAwakeAsync('workout').catch(() => undefined);
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => { clearInterval(id); deactivateKeepAwake('workout').catch(() => undefined); };
  }, []);

  const item = items[idx];
  const log = logs[idx];
  const ex = exercise(item.exerciseId);
  const unit = ex.mode === 'time' ? 'Sek.' : 'Wdh.';
  const sg = useMemo(() => suggest(ex, item, logsFor(history, item.exerciseId), startWeight(ex, item, profile)), [ex, item, history, profile]);
  const doneSets = logs.reduce((n, l) => n + l.sets.filter((x) => x.done).length, 0);
  const allSets = logs.reduce((n, l) => n + l.sets.length, 0);
  const remaining = timer ? Math.max(0, Math.ceil((timer.until - now) / 1000)) : 0;

  const patch = (setIndex: number, change: Partial<ExerciseLog['sets'][number]>) =>
    setLogs((old) => old.map((l, i) => (i !== idx ? l : { ...l, sets: l.sets.map((x, j) => (j === setIndex ? { ...x, ...change } : x)) })));

  const complete = (setIndex: number) => {
    const was = log.sets[setIndex];
    // Gewicht und Wiederholungen des erledigten Satzes für die folgenden offenen Sätze übernehmen.
    setLogs((old) => old.map((l, i) => (i !== idx ? l : {
      ...l, sets: l.sets.map((x, j) => (j === setIndex ? { ...x, done: !was.done } : !was.done && j > setIndex && !x.done ? { ...x, weight: was.weight } : x)),
    })));
    if (was.done) return;
    buzz();
    const lastOfAll = idx === items.length - 1 && log.sets.every((x, j) => x.done || j === setIndex);
    setTimer(lastOfAll ? null : { kind: 'rest', until: Date.now() + item.rest * 1000, total: item.rest });
  };

  useEffect(() => {
    if (!timer || timer.until > now) return;
    buzz(true);
    if (timer.kind === 'hold' && timer.set !== undefined) complete(timer.set);
    else setTimer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, timer]);

  const go = (i: number) => { setIdx(i); setShowCue(guided); scroll.current?.scrollTo({ y: 0, animated: true }); };

  const finish = async () => {
    const exercises = logs.filter((l) => l.sets.some((x) => x.done));
    if (!exercises.length) {
      if (await confirm({ title: 'Noch kein Satz erledigt', text: 'Ohne erledigte Sätze wird nichts gespeichert.', yes: 'Workout beenden', no: 'Weitertrainieren', danger: true })) onCancel();
      return;
    }
    if (doneSets < allSets && !(await confirm({ title: 'Workout abschließen?', text: `${doneSets} von ${allSets} Sätzen sind erledigt. Offene Sätze werden nicht gespeichert.`, yes: 'Abschließen', no: 'Weitertrainieren' }))) return;
    setTimer(null);
    setSummary({ id: String(Date.now()), date: new Date().toISOString(), dayId: day.id, dayName: day.name, durationSeconds: Math.round((Date.now() - started.current) / 1000), exercises });
  };

  const swap = (exerciseId: string) => {
    const next = exercise(exerciseId);
    const fresh: PlanItem = { ...item, exerciseId, ...prescribe(profile, next, idx < 2 && next.kind === 'compound'), fallback: next.pattern !== item.slot || undefined };
    setItems((old) => old.map((x, i) => (i === idx ? fresh : x)));
    setLogs((old) => old.map((l, i) => (i === idx ? startLog(fresh, history, profile) : l)));
    onSwap(idx, exerciseId);
    setSwapOpen(false);
    setTimer(null);
  };

  const addItem = (exerciseId: string) => {
    const fresh = itemFor(profile, exerciseId);
    setItems((old) => [...old, fresh]);
    setLogs((old) => [...old, startLog(fresh, history, profile)]);
    setIdx(items.length);
    setLibOpen(false);
    setTimer(null);
  };

  if (summary) {
    const prs = newRecords(summary, history);
    return (
      <ScrollView contentContainerStyle={[s.content, { alignItems: 'stretch' }]}>
        <View style={{ alignItems: 'center' }}><Bolt size={150} /></View>
        <Text style={[s.hero, { textAlign: 'center' }]}>Stark, {profile.name}!</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>{summary.dayName} ist erledigt.</Text>
        <View style={s.row}>
          <Tile icon="time-outline" value={`${Math.max(1, Math.round(summary.durationSeconds / 60))} Min.`} label="Dauer" />
          <Tile icon="checkmark-done-outline" value={String(sessionSets(summary))} label="Sätze" />
          <Tile icon="trending-up-outline" value={fmtLoad(sessionVolume(summary))} label="Bewegt" />
        </View>
        {prs.length ? (
          <Card accent>
            <Eyebrow>Neue Bestwerte</Eyebrow>
            {prs.map((id) => <View key={id} style={s.row}><Ionicons name="trophy" size={18} color={c.lime} /><Text style={s.strong}>{exercise(id).name}</Text></View>)}
          </Card>
        ) : null}
        <Card>
          {summary.exercises.map((l) => {
            const e = exercise(l.exerciseId);
            return (
              <View key={l.exerciseId} style={{ gap: 2 }}>
                <Text style={s.strong}>{e.name}</Text>
                <Text style={s.small}>{l.sets.filter((x) => x.done).map((x) => (e.load === 'external' ? `${fmt(x.weight)} kg × ${x.reps}` : `${x.reps} ${e.mode === 'time' ? 'Sek.' : 'Wdh.'}`)).join('  ·  ')}</Text>
              </View>
            );
          })}
        </Card>
        <Button title="Speichern und fertig" icon="checkmark" onPress={() => onFinish(summary)} />
      </ScrollView>
    );
  }

  const alts = swapOpen ? alternatives(profile, item, { ...day, items }) : [];
  const exDone = log.sets.every((x) => x.done);
  const lastExercise = idx === items.length - 1;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <View style={s.rowBetween}>
          <Text style={s.eyebrow}>{day.name} · {clock(Math.round((now - started.current) / 1000))}</Text>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={async () => { if (await confirm({ title: 'Workout abbrechen?', text: 'Der Fortschritt dieser Einheit wird nicht gespeichert.', yes: 'Abbrechen', no: 'Weitertrainieren', danger: true })) onCancel(); }}>
            <Text style={{ color: c.danger, fontWeight: '700', fontSize: 13 }}>Abbrechen</Text>
          </Pressable>
        </View>
        <Meter value={doneSets} max={allSets} height={5} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {items.map((it, i) => {
            const d = logs[i].sets.every((x) => x.done);
            return (
              <Pressable key={`${it.exerciseId}-${i}`} accessibilityRole="button" accessibilityLabel={`Übung ${i + 1}: ${exercise(it.exerciseId).name}`} onPress={() => go(i)}
                style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: i === idx ? c.lime : d ? c.limeSoft : c.surface2, borderWidth: 1, borderColor: i === idx ? c.lime : d ? c.limeLine : c.border }}>
                {d && i !== idx ? <Ionicons name="checkmark" size={17} color={c.lime} /> : <Text style={{ color: i === idx ? c.background : c.muted, fontWeight: '800' }}>{i + 1}</Text>}
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="button" accessibilityLabel="Übung hinzufügen" onPress={() => setLibOpen(true)}
            style={{ width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.limeLine, borderStyle: 'dashed' }}>
            <Ionicons name="add" size={20} color={c.lime} />
          </Pressable>
        </ScrollView>
      </View>

      <ScrollView ref={scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={{ gap: 6 }}>
          <Text style={s.hero}>{ex.name}</Text>
          <Text style={s.muted}>{item.sets} × {item.lo === item.hi ? item.hi : `${item.lo}–${item.hi}`} {unit}{ex.perSide ? ' je Seite' : ''} · {item.rest} Sek. Pause · {ex.needs.length ? ex.needs.map(equipmentName).join(', ') : 'Körpergewicht'}</Text>
        </View>
        <Card accent>
          <View style={s.row}>
            <Ionicons name={sg.kind === 'up' ? 'trending-up' : sg.kind === 'down' ? 'trending-down' : sg.kind === 'harder' ? 'rocket-outline' : 'flash-outline'} size={18} color={c.lime} />
            <Eyebrow>{sg.kind === 'up' ? 'Steigerung' : sg.kind === 'down' ? 'Neu aufbauen' : sg.kind === 'harder' ? 'Nächste Stufe' : sg.kind === 'start' ? 'Einstieg' : 'Ziel heute'}</Eyebrow>
          </View>
          <Text style={s.text}>{sg.note}</Text>
        </Card>

        <Card>
          {log.sets.map((set, j) => (
            <View key={j} style={[s.rowBetween, { opacity: set.done ? 0.6 : 1 }]}>
              <Text style={[s.strong, { width: 18, color: c.muted }]}>{j + 1}</Text>
              {ex.load === 'external' ? (
                <View style={{ alignItems: 'center', gap: 2 }}>
                  <Stepper label={`Satz ${j + 1} Gewicht in kg`} value={set.weight} step={ex.step} onChange={(v) => patch(j, { weight: v })} />
                  <Text style={s.tiny}>{ex.needs.includes('dumbbells') ? 'kg je Hantel' : 'kg'}</Text>
                </View>
              ) : null}
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Stepper label={`Satz ${j + 1} ${unit}`} value={set.reps} step={ex.mode === 'time' ? 5 : 1} onChange={(v) => patch(j, { reps: Math.round(v) })} />
                <Text style={s.tiny}>{unit}</Text>
              </View>
              {ex.mode === 'time' && !set.done ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Satz ${j + 1} Zeit starten`} onPress={() => setTimer({ kind: 'hold', until: Date.now() + set.reps * 1000, total: set.reps, set: j })}
                  style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border }}>
                  <Ionicons name="play" size={18} color={c.lime} />
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: set.done }} accessibilityLabel={`Satz ${j + 1} erledigt`} onPress={() => complete(j)}
                style={{ width: 48, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: set.done ? c.lime : c.surface2, borderWidth: 1, borderColor: set.done ? c.lime : c.limeLine }}>
                <Ionicons name="checkmark" size={22} color={set.done ? c.background : c.lime} />
              </Pressable>
            </View>
          ))}
          <View style={[s.rowBetween, { marginTop: 4 }]}>
            <Button small variant="ghost" icon="add" title="Satz" onPress={() => setLogs((old) => old.map((l, i) => (i === idx ? { ...l, sets: [...l.sets, { ...l.sets[l.sets.length - 1], done: false }] } : l)))} />
            {log.sets.length > 1 ? <Button small variant="ghost" icon="remove" title="Satz" onPress={() => setLogs((old) => old.map((l, i) => (i === idx ? { ...l, sets: l.sets.slice(0, -1) } : l)))} /> : null}
            <Button small variant="ghost" icon="swap-horizontal" title="Tauschen" onPress={() => setSwapOpen(true)} />
          </View>
        </Card>

        <Card>
          <View style={s.row}>
            <Figure ex={ex} size={showCue ? 150 : 96} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={s.text}>{ex.cue}</Text>
              {notes[ex.id] ? <Text style={[s.small, { color: c.lime }]}>Notiz: {notes[ex.id]}</Text> : null}
            </View>
          </View>
          <Button small variant="secondary" icon="book-outline" title="Anleitung und Verlauf" onPress={() => setGuideOpen(true)} />
        </Card>
      </ScrollView>

      {timer ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 20, backgroundColor: '#141C10', borderWidth: 1, borderColor: c.limeLine }}>
          <Ring size={64} stroke={6} progress={timer.total ? remaining / timer.total : 0} color={timer.kind === 'hold' ? c.warn : c.lime}>
            <Text accessibilityLiveRegion="polite" style={{ color: c.text, fontWeight: '900', fontSize: 17, fontVariant: ['tabular-nums'] }}>{clock(remaining)}</Text>
          </Ring>
          <View style={{ flex: 1 }}>
            <Text style={s.strong}>{timer.kind === 'hold' ? 'Halten' : 'Pause'}</Text>
            <Text style={s.small}>{timer.kind === 'hold' ? 'Spannung halten, ruhig atmen.' : exDone && !lastExercise ? `Danach: ${exercise(items[idx + 1].exerciseId).name}` : 'Durchatmen, locker bleiben.'}</Text>
          </View>
          {timer.kind === 'rest' ? <Button small variant="secondary" title="+15" onPress={() => setTimer({ ...timer, until: timer.until + 15000, total: timer.total + 15 })} /> : null}
          <Button small variant="secondary" title={timer.kind === 'hold' ? 'Stopp' : 'Weiter'} onPress={() => setTimer(null)} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 24, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.border }}>
        {idx > 0 ? <View style={{ flex: 1 }}><Button variant="secondary" title="Zurück" onPress={() => go(idx - 1)} /></View> : null}
        <View style={{ flex: 2 }}>
          {lastExercise
            ? <Button title={idx > 0 ? "Abschließen" : "Workout abschließen"} icon="flag" onPress={finish} />
            : <Button variant={exDone ? 'primary' : 'secondary'} title="Nächste Übung" icon="arrow-forward" onPress={() => go(idx + 1)} />}
        </View>
      </View>
      {!lastExercise && doneSets > 0 ? <Pressable accessibilityRole="button" onPress={finish} style={{ paddingBottom: 12, alignItems: 'center' }}><Text style={[s.small, { color: c.muted, fontWeight: '700' }]}>Vorzeitig abschließen</Text></Pressable> : null}

      <Sheet visible={guideOpen} onClose={() => setGuideOpen(false)} title={ex.name}>
        <ExerciseGuide ex={ex} history={history} note={notes[ex.id] ?? ''} setNote={(t) => setNote(ex.id, t)} />
      </Sheet>
      <Sheet visible={libOpen} onClose={() => setLibOpen(false)} title="Übung hinzufügen">
        <Text style={s.small}>Gilt nur für diese Einheit. Dauerhaft änderst du den Plan im Tab „Training“.</Text>
        <Library profile={profile} history={history} notes={notes} setNote={setNote} taken={items.map((i) => i.exerciseId)} addLabel="Zur Einheit hinzufügen" onAdd={addItem} />
      </Sheet>
      <Sheet visible={swapOpen} onClose={() => setSwapOpen(false)} title="Übung tauschen">
        <Text style={s.muted}>Passend zu deinem Equipment, beste Wahl zuerst. Der Tausch gilt auch für die nächsten Wochen.</Text>
        {alts.length ? alts.map((a) => (
          <Pressable key={a.id} accessibilityRole="button" onPress={() => swap(a.id)} style={s.option}>
            <View style={{ flex: 1 }}>
              <Text style={s.strong}>{a.name}</Text>
              <Text style={s.small}>{a.needs.length ? a.needs.map(equipmentName).join(', ') : 'Körpergewicht'} · {['', 'leicht', 'mittel', 'anspruchsvoll'][a.level]}</Text>
            </View>
            <Ionicons name="swap-horizontal" size={20} color={c.lime} />
          </Pressable>
        )) : <Text style={s.muted}>Mit deinem Equipment gibt es für diesen Platz keine weitere Übung.</Text>}
      </Sheet>
    </View>
  );
}
