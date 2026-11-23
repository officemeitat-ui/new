import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EQUIPMENT, equipmentName } from './engine/equipment';
import { EXERCISES } from './engine/exercises';
import { guide } from './engine/guides';
import { FOCUS_MUSCLES } from './engine/plan';
import { bestOf } from './engine/progression';
import type { Exercise, FocusArea, Profile, Session } from './engine/types';
import { Figure } from './figure/Figure';
import { colors as c } from './theme';
import { Button, Chip, Eyebrow, Sparkline, fmt, s } from './ui';

const day = (iso: string) => new Date(iso).toLocaleDateString('de-AT', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });

export function Thumb({ ex, size = 54 }: { ex: Exercise; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: 14, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
      <Figure ex={ex} size={size - 6} animate={false} phase={1} />
    </View>
  );
}

function Numbered({ items }: { items: string[] }) {
  return <View style={{ gap: 8 }}>{items.map((t, i) => <View key={i} style={{ flexDirection: 'row', gap: 12 }}><Text style={[s.strong, { color: c.lime, width: 16 }]}>{i + 1}</Text><Text style={[s.text, { flex: 1 }]}>{t}</Text></View>)}</View>;
}

/** Anleitung einer Übung: Bewegungsbild, Notiz, Zielbereich, Geräte, Vorbereitung, Ausführung, Tipps und der eigene Verlauf. */
export function ExerciseGuide({ ex, history, note, setNote, children }: { ex: Exercise; history: Session[]; note: string; setNote: (text: string) => void; children?: React.ReactNode }) {
  const [tab, setTab] = useState<'guide' | 'log'>('guide');
  const g = guide(ex);
  const logs = useMemo(() => history.flatMap((sn) => sn.exercises.filter((l) => l.exerciseId === ex.id && l.sets.some((x) => x.done)).map((l) => ({ date: sn.date, log: l }))), [history, ex.id]);
  const unit = ex.mode === 'time' ? 'Sek.' : 'Wdh.';
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: c.border }}>
        {([['guide', 'Anleitung'], ['log', `Verlauf${logs.length ? ` (${logs.length})` : ''}`]] as const).map(([id, label]) => (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: tab === id }} onPress={() => setTab(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: tab === id ? c.lime : 'transparent' }}>
            <Text style={[s.strong, { color: tab === id ? c.text : c.muted }]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'guide' ? <>
        <View style={{ alignItems: 'center', backgroundColor: c.background, borderRadius: 20, borderWidth: 1, borderColor: c.border, paddingVertical: 6 }}>
          <Figure ex={ex} size={210} />
          <Text style={[s.tiny, { paddingBottom: 6 }]}>Grün: die Körperpartie, die hauptsächlich arbeitet</Text>
        </View>
        <TextInput accessibilityLabel="Notiz zur Übung" placeholder="Notiz hinzufügen, z. B. Sitzeinstellung oder Griffbreite" placeholderTextColor={c.faint} value={note} onChangeText={setNote} multiline maxLength={300} style={[s.input, { paddingVertical: 12, fontSize: 14 }]} />
        <View style={{ gap: 4 }}>
          <View style={s.row}><Text style={[s.eyebrow, { width: 96 }]}>Zielbereich</Text><Text style={[s.text, { flex: 1 }]}>{[...ex.primary, ...ex.secondary].join(', ') || 'Ganzer Körper, Kondition'}</Text></View>
          <View style={s.row}><Text style={[s.eyebrow, { width: 96 }]}>Geräte</Text><Text style={[s.text, { flex: 1 }]}>{ex.needs.length ? ex.needs.map(equipmentName).join(', ') : 'Körpergewicht'}</Text></View>
        </View>
        <Eyebrow>Vorbereitung</Eyebrow>
        <Text style={s.text}>{g.setup}</Text>
        <Eyebrow>Ausführung</Eyebrow>
        <Numbered items={g.steps} />
        <Eyebrow>Wichtige Tipps</Eyebrow>
        <Numbered items={g.tips} />
        {children}
      </> : <>
        {logs.length ? <>
          <View style={s.rowBetween}>
            <View><Eyebrow>Bestwert</Eyebrow><Text style={s.tileValue}>{ex.load === 'external' ? `${fmt(Math.round(Math.max(...logs.map((l) => bestOf(l.log))) * 2) / 2)} kg` : `${Math.max(...logs.map((l) => bestOf(l.log)))} ${unit}`}</Text></View>
            <Sparkline values={logs.map((l) => bestOf(l.log)).reverse().slice(-12)} width={120} height={40} />
          </View>
          {ex.load === 'external' ? <Text style={s.small}>Bestwert: geschätztes Maximum für eine Wiederholung.</Text> : null}
          {logs.map(({ date, log }, i) => (
            <View key={i} style={{ paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border, gap: 2 }}>
              <Text style={s.strong}>{day(date)}</Text>
              <Text style={s.small}>{log.sets.filter((x) => x.done).map((x) => (ex.load === 'external' ? `${fmt(x.weight)} kg × ${x.reps}` : `${x.reps} ${unit}`)).join('  ·  ')}</Text>
            </View>
          ))}
        </> : <Text style={s.muted}>Noch keine Sätze für diese Übung gespeichert. Nach dem ersten Training stehen hier alle Einheiten mit Gewicht und Wiederholungen.</Text>}
      </>}
    </View>
  );
}

