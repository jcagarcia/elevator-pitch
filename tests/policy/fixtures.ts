import { emptyFrustrationBySource, type Car, type Passenger, type SimState } from '../../src/sim/types';

export function makeCar(overrides: Partial<Car> = {}): Car {
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

export function makePassenger(overrides: Partial<Passenger> & Pick<Passenger, 'id' | 'originFloor' | 'destFloor'>): Passenger {
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

export function makeState(
  cars: Car[],
  passengers: Passenger[],
  tick = 0,
  faultyHallSensorFloors: readonly number[] = [],
): SimState {
  return {
    tick,
    building: { floors: 10, cars, faultyHallSensorFloors },
    passengers,
    events: [],
    claimedCalls: new Map(),
  };
}
