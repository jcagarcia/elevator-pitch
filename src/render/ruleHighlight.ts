import type { CarId, SimEvent } from '../sim/types';

type RuleFiredEvent = Extract<SimEvent, { type: 'rule-fired' }>;

/** Groups rule-fired events by car, preserving chronological order (the
 *  event log is already emitted in tick order), so the active rule at any
 *  tick can be found with a simple forward scan per car. */
export function groupRuleFiredByCar(events: readonly SimEvent[]): Map<CarId, RuleFiredEvent[]> {
  const byCar = new Map<CarId, RuleFiredEvent[]>();
  for (const event of events) {
    if (event.type !== 'rule-fired') continue;
    const list = byCar.get(event.carId);
    if (list) list.push(event);
    else byCar.set(event.carId, [event]);
  }
  return byCar;
}

/** How long the rule panel's fired highlight stays lit after a decision —
 *  matches the design handoff's "single pulse per firing, not a repeating
 *  animation" (~0.6s), measured in sim ticks rather than wall-clock so it
 *  works identically whether driven live or by scrubbing a finished
 *  result. */
export const RULE_FIRED_PULSE_TICKS = Math.round(0.6 * 20);

/** The rule whose firing should currently be pulsing the rule panel at
 *  `tick` — the most recent rule-fired decision at or before it, but only
 *  while still inside its pulse window; null once the window has elapsed
 *  (or nothing has fired yet, or the last decision fell through to the
 *  policy's default). Unlike a persistent "currently active" indicator,
 *  this naturally turns itself off. */
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
