import { createBuilding, type BuildingSpec } from './building';
import {
  BASE_MIN_DOOR_DWELL_TICKS,
  BOARD_ALIGHT_TICKS_PER_PASSENGER,
  DOOR_CLOSE_TICKS,
  DOOR_OPEN_TICKS,
  HEAVY_TRAIT_DWELL_MULTIPLIER,
} from './config';
import type { DispatchStrategy } from './dispatch';
import {
  crowdingDelta,
  detourStopPenalty,
  doorReopenPenalty,
  frustrationState,
  hallWaitDelta,
  idleInCarDelta,
  passedByPenalty,
  rideTimeDelta,
  traitMultiplier,
  wrongDirectionDelta,
} from './frustration';
import { generatePassengers, type PassengerGenSpec } from './passengerGenerator';
import { advanceCarPosition } from './physics';
import { createRng } from './rng';
import { passengerDirection, type Car, type CarFrame, type FrustrationSource, type Passenger, type SimState } from './types';

export interface ShiftConfig {
  building: BuildingSpec;
  seed: number;
  durationTicks: number;
  passengerGenSpec: PassengerGenSpec;
  dispatch: DispatchStrategy;
}

export interface ShiftScore {
  spawned: number;
  delivered: number;
  gaveUp: number;
  averageWaitTicks: number;
  worstWaitTicks: number;
  totalFrustration: number;
}

export interface SimResult {
  frames: CarFrame[][];
  events: SimState['events'];
  passengers: Passenger[];
  score: ShiftScore;
  /**
   * Cumulative frustration per passenger per tick, indexed
   * frustrationHistory[passengerId][tick]. Only frustration needs this
   * treatment for playback/scrubbing — a passenger's floor/car at any tick
   * is cheap to derive from their final record (see passengerStateAtTick),
   * but frustration accrues unpredictably tick to tick depending on live
   * car state, so there's no shortcut around recording it. Sized as
   * Float32Array per passenger to keep a multi-thousand-tick shift with a
   * large roster in the single-digit megabytes.
   */
  frustrationHistory: Float32Array[];
}

/**
 * A shift in progress: the mutable SimState plus the pre-generated
 * passenger roster and how far into it we've spawned. state.tick is the
 * single source of truth for "what tick are we at" — spawning and stepping
 * both read/advance it, so there's exactly one place that owns it.
 */
export interface LiveSim {
  readonly state: SimState;
  readonly roster: readonly Passenger[];
  rosterIndex: number;
  readonly durationTicks: number;
}

/** Sets up a shift without running any of it — the roster (who spawns
 *  when, wanting what) is generated up front from the seed, same as batch
 *  mode, since passenger arrivals stay deterministic even when the dispatch
 *  policy driving stepLiveSim doesn't. */
export function initLiveSim(config: Omit<ShiftConfig, 'dispatch'>): LiveSim {
  const rng = createRng(config.seed);
  const building = createBuilding(config.building);
  const roster = generatePassengers(rng, config.passengerGenSpec, config.building.floors, config.durationTicks);
  return {
    state: { tick: 0, building, passengers: [], events: [], claimedCalls: new Map() },
    roster,
    rosterIndex: 0,
    durationTicks: config.durationTicks,
  };
}

export function isLiveSimFinished(sim: LiveSim): boolean {
  return sim.state.tick >= sim.durationTicks;
}

/**
 * Advances a LiveSim by exactly one tick using whichever dispatch strategy
 * is passed in for *this* call — nothing requires it to be the same
 * strategy from one call to the next. That's the seam live play depends
 * on: rebuild a DispatchStrategy from the current policy every tick (or
 * every animation frame) and edits take effect on the very next tick,
 * rather than only on the next full run. Returns this tick's car frames
 * for convenience.
 */
