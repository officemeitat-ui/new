import type { EquipmentId, Exercise, Level, Limitation, Muscle, Pattern } from './types';

const MUSCLES: Record<Pattern, { primary: Muscle[]; secondary: Muscle[] }> = {
  squat: { primary: ['Quadrizeps', 'Gesäß'], secondary: ['Rumpf'] },
  hinge: { primary: ['Beinbeuger', 'Gesäß'], secondary: ['Rücken'] },
  lunge: { primary: ['Quadrizeps', 'Gesäß'], secondary: ['Beinbeuger'] },
  push_h: { primary: ['Brust'], secondary: ['Trizeps', 'Schultern'] },
  push_v: { primary: ['Schultern'], secondary: ['Trizeps'] },
  pull_h: { primary: ['Rücken'], secondary: ['Bizeps'] },
  pull_v: { primary: ['Rücken'], secondary: ['Bizeps'] },
  core: { primary: ['Rumpf'], secondary: [] },
  biceps: { primary: ['Bizeps'], secondary: [] },
  triceps: { primary: ['Trizeps'], secondary: [] },
  delts_side: { primary: ['Schultern'], secondary: [] },
  delts_rear: { primary: ['Schultern'], secondary: ['Rücken'] },
  calves: { primary: ['Waden'], secondary: [] },
  glutes: { primary: ['Gesäß'], secondary: ['Beinbeuger'] },
  hamstring_iso: { primary: ['Beinbeuger'], secondary: [] },
  quad_iso: { primary: ['Quadrizeps'], secondary: [] },
  chest_iso: { primary: ['Brust'], secondary: [] },
  conditioning: { primary: [], secondary: [] },
};

export const COMPOUND: Pattern[] = ['squat', 'hinge', 'lunge', 'push_h', 'push_v', 'pull_h', 'pull_v'];
const LOWER: Pattern[] = ['squat', 'hinge', 'lunge', 'glutes', 'calves', 'hamstring_iso', 'quad_iso'];
const LOADABLE: EquipmentId[] = ['dumbbells', 'barbell', 'kettlebell', 'cable', 'leg_press', 'lat_machine', 'row_m', 'chest_press_m', 'fly_m', 'shoulder_press_m', 'leg_curl_m', 'leg_ext_m', 'back_ext_m'];

export const PATTERN_NAME: Record<Pattern, string> = {
  squat: 'Kniebeuge', hinge: 'Hüftstreckung', lunge: 'Einbeinig', push_h: 'Drücken horizontal',
  push_v: 'Drücken über Kopf', pull_h: 'Rudern', pull_v: 'Ziehen von oben', core: 'Rumpf',
  biceps: 'Bizeps', triceps: 'Trizeps', delts_side: 'Seitliche Schulter', delts_rear: 'Hintere Schulter',
  calves: 'Waden', glutes: 'Gesäß', hamstring_iso: 'Beinbeuger', quad_iso: 'Beinstrecker',
  chest_iso: 'Brust isoliert', conditioning: 'Kondition',
};

type Opts = Partial<Pick<Exercise, 'mode' | 'perSide' | 'stress' | 'harder' | 'primary' | 'secondary' | 'load' | 'step'>>;

function x(id: string, name: string, pattern: Pattern, needs: EquipmentId[], level: Level, quality: number, cue: string, o: Opts = {}): Exercise {
  const external = needs.some((n) => LOADABLE.includes(n));
  const lower = LOWER.includes(pattern);
  const compound = COMPOUND.includes(pattern) || pattern === 'conditioning';
  const step = needs.includes('barbell') ? (lower ? 5 : 2.5)
    : needs.includes('kettlebell') ? 4
    : needs.includes('dumbbells') ? (compound ? 2 : 1)
    : lower ? 5 : 2.5;
  return {
    id, name, pattern, needs, level, quality, cue,
    primary: MUSCLES[pattern].primary, secondary: MUSCLES[pattern].secondary,
    kind: compound ? 'compound' : 'isolation', mode: 'reps',
    load: external ? 'external' : 'bodyweight', step, ...o,
  };
}

const knee: Limitation[] = ['knee'];
const shoulder: Limitation[] = ['shoulder'];
const back: Limitation[] = ['back'];

