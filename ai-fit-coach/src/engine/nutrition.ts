import type { Profile } from './types';

export type Activity = 'sitting' | 'mixed' | 'active';
export type Energy = {
  bmr: number; tdee: number; target: number; protein: number; fat: number; carbs: number;
  /** Abweichung vom Bedarf in Prozent (negativ = Defizit). */
  delta: number;
  notes: string[];
};

const round = (n: number, step: number) => Math.round(n / step) * step;

/**
 * Energiebedarf nach Mifflin-St Jeor mit Aktivitätsfaktor, Ziel-Anpassung und Untergrenzen.
 * null, wenn Größe, Gewicht oder Alter fehlen. Für unter 18-Jährige gibt es bewusst keine Kalorienziele.
 */
export function energy(profile: Profile): Energy | null {
  const { weightKg: w, heightCm: h, age } = profile;
  if (!w || !h || !age || age < 18) return null;
  const notes: string[] = [];
  const bmr = 10 * w + 6.25 * h - 5 * age + (profile.sex === 'm' ? 5 : profile.sex === 'f' ? -161 : -78);
  const base = { sitting: 1.3, mixed: 1.45, active: 1.6 }[profile.activity ?? 'sitting'];
  const tdee = bmr * (base + Math.min(0.2, 0.04 * profile.daysPerWeek));
  const bmi = w / (h / 100) ** 2;
  let delta = profile.gentle ? -15 : { Fettabbau: -18, Muskelaufbau: 8, Kraft: 3, 'Allgemeine Fitness': 0 }[profile.goal];
  if (delta < 0 && bmi < 18.5) { delta = 0; notes.push('Dein BMI liegt unter 18,5. Deshalb rechne ich ohne Kaloriendefizit. Bitte besprich Abnehmwünsche ärztlich.'); }
  let target = tdee * (1 + delta / 100);
  const floor = Math.max(bmr, profile.sex === 'm' ? 1500 : profile.sex === 'f' ? 1200 : 1350);
  if (target < floor) { target = floor; notes.push('Das Ziel ist auf deinen Grundumsatz angehoben. Darunter zu essen kostet Muskeln und Energie.'); }
  // Bei hohem Körpergewicht richtet sich der Eiweißbedarf nach einem Bezugsgewicht (BMI 27), nicht nach dem Gesamtgewicht.
  const ref = bmi > 27 ? 27 * (h / 100) ** 2 : w;
  const perKg = profile.goal === 'Fettabbau' ? 2.0 : profile.goal === 'Allgemeine Fitness' ? 1.5 : 1.8;
  const protein = round(ref * perKg, 5);
  const fat = round(Math.max(ref * 0.9, (target * 0.22) / 9), 5);
  const carbs = Math.max(0, round((target - protein * 4 - fat * 9) / 4, 5));
  return { bmr: Math.round(bmr), tdee: round(tdee, 10), target: round(target, 10), protein, fat, carbs, delta: Math.round((target / tdee - 1) * 100), notes };
}

/** Nährwerte je 100 g, gerundete Durchschnittswerte. */
const FOOD: Record<string, { name: string; kcal: number; p: number; piece?: { g: number; one: string; many: string }; step?: number }> = {
  oats: { name: 'Haferflocken', kcal: 370, p: 13 }, quark: { name: 'Magerquark', kcal: 67, p: 12, step: 50 }, skyr: { name: 'Skyr', kcal: 63, p: 11, step: 50 },
  berries: { name: 'Beeren (frisch oder TK)', kcal: 45, p: 1, step: 25 }, banana: { name: 'Banane', kcal: 90, p: 1, piece: { g: 120, one: 'Stück', many: 'Stück' } },
  bread: { name: 'Vollkornbrot', kcal: 220, p: 8, piece: { g: 50, one: 'Scheibe', many: 'Scheiben' } }, egg: { name: 'Ei', kcal: 155, p: 13, piece: { g: 60, one: 'Stück', many: 'Stück' } },
  cottage: { name: 'Hüttenkäse', kcal: 100, p: 12, step: 50 }, veg: { name: 'Gemüse nach Wahl', kcal: 30, p: 2, step: 50 }, nuts: { name: 'Nüsse', kcal: 600, p: 20, step: 5 },
  chicken: { name: 'Hähnchenbrust', kcal: 110, p: 23 }, rice: { name: 'Reis (roh)', kcal: 350, p: 7 }, oil: { name: 'Olivenöl', kcal: 884, p: 0, step: 5 },
  lentils: { name: 'Linsen (trocken)', kcal: 330, p: 24 }, feta: { name: 'Feta', kcal: 265, p: 16 }, pasta: { name: 'Vollkornnudeln (roh)', kcal: 350, p: 13 },
  beef: { name: 'Rinderhack mager', kcal: 150, p: 21 }, sauce: { name: 'Tomatensauce', kcal: 40, p: 1.5, step: 50 }, salmon: { name: 'Lachs', kcal: 200, p: 20 },
  potato: { name: 'Kartoffeln', kcal: 75, p: 2, step: 50 }, tofu: { name: 'Tofu', kcal: 130, p: 14, step: 25 }, wrap: { name: 'Vollkorn-Wrap', kcal: 300, p: 8, piece: { g: 60, one: 'Stück', many: 'Stück' } },
  tuna: { name: 'Thunfisch (Dose, eigener Saft)', kcal: 110, p: 25 }, yogurt: { name: 'Naturjoghurt', kcal: 60, p: 4, step: 50 }, chickpeas: { name: 'Kichererbsen (Dose)', kcal: 120, p: 7, step: 25 },
  apple: { name: 'Apfel', kcal: 52, p: 0.3, piece: { g: 150, one: 'Stück', many: 'Stück' } }, turkey: { name: 'Putenaufschnitt', kcal: 105, p: 21 }, gouda: { name: 'Käse', kcal: 350, p: 25 },
};