export function stepLiveSim(sim: LiveSim, dispatch: DispatchStrategy): CarFrame[] {
  const { state, roster } = sim;
  const tick = state.tick;

  while (sim.rosterIndex < roster.length) {
    const passenger = roster[sim.rosterIndex];
    if (!passenger || passenger.spawnTick !== tick) break;
    state.passengers.push(passenger);
    state.events.push({ type: 'spawn', tick, passengerId: passenger.id, floor: passenger.originFloor });
    sim.rosterIndex++;
  }

  stepTick(state, dispatch);
  state.tick = tick + 1;

  return state.building.cars.map(captureFrame);
}

/**
 * Runs an entire shift synchronously against one fixed dispatch strategy
 * and returns the full result — frame by frame car state plus the discrete
 * event log. Playback (play/pause/speed/scrub) is purely a matter of
 * moving a playhead through this precomputed result; nothing about the sim
 * couples to wall-clock time, which is what makes reruns on an unchanged
 * policy byte-identical. (Live play, where the policy itself can change
 * mid-shift, steps a LiveSim directly instead — see stepLiveSim.)
 */
export function runShift(config: ShiftConfig): SimResult {
  const sim = initLiveSim(config);
  const frames: CarFrame[][] = [];
  const frustrationHistory: Float32Array[] = sim.roster.map(() => new Float32Array(config.durationTicks));

  while (!isLiveSimFinished(sim)) {
    const tick = sim.state.tick;
    const frame = stepLiveSim(sim, config.dispatch);
    frames.push(frame);
    for (const passenger of sim.state.passengers) {
      frustrationHistory[passenger.id]![tick] = passenger.frustration;
    }
  }

  return {
    frames,
    events: sim.state.events,
    passengers: sim.state.passengers,
    score: computeScore(sim.state),
    frustrationHistory,
  };
}

function captureFrame(car: Car): CarFrame {
  return {
    carId: car.id,
    position: car.position,
    direction: car.direction,
    doorState: car.doorState,
    passengerIds: [...car.passengers],
  };
}

function stepTick(state: SimState, dispatch: DispatchStrategy): void {
  for (const car of state.building.cars) {
    stepCarMovementAndDoors(state, car, dispatch);
  }
  applyFrustration(state);
}

function stepCarMovementAndDoors(state: SimState, car: Car, dispatch: DispatchStrategy): void {
  if (car.doorState === 'closed') {
    if (car.targetFloor === null) {
      const decision = dispatch.decideNextTarget(car, state);
      car.targetFloor = decision.targetFloor;
      if (decision.targetFloor !== null) {
        state.events.push({
          type: 'rule-fired',
          tick: state.tick,
          carId: car.id,
          ruleId: decision.ruleId,
          targetFloor: decision.targetFloor,
        });
      }
    }

    if (car.targetFloor !== null) {
      const prevPosition = car.position;
      const { arrived, floorsCrossed } = advanceCarPosition(car);
      for (const floor of floorsCrossed) {
        checkPassedBy(state, car, floor, dispatch);
      }
      applyWrongDirection(state, car, prevPosition);
      if (arrived) {
        car.doorState = 'opening';
        car.doorPhaseTicks = 0;
      }
    }
    return;
  }

  if (car.doorState === 'opening') {
    car.doorPhaseTicks++;
    if (car.doorPhaseTicks >= DOOR_OPEN_TICKS) {
      car.doorState = 'open';
      car.doorPhaseTicks = 0;
      car.doorOpenElapsedTicks = 0;
      car.requiredDwellTicks = resolveStop(state, car, dispatch);
    }
    return;
  }

  if (car.doorState === 'open') {
    car.doorOpenElapsedTicks++;
    if (car.doorOpenElapsedTicks >= car.requiredDwellTicks) {
      car.doorState = 'closing';
      car.doorPhaseTicks = 0;
    }
    return;
  }

  // car.doorState === 'closing'
  const floor = Math.round(car.position);
  if (shouldReopenDoors(state, car, floor, dispatch)) {
    car.doorState = 'opening';
    car.doorPhaseTicks = 0;
    state.events.push({ type: 'doors-reopened', tick: state.tick, carId: car.id, floor });
    for (const passengerId of car.passengers) {
      const passenger = findPassenger(state, passengerId);
      if (passenger) applyFrustrationToPassenger(passenger, 'doorsReopened', doorReopenPenalty());
    }
    return;
  }

  car.doorPhaseTicks++;
  if (car.doorPhaseTicks >= DOOR_CLOSE_TICKS) {
    car.doorState = 'closed';
    car.doorPhaseTicks = 0;
    car.targetFloor = null;
  }
}

