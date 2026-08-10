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
 * Runs an entire shift synchronously and returns the full result — frame by
 * frame car state plus the discrete event log. Playback (play/pause/speed/
 * scrub) is purely a matter of moving a playhead through this precomputed
 * result; nothing about the sim couples to wall-clock time, which is what
 * makes reruns on an unchanged policy byte-identical.
 */
export function runShift(config: ShiftConfig): SimResult {
  const rng = createRng(config.seed);
  const building = createBuilding(config.building);
  const roster = generatePassengers(rng, config.passengerGenSpec, config.building.floors, config.durationTicks);

  const state: SimState = {
    tick: 0,
    building,
    passengers: [],
    events: [],
    claimedCalls: new Map(),
  };

  const frames: CarFrame[][] = [];
  const frustrationHistory: Float32Array[] = roster.map(() => new Float32Array(config.durationTicks));
  let rosterIndex = 0;

  for (let tick = 0; tick < config.durationTicks; tick++) {
    state.tick = tick;

    while (rosterIndex < roster.length) {
      const passenger = roster[rosterIndex];
      if (!passenger || passenger.spawnTick !== tick) break;
      state.passengers.push(passenger);
      state.events.push({ type: 'spawn', tick, passengerId: passenger.id, floor: passenger.originFloor });
      rosterIndex++;
    }

    stepTick(state, config.dispatch);

    frames.push(state.building.cars.map(captureFrame));
    for (const passenger of state.passengers) {
      frustrationHistory[passenger.id]![tick] = passenger.frustration;
    }
  }

  return {
    frames,
    events: state.events,
    passengers: state.passengers,
    score: computeScore(state),
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
        checkPassedBy(state, car, floor);
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
      car.requiredDwellTicks = resolveStop(state, car);
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
  if (shouldReopenDoors(state, car, floor)) {
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

/** A new compatible call at the floor the car is currently closing its
 *  doors at reopens them — small, comedic, and only possible while there's
 *  still room aboard. */
function shouldReopenDoors(state: SimState, car: Car, floor: number): boolean {
  if (car.passengers.length >= car.capacity) return false;
  return state.passengers.some((p) => p.state === 'waiting' && p.originFloor === floor && p.spawnTick === state.tick);
}

function resolveStop(state: SimState, car: Car): number {
  const floor = Math.round(car.position);
  let dwellTicksNeeded = BASE_MIN_DOOR_DWELL_TICKS;

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
    if (car.passengers.length >= car.capacity) break;
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

function checkPassedBy(state: SimState, car: Car, floor: number): void {
  if (car.passengers.length >= car.capacity) return;
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

function computeScore(state: SimState): ShiftScore {
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
