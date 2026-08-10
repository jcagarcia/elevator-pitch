import type { ActionId, ConditionId } from '../policy/types';
import type { PassengerGenSpec } from '../sim/passengerGenerator';

export interface StarThresholds {
  /** Minimum composite score (see levels/scoring.ts) for one/two/three
   *  stars, ascending. Below `one`, the shift still completes — no hard
   *  fail state — it just earns zero stars. */
  one: number;
  two: number;
  three: number;
}

export interface LevelDef {
  readonly id: string;
  readonly name: string;
  /** Maintenance-manual voice: plain, imperative, states what the shift is. */
  readonly briefing: string;
  readonly floors: number;
  readonly carCount: number;
  readonly capacityPerCar: number;
  /** Fixed seed — re-running the same policy against this level must
   *  reproduce this exact shift. */
  readonly seed: number;
  readonly durationTicks: number;
  readonly passengerGenSpec: PassengerGenSpec;
  readonly faultyHallSensorFloors?: readonly number[];
  readonly starThresholds: StarThresholds;
  /** Conditions/actions available in the rule editor on this level, on top
   *  of whatever earlier levels already unlocked. */
  readonly unlocks: {
    readonly conditions: readonly ConditionId[];
    readonly actions: readonly ActionId[];
  };
}
