import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { colors as c, radius, spacing } from './theme';

export type IconName = keyof typeof Ionicons.glyphMap;
const bolt = require('../assets/energy-bolt.png');

export function Button({ title, onPress, variant = 'primary', disabled = false, icon, small = false }: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; icon?: IconName; small?: boolean;
}) {
  const fg = variant === 'primary' ? c.background : variant === 'danger' ? c.danger : variant === 'ghost' ? c.lime : c.text;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.button, small && s.buttonSmall, variant === 'secondary' && s.buttonSecondary, variant === 'ghost' && s.buttonGhost, variant === 'danger' && s.buttonDanger, disabled && { opacity: 0.4 }, pressed && { opacity: 0.75 }]}>
      {icon ? <Ionicons name={icon} size={small ? 16 : 19} color={fg} /> : null}
      <Text style={[s.buttonText, small && { fontSize: 14 }, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export const Card = ({ children, accent = false, style }: { children: React.ReactNode; accent?: boolean; style?: object }) =>
  <View style={[s.card, accent && s.cardAccent, style]}>{children}</View>;
export const H = ({ children }: { children: React.ReactNode }) => <Text accessibilityRole="header" style={s.heading}>{children}</Text>;
export const Eyebrow = ({ children }: { children: React.ReactNode }) => <Text style={s.eyebrow}>{children}</Text>;

export function Chip({ text, active, onPress, icon }: { text: string; active: boolean; onPress: () => void; icon?: IconName }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[s.chip, active && s.chipActive]}>
      {icon ? <Ionicons name={icon} size={15} color={active ? c.background : c.muted} /> : null}
      <Text style={[s.chipText, active && { color: c.background }]}>{text}</Text>
    </Pressable>
  );
}

/** Auswahlkarte mit Titel und Erklärung (Ziel, Level, Equipment). */
export function Option({ title, hint, active, onPress, icon, multi = false }: { title: string; hint?: string; active: boolean; onPress: () => void; icon?: IconName; multi?: boolean }) {
  return (
    <Pressable accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={{ checked: active }} onPress={onPress} style={[s.option, active && s.optionActive]}>
      {icon ? <View style={[s.optionIcon, active && { backgroundColor: c.lime }]}><Ionicons name={icon} size={18} color={active ? c.background : c.muted} /></View> : null}
      <View style={{ flex: 1 }}>
        <Text style={s.strong}>{title}</Text>
        {hint ? <Text style={s.small}>{hint}</Text> : null}
      </View>
      <Ionicons name={active ? (multi ? 'checkbox' : 'radio-button-on') : (multi ? 'square-outline' : 'radio-button-off')} size={22} color={active ? c.lime : c.faint} />
    </Pressable>
  );
}

export function Entrance({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(v, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [delay, v]);
  return <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>{children}</Animated.View>;
}

export function Bolt({ size = 200 }: { size?: number }) {
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [glow]);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size * 0.62, height: size * 0.62, borderRadius: size, backgroundColor: '#2C4A14', opacity: 0.55 }} />
      <Animated.Image source={bolt} resizeMode="contain" accessibilityLabel="AI FIT COACH Blitz"
        style={{ width: size, height: size, opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }), transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.04] }) }] }} />
    </View>
  );
}