function effectiveCapacityOf(car: Car, dispatch: DispatchStrategy): number {
  return dispatch.effectiveCapacity?.(car) ?? car.capacity;
}

/** A new compatible call at the floor the car is currently closing its
 *  doors at reopens them — small, comedic, and only possible while there's
 *  still room aboard. */
function shouldReopenDoors(state: SimState, car: Car, floor: number, dispatch: DispatchStrategy): boolean {
  if (car.passengers.length >= effectiveCapacityOf(car, dispatch)) return false;
  return state.passengers.some((p) => p.state === 'waiting' && p.originFloor === floor && p.spawnTick === state.tick);
}

function resolveStop(state: SimState, car: Car, dispatch: DispatchStrategy): number {
  const floor = Math.round(car.position);
  const capacity = effectiveCapacityOf(car, dispatch);
  let dwellTicksNeeded = Math.max(BASE_MIN_DOOR_DWELL_TICKS, dispatch.minDoorDwellTicks?.() ?? 0);

  const stillAboard: number[] = [];
  for (const passengerId of car.passengers) {
    const passenger = findPassenger(state, passengerId);
    if (!passenger) continue;
    if (passenger.destFloor === floor) {
      passenger.state = 'delivered';
      passenger.deliveredTick = state.tick;
      state.events.push({ type: 'alight', tick: state.tick, passengerId: passenger.id, carId: car.id, floor });
      state.events.push({ type: 'delivered', tick: state.tick, passengerId: passenger.id, carId: car.id, floor });
      dwellTicksNeeded += boardAlightTicksFor(passenger);
    } else {
      stillAboard.push(passengerId);
      state.events.push({ type: 'detour-stop', tick: state.tick, passengerId: passenger.id, carId: car.id, floor });
      applyFrustrationToPassenger(passenger, 'detourStop', detourStopPenalty());
    }
  }
  car.passengers = stillAboard;

  const waitingHere = state.passengers
    .filter((p) => p.state === 'waiting' && p.originFloor === floor)
    .sort((a, b) => a.spawnTick - b.spawnTick);

  for (const passenger of waitingHere) {
    if (car.passengers.length >= capacity) break;
    passenger.state = 'riding';
    passenger.carId = car.id;
    passenger.boardedTick = state.tick;
    passenger.stalledTicks = 0;
    car.passengers.push(passenger.id);
    state.events.push({ type: 'board', tick: state.tick, passengerId: passenger.id, carId: car.id, floor });
    dwellTicksNeeded += boardAlightTicksFor(passenger);
  }

  return dwellTicksNeeded;
}

function boardAlightTicksFor(passenger: Passenger): number {
  const heavy = passenger.traits.includes('heavy') || passenger.traits.includes('luggage');
  return BOARD_ALIGHT_TICKS_PER_PASSENGER * (heavy ? HEAVY_TRAIT_DWELL_MULTIPLIER : 1);
}

function checkPassedBy(state: SimState, car: Car, floor: number, dispatch: DispatchStrategy): void {
  if (car.passengers.length >= effectiveCapacityOf(car, dispatch)) return;
  if (car.direction === 'idle') return;
  for (const passenger of state.passengers) {
    if (passenger.state !== 'waiting') continue;
    if (passenger.originFloor !== floor) continue;
    if (passengerDirection(passenger) !== car.direction) continue;
    state.events.push({ type: 'passed-by', tick: state.tick, passengerId: passenger.id, carId: car.id, floor });
    applyFrustrationToPassenger(passenger, 'passedBy', passedByPenalty());
  }
}

