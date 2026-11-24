import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RULES, dayPlan, energy, shoppingList } from '../engine/nutrition';
import type { Profile } from '../engine/types';
import { colors as c } from '../theme';
import { Button, Card, Chip, Eyebrow, H, Meter, Sheet, Tile, s } from '../ui';

type MealLog = { date: string; day: number; ids: string[] } | null;
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function Nutrition({ profile, edit, setVegetarian, mealLog, setMealLog }: { profile: Profile; edit: () => void; setVegetarian: (v: boolean) => void; mealLog: MealLog; setMealLog: (l: MealLog) => void }) {
  const today = mealLog && mealLog.date === todayKey() ? mealLog : null;
  const [day, setDay] = useState(today?.day ?? 0);
  const [listDays, setListDays] = useState<number | null>(null);
  const e = useMemo(() => energy(profile), [profile]);
  const plan = useMemo(() => (e ? dayPlan(e.target, day, !!profile.vegetarian) : null), [e, day, profile.vegetarian]);
  if (!e || !plan) {
    const minor = !!profile.age && profile.age < 18;
    return <>
      <Text style={s.hero}>Ernährung</Text>
      <Card>
        <Text style={s.strong}>{minor ? 'Keine Kalorienziele unter 18' : 'Mir fehlen noch Angaben'}</Text>
        <Text style={s.muted}>{minor ? 'Im Wachstum sind Kalorienziele und Diäten nicht sinnvoll. Iss regelmäßig und abwechslungsreich und besprich Gewichtsfragen mit Eltern, Ärztin oder Arzt.' : 'Für dein Kalorien- und Eiweißziel brauche ich Größe, Gewicht und Alter. Die Angaben bleiben auf diesem Gerät.'}</Text>
        {minor ? null : <Button icon="create-outline" title="Angaben ergänzen" onPress={edit} />}
      </Card>
      <Card><H>Einfache Regeln für jeden Tag</H>{RULES.slice(0, 5).map((r, i) => <View key={i} style={{ flexDirection: 'row', gap: 12 }}><Text style={[s.strong, { color: c.lime, width: 16 }]}>{i + 1}</Text><Text style={[s.text, { flex: 1 }]}>{r}</Text></View>)}</Card>
    </>;
  }
  const label = e.delta < -2 ? `${-e.delta} % unter deinem Bedarf` : e.delta > 2 ? `${e.delta} % über deinem Bedarf` : 'entspricht deinem Bedarf';
  return <>
    <Text style={s.hero}>Ernährung</Text>
    <Text style={s.muted}>Passend zu deinem Ziel{profile.gentle ? ' Abnehmen' : ` ${profile.goal}`}. Richtwerte nach gängigen sportwissenschaftlichen Empfehlungen, kein individueller Ernährungsplan.</Text>
    <Card accent>
      <Eyebrow>Dein Tagesziel</Eyebrow>
      <View style={s.rowBetween}><Text style={[s.hero, { fontSize: 34 }]}>{e.target} kcal</Text><Text style={[s.small, { flex: 1, textAlign: 'right' }]}>{label}{'\n'}Bedarf ca. {e.tdee} kcal</Text></View>
      <View style={s.row}>
        <Tile value={`${e.protein} g`} label="Eiweiß" />
        <Tile value={`${e.carbs} g`} label="Kohlenhydr." />
        <Tile value={`${e.fat} g`} label="Fett" />
      </View>
      {e.notes.map((n) => <Text key={n} style={[s.small, { color: c.warn }]}>{n}</Text>)}
      <Text style={s.small}>Am wichtigsten sind Kalorien und Eiweiß. Kohlenhydrate und Fett darfst du nach Geschmack tauschen.</Text>
    </Card>
    {(() => {
      const eaten = today ? dayPlan(e.target, today.day, !!profile.vegetarian).meals.filter((m) => today.ids.includes(m.id)) : [];
      const kcal = eaten.reduce((n, m) => n + m.kcal, 0);
      const protein = eaten.reduce((n, m) => n + m.protein, 0);
      return (
        <Card>
          <View style={s.rowBetween}><H>Heute gegessen</H><Text style={s.small}>{eaten.length} von 4 Mahlzeiten</Text></View>
          <View style={s.rowBetween}><Text style={s.muted}>Kalorien</Text><Text style={s.text}>{kcal} von {e.target} kcal</Text></View>
          <Meter value={kcal} max={e.target} />
          <View style={s.rowBetween}><Text style={s.muted}>Eiweiß</Text><Text style={s.text}>{protein} von {e.protein} g</Text></View>
          <Meter value={protein} max={e.protein} />
          <Text style={s.small}>Hake unten ab, was du gegessen hast. Zählt die Mahlzeiten des Beispieltags, nichts anderes.</Text>
        </Card>
      );
    })()}
    <View style={s.rowBetween}>
      <H>Beispieltag</H>
      <Chip text="Vegetarisch" icon={profile.vegetarian ? 'checkmark-circle' : 'ellipse-outline'} active={!!profile.vegetarian} onPress={() => setVegetarian(!profile.vegetarian)} />
    </View>
    <View style={s.wrap}>{[0, 1, 2].map((d) => <Chip key={d} text={`Tag ${d + 1}`} active={day === d} onPress={() => setDay(d)} />)}</View>
    {plan.meals.map((m) => (
      <Card key={m.id}>
        <View style={s.rowBetween}><Eyebrow>{m.name}</Eyebrow><Text style={s.small}>ca. {m.kcal} kcal · {m.protein} g Eiweiß</Text></View>
        <View style={s.rowBetween}>
          <Text style={[s.heading, { flex: 1 }]}>{m.title}</Text>
          {(() => {
            const on = !!today && today.day === day && today.ids.includes(m.id);
            return (
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${m.name} gegessen`} hitSlop={8}
                onPress={() => { const ids = today && today.day === day ? today.ids : []; setMealLog({ date: todayKey(), day, ids: on ? ids.filter((x) => x !== m.id) : [...ids, m.id] }); }}
                style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.lime : c.surface2, borderWidth: 1, borderColor: on ? c.lime : c.limeLine }}>
                <Ionicons name="checkmark" size={22} color={on ? c.background : c.lime} />
              </Pressable>
            );
          })()}
        </View>
        {m.items.map((i) => <View key={i.name} style={s.rowBetween}><Text style={s.text}>{i.name}</Text><Text style={[s.text, { color: c.muted }]}>{i.text}</Text></View>)}
        <Text style={s.small}>{m.how}</Text>
      </Card>
    ))}
    <Card>
      <View style={s.rowBetween}><Text style={s.strong}>Tag gesamt</Text><Text style={s.strong}>ca. {plan.kcal} kcal</Text></View>
      <Meter value={plan.kcal} max={e.target} />
      <View style={s.rowBetween}><Text style={s.muted}>Eiweiß</Text><Text style={s.text}>ca. {plan.protein} g von {e.protein} g</Text></View>
      <Meter value={plan.protein} max={e.protein} />
      {plan.protein < e.protein * 0.9 ? <Text style={s.small}>Fehlt Eiweiß, hilft eine Portion Quark, Skyr oder ein Eiweißshake zusätzlich.</Text> : null}
      <Text style={s.small}>Mengen für rohe Zutaten, Nährwerte sind gerundete Durchschnittswerte.</Text>
    </Card>
    <Button variant="secondary" icon="cart-outline" title="Einkaufsliste" onPress={() => setListDays(3)} />
    <Sheet visible={listDays !== null} onClose={() => setListDays(null)} title="Einkaufsliste">
      <Text style={s.muted}>Für die drei Beispieltage{profile.vegetarian ? ' (vegetarisch)' : ''}, passend zu {e.target} kcal am Tag. Mengen für rohe Zutaten.</Text>
      <View style={s.wrap}>{[3, 6].map((n) => <Chip key={n} text={n === 3 ? 'Für 3 Tage' : 'Für 6 Tage'} active={listDays === n} onPress={() => setListDays(n)} />)}</View>
      {listDays !== null ? shoppingList(e.target, listDays === 6 ? [0, 1, 2, 0, 1, 2] : [0, 1, 2], !!profile.vegetarian).map((i) => (
        <View key={i.key} style={[s.rowBetween, { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border }]}><Text style={s.text}>{i.name}</Text><Text style={[s.text, { color: c.muted }]}>{i.text}</Text></View>
      )) : null}
      <Text style={s.small}>Dazu nach Bedarf: Gewürze, Sojasauce, Zimt, Kaffee, Tee.</Text>
    </Sheet>
    <Card>
      <H>Einfache Regeln für jeden Tag</H>
      {RULES.map((r, i) => <View key={i} style={{ flexDirection: 'row', gap: 12 }}><Text style={[s.strong, { color: c.lime, width: 16 }]}>{i + 1}</Text><Text style={[s.text, { flex: 1 }]}>{r}</Text></View>)}
    </Card>
    <Text style={s.small}>Bei Vorerkrankungen, in der Schwangerschaft, bei Essstörungen oder Unsicherheit bitte mit Ärztin, Arzt oder Ernährungsberatung sprechen. Die App ersetzt keine Beratung.</Text>
  </>;
}
