import React, { useEffect, useState } from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import type { Exercise } from '../engine/types';
import { colors as c } from '../theme';
import { ANIMS, ANIM_OF, Pose, Pt, Scene } from './poses';

const BODY = '#C5CEC8';
const BACK = '#4A544E';
const GEAR = '#7C8781';
const LEGS = ['Quadrizeps', 'Beinbeuger', 'Gesäß', 'Waden'];
const ARMS = ['Bizeps', 'Trizeps', 'Schultern'];
const TORSO = ['Brust', 'Rücken', 'Rumpf'];

const mix = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const mixOpt = (a: Pt | undefined, b: Pt | undefined, t: number) => (a && b ? mix(a, b, t) : a ?? b);
const blend = (a: Pose, b: Pose, t: number): Pose => ({
  sh: mix(a.sh, b.sh, t), el: mix(a.el, b.el, t), ha: mix(a.ha, b.ha, t), hip: mix(a.hip, b.hip, t), kn: mix(a.kn, b.kn, t), ft: mix(a.ft, b.ft, t),
  el2: mixOpt(a.el2, b.el2, t), ha2: mixOpt(a.ha2, b.ha2, t), kn2: mixOpt(a.kn2, b.kn2, t), ft2: mixOpt(a.ft2, b.ft2, t),
});
const mirror = (pt: Pt): Pt => [100 - pt[0], pt[1]];

const OUT = '#0B0D0C';

/** Muskel-Segment: läuft von Breite wa über einen Bauch (wm) zu wb aus, mit runden Gelenken. */
function Limb({ a, b, color, wa, wm, wb, at = 0.4 }: { a: Pt; b: Pt; color: string; wa: number; wm: number; wb: number; at?: number }) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const m: Pt = [a[0] + dx * at, a[1] + dy * at];
  const pt = (o: Pt, w: number, sign: number) => `${(o[0] + nx * (w / 2) * sign).toFixed(2)},${(o[1] + ny * (w / 2) * sign).toFixed(2)}`;
  const d = `M${pt(a, wa, 1)} Q${pt(m, wm * 1.25, 1)} ${pt(b, wb, 1)} L${pt(b, wb, -1)} Q${pt(m, wm * 1.25, -1)} ${pt(a, wa, -1)} Z`;
  return <>
    <Path d={d} fill={color} stroke={OUT} strokeWidth={0.7} strokeLinejoin="round" />
    <Circle cx={a[0]} cy={a[1]} r={wa / 2} fill={color} />
    <Circle cx={b[0]} cy={b[1]} r={wb / 2} fill={color} />
  </>;
}

const Arm = ({ sh, el, ha, color }: { sh: Pt; el: Pt; ha: Pt; color: string }) => <>
  <Limb a={el} b={ha} color={color} wa={6.6} wm={7.6} wb={4} at={0.3} />
  <Limb a={sh} b={el} color={color} wa={8.4} wm={10.6} wb={6.4} at={0.45} />
  <Circle cx={sh[0]} cy={sh[1]} r={5.3} fill={color} stroke={OUT} strokeWidth={0.7} />
  <Circle cx={ha[0]} cy={ha[1]} r={2.3} fill={color} />
</>;

const Leg = ({ hip, kn, ft, color }: { hip: Pt; kn: Pt; ft: Pt; color: string }) => <>
  <Limb a={kn} b={ft} color={color} wa={7.4} wm={9.6} wb={4.2} at={0.3} />
  <Limb a={hip} b={kn} color={color} wa={12.5} wm={14} wb={7.6} at={0.38} />
  <Circle cx={ft[0]} cy={ft[1]} r={2.7} fill={color} />
</>;

