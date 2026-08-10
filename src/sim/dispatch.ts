import type { Car, SimState } from './types';

export interface DispatchDecision {
  targetFloor: number | null;
  /** Which rule fired to produce this decision, for the live rule highlight
   *  and the report. Null means "no rule matched, fell back to default." */
  ruleId: string | null;
}

/** The seam between the sim loop and whatever is choosing targets for each
 *  car. Phase 1 ships one hardcoded strategy (naive FCFS) so the sim loop
 *  can be proven end to end; Phase 3 adds the rule-based policy engine
 *  behind the same interface, plus two optional hooks so policy parameters
 *  (capacity reserve, minimum door dwell) can influence boarding/dwell
 *  behavior that lives in simulate.ts without simulate.ts knowing anything
 *  about policies. */
export interface DispatchStrategy {
  readonly name: string;
  decideNextTarget(car: Car, state: SimState): DispatchDecision;
  /** How many passengers this car will actually board before "full",
   *  which may be less than its physical capacity. Defaults to
   *  car.capacity when omitted. */
  effectiveCapacity?(car: Car): number;
  /** Floor under which the base door dwell (config.ts) is never allowed to
   *  drop. Only ever raises the minimum; omit to use the base value as-is. */
  minDoorDwellTicks?(): number;
}

/**
 * Naive first-come-first-served: a car finishes delivering whoever it's
 * currently carrying (oldest boarder first) before it will consider anyone
 * else, and when empty it goes straight to whichever waiting passenger
 * called first — regardless of distance, direction, or who else it passes
 * on the way. This is deliberately terrible: it's the baseline every real
 * policy should beat.
 */
export const naiveFcfsDispatch: DispatchStrategy = {
  name: 'naive-fcfs',

  decideNextTarget(car: Car, state: SimState): DispatchDecision {
    const firstAboardId = car.passengers[0];
    if (firstAboardId !== undefined) {
      const passenger = state.passengers.find((p) => p.id === firstAboardId);
      if (passenger) {
        return { targetFloor: passenger.destFloor, ruleId: 'serve-current-passenger' };
      }
    }

    let oldestWaiting: SimState['passengers'][number] | null = null;
    for (const passenger of state.passengers) {
      if (passenger.state !== 'waiting') continue;
      if (oldestWaiting === null || passenger.spawnTick < oldestWaiting.spawnTick) {
        oldestWaiting = passenger;
      }
    }
    if (oldestWaiting) {
      return { targetFloor: oldestWaiting.originFloor, ruleId: 'go-to-oldest-call' };
    }

    return { targetFloor: null, ruleId: null };
  },
};
