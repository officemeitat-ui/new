import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ExerciseGuide, Library, Thumb } from '../ExerciseGuide';
import { QUICK_QUESTIONS, coachContext, localCoach } from '../coach';
import { equipmentName } from '../engine/equipment';
import { PATTERN_NAME, exercise } from '../engine/exercises';
import { MUSCLE_ORDER, alternatives, upgrades, weeklyVolume } from '../engine/plan';
import { defaultTrainDays, doneWeekdays, weekMinutes, weekReview, weekdayIndex } from '../engine/progression';
import { activeWeeks, logsFor, muscleSets, records, sessionSets, sessionVolume, sessionsThisWeek, suggest, weeklyCounts } from '../engine/progression';
import { walkKcal } from '../engine/nutrition';
import { startWeight } from '../engine/startweights';
import type { Plan, PlanDay, Profile, Session, Walk, WeightEntry } from '../engine/types';
import { remindersSupported } from '../services/reminders';
import type { Reminder } from '../state';
import { askCoach, supabase } from '../services/supabase';
import { colors as c } from '../theme';
import { Bars, Bolt, Button, Card, Chip, Entrance, Eyebrow, H, Meter, Sheet, Sparkline, Stepper, Tile, fmt, fmtLoad, s, useConfirm } from '../ui';

export type Shared = {
  profile: Profile; plan: Plan; history: Session[]; nextDay: number;
  start: (dayIndex: number) => void;
  startFree: () => void;
  swap: (dayId: string, index: number, exerciseId: string) => void;
  notes: Record<string, string>;
  setNote: (exerciseId: string, text: string) => void;
  add: (dayId: string, exerciseId: string) => void;
  remove: (dayId: string, index: number) => void;
};

const LEVEL = ['', 'Einsteiger', 'Fortgeschritten', 'Erfahren'];
const range = (lo: number, hi: number) => (lo === hi ? `${hi}` : `${lo}–${hi}`);
const day = (iso: string) => new Date(iso).toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'short' });