function SceneProps({ scene }: { scene?: Scene }) {
  if (scene === 'bench') return <><Rect x={18} y={67} width={44} height={4} rx={2} fill={GEAR} /><Rect x={24} y={71} width={3} height={19} fill={GEAR} /><Rect x={53} y={71} width={3} height={19} fill={GEAR} /></>;
  if (scene === 'table') return <><Rect x={56} y={60} width={30} height={3.5} rx={1.5} fill={GEAR} /><Rect x={78} y={63} width={3} height={27} fill={GEAR} /></>;
  if (scene === 'box') return <Rect x={52} y={77} width={24} height={13} rx={2} fill={GEAR} />;
  if (scene === 'chair') return <><Rect x={30} y={65} width={30} height={4} rx={2} fill={GEAR} /><Rect x={32} y={69} width={3} height={21} fill={GEAR} /><Rect x={55} y={69} width={3} height={21} fill={GEAR} /></>;
  if (scene === 'seat') return <Rect x={34} y={80} width={32} height={4} rx={2} fill={GEAR} />;
  if (scene === 'wall') return <Rect x={24} y={8} width={4} height={82} fill={GEAR} />;
  if (scene === 'bar') return <Rect x={22} y={6} width={56} height={3} rx={1.5} fill={GEAR} />;
  if (scene === 'lowbar') return <><Rect x={20} y={32} width={24} height={3} rx={1.5} fill={GEAR} /><Rect x={21} y={35} width={2.5} height={55} fill={GEAR} /></>;
  if (scene === 'bars') return <><Rect x={40} y={50} width={20} height={3} rx={1.5} fill={GEAR} /><Rect x={48.5} y={53} width={3} height={37} fill={GEAR} /></>;
  return null;
}

/** Gewicht an der Hand: Kurzhantel, Hantelscheibe (Langhantel von der Seite) oder Kettlebell. */
function Weight({ at, kind }: { at: Pt; kind: 'db' | 'bb' | 'kb' }) {
  if (kind === 'bb') return <Circle cx={at[0]} cy={at[1]} r={6.5} fill="none" stroke={c.lime} strokeWidth={2.2} />;
  if (kind === 'kb') return <Circle cx={at[0]} cy={at[1] + 4} r={4.5} fill={c.lime} />;
  return <Rect x={at[0] - 4.5} y={at[1] - 2.2} width={9} height={4.4} rx={2.2} fill={c.lime} />;
}

