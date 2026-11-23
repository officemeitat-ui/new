import type { EquipmentId } from './types';

export type EquipmentGroup = 'Freie Gewichte' | 'Zuhause und unterwegs' | 'Kabel und Maschinen';
export type EquipmentInfo = { id: EquipmentId; name: string; hint: string; icon: string; group: EquipmentGroup };

export const EQUIPMENT: EquipmentInfo[] = [
  { id: 'dumbbells', name: 'Kurzhanteln', hint: 'verstellbar oder mehrere Paare', icon: 'barbell-outline', group: 'Freie Gewichte' },
  { id: 'barbell', name: 'Langhantel', hint: 'mit Scheiben', icon: 'remove-outline', group: 'Freie Gewichte' },
  { id: 'rack', name: 'Rack', hint: 'Kniebeugenständer mit Ablagen', icon: 'grid-outline', group: 'Freie Gewichte' },
  { id: 'bench', name: 'Hantelbank', hint: 'flach oder verstellbar', icon: 'bed-outline', group: 'Freie Gewichte' },
  { id: 'kettlebell', name: 'Kettlebell', hint: 'eine reicht für den Anfang', icon: 'ellipse-outline', group: 'Freie Gewichte' },
  { id: 'pullup_bar', name: 'Klimmzugstange', hint: 'Türreck oder Wandmontage', icon: 'reorder-two-outline', group: 'Zuhause und unterwegs' },
  { id: 'dip_bars', name: 'Dip-Barren', hint: 'oder Dip-Station', icon: 'pause-outline', group: 'Zuhause und unterwegs' },
  { id: 'bands', name: 'Widerstandsbänder', hint: 'Loop- oder Tube-Bänder', icon: 'infinite-outline', group: 'Zuhause und unterwegs' },
  { id: 'trx', name: 'Schlingentrainer', hint: 'TRX oder Turnringe', icon: 'git-merge-outline', group: 'Zuhause und unterwegs' },
  { id: 'walkpad', name: 'Gehpad', hint: 'Laufband für unter den Schreibtisch', icon: 'walk-outline', group: 'Zuhause und unterwegs' },
  { id: 'cable', name: 'Kabelzug', hint: 'einzeln oder Turm', icon: 'swap-vertical-outline', group: 'Kabel und Maschinen' },
  { id: 'lat_machine', name: 'Latzug', hint: 'Zugmaschine von oben', icon: 'arrow-down-outline', group: 'Kabel und Maschinen' },
  { id: 'row_m', name: 'Rudermaschine', hint: 'sitzend, mit Brustpolster', icon: 'arrow-back-outline', group: 'Kabel und Maschinen' },
  { id: 'chest_press_m', name: 'Brustpresse', hint: 'sitzend drücken', icon: 'arrow-forward-outline', group: 'Kabel und Maschinen' },
  { id: 'fly_m', name: 'Butterfly', hint: 'Brust isoliert', icon: 'contract-outline', group: 'Kabel und Maschinen' },
  { id: 'shoulder_press_m', name: 'Schulterpresse', hint: 'sitzend über Kopf drücken', icon: 'arrow-up-outline', group: 'Kabel und Maschinen' },
  { id: 'leg_press', name: 'Beinpresse', hint: 'auch für Wadenheben', icon: 'push-outline', group: 'Kabel und Maschinen' },
  { id: 'leg_curl_m', name: 'Beinbeuger-Maschine', hint: 'liegend oder sitzend', icon: 'return-down-back-outline', group: 'Kabel und Maschinen' },
  { id: 'leg_ext_m', name: 'Beinstrecker', hint: 'sitzend', icon: 'return-up-forward-outline', group: 'Kabel und Maschinen' },
  { id: 'back_ext_m', name: 'Rückenstrecker', hint: 'Hyperextension-Bank', icon: 'trending-up-outline', group: 'Kabel und Maschinen' },
  { id: 'cardio', name: 'Cardiogerät', hint: 'Rad, Rudergerät, Laufband', icon: 'bicycle-outline', group: 'Kabel und Maschinen' },
];

export const EQUIPMENT_GROUPS: EquipmentGroup[] = ['Freie Gewichte', 'Zuhause und unterwegs', 'Kabel und Maschinen'];
export const MACHINES: EquipmentId[] = ['lat_machine', 'row_m', 'chest_press_m', 'fly_m', 'shoulder_press_m', 'leg_press', 'leg_curl_m', 'leg_ext_m', 'back_ext_m'];

export const equipmentName = (id: EquipmentId) => EQUIPMENT.find((e) => e.id === id)?.name ?? id;

export type EquipmentPreset = { id: string; name: string; hint: string; items: EquipmentId[] };

export const PRESETS: EquipmentPreset[] = [
  { id: 'none', name: 'Ohne Geräte', hint: 'nur Körpergewicht', items: [] },
  { id: 'home', name: 'Zuhause', hint: 'Kurzhanteln, Bänder, Klimmzugstange', items: ['dumbbells', 'bands', 'pullup_bar'] },
  { id: 'homegym', name: 'Home-Gym', hint: 'Langhantel, Rack, Bank', items: ['dumbbells', 'barbell', 'rack', 'bench', 'pullup_bar', 'bands'] },
  { id: 'gym', name: 'Fitnessstudio', hint: 'alles vorhanden', items: EQUIPMENT.map((e) => e.id) },
];