export function Home({ profile, plan, history, nextDay, start, startFree, goTo, weights, walks, addWalk, walkStart, setWalkStart }: Shared & { goTo: (tab: 'Training' | 'Coach' | 'Profil' | 'Fortschritt') => void; weights: WeightEntry[]; walks: Walk[]; addWalk: (minutes: number, kmh?: number) => void; walkStart: number | null; setWalkStart: (t: number | null) => void }) {
  const [walkMin, setWalkMin] = useState(20);
  const planned = profile.trainDays?.length ? profile.trainDays : defaultTrainDays(profile.daysPerWeek);
  const doneDays = doneWeekdays(history);
  const todayIdx = weekdayIndex(new Date());
  const walked = weekMinutes(walks);
  const hasPad = profile.equipment.includes('walkpad');
  const [walkKmh, setWalkKmh] = useState(3);
  const [breakOpen, setBreakOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [tick, setTick] = useState(Date.now());
  useEffect(() => { if (!walkStart) return; setTick(Date.now()); const id = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(id); }, [walkStart]);
  const weekStartMs = new Date().getTime() - weekdayIndex(new Date()) * 86400000 - (new Date().getHours() * 3600 + new Date().getMinutes() * 60) * 1000;
  const kcalWeek = profile.weightKg ? walks.filter((w) => new Date(w.date).getTime() >= weekStartMs).reduce((n, w) => n + walkKcal(profile.weightKg as number, w.minutes, w.kmh ?? 4.5), 0) : 0;
  const today = plan.days[nextDay];
  const week = sessionsThisWeek(history).length;
  const up = useMemo(() => upgrades(profile), [profile]);
  const weeks = activeWeeks(history);
  const hour = new Date().getHours();
  return <>
    <Text style={s.hero}>{hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend'}, {profile.name}</Text>
    <Entrance>
      <Card accent style={{ overflow: 'hidden' }}>
        <View style={{ position: 'absolute', right: -34, top: -26, opacity: 0.9 }}><Bolt size={170} /></View>
        <Eyebrow>Heute dran</Eyebrow>
        <Text style={[s.hero, { fontSize: 26, maxWidth: '72%' }]}>{today.name}</Text>
        <Text style={[s.muted, { maxWidth: '70%' }]}>{today.focus}</Text>
        <Text style={s.small}>{today.items.length} Übungen · ca. {today.minutes} Min. · {today.items.reduce((n, i) => n + i.sets, 0)} Sätze</Text>
        <View style={{ gap: 4, marginVertical: 4 }}>
          {today.items.slice(0, 4).map((i, k) => <Text key={k} style={s.text}>{exercise(i.exerciseId).name} <Text style={s.small}>{i.sets} × {range(i.lo, i.hi)}</Text></Text>)}
          {today.items.length > 4 ? <Text style={s.small}>+ {today.items.length - 4} weitere</Text> : null}
        </View>
        <Button title="Workout starten" icon="flash" onPress={() => start(nextDay)} />
        <Button small variant="ghost" icon="create-outline" title="Freies Training ohne Plan" onPress={startFree} />
      </Card>
    </Entrance>
    <Entrance delay={80}>
      <Card>
        <View style={s.rowBetween}><H>Diese Woche</H><Text style={s.strong}>{week} / {profile.daysPerWeek}</Text></View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d, i) => {
            const done = doneDays.includes(i);
            const plan_ = planned.includes(i);
            return (
              <View key={d} accessibilityLabel={`${d}: ${done ? 'trainiert' : plan_ ? 'Trainingstag' : 'frei'}`} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <View style={{ width: '100%', height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? c.lime : plan_ ? c.limeSoft : c.surface2, borderWidth: i === todayIdx ? 2 : 1, borderColor: i === todayIdx ? c.text : done ? c.lime : plan_ ? c.limeLine : c.border }}>
                  {done ? <Ionicons name="checkmark" size={18} color={c.background} /> : plan_ ? <Ionicons name="barbell-outline" size={15} color={c.lime} /> : null}
                </View>
                <Text style={[s.tiny, i === todayIdx && { color: c.text, fontWeight: '800' }]}>{d}</Text>
              </View>
            );
          })}
        </View>
        <Text style={s.small}>{week >= profile.daysPerWeek ? 'Wochenziel erreicht. Erholung gehört zum Plan.'
          : doneDays.includes(todayIdx) ? 'Heute schon trainiert. Stark.'
          : planned.includes(todayIdx) ? `Heute ist Trainingstag: ${plan.days[nextDay].name}.`
          : `Heute ist frei. Nächste Einheit: ${plan.days[nextDay].name}. Vorziehen geht jederzeit.`}</Text>
      </Card>
    </Entrance>
    {profile.gentle ? (() => {
      const current = weights.length ? weights[weights.length - 1].kg : profile.weightKg ?? null;
      const first = weights.length ? weights[0].kg : current;
      const lost = current !== null && first !== null ? Math.round((first - current) * 10) / 10 : 0;
      return (
        <Entrance delay={120}>
          <Card accent>
            <Eyebrow>Dein Abnehm-Plan</Eyebrow>
            {current !== null ? <View style={s.rowBetween}>
              <Text style={s.tileValue}>{fmt(current)} kg</Text>
              <Text style={s.small}>{lost > 0 ? `${fmt(lost)} kg geschafft` : 'Startgewicht'}{profile.targetKg ? ` · Ziel ${fmt(profile.targetKg)} kg` : ''}</Text>
            </View> : null}
            {current !== null && profile.targetKg && first !== null && first > profile.targetKg ? <Meter value={Math.max(0, first - current)} max={first - profile.targetKg} /> : null}
            <Text style={s.text}>{current !== null ? `Gut haltbar sind ${fmt(Math.round(current * 0.005 * 10) / 10)}–${fmt(Math.round(current * 0.01 * 10) / 10)} kg pro Woche. Schneller muss es nicht sein.` : 'Gut haltbar sind 0,5–1 % des Körpergewichts pro Woche.'}</Text>
            <Button small variant="secondary" icon="scale-outline" title="Gewicht eintragen" onPress={() => goTo('Fortschritt')} />
          </Card>
        </Entrance>
      );
    })() : null}
    {profile.gentle || (profile.activity ?? 'sitting') === 'sitting' || hasPad ? (
      <Entrance delay={140}>
        <Card>
          <Eyebrow>{hasPad ? 'Gehpad und Alltagsbewegung' : 'Bewegung im Alltag'}</Eyebrow>
          <View style={s.rowBetween}><Text style={s.strong}>Gehen diese Woche</Text><Text style={s.strong}>{walked} / 150 Min.</Text></View>
          <Meter value={walked} max={150} />
          <View style={s.rowBetween}>
            <View style={s.row}><Stepper label="Minuten gegangen" value={walkMin} step={5} min={5} max={240} onChange={(v) => setWalkMin(Math.round(v))} /><Text style={s.small}>Min.</Text></View>
            {hasPad ? <View style={s.row}><Stepper label="Tempo in km/h" value={walkKmh} step={0.5} min={2} max={6.5} onChange={setWalkKmh} /><Text style={s.small}>km/h</Text></View> : null}
          </View>
          <Button small variant="secondary" icon="walk-outline" title={profile.weightKg ? `Gehen eintragen (ca. ${walkKcal(profile.weightKg, walkMin, hasPad ? walkKmh : 4.5)} kcal)` : 'Gehen eintragen'} onPress={() => addWalk(walkMin, hasPad ? walkKmh : undefined)} />
          <Text style={s.small}>{hasPad
            ? 'Im Büro: 2–3 km/h bei Telefonaten und Lesen, 20–30 Minuten am Stück, mehrmals am Tag. Für Fettverbrennung zusätzlich 4–5,5 km/h nach der Arbeit. Tippen geht bei bis zu 3 km/h noch gut.'
            : '150 Minuten zügige Bewegung pro Woche sind die gängige Empfehlung. Jede Etappe ab ein paar Minuten zählt.'}</Text>
          {kcalWeek ? <Text style={s.small}>Diese Woche durch Gehen: ca. {kcalWeek} kcal (Schätzung).</Text> : null}
          <Button small variant={walkStart ? 'primary' : 'secondary'} icon="timer-outline" title={walkStart ? `Geh-Timer läuft · ${Math.floor((tick - walkStart) / 60000)} Min.` : 'Geh-Timer starten'} onPress={() => { if (!walkStart) setWalkStart(Date.now()); setTimerOpen(true); }} />
          <Button small variant="ghost" icon="body-outline" title="5-Minuten-Ausgleich fürs Büro" onPress={() => setBreakOpen(true)} />
        </Card>
      </Entrance>
    ) : null}
    <Sheet visible={timerOpen} onClose={() => setTimerOpen(false)} title="Geh-Timer">
      {walkStart ? (() => {
        const sec = Math.max(0, Math.floor((tick - walkStart) / 1000));
        const min = Math.max(1, Math.round(sec / 60));
        return <>
          <Text style={[s.hero, { fontSize: 56, lineHeight: 64, textAlign: 'center', fontVariant: ['tabular-nums'] }]}>{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}</Text>
          {hasPad ? <View style={[s.row, { justifyContent: 'center' }]}><Stepper label="Tempo in km/h" value={walkKmh} step={0.5} min={2} max={6.5} onChange={setWalkKmh} /><Text style={s.small}>km/h</Text></View> : null}
          <Text style={[s.muted, { textAlign: 'center' }]}>{profile.weightKg ? `ca. ${walkKcal(profile.weightKg, sec / 60, hasPad ? walkKmh : 4.5)} kcal · ` : ''}{hasPad ? `${fmt(Math.round((walkKmh * sec) / 36) / 100)} km` : 'zügiges Gehen'}</Text>
          <Text style={[s.small, { textAlign: 'center' }]}>Du kannst dieses Fenster schließen, der Timer läuft weiter, solange die App offen ist.</Text>
          <Button icon="checkmark" title={`Stoppen und ${min} Min. eintragen`} onPress={() => { addWalk(min, hasPad ? walkKmh : undefined); setWalkStart(null); setTimerOpen(false); }} />
          <Button variant="ghost" title="Verwerfen" onPress={() => { setWalkStart(null); setTimerOpen(false); }} />
        </>;
      })() : null}
    </Sheet>
    <Sheet visible={breakOpen} onClose={() => setBreakOpen(false)} title="5-Minuten-Ausgleich">
      <Text style={s.muted}>Nach jeder Stunde Sitzen einmal durch. Alles im Stehen, ohne Geräte, in Bürokleidung machbar.</Text>
      {[
        ['Aufstehen vom Stuhl', '10–15 Mal ohne Schwung aufstehen und langsam hinsetzen.'],
        ['Brust öffnen', 'Hände hinter dem Rücken verschränken, Schultern zurück, 30 Sekunden halten.'],
        ['Hüftbeuger dehnen', 'Großer Schritt nach vorn, hinteres Bein lang, Becken nach vorn schieben, je Seite 30 Sekunden.'],
        ['Rudern am Türrahmen', '10–15 Mal: Rahmen fassen, zurücklehnen, heranziehen.'],
        ['Wadenheben', '15–20 Mal auf die Zehenspitzen, oben kurz halten.'],
        ['Nacken lösen', 'Kopf langsam zur Seite neigen, je Seite 20 Sekunden, Schultern bleiben unten.'],
      ].map(([t, d], i) => <View key={t} style={{ flexDirection: 'row', gap: 12 }}><Text style={[s.strong, { color: c.lime, width: 16 }]}>{i + 1}</Text><View style={{ flex: 1 }}><Text style={s.strong}>{t}</Text><Text style={s.small}>{d}</Text></View></View>)}
    </Sheet>
    <Entrance delay={160}>
      <View style={s.row}>
        <Tile icon="flame-outline" value={String(weeks)} label={weeks === 1 ? 'Woche in Folge' : 'Wochen in Folge'} />
        <Tile icon="barbell-outline" value={String(history.length)} label="Einheiten gesamt" />
        <Tile icon="construct-outline" value={`${plan.score} %`} label="Equipment" />
      </View>
    </Entrance>
    {up.length ? (
      <Entrance delay={240}>
        <Card>
          <Eyebrow>Mehr herausholen</Eyebrow>
          <Text style={s.strong}>{up[0].items.map(equipmentName).join(' + ')} würde deinen Plan am stärksten verbessern</Text>
          <Text style={s.muted}>Equipment-Abdeckung {plan.score} % → {up[0].score} %. Damit werden Bewegungsmuster trainierbar, die jetzt nur ersatzweise abgedeckt sind.</Text>
          <Button small variant="secondary" title="Equipment anpassen" icon="options-outline" onPress={() => goTo('Profil')} />
        </Card>
      </Entrance>
    ) : null}
    {profile.challenge === 'motivation' && week < profile.daysPerWeek ? <Card><Eyebrow>Dranbleiben</Eyebrow><Text style={s.text}>{history.length ? `Du hast schon ${history.length} ${history.length === 1 ? 'Einheit' : 'Einheiten'} geschafft. Heute zählt nur: anfangen. Die ersten zwei Übungen reichen, der Rest kommt meist von selbst.` : 'Der schwerste Teil ist der Anfang. Nimm dir heute nur die ersten zwei Übungen vor, der Rest kommt meist von selbst.'}</Text></Card> : null}
    {weeks >= 6 ? <Card><Eyebrow>Hinweis vom Coach</Eyebrow><Text style={s.text}>Du trainierst seit {weeks} Wochen durchgehend. Eine leichtere Woche mit halber Satzzahl bei gleichem Gewicht hilft, danach wieder zuzulegen.</Text></Card> : null}
  </>;
}

