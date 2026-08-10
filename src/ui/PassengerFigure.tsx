import { useEffect, useRef, useState } from 'react';

/**
 * The signature element (design handoff: "Elevator frustration gauge"). A
 * two-shape passenger figure (circle head + rounded-rect torso + tick-mark
 * foot) whose posture is the primary frustration encoding — lean angle,
 * foot-tap tempo, pacing drift, and a "squash" breathing wobble, all
 * continuous with `progress`. A mounted dial (needle angle + a crosshatch
 * texture that ramps in with frustration) is the colorblind-safe second
 * encoding: angle and texture density carry the signal independent of the
 * dial's hue, which shifts along the same ramp for sighted users.
 *
 * Ported directly from the design bundle's PassengerFigure.dc.html — the
 * KF keyframe table and interpolation are copied verbatim; only the
 * rendering target (React inline styles instead of the design tool's
 * templated style objects) changed.
 */

interface Keyframe {
  readonly lean: number;
  readonly tapAmp: number;
  readonly tapPeriod: number;
  readonly paceAmp: number;
  readonly needle: number;
  readonly redline: number;
  readonly hue: number;
  readonly sat: number;
  readonly light: number;
  readonly squash: number;
}

/** One entry per stage: CALM, ANNOYED, ANGRY, FURIOUS, GAVE UP. `progress`
 *  interpolates continuously between adjacent entries. */
const KEYFRAMES: readonly Keyframe[] = [
  { lean: 0, tapAmp: 0, tapPeriod: 3.2, paceAmp: 0, needle: -68, redline: 0, hue: 42, sat: 80, light: 62, squash: 0 },
  { lean: 3, tapAmp: 3, tapPeriod: 1.7, paceAmp: 3, needle: -28, redline: 0.12, hue: 36, sat: 85, light: 57, squash: 0.03 },
  { lean: 6, tapAmp: 6, tapPeriod: 0.95, paceAmp: 8, needle: 14, redline: 0.4, hue: 26, sat: 88, light: 52, squash: 0.06 },
  { lean: 10, tapAmp: 10, tapPeriod: 0.42, paceAmp: 15, needle: 55, redline: 0.72, hue: 15, sat: 90, light: 50, squash: 0.1 },
  { lean: -9, tapAmp: 0, tapPeriod: 0, paceAmp: 0, needle: 86, redline: 1, hue: 5, sat: 78, light: 42, squash: 0 },
];

const INK = '#1c1712';
const EXIT_TRANSITION = 'transform 850ms cubic-bezier(.34,1.56,.64,1), opacity 950ms ease-in 250ms';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface PassengerFigureProps {
  /** 0 (calm) through 4 (gave up), continuous — see frustrationToProgress
   *  for how a passenger's raw frustration number maps onto this scale. */
  progress: number;
  /** True once the passenger has actually left — plays the give-up exit
   *  transform/fade instead of holding the gave-up pose. */
  exiting?: boolean;
  /** Only the worst-off waiting passenger on a floor gets a dial (design
   *  handoff: avoids clutter). Onboard/small-scale figures pass false. */
  showGauge?: boolean;
  scale?: number;
}

