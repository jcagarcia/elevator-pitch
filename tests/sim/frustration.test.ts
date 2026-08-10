import { describe, expect, it } from 'vitest';
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
} from '../../src/sim/frustration';
import { GIVE_UP_THRESHOLD, HALL_WAIT_KNEE_TICKS } from '../../src/sim/config';

describe('hallWaitDelta', () => {
  it('is zero at the very start of a wait', () => {
    expect(hallWaitDelta(0)).toBe(0);
  });

  it('is monotonically increasing in ticksWaited', () => {
    let previous = -Infinity;
    for (let t = 0; t <= HALL_WAIT_KNEE_TICKS * 3; t += 10) {
      const delta = hallWaitDelta(t);
      expect(delta).toBeGreaterThanOrEqual(previous);
      previous = delta;
    }
  });

  it('is superlinear: the delta well past the knee is more than double the delta at the knee', () => {
    const atKnee = hallWaitDelta(HALL_WAIT_KNEE_TICKS);
    const wellPast = hallWaitDelta(HALL_WAIT_KNEE_TICKS * 2);
    expect(wellPast).toBeGreaterThan(atKnee * 2);
  });
});

describe('rideTimeDelta', () => {
  it('is a small constant', () => {
    expect(rideTimeDelta()).toBeGreaterThan(0);
    expect(rideTimeDelta()).toBeLessThan(hallWaitDelta(HALL_WAIT_KNEE_TICKS));
  });
});

describe('flat/spike penalties', () => {
  it('detour, passed-by, and door-reopen penalties are all positive constants', () => {
    expect(detourStopPenalty()).toBeGreaterThan(0);
    expect(passedByPenalty()).toBeGreaterThan(0);
    expect(doorReopenPenalty()).toBeGreaterThan(0);
  });

  it('passed-by is the biggest single spike among the flat penalties, per the brief ("feels like a betrayal")', () => {
    expect(passedByPenalty()).toBeGreaterThan(detourStopPenalty());
    expect(passedByPenalty()).toBeGreaterThan(doorReopenPenalty());
  });
});

describe('wrongDirectionDelta', () => {
  it('scales with distance travelled the wrong way', () => {
    expect(wrongDirectionDelta(0)).toBe(0);
    expect(wrongDirectionDelta(2)).toBeGreaterThan(wrongDirectionDelta(1));
    expect(wrongDirectionDelta(1) * 2).toBeCloseTo(wrongDirectionDelta(2), 10);
  });
});

describe('crowdingDelta', () => {
  it('is zero below the crowding threshold', () => {
    expect(crowdingDelta(1, 8)).toBe(0);
    expect(crowdingDelta(5, 8)).toBe(0);
  });

  it('is positive once occupancy passes the threshold', () => {
    expect(crowdingDelta(7, 8)).toBeGreaterThan(0);
    expect(crowdingDelta(8, 8)).toBeGreaterThan(crowdingDelta(7, 8));
  });
});

describe('idleInCarDelta', () => {
  it('ramps up with consecutive stalled ticks', () => {
    const early = idleInCarDelta(1);
    const later = idleInCarDelta(50);
    expect(later).toBeGreaterThan(early);
  });
});

describe('traitMultiplier', () => {
  it('applies no multiplier for a passenger with no traits', () => {
    expect(traitMultiplier([], 'hallWait')).toBe(1);
  });

  it('boosts impatient passengers only for hallWait and idleInCar', () => {
    expect(traitMultiplier(['impatient'], 'hallWait')).toBeGreaterThan(1);
    expect(traitMultiplier(['impatient'], 'idleInCar')).toBeGreaterThan(1);
    expect(traitMultiplier(['impatient'], 'rideTime')).toBe(1);
    expect(traitMultiplier(['impatient'], 'detourStop')).toBe(1);
  });

  it('weights VIPs at 10x for every source', () => {
    for (const source of ['hallWait', 'rideTime', 'detourStop', 'wrongDirection', 'passedBy', 'doorsReopened', 'crowding', 'idleInCar'] as const) {
      expect(traitMultiplier(['vip'], source)).toBe(10);
    }
  });

  it('combines impatient and vip multiplicatively', () => {
    const combined = traitMultiplier(['impatient', 'vip'], 'hallWait');
    const impatientOnly = traitMultiplier(['impatient'], 'hallWait');
    expect(combined).toBeCloseTo(impatientOnly * 10, 10);
  });
});

describe('frustrationState', () => {
  it('starts calm and ends gave-up as frustration climbs', () => {
    expect(frustrationState(0)).toBe('calm');
    expect(frustrationState(GIVE_UP_THRESHOLD - 0.01)).not.toBe('gave-up');
    expect(frustrationState(GIVE_UP_THRESHOLD)).toBe('gave-up');
  });

  it('passes through every state in order as frustration rises', () => {
    const seen: string[] = [];
    for (let f = 0; f <= GIVE_UP_THRESHOLD + 10; f += 1) {
      const state = frustrationState(f);
      if (seen[seen.length - 1] !== state) seen.push(state);
    }
    expect(seen).toEqual(['calm', 'annoyed', 'angry', 'furious', 'gave-up']);
  });
});
