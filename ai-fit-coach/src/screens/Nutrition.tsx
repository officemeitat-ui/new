import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { RULES, dayPlan, energy } from '../engine/nutrition';
import type { Profile } from '../engine/types';
import { colors as c } from '../theme';
import { Button, Card, Chip, Eyebrow, H, Meter, Tile, s } from '../ui';

export function Nutrition({ profile, edit, setVegetarian }: { profile: Profile; edit: () => void; setVegetarian: (v: boolean) => void }) {
  const [day, setDay] = useState(0);
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
    <View style={s.rowBetween}>
      <H>Beispieltag</H>
      <Chip text="Vegetarisch" icon={profile.vegetarian ? 'checkmark-circle' : 'ellipse-outline'} active={!!profile.vegetarian} onPress={() => setVegetarian(!profile.vegetarian)} />
    </View>
    <View style={s.wrap}>{[0, 1, 2].map((d) => <Chip key={d} text={`Tag ${d + 1}`} active={day === d} onPress={() => setDay(d)} />)}</View>
    {plan.meals.map((m) => (
      <Card key={m.id}>
        <View style={s.rowBetween}><Eyebrow>{m.name}</Eyebrow><Text style={s.small}>ca. {m.kcal} kcal · {m.protein} g Eiweiß</Text></View>
        <Text style={s.heading}>{m.title}</Text>
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
    <Card>
      <H>Einfache Regeln für jeden Tag</H>
      {RULES.map((r, i) => <View key={i} style={{ flexDirection: 'row', gap: 12 }}><Text style={[s.strong, { color: c.lime, width: 16 }]}>{i + 1}</Text><Text style={[s.text, { flex: 1 }]}>{r}</Text></View>)}
    </Card>
    <Text style={s.small}>Bei Vorerkrankungen, in der Schwangerschaft, bei Essstörungen oder Unsicherheit bitte mit Ärztin, Arzt oder Ernährungsberatung sprechen. Die App ersetzt keine Beratung.</Text>
  </>;
}
