import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QUICK_QUESTIONS, coachContext, localCoach } from '../coach';
import { equipmentName } from '../engine/equipment';
import { PATTERN_NAME, exercise } from '../engine/exercises';
import { MUSCLE_ORDER, alternatives, upgrades, weeklyVolume } from '../engine/plan';
import { activeWeeks, logsFor, muscleSets, records, sessionSets, sessionVolume, sessionsThisWeek, suggest, weeklyCounts } from '../engine/progression';
import type { Plan, PlanDay, Profile, Session } from '../engine/types';
import { askCoach, supabase } from '../services/supabase';
import { colors as c } from '../theme';
import { Bars, Bolt, Button, Card, Chip, Entrance, Eyebrow, H, Meter, Sheet, Sparkline, Tile, fmt, fmtLoad, s, useConfirm } from '../ui';

export type Shared = {
  profile: Profile; plan: Plan; history: Session[]; nextDay: number;
  start: (dayIndex: number) => void;
  swap: (dayId: string, index: number, exerciseId: string) => void;
};

const LEVEL = ['', 'Einsteiger', 'Fortgeschritten', 'Erfahren'];
const range = (lo: number, hi: number) => (lo === hi ? `${hi}` : `${lo}–${hi}`);
const day = (iso: string) => new Date(iso).toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'short' });

export function Home({ profile, plan, history, nextDay, start, goTo }: Shared & { goTo: (tab: 'Training' | 'Coach' | 'Profil') => void }) {
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
      </Card>
    </Entrance>
    <Entrance delay={80}>
      <Card>
        <View style={s.rowBetween}><H>Diese Woche</H><Text style={s.strong}>{week} / {profile.daysPerWeek}</Text></View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {Array.from({ length: Math.max(profile.daysPerWeek, week) }, (_, i) => <View key={i} style={{ flex: 1, height: 10, borderRadius: 6, backgroundColor: i < week ? c.lime : c.surface3 }} />)}
        </View>
        <Text style={s.small}>{week >= profile.daysPerWeek ? 'Wochenziel erreicht. Erholung gehört zum Plan.' : `Noch ${profile.daysPerWeek - week} ${profile.daysPerWeek - week === 1 ? 'Einheit' : 'Einheiten'} bis zum Wochenziel.`}</Text>
      </Card>
    </Entrance>
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
    {weeks >= 6 ? <Card><Eyebrow>Hinweis vom Coach</Eyebrow><Text style={s.text}>Du trainierst seit {weeks} Wochen durchgehend. Eine leichtere Woche mit halber Satzzahl bei gleichem Gewicht hilft, danach wieder zuzulegen.</Text></Card> : null}
  </>;
}

export function Training({ profile, plan, history, nextDay, start, swap, regenerate }: Shared & { regenerate: () => void }) {
  const confirm = useConfirm();
  const [open, setOpen] = useState<{ day: PlanDay; index: number } | null>(null);
  const volume = useMemo(() => weeklyVolume(plan), [plan]);
  const maxVol = Math.max(20, ...Object.values(volume));
  const sel = open ? plan.days.find((d) => d.id === open.day.id) ?? open.day : null;
  const item = sel && open ? sel.items[open.index] : null;
  const ex = item ? exercise(item.exerciseId) : null;
  const alts = sel && item ? alternatives(profile, item, sel) : [];
  return <>
    <Text style={s.hero}>Dein Plan</Text>
    <Text style={s.muted}>{plan.split} · {profile.daysPerWeek}× pro Woche · Ziel {profile.goal}</Text>
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
              <View style={{ flex: 1 }}>
                <Text style={s.strong}>{e.name}</Text>
                <Text style={s.small}>{i.sets} × {range(i.lo, i.hi)} {e.mode === 'time' ? 'Sek.' : 'Wdh.'}{e.perSide ? ' je Seite' : ''} · {i.rest} Sek. Pause{i.fallback ? ' · Ersatzübung' : ''}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={c.faint} />
            </Pressable>
          );
        })}
      </Card>
    ))}
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
      {ex && item && sel ? <>
        <View style={s.wrap}>
          <View style={s.badge}><Text style={s.badgeText}>{PATTERN_NAME[item.slot]}</Text></View>
          <View style={s.badge}><Text style={s.badgeText}>{ex.needs.length ? ex.needs.map(equipmentName).join(' + ') : 'Körpergewicht'}</Text></View>
        </View>
        <Text style={s.text}>{ex.cue}</Text>
        <Text style={s.small}>Zielmuskeln: {[...ex.primary, ...ex.secondary].join(', ') || 'Ganzkörper, Kondition'}</Text>
        <Card accent>
          <Eyebrow>Nächstes Mal</Eyebrow>
          <Text style={s.text}>{suggest(ex, item, logsFor(history, ex.id)).note}</Text>
        </Card>
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
      </> : null}
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

export function Progress({ profile, history, removeSession }: Shared & { removeSession: (id: string) => void }) {
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
    </>;
  }
  return <>
    <Text style={s.hero}>Dein Fortschritt</Text>
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
    <H>Trainingstagebuch</H>
    {history.slice(0, 30).map((sn) => (
      <Card key={sn.id}>
        <Pressable accessibilityRole="button" onPress={() => setOpenId(openId === sn.id ? null : sn.id)} style={s.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={s.strong}>{sn.dayName}</Text>
            <Text style={s.small}>{day(sn.date)} · {Math.max(1, Math.round(sn.durationSeconds / 60))} Min. · {sessionSets(sn)} Sätze · {Math.round(sessionVolume(sn))} kg</Text>
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

export function ProfileTab({ profile, plan, history, edit, clearHistory, resetAll }: Shared & { edit: () => void; clearHistory: () => void; resetAll: () => void }) {
  const confirm = useConfirm();
  const limits = { knee: 'Knie', shoulder: 'Schulter', back: 'Unterer Rücken' } as const;
  return <>
    <Text style={s.hero}>Dein Profil</Text>
    <Card>
      <Text style={s.heading}>{profile.name}</Text>
      {[
        ['Ziel', profile.goal], ['Erfahrung', LEVEL[profile.level]],
        ['Training', `${profile.daysPerWeek}× pro Woche, ${profile.minutes} Min.`], ['Plan', plan.split],
        ['Problemzonen', profile.limitations.map((l) => limits[l]).join(', ') || 'keine'],
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
    <View style={s.divider} />
    <H>Daten</H>
    <Text style={s.small}>Profil, Plan und Trainingsdaten liegen nur auf diesem Gerät. {history.length} {history.length === 1 ? 'Einheit' : 'Einheiten'} gespeichert.</Text>
    <Button variant="secondary" icon="trash-outline" title="Trainingsdaten löschen" disabled={!history.length} onPress={async () => { if (await confirm({ title: 'Trainingsdaten löschen?', text: 'Alle gespeicherten Einheiten und Bestwerte werden unwiderruflich gelöscht. Profil und Plan bleiben.', yes: 'Löschen', danger: true })) clearHistory(); }} />
    <Button variant="danger" icon="warning-outline" title="App zurücksetzen" onPress={async () => { if (await confirm({ title: 'Alles zurücksetzen?', text: 'Profil, Plan und alle Trainingsdaten werden gelöscht. Du startest wieder beim Einrichten.', yes: 'Alles löschen', danger: true })) resetAll(); }} />
    <Text style={s.small}>AI FIT COACH 0.4 · Trainingsempfehlungen sind allgemeine Hinweise und ersetzen keine ärztliche oder therapeutische Beratung.</Text>
  </>;
}
