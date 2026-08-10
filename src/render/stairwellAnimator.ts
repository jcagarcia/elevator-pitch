import type { SimEvent } from '../sim/types';
import type { StairwellWalker } from './canvas';

/** How long a "walking to the stairs" dot takes to reach the ground floor.
 *  Purely cosmetic timing — deliberately wall-clock-driven (real
 *  milliseconds, via performance.now()), unlike everything in sim/, since
 *  this never influences the simulation and only exists to be looked at. */
const WALK_DURATION_MS = 1800;

interface ActiveWalker {
  originFloor: number;
  startedAt: number;
}

/**
 * Turns 'gave-up' events into a short-lived list of stairwell walkers for
 * drawLiveState to render. Framework-free and driven by an explicit `now`
 * parameter (rather than reading performance.now() internally) so it's
 * trivial to test without faking global time.
 */
export class StairwellAnimator {
  private walkers: ActiveWalker[] = [];

  addFromEvents(events: readonly SimEvent[], now: number): void {
    for (const event of events) {
      if (event.type === 'gave-up') {
        this.walkers.push({ originFloor: event.floor, startedAt: now });
      }
    }
  }

  getActiveWalkers(now: number): StairwellWalker[] {
    this.walkers = this.walkers.filter((w) => now - w.startedAt < WALK_DURATION_MS);
    return this.walkers.map((w) => ({
      originFloor: w.originFloor,
      progress: Math.min(1, (now - w.startedAt) / WALK_DURATION_MS),
    }));
  }

  reset(): void {
    this.walkers = [];
  }
}
