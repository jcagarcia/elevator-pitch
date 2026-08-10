import { describe, expect, it } from 'vitest';
import { StairwellAnimator } from '../../src/render/stairwellAnimator';
import type { SimEvent } from '../../src/sim/types';

const gaveUp = (tick: number, passengerId: number, floor: number): SimEvent => ({ type: 'gave-up', tick, passengerId, floor });
const other = (tick: number): SimEvent => ({ type: 'board', tick, passengerId: 0, carId: 0, floor: 0 });

describe('StairwellAnimator', () => {
  it('ignores events other than gave-up', () => {
    const animator = new StairwellAnimator();
    animator.addFromEvents([other(0)], 0);
    expect(animator.getActiveWalkers(0)).toEqual([]);
  });

  it('adds a walker at progress 0 the moment a gave-up event arrives', () => {
    const animator = new StairwellAnimator();
    animator.addFromEvents([gaveUp(0, 1, 5)], 1000);
    const walkers = animator.getActiveWalkers(1000);
    expect(walkers).toEqual([{ originFloor: 5, progress: 0 }]);
  });

  it('progress advances toward 1 as time passes, then the walker is pruned', () => {
    // A walker is dropped once its walk duration elapses (see the next
    // test), so progress reaching exactly 1 while still present isn't a
    // reachable state — near 1 (and invisible via the fade in
    // drawStairwellWalkers) is what actually happens instead.
    const animator = new StairwellAnimator();
    animator.addFromEvents([gaveUp(0, 1, 5)], 1000);
    expect(animator.getActiveWalkers(1900)[0]!.progress).toBeCloseTo(0.5, 1);
    expect(animator.getActiveWalkers(2799)[0]!.progress).toBeGreaterThan(0.99);
    expect(animator.getActiveWalkers(10_000)).toEqual([]);
  });

  it('drops a walker once its walk duration has elapsed', () => {
    const animator = new StairwellAnimator();
    animator.addFromEvents([gaveUp(0, 1, 5)], 1000);
    expect(animator.getActiveWalkers(1000).length).toBe(1);
    expect(animator.getActiveWalkers(10_000).length).toBe(0);
  });

  it('tracks multiple simultaneous walkers independently', () => {
    const animator = new StairwellAnimator();
    animator.addFromEvents([gaveUp(0, 1, 2), gaveUp(0, 2, 7)], 0);
    const walkers = animator.getActiveWalkers(0);
    expect(walkers.map((w) => w.originFloor).sort()).toEqual([2, 7]);
  });

  it('reset clears all walkers immediately', () => {
    const animator = new StairwellAnimator();
    animator.addFromEvents([gaveUp(0, 1, 5)], 0);
    animator.reset();
    expect(animator.getActiveWalkers(0)).toEqual([]);
  });
});
