import { describe, expect, it } from 'vitest';
import { computeLiveMorale, LIVE_MORALE_MAX } from '../../src/levels/liveScore';
import { emptyFrustrationBySource, type Passenger, type SimState } from '../../src/sim/types';

function makePassenger(overrides: Partial<Passenger> & Pick<Passenger, 'id' | 'state'>): Passenger {
  return {
    originFloor: 0,
    destFloor: 5,
    spawnTick: 0,
    traits: [],
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

function makeState(passengers: Passenger[]): SimState {
  return {
    tick: 0,
    building: { floors: 10, cars: [], faultyHallSensorFloors: [] },
    passengers,
    events: [],
    claimedCalls: new Map(),
  };
}

describe('computeLiveMorale', () => {
  it('is at its max with nobody spawned yet', () => {
    expect(computeLiveMorale(makeState([]))).toBe(LIVE_MORALE_MAX);
  });

  it('is unaffected by delivered passengers, however frustrated they were', () => {
    const state = makeState([makePassenger({ id: 0, state: 'delivered', frustration: 500 })]);
    expect(computeLiveMorale(state)).toBe(LIVE_MORALE_MAX);
  });

  it('is not penalized just because delivery ratio is low — only spawned, still-active, or gave-up passengers matter', () => {
    // 1 waiting passenger with zero frustration yet, 0 delivered: a naive
    // end-of-shift-style ratio would already read this as a disaster.
    const state = makeState([makePassenger({ id: 0, state: 'waiting', frustration: 0 })]);
    expect(computeLiveMorale(state)).toBe(LIVE_MORALE_MAX);
  });

  it('decreases as active (waiting/riding) passengers get more frustrated', () => {
    const calm = computeLiveMorale(makeState([makePassenger({ id: 0, state: 'waiting', frustration: 5 })]));
    const annoyed = computeLiveMorale(makeState([makePassenger({ id: 0, state: 'waiting', frustration: 80 })]));
    expect(annoyed).toBeLessThan(calm);
  });

  it('decreases sharply per give-up, and give-ups do not get diluted by other passengers', () => {
    const noGiveUps = computeLiveMorale(makeState([makePassenger({ id: 0, state: 'waiting' })]));
    const oneGiveUp = computeLiveMorale(
      makeState([makePassenger({ id: 0, state: 'waiting' }), makePassenger({ id: 1, state: 'gave-up', frustration: 150 })]),
    );
    expect(oneGiveUp).toBeLessThan(noGiveUps);
  });

  it('never drops below zero or above the max', () => {
    const manyGiveUps = Array.from({ length: 50 }, (_, i) => makePassenger({ id: i, state: 'gave-up', frustration: 200 }));
    expect(computeLiveMorale(makeState(manyGiveUps))).toBe(0);
  });

  it('riding passengers count toward the active-frustration average the same as waiting ones', () => {
    const state = makeState([makePassenger({ id: 0, state: 'riding', frustration: 80 })]);
    const waitingEquivalent = makeState([makePassenger({ id: 0, state: 'waiting', frustration: 80 })]);
    expect(computeLiveMorale(state)).toBe(computeLiveMorale(waitingEquivalent));
  });
});
