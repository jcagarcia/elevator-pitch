import type { SimResult } from '../sim/simulate';

export interface WorstMoment {
  readonly tick: number;
  readonly floor: number;
  readonly description: string;
  /** Ranking weight only — never shown to the player. */
  readonly severity: number;
}

const SEVERITY = {
  gaveUp: 200,
  passedByVip: 140,
  passedBy: 80,
  doorsReopened: 10,
};

/**
 * Turns the discrete event log into the "why you lost points" list the
 * end-of-shift report shows — the brief's "Floor 7, 0:48 — car passed a
 * waiting passenger with 4 free spaces" example. Ranked by severity, not
 * chronology, so the worst decisions surface first; ties break by earliest.
 */
export function computeWorstMoments(result: SimResult, maxCount = 12): WorstMoment[] {
  const moments: WorstMoment[] = [];

  for (const event of result.events) {
    if (event.type === 'gave-up') {
      moments.push({
        tick: event.tick,
        floor: event.floor,
        description: `A passenger gave up waiting at floor ${event.floor} and took the stairs.`,
        severity: SEVERITY.gaveUp,
      });
      continue;
    }

    if (event.type === 'passed-by') {
      const passenger = result.passengers[event.passengerId];
      const isVip = passenger?.traits.includes('vip') ?? false;
      moments.push({
        tick: event.tick,
        floor: event.floor,
        description: isVip
          ? `Car passed a waiting VIP at floor ${event.floor} with room to spare.`
          : `Car passed a waiting passenger at floor ${event.floor} with room to spare.`,
        severity: isVip ? SEVERITY.passedByVip : SEVERITY.passedBy,
      });
      continue;
    }

    if (event.type === 'doors-reopened') {
      moments.push({
        tick: event.tick,
        floor: event.floor,
        description: `Doors reopened at floor ${event.floor} after already starting to close.`,
        severity: SEVERITY.doorsReopened,
      });
    }
  }

  moments.sort((a, b) => b.severity - a.severity || a.tick - b.tick);
  return moments.slice(0, maxCount);
}
