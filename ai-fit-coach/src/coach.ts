import { equipmentName } from './engine/equipment';
import { exercise } from './engine/exercises';
import { upgrades, weeklyVolume } from './engine/plan';
import { activeWeeks, records, sessionsThisWeek } from './engine/progression';
import type { Plan, Profile, Session } from './engine/types';

export type CoachContext = { profile: Profile; plan: Plan; history: Session[] };

export const QUICK_QUESTIONS = [
  'Warum sieht mein Plan so aus?',
  'Wann erhöhe ich das Gewicht?',
  'Welches Equipment lohnt sich?',
  'Ich komme nicht weiter',
  'Wie viel Eiweiß brauche ich?',
  'Ich habe heute wenig Zeit',
];

const LEVEL = ['', 'Einsteiger', 'Fortgeschritten', 'Erfahren'];

/** Kurzer Kontext für den KI-Coach am Server (keine Namen, keine Rohdaten). */
export function coachContext({ profile, plan, history }: CoachContext): string {
  const recs = records(history).slice(0, 5).map((r) => `${exercise(r.exerciseId).name}: ${Math.round(r.best)}`).join('; ');
  return [
    `Ziel: ${profile.goal}; Level: ${LEVEL[profile.level]}; ${profile.daysPerWeek} Tage/Woche, ${profile.minutes} Min.`,
    `Equipment: ${profile.equipment.map(equipmentName).join(', ') || 'nur Körpergewicht'}`,
    `Split: ${plan.split}; Tage: ${plan.days.map((d) => `${d.name} (${d.items.map((i) => exercise(i.exerciseId).name).join(', ')})`).join(' | ')}`,
    `Einheiten gesamt: ${history.length}; diese Woche: ${sessionsThisWeek(history).length}`,
    recs ? `Bestwerte: ${recs}` : '',
  ].filter(Boolean).join('\n').slice(0, 1900);
}