export function Training({ profile, plan, history, nextDay, start, startFree, swap, regenerate, notes, setNote, add, remove }: Shared & { regenerate: () => void }) {
  const confirm = useConfirm();
  const [library, setLibrary] = useState<{ dayId: string | null } | null>(null);
  const libDay = library?.dayId ? plan.days.find((d) => d.id === library.dayId) : null;
  const [open, setOpen] = useState<{ day: PlanDay; index: number } | null>(null);
  const volume = useMemo(() => weeklyVolume(plan), [plan]);
  const maxVol = Math.max(20, ...Object.values(volume));
  const sel = open ? plan.days.find((d) => d.id === open.day.id) ?? open.day : null;
  const item = sel && open ? sel.items[open.index] : null;
  const ex = item ? exercise(item.exerciseId) : null;
  const alts = sel && item ? alternatives(profile, item, sel) : [];
  return <>
    <Text style={s.hero}>Dein Plan</Text>
    <Text style={s.muted}>{plan.split} · {profile.daysPerWeek}× pro Woche · Ziel {profile.gentle ? 'Abnehmen, sanfter Einstieg' : profile.goal}</Text>
    <Card>
      <Eyebrow>Warum dieser Plan</Eyebrow>
      <Text style={s.text}>{profile.gentle ? 'Im sanften Abnehm-Modus trainierst du immer den ganzen Körper. Jede Einheit ist in sich rund, ein verpasster Tag bringt nichts durcheinander.'
        : profile.daysPerWeek <= 3 ? 'Bei 2–3 Tagen ist Ganzkörpertraining die beste Wahl: Jeder Muskel wird mehrmals pro Woche gefordert, und ein verpasster Tag fällt kaum ins Gewicht.'
        : profile.daysPerWeek === 4 ? 'Bei 4 Tagen passt der Wechsel aus Ober- und Unterkörper: jede Muskelgruppe zweimal pro Woche, mit genug Erholung dazwischen.'
        : 'Bei 5–6 Tagen ist der Plan nach Drücken, Ziehen und Beinen geteilt: kurze Einheiten, hohes Wochenvolumen.'}</Text>
      <Text style={s.small}>{profile.level === 1 && profile.daysPerWeek > 4 ? 'Empfehlung für Einsteiger: 3 Tage Ganzkörper bringen am Anfang meist mehr als 5–6 Tage. Du kannst das im Profil umstellen.'
        : profile.daysPerWeek === 2 ? 'Wenn es die Zeit erlaubt, bringt ein dritter Tag den größten Zusatznutzen.'
        : 'Bleib mindestens 8–12 Wochen bei einem Plan. Fortschritt kommt aus der Steigerung, nicht aus dem Wechsel.'}</Text>
    </Card>
    {plan.notes.map((n) => <Card key={n}><View style={s.row}><Ionicons name="information-circle-outline" size={20} color={c.warn} /><Text style={[s.small, { flex: 1 }]}>{n}</Text></View></Card>)}
    {plan.days.map((d, di) => (
      <Card key={d.id} accent={di === nextDay}>
        <View style={s.rowBetween}>
          <View style={{ flex: 1 }}>
            {di === nextDay ? <Eyebrow>Als Nächstes</Eyebrow> : null}
            <Text style={s.heading}>{d.name}</Text>
            <Text style={s.small}>{d.focus} · ca. {d.minutes} Min.</Text>
          </View>
          <Button small variant={di === nextDay ? 'primary' : 'secondary'} title="Start" icon="play" onPress={() => start(di)} />
        </View>
        {d.items.map((i, k) => {
          const e = exercise(i.exerciseId);
          return (
            <Pressable key={`${i.exerciseId}-${k}`} accessibilityRole="button" accessibilityLabel={`${e.name}, Details und Tauschen`} onPress={() => setOpen({ day: d, index: k })}
              style={[s.rowBetween, { paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border, minHeight: 48 }]}>
              <Thumb ex={e} />
              <View style={{ flex: 1 }}>
                <Text style={s.strong}>{e.name}</Text>
                <Text style={s.small}>{i.sets} × {range(i.lo, i.hi)} {e.mode === 'time' ? 'Sek.' : 'Wdh.'}{e.perSide ? ' je Seite' : ''} · {i.rest} Sek. Pause{i.fallback ? ' · Ersatzübung' : ''}{i.focus ? ' · Schwerpunkt' : ''}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.faint} />
            </Pressable>
          );
        })}
        <Button small variant="ghost" icon="add" title="Übung hinzufügen" onPress={() => setLibrary({ dayId: d.id })} />
      </Card>
    ))}
    <Button variant="secondary" icon="create-outline" title="Freies Training starten" onPress={startFree} />
    <Button variant="secondary" icon="library-outline" title="Übungskatalog" onPress={() => setLibrary({ dayId: null })} />
    <Card>
      <H>Sätze pro Muskel und Woche</H>
      <Text style={s.small}>{profile.goal === 'Muskelaufbau' ? 'Richtwert für Muskelaufbau: etwa 10–20 Sätze pro Muskel und Woche. Hilfsmuskeln zählen halb.' : 'So verteilt sich dein Wochenvolumen. Hilfsmuskeln zählen halb.'}</Text>
      {MUSCLE_ORDER.map((m) => (
        <View key={m} style={s.row}>
          <Text style={[s.small, { width: 86 }]}>{m}</Text>
          <View style={{ flex: 1 }}><Meter value={volume[m]} max={maxVol} color={profile.goal === 'Muskelaufbau' && volume[m] < 10 ? c.limeDeep : c.lime} /></View>
          <Text style={[s.small, { width: 28, textAlign: 'right', color: c.text, fontVariant: ['tabular-nums'] }]}>{fmt(Math.round(volume[m]))}</Text>
        </View>
      ))}
    </Card>
    <Button variant="secondary" icon="refresh" title="Plan neu erstellen" onPress={async () => { if (await confirm({ title: 'Plan neu erstellen?', text: 'Getauschte Übungen werden zurückgesetzt. Deine Trainingsdaten bleiben erhalten.', yes: 'Neu erstellen' })) regenerate(); }} />

    <Sheet visible={!!open && !!ex} onClose={() => setOpen(null)} title={ex?.name ?? ''}>
      {ex && item && sel ? <ExerciseGuide ex={ex} history={history} note={notes[ex.id] ?? ''} setNote={(t) => setNote(ex.id, t)}>
        <Card accent>
          <Eyebrow>Nächstes Mal · {item.sets} × {range(item.lo, item.hi)} {ex.mode === 'time' ? 'Sek.' : 'Wdh.'}</Eyebrow>
          <Text style={s.text}>{suggest(ex, item, logsFor(history, ex.id), startWeight(ex, item, profile)).note}</Text>
        </Card>
        {ex.load === 'external' && ex.mode === 'reps' ? (() => {
          const sg = suggest(ex, item, logsFor(history, ex.id), startWeight(ex, item, profile));
          const w0 = sg.weight;
          return w0 ? (
            <Card>
              <Eyebrow>Steigerungsplan</Eyebrow>
              {[0, 1, 2, 3].map((k) => (
                <View key={k} style={s.rowBetween}>
                  <Text style={[s.text, k === 0 && { color: c.lime, fontWeight: '700' }]}>{k === 0 ? 'Jetzt' : `Stufe ${k + 1}`}</Text>
                  <Text style={s.text}>{fmt(w0 + k * ex.step)} kg × {item.lo}–{item.hi}</Text>
                </View>
              ))}
              <Text style={s.small}>Bleib bei einem Gewicht, bis alle {item.sets} Sätze {item.hi} Wiederholungen schaffen. Dann die nächste Stufe und wieder bei {item.lo} beginnen. Realistisch ist am Anfang eine Stufe alle 1–3 Wochen.</Text>
            </Card>
          ) : null;
        })() : null}
        <H>Tauschen gegen</H>
        {alts.length ? alts.map((a) => (
          <Pressable key={a.id} accessibilityRole="button" onPress={() => swap(sel.id, open!.index, a.id)} style={s.option}>
            <View style={{ flex: 1 }}>
              <Text style={s.strong}>{a.name}</Text>
              <Text style={s.small}>{a.needs.length ? a.needs.map(equipmentName).join(', ') : 'Körpergewicht'} · {['', 'leicht', 'mittel', 'anspruchsvoll'][a.level]}</Text>
            </View>
            <Ionicons name="swap-horizontal" size={20} color={c.lime} />
          </Pressable>
        )) : <Text style={s.muted}>Mit deinem Equipment gibt es für diesen Platz keine weitere Übung.</Text>}
        {sel.items.length > 1 ? <Button small variant="danger" icon="trash-outline" title="Aus diesem Tag entfernen" onPress={() => { remove(sel.id, open!.index); setOpen(null); }} /> : null}
      </ExerciseGuide> : null}
    </Sheet>
    <Sheet visible={!!library} onClose={() => setLibrary(null)} title={libDay ? `Übung hinzufügen: ${libDay.name}` : 'Übungskatalog'}>
      {library ? <Library profile={profile} history={history} notes={notes} setNote={setNote}
        taken={libDay ? libDay.items.map((i) => i.exerciseId) : []}
        addLabel={libDay ? `Zu ${libDay.name} hinzufügen` : undefined}
        onAdd={libDay ? (id) => { add(libDay.id, id); setLibrary(null); } : undefined} /> : null}
    </Sheet>
  </>;
}

