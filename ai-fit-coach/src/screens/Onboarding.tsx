import React, { useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { EQUIPMENT, PRESETS, equipmentName, samePreset } from '../engine/equipment';
import { exercise } from '../engine/exercises';
import { generatePlan, upgrades } from '../engine/plan';
import type { EquipmentId, Goal, Level, Limitation, Profile } from '../engine/types';
import { colors as c } from '../theme';
import { Bolt, Button, Card, Chip, Eyebrow, H, IconName, Meter, Option, s } from '../ui';

const GOALS: { id: Goal; hint: string; icon: IconName }[] = [
  { id: 'Muskelaufbau', hint: 'Mehr Muskelmasse: mittlere Wiederholungen, viel Volumen', icon: 'body-outline' },
  { id: 'Kraft', hint: 'Stärker werden: schwere Grundübungen, lange Pausen', icon: 'barbell-outline' },
  { id: 'Fettabbau', hint: 'Muskeln halten, Verbrauch erhöhen: Kraft plus kurzes Finish', icon: 'flame-outline' },
  { id: 'Allgemeine Fitness', hint: 'Rundum fit und belastbar im Alltag', icon: 'heart-outline' },
];
const LEVELS: { id: Level; name: string; hint: string }[] = [
  { id: 1, name: 'Einsteiger', hint: 'Neu oder weniger als 6 Monate regelmäßig' },
  { id: 2, name: 'Fortgeschritten', hint: '6 Monate bis 2 Jahre, Technik sitzt' },
  { id: 3, name: 'Erfahren', hint: 'Mehr als 2 Jahre strukturiertes Training' },
];
const LIMITS: { id: Limitation; name: string }[] = [
  { id: 'knee', name: 'Knie' }, { id: 'shoulder', name: 'Schulter' }, { id: 'back', name: 'Unterer Rücken' },
];
const STEPS = ['Start', 'Ziel', 'Rahmen', 'Equipment', 'Dein Plan'];

export function Onboarding({ initial, draftName, onDone, onCancel }: { initial?: Profile | null; draftName?: string; onDone: (p: Profile) => void; onCancel?: () => void }) {
  const [step, setStep] = useState(initial ? 1 : 0);
  const [name, setName] = useState(initial?.name ?? draftName ?? '');
  const [goal, setGoal] = useState<Goal>(initial?.goal ?? 'Muskelaufbau');
  const [level, setLevel] = useState<Level>(initial?.level ?? 1);
  const [daysPerWeek, setDays] = useState(initial?.daysPerWeek ?? 3);
  const [minutes, setMinutes] = useState(initial?.minutes ?? 45);
  const [equipment, setEquipment] = useState<EquipmentId[]>(initial?.equipment ?? ['dumbbells']);
  const [limitations, setLimitations] = useState<Limitation[]>(initial?.limitations ?? []);

  const profile: Profile = useMemo(() => ({ name: name.trim(), goal, level, daysPerWeek, minutes, equipment, limitations }), [name, goal, level, daysPerWeek, minutes, equipment, limitations]);
  const plan = useMemo(() => generatePlan(profile), [profile]);
  const up = useMemo(() => upgrades(profile), [profile]);
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const last = step === STEPS.length - 1;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 24, paddingTop: 18, gap: 10 }}>
        <View style={s.rowBetween}>
          <Text style={s.brand}>AI FIT COACH</Text>
          <Text style={s.small}>Schritt {step + 1} von {STEPS.length}</Text>
        </View>
        <Meter value={step + 1} max={STEPS.length} height={5} />
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {step === 0 && <>
          <View style={{ alignItems: 'center' }}><Bolt size={210} /></View>
          <Text style={s.hero}>Dein Plan.{'\n'}Dein Equipment.</Text>
          <Text style={s.muted}>In fünf Schritten baue ich dir einen Trainingsplan, der zu deinem Ziel, deiner Zeit und genau den Geräten passt, die du hast.</Text>
          <H>Wie darf ich dich nennen?</H>
          <TextInput accessibilityLabel="Vorname" placeholder="Dein Vorname" placeholderTextColor={c.faint} value={name} onChangeText={setName} style={s.input} maxLength={40} returnKeyType="done" />
        </>}
        {step === 1 && <>
          <Text style={s.hero}>Was ist dein Ziel?</Text>
          <Text style={s.muted}>Das Ziel bestimmt Wiederholungen, Pausen und Satzzahl.</Text>
          {GOALS.map((g) => <Option key={g.id} title={g.id} hint={g.hint} icon={g.icon} active={goal === g.id} onPress={() => setGoal(g.id)} />)}
        </>}
        {step === 2 && <>
          <Text style={s.hero}>Dein Rahmen</Text>
          <H>Trainingserfahrung</H>
          {LEVELS.map((l) => <Option key={l.id} title={l.name} hint={l.hint} active={level === l.id} onPress={() => setLevel(l.id)} />)}
          <H>Trainingstage pro Woche</H>
          <View style={s.wrap}>{[2, 3, 4, 5, 6].map((d) => <Chip key={d} text={`${d}×`} active={daysPerWeek === d} onPress={() => setDays(d)} />)}</View>
          <Text style={s.small}>Ergibt: {plan.split}</Text>
          <H>Zeit pro Einheit</H>
          <View style={s.wrap}>{[20, 30, 45, 60, 75, 90].map((m) => <Chip key={m} text={`${m} Min.`} active={minutes === m} onPress={() => setMinutes(m)} />)}</View>
        </>}
        {step === 3 && <>
          <Text style={s.hero}>Was hast du zur Verfügung?</Text>
          <Text style={s.muted}>Ich wähle nur Übungen, die du wirklich machen kannst. Körpergewicht ist immer dabei.</Text>
          <View style={s.wrap}>{PRESETS.map((p) => <Chip key={p.id} text={p.name} active={samePreset(equipment, p.items)} onPress={() => setEquipment(p.items)} />)}</View>
          <Card accent>
            <View style={s.rowBetween}><Eyebrow>Equipment-Abdeckung</Eyebrow><Text style={[s.strong, { color: c.lime }]}>{plan.score} %</Text></View>
            <Meter value={plan.score} />
            <Text style={s.small}>{up.length ? `Größter Gewinn: ${up[0].items.map(equipmentName).join(' + ')} (+${up[0].gain} Punkte)` : 'Damit lässt sich jedes Bewegungsmuster optimal trainieren.'}</Text>
          </Card>
          {EQUIPMENT.map((e) => <Option key={e.id} multi title={e.name} hint={e.hint} icon={e.icon as IconName} active={equipment.includes(e.id)} onPress={() => setEquipment(toggle(equipment, e.id))} />)}
        </>}
        {step === 4 && <>
          <Text style={s.hero}>Fast fertig{name.trim() ? `, ${name.trim()}` : ''}</Text>
          <H>Gibt es Problemzonen?</H>
          <Text style={s.muted}>Übungen, die diese Bereiche stark belasten, lasse ich weg. Das ersetzt keine ärztliche Abklärung.</Text>
          <View style={s.wrap}>{LIMITS.map((l) => <Chip key={l.id} text={l.name} active={limitations.includes(l.id)} onPress={() => setLimitations(toggle(limitations, l.id))} />)}</View>
          <Card accent>
            <Eyebrow>Dein Plan</Eyebrow>
            <Text style={s.heading}>{plan.split}</Text>
            <Text style={s.muted}>{daysPerWeek} Einheiten pro Woche · Ziel {goal} · Equipment-Abdeckung {plan.score} %</Text>
            {plan.days.map((d) => (
              <View key={d.id} style={{ gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border }}>
                <View style={s.rowBetween}><Text style={s.strong}>{d.name}</Text><Text style={s.small}>ca. {d.minutes} Min.</Text></View>
                <Text style={s.small}>{d.items.map((i) => exercise(i.exerciseId).name).join(' · ')}</Text>
              </View>
            ))}
          </Card>
          {plan.notes.map((n) => <Text key={n} style={s.small}>{n}</Text>)}
        </>}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 24, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.background }}>
        {step > 0 || onCancel ? <View style={{ flex: 1 }}><Button variant="secondary" title={step === (initial ? 1 : 0) && onCancel ? 'Abbrechen' : 'Zurück'} onPress={() => (step === (initial ? 1 : 0) && onCancel ? onCancel() : setStep(step - 1))} /></View> : null}
        <View style={{ flex: 2 }}>
          <Button title={last ? (initial ? 'Plan übernehmen' : 'Plan starten') : 'Weiter'} icon={last ? 'flash' : undefined} disabled={!name.trim()} onPress={() => (last ? onDone(profile) : setStep(step + 1))} />
        </View>
      </View>
    </View>
  );
}
