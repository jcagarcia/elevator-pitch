import type { SimEvent } from '../sim/types';

export type RuleFiredEvent = Extract<SimEvent, { type: 'rule-fired' }>;

/** How long the rule panel's fired highlight stays lit after a decision —
 *  matches the design handoff's "single pulse per firing, not a repeating
 *  animation" (~0.6s), measured in sim ticks rather than wall-clock so it
 *  works the same regardless of anything else about how the tick arrived. */
export const RULE_FIRED_PULSE_TICKS = Math.round(0.6 * 20);

/** The rule whose firing should currently be pulsing the rule panel at
 *  `tick`, given one car's rule-fired events in chronological order — the
 *  most recent decision at or before `tick`, but only while still inside
 *  its pulse window; null once the window has elapsed (or nothing has
 *  fired yet, or the last decision fell through to the policy's default).
 *  Unlike a persistent "currently active" indicator, this naturally turns
 *  itself off. */
export function ruleFiredPulseAt(
  carEvents: readonly RuleFiredEvent[] | undefined,
  tick: number,
  windowTicks: number = RULE_FIRED_PULSE_TICKS,
): string | null {
  if (!carEvents) return null;
  let lastEvent: RuleFiredEvent | null = null;
  for (const event of carEvents) {
    if (event.tick > tick) break;
    lastEvent = event;
  }
  if (!lastEvent || lastEvent.ruleId === null) return null;
  return tick - lastEvent.tick < windowTicks ? lastEvent.ruleId : null;
}
