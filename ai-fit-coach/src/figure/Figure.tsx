import React, { useEffect, useState } from 'react';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
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

function Bone({ a, b, color, w = 6 }: { a: Pt; b: Pt; color: string; w?: number }) {
  return <Line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={w} strokeLinecap="round" />;
}

function SceneProps({ scene }: { scene?: Scene }) {
  if (scene === 'bench') return <><Rect x={18} y={67} width={44} height={4} rx={2} fill={GEAR} /><Rect x={24} y={71} width={3} height={19} fill={GEAR} /><Rect x={53} y={71} width={3} height={19} fill={GEAR} /></>;
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
    body = <>
      {weight === 'bb' || anim === ANIMS.pulldown ? <Line x1={L.ha[0] - 8} y1={L.ha[1]} x2={pose.ha[0] + 8} y2={pose.ha[1]} stroke={weight === 'bb' ? c.lime : GEAR} strokeWidth={2.4} strokeLinecap="round" /> : null}
      <Bone a={pose.hip} b={pose.kn} color={legs} /><Bone a={pose.kn} b={pose.ft} color={legs} />
      <Bone a={L.hip} b={L.kn} color={legs} /><Bone a={L.kn} b={L.ft} color={legs} />
      <Bone a={pose.sh} b={pose.hip} color={torso} w={7} /><Bone a={L.sh} b={L.hip} color={torso} w={7} />
      <Bone a={L.sh} b={pose.sh} color={torso} w={7} /><Bone a={L.hip} b={pose.hip} color={torso} w={7} />
      <Bone a={[50, pose.sh[1] + 2]} b={[50, pose.hip[1] - 2]} color={torso} w={9} />
      <Bone a={pose.sh} b={pose.el} color={arms} /><Bone a={pose.el} b={pose.ha} color={arms} />
      <Bone a={L.sh} b={L.el} color={arms} /><Bone a={L.el} b={L.ha} color={arms} />
      <Circle cx={50} cy={pose.sh[1] - 10} r={6.5} fill={BODY} />
      {weight && weight !== 'bb' ? <><Weight at={pose.ha} kind={weight} /><Weight at={L.ha} kind={weight} /></> : null}
    </>;
  } else {
    const dx = pose.sh[0] - pose.hip[0];
    const dy = pose.sh[1] - pose.hip[1];
    const len = Math.hypot(dx, dy) || 1;
    const head: Pt = [pose.sh[0] + (dx / len) * 10.5, pose.sh[1] + (dy / len) * 10.5];
    body = <>
      {pose.kn2 && pose.ft2 ? <><Bone a={pose.hip} b={pose.kn2} color={BACK} /><Bone a={pose.kn2} b={pose.ft2} color={BACK} /></> : null}
      {pose.el2 && pose.ha2 ? <><Bone a={pose.sh} b={pose.el2} color={BACK} /><Bone a={pose.el2} b={pose.ha2} color={BACK} /></> : null}
      {cable ? <Line x1={pose.ha[0]} y1={pose.ha[1]} x2={cable[0]} y2={cable[1]} stroke={GEAR} strokeWidth={1.4} /> : null}
      <Bone a={pose.hip} b={pose.kn} color={legs} /><Bone a={pose.kn} b={pose.ft} color={legs} />
      <Bone a={pose.sh} b={pose.hip} color={torso} w={8} />
      <Circle cx={head[0]} cy={head[1]} r={6.5} fill={BODY} />
      <Bone a={pose.sh} b={pose.el} color={arms} /><Bone a={pose.el} b={pose.ha} color={arms} />
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
