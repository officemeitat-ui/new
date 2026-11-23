import type { EquipmentId } from './types';

export type EquipmentInfo = { id: EquipmentId; name: string; hint: string; icon: string };

export const EQUIPMENT: EquipmentInfo[] = [
  { id: 'dumbbells', name: 'Kurzhanteln', hint: 'verstellbar oder mehrere Paare', icon: 'barbell-outline' },
  { id: 'barbell', name: 'Langhantel', hint: 'mit Scheiben', icon: 'remove-outline' },
  { id: 'rack', name: 'Rack', hint: 'Kniebeugenständer mit Ablagen', icon: 'grid-outline' },
  { id: 'bench', name: 'Hantelbank', hint: 'flach oder verstellbar', icon: 'bed-outline' },
  { id: 'pullup_bar', name: 'Klimmzugstange', hint: 'Türreck oder Wandmontage', icon: 'reorder-two-outline' },
  { id: 'dip_bars', name: 'Dip-Barren', hint: 'oder Dip-Station', icon: 'pause-outline' },
  { id: 'kettlebell', name: 'Kettlebell', hint: 'eine reicht für den Anfang', icon: 'ellipse-outline' },
  { id: 'bands', name: 'Widerstandsbänder', hint: 'Loop- oder Tube-Bänder', icon: 'infinite-outline' },
  { id: 'trx', name: 'Schlingentrainer', hint: 'TRX oder Turnringe', icon: 'git-merge-outline' },
  { id: 'cable', name: 'Kabelzug', hint: 'einzeln oder Turm', icon: 'swap-vertical-outline' },
  { id: 'machines', name: 'Kraftmaschinen', hint: 'Beinpresse, Latzug, Beinbeuger …', icon: 'hardware-chip-outline' },
  { id: 'cardio', name: 'Cardiogerät', hint: 'Rad, Rudergerät, Laufband', icon: 'bicycle-outline' },
];

export const equipmentName = (id: EquipmentId) => EQUIPMENT.find((e) => e.id === id)?.name ?? id;

export type EquipmentPreset = { id: string; name: string; hint: string; items: EquipmentId[] };

export const PRESETS: EquipmentPreset[] = [
  { id: 'none', name: 'Ohne Geräte', hint: 'nur Körpergewicht', items: [] },
  { id: 'home', name: 'Zuhause', hint: 'Kurzhanteln, Bänder, Klimmzugstange', items: ['dumbbells', 'bands', 'pullup_bar'] },
  { id: 'homegym', name: 'Home-Gym', hint: 'Langhantel, Rack, Bank', items: ['dumbbells', 'barbell', 'rack', 'bench', 'pullup_bar', 'bands'] },
  { id: 'gym', name: 'Fitnessstudio', hint: 'alles vorhanden', items: EQUIPMENT.map((e) => e.id) },
];

export const samePreset = (a: EquipmentId[], b: EquipmentId[]) => a.length === b.length && a.every((x) => b.includes(x));
