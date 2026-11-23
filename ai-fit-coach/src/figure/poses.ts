/**
 * Bewegungsbilder für die Übungsfigur. Koordinaten in einem Feld von 100 × 100, Boden bei y = 90.
 * Seitenansicht: Figur schaut nach rechts. Frontansicht: Punkte der rechten Körperseite, die linke wird gespiegelt.
 */
export type Pt = [number, number];
export type Pose = { sh: Pt; el: Pt; ha: Pt; hip: Pt; kn: Pt; ft: Pt; el2?: Pt; ha2?: Pt; kn2?: Pt; ft2?: Pt };
export type Scene = 'table' | 'bench' | 'box' | 'bar' | 'chair' | 'wall' | 'lowbar' | 'bars' | 'cable_high' | 'cable_mid' | 'seat';
export type Anim = { a: Pose; b: Pose; front?: boolean; scene?: Scene; /** Stange liegt auf den Schultern statt in den Händen. */ barOnBack?: boolean };

const p = (sh: Pt, el: Pt, ha: Pt, hip: Pt, kn: Pt, ft: Pt, extra: Partial<Pose> = {}): Pose => ({ sh, el, ha, hip, kn, ft, ...extra });

const plankTop = p([30, 66], [30, 78], [30, 90], [55, 74], [70, 81], [86, 88]);
const hingeDown = p([60, 48], [60, 60], [60, 72], [38, 52], [48, 70], [48, 90]);
const stand = p([48, 25], [48, 38], [49, 50], [48, 50], [49, 70], [49, 90]);