export function Figure({ ex, size = 160, animate = true, phase = 1 }: { ex: Exercise; size?: number; animate?: boolean; /** Standbild: 0 = Start, 1 = Ende. */ phase?: number }) {
  const anim = ANIMS[ANIM_OF[ex.id] ?? 'squat'];
  const [t, setT] = useState(phase);
  useEffect(() => {
    if (!animate) { setT(phase); return; }
    const started = Date.now();
    // Ruhig hin und zurück, mit kurzem Halt an beiden Enden.
    const id = setInterval(() => {
      const x = ((Date.now() - started) % 2600) / 2600;
      const tri = x < 0.5 ? x * 2 : 2 - x * 2;
      const held = Math.max(0, Math.min(1, (tri - 0.12) / 0.76));
      setT(held * held * (3 - 2 * held));
    }, 40);
    return () => clearInterval(id);
  }, [animate, phase, ex.id]);

  const pose = blend(anim.a, anim.b, t);
  const legs = ex.primary.some((m) => LEGS.includes(m)) ? c.lime : BODY;
  const arms = ex.primary.some((m) => ARMS.includes(m)) ? c.lime : BODY;
  const torso = ex.primary.some((m) => TORSO.includes(m)) ? c.lime : BODY;
  const weight = ex.needs.includes('barbell') ? 'bb' : ex.needs.includes('dumbbells') ? 'db' : ex.needs.includes('kettlebell') ? 'kb' : null;
  const cable = anim.scene === 'cable_high' ? ([70, 4] as Pt) : anim.scene === 'cable_mid' ? ([94, pose.ha[1]] as Pt) : null;

  let body: React.ReactNode;
  if (anim.front) {
    const L = { sh: mirror(pose.sh), el: mirror(pose.el), ha: mirror(pose.ha), hip: mirror(pose.hip), kn: mirror(pose.kn), ft: mirror(pose.ft) };
    const sy = pose.sh[1];
    const hy = pose.hip[1];
    const sw = pose.sh[0] - 50 + 1.5;
    // V-Form: breite Schultern, schmale Taille, Becken wieder etwas breiter.
    const torsoPath = `M${50 - sw},${sy - 3} L${50 + sw},${sy - 3} Q${50 + sw + 1},${sy + 8} ${50 + 6.5},${hy - 7} L${50 + 8},${hy + 3} L${50 - 8},${hy + 3} L${50 - 6.5},${hy - 7} Q${50 - sw - 1},${sy + 8} ${50 - sw},${sy - 3} Z`;
    body = <>
      {weight === 'bb' || anim === ANIMS.pulldown ? <Line x1={L.ha[0] - 8} y1={L.ha[1]} x2={pose.ha[0] + 8} y2={pose.ha[1]} stroke={weight === 'bb' ? c.lime : GEAR} strokeWidth={2.4} strokeLinecap="round" /> : null}
      <Leg hip={pose.hip} kn={pose.kn} ft={pose.ft} color={legs} /><Leg hip={L.hip} kn={L.kn} ft={L.ft} color={legs} />
      <Path d={`M44,${sy - 3} L50,${sy - 9} L56,${sy - 3} Z`} fill={torso} />
      <Path d={torsoPath} fill={torso} stroke={OUT} strokeWidth={0.7} strokeLinejoin="round" />
      <Path d={`M${50 - sw + 1},${sy + 5} Q${50 - sw / 2},${sy + 9} 50,${sy + 5.5} Q${50 + sw / 2},${sy + 9} ${50 + sw - 1},${sy + 5}`} fill="none" stroke={OUT} strokeWidth={0.8} />
      <Line x1={50} y1={sy - 1} x2={50} y2={hy - 2} stroke={OUT} strokeWidth={0.7} />
      {[0.42, 0.6, 0.78].map((f) => <Line key={f} x1={45.5} y1={sy + (hy - sy) * f} x2={54.5} y2={sy + (hy - sy) * f} stroke={OUT} strokeWidth={0.6} />)}
      <Rect x={47.5} y={sy - 9} width={5} height={6} rx={2} fill={BODY} />
      <Circle cx={50} cy={sy - 12} r={5.8} fill={BODY} />
      <Arm sh={pose.sh} el={pose.el} ha={pose.ha} color={arms} /><Arm sh={L.sh} el={L.el} ha={L.ha} color={arms} />
      {weight && weight !== 'bb' ? <><Weight at={pose.ha} kind={weight} /><Weight at={L.ha} kind={weight} /></> : null}
    </>;
  } else {
    const dx = pose.sh[0] - pose.hip[0];
    const dy = pose.sh[1] - pose.hip[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const neck: Pt = [pose.sh[0] + ux * 4, pose.sh[1] + uy * 4];
    const head: Pt = [pose.sh[0] + ux * 11.5, pose.sh[1] + uy * 11.5];
    body = <>
      {pose.kn2 && pose.ft2 ? <Leg hip={pose.hip} kn={pose.kn2} ft={pose.ft2} color={BACK} /> : null}
      {pose.el2 && pose.ha2 ? <Arm sh={pose.sh} el={pose.el2} ha={pose.ha2} color={BACK} /> : null}
      {cable ? <Line x1={pose.ha[0]} y1={pose.ha[1]} x2={cable[0]} y2={cable[1]} stroke={GEAR} strokeWidth={1.4} /> : null}
      <Leg hip={pose.hip} kn={pose.kn} ft={pose.ft} color={legs} />
      <Circle cx={pose.hip[0]} cy={pose.hip[1]} r={7.2} fill={legs} stroke={OUT} strokeWidth={0.7} />
      <Limb a={pose.sh} b={pose.hip} color={torso} wa={16.5} wm={18} wb={11} at={0.28} />
      <Limb a={pose.sh} b={neck} color={BODY} wa={6.5} wm={6} wb={5} />
      <Circle cx={head[0]} cy={head[1]} r={5.8} fill={BODY} />
      <Arm sh={pose.sh} el={pose.el} ha={pose.ha} color={arms} />
      {weight ? <Weight at={anim.barOnBack ? [pose.sh[0] - 3, pose.sh[1] - 1] : pose.ha} kind={anim.barOnBack ? 'bb' : weight} /> : null}
    </>;
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel={`Bewegungsbild: ${ex.name}`}>
      <Line x1={6} y1={93.5} x2={94} y2={93.5} stroke={c.border} strokeWidth={1.5} strokeLinecap="round" />
      <SceneProps scene={anim.scene} />
      {body}
    </Svg>
  );
}