export function PassengerFigure({ progress, exiting = false, showGauge = true, scale = 1 }: PassengerFigureProps): JSX.Element {
  const [clock, setClock] = useState(0);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotionRef.current) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      setClock((c) => c + dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const p = Math.min(4, Math.max(0, progress));
  const i0 = Math.min(3, Math.floor(p));
  const i1 = Math.min(4, i0 + 1);
  const f = p - i0;
  const a = KEYFRAMES[i0]!;
  const b = KEYFRAMES[i1]!;

  const lean = lerp(a.lean, b.lean, f);
  const tapAmp = lerp(a.tapAmp, b.tapAmp, f);
  const tapPeriod = lerp(a.tapPeriod, b.tapPeriod, f) || 1;
  const paceAmp = lerp(a.paceAmp, b.paceAmp, f);
  const needle = lerp(a.needle, b.needle, f);
  const redline = lerp(a.redline, b.redline, f);
  const hue = lerp(a.hue, b.hue, f);
  const sat = lerp(a.sat, b.sat, f);
  const light = lerp(a.light, b.light, f);
  const squashAmt = lerp(a.squash, b.squash, f);

  // The reduced-motion path keeps the interpolated pose (the actual
  // signal) but cuts the continuous oscillation — see the design
  // handoff's prefers-reduced-motion section.
  const clock_ = reducedMotionRef.current ? 0 : clock;
  const tap = tapAmp > 0 ? Math.sin((clock_ / tapPeriod) * Math.PI * 2) * tapAmp : 0;
  const pace = paceAmp > 0 ? Math.sin((clock_ / (tapPeriod * 2.1)) * Math.PI * 2) * paceAmp * 0.4 : 0;
  const squash = squashAmt > 0 ? 1 + Math.sin((clock_ / tapPeriod) * Math.PI * 2) * squashAmt : 1;
  const bodyColor = `hsl(${hue} ${sat}% ${light}%)`;
  const dialSize = 28 * scale;
  const outline = Math.max(2, 3 * scale);
  const exitTransition = reducedMotionRef.current ? 'opacity 400ms ease-in' : EXIT_TRANSITION;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 * scale, position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20 * scale }}>
        <div
          style={{
            width: 12 * scale,
            height: 12 * scale,
            borderRadius: '50%',
            background: bodyColor,
            border: `${outline}px solid ${INK}`,
            margin: '0 auto -3px',
            position: 'relative',
            zIndex: 2,
            transform: `translateX(${exiting ? 74 * scale : pace}px) rotate(${lean * 0.6 + (exiting ? -18 : 0)}deg)`,
            opacity: exiting ? 0 : 1,
            transition: exiting ? exitTransition : 'none',
          }}
        />
        <div
          style={{
            width: 18 * scale,
            height: 24 * scale,
            borderRadius: 10 * scale,
            background: bodyColor,
            border: `${outline}px solid ${INK}`,
            transform: `translate(${exiting ? 74 * scale : pace}px, ${exiting ? -6 * scale : 0}px) rotate(${lean + (exiting ? -18 : 0)}deg) scaleY(${squash}) scaleX(${2 - squash})`,
            transformOrigin: 'bottom center',
            position: 'relative',
            zIndex: 1,
            opacity: exiting ? 0 : 1,
            transition: exiting ? exitTransition : 'none',
          }}
        />
        <div
          style={{
            width: 20 * scale,
            height: 5 * scale,
            borderRadius: '50%',
            background: 'rgba(28,23,18,0.28)',
            margin: '2px auto 0',
            transform: `scaleX(${1 - squashAmt * 2})`,
            opacity: exiting ? 0 : 1,
            transition: exiting ? 'opacity 500ms ease-in' : 'none',
          }}
        />
        <div
          style={{
            width: 6 * scale,
            height: 3 * scale,
            background: INK,
            borderRadius: 2,
            margin: '2px auto 0',
            transform: `rotate(${tap}deg)`,
            transformOrigin: 'top center',
            opacity: exiting ? 0 : 1,
            transition: exiting ? 'opacity 400ms ease-in' : 'none',
          }}
        />
      </div>
      {showGauge && (
        <div
          style={{
            width: dialSize,
            height: dialSize,
            borderRadius: '50%',
            background: bodyColor,
            position: 'relative',
            overflow: 'hidden',
            flexShrink: 0,
            border: `${outline + 1}px solid ${INK}`,
            boxShadow: `3px 4px 0 ${INK}`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              width: '55%',
              height: '100%',
              backgroundImage: 'repeating-linear-gradient(45deg, rgba(20,16,12,0.9) 0 2px, transparent 2px 6px)',
              opacity: redline,
              mixBlendMode: 'multiply',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '50%',
              bottom: '50%',
              width: Math.max(2, 2.2 * scale),
              height: dialSize * 0.4,
              background: INK,
              borderRadius: 2,
              transformOrigin: 'bottom center',
              transform: `translateX(-50%) rotate(${needle}deg)`,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 5 * scale,
              height: 5 * scale,
              background: INK,
              borderRadius: '50%',
              transform: 'translate(-50%,-50%)',
            }}
          />
        </div>
      )}
    </div>
  );
}