export function Meter({ value, max = 100, color = c.lime, height = 8 }: { value: number; max?: number; color?: string; height?: number }) {
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(w, { toValue: pct, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(); }, [pct, w]);
  return (
    <View style={{ height, borderRadius: height, backgroundColor: c.surface3, overflow: 'hidden' }}>
      <Animated.View style={{ height, borderRadius: height, backgroundColor: color, width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
    </View>
  );
}

/** Kreisanzeige, progress 0–1. */
export function Ring({ size, stroke = 8, progress, color = c.lime, children }: { size: number; stroke?: number; progress: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.surface3} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${len} ${len}`} strokeDashoffset={len * (1 - p)} />
      </Svg>
      {children}
    </View>
  );
}

export function Sparkline({ values, width = 84, height = 30 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <View style={{ width, height }} />;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => `${3 + (i / (values.length - 1)) * (width - 6)},${height - 4 - ((v - min) / span) * (height - 8)}`);
  const [lx, ly] = pts[pts.length - 1].split(',').map(Number);
  return (
    <Svg width={width} height={height}>
      <Polyline points={pts.join(' ')} fill="none" stroke={c.lime} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={lx} cy={ly} r={3} fill={c.lime} />
    </Svg>
  );
}

export function Bars({ data, target }: { data: { label: string; count: number }[]; target?: number }) {
  const max = Math.max(1, target ?? 0, ...data.map((d) => d.count));
  return (
    <View style={s.bars}>
      {data.map((d, i) => (
        <View key={i} style={s.barCol}>
          <Text style={[s.tiny, { color: d.count ? c.text : c.faint }]}>{d.count || ''}</Text>
          <View style={{ width: 20, height: Math.max(5, (d.count / max) * 84), borderRadius: 6, backgroundColor: !d.count ? c.surface3 : target && d.count >= target ? c.lime : c.limeDeep }} />
          <Text style={s.tiny}>{d.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function Tile({ value, label, icon }: { value: string; label: string; icon?: IconName }) {
  return (
    <View style={s.tile}>
      {icon ? <Ionicons name={icon} size={18} color={c.lime} /> : null}
      <Text style={s.tileValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={s.small}>{label}</Text>
    </View>
  );
}

const parse = (text: string) => { const n = Number(text.replace(',', '.')); return Number.isFinite(n) ? n : null; };
export const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
/** Bewegtes Gewicht kurz: bis 999 kg in kg, darüber in Tonnen. */
export const fmtLoad = (kg: number) => (kg >= 1000 ? `${fmt(Math.round(kg / 100) / 10)} t` : `${Math.round(kg)} kg`);

/** Zahl mit Minus/Plus und direkter Eingabe. */
export function Stepper({ value, step, onChange, label, min = 0, max = 999 }: { value: number; step: number; onChange: (v: number) => void; label: string; min?: number; max?: number }) {
  const [text, setText] = useState<string | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v * 100) / 100));
  return (
    <View style={s.stepper}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} verringern`} hitSlop={6} onPress={() => onChange(clamp(value - step))} style={s.stepBtn}><Ionicons name="remove" size={18} color={c.text} /></Pressable>
      <TextInput accessibilityLabel={label} keyboardType="decimal-pad" selectTextOnFocus style={s.stepInput}
        value={text ?? fmt(value)} onChangeText={setText}
        onBlur={() => { const n = text === null ? null : parse(text); if (n !== null) onChange(clamp(n)); setText(null); }} />
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} erhöhen`} hitSlop={6} onPress={() => onChange(clamp(value + step))} style={s.stepBtn}><Ionicons name="add" size={18} color={c.text} /></Pressable>
    </View>
  );
}

export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable accessibilityLabel="Schließen" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.rowBetween}>
            <Text style={[s.heading, { flex: 1 }]}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Schließen" hitSlop={10} onPress={onClose}><Ionicons name="close" size={26} color={c.muted} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type Ask = { title: string; text?: string; yes: string; no?: string; danger?: boolean };
const ConfirmContext = createContext<(ask: Ask) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

/** Eigener Bestätigungsdialog: funktioniert auf iOS, Android und im Web gleich. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirm = useCallback((a: Ask) => new Promise<boolean>((resolve) => { resolver.current = resolve; setAsk(a); }), []);
  const close = (ok: boolean) => { resolver.current?.(ok); resolver.current = null; setAsk(null); };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal visible={!!ask} transparent animationType="fade" onRequestClose={() => close(false)}>
        <View style={[s.backdrop, { justifyContent: 'center', padding: spacing.lg }]}>
          <View style={s.dialog}>
            <Text style={s.heading}>{ask?.title}</Text>
            {ask?.text ? <Text style={s.muted}>{ask.text}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
              <View style={{ flex: 1 }}><Button variant="secondary" title={ask?.no ?? 'Abbrechen'} onPress={() => close(false)} /></View>
              <View style={{ flex: 1 }}><Button variant={ask?.danger ? 'danger' : 'primary'} title={ask?.yes ?? 'OK'} onPress={() => close(true)} /></View>
            </View>
          </View>
        </View>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const s = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: 40, gap: 16 },
  brand: { color: c.lime, fontSize: 13, fontWeight: '900', letterSpacing: 2.4 },
  hero: { color: c.text, fontSize: 30, fontWeight: '800', lineHeight: 36 },
  heading: { color: c.text, fontSize: 19, fontWeight: '800' },
  strong: { color: c.text, fontSize: 16, fontWeight: '700' },
  text: { color: c.text, fontSize: 15, lineHeight: 22 },
  muted: { color: c.muted, fontSize: 14, lineHeight: 21 },
  small: { color: c.muted, fontSize: 12.5, lineHeight: 18 },
  tiny: { color: c.muted, fontSize: 10.5 },
  eyebrow: { color: c.lime, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
  card: { backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.lg, padding: 18, gap: 10 },
  cardAccent: { borderColor: c.limeLine, backgroundColor: '#141C10' },
  button: { backgroundColor: c.lime, paddingVertical: 15, paddingHorizontal: 18, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, minHeight: 52 },
  buttonSmall: { paddingVertical: 9, paddingHorizontal: 14, minHeight: 40, borderRadius: 12 },
  buttonSecondary: { backgroundColor: c.surface2, borderColor: c.border, borderWidth: 1 },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonDanger: { backgroundColor: 'rgba(255,126,126,0.1)', borderColor: 'rgba(255,126,126,0.4)', borderWidth: 1 },
  buttonText: { fontSize: 16, fontWeight: '800' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 24, minHeight: 44 },
  chipActive: { backgroundColor: c.lime, borderColor: c.lime },
  chipText: { color: c.text, fontWeight: '600', fontSize: 14 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, borderRadius: radius.md, padding: 14, minHeight: 60 },
  optionActive: { borderColor: c.lime, backgroundColor: '#141C10' },
  optionIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
  input: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: 16, color: c.text, fontSize: 16 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 124 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  tile: { flex: 1, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.md, padding: 14, gap: 3, minWidth: 96 },
  tileValue: { color: c.text, fontSize: 21, fontWeight: '900', fontVariant: ['tabular-nums'] },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface2, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  stepBtn: { width: 34, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepInput: { width: 46, height: 44, color: c.text, fontSize: 16, fontWeight: '800', textAlign: 'center', padding: 0, fontVariant: ['tabular-nums'] },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.66)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '86%', backgroundColor: c.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: c.border, padding: spacing.lg, gap: 14 },
  dialog: { width: '100%', maxWidth: 420, backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.lg, gap: 10 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: c.limeSoft },
  badgeText: { color: c.lime, fontSize: 11.5, fontWeight: '800' },
  divider: { height: 1, backgroundColor: c.border },
});
