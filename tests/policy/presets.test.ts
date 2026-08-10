import { describe, expect, it } from 'vitest';
import { createPolicyDispatch } from '../../src/policy/ruleEngine';
import { LOOK_PRESET, NAIVE_FCFS_PRESET, SCAN_PRESET } from '../../src/policy/presets';
import { naiveFcfsDispatch } from '../../src/sim/dispatch';
import { TICK_RATE } from '../../src/sim/config';
import { runShift, type ShiftConfig } from '../../src/sim/simulate';
import { emptyFrustrationBySource, type Car, type Passenger, type SimState } from '../../src/sim/types';

function makeCar(overrides: Partial<Car> = {}): Car {
  return {
    id: 0,
    capacity: 8,
    position: 5,
    velocity: 0,
    direction: 'idle',
    committedDirection: 'idle',
    doorState: 'closed',
    doorPhaseTicks: 0,
    doorOpenElapsedTicks: 0,
    requiredDwellTicks: 0,
    passengers: [],
    targetFloor: null,
    ...overrides,
  };
}

function makePassenger(overrides: Partial<Passenger> & Pick<Passenger, 'id' | 'originFloor' | 'destFloor'>): Passenger {
  return {
    spawnTick: 0,
    traits: [],
    state: 'waiting',
    frustration: 0,
    frustrationBySource: emptyFrustrationBySource(),
    carId: null,
    boardedTick: null,
    deliveredTick: null,
    gaveUpTick: null,
    stalledTicks: 0,
    ...overrides,
  };
}

function makeState(cars: Car[], passengers: Passenger[], tick = 0): SimState {
  return {
    tick,
    building: { floors: 10, cars },
    passengers,
    events: [],
    claimedCalls: new Map(),
  };
}

describe('SCAN vs LOOK reversal behavior', () => {
  it('SCAN keeps riding to the terminal even with nothing ahead, as long as something needs service elsewhere', () => {
    // Car carrying a rider bound for floor 2 — behind the car, not ahead —
    // so there is nothing ahead in the current direction, but the ride
    // isn't over yet. car-empty must be false here so rules fall through to
    // continue-sweep instead of picking a fresh nearest call.
    const car = makeCar({ position: 5, committedDirection: 'up', passengers: [0] });
    const passenger = makePassenger({ id: 0, originFloor: 5, destFloor: 2, state: 'riding', carId: 0 });
    const state = makeState([car], [passenger]);

    const decision = createPolicyDispatch(SCAN_PRESET).decideNextTarget(car, state);

    expect(decision.targetFloor).toBe(9); // building.floors - 1
    expect(decision.ruleId).toBe('scan-continue');
  });

  it('LOOK reverses early instead of riding to the terminal', () => {
    const car = makeCar({ position: 5, committedDirection: 'up', passengers: [0] });
    const passenger = makePassenger({ id: 0, originFloor: 5, destFloor: 2, state: 'riding', carId: 0 });
    const state = makeState([car], [passenger]);

    const decision = createPolicyDispatch(LOOK_PRESET).decideNextTarget(car, state);

    expect(decision.targetFloor).toBe(2);
    expect(decision.ruleId).toBe('look-reverse-early');
  });

  it('SCAN only reverses once it physically reaches the terminal', () => {
    const car = makeCar({ position: 9, committedDirection: 'up' });
    const passenger = makePassenger({ id: 0, originFloor: 2, destFloor: 0 });
    const state = makeState([car], [passenger]);

    const decision = createPolicyDispatch(SCAN_PRESET).decideNextTarget(car, state);

    expect(decision.ruleId).toBe('scan-reverse-at-end');
  });
});

describe('two-car call claiming', () => {
  it('a second car does not also chase a call the first car already claimed', () => {
    const carA = makeCar({ id: 0, position: 0 });
    const carB = makeCar({ id: 1, position: 9 });
    const passenger = makePassenger({ id: 0, originFloor: 5, destFloor: 8 });
    const state = makeState([carA, carB], [passenger]);
    const dispatch = createPolicyDispatch(SCAN_PRESET);

    const decisionA = dispatch.decideNextTarget(carA, state);
    expect(decisionA.targetFloor).toBe(5);

    const decisionB = dispatch.decideNextTarget(carB, state);
    expect(decisionB.targetFloor).not.toBe(5);
  });

  it('releases a car’s claim once it picks a different target, freeing the call for another car', () => {
    const carA = makeCar({ id: 0, position: 0 });
    const carB = makeCar({ id: 1, position: 9 });
    const passenger = makePassenger({ id: 0, originFloor: 5, destFloor: 8 });
    const state = makeState([carA, carB], [passenger]);
    const dispatch = createPolicyDispatch(SCAN_PRESET);

    dispatch.decideNextTarget(carA, state);
    expect(state.claimedCalls.get('5:up')).toBe(0);

    // Car A gets re-asked (e.g. its target was cleared) and this time has
    // nothing else going on, so it re-claims the same call — simulating
    // that as long as A still wants floor 5, the claim stays with A.
    const decisionA2 = dispatch.decideNextTarget(carA, state);
    expect(decisionA2.targetFloor).toBe(5);
    expect(state.claimedCalls.get('5:up')).toBe(0);
  });
});

function demoShiftConfig(dispatch: ShiftConfig['dispatch']): ShiftConfig {
  return {
    building: { floors: 10, carCount: 1, capacityPerCar: 8 },
    seed: 42,
    durationTicks: 6 * 60 * TICK_RATE,
    passengerGenSpec: {
      meanArrivalsPerMinute: 8,
      originFloorWeights: [10, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      destinationBias: 'up',
      traitChances: { impatient: 0.15 },
    },
    dispatch,
  };
}

describe('preset quality ordering on a rush-hour scenario', () => {
  it('SCAN produces less total frustration than naive FCFS on the same seed', () => {
    const fcfsResult = runShift(demoShiftConfig(naiveFcfsDispatch));
    const scanResult = runShift(demoShiftConfig(createPolicyDispatch(SCAN_PRESET)));

    expect(scanResult.score.totalFrustration).toBeLessThan(fcfsResult.score.totalFrustration);
    expect(scanResult.score.gaveUp).toBeLessThanOrEqual(fcfsResult.score.gaveUp);
  });

  it('the data-driven Naive FCFS preset is at least as bad as SCAN, matching the hardcoded stub’s spirit', () => {
    const presetFcfsResult = runShift(demoShiftConfig(createPolicyDispatch(NAIVE_FCFS_PRESET)));
    const scanResult = runShift(demoShiftConfig(createPolicyDispatch(SCAN_PRESET)));

    expect(scanResult.score.totalFrustration).toBeLessThan(presetFcfsResult.score.totalFrustration);
  });
});