export const ANIMS: Record<string, Anim> = {
  incline_pushup: { scene: 'table', a: p([40, 38], [49, 49], [58, 60], [34, 60], [28, 76], [22, 90]), b: p([50, 50], [46, 60], [58, 60], [40, 68], [31, 80], [22, 90]) },
  hold: { a: stand, b: p([48, 26], [48, 39], [49, 51], [48, 51], [49, 70], [49, 90]) },
  squat: { a: p([48, 25], [53, 37], [58, 30], [48, 50], [50, 70], [50, 90]), b: p([46, 44], [52, 55], [58, 48], [38, 66], [56, 70], [50, 90]) },
  chair_squat: { scene: 'chair', a: p([46, 26], [54, 34], [64, 34], [46, 51], [56, 68], [58, 90]), b: p([42, 38], [50, 47], [60, 48], [42, 62], [58, 64], [58, 90]) },
  squat_bar: { a: p([48, 25], [52, 33], [47, 26], [48, 50], [50, 70], [50, 90]), b: p([48, 45], [52, 53], [47, 46], [38, 66], [56, 70], [50, 90]), barOnBack: true },
  lunge: {
    a: p([50, 25], [50, 38], [50, 50], [50, 50], [50, 70], [50, 90], { kn2: [50, 70], ft2: [50, 90] }),
    b: p([50, 37], [50, 50], [50, 62], [50, 62], [62, 72], [62, 90], { kn2: [42, 84], ft2: [30, 88] }),
  },
  bulgarian: {
    scene: 'bench',
    a: p([50, 27], [50, 40], [50, 52], [50, 52], [60, 70], [60, 90], { kn2: [40, 66], ft2: [28, 70] }),
    b: p([50, 39], [50, 52], [50, 64], [50, 64], [63, 72], [60, 90], { kn2: [40, 82], ft2: [28, 70] }),
  },
  step_up: {
    scene: 'box',
    a: p([46, 28], [46, 41], [47, 53], [46, 53], [60, 58], [60, 76], { kn2: [45, 71], ft2: [45, 90] }),
    b: p([60, 13], [60, 26], [61, 38], [60, 38], [60, 57], [60, 76], { kn2: [56, 57], ft2: [56, 76] }),
  },
  hinge: { a: p([45, 25], [46, 38], [47, 50], [45, 50], [47, 70], [47, 90]), b: hingeDown },
  goodmorning: { a: p([45, 25], [51, 22], [46, 16], [45, 50], [47, 70], [47, 90]), b: p([60, 48], [66, 47], [64, 40], [38, 52], [48, 70], [48, 90]) },
  swing: { a: p([58, 46], [56, 58], [50, 68], [38, 52], [48, 70], [48, 90]), b: p([47, 25], [59, 26], [71, 27], [47, 50], [48, 70], [48, 90]) },
  bridge: { a: p([25, 84], [31, 88], [41, 88], [48, 84], [62, 68], [70, 88]), b: p([25, 82], [31, 88], [41, 88], [48, 68], [64, 66], [70, 88]) },
  slider: { a: p([25, 84], [31, 88], [41, 88], [48, 76], [66, 81], [84, 88]), b: p([25, 83], [31, 88], [41, 88], [48, 68], [62, 66], [68, 88]) },
  nordic: { a: p([56, 44], [62, 52], [58, 44], [58, 68], [60, 90], [80, 88]), b: p([34, 64], [38, 74], [32, 70], [50, 76], [60, 90], [80, 88]) },
  pushup: { a: plankTop, b: p([30, 82], [40, 76], [30, 90], [55, 84], [70, 86], [86, 88]) },
  knee_pushup: { a: p([30, 66], [30, 78], [30, 90], [52, 76], [68, 89], [82, 80]), b: p([30, 82], [40, 76], [30, 90], [52, 85], [68, 89], [82, 80]) },
  pike: { a: p([38, 62], [36, 76], [35, 90], [55, 40], [66, 64], [76, 90]), b: p([40, 80], [47, 74], [35, 90], [56, 46], [67, 67], [76, 90]) },
  bench: { scene: 'bench', a: p([30, 64], [30, 51], [30, 38], [55, 64], [68, 66], [70, 88]), b: p([30, 64], [37, 70], [34, 57], [55, 64], [68, 66], [70, 88]) },
  floor_press: { a: p([28, 84], [28, 71], [28, 58], [52, 84], [64, 70], [72, 88]), b: p([28, 84], [36, 86], [33, 74], [52, 84], [64, 70], [72, 88]) },
  pullover: { scene: 'bench', a: p([30, 64], [30, 51], [30, 38], [55, 64], [68, 66], [70, 88]), b: p([30, 64], [20, 56], [9, 58], [55, 64], [68, 66], [70, 88]) },
  skull: { scene: 'bench', a: p([30, 64], [30, 51], [30, 38], [55, 64], [68, 66], [70, 88]), b: p([30, 64], [29, 51], [18, 55], [55, 64], [68, 66], [70, 88]) },
  ohp: { front: true, a: p([59, 30], [69, 39], [67, 27], [55, 55], [56, 72], [57, 90]), b: p([59, 30], [65, 18], [63, 6], [55, 55], [56, 72], [57, 90]) },
  lateral: { front: true, a: p([59, 30], [61, 42], [62, 54], [55, 55], [56, 72], [57, 90]), b: p([59, 30], [72, 30], [85, 29], [55, 55], [56, 72], [57, 90]) },
  pullapart: { front: true, a: p([59, 30], [64, 38], [53, 33], [55, 55], [56, 72], [57, 90]), b: p([59, 30], [72, 31], [85, 31], [55, 55], [56, 72], [57, 90]) },
  pullup: { front: true, scene: 'bar', a: p([58, 34], [63, 21], [64, 8], [55, 60], [55, 76], [55, 92]), b: p([58, 19], [71, 22], [64, 8], [55, 45], [55, 61], [55, 77]) },
  pulldown: { front: true, scene: 'seat', a: p([58, 38], [66, 24], [69, 11], [56, 64], [59, 68], [59, 88]), b: p([58, 38], [72, 45], [67, 32], [56, 64], [59, 68], [59, 88]) },
  curl: { a: stand, b: p([48, 25], [48, 38], [54, 28], [48, 50], [49, 70], [49, 90]) },
  tri_overhead: { a: p([48, 25], [49, 11], [50, 1], [48, 50], [49, 70], [49, 90]), b: p([48, 25], [49, 11], [39, 15], [48, 50], [49, 70], [49, 90]) },
  pushdown: { scene: 'cable_high', a: p([48, 25], [49, 38], [58, 31], [48, 50], [49, 70], [49, 90]), b: p([48, 25], [49, 38], [52, 50], [48, 50], [49, 70], [49, 90]) },
  dip: { scene: 'bars', a: p([50, 26], [50, 38], [50, 50], [51, 51], [55, 68], [48, 82]), b: p([50, 42], [41, 45], [50, 50], [52, 66], [57, 80], [48, 89]) },
  chair_dip: { scene: 'chair', a: p([38, 40], [38, 52], [38, 64], [42, 62], [58, 62], [60, 88]), b: p([38, 54], [30, 58], [38, 64], [42, 76], [58, 66], [60, 88]) },
  row: { a: hingeDown, b: p([60, 48], [54, 42], [60, 53], [38, 52], [48, 70], [48, 90]) },
  revfly: { a: hingeDown, b: p([60, 48], [65, 50], [69, 43], [38, 52], [48, 70], [48, 90]) },
  inverted_row: { scene: 'lowbar', a: p([32, 60], [32, 47], [32, 34], [55, 74], [68, 82], [80, 90]), b: p([33, 44], [43, 50], [32, 34], [56, 64], [69, 77], [80, 90]) },
  seated_row: { scene: 'cable_mid', a: p([42, 58], [51, 65], [63, 67], [40, 84], [56, 74], [68, 84]), b: p([38, 58], [33, 70], [45, 68], [40, 84], [56, 74], [68, 84]) },
  pull_front: { scene: 'cable_mid', a: p([48, 25], [59, 29], [71, 30], [48, 50], [49, 70], [49, 90]), b: p([47, 25], [40, 31], [51, 28], [48, 50], [49, 70], [49, 90]) },
  press_front: { a: p([48, 25], [44, 35], [54, 31], [48, 50], [49, 70], [49, 90]), b: p([48, 25], [59, 29], [71, 30], [48, 50], [49, 70], [49, 90]) },
  plank: { a: p([30, 72], [30, 88], [42, 88], [55, 77], [70, 82], [86, 88]), b: p([30, 72], [30, 88], [42, 88], [55, 75], [70, 81], [86, 88]) },
  side_plank: { a: p([30, 72], [30, 88], [42, 88], [55, 85], [70, 87], [86, 88]), b: p([30, 70], [30, 88], [42, 88], [55, 74], [70, 81], [86, 88]) },
  leg_raise: { a: p([25, 86], [35, 88], [45, 88], [50, 86], [68, 86], [86, 86]), b: p([25, 86], [35, 88], [45, 88], [50, 86], [52, 68], [54, 50]) },
  dead_bug: {
    a: p([25, 86], [27, 74], [28, 62], [50, 86], [52, 70], [66, 68], { kn2: [52, 70], ft2: [66, 68] }),
    b: p([25, 86], [24, 74], [20, 63], [50, 86], [68, 84], [85, 83], { kn2: [52, 70], ft2: [66, 68] }),
  },
  hollow: { a: p([30, 85], [20, 82], [10, 80], [50, 88], [66, 86], [81, 84]), b: p([30, 81], [20, 76], [10, 72], [50, 88], [66, 83], [81, 78]) },
  hang_raise: { scene: 'bar', a: p([50, 32], [50, 20], [50, 8], [50, 58], [50, 75], [50, 92]), b: p([50, 32], [50, 20], [50, 8], [50, 58], [65, 53], [65, 71]) },
  crunch: { scene: 'cable_high', a: p([54, 46], [61, 41], [57, 34], [48, 70], [50, 90], [68, 88]), b: p([63, 60], [66, 52], [61, 47], [48, 70], [50, 90], [68, 88]) },
  bird_dog: {
    a: p([30, 66], [30, 78], [30, 90], [58, 66], [58, 90], [74, 88], { el2: [30, 78], ha2: [30, 90], kn2: [58, 90], ft2: [74, 88] }),
    b: p([30, 66], [18, 63], [7, 61], [58, 66], [74, 66], [91, 66], { el2: [30, 78], ha2: [30, 90], kn2: [58, 90], ft2: [74, 88] }),
  },
  prone_y: { a: p([30, 85], [18, 87], [7, 88], [55, 86], [70, 87], [86, 88]), b: p([30, 80], [18, 75], [7, 69], [55, 86], [70, 87], [86, 88]) },
  calf: { a: p([50, 25], [50, 38], [51, 50], [50, 50], [50, 70], [50, 90]), b: p([50, 20], [50, 33], [51, 45], [50, 45], [50, 65], [53, 90]) },
  leg_curl: { a: p([30, 83], [22, 85], [13, 87], [55, 85], [72, 86], [90, 86]), b: p([30, 83], [22, 85], [13, 87], [55, 85], [72, 86], [75, 67]) },
  leg_ext: { scene: 'chair', a: p([40, 36], [42, 49], [47, 59], [40, 62], [58, 62], [58, 84]), b: p([40, 36], [42, 49], [47, 59], [40, 62], [58, 62], [80, 62]) },
  wall_sit: { scene: 'wall', a: p([32, 38], [36, 50], [46, 56], [32, 62], [52, 62], [52, 88]), b: p([32, 39], [36, 51], [46, 57], [32, 63], [52, 62], [52, 88]) },
  leg_press: { scene: 'seat', a: p([24, 58], [31, 69], [39, 77], [40, 76], [51, 57], [63, 68]), b: p([24, 58], [31, 69], [39, 77], [40, 76], [60, 65], [78, 56]) },
  climber: {
    a: p([30, 66], [30, 78], [30, 90], [55, 72], [52, 82], [62, 88], { kn2: [70, 80], ft2: [86, 88] }),
    b: p([30, 66], [30, 78], [30, 90], [55, 72], [70, 80], [86, 88], { kn2: [52, 82], ft2: [62, 88] }),
  },
  burpee: { a: p([50, 23], [52, 11], [54, 2], [50, 48], [50, 68], [50, 88]), b: plankTop },
  boxing: { a: p([48, 26], [55, 36], [57, 25], [47, 50], [51, 70], [47, 90], { el2: [53, 37], ha2: [55, 27] }), b: p([49, 26], [61, 28], [74, 27], [47, 50], [51, 70], [47, 90], { el2: [53, 37], ha2: [55, 27] }) },
  run: {
    a: p([50, 26], [44, 36], [52, 42], [49, 50], [60, 62], [56, 80], { el2: [56, 36], ha2: [62, 28], kn2: [46, 70], ft2: [40, 88] }),
    b: p([50, 26], [56, 36], [62, 28], [49, 50], [46, 70], [40, 88], { el2: [44, 36], ha2: [52, 42], kn2: [60, 62], ft2: [56, 80] }),
  },
};

