import { describe, expect, it } from 'vitest';
import { COMPOSITE_SCORE_MAX, computeCompositeScore, computeStars } from '../../src/levels/scoring';
import type { ShiftScore } from '../../src/sim/simulate';

function makeScore(overrides: Partial<ShiftScore> = {}): ShiftScore {
  return {
    spawned: 20,
    delivered: 20,
    gaveUp: 0,
    averageWaitTicks: 0,
    worstWaitTicks: 0,
    totalFrustration: 0,
    ...overrides,
  };
}

describe('computeCompositeScore', () => {
  it('is at its max for a perfect shift (everyone delivered, zero frustration)', () => {
    expect(computeCompositeScore(makeScore())).toBeLessThanOrEqual(COMPOSITE_SCORE_MAX);
    expect(computeCompositeScore(makeScore())).toBeGreaterThan(900);
  });

  it('never exceeds the max or drops below zero', () => {
    expect(computeCompositeScore(makeScore())).toBeLessThanOrEqual(COMPOSITE_SCORE_MAX);
    const catastrophic = makeScore({ delivered: 0, gaveUp: 500, totalFrustration: 1_000_000, worstWaitTicks: 100_000 });
    expect(computeCompositeScore(catastrophic)).toBeGreaterThanOrEqual(0);
  });

  it('rewards a higher delivered ratio, all else equal', () => {
    const worse = computeCompositeScore(makeScore({ delivered: 10, spawned: 20 }));
    const better = computeCompositeScore(makeScore({ delivered: 18, spawned: 20 }));
    expect(better).toBeGreaterThan(worse);
  });

  it('penalizes give-ups', () => {
    const noGiveUps = computeCompositeScore(makeScore({ delivered: 18, spawned: 20, gaveUp: 0 }));
    const someGiveUps = computeCompositeScore(makeScore({ delivered: 18, spawned: 20, gaveUp: 2 }));
    expect(someGiveUps).toBeLessThan(noGiveUps);
  });

  it('penalizes higher average frustration and worse worst-case wait', () => {
    const calmer = computeCompositeScore(makeScore({ totalFrustration: 50, worstWaitTicks: 100 }));
    const angrier = computeCompositeScore(makeScore({ totalFrustration: 800, worstWaitTicks: 2000 }));
    expect(angrier).toBeLessThan(calmer);
  });

  it('does not divide by zero when nobody spawned', () => {
    expect(() => computeCompositeScore(makeScore({ spawned: 0, delivered: 0 }))).not.toThrow();
  });
});

describe('computeStars', () => {
  const thresholds = { one: 400, two: 600, three: 800 };

  it('awards zero stars below the first threshold', () => {
    expect(computeStars(399, thresholds)).toBe(0);
  });

  it('awards stars at each threshold boundary, inclusive', () => {
    expect(computeStars(400, thresholds)).toBe(1);
    expect(computeStars(600, thresholds)).toBe(2);
    expect(computeStars(800, thresholds)).toBe(3);
  });

  it('never exceeds three stars', () => {
    expect(computeStars(COMPOSITE_SCORE_MAX, thresholds)).toBe(3);
  });
});
