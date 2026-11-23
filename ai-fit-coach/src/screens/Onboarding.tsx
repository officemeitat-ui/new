import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { BodyMap } from '../BodyMap';
import { EQUIPMENT, EQUIPMENT_GROUPS, MACHINES, equipmentName } from '../engine/equipment';
import { exercise } from '../engine/exercises';
import { generatePlan, upgrades } from '../engine/plan';
import { defaultTrainDays } from '../engine/progression';
import { benchEstimate, oneRmFrom } from '../engine/startweights';
import type { BenchmarkLift, Challenge, EquipmentId, FocusArea, Goal, Level, Limitation, Profile } from '../engine/types';
import { colors as c } from '../theme';
import { Bolt, Button, Card, Chip, Eyebrow, H, IconName, Meter, Option, Stepper, fmt, s } from '../ui';

const GOALS: { id: Goal; title: string; hint: string; icon: IconName; gentle?: boolean }[] = [
  { id: 'Fettabbau', gentle: true, title: 'Abnehmen mit sanftem Einstieg', hint: 'Für den Start mit mehr Körpergewicht: gelenkschonend, ohne Sprünge, ohne Übungen am Boden', icon: 'leaf-outline' },
  { id: 'Kraft', title: 'Stärker werden', hint: 'Schwere Grundübungen, wenige Wiederholungen, lange Pausen', icon: 'flash-outline' },
  { id: 'Muskelaufbau', title: 'Muskeln aufbauen', hint: 'Mittlere Wiederholungen, viel Volumen', icon: 'body-outline' },
  { id: 'Fettabbau', title: 'Schlank und definiert werden', hint: 'Muskeln halten, Verbrauch erhöhen: Kraft plus kurzes Finish', icon: 'flame-outline' },
  { id: 'Allgemeine Fitness', title: 'Gesundheit und Wohlbefinden', hint: 'Rundum fit und belastbar im Alltag', icon: 'heart-outline' },
];
const LEVELS: { id: Level; name: string; hint: string }[] = [
  { id: 1, name: 'Einsteiger', hint: 'Neu oder weniger als 6 Monate regelmäßig' },
  { id: 2, name: 'Fortgeschritten', hint: '6 Monate bis 2 Jahre, Technik sitzt' },
  { id: 3, name: 'Erfahren', hint: 'Mehr als 2 Jahre strukturiertes Training' },
];
const FOCUS: FocusArea[] = ['Brust', 'Rücken', 'Schultern', 'Arme', 'Bauch', 'Gesäß', 'Beine'];
const LIFTS: { id: BenchmarkLift; name: string }[] = [{ id: 'bench', name: 'Bankdrücken' }, { id: 'squat', name: 'Kniebeuge' }, { id: 'deadlift', name: 'Kreuzheben' }];
const PLACES: { id: string; name: string; hint: string; icon: IconName; items: EquipmentId[] }[] = [
  { id: 'gym', name: 'Großes Fitnessstudio', hint: 'Freie Gewichte, Maschinen, Kabelzüge, Cardio', icon: 'business-outline', items: EQUIPMENT.map((e) => e.id) },
  { id: 'small', name: 'Kleines Studio', hint: 'Kurzhanteln, Bank, Kabelzug, Latzug, Beinpresse, Brustpresse', icon: 'storefront-outline', items: ['dumbbells', 'bench', 'cable', 'lat_machine', 'leg_press', 'chest_press_m', 'pullup_bar', 'cardio'] },
  { id: 'garage', name: 'Home-Gym', hint: 'Langhantel, Rack, Bank, Klimmzugstange', icon: 'home-outline', items: ['dumbbells', 'barbell', 'rack', 'bench', 'pullup_bar', 'bands'] },
  { id: 'home', name: 'Zu Hause', hint: 'Kurzhanteln, Bänder, Klimmzugstange', icon: 'bed-outline', items: ['dumbbells', 'bands', 'pullup_bar'] },
  { id: 'none', name: 'Überall, ohne Geräte', hint: 'Nur das eigene Körpergewicht', icon: 'walk-outline', items: [] },
];
const CHALLENGES: { id: Challenge; title: string; hint: string; icon: IconName }[] = [
  { id: 'motivation', title: 'Motiviert bleiben', hint: 'Ich erinnere dich daran, klein anzufangen, und zeige deine Serie', icon: 'battery-half-outline' },
  { id: 'guidance', title: 'Mir fehlen klare Anweisungen', hint: 'Die Ausführung steht bei jeder Übung gleich aufgeklappt da', icon: 'map-outline' },
  { id: 'variety', title: 'Mir wird schnell langweilig', hint: 'Mehr verschiedene Übungen über die Woche', icon: 'shuffle-outline' },
];
const LIMITS: { id: Limitation; name: string }[] = [
  { id: 'knee', name: 'Knie' }, { id: 'shoulder', name: 'Schulter' }, { id: 'back', name: 'Unterer Rücken' },
];
const STEPS = ['Start', 'Über dich', 'Ziel', 'Schwerpunkte', 'Körper', 'Erfahrung', 'Kraftwert', 'Rhythmus', 'Trainingsort', 'Equipment', 'Hürde', 'Dein Plan'] as const;