/** Übung → Bewegungsbild. */
export const ANIM_OF: Record<string, keyof typeof ANIMS> = {
  chair_squat: 'chair_squat', step_up_bw: 'step_up', incline_pushup: 'incline_pushup', door_row: 'pull_front', standing_knee_raise: 'run', wall_plank: 'incline_pushup', suitcase_hold: 'hold', march: 'run',
  bw_squat: 'squat', pistol_box: 'squat', goblet_squat: 'squat', kb_goblet_squat: 'squat', back_squat: 'squat_bar', front_squat: 'squat_bar', leg_press: 'leg_press',
  good_morning_bw: 'goodmorning', single_leg_rdl_bw: 'hinge', db_rdl: 'hinge', bb_rdl: 'hinge', deadlift: 'hinge', kb_deadlift: 'hinge', kb_swing: 'swing',
  band_good_morning: 'goodmorning', cable_pullthrough: 'hinge', back_extension: 'goodmorning',
  reverse_lunge_bw: 'lunge', bulgarian_bw: 'bulgarian', db_reverse_lunge: 'lunge', db_bulgarian: 'bulgarian', db_step_up: 'step_up', kb_reverse_lunge: 'lunge', walking_lunge: 'lunge',
  knee_pushup: 'knee_pushup', pushup: 'pushup', decline_pushup: 'pushup', band_pushup: 'pushup', db_floor_press: 'floor_press', db_bench: 'bench', incline_db: 'bench',
  bb_bench: 'bench', machine_chest_press: 'press_front', dips: 'dip',
  pike_pushup: 'pike', db_ohp: 'ohp', bb_ohp: 'ohp', kb_press: 'ohp', machine_shoulder_press: 'ohp', band_ohp: 'ohp',
  table_row: 'inverted_row', db_row: 'row', db_chest_row: 'row', kb_row: 'row', bb_row: 'row', inverted_row: 'inverted_row', trx_row: 'inverted_row',
  band_row: 'pull_front', cable_row: 'seated_row', machine_row: 'seated_row',
  negative_pullup: 'pullup', band_pullup: 'pullup', pullup: 'pullup', chinup: 'pullup', lat_pulldown: 'pulldown', cable_pulldown: 'pulldown', band_pulldown: 'pulldown', db_pullover: 'pullover',
  plank: 'plank', side_plank: 'side_plank', dead_bug: 'dead_bug', bird_dog: 'bird_dog', leg_raise: 'leg_raise', hollow_hold: 'hollow', hanging_knee_raise: 'hang_raise',
  pallof_press: 'press_front', cable_crunch: 'crunch',
  db_curl: 'curl', hammer_curl: 'curl', incline_curl: 'curl', bb_curl: 'curl', cable_curl: 'curl', band_curl: 'curl', trx_curl: 'curl',
  db_overhead_ext: 'tri_overhead', db_skullcrusher: 'skull', cable_pushdown: 'pushdown', band_pushdown: 'pushdown', close_pushup: 'pushup', bench_dip: 'chair_dip', close_bench: 'bench',
  db_lateral: 'lateral', cable_lateral: 'lateral', band_lateral: 'lateral', db_reverse_fly: 'revfly', face_pull: 'pull_front', band_pull_apart: 'pullapart',
  trx_reverse_fly: 'pullapart', prone_y_raise: 'prone_y',
  calf_raise_bw: 'calf', db_calf_raise: 'calf', machine_calf_raise: 'calf', glute_bridge_single: 'bridge', band_glute_bridge: 'bridge', db_hip_thrust: 'bridge', bb_hip_thrust: 'bridge',
  slider_curl: 'slider', nordic_curl: 'nordic', band_leg_curl: 'leg_curl', leg_curl: 'leg_curl', wall_sit: 'wall_sit', heel_goblet_squat: 'squat', leg_ext: 'leg_ext',
  db_fly: 'bench', cable_fly: 'press_front', machine_fly: 'press_front', band_fly: 'press_front',
  mountain_climber: 'climber', shadow_boxing: 'boxing', burpee: 'burpee', kb_swing_hiit: 'swing', cardio_intervals: 'run',
};