type Recipe = { name: string; veg: boolean; how: string; items: [keyof typeof FOOD, number][] };
const MEALS: { id: string; name: string; share: number; options: Recipe[] }[] = [
  { id: 'breakfast', name: 'Frühstück', share: 0.25, options: [
    { name: 'Haferflocken mit Quark und Beeren', veg: true, how: 'Alles in eine Schüssel, mit etwas Wasser oder Milch verrühren. Geht auch am Vorabend.', items: [['oats', 60], ['quark', 200], ['berries', 100], ['nuts', 15]] },
    { name: 'Brot mit Ei und Hüttenkäse', veg: true, how: 'Eier kochen oder braten, Brot mit Hüttenkäse bestreichen, Gemüse dazu.', items: [['bread', 100], ['egg', 120], ['cottage', 100], ['veg', 100]] },
    { name: 'Skyr mit Banane und Haferflocken', veg: true, how: 'Banane schneiden, mit Skyr und Haferflocken mischen, Nüsse darüber.', items: [['skyr', 250], ['banana', 120], ['oats', 40], ['nuts', 15]] },
  ] },
  { id: 'lunch', name: 'Mittagessen', share: 0.3, options: [
    { name: 'Hähnchen mit Reis und Gemüse', veg: false, how: 'Reis kochen, Hähnchen und Gemüse in der Pfanne braten. Lässt sich für drei Tage vorkochen.', items: [['chicken', 150], ['rice', 70], ['veg', 200], ['oil', 10]] },
    { name: 'Linsen-Bowl mit Feta', veg: true, how: 'Linsen 20 Minuten kochen, mit rohem oder gebratenem Gemüse und Feta mischen.', items: [['lentils', 80], ['veg', 200], ['feta', 50], ['oil', 10]] },
    { name: 'Vollkornnudeln mit Hack-Tomatensauce', veg: false, how: 'Hack anbraten, Gemüse und Tomatensauce dazu, zu den Nudeln geben.', items: [['pasta', 80], ['beef', 120], ['sauce', 150], ['veg', 100]] },
  ] },
  { id: 'dinner', name: 'Abendessen', share: 0.3, options: [
    { name: 'Lachs mit Kartoffeln und Gemüse', veg: false, how: 'Alles auf ein Blech, 20 Minuten bei 200 °C in den Ofen.', items: [['salmon', 130], ['potato', 250], ['veg', 200], ['oil', 5]] },
    { name: 'Tofu-Gemüse-Pfanne mit Reis', veg: true, how: 'Tofu würfeln und knusprig braten, Gemüse dazu, mit Sojasauce würzen.', items: [['tofu', 200], ['veg', 250], ['rice', 60], ['oil', 10]] },
    { name: 'Wraps mit Thunfisch', veg: false, how: 'Thunfisch mit Joghurt verrühren, mit Gemüse in die Wraps rollen.', items: [['wrap', 120], ['tuna', 120], ['veg', 150], ['yogurt', 50]] },
    { name: 'Wraps mit Kichererbsen und Feta', veg: true, how: 'Kichererbsen abspülen, mit Feta und Gemüse in die Wraps rollen.', items: [['wrap', 120], ['chickpeas', 150], ['feta', 40], ['veg', 150]] },
  ] },
  { id: 'snack', name: 'Zwischenmahlzeit', share: 0.15, options: [
    { name: 'Quark mit Apfel', veg: true, how: 'Apfel schneiden, unter den Quark heben, Zimt nach Geschmack.', items: [['quark', 250], ['apple', 150]] },
    { name: 'Joghurt mit Nüssen und Beeren', veg: true, how: 'Alles in ein Glas, passt auch ins Büro.', items: [['yogurt', 200], ['nuts', 25], ['berries', 80]] },
    { name: 'Brot mit Putenaufschnitt', veg: false, how: 'Belegen, Gemüse dazu.', items: [['bread', 50], ['turkey', 60], ['veg', 80]] },
    { name: 'Brot mit Käse', veg: true, how: 'Belegen, Gemüse dazu.', items: [['bread', 50], ['gouda', 30], ['veg', 80]] },
  ] },
];

