import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import type { FocusArea } from './engine/types';
import { colors as c } from './theme';

type Part = { area: FocusArea | null; x: number; y: number; w: number; h: number; r?: number };

// Stilisierte Figur aus einfachen Formen, Vorder- und Rückansicht.
const LIMBS: Part[] = [
  { area: 'Schultern', x: 14, y: 50, w: 26, h: 20, r: 10 }, { area: 'Schultern', x: 80, y: 50, w: 26, h: 20, r: 10 },
  { area: 'Arme', x: 10, y: 73, w: 17, h: 46, r: 8 }, { area: 'Arme', x: 93, y: 73, w: 17, h: 46, r: 8 },
  { area: null, x: 8, y: 122, w: 15, h: 40, r: 7 }, { area: null, x: 97, y: 122, w: 15, h: 40, r: 7 },
  { area: 'Beine', x: 34, y: 158, w: 24, h: 58, r: 10 }, { area: 'Beine', x: 62, y: 158, w: 24, h: 58, r: 10 },
  { area: 'Beine', x: 36, y: 220, w: 19, h: 50, r: 9 }, { area: 'Beine', x: 65, y: 220, w: 19, h: 50, r: 9 },
];
const FRONT: Part[] = [
  { area: 'Brust', x: 32, y: 52, w: 27, h: 30, r: 8 }, { area: 'Brust', x: 61, y: 52, w: 27, h: 30, r: 8 },
  { area: 'Bauch', x: 38, y: 85, w: 44, h: 22, r: 7 }, { area: 'Bauch', x: 38, y: 109, w: 44, h: 22, r: 7 }, { area: 'Bauch', x: 38, y: 133, w: 44, h: 20, r: 7 },
  ...LIMBS,
];
const BACK: Part[] = [
  { area: 'Rücken', x: 32, y: 52, w: 56, h: 40, r: 10 }, { area: 'Rücken', x: 37, y: 95, w: 46, h: 28, r: 9 },
  { area: 'Gesäß', x: 34, y: 126, w: 25, h: 29, r: 11 }, { area: 'Gesäß', x: 61, y: 126, w: 25, h: 29, r: 11 },
  ...LIMBS,
];

function Figure({ parts, focus, toggle, label }: { parts: Part[]; focus: FocusArea[]; toggle: (a: FocusArea) => void; label: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <Svg width={132} height={300} viewBox="0 0 120 274" accessibilityLabel={label}>
        <Circle cx={60} cy={22} r={17} fill={c.surface3} />
        <Rect x={53} y={38} width={14} height={12} rx={4} fill={c.surface3} />
        {parts.map((p, i) => (
          <Rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r ?? 6}
            fill={p.area && focus.includes(p.area) ? c.lime : c.surface3}
            onPress={p.area ? () => toggle(p.area as FocusArea) : undefined} />
        ))}
      </Svg>
      <Text style={{ color: c.faint, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

export function BodyMap({ focus, toggle }: { focus: FocusArea[]; toggle: (a: FocusArea) => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 28 }}>
      <Figure parts={FRONT} focus={focus} toggle={toggle} label="Vorne" />
      <Figure parts={BACK} focus={focus} toggle={toggle} label="Hinten" />
    </View>
  );
}
