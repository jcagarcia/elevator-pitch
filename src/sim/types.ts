export type PassengerId = number;
export type CarId = number;

export type Trait = 'impatient' | 'heavy' | 'vip' | 'luggage';

export type PassengerState = 'waiting' | 'riding' | 'delivered' | 'gave-up';

export type FrustrationState = 'calm' | 'annoyed' | 'angry' | 'furious' | 'gave-up';

export type FrustrationSource =
  | 'hallWait'
  | 'rideTime'
  | 'detourStop'
  | 'wrongDirection'
  | 'passedBy'
  | 'doorsReopened'
  | 'crowding'
  | 'idleInCar';

export type FrustrationBySource = Record<FrustrationSource, number>;

export function emptyFrustrationBySource(): FrustrationBySource {
  return {
    hallWait: 0,
    rideTime: 0,
    detourStop: 0,
    wrongDirection: 0,
    passedBy: 0,
    doorsReopened: 0,
    crowding: 0,
    idleInCar: 0,
  };
}

export interface Passenger {
  readonly id: PassengerId;
  readonly originFloor: number;
  readonly destFloor: number;
  readonly spawnTick: number;
  readonly traits: readonly Trait[];
  state: PassengerState;
  frustration: number;
  frustrationBySource: FrustrationBySource;
  /** Car the passenger boarded (or is riding). Kept set after delivery too —
   *  it's the historical record used to reconstruct which car to render them
   *  in for any tick in [boardedTick, deliveredTick) during playback. */
  carId: CarId | null;
  boardedTick: number | null;
  deliveredTick: number | null;
  gaveUpTick: number | null;
  /** Consecutive ticks this passenger's car has sat idle with doors closed. */
  stalledTicks: number;
}

export function passengerDirection(p: Passenger): 'up' | 'down' {
  return p.destFloor > p.originFloor ? 'up' : 'down';
}

/** Derives a passenger's status at an arbitrary past tick from their final
 *  record — cheap enough that the renderer can call it every frame instead
 *  of needing a full per-tick position history. Only frustration (which
 *  accrues unpredictably tick to tick) needs its own recorded history; see
 *  SimResult.frustrationHistory. */
export type PassengerRenderState = 'not-spawned' | 'waiting' | 'riding' | 'delivered' | 'gave-up';

export function passengerStateAtTick(p: Passenger, tick: number): PassengerRenderState {
  if (tick < p.spawnTick) return 'not-spawned';
  if (p.boardedTick !== null && tick >= p.boardedTick) {
    if (p.deliveredTick !== null && tick >= p.deliveredTick) return 'delivered';
    return 'riding';
  }
  if (p.gaveUpTick !== null && tick >= p.gaveUpTick) return 'gave-up';
  return 'waiting';
}

export type Direction = 'up' | 'down' | 'idle';
export type DoorState = 'closed' | 'opening' | 'open' | 'closing';

export interface Car {
  readonly id: CarId;
  readonly capacity: number;
  /** Continuous floor position, e.g. 3.42. */
  position: number;
  velocity: number;
  direction: Direction;
  doorState: DoorState;
  /** Ticks elapsed in the current door phase. */
  doorPhaseTicks: number;
  /** Ticks the doors have been fully open (drives the dwell-time check). */
  doorOpenElapsedTicks: number;
  /** Minimum dwell required this stop, computed when doors start opening. */
  requiredDwellTicks: number;
  passengers: PassengerId[];
  /** Next floor the car is heading to, chosen by the dispatch policy. Null = no target, car is idle. */
  targetFloor: number | null;
}

export interface Building {
  readonly floors: number;
  readonly cars: readonly Car[];
}

/** A hall call: someone waiting at a floor wanting to go a given direction. */
export interface HallCall {
  readonly floor: number;
  readonly direction: 'up' | 'down';
  /** Passenger ids waiting at this floor for this direction. */
  readonly passengerIds: readonly PassengerId[];
  readonly oldestSpawnTick: number;
}

/**
 * The event log only records discrete occurrences, not continuous per-tick
 * frustration accrual (hall wait, ride time, crowding, idle-in-car) — those
 * totals live on Passenger.frustrationBySource instead. A multi-thousand-tick
 * shift would otherwise produce an unusably large log. Discrete/spike
 * sources (detour, wrong-direction crossing, passed-by, doors-reopened) do
 * get an event each, since those are exactly the "worst moments" the
 * end-of-shift report points to.
 */
export type SimEvent =
  | { type: 'spawn'; tick: number; passengerId: PassengerId; floor: number }
  | { type: 'board'; tick: number; passengerId: PassengerId; carId: CarId; floor: number }
  | { type: 'alight'; tick: number; passengerId: PassengerId; carId: CarId; floor: number }
  | { type: 'delivered'; tick: number; passengerId: PassengerId; carId: CarId; floor: number }
  | { type: 'gave-up'; tick: number; passengerId: PassengerId; floor: number }
  | { type: 'passed-by'; tick: number; passengerId: PassengerId; carId: CarId; floor: number }
  | { type: 'doors-reopened'; tick: number; carId: CarId; floor: number }
  | { type: 'detour-stop'; tick: number; passengerId: PassengerId; carId: CarId; floor: number }
  | {
      type: 'rule-fired';
      tick: number;
      carId: CarId;
      ruleId: string | null; // null = fell through to default behavior
      targetFloor: number | null;
    };

export interface SimState {
  tick: number;
  building: Building;
  passengers: Passenger[];
  events: SimEvent[];
  /** Shared claim table so two cars don't both commit to the same hall call (floor+direction). */
  claimedCalls: Map<string, CarId>;
}

export function hallCallKey(floor: number, direction: 'up' | 'down'): string {
  return `${floor}:${direction}`;
}

/** A lightweight per-tick snapshot of one car, cheap enough to store one per
 *  tick per car for the whole shift and hand to the renderer. */
export interface CarFrame {
  readonly carId: CarId;
  readonly position: number;
  readonly direction: Direction;
  readonly doorState: DoorState;
  readonly passengerIds: readonly PassengerId[];
}