export type Message = { from: 'user' | 'coach'; text: string; source?: 'ki' | 'lokal' };

export function Coach({ profile, plan, history, messages, setMessages }: Shared & { messages: Message[]; setMessages: (fn: (old: Message[]) => Message[]) => void }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<TextInput>(null);
  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setQuestion('');
    setMessages((old) => [...old, { from: 'user', text: q }]);
    const ctx = { profile, plan, history };
    let reply: Message = { from: 'coach', text: localCoach(q, ctx), source: 'lokal' };
    if (supabase) {
      setBusy(true);
      try { reply = { from: 'coach', text: await askCoach(q.slice(0, 1000), coachContext(ctx)), source: 'ki' }; } catch { /* nicht angemeldet oder offline: lokale Antwort */ }
      setBusy(false);
    }
    setMessages((old) => [...old, reply]);
  };
  return <>
    <Text style={s.hero}>Dein Coach</Text>
    <Text style={s.muted}>{supabase ? 'Antwortet mit KI, wenn du angemeldet bist. Sonst mit den Regeln der App und deinen Daten auf diesem Gerät.' : 'Antwortet mit den Regeln der App und deinen Trainingsdaten auf diesem Gerät. Die KI-Anbindung ist noch nicht eingerichtet.'}</Text>
    {messages.map((m, i) => (
      <View key={i} style={{ alignSelf: m.from === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%', backgroundColor: m.from === 'user' ? c.lime : c.surface, borderWidth: 1, borderColor: m.from === 'user' ? c.lime : c.border, borderRadius: 18, padding: 14, gap: 4 }}>
        <Text style={[s.text, m.from === 'user' && { color: c.background, fontWeight: '600' }]}>{m.text}</Text>
        {m.source ? <Text style={s.tiny}>{m.source === 'ki' ? 'KI-Antwort' : 'Antwort aus den App-Regeln'}</Text> : null}
      </View>
    ))}
    {busy ? <Text style={s.small}>Coach schreibt …</Text> : null}
    <View style={s.wrap}>{QUICK_QUESTIONS.map((q) => <Chip key={q} text={q} active={false} onPress={() => send(q)} />)}</View>
    <View style={[s.row, { alignItems: 'flex-end' }]}>
      <TextInput ref={input} accessibilityLabel="Frage an den Coach" placeholder="Frag deinen Coach …" placeholderTextColor={c.faint} value={question} onChangeText={setQuestion} multiline maxLength={1000} style={[s.input, { flex: 1, minHeight: 52, maxHeight: 130 }]} />
      <Pressable accessibilityRole="button" accessibilityLabel="Senden" disabled={!question.trim() || busy} onPress={() => send(question)} style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: c.lime, alignItems: 'center', justifyContent: 'center', opacity: question.trim() && !busy ? 1 : 0.4 }}>
        <Ionicons name="arrow-up" size={24} color={c.background} />
      </Pressable>
    </View>
    <Text style={s.small}>Der Coach ersetzt keine ärztliche Beratung. Bei Schmerzen oder Beschwerden: Training abbrechen und abklären lassen.</Text>
  </>;
}