const same = (a: EquipmentId[], b: EquipmentId[]) => a.length === b.length && a.every((x) => b.includes(x));

function bmiInfo(heightCm: number, kg: number) {
  const bmi = kg / (heightCm / 100) ** 2;
  const label = bmi < 18.5 ? 'unter dem Normalbereich' : bmi < 25 ? 'im Normalbereich' : bmi < 30 ? 'über dem Normalbereich' : 'deutlich über dem Normalbereich';
  return { bmi, label };
}

export function Onboarding({ initial, draftName, onDone, onCancel }: { initial?: Profile | null; draftName?: string; onDone: (p: Profile) => void; onCancel?: () => void }) {
  const first = initial ? 1 : 0;
  const [step, setStep] = useState(first);
  const [name, setName] = useState(initial?.name ?? draftName ?? '');
  const [sex, setSex] = useState<'m' | 'f' | null>(initial?.sex ?? null);
  const [goal, setGoal] = useState<Goal>(initial?.goal ?? 'Muskelaufbau');
  const [gentle, setGentle] = useState(!!initial?.gentle);
  const [focus, setFocus] = useState<FocusArea[]>(initial?.focus ?? []);
  const [heightCm, setHeight] = useState(initial?.heightCm ?? 175);
  const [weightKg, setWeight] = useState(initial?.weightKg ?? 75);
  const [useBody, setUseBody] = useState(initial ? !!initial.weightKg : true);
  const [targetKg, setTarget] = useState<number | null>(initial?.targetKg ?? null);
  const [level, setLevel] = useState<Level>(initial?.level ?? 1);
  const [lift, setLift] = useState<BenchmarkLift>(initial?.benchmark?.lift ?? 'bench');
  const [liftKg, setLiftKg] = useState(initial?.benchmark?.oneRm ?? 40);
  const [liftReps, setLiftReps] = useState(initial?.benchmark ? 1 : 5);
  const [useLift, setUseLift] = useState(!!initial?.benchmark);
  const [daysPerWeek, setDays] = useState(initial?.daysPerWeek ?? 3);
  const [minutes, setMinutes] = useState(initial?.minutes ?? 45);
  const [trainDays, setTrainDays] = useState<number[]>(initial?.trainDays?.length ? initial.trainDays : defaultTrainDays(initial?.daysPerWeek ?? 3));
  const [equipment, setEquipment] = useState<EquipmentId[]>(initial?.equipment ?? ['dumbbells', 'bands', 'pullup_bar']);
  const [challenge, setChallenge] = useState<Challenge | null>(initial?.challenge ?? null);
  const [limitations, setLimitations] = useState<Limitation[]>(initial?.limitations ?? []);
  const scroll = useRef<ScrollView>(null);

  const oneRm = oneRmFrom(liftKg, liftReps);
  const profile: Profile = useMemo(() => ({
    name: name.trim(), goal, level, daysPerWeek, minutes, equipment, limitations, focus, sex, challenge, gentle, trainDays,
    heightCm: useBody ? heightCm : null, weightKg: useBody ? weightKg : null, targetKg: useBody ? targetKg : null,
    benchmark: useLift && oneRm > 0 ? { lift, oneRm } : null,
  }), [trainDays, gentle, name, goal, level, daysPerWeek, minutes, equipment, limitations, focus, sex, challenge, useBody, heightCm, weightKg, targetKg, useLift, lift, oneRm]);
  const plan = useMemo(() => generatePlan(profile), [profile]);
  const up = useMemo(() => upgrades(profile), [profile]);
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const last = step === STEPS.length - 1;
  const go = (n: number) => { setStep(n); scroll.current?.scrollTo({ y: 0, animated: false }); };
  const body = bmiInfo(heightCm, weightKg);
  const change = targetKg !== null ? ((targetKg - weightKg) / weightKg) * 100 : 0;
  const targetBmi = targetKg !== null ? bmiInfo(heightCm, targetKg).bmi : body.bmi;
  const bench = benchEstimate(profile);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 24, paddingTop: 18, gap: 10 }}>
        <View style={s.rowBetween}>
          <Text style={s.brand}>AI FIT COACH</Text>
          <Text style={s.small}>{STEPS[step]} · {step + 1} / {STEPS.length}</Text>
        </View>
        <Meter value={step + 1} max={STEPS.length} height={5} />
      </View>
      <ScrollView ref={scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {step === 0 && <>
          <View style={{ alignItems: 'center' }}><Bolt size={210} /></View>
          <Text style={s.hero}>Dein Plan.{'\n'}Dein Equipment.</Text>
          <Text style={s.muted}>Ein paar kurze Fragen, dann baue ich dir einen Trainingsplan, der zu deinem Ziel, deinem Körper, deiner Zeit und genau den Geräten passt, die du hast.</Text>
          <H>Wie darf ich dich nennen?</H>
          <TextInput accessibilityLabel="Vorname" placeholder="Dein Vorname" placeholderTextColor={c.faint} value={name} onChangeText={setName} style={s.input} maxLength={40} returnKeyType="done" />
        </>}

        {step === 1 && <>
          <Text style={s.hero}>Über dich</Text>
          <Text style={s.muted}>Damit schätze ich deine Startgewichte besser ein. Am Plan selbst ändert die Angabe nichts.</Text>
          <Option title="Mann" icon="male-outline" active={sex === 'm'} onPress={() => setSex('m')} />
          <Option title="Frau" icon="female-outline" active={sex === 'f'} onPress={() => setSex('f')} />
          <Option title="Keine Angabe" hint="Ich rechne mit einem Mittelwert" icon="remove-circle-outline" active={sex === null} onPress={() => setSex(null)} />
        </>}

        {step === 2 && <>
          <Text style={s.hero}>Was ist dein Hauptziel?</Text>
          <Text style={s.muted}>Das Ziel bestimmt Wiederholungen, Pausen und Satzzahl.</Text>
          {GOALS.map((g) => <Option key={g.title} title={g.title} hint={g.hint} icon={g.icon} active={g.gentle ? gentle : !gentle && goal === g.id} onPress={() => { setGoal(g.id); setGentle(!!g.gentle); }} />)}
        </>}

        {step === 3 && <>
          <Text style={s.hero}>Wo liegt dein Schwerpunkt?</Text>
          <Text style={s.muted}>Gewählte Bereiche bekommen mehr Sätze und eine Zusatzübung. Tippe auf die Figur oder die Felder.</Text>
          <View style={s.wrap}>
            {FOCUS.map((f) => <Chip key={f} text={f} active={focus.includes(f)} onPress={() => setFocus(toggle(focus, f))} />)}
            <Chip text="Ganzer Körper" active={!focus.length} onPress={() => setFocus([])} />
          </View>
          <BodyMap focus={focus} toggle={(f) => setFocus(toggle(focus, f))} />
          {focus.length > 3 ? <Text style={s.small}>Tipp: Bei mehr als drei Schwerpunkten verteilt sich der Vorteil. Zwei oder drei wirken am stärksten.</Text> : null}
        </>}

        {step === 4 && <>
          <Text style={s.hero}>Dein Körper</Text>
          <Text style={s.muted}>Für Startgewichte, Eiweiß-Richtwert und deinen Gewichtsverlauf. Die Angaben bleiben auf diesem Gerät.</Text>
          {useBody ? <>
            <Card>
              <View style={s.rowBetween}><Text style={s.strong}>Größe</Text><View style={s.row}><Stepper label="Größe in cm" value={heightCm} step={1} min={120} max={230} onChange={(v) => setHeight(Math.round(v))} /><Text style={[s.small, { width: 22 }]}>cm</Text></View></View>
              <View style={s.rowBetween}><Text style={s.strong}>Gewicht</Text><View style={s.row}><Stepper label="Gewicht in kg" value={weightKg} step={0.5} min={30} max={300} onChange={setWeight} /><Text style={[s.small, { width: 22 }]}>kg</Text></View></View>
              <View style={s.divider} />
              <View style={s.rowBetween}><Eyebrow>BMI</Eyebrow><Text style={s.strong}>{fmt(Math.round(body.bmi * 10) / 10)} · {body.label}</Text></View>
              <Text style={s.small}>Normalbereich 18,5–25. Der BMI unterscheidet nicht zwischen Muskeln und Fett und sagt bei trainierten Menschen wenig aus.</Text>
            </Card>
            {gentle ? (
              <Card accent>
                <Eyebrow>Sanfter Abnehm-Modus</Eyebrow>
                <Text style={s.text}>Bitte kläre den Trainingsstart vorher ärztlich ab, wenn du starkes Übergewicht, Herz-Kreislauf-Beschwerden, Diabetes oder Gelenkprobleme hast.</Text>
              </Card>
            ) : body.bmi >= 30 ? (
              <Card accent>
                <Eyebrow>Vorschlag</Eyebrow>
                <Text style={s.text}>Für den Einstieg mit mehr Körpergewicht gibt es einen sanften Abnehm-Modus: gelenkschonende Übungen ohne Sprünge und ohne Bodenübungen, dazu ruhige Ausdauer.</Text>
                <Button small variant="secondary" icon="leaf-outline" title="Sanften Abnehm-Modus nutzen" onPress={() => { setGoal('Fettabbau'); setGentle(true); }} />
              </Card>
            ) : null}
            <Card>
              <View style={s.rowBetween}>
                <Text style={s.strong}>Zielgewicht</Text>
                {targetKg === null
                  ? <Button small variant="secondary" icon="add" title="Festlegen" onPress={() => setTarget(Math.round(weightKg))} />
                  : <View style={s.row}><Stepper label="Zielgewicht in kg" value={targetKg} step={0.5} min={30} max={300} onChange={setTarget} /><Text style={[s.small, { width: 22 }]}>kg</Text></View>}
              </View>
              {targetKg !== null ? <>
                <Text style={[s.text, targetBmi < 18.5 && { color: c.warn }]}>
                  {Math.abs(change) < 0.5 ? 'Gewicht halten.'
                    : targetBmi < 18.5 ? `Das wären ${fmt(Math.round(Math.abs(change) * 10) / 10)} % weniger und läge im Untergewicht. Bitte wähle ein höheres Ziel oder sprich vorher mit Ärztin oder Arzt.`
                    : change < 0 ? `${fmt(Math.round(-change * 10) / 10)} % weniger. Gut haltbar sind etwa 0,5 % des Körpergewichts pro Woche, das wären rund ${Math.max(1, Math.round(-change / 0.5))} Wochen.`
                    : `${fmt(Math.round(change * 10) / 10)} % mehr. Für sauberen Aufbau reichen etwa 0,25–0,5 % pro Woche, das wären rund ${Math.max(1, Math.round(change / 0.4))} Wochen.`}
                </Text>
                <Button small variant="ghost" title="Kein Zielgewicht" onPress={() => setTarget(null)} />
              </> : <Text style={s.small}>Optional. Ohne Zielgewicht zeige ich nur den Verlauf.</Text>}
            </Card>
            <Button variant="ghost" title="Lieber nicht angeben" onPress={() => { setUseBody(false); go(step + 1); }} />
          </> : <>
            <Card><Text style={s.text}>Ohne Körperdaten gibt es keine geschätzten Startgewichte und keinen Gewichtsverlauf. Der Plan funktioniert trotzdem.</Text></Card>
            <Button variant="secondary" title="Doch angeben" onPress={() => setUseBody(true)} />
          </>}
        </>}

        {step === 5 && <>
          <Text style={s.hero}>Wie erfahren bist du?</Text>
          <Text style={s.muted}>Einsteiger bekommen technisch einfache Übungen und etwas weniger Sätze.</Text>
          {LEVELS.map((l) => <Option key={l.id} title={l.name} hint={l.hint} icon={(['', 'battery-dead-outline', 'battery-half-outline', 'battery-full-outline'] as IconName[])[l.id]} active={level === l.id} onPress={() => setLevel(l.id)} />)}
        </>}

        {step === 6 && <>
          <Text style={s.hero}>Kennst du einen Kraftwert?</Text>
          <Text style={s.muted}>Ein Satz, den du zuletzt geschafft hast, reicht. Daraus schätze ich deine Startgewichte für alle Übungen.</Text>
          {useLift ? <>
            <View style={s.wrap}>{LIFTS.map((l) => <Chip key={l.id} text={l.name} active={lift === l.id} onPress={() => setLift(l.id)} />)}</View>
            <Card>
              <View style={s.rowBetween}><Text style={s.strong}>Gewicht</Text><View style={s.row}><Stepper label="Gewicht in kg" value={liftKg} step={2.5} min={5} max={400} onChange={setLiftKg} /><Text style={[s.small, { width: 38 }]}>kg</Text></View></View>
              <View style={s.rowBetween}><Text style={s.strong}>Wiederholungen</Text><View style={s.row}><Stepper label="Wiederholungen" value={liftReps} step={1} min={1} max={12} onChange={(v) => setLiftReps(Math.round(v))} /><Text style={[s.small, { width: 38 }]}>Wdh.</Text></View></View>
              <View style={s.divider} />
              <View style={s.rowBetween}><Eyebrow>Geschätztes Maximum</Eyebrow><Text style={[s.tileValue, { color: c.lime }]}>{oneRm} kg</Text></View>
              <Text style={s.small}>Rechnerisch für eine einzelne Wiederholung. Du musst das nie wirklich heben.</Text>
            </Card>
            <Button variant="ghost" title="Ich weiß es nicht" onPress={() => { setUseLift(false); go(step + 1); }} />
          </> : <>
            <Card>
              <Text style={s.text}>{bench ? 'Kein Problem. Ich schätze deine Startgewichte vorsichtig aus Körpergewicht und Erfahrung. Nach dem ersten Training rechne ich mit deinen echten Werten.' : 'Kein Problem. Beim ersten Training wählst du die Gewichte selbst, ab dann rechne ich mit deinen echten Werten.'}</Text>
            </Card>
            <Button variant="secondary" icon="barbell-outline" title="Kraftwert eingeben" onPress={() => setUseLift(true)} />
          </>}
        </>}

        {step === 7 && <>
          <Text style={s.hero}>Wie oft und wie lange?</Text>
          <Text style={s.muted}>Lieber realistisch als ehrgeizig: Ein Plan, den du jede Woche schaffst, bringt mehr als einer, der ausfällt.</Text>
          <H>Trainingstage pro Woche</H>
          <View style={s.wrap}>{[2, 3, 4, 5, 6].map((d) => <Chip key={d} text={`${d} Tage`} active={daysPerWeek === d} onPress={() => { setDays(d); setTrainDays(defaultTrainDays(d)); }} />)}</View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d, i) => {
              const on = trainDays.includes(i);
              return (
                <Pressable key={d} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Trainingstag ${d}`}
                  onPress={() => { const next = on ? trainDays.filter((x) => x !== i) : [...trainDays, i].sort(); if (next.length >= 2 && next.length <= 6) { setTrainDays(next); setDays(next.length); } }}
                  style={{ flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.lime : c.surface, borderWidth: 1, borderColor: on ? c.lime : c.border }}>
                  <Text style={{ color: on ? c.background : c.text, fontWeight: '700', fontSize: 13 }}>{d}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={s.small}>Tippe die Tage an, die bei dir passen (2 bis 6). Zwischen zwei Einheiten ist ein freier Tag ideal.</Text>
          <Text style={s.small}>Ergibt: {plan.split}</Text>
          <H>Zeit pro Einheit</H>
          <View style={s.wrap}>{[20, 30, 45, 60, 75, 90].map((m) => <Chip key={m} text={`${m} Min.`} active={minutes === m} onPress={() => setMinutes(m)} />)}</View>
        </>}

        {step === 8 && <>
          <Text style={s.hero}>Wo trainierst du?</Text>
          <Text style={s.muted}>Ich setze das übliche Equipment für den Ort. Im nächsten Schritt passt du es genau an.</Text>
          {PLACES.map((p) => <Option key={p.id} title={p.name} hint={p.hint} icon={p.icon} active={same(equipment, p.items)} onPress={() => setEquipment(p.items)} />)}
        </>}

        {step === 9 && <>
          <Text style={s.hero}>Welches Equipment hast du?</Text>
          <Text style={s.muted}>Ich wähle nur Übungen, die du wirklich machen kannst. Körpergewicht ist immer dabei.</Text>
          <Card accent>
            <View style={s.rowBetween}><Eyebrow>Equipment-Abdeckung</Eyebrow><Text style={[s.strong, { color: c.lime }]}>{plan.score} %</Text></View>
            <Meter value={plan.score} />
            <Text style={s.small}>{up.length ? `Größter Gewinn: ${up[0].items.map(equipmentName).join(' + ')} (+${up[0].gain} Punkte)` : 'Damit lässt sich jedes Bewegungsmuster optimal trainieren.'}</Text>
          </Card>
          {EQUIPMENT_GROUPS.map((g) => (
            <React.Fragment key={g}>
              <View style={s.rowBetween}>
                <H>{g}</H>
                {g === 'Kabel und Maschinen' ? <Button small variant="ghost" title={MACHINES.every((m) => equipment.includes(m)) ? 'Keine Maschinen' : 'Alle Maschinen'} onPress={() => setEquipment(MACHINES.every((m) => equipment.includes(m)) ? equipment.filter((e) => !MACHINES.includes(e)) : [...new Set([...equipment, ...MACHINES])])} /> : null}
              </View>
              {EQUIPMENT.filter((e) => e.group === g).map((e) => <Option key={e.id} multi title={e.name} hint={e.hint} icon={e.icon as IconName} active={equipment.includes(e.id)} onPress={() => setEquipment(toggle(equipment, e.id))} />)}
            </React.Fragment>
          ))}
        </>}

        {step === 10 && <>
          <Text style={s.hero}>Was fällt dir am schwersten?</Text>
          <Text style={s.muted}>Ich stelle die App darauf ein.</Text>
          {CHALLENGES.map((ch) => <Option key={ch.id} title={ch.title} hint={ch.hint} icon={ch.icon} active={challenge === ch.id} onPress={() => setChallenge(challenge === ch.id ? null : ch.id)} />)}
          <H>Gibt es Problemzonen?</H>
          <Text style={s.muted}>Übungen, die diese Bereiche stark belasten, lasse ich weg. Das ersetzt keine ärztliche Abklärung.</Text>
          <View style={s.wrap}>{LIMITS.map((l) => <Chip key={l.id} text={l.name} active={limitations.includes(l.id)} onPress={() => setLimitations(toggle(limitations, l.id))} />)}</View>
        </>}

        {step === 11 && <>
          <Text style={s.hero}>Dein Plan steht{name.trim() ? `, ${name.trim()}` : ''}</Text>
          <Card accent>
            <Eyebrow>{GOALS.find((g) => (gentle ? g.gentle : !g.gentle && g.id === goal))?.title}</Eyebrow>
            <Text style={s.heading}>{plan.split}</Text>
            <Text style={s.muted}>{daysPerWeek} Einheiten pro Woche zu je ca. {minutes} Min. · Equipment-Abdeckung {plan.score} %{focus.length ? ` · Schwerpunkt ${focus.join(', ')}` : ''}</Text>
            {plan.days.map((d) => (
              <View key={d.id} style={{ gap: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: c.border }}>
                <View style={s.rowBetween}><Text style={s.strong}>{d.name}</Text><Text style={s.small}>ca. {d.minutes} Min.</Text></View>
                <Text style={s.small}>{d.items.map((i) => exercise(i.exerciseId).name).join(' · ')}</Text>
              </View>
            ))}
          </Card>
          {bench ? <Text style={s.small}>Startgewichte sind {profile.benchmark ? 'aus deinem Kraftwert' : 'vorsichtig aus Körpergewicht und Erfahrung'} geschätzt und lassen sich im Workout jederzeit ändern.</Text> : null}
          {plan.notes.map((n) => <Text key={n} style={s.small}>{n}</Text>)}
        </>}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 24, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.background }}>
        {step > 0 || onCancel ? <View style={{ flex: 1 }}><Button variant="secondary" title={step === first && onCancel ? 'Abbrechen' : 'Zurück'} onPress={() => (step === first && onCancel ? onCancel() : go(step - 1))} /></View> : null}
        <View style={{ flex: 2 }}>
          <Button title={last ? (initial ? 'Plan übernehmen' : 'Plan starten') : 'Weiter'} icon={last ? 'flash' : undefined} disabled={!name.trim()} onPress={() => (last ? onDone(profile) : go(step + 1))} />
        </View>
      </View>
    </View>
  );
}