const AREAS: (FocusArea | 'Kondition')[] = ['Brust', 'Rücken', 'Schultern', 'Arme', 'Bauch', 'Gesäß', 'Beine', 'Kondition'];
const inArea = (ex: Exercise, area: FocusArea | 'Kondition') => (area === 'Kondition' ? ex.pattern === 'conditioning' : ex.primary.some((m) => FOCUS_MUSCLES[area].includes(m)));

/** Übungskatalog mit Filtern nach Zielbereich und Gerät. */
export function Library({ profile, history, notes, setNote, addLabel, onAdd, taken = [] }: {
  profile: Profile; history: Session[]; notes: Record<string, string>; setNote: (id: string, text: string) => void;
  addLabel?: string; onAdd?: (exerciseId: string) => void; taken?: string[];
}) {
  const [area, setArea] = useState<FocusArea | 'Kondition' | null>(null);
  const [mine, setMine] = useState(true);
  const [gear, setGear] = useState<string | null>(null);
  const [open, setOpen] = useState<Exercise | null>(null);
  const list = useMemo(() => EXERCISES.filter((e) =>
    (!area || inArea(e, area))
    && (!mine || e.needs.every((n) => profile.equipment.includes(n)))
    && (!gear || (gear === 'none' ? e.needs.length === 0 : e.needs.includes(gear as never)))), [area, mine, gear, profile.equipment]);
  if (open) {
    return (
      <View style={{ gap: 12 }}>
        <Pressable accessibilityRole="button" onPress={() => setOpen(null)} style={s.row}><Ionicons name="arrow-back" size={20} color={c.lime} /><Text style={[s.strong, { color: c.lime }]}>Zurück zum Katalog</Text></Pressable>
        <Text style={s.heading}>{open.name}</Text>
        <ExerciseGuide ex={open} history={history} note={notes[open.id] ?? ''} setNote={(t) => setNote(open.id, t)}>
          {onAdd ? (taken.includes(open.id)
            ? <Text style={s.small}>Diese Übung ist schon in diesem Tag.</Text>
            : !open.needs.every((n) => profile.equipment.includes(n)) ? <Text style={[s.small, { color: c.warn }]}>Dafür fehlt dir laut Profil: {open.needs.filter((n) => !profile.equipment.includes(n)).map(equipmentName).join(', ')}.</Text>
            : <Button icon="add" title={addLabel ?? 'Hinzufügen'} onPress={() => onAdd(open.id)} />) : null}
        </ExerciseGuide>
      </View>
    );
  }
  const gears = [{ id: 'none', name: 'Körpergewicht' }, ...EQUIPMENT.filter((e) => !mine || profile.equipment.includes(e.id))];
  return (
    <View style={{ gap: 12 }}>
      <View style={s.rowBetween}><Text style={s.muted}>{list.length} von {EXERCISES.length} Übungen</Text><Chip text={mine ? 'Nur mein Equipment' : 'Alle Geräte'} icon={mine ? 'checkmark-circle' : 'ellipse-outline'} active={mine} onPress={() => { setMine(!mine); setGear(null); }} /></View>
      <Eyebrow>Zielbereich</Eyebrow>
      <View style={s.wrap}>{AREAS.map((a) => <Chip key={a} text={a} active={area === a} onPress={() => setArea(area === a ? null : a)} />)}</View>
      <Eyebrow>Gerät</Eyebrow>
      <View style={s.wrap}>{gears.map((e) => <Chip key={e.id} text={e.name} active={gear === e.id} onPress={() => setGear(gear === e.id ? null : e.id)} />)}</View>
      {list.map((e) => (
        <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`${e.name}, Anleitung`} onPress={() => setOpen(e)} style={[s.row, { paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border }]}>
          <Thumb ex={e} />
          <View style={{ flex: 1 }}>
            <Text style={s.strong}>{e.name}</Text>
            <Text style={s.small}>{e.primary.join(', ') || 'Kondition'} · {e.needs.length ? e.needs.map(equipmentName).join(', ') : 'Körpergewicht'}</Text>
          </View>
          {taken.includes(e.id) ? <Ionicons name="checkmark-circle" size={20} color={c.lime} /> : <Ionicons name="chevron-forward" size={18} color={c.faint} />}
        </Pressable>
      ))}
      {!list.length ? <Text style={s.muted}>Keine Übung passt zu diesen Filtern.</Text> : null}
    </View>
  );
}
