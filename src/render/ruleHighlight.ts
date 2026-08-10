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

/** The rule governing a car's current target at `tick` — the most recent
 *  rule-fired decision at or before it, or null if none has fired yet (or
 *  the last decision fell through to the policy's default). */
export function activeRuleIdAt(carEvents: readonly RuleFiredEvent[] | undefined, tick: number): string | null {
  if (!carEvents) return null;
  let result: string | null = null;
  for (const event of carEvents) {
    if (event.tick > tick) break;
    result = event.ruleId;
  }
  return result;
}
