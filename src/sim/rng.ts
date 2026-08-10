/**
 * Deterministic PRNG for the simulation. Never use Math.random() or Date.now()
 * anywhere under src/sim or src/policy — the whole point of this module is
 * that the same seed produces the same shift, byte for byte, forever.
 */
export interface Rng {
  /** Returns a float in [0, 1). */
  next(): number;
}

/** mulberry32 — small, fast, good-enough statistical quality for gameplay RNG. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Integer in [min, maxExclusive). */
export function randomInt(rng: Rng, min: number, maxExclusive: number): number {
  return min + Math.floor(rng.next() * (maxExclusive - min));
}

/** Picks an index from a list of non-negative weights, proportional to weight. */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) {
    throw new Error('weightedIndex: weights must sum to a positive number.');
  }
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i] ?? 0;
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/** Exponential inter-arrival sample for a Poisson arrival process. */
export function exponentialSample(rng: Rng, meanRate: number): number {
  const u = Math.max(rng.next(), Number.EPSILON);
  return -Math.log(u) / meanRate;
}

/** True with the given probability in [0, 1]. */
export function chance(rng: Rng, probability: number): boolean {
  return rng.next() < probability;
}