function WeightCard({ profile, weights, addWeight }: { profile: Profile; weights: WeightEntry[]; addWeight: (kg: number) => void }) {
  const current = weights.length ? weights[weights.length - 1].kg : profile.weightKg ?? null;
  const [value, setValue] = useState(current ?? 75);
  if (current === null) return null;
  const first = weights.length ? weights[0].kg : current;
  const target = profile.targetKg ?? null;
  const done = target !== null && first !== target ? Math.max(0, Math.min(1, (first - current) / (first - target))) : 0;
  return (
    <Card>
      <View style={s.rowBetween}><H>Körpergewicht</H><Sparkline values={weights.slice(-12).map((w) => w.kg)} /></View>
      <View style={s.rowBetween}>
        <Text style={s.tileValue}>{fmt(current)} kg</Text>
        {target !== null ? <Text style={s.small}>Ziel {fmt(target)} kg · {Math.abs(current - target) < 0.05 ? 'erreicht' : `noch ${fmt(Math.abs(Math.round((current - target) * 10) / 10))} kg`}</Text> : null}
      </View>
      {target !== null && first !== target ? <Meter value={done} max={1} /> : null}
      <View style={s.rowBetween}>
        <Stepper label="Gewicht in kg" value={value} step={0.5} min={30} max={300} onChange={setValue} />
        <Button small variant="secondary" icon="add" title="Heute eintragen" onPress={() => addWeight(value)} />
      </View>
      <Text style={s.small}>Am besten immer zur gleichen Tageszeit wiegen. Einzelne Tage schwanken, der Verlauf über Wochen zählt.</Text>
    </Card>
  );
}

