import type { Building, Car, Direction, SimState } from '../sim/types';

// ---------------------------------------------------------------------------
// Catalog ids. Adding a new condition/action means adding a case to the
// catalog (policy/catalog.ts) and, once levels exist, an unlock level.
// ---------------------------------------------------------------------------

export type ConditionId =
  | 'always'
  | 'car-empty'
  | 'has-waiting-call'
  | 'traveling-direction'
  | 'capacity-at-least'
  | 'call-waited-longer-than'
  | 'at-direction-terminal'
  | 'nothing-ahead-in-direction';

export type ActionId =
  | 'go-to-nearest-call'
  | 'go-to-oldest-call'
  | 'serve-call-ahead'
  | 'continue-sweep'
  | 'reverse-sweep'
  | 'serve-onboard-only'
  | 'serve-first-boarded'
  | 'treat-as-highest-priority'
  | 'park-at-floor';

export type ConditionParams = Record<string, number | string | boolean>;
export type ActionParams = Record<string, number | string | boolean>;

export interface Condition {
  id: ConditionId;
  params: ConditionParams;
}

export interface Action {
  id: ActionId;
  params: ActionParams;
}

export interface Rule {
  id: string;
  enabled: boolean;
  /** All conditions must hold (AND) for the rule to fire — this is how
   *  the brief's "if X and Y, do Z" examples are expressed as data. */
  conditions: Condition[];
  action: Action;
}

export interface DispatchParameters {
  /** Calls farther than this from the car are ignored for this decision —
   *  set it low and the car stops looking past its own hallway. */
  lookaheadFloors: number;
  /** Reserved for a future "commit to direction" condition — not yet
   *  consulted by the engine. Stored so the parameter panel and saved
   *  policies have a stable shape to grow into. */
  directionCommitThreshold: number;
  /** Floor below which the base door dwell (config.ts) is never allowed —
   *  this can only raise the minimum stop time, never shorten it. */
  minDoorDwellTicks: number;
  /** While sweeping a direction, will the car still pick up a hall call
   *  requesting the opposite direction? */
  acceptReverseDirectionPickup: boolean;
  /** Fraction of capacity held back as a reserve, e.g. 0.25 on an 8-seat
   *  car means boarding stops at 6. */
  capacityReserve: number;
  /** Where a car with nothing to do heads to wait. Null = stay put. */
  idleParkingFloor: number | null;
}

export interface DispatchPolicy {
  name: string;
  parameters: DispatchParameters;
  rules: Rule[];
}

/** A hall call as seen by the policy engine: waiting passengers grouped by
 *  floor and desired direction, already filtered for this car (lookahead,
 *  reverse-pickup preference, and the other car's claim). */
export interface FocusCall {
  readonly floor: number;
  readonly direction: 'up' | 'down';
  readonly passengerIds: readonly number[];
  readonly oldestSpawnTick: number;
}

export interface DispatchContext {
  readonly car: Car;
  readonly state: SimState;
  readonly building: Building;
  readonly policy: DispatchPolicy;
  /** Hall calls visible to this car for this decision — already filtered by
   *  lookaheadFloors, acceptReverseDirectionPickup, and calls claimed by a
   *  different car. */
  readonly hallCalls: readonly FocusCall[];
}

export type ConditionResult = { matched: false } | { matched: true; focus?: FocusCall };

export type ConditionEvaluator = (ctx: DispatchContext, params: ConditionParams) => ConditionResult;

export interface TargetDecision {
  targetFloor: number | null;
  /** New committed sweep direction, if the action changes it. Undefined = unchanged. */
  committedDirection?: Direction;
}

export type ActionEvaluator = (ctx: DispatchContext, params: ActionParams, focus: FocusCall | null) => TargetDecision;
