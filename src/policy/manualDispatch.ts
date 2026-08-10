import type { DispatchDecision, DispatchStrategy } from '../sim/dispatch';
import type { Car, CarId } from '../sim/types';

/**
 * Manual mode: the player is the dispatcher. decideNextTarget is only ever
 * consulted once a car is idle with no target (see simulate.ts's
 * stepCarMovementAndDoors), so this just hands back whatever floor was
 * last clicked for that car and forgets it — a one-shot command, same as a
 * real elevator that commits to a destination once moving rather than
 * accepting a mid-trip redirect. No rules are evaluated at all while this
 * strategy is active; that's the whole point of the mode.
 */
export function createManualDispatch(consumeTargetFloor: (carId: CarId) => number | null): DispatchStrategy {
  return {
    name: 'manual',

    decideNextTarget(car: Car): DispatchDecision {
      return { targetFloor: consumeTargetFloor(car.id), ruleId: null };
    },
  };
}
