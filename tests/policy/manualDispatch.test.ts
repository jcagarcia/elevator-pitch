import { describe, expect, it } from 'vitest';
import { createManualDispatch } from '../../src/policy/manualDispatch';
import type { Car } from '../../src/sim/types';

function makeCar(id: number): Car {
  return {
    id,
    capacity: 8,
    position: 0,
    velocity: 0,
    direction: 'idle',
    committedDirection: 'idle',
    doorState: 'closed',
    doorPhaseTicks: 0,
    doorOpenElapsedTicks: 0,
    requiredDwellTicks: 0,
    passengers: [],
    targetFloor: null,
  };
}

describe('createManualDispatch', () => {
  it('hands back whatever floor consumeTargetFloor returns for that car, with no rule id', () => {
    const dispatch = createManualDispatch((carId) => (carId === 0 ? 5 : null));
    expect(dispatch.decideNextTarget(makeCar(0))).toEqual({ targetFloor: 5, ruleId: null });
    expect(dispatch.decideNextTarget(makeCar(1))).toEqual({ targetFloor: null, ruleId: null });
  });

  it('is a thin pass-through — consumption/one-shot behavior lives in the caller-supplied function', () => {
    let calls = 0;
    const dispatch = createManualDispatch(() => {
      calls++;
      return 3;
    });
    dispatch.decideNextTarget(makeCar(0));
    dispatch.decideNextTarget(makeCar(0));
    expect(calls).toBe(2);
  });

  it('does not implement effectiveCapacity or minDoorDwellTicks, so callers fall back to sim defaults', () => {
    const dispatch = createManualDispatch(() => null);
    expect(dispatch.effectiveCapacity).toBeUndefined();
    expect(dispatch.minDoorDwellTicks).toBeUndefined();
  });
});
