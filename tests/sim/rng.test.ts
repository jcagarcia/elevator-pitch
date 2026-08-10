import { describe, expect, it } from 'vitest';
import { chance, createRng, exponentialSample, randomInt, weightedIndex } from '../../src/sim/rng';

describe('rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(999);
    for (let i = 0; i < 5000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('randomInt stays within [min, maxExclusive)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const value = randomInt(rng, 3, 8);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(8);
    }
  });

  it('weightedIndex only picks indices with positive weight', () => {
    const rng = createRng(11);
    const weights = [0, 5, 0, 2];
    for (let i = 0; i < 500; i++) {
      const index = weightedIndex(rng, weights);
      expect([1, 3]).toContain(index);
    }
  });

  it('exponentialSample returns positive values', () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) {
      expect(exponentialSample(rng, 0.01)).toBeGreaterThan(0);
    }
  });

  it('chance respects probability extremes', () => {
    const rng = createRng(5);
    expect(chance(rng, 0)).toBe(false);
    const rng2 = createRng(5);
    expect(chance(rng2, 1)).toBe(true);
  });
});
