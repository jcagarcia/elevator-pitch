import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_MORALE_FAIL_THRESHOLD } from '../../src/levels/liveScore';
import { NAIVE_FCFS_PRESET, SCAN_PRESET } from '../../src/policy/presets';
import { createPolicyDispatch } from '../../src/policy/ruleEngine';
import type { DispatchPolicy } from '../../src/policy/types';
import { LiveRunController } from '../../src/render/liveRun';
import { TICK_RATE } from '../../src/sim/config';
import { initLiveSim } from '../../src/sim/simulate';

function installFakeRaf(): { advanceFrame: (deltaMs: number) => void } {
  let now = 0;
  let pendingCallback: FrameRequestCallback | null = null;

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pendingCallback = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    pendingCallback = null;
  });

  return {
    advanceFrame(deltaMs: number) {
      now += deltaMs;
      const cb = pendingCallback;
      pendingCallback = null;
      cb?.(now);
    },
  };
}

const BROKEN_POLICY: DispatchPolicy = {
  name: 'Broken (no rules)',
  parameters: { ...SCAN_PRESET.parameters },
  rules: [],
};

function makeSim(durationTicks: number) {
  return initLiveSim({
    building: { floors: 10, carCount: 1, capacityPerCar: 8 },
    seed: 42,
    durationTicks,
    passengerGenSpec: {
      meanArrivalsPerMinute: 8,
      originFloorWeights: [10, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      destinationBias: 'up',
      traitChances: { impatient: 0.1 },
    },
  });
}

describe('LiveRunController', () => {
  let raf: ReturnType<typeof installFakeRaf>;

  beforeEach(() => {
    raf = installFakeRaf();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not step while paused', () => {
    let frameCount = 0;
    const controller = new LiveRunController({
      sim: makeSim(1000),
      getDispatch: () => createPolicyDispatch(SCAN_PRESET),
      getSpeed: () => 1,
      getIsPaused: () => true,
      onFrame: () => frameCount++,
      onNewEvents: () => {},
      onMoraleChange: () => {},
      onStatusChange: () => {},
    });
    controller.start();
    raf.advanceFrame(0);
    raf.advanceFrame(1000);
    expect(frameCount).toBe(0);
  });

  it('steps roughly TICK_RATE * speed ticks per second while running', () => {
    let frameCount = 0;
    const controller = new LiveRunController({
      sim: makeSim(10_000),
      getDispatch: () => createPolicyDispatch(SCAN_PRESET),
      getSpeed: () => 2,
      getIsPaused: () => false,
      onFrame: () => frameCount++,
      onNewEvents: () => {},
      onMoraleChange: () => {},
      onStatusChange: () => {},
    });
    controller.start();
    raf.advanceFrame(0);
    raf.advanceFrame(1000); // 1 real second at 2x speed
    expect(frameCount).toBeCloseTo(TICK_RATE * 2, 0);
  });

  it('reads getDispatch() fresh every tick, so switching the underlying policy mid-run changes behavior on the next tick', () => {
    let currentPolicy: DispatchPolicy = BROKEN_POLICY;
    const sim = makeSim(2000);
    const controller = new LiveRunController({
      sim,
      getDispatch: () => createPolicyDispatch(currentPolicy),
      getSpeed: () => 8,
      getIsPaused: () => false,
      onFrame: () => {},
      onNewEvents: () => {},
      onMoraleChange: () => {},
      onStatusChange: () => {},
    });
    controller.start();
    raf.advanceFrame(0);
    raf.advanceFrame(3000); // several seconds under the broken policy
    const positionUnderBrokenPolicy = sim.state.building.cars[0]!.position;
    expect(positionUnderBrokenPolicy).toBe(0); // never moved — no rule ever fires

    currentPolicy = SCAN_PRESET;
    raf.advanceFrame(2000); // now under SCAN
    const ruleFiredAfterSwitch = sim.state.events.some((e) => e.type === 'rule-fired');
    expect(ruleFiredAfterSwitch).toBe(true);
  });

  it('reports succeeded once the sim reaches durationTicks without failing', () => {
    const statuses: string[] = [];
    const controller = new LiveRunController({
      sim: makeSim(40),
      getDispatch: () => createPolicyDispatch(NAIVE_FCFS_PRESET),
      getSpeed: () => 8,
      getIsPaused: () => false,
      onFrame: () => {},
      onNewEvents: () => {},
      onMoraleChange: () => {},
      onStatusChange: (status) => statuses.push(status),
    });
    controller.start();
    raf.advanceFrame(0);
    // Realistic ~16ms frames rather than one giant jump — the controller
    // deliberately caps how many ticks it will catch up on in a single
    // frame (so a backgrounded tab can't replay minutes of backlog
    // instantly), so a single huge advanceFrame() call doesn't drain a
    // long backlog the way it would for a driver with no such cap.
    for (let i = 0; i < 20; i++) raf.advanceFrame(16);
    expect(statuses).toEqual(['succeeded']);
    expect(controller.getStatus()).toBe('succeeded');
  });

  it('reports failed and stops once morale drops below the threshold under a broken policy', () => {
    const statuses: string[] = [];
    const moraleReadings: number[] = [];
    const controller = new LiveRunController({
      sim: makeSim(6 * 60 * TICK_RATE),
      getDispatch: () => createPolicyDispatch(BROKEN_POLICY),
      getSpeed: () => 8,
      getIsPaused: () => false,
      onFrame: () => {},
      onNewEvents: () => {},
      onMoraleChange: (m) => moraleReadings.push(m),
      onStatusChange: (status) => statuses.push(status),
    });
    controller.start();
    raf.advanceFrame(0);
    // ~2950 ticks needed to cross the fail threshold under this policy
    // (confirmed via scripts/check-live-morale.ts); 250ms at 8x speed is
    // exactly the controller's per-frame tick cap, so this is as fast as
    // the capped loop can go without one call spanning multiple frames.
    for (let i = 0; i < 90 && statuses.length === 0; i++) raf.advanceFrame(250);

    expect(statuses).toEqual(['failed']);
    expect(moraleReadings[moraleReadings.length - 1]).toBeLessThan(LIVE_MORALE_FAIL_THRESHOLD);
    expect(controller.getStatus()).toBe('failed');
  });

  it('supports a manual dispatch strategy just as well as a policy one', () => {
    const sim = makeSim(2000);
    let targetFloor: number | null = 7;
    const controller = new LiveRunController({
      sim,
      getDispatch: () => ({
        name: 'manual',
        decideNextTarget: () => {
          const target = targetFloor;
          targetFloor = null;
          return { targetFloor: target, ruleId: null };
        },
      }),
      getSpeed: () => 8,
      getIsPaused: () => false,
      onFrame: () => {},
      onNewEvents: () => {},
      onMoraleChange: () => {},
      onStatusChange: () => {},
    });
    controller.start();
    raf.advanceFrame(0);
    for (let i = 0; i < 20; i++) raf.advanceFrame(250);
    expect(sim.state.building.cars[0]!.position).toBeCloseTo(7, 0);
  });
});
