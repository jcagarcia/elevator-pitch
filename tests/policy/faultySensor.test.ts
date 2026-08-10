import { describe, expect, it } from 'vitest';
import { createPolicyDispatch } from '../../src/policy/ruleEngine';
import type { DispatchPolicy } from '../../src/policy/types';
import { FAULTY_SENSOR_CYCLE_TICKS, FAULTY_SENSOR_VISIBLE_TICKS } from '../../src/sim/config';
import { DEFAULT_CAPACITY_RESERVE, DEFAULT_DIRECTION_COMMIT_THRESHOLD, DEFAULT_MIN_DOOR_DWELL_TICKS } from '../../src/sim/config';
import { makeCar, makePassenger, makeState } from './fixtures';

const FAULTY_FLOOR = 4;

const POLICY: DispatchPolicy = {
  name: 'test-timeout-override',
  parameters: {
    lookaheadFloors: Infinity,
    directionCommitThreshold: DEFAULT_DIRECTION_COMMIT_THRESHOLD,
    minDoorDwellTicks: DEFAULT_MIN_DOOR_DWELL_TICKS,
    acceptReverseDirectionPickup: true,
    capacityReserve: DEFAULT_CAPACITY_RESERVE,
    idleParkingFloor: null,
  },
  rules: [
    {
      id: 'timeout-override',
      enabled: true,
      conditions: [{ id: 'call-waited-longer-than', params: { seconds: 20 } }],
      action: { id: 'treat-as-highest-priority', params: {} },
    },
    {
      id: 'normal-pickup',
      enabled: true,
      conditions: [{ id: 'has-waiting-call', params: {} }],
      action: { id: 'go-to-nearest-call', params: {} },
    },
  ],
};

describe('faulty hall sensor', () => {
  it('hides a call at the faulty floor from normal pickup during the invisible part of the duty cycle', () => {
    const car = makeCar({ position: 0 });
    // Tick chosen inside the "invisible" window of the duty cycle.
    const invisibleTick = FAULTY_SENSOR_VISIBLE_TICKS + 1;
    const passenger = makePassenger({ id: 0, originFloor: FAULTY_FLOOR, destFloor: 9, spawnTick: 0 });
    const state = makeState([car], [passenger], invisibleTick, [FAULTY_FLOOR]);

    const decision = createPolicyDispatch(POLICY).decideNextTarget(car, state);

    // Not waited long enough yet for the timeout override, and the normal
    // pickup rule can't see it during the invisible window.
    expect(decision.targetFloor).toBeNull();
  });

  it('reveals the call to normal pickup during the visible part of the duty cycle', () => {
    const car = makeCar({ position: 0 });
    const visibleTick = 5;
    expect(visibleTick % FAULTY_SENSOR_CYCLE_TICKS).toBeLessThan(FAULTY_SENSOR_VISIBLE_TICKS);
    const passenger = makePassenger({ id: 0, originFloor: FAULTY_FLOOR, destFloor: 9, spawnTick: 0 });
    const state = makeState([car], [passenger], visibleTick, [FAULTY_FLOOR]);

    const decision = createPolicyDispatch(POLICY).decideNextTarget(car, state);

    expect(decision.targetFloor).toBe(FAULTY_FLOOR);
    expect(decision.ruleId).toBe('normal-pickup');
  });

  it('the timeout-override rule reaches the call even during the invisible window, once it has waited long enough', () => {
    const car = makeCar({ position: 0 });
    const invisibleTick = FAULTY_SENSOR_VISIBLE_TICKS + 1;
    // Spawned long before invisibleTick — waited well past the 20s threshold.
    const passenger = makePassenger({ id: 0, originFloor: FAULTY_FLOOR, destFloor: 9, spawnTick: 0 });
    const state = makeState([car], [passenger], invisibleTick + 20 * 20, [FAULTY_FLOOR]);

    const decision = createPolicyDispatch(POLICY).decideNextTarget(car, state);

    expect(decision.targetFloor).toBe(FAULTY_FLOOR);
    expect(decision.ruleId).toBe('timeout-override');
  });

  it('without the faulty-floor designation, the same call is visible immediately', () => {
    const car = makeCar({ position: 0 });
    const invisibleTick = FAULTY_SENSOR_VISIBLE_TICKS + 1;
    const passenger = makePassenger({ id: 0, originFloor: FAULTY_FLOOR, destFloor: 9, spawnTick: 0 });
    const state = makeState([car], [passenger], invisibleTick, []); // no faulty floors

    const decision = createPolicyDispatch(POLICY).decideNextTarget(car, state);

    expect(decision.targetFloor).toBe(FAULTY_FLOOR);
    expect(decision.ruleId).toBe('normal-pickup');
  });
});