export function Progress({ profile, history, removeSession, weights, addWeight }: Shared & { removeSession: (id: string) => void; weights: WeightEntry[]; addWeight: (kg: number) => void }) {
  const confirm = useConfirm();
  const [openId, setOpenId] = useState<string | null>(null);
  const recs = useMemo(() => records(history), [history]);
  const counts = useMemo(() => weeklyCounts(history, 8), [history]);
  const muscles = useMemo(() => muscleSets(sessionsThisWeek(history)), [history]);
  const totalVolume = history.reduce((n, sn) => n + sessionVolume(sn), 0);
  const minutes = Math.max(1, Math.round(history.reduce((n, sn) => n + sn.durationSeconds, 0) / 60));
  const maxMuscle = Math.max(1, ...Object.values(muscles).map((v) => v ?? 0));
  if (!history.length) {
    return <>
      <Text style={s.hero}>Dein Fortschritt</Text>
      <Card><View style={{ alignItems: 'center' }}><Bolt size={120} /></View><Text style={[s.strong, { textAlign: 'center' }]}>Noch keine Einheit gespeichert</Text><Text style={[s.muted, { textAlign: 'center' }]}>Nach deinem ersten Workout siehst du hier Wochenverlauf, Bestwerte und wie viel du bewegt hast.</Text></Card>
      <WeightCard profile={profile} weights={weights} addWeight={addWeight} />
    </>;
  }
  return <>
    <Text style={s.hero}>Dein Fortschritt</Text>
    {(() => {
      const r = weekReview(history);
      const diff = r.prevVolume ? Math.round((r.volume / r.prevVolume - 1) * 100) : null;
      const weeks = activeWeeks(history);
      return (
        <Card accent>
          <Eyebrow>Wochenrückblick</Eyebrow>
          <Text style={s.heading}>{r.sessions >= profile.daysPerWeek ? 'Wochenziel erreicht' : r.sessions ? `${r.sessions} von ${profile.daysPerWeek} Einheiten` : 'Diese Woche noch keine Einheit'}</Text>
          <View style={s.rowBetween}><Text style={s.muted}>Einheiten</Text><Text style={s.text}>{r.sessions} (Vorwoche {r.prevSessions})</Text></View>
          <View style={s.rowBetween}><Text style={s.muted}>Sätze</Text><Text style={s.text}>{r.sets}</Text></View>
          <View style={s.rowBetween}><Text style={s.muted}>Bewegtes Gewicht</Text><Text style={s.text}>{fmtLoad(r.volume)}{diff !== null ? ` (${diff >= 0 ? '+' : ''}${diff} % zur Vorwoche)` : ''}</Text></View>
          {r.records.length ? <View style={s.row}><Ionicons name="trophy" size={18} color={c.lime} /><Text style={[s.text, { flex: 1 }]}>Neue Bestwerte: {r.records.map((id) => exercise(id).name).join(', ')}</Text></View> : null}
          <Text style={s.small}>{weeks >= 6 ? `Seit ${weeks} Wochen ohne Pause: Plane die nächste Woche leichter (halbe Satzzahl, gleiches Gewicht), danach geht es wieder aufwärts.`
            : r.sessions === 0 ? 'Die erste Einheit der Woche ist die wichtigste. Zwei Übungen reichen für den Anfang.'
            : r.sessions < profile.daysPerWeek ? 'Vergleich mit der Vorwoche erst am Wochenende aussagekräftig, die Woche läuft noch.'
            : 'Stark. Halte das Tempo, die Steigerung kommt über die Wochen.'}</Text>
        </Card>
      );
    })()}
    <View style={s.row}>
      <Tile icon="barbell-outline" value={String(history.length)} label="Einheiten" />
      <Tile icon="time-outline" value={minutes >= 600 ? `${Math.round(minutes / 60)} Std.` : `${minutes} Min.`} label="Trainingszeit" />
      <Tile icon="trending-up-outline" value={fmtLoad(totalVolume)} label="Bewegt" />
    </View>
    <Card>
      <View style={s.rowBetween}><H>Einheiten pro Woche</H><Text style={s.small}>Ziel {profile.daysPerWeek}</Text></View>
      <Bars data={counts} target={profile.daysPerWeek} />
      <Text style={s.small}>Hell: Wochenziel erreicht. Letzte 8 Wochen, Wochenbeginn Montag.</Text>
    </Card>
    <Card>
      <H>Bestwerte</H>
      <Text style={s.small}>Mit Gewicht: geschätztes Maximum für eine Wiederholung. Ohne Gewicht: beste Wiederholungszahl oder Haltezeit.</Text>
      {recs.slice(0, 12).map((r) => {
        const e = exercise(r.exerciseId);
        return (
          <View key={r.exerciseId} style={[s.rowBetween, { paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.strong}>{e.name}</Text>
              <Text style={s.small}>{day(r.date)} · {r.series.length}× trainiert</Text>
            </View>
            <Sparkline values={r.series.slice(-10)} />
            <Text style={[s.strong, { width: 72, textAlign: 'right', color: c.lime, fontVariant: ['tabular-nums'] }]}>{e.load === 'external' ? `${fmt(Math.round(r.best * 2) / 2)} kg` : `${r.best} ${e.mode === 'time' ? 'Sek.' : 'Wdh.'}`}</Text>
          </View>
        );
      })}
    </Card>
    {Object.keys(muscles).length ? (
      <Card>
        <H>Diese Woche trainiert</H>
        {MUSCLE_ORDER.filter((m) => muscles[m]).map((m) => (
          <View key={m} style={s.row}>
            <Text style={[s.small, { width: 86 }]}>{m}</Text>
            <View style={{ flex: 1 }}><Meter value={muscles[m] ?? 0} max={maxMuscle} /></View>
            <Text style={[s.small, { width: 28, textAlign: 'right', color: c.text }]}>{fmt(Math.round(muscles[m] ?? 0))}</Text>
          </View>
        ))}
        <Text style={s.small}>Erledigte Sätze, Hilfsmuskeln zählen halb.</Text>
      </Card>
    ) : null}
    <WeightCard profile={profile} weights={weights} addWeight={addWeight} />
    <H>Trainingstagebuch</H>
    {history.slice(0, 30).map((sn) => (
      <Card key={sn.id}>
        <Pressable accessibilityRole="button" onPress={() => setOpenId(openId === sn.id ? null : sn.id)} style={s.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={s.strong}>{sn.dayName}</Text>
            <Text style={s.small}>{day(sn.date)} · {Math.max(1, Math.round(sn.durationSeconds / 60))} Min. · {sessionSets(sn)} {sessionSets(sn) === 1 ? 'Satz' : 'Sätze'} · {Math.round(sessionVolume(sn))} kg</Text>
          </View>
          <Ionicons name={openId === sn.id ? 'chevron-up' : 'chevron-down'} size={20} color={c.muted} />
        </Pressable>
        {openId === sn.id ? <>
          {sn.exercises.map((l) => {
            const e = exercise(l.exerciseId);
            return <View key={l.exerciseId}><Text style={s.text}>{e.name}</Text><Text style={s.small}>{l.sets.filter((x) => x.done).map((x) => (e.load === 'external' ? `${fmt(x.weight)} kg × ${x.reps}` : `${x.reps} ${e.mode === 'time' ? 'Sek.' : 'Wdh.'}`)).join('  ·  ')}</Text></View>;
          })}
          <Button small variant="danger" icon="trash-outline" title="Einheit löschen" onPress={async () => { if (await confirm({ title: 'Einheit löschen?', text: `${sn.dayName} vom ${day(sn.date)} wird unwiderruflich gelöscht.`, yes: 'Löschen', danger: true })) removeSession(sn.id); }} />
        </> : null}
      </Card>
    ))}
  </>;
}

export function ProfileTab({ profile, plan, history, edit, clearHistory, resetAll, reminder, setReminder, reminderStatus, backup, restore }: Shared & {
  edit: () => void; clearHistory: () => void; resetAll: () => void;
  reminder: Reminder; setReminder: (r: Reminder) => void; reminderStatus: string; backup: () => string; restore: (text: string) => boolean;
}) {
  const confirm = useConfirm();
  const [sheet, setSheet] = useState<'export' | 'import' | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [armed, setArmed] = useState(false);
  const days = (profile.trainDays?.length ? profile.trainDays : defaultTrainDays(profile.daysPerWeek)).map((d) => ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][d]).join(', ');
  const share = async () => {
    const data = backup();
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = `ai-fit-coach-sicherung-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      URL.revokeObjectURL(url);
      setMsg('Sicherung als Datei heruntergeladen.');
    } else {
      try { await Share.share({ message: data, title: 'AI FIT COACH Sicherung' }); } catch { setMsg('Teilen nicht möglich. Markiere den Text unten und kopiere ihn.'); }
    }
  };
  const limits = { knee: 'Knie', shoulder: 'Schulter', back: 'Unterer Rücken' } as const;
  return <>
    <Text style={s.hero}>Dein Profil</Text>
    <Card>
      <Text style={s.heading}>{profile.name}</Text>
      {[
        ['Ziel', profile.gentle ? 'Abnehmen, sanfter Einstieg' : profile.goal], ['Erfahrung', LEVEL[profile.level]],
        ['Training', `${profile.daysPerWeek}× pro Woche, ${profile.minutes} Min.`], ['Plan', plan.split],
        ['Problemzonen', profile.limitations.map((l) => limits[l]).join(', ') || 'keine'],
        ['Schwerpunkte', (profile.focus ?? []).join(', ') || 'ganzer Körper'],
        ...(profile.heightCm && profile.weightKg ? [['Körper', `${profile.heightCm} cm, ${fmt(profile.weightKg)} kg${profile.targetKg ? `, Ziel ${fmt(profile.targetKg)} kg` : ''}`]] : []),
        ...(profile.benchmark ? [['Kraftwert', `${{ bench: 'Bankdrücken', squat: 'Kniebeuge', deadlift: 'Kreuzheben' }[profile.benchmark.lift]} ca. ${profile.benchmark.oneRm} kg`]] : []),
      ].map(([k, v]) => <View key={k} style={s.rowBetween}><Text style={s.muted}>{k}</Text><Text style={[s.text, { flex: 1, textAlign: 'right' }]}>{v}</Text></View>)}
    </Card>
    <Card>
      <View style={s.rowBetween}><H>Equipment</H><Text style={[s.strong, { color: c.lime }]}>{plan.score} %</Text></View>
      <Meter value={plan.score} />
      <View style={s.wrap}>
        <View style={s.badge}><Text style={s.badgeText}>Körpergewicht</Text></View>
        {profile.equipment.map((e) => <View key={e} style={s.badge}><Text style={s.badgeText}>{equipmentName(e)}</Text></View>)}
      </View>
    </Card>
    <Button icon="create-outline" title="Ziel, Zeit und Equipment ändern" onPress={edit} />
    <Text style={s.small}>Nach einer Änderung wird dein Plan neu erstellt. Trainingsdaten und Bestwerte bleiben erhalten.</Text>
    <Card>
      <View style={s.rowBetween}>
        <View style={{ flex: 1 }}><H>Erinnerung</H><Text style={s.small}>An deinen Trainingstagen ({days})</Text></View>
        <Switch accessibilityLabel="Erinnerung an Trainingstagen" disabled={!remindersSupported} value={reminder.on} onValueChange={(on) => setReminder({ ...reminder, on })} trackColor={{ true: c.limeDeep, false: c.surface3 }} thumbColor={reminder.on ? c.lime : c.muted} />
      </View>
      {remindersSupported ? <>
        <View style={s.rowBetween}>
          <Text style={s.muted}>Uhrzeit</Text>
          <View style={s.row}>
            <Stepper label="Stunde" value={reminder.hour} step={1} min={0} max={23} onChange={(v) => setReminder({ ...reminder, hour: Math.round(v) })} />
            <Text style={s.strong}>:</Text>
            <Stepper label="Minute" value={reminder.minute} step={5} min={0} max={55} onChange={(v) => setReminder({ ...reminder, minute: Math.round(v) })} />
          </View>
        </View>
        {reminderStatus === 'denied' ? <Text style={[s.small, { color: c.warn }]}>Mitteilungen sind für die App nicht erlaubt. Erlaube sie in den Einstellungen des Handys und schalte die Erinnerung wieder ein.</Text> : null}
        {reminderStatus === 'error' ? <Text style={[s.small, { color: c.warn }]}>Die Erinnerung konnte nicht geplant werden.</Text> : null}
        {reminderStatus === 'ok' ? <Text style={s.small}>Geplant für {String(reminder.hour).padStart(2, '0')}:{String(reminder.minute).padStart(2, '0')} Uhr.</Text> : null}
      </> : <Text style={s.small}>Erinnerungen gibt es in der App am Handy, nicht im Browser.</Text>}
    </Card>
    <View style={s.divider} />
    <H>Daten</H>
    <Text style={s.small}>Profil, Plan und Trainingsdaten liegen nur auf diesem Gerät. {history.length} {history.length === 1 ? 'Einheit' : 'Einheiten'} gespeichert.</Text>
    <Button variant="secondary" icon="download-outline" title="Sicherung erstellen" onPress={() => { setMsg(''); setSheet('export'); }} />
    <Button variant="secondary" icon="push-outline" title="Sicherung einspielen" onPress={() => { setMsg(''); setText(''); setArmed(false); setSheet('import'); }} />
    <Button variant="secondary" icon="trash-outline" title="Trainingsdaten löschen" disabled={!history.length} onPress={async () => { if (await confirm({ title: 'Trainingsdaten löschen?', text: 'Alle gespeicherten Einheiten, Bestwerte und Gewichtseinträge werden unwiderruflich gelöscht. Profil und Plan bleiben.', yes: 'Löschen', danger: true })) clearHistory(); }} />
    <Button variant="danger" icon="warning-outline" title="App zurücksetzen" onPress={async () => { if (await confirm({ title: 'Alles zurücksetzen?', text: 'Profil, Plan und alle Trainingsdaten werden gelöscht. Du startest wieder beim Einrichten.', yes: 'Alles löschen', danger: true })) resetAll(); }} />
    <Sheet visible={sheet === 'export'} onClose={() => setSheet(null)} title="Sicherung erstellen">
      <Text style={s.muted}>Die Sicherung enthält Profil, Plan, alle Einheiten, Gewichte und Notizen. Bewahre sie selbst auf, zum Beispiel in deinen Notizen oder per E-Mail an dich.</Text>
      <Button icon="share-outline" title={Platform.OS === 'web' ? 'Als Datei herunterladen' : 'Teilen oder speichern'} onPress={share} />
      {msg ? <Text style={s.small}>{msg}</Text> : null}
      <TextInput accessibilityLabel="Sicherung als Text" value={sheet === 'export' ? backup() : ''} editable={false} multiline selectTextOnFocus style={[s.input, { height: 140, fontSize: 11 }]} />
    </Sheet>
    <Sheet visible={sheet === 'import'} onClose={() => setSheet(null)} title="Sicherung einspielen">
      <Text style={s.muted}>Füge den Text einer Sicherung ein. Die Daten auf diesem Gerät werden dadurch vollständig ersetzt.</Text>
      <TextInput accessibilityLabel="Sicherung einfügen" placeholder="Sicherung hier einfügen" placeholderTextColor={c.faint} value={text} onChangeText={(t) => { setText(t); setArmed(false); }} multiline style={[s.input, { height: 140, fontSize: 11 }]} />
      {msg ? <Text style={[s.small, { color: c.warn }]}>{msg}</Text> : null}
      {armed
        ? <Button variant="danger" icon="warning-outline" title="Ja, Daten auf diesem Gerät ersetzen" onPress={() => { setArmed(false); if (restore(text.trim())) setSheet(null); else setMsg('Das ist keine gültige Sicherung von AI FIT COACH.'); }} />
        : <Button icon="push-outline" title="Einspielen" disabled={!text.trim()} onPress={() => { setMsg(''); setArmed(true); }} />}
    </Sheet>
    <Text style={s.small}>AI FIT COACH 0.5 · Trainingsempfehlungen sind allgemeine Hinweise und ersetzen keine ärztliche oder therapeutische Beratung.</Text>
  </>;
}