export type MealItem = { key: string; name: string; grams: number; text: string };
export type Meal = { id: string; name: string; title: string; how: string; kcal: number; protein: number; items: MealItem[] };
export type DayPlan = { meals: Meal[]; kcal: number; protein: number };

const kcalOf = (items: [keyof typeof FOOD, number][]) => items.reduce((n, [k, g]) => n + (FOOD[k].kcal * g) / 100, 0);

/** Tagesbeispiel, auf das Kalorienziel skaliert. day wechselt die Gerichte durch. */
export function dayPlan(target: number, day = 0, vegetarian = false): DayPlan {
  const meals = MEALS.map((m) => {
    const options = m.options.filter((o) => !vegetarian || o.veg);
    const recipe = options[day % options.length];
    const factor = Math.max(0.5, Math.min(2.2, (target * m.share) / kcalOf(recipe.items)));
    const items = recipe.items.map(([k, g]) => {
      const f = FOOD[k];
      if (f.piece) {
        const n = Math.max(1, Math.round((g * factor) / f.piece.g));
        return { name: f.name, grams: n * f.piece.g, text: `${n} ${n === 1 ? f.piece.one : f.piece.many}`, k };
      }
      const step = f.step ?? 10;
      const grams = Math.max(step, round(g * factor, step));
      return { name: f.name, grams, text: `${grams} g`, k };
    });
    return {
      id: m.id, name: m.name, title: recipe.name, how: recipe.how,
      kcal: Math.round(items.reduce((n, i) => n + (FOOD[i.k].kcal * i.grams) / 100, 0)),
      protein: Math.round(items.reduce((n, i) => n + (FOOD[i.k].p * i.grams) / 100, 0)),
      items: items.map(({ name, grams, text, k }) => ({ key: k, name, grams, text })),
    };
  });
  return { meals, kcal: meals.reduce((n, m) => n + m.kcal, 0), protein: meals.reduce((n, m) => n + m.protein, 0) };
}

export const RULES = [
  'Zu jeder Mahlzeit eine Eiweißquelle: Quark, Eier, Fisch, Fleisch, Tofu oder Hülsenfrüchte.',
  'Der halbe Teller Gemüse oder Salat. Das sättigt bei wenig Kalorien.',
  'Kalorien nicht trinken: Wasser, Tee, Kaffee ohne Zucker.',
  'Zwei bis drei Gerichte am Sonntag vorkochen, dann ist die Woche halb erledigt.',
  'Kein Lebensmittel ist verboten. 80 % nach Plan, 20 % nach Lust hält länger als 100 % Verzicht.',
  'Ändert sich das Gewicht drei Wochen lang nicht wie geplant, passe die Portionen um etwa 10 % an.',
];

/** Geschätzter Verbrauch beim Gehen (MET-Näherung). kmh zwischen 2 und 6,5. */
export function walkKcal(weightKg: number, minutes: number, kmh: number): number {
  const met = kmh < 2.5 ? 2.0 : kmh < 3.5 ? 2.5 : kmh < 4.5 ? 3.0 : kmh < 5.5 ? 3.6 : 4.3;
  return Math.round((met * weightKg * minutes) / 60);
}

/** Einkaufsliste für mehrere Beispieltage: gleiche Zutaten zusammengezählt, nach Name sortiert. */
export function shoppingList(target: number, days: number[], vegetarian = false): { key: string; name: string; text: string }[] {
  const sum = new Map<string, number>();
  for (const d of days) for (const m of dayPlan(target, d, vegetarian).meals) for (const i of m.items) sum.set(i.key, (sum.get(i.key) ?? 0) + i.grams);
  return [...sum.entries()].map(([key, grams]) => {
    const f = FOOD[key];
    const n = f.piece ? Math.round(grams / f.piece.g) : 0;
    const text = f.piece ? `${n} ${n === 1 ? f.piece.one : f.piece.many}` : grams >= 1000 ? `${String(Math.round(grams / 100) / 10).replace('.', ',')} kg` : `${grams} g`;
    return { key, name: f.name, text };
  }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