/** Regelbasierter Coach: arbeitet nur mit den lokalen Daten, ohne Internet. */
export function localCoach(question: string, ctx: CoachContext): string {
  const { profile, plan, history } = ctx;
  const q = question.toLowerCase();
  const has = (re: RegExp) => re.test(q);

  if (has(/schmerz|verletz|schwindel|brust.*(druck|stech)|ohnmacht|taub|atemnot/)) {
    return 'Bitte brich das Training ab. Schmerzen, Schwindel oder Druck auf der Brust gehören ärztlich abgeklärt, bevor du weitertrainierst. Ich kann keine Diagnose stellen. Wenn es nur eine bestimmte Übung betrifft, tausche sie im Plan und trag die Problemzone im Profil ein, dann lasse ich belastende Übungen weg.';
  }
  if (has(/equipment|gerät|anschaff|kaufen|hantel|lohnt|ausstattung/)) {
    const up = upgrades(profile);
    if (!up.length) return `Dein Equipment deckt den Plan zu ${plan.score} % ab. Eine weitere Anschaffung bringt kaum noch etwas. Der Fortschritt kommt jetzt aus sauberer Steigerung von Einheit zu Einheit.`;
    return `Dein Equipment deckt den Plan zu ${plan.score} % ab. Das würde am meisten bringen:\n${up.map((u) => `• ${u.items.map(equipmentName).join(' + ')}: ${u.score} % (+${u.gain})`).join('\n')}\nTrag neues Equipment im Profil ein, dann stelle ich den Plan um.`;
  }
  if (has(/stagn|plateau|nicht weiter|komme nicht|festgefahren|kein fortschritt/)) {
    const weeks = activeWeeks(history);
    return [
      'Wenn es bei einer Übung stockt, prüfe der Reihe nach:',
      '1. Technik und Bewegungsumfang gleich wie immer? Halbe Wiederholungen zählen nicht.',
      '2. Genug Pause? Bei schweren Grundübungen sind 2–3 Minuten sinnvoll.',
      '3. Zwei Einheiten in Folge unter dem Wiederholungsziel: Ich nehme das Gewicht um 10 % zurück und baue neu auf.',
      '4. Schlaf und Essen: Zu wenig von beidem bremst zuerst die Kraft.',
      weeks >= 6 ? `Du trainierst seit ${weeks} Wochen ohne Unterbrechung. Eine leichtere Woche (halbe Sätze, gleiches Gewicht) hilft oft mehr als noch mehr Druck.` : 'Wenn es an derselben Übung liegt: Tausche sie im Plan gegen eine Variante und komm später zurück.',
    ].join('\n');
  }
  if (has(/gewicht|steiger|erhöh|progress|schwerer|wann mehr/)) {
    return 'Ich arbeite mit doppelter Progression. Jede Übung hat einen Wiederholungsbereich, zum Beispiel 6–10. Du bleibst beim Gewicht, bis du in allen Sätzen das obere Ende schaffst. Dann erhöhe ich das Gewicht um den kleinsten Schritt und du startest wieder unten im Bereich. Bei Übungen ohne Gewicht schlage ich stattdessen die schwerere Variante vor. Der Vorschlag steht im Workout bei jeder Übung.';
  }
  if (has(/eiweiß|protein|ernähr|essen|kalorien|diät|abnehm/)) {
    const fat = profile.goal === 'Fettabbau';
    return [
      'Als Richtwert für Krafttraining gelten etwa 1,6–2,2 g Eiweiß pro kg Körpergewicht am Tag, verteilt auf mehrere Mahlzeiten.',
      fat ? 'Für Fettabbau zählt ein moderates Kaloriendefizit. Zu schnelles Abnehmen kostet Kraft und Muskeln. Das Krafttraining bleibt dabei gleich schwer, damit die Muskulatur erhalten bleibt.'
        : profile.goal === 'Muskelaufbau' ? 'Für Muskelaufbau hilft ein kleiner Kalorienüberschuss. Ohne genug Energie wächst wenig, egal wie gut der Plan ist.'
        : 'Iss ausreichend und regelmäßig. Ohne Energie leidet die Trainingsqualität.',
      'Bei Vorerkrankungen oder Unsicherheit sprich mit Ärztin, Arzt oder Ernährungsberatung. Ich gebe keine individuelle Ernährungstherapie.',
    ].join('\n');
  }
  if (has(/zeit|kurz|minute|stress|schnell/)) {
    return `Wenig Zeit: Mach von der heutigen Einheit die ersten drei Übungen mit je zwei harten Sätzen. Das sind die wichtigsten des Tages und dauert rund 20 Minuten. Soll es dauerhaft kürzer sein, stell im Profil die Trainingszeit um (aktuell ${profile.minutes} Min.), dann kürze ich den Plan gezielt.`;
  }
  if (has(/muskelkater|erhol|regener|pause|schlaf|müde|übertrain/)) {
    return 'Leichter Muskelkater ist kein Problem, damit kannst du trainieren. Bei starkem Muskelkater im Zielmuskel: einen Tag warten oder die Einheit tauschen. 7–9 Stunden Schlaf sind der größte Hebel für Erholung. Plane zwischen zwei Einheiten für dieselbe Muskelgruppe möglichst 48 Stunden ein.';
  }
  if (has(/aufwärm|warm|dehn|mobil/)) {
    return 'Aufwärmen: 3–5 Minuten locker in Bewegung kommen, dann für die erste schwere Übung 2–3 Aufwärmsätze mit steigendem Gewicht (etwa 50 %, 70 %, 85 % des Arbeitsgewichts, wenige Wiederholungen). Langes statisches Dehnen direkt vor schweren Sätzen ist nicht nötig. Nach dem Training oder an freien Tagen ist es gut aufgehoben.';
  }
  if (has(/wie oft|häufig|tage|split|plan|warum|aufbau/)) {
    const vol = weeklyVolume(plan);
    const top = Object.entries(vol).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, n]) => `${m} ${Math.round(n)}`).join(', ');
    return [
      `Dein Plan: ${plan.split}, ${profile.daysPerWeek} Einheiten pro Woche zu etwa ${profile.minutes} Minuten, Ziel ${profile.goal}.`,
      profile.daysPerWeek <= 3 ? 'Bei 2–3 Tagen trainierst du jedes Mal den ganzen Körper. So wird jeder Muskel mehrmals pro Woche gefordert.'
        : profile.daysPerWeek === 4 ? 'Bei 4 Tagen wechseln Ober- und Unterkörper. Jede Muskelgruppe kommt zweimal pro Woche dran und hat dazwischen Zeit.'
        : 'Bei 5–6 Tagen ist der Plan nach Drücken, Ziehen und Beinen geteilt. Die Einheiten bleiben kurz, das Wochenvolumen ist hoch.',
      'Jede Einheit beginnt mit den Übungen, die am meisten bringen. Kleine Übungen stehen am Ende und fallen zuerst weg, wenn die Zeit knapp ist.',
      `Die Übungen sind nach deinem Equipment gewählt (Abdeckung ${plan.score} %). Sätze pro Woche, höchste Werte: ${top}.`,
    ].join('\n');
  }
  const week = sessionsThisWeek(history).length;
  return `Diese Woche: ${week} von ${profile.daysPerWeek} Einheiten. Ziel: ${profile.goal}. ${week < profile.daysPerWeek ? 'Als Nächstes steht deine nächste Einheit im Tab „Training“ bereit.' : 'Wochenziel erreicht. Erholung gehört zum Plan.'}\nFrag mich zum Beispiel nach deinem Plan, nach Steigerung, Equipment, Ernährung, Erholung oder was du bei wenig Zeit tun sollst.`;
}
