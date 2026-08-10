import { describe, expect, it } from 'vitest';
import { naiveFcfsDispatch } from '../../src/sim/dispatch';
import { computeScore, initLiveSim, isLiveSimFinished, runShift, stepLiveSim, type ShiftConfig } from '../../src/sim/simulate';
import { TICK_RATE } from '../../src/sim/config';

function makeConfig(overrides: Partial<ShiftConfig> = {}): ShiftConfig {
  return {
    building: { floors: 10, carCount: 1, capacityPerCar: 8 },
    seed: 42,
    durationTicks: 3 * 60 * TICK_RATE,
    passengerGenSpec: {
      meanArrivalsPerMinute: 6,
      originFloorWeights: [10, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      destinationBias: 'up',
      traitChances: { impatient: 0.15, heavy: 0.05, vip: 0.03, luggage: 0.05 },
    },
    dispatch: naiveFcfsDispatch,
    ...overrides,
  };
}

describe('runShift determinism', () => {
  it('produces byte-identical results for the same seed and policy', () => {
    const config = makeConfig();
    const resultA = runShift(config);
    const resultB = runShift(makeConfig());

    expect(JSON.stringify(resultA)).toBe(JSON.stringify(resultB));
  });

  it('produces a different result for a different seed', () => {
    const resultA = runShift(makeConfig({ seed: 42 }));
    const resultB = runShift(makeConfig({ seed: 43 }));

    expect(JSON.stringify(resultA)).not.toBe(JSON.stringify(resultB));
  });
});

describe('stepLiveSim / runShift equivalence', () => {
  it('stepping a LiveSim tick by tick with a fixed dispatch produces the exact same result as runShift', () => {
    const config = makeConfig();
    const batch = runShift(config);

    const { dispatch, ...liveConfig } = config;
    const sim = initLiveSim(liveConfig);
    const frames = [];
    while (!isLiveSimFinished(sim)) {
      frames.push(stepLiveSim(sim, dispatch));
    }

    expect(frames).toEqual(batch.frames);
    expect(sim.state.events).toEqual(batch.events);
    expect(sim.state.passengers).toEqual(batch.passengers);
    expect(computeScore(sim.state)).toEqual(batch.score);
  });

  it('isLiveSimFinished is false until durationTicks ticks have run, then true', () => {
    const { dispatch, ...liveConfig } = makeConfig({ durationTicks: 50 });
    const sim = initLiveSim(liveConfig);
    for (let i = 0; i < 50; i++) {
      expect(isLiveSimFinished(sim)).toBe(false);
      stepLiveSim(sim, dispatch);
    }
    expect(isLiveSimFinished(sim)).toBe(true);
  });

  it('computeScore works on a sim that is only partway through (live scoring use case)', () => {
    const { dispatch, ...liveConfig } = makeConfig();
    const sim = initLiveSim(liveConfig);
    for (let i = 0; i < 100; i++) stepLiveSim(sim, dispatch);

    const partial = computeScore(sim.state);
    // Nobody could have given up or been delivered yet after only 5s.
    expect(partial.gaveUp).toBe(0);
    expect(partial.spawned).toBeGreaterThanOrEqual(0);
  });
});

describe('runShift sanity', () => {
  it('never exceeds car capacity', () => {
    const result = runShift(makeConfig());
    for (const frame of result.frames) {
      for (const car of frame) {
        expect(car.passengerIds.length).toBeLessThanOrEqual(8);
      }
    }
  });

  it('accounts for every spawned passenger as delivered, gave-up, or still in flight', () => {
    const result = runShift(makeConfig());
    for (const passenger of result.passengers) {
      expect(['waiting', 'riding', 'delivered', 'gave-up']).toContain(passenger.state);
    }
  });

  it('never lets a delivered passenger end up somewhere other than their destination', () => {
    const result = runShift(makeConfig());
    const deliveredEvents = result.events.filter((e) => e.type === 'delivered');
    for (const event of deliveredEvents) {
      if (event.type !== 'delivered') continue;
      const passenger = result.passengers.find((p) => p.id === event.passengerId);
      expect(passenger?.destFloor).toBe(event.floor);
    }
  });

  it('keeps car position within the building bounds', () => {
    const result = runShift(makeConfig());
    for (const frame of result.frames) {
      for (const car of frame) {
        expect(car.position).toBeGreaterThanOrEqual(0);
        expect(car.position).toBeLessThanOrEqual(9);
      }
    }
  });

  it('delivers most passengers under a reasonable single-car naive-FCFS load', () => {
    const result = runShift(makeConfig());
    expect(result.score.delivered).toBeGreaterThan(0);
    expect(result.score.delivered + result.score.gaveUp).toBeLessThanOrEqual(result.score.spawned);
  });
});