export const EXERCISES: Exercise[] = [
  // Kniebeuge
  x('bw_squat', 'Kniebeuge', 'squat', [], 1, 2, 'Füße schulterbreit, Knie folgen den Zehen, Brust aufrecht. Unten kurz halten, kraftvoll hoch.', { harder: 'pistol_box' }),
  x('pistol_box', 'Einbeinige Kniebeuge auf Stuhl', 'squat', [], 3, 3, 'Auf einem Bein langsam auf den Stuhl absenken, ohne zu plumpsen, und einbeinig wieder aufstehen.', { perSide: true, stress: knee }),
  x('goblet_squat', 'Goblet-Kniebeuge', 'squat', ['dumbbells'], 1, 3, 'Hantel vor der Brust, Ellbogen nach unten. Tief gehen, Rücken bleibt lang.'),
  x('kb_goblet_squat', 'Goblet-Kniebeuge mit Kettlebell', 'squat', ['kettlebell'], 1, 3, 'Kettlebell an den Hörnern vor der Brust. Tief gehen, Fersen bleiben am Boden.'),
  x('back_squat', 'Langhantel-Kniebeuge', 'squat', ['barbell', 'rack'], 2, 5, 'Stange auf dem oberen Rücken, Rumpf fest. Hüfte und Knie gleichzeitig beugen, mindestens bis parallel.', { stress: back }),
  x('front_squat', 'Frontkniebeuge', 'squat', ['barbell', 'rack'], 3, 4, 'Stange auf den vorderen Schultern, Ellbogen hoch. Oberkörper bleibt aufrecht.'),
  x('leg_press', 'Beinpresse', 'squat', ['leg_press'], 1, 4, 'Füße schulterbreit, Rücken fest im Polster. Tief absenken, Knie nicht ganz durchstrecken.'),

  // Hüftstreckung
  x('good_morning_bw', 'Good Morning ohne Gewicht', 'hinge', [], 1, 1, 'Hände an den Hinterkopf, Hüfte weit nach hinten schieben, Rücken gerade. Dehnung in den Beinbeugern spüren.', { harder: 'single_leg_rdl_bw' }),
  x('single_leg_rdl_bw', 'Einbeiniges Kreuzheben ohne Gewicht', 'hinge', [], 1, 2, 'Standbein leicht gebeugt, Oberkörper und freies Bein bilden eine Linie. Langsam absenken.', { perSide: true }),
  x('db_rdl', 'Rumänisches Kreuzheben mit Kurzhanteln', 'hinge', ['dumbbells'], 1, 4, 'Hanteln eng am Bein führen, Hüfte nach hinten, Knie leicht gebeugt. Bis zur Dehnung absenken.'),
  x('bb_rdl', 'Rumänisches Kreuzheben', 'hinge', ['barbell'], 2, 5, 'Stange eng am Körper, Hüfte nach hinten, Rücken neutral. Aus der Hüfte aufrichten.', { stress: back }),
  x('deadlift', 'Kreuzheben', 'hinge', ['barbell'], 2, 5, 'Stange über dem Mittelfuß, Rumpf anspannen, Boden wegdrücken. Stange bleibt am Körper.', { stress: back }),
  x('kb_deadlift', 'Kreuzheben mit Kettlebell', 'hinge', ['kettlebell'], 1, 3, 'Kettlebell zwischen den Füßen, Hüfte nach hinten, Rücken gerade, aus den Beinen aufstehen.'),
  x('kb_swing', 'Kettlebell-Swing', 'hinge', ['kettlebell'], 2, 3, 'Der Schwung kommt aus der Hüfte, nicht aus den Armen. Oben Gesäß fest anspannen.', { stress: back }),
  x('band_good_morning', 'Good Morning mit Band', 'hinge', ['bands'], 1, 2, 'Band unter den Füßen und über den Nacken. Hüfte nach hinten, Rücken gerade.'),
  x('cable_pullthrough', 'Pull-through am Kabelzug', 'hinge', ['cable'], 1, 3, 'Rücken zum Kabel, Seil zwischen den Beinen. Hüfte nach hinten und kraftvoll strecken.'),
  x('back_extension', 'Rückenstrecken', 'hinge', ['back_ext_m'], 1, 3, 'Polster unter der Hüfte, aus der Hüfte beugen und bis zur geraden Linie aufrichten.', { load: 'bodyweight' }),

  // Einbeinig
  x('reverse_lunge_bw', 'Ausfallschritt rückwärts', 'lunge', [], 1, 2, 'Großen Schritt nach hinten, vorderes Knie über dem Fuß. Über die vordere Ferse hochdrücken.', { perSide: true, harder: 'bulgarian_bw' }),
  x('bulgarian_bw', 'Bulgarische Kniebeuge', 'lunge', [], 2, 3, 'Hinterer Fuß auf Stuhl oder Sofa. Senkrecht absenken, Gewicht auf dem vorderen Bein.', { perSide: true }),
  x('db_reverse_lunge', 'Ausfallschritt rückwärts mit Kurzhanteln', 'lunge', ['dumbbells'], 1, 4, 'Hanteln seitlich, Schritt nach hinten, Oberkörper aufrecht.', { perSide: true }),
  x('db_bulgarian', 'Bulgarische Kniebeuge mit Kurzhanteln', 'lunge', ['dumbbells'], 2, 5, 'Hinterer Fuß erhöht, Hanteln seitlich. Tief absenken, vorderes Bein arbeitet.', { perSide: true }),
  x('db_step_up', 'Step-up mit Kurzhanteln', 'lunge', ['dumbbells'], 1, 3, 'Ganzen Fuß auf die Stufe, hochdrücken ohne Abstoßen vom hinteren Bein. Langsam absenken.', { perSide: true }),
  x('kb_reverse_lunge', 'Goblet-Ausfallschritt mit Kettlebell', 'lunge', ['kettlebell'], 1, 3, 'Kettlebell vor der Brust, Schritt nach hinten, Oberkörper aufrecht.', { perSide: true }),
  x('walking_lunge', 'Ausfallschritte im Gehen', 'lunge', ['dumbbells'], 2, 4, 'Lange Schritte, hinteres Knie knapp über dem Boden, Tempo ruhig.', { perSide: true, stress: knee }),

  // Drücken horizontal
  x('knee_pushup', 'Liegestütz auf Knien', 'push_h', [], 1, 2, 'Körper von Knie bis Schulter gerade. Brust bis knapp über den Boden.', { harder: 'pushup' }),
  x('pushup', 'Liegestütz', 'push_h', [], 1, 3, 'Hände etwas breiter als die Schultern, Ellbogen etwa 45° zum Körper, Rumpf fest.', { harder: 'decline_pushup' }),
  x('decline_pushup', 'Liegestütz mit erhöhten Füßen', 'push_h', [], 2, 3, 'Füße auf Stuhl oder Stufe. Körper bleibt eine gerade Linie.'),
  x('band_pushup', 'Liegestütz mit Band', 'push_h', ['bands'], 2, 3, 'Band über den oberen Rücken, Enden unter den Händen. Oben voll durchdrücken.'),
  x('db_floor_press', 'Bodendrücken mit Kurzhanteln', 'push_h', ['dumbbells'], 1, 3, 'Auf dem Rücken liegend, Oberarme kurz am Boden ablegen, dann hochdrücken.'),
  x('db_bench', 'Kurzhantel-Bankdrücken', 'push_h', ['dumbbells', 'bench'], 1, 5, 'Schulterblätter zusammen, Hanteln bis auf Brusthöhe absenken, kontrolliert hochdrücken.'),
  x('incline_db', 'Schrägbankdrücken mit Kurzhanteln', 'push_h', ['dumbbells', 'bench'], 2, 5, 'Bank etwa 30° schräg. Hanteln über der oberen Brust führen.'),
  x('bb_bench', 'Bankdrücken', 'push_h', ['barbell', 'bench', 'rack'], 2, 5, 'Schulterblätter fest, Füße am Boden. Stange zur unteren Brust, Ellbogen unter der Stange.', { stress: shoulder }),
  x('machine_chest_press', 'Brustpresse', 'push_h', ['chest_press_m'], 1, 4, 'Griffe auf Brusthöhe, Schulterblätter am Polster, gleichmäßig drücken.'),
  x('dips', 'Dips', 'push_h', ['dip_bars'], 2, 4, 'Leicht vorlehnen, bis etwa 90° im Ellbogen absenken, Schultern weg von den Ohren.', { stress: shoulder, primary: ['Brust', 'Trizeps'], secondary: ['Schultern'] }),

  // Drücken über Kopf
  x('pike_pushup', 'Pike-Liegestütz', 'push_v', [], 2, 2, 'Hüfte hoch wie ein umgedrehtes V, Kopf zwischen den Händen zum Boden führen.', { stress: shoulder }),
  x('db_ohp', 'Schulterdrücken mit Kurzhanteln', 'push_v', ['dumbbells'], 1, 5, 'Hanteln auf Schulterhöhe, gerade nach oben drücken, Rippen unten halten.'),
  x('bb_ohp', 'Schulterdrücken mit Langhantel', 'push_v', ['barbell'], 2, 5, 'Stange vor den Schultern, Gesäß und Bauch fest, Stange in gerader Linie über den Kopf.', { stress: shoulder }),
  x('kb_press', 'Kettlebell-Drücken einarmig', 'push_v', ['kettlebell'], 2, 3, 'Kettlebell liegt am Unterarm, Handgelenk gerade. Senkrecht nach oben drücken.', { perSide: true }),
  x('machine_shoulder_press', 'Schulterpresse', 'push_v', ['shoulder_press_m'], 1, 4, 'Sitz so einstellen, dass die Griffe auf Schulterhöhe starten. Nicht ins Hohlkreuz fallen.'),
  x('band_ohp', 'Schulterdrücken mit Band', 'push_v', ['bands'], 1, 2, 'Auf dem Band stehen, Enden auf Schulterhöhe, gerade nach oben drücken.'),

  // Rudern
  x('table_row', 'Rudern am Tisch', 'pull_h', [], 1, 2, 'Unter einen stabilen Tisch legen, Kante greifen, Brust zur Tischkante ziehen. Vorher Standfestigkeit prüfen.'),
  x('db_row', 'Kurzhantel-Rudern einarmig', 'pull_h', ['dumbbells'], 1, 5, 'Hand und Knie abgestützt, Rücken gerade. Ellbogen zur Hüfte ziehen, nicht zur Schulter.', { perSide: true }),
  x('db_chest_row', 'Rudern auf der Schrägbank', 'pull_h', ['dumbbells', 'bench'], 1, 5, 'Brust auf der Schrägbank, beide Hanteln gleichzeitig ziehen, Schulterblätter zusammen.'),
  x('kb_row', 'Kettlebell-Rudern einarmig', 'pull_h', ['kettlebell'], 1, 4, 'Vorgebeugt mit geradem Rücken, Kettlebell zur Hüfte ziehen.', { perSide: true }),
  x('bb_row', 'Langhantel-Rudern', 'pull_h', ['barbell'], 2, 5, 'Oberkörper etwa 45° vorgebeugt, Stange zum Bauchnabel ziehen, kein Schwung.', { stress: back }),
  x('inverted_row', 'Rudern an der Stange im Rack', 'pull_h', ['barbell', 'rack'], 1, 4, 'Stange auf Hüfthöhe ablegen, darunter hängen, Brust zur Stange ziehen, Körper gerade.'),
  x('trx_row', 'Rudern am Schlingentrainer', 'pull_h', ['trx'], 1, 4, 'Je flacher der Körper, desto schwerer. Schulterblätter zusammenziehen.'),
  x('band_row', 'Rudern mit Band', 'pull_h', ['bands'], 1, 3, 'Band um einen festen Punkt oder die Füße. Ellbogen eng am Körper nach hinten.'),
  x('cable_row', 'Rudern am Kabelzug', 'pull_h', ['cable'], 1, 5, 'Aufrecht sitzen, Griff zum Bauch ziehen, Schulterblätter aktiv zurück.'),
  x('machine_row', 'Rudermaschine', 'pull_h', ['row_m'], 1, 4, 'Brust am Polster, Ellbogen nach hinten ziehen, kurz halten.'),

  // Ziehen von oben
  x('negative_pullup', 'Negative Klimmzüge', 'pull_v', ['pullup_bar'], 1, 3, 'Hochspringen oder hochsteigen, dann 3–5 Sekunden kontrolliert ablassen.', { harder: 'pullup' }),
  x('band_pullup', 'Klimmzug mit Bandunterstützung', 'pull_v', ['pullup_bar', 'bands'], 1, 4, 'Band an die Stange, Fuß oder Knie hinein. Brust zur Stange, voll aushängen.', { harder: 'pullup' }),
  x('pullup', 'Klimmzug', 'pull_v', ['pullup_bar'], 2, 5, 'Aus dem vollen Hang, Schulterblätter nach unten, Kinn über die Stange.'),
  x('chinup', 'Klimmzug im Untergriff', 'pull_v', ['pullup_bar'], 2, 5, 'Handflächen zu dir, schulterbreit. Voll aushängen, Brust zur Stange.'),
  x('lat_pulldown', 'Latzug', 'pull_v', ['lat_machine'], 1, 5, 'Leicht zurücklehnen, Stange zur oberen Brust ziehen, Ellbogen nach unten.'),
  x('cable_pulldown', 'Latzug am Kabel', 'pull_v', ['cable'], 1, 4, 'Kniend oder sitzend, Griff von oben zur Brust ziehen.'),
  x('band_pulldown', 'Latzug mit Band', 'pull_v', ['bands'], 1, 2, 'Band oben befestigen (Tür, Stange), kniend zur Brust ziehen.'),
  x('db_pullover', 'Überzug mit Kurzhantel', 'pull_v', ['dumbbells', 'bench'], 2, 2, 'Quer oder längs auf der Bank, Hantel mit fast gestreckten Armen hinter den Kopf führen.'),

  // Rumpf
  x('plank', 'Unterarmstütz', 'core', [], 1, 3, 'Ellbogen unter den Schultern, Gesäß und Bauch anspannen, kein Hohlkreuz.', { mode: 'time' }),
  x('side_plank', 'Seitstütz', 'core', [], 1, 3, 'Ellbogen unter der Schulter, Hüfte hoch, Körper in einer Linie.', { mode: 'time', perSide: true }),
  x('dead_bug', 'Dead Bug', 'core', [], 1, 3, 'Unterer Rücken bleibt am Boden. Gegenüberliegenden Arm und Bein langsam strecken.'),
  x('bird_dog', 'Bird Dog', 'core', [], 1, 2, 'Im Vierfüßlerstand Arm und gegenüberliegendes Bein strecken, Becken bleibt ruhig.'),
  x('leg_raise', 'Beinheben im Liegen', 'core', [], 1, 3, 'Unterer Rücken am Boden, gestreckte Beine langsam absenken.', { stress: back }),
  x('hollow_hold', 'Hollow Hold', 'core', [], 2, 4, 'Schultern und Beine knapp über dem Boden, unterer Rücken drückt in die Matte.', { mode: 'time' }),
  x('hanging_knee_raise', 'Knieheben im Hang', 'core', ['pullup_bar'], 2, 4, 'Ohne Schwung die Knie zur Brust ziehen, langsam ablassen.'),
  x('pallof_press', 'Pallof Press mit Band', 'core', ['bands'], 1, 3, 'Seitlich zum Band stehen, Hände vor der Brust nach vorn strecken, nicht verdrehen lassen.', { perSide: true }),
  x('cable_crunch', 'Crunch am Kabelzug', 'core', ['cable'], 1, 4, 'Kniend, Seil am Kopf. Wirbelsäule einrollen, Hüfte bleibt ruhig.'),

  // Arme
  x('db_curl', 'Kurzhantel-Curl', 'biceps', ['dumbbells'], 1, 4, 'Ellbogen bleiben am Körper, kein Schwung, langsam absenken.'),
  x('hammer_curl', 'Hammer-Curl', 'biceps', ['dumbbells'], 1, 4, 'Daumen zeigen nach oben, Ellbogen fixiert.'),
  x('incline_curl', 'Curl auf der Schrägbank', 'biceps', ['dumbbells', 'bench'], 2, 5, 'Arme hängen hinter dem Körper, Bizeps arbeitet aus der Dehnung.'),
  x('bb_curl', 'Langhantel-Curl', 'biceps', ['barbell'], 1, 4, 'Schulterbreit greifen, Oberkörper ruhig, volle Streckung unten.'),
  x('cable_curl', 'Curl am Kabelzug', 'biceps', ['cable'], 1, 4, 'Gleichmäßige Spannung, Ellbogen vorn am Körper halten.'),
  x('band_curl', 'Curl mit Band', 'biceps', ['bands'], 1, 3, 'Auf dem Band stehen, Ellbogen am Körper, oben kurz halten.'),
  x('trx_curl', 'Curl am Schlingentrainer', 'biceps', ['trx'], 1, 3, 'Zurücklehnen, Ellbogen hoch und ruhig, Hände zur Stirn ziehen.'),
  x('db_overhead_ext', 'Trizepsstrecken über Kopf', 'triceps', ['dumbbells'], 1, 4, 'Ellbogen zeigen nach oben und bleiben eng, Hantel hinter den Kopf absenken.'),
  x('db_skullcrusher', 'Trizepsstrecken im Liegen', 'triceps', ['dumbbells', 'bench'], 1, 4, 'Oberarme senkrecht, nur die Unterarme bewegen sich.'),
  x('cable_pushdown', 'Trizepsdrücken am Kabel', 'triceps', ['cable'], 1, 5, 'Ellbogen am Körper fixiert, unten voll strecken.'),
  x('band_pushdown', 'Trizepsdrücken mit Band', 'triceps', ['bands'], 1, 3, 'Band oben befestigen, Ellbogen am Körper, nach unten strecken.'),
  x('close_pushup', 'Enger Liegestütz', 'triceps', [], 2, 3, 'Hände unter der Brust, Ellbogen eng am Körper.', { secondary: ['Brust'] }),
  x('bench_dip', 'Dips am Stuhl', 'triceps', [], 1, 2, 'Hände an der Stuhlkante, Rücken nah am Stuhl, nur bis 90° absenken.', { stress: shoulder }),
  x('close_bench', 'Enges Bankdrücken', 'triceps', ['barbell', 'bench', 'rack'], 2, 4, 'Schulterbreit greifen, Ellbogen nah am Körper.', { secondary: ['Brust'] }),

  // Schultern
  x('db_lateral', 'Seitheben', 'delts_side', ['dumbbells'], 1, 5, 'Arme leicht gebeugt, bis Schulterhöhe heben, langsam absenken. Lieber leicht und sauber.'),
  x('cable_lateral', 'Seitheben am Kabel', 'delts_side', ['cable'], 1, 5, 'Kabel hinter dem Körper führen, gleichmäßige Spannung über den ganzen Weg.', { perSide: true }),
  x('band_lateral', 'Seitheben mit Band', 'delts_side', ['bands'], 1, 3, 'Auf dem Band stehen, Arme seitlich bis Schulterhöhe.'),
  x('db_reverse_fly', 'Reverse Fly vorgebeugt', 'delts_rear', ['dumbbells'], 1, 4, 'Oberkörper vorgebeugt, Arme seitlich öffnen, Schulterblätter zusammen.'),
  x('face_pull', 'Face Pull', 'delts_rear', ['cable'], 1, 5, 'Seil zur Stirn ziehen, Ellbogen hoch, Hände am Ende auseinander.'),
  x('band_pull_apart', 'Band auseinanderziehen', 'delts_rear', ['bands'], 1, 4, 'Arme gestreckt vor der Brust, Band bis zur Brust auseinanderziehen.'),
  x('trx_reverse_fly', 'Reverse Fly am Schlingentrainer', 'delts_rear', ['trx'], 1, 3, 'Arme gestreckt seitlich öffnen, Körper bleibt gerade.'),
  x('prone_y_raise', 'Y-Heben in Bauchlage', 'delts_rear', [], 1, 2, 'Auf dem Bauch liegend die Arme als Y anheben, Daumen nach oben.'),

  // Beine isoliert
  x('calf_raise_bw', 'Wadenheben einbeinig', 'calves', [], 1, 3, 'Fußballen auf einer Stufe, tief absenken, oben kurz halten.', { perSide: true }),
  x('db_calf_raise', 'Wadenheben mit Kurzhantel', 'calves', ['dumbbells'], 1, 4, 'Einbeinig auf der Stufe, Hantel auf der Seite des Standbeins.', { perSide: true }),
  x('machine_calf_raise', 'Wadenheben an der Beinpresse', 'calves', ['leg_press'], 1, 5, 'Fußballen an der Plattenkante, volle Dehnung unten.'),
  x('glute_bridge_single', 'Einbeinige Glute Bridge', 'glutes', [], 1, 2, 'Schultern am Boden, über die Ferse hochdrücken, Hüfte oben voll strecken.', { perSide: true }),
  x('band_glute_bridge', 'Glute Bridge mit Band', 'glutes', ['bands'], 1, 3, 'Band über die Hüfte, Enden unter den Händen fixieren. Oben Gesäß fest anspannen.'),
  x('db_hip_thrust', 'Hip Thrust mit Kurzhantel', 'glutes', ['dumbbells', 'bench'], 1, 4, 'Schulterblätter an der Bankkante, Hantel auf der Hüfte, Kinn zur Brust.'),
  x('bb_hip_thrust', 'Hip Thrust mit Langhantel', 'glutes', ['barbell', 'bench'], 2, 5, 'Stange gepolstert auf der Hüfte, oben Becken aufrichten und kurz halten.'),
  x('slider_curl', 'Beinbeuger-Curl mit Handtuch', 'hamstring_iso', [], 2, 3, 'Fersen auf einem Handtuch auf glattem Boden, Hüfte oben halten, Fersen heranziehen.'),
  x('nordic_curl', 'Nordic Curl', 'hamstring_iso', [], 3, 4, 'Füße fixieren, Körper gerade nach vorn ablassen, so langsam wie möglich.', { stress: knee }),
  x('band_leg_curl', 'Beinbeuger-Curl mit Band', 'hamstring_iso', ['bands'], 1, 3, 'In Bauchlage, Band am Fuß und an einem festen Punkt, Ferse zum Gesäß.', { perSide: true }),
  x('leg_curl', 'Beinbeuger-Maschine', 'hamstring_iso', ['leg_curl_m'], 1, 5, 'Hüfte bleibt am Polster, langsam zurückführen.'),
  x('wall_sit', 'Wandsitz', 'quad_iso', [], 1, 2, 'Rücken an der Wand, Knie im rechten Winkel, halten.', { mode: 'time' }),
  x('heel_goblet_squat', 'Goblet-Kniebeuge mit erhöhten Fersen', 'quad_iso', ['dumbbells'], 1, 4, 'Fersen auf einer Scheibe oder einem Buch, Oberkörper aufrecht, Knie weit nach vorn.', { stress: knee }),
  x('leg_ext', 'Beinstrecker', 'quad_iso', ['leg_ext_m'], 1, 5, 'Oben kurz halten, langsam absenken.', { stress: knee }),

  // Brust isoliert
  x('db_fly', 'Fliegende mit Kurzhanteln', 'chest_iso', ['dumbbells', 'bench'], 1, 4, 'Arme leicht gebeugt, weit öffnen bis zur Dehnung, über der Brust zusammenführen.', { stress: shoulder }),
  x('cable_fly', 'Cable Fly', 'chest_iso', ['cable'], 1, 5, 'Schritt nach vorn, Arme in einem Bogen vor der Brust zusammenführen.'),
  x('machine_fly', 'Butterfly', 'chest_iso', ['fly_m'], 1, 5, 'Ellbogen leicht gebeugt, Griffe vor der Brust zusammen, langsam öffnen.'),
  x('band_fly', 'Fliegende mit Band', 'chest_iso', ['bands'], 1, 3, 'Band hinter dem Rücken oder an der Tür, Arme vor der Brust zusammenführen.'),

  // Kondition
  x('mountain_climber', 'Mountain Climbers', 'conditioning', [], 1, 3, 'Im Stütz die Knie abwechselnd zügig zur Brust, Hüfte bleibt tief.', { mode: 'time' }),
  x('shadow_boxing', 'Schattenboxen', 'conditioning', [], 1, 2, 'Locker auf den Fußballen, gerade Schläge im Wechsel, Tempo hoch halten.', { mode: 'time' }),
  x('burpee', 'Burpees', 'conditioning', [], 2, 4, 'In den Stütz springen, Brust zum Boden, aufspringen. Gleichmäßiges Tempo.', { mode: 'time', stress: knee }),
  x('kb_swing_hiit', 'Kettlebell-Swings auf Zeit', 'conditioning', ['kettlebell'], 2, 4, 'Kraft aus der Hüfte, Rücken gerade, gleichmäßiger Rhythmus.', { mode: 'time', stress: back, load: 'bodyweight' }),
  x('cardio_intervals', 'Intervalle am Cardiogerät', 'conditioning', ['cardio'], 1, 5, 'In der Belastung zügig, aber kontrolliert. In der Pause locker weiterbewegen.', { mode: 'time' }),
];

const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));
export const exercise = (id: string): Exercise => BY_ID.get(id) ?? EXERCISES[0];
export const hasExercise = (id: string) => BY_ID.has(id);