function applyWrongDirection(state: SimState, car: Car, prevPosition: number): void {
  const distanceMoved = Math.abs(car.position - prevPosition);
  if (distanceMoved === 0 || car.direction === 'idle') return;
  for (const passengerId of car.passengers) {
    const passenger = findPassenger(state, passengerId);
    if (!passenger) continue;
    const movingAway =
      (car.direction === 'up' && passenger.destFloor < car.position) ||
      (car.direction === 'down' && passenger.destFloor > car.position);
    if (movingAway) {
      applyFrustrationToPassenger(passenger, 'wrongDirection', wrongDirectionDelta(distanceMoved));
    }
  }
}

function applyFrustration(state: SimState): void {
  for (const passenger of state.passengers) {
    if (passenger.state === 'waiting') {
      const ticksWaited = state.tick - passenger.spawnTick;
      applyFrustrationToPassenger(passenger, 'hallWait', hallWaitDelta(ticksWaited));
      if (frustrationState(passenger.frustration) === 'gave-up') {
        passenger.state = 'gave-up';
        passenger.gaveUpTick = state.tick;
        state.events.push({ type: 'gave-up', tick: state.tick, passengerId: passenger.id, floor: passenger.originFloor });
      }
      continue;
    }

    if (passenger.state === 'riding') {
      applyFrustrationToPassenger(passenger, 'rideTime', rideTimeDelta());

      const car = state.building.cars.find((c) => c.id === passenger.carId);
      if (car) {
        applyFrustrationToPassenger(passenger, 'crowding', crowdingDelta(car.passengers.length, car.capacity));

        const isStalled = car.doorState === 'closed' && car.velocity === 0 && car.targetFloor === null;
        if (isStalled) {
          passenger.stalledTicks++;
          applyFrustrationToPassenger(passenger, 'idleInCar', idleInCarDelta(passenger.stalledTicks));
        } else {
          passenger.stalledTicks = 0;
        }
      }
    }
  }
}

// Continuous sources (hall wait, ride time, crowding, idle-in-car) don't get
// a SimEvent — only the cumulative total on frustrationBySource. See the
// SimEvent doc comment in types.ts for why.
function applyFrustrationToPassenger(
  passenger: Passenger,
  source: FrustrationSource,
  rawAmount: number,
): void {
  if (rawAmount <= 0) return;
  const amount = rawAmount * traitMultiplier(passenger.traits, source);
  passenger.frustration += amount;
  passenger.frustrationBySource[source] += amount;
}

function findPassenger(state: SimState, id: number): Passenger | undefined {
  return state.passengers.find((p) => p.id === id);
}

/** Works equally well on a finished shift or one still in progress — score
 *  is always just a summary of whatever's in state.passengers right now,
 *  which is what lets live play show a running score. */
export function computeScore(state: SimState): ShiftScore {
  let delivered = 0;
  let gaveUp = 0;
  let totalWait = 0;
  let worstWait = 0;
  let totalFrustration = 0;

  for (const passenger of state.passengers) {
    totalFrustration += passenger.frustration;
    if (passenger.state === 'delivered' && passenger.deliveredTick !== null) {
      delivered++;
      const waited = (passenger.boardedTick ?? passenger.deliveredTick) - passenger.spawnTick;
      totalWait += waited;
      worstWait = Math.max(worstWait, waited);
    } else if (passenger.state === 'gave-up') {
      gaveUp++;
    }
  }

  return {
    spawned: state.passengers.length,
    delivered,
    gaveUp,
    averageWaitTicks: delivered > 0 ? totalWait / delivered : 0,
    worstWaitTicks: worstWait,
    totalFrustration,
  };
}
