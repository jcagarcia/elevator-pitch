/**
 * Dev tool for tuning the live morale meter (levels/liveScore.ts): steps a
 * level tick by tick under a few policies (including a deliberately broken
 * one) and prints how morale evolves, so LIVE_MORALE_FAIL_THRESHOLD and the
 * penalty weights can be sanity-checked without opening the app.
 */
import { LEVEL_01_MORNING_RUSH } from '../src/levels/level01-morning-rush';
import { computeLiveMorale, LIVE_MORALE_FAIL_THRESHOLD } from '../src/levels/liveScore';
import { createPolicyDispatch } from '../src/policy/ruleEngine';
import { NAIVE_FCFS_PRESET, SCAN_PRESET } from '../src/policy/presets';
import type { DispatchPolicy } from '../src/policy/types';
import { TICK_RATE } from '../src/sim/config';
import { initLiveSim, isLiveSimFinished, stepLiveSim } from '../src/sim/simulate';

const BROKEN_POLICY: DispatchPolicy = {
  name: 'Broken (no rules)',
  parameters: { ...SCAN_PRESET.parameters },
  rules: [], // no rule ever matches -> car never moves, everyone waits forever
};

function run(name: string, dispatch: ReturnType<typeof createPolicyDispatch>): void {
  const level = LEVEL_01_MORNING_RUSH;
  const sim = initLiveSim({
    building: { floors: level.floors, carCount: level.carCount, capacityPerCar: level.capacityPerCar },
    seed: level.seed,
    durationTicks: level.durationTicks,
    passengerGenSpec: level.passengerGenSpec,
  });

  console.log(`\n=== ${name} ===`);
  let failedAtTick: number | null = null;
  while (!isLiveSimFinished(sim)) {
    stepLiveSim(sim, dispatch);
    const morale = computeLiveMorale(sim.state);
    if (sim.state.tick % (10 * TICK_RATE) === 0) {
      console.log(`  t=${(sim.state.tick / TICK_RATE).toFixed(0)}s morale=${morale}`);
    }
    if (morale < LIVE_MORALE_FAIL_THRESHOLD && failedAtTick === null) {
      failedAtTick = sim.state.tick;
      console.log(`  *** would FAIL at t=${(sim.state.tick / TICK_RATE).toFixed(1)}s (morale=${morale}) ***`);
      break;
    }
  }
  if (failedAtTick === null) console.log('  never failed — completed the full shift');
}

run('SCAN (should survive comfortably)', createPolicyDispatch(SCAN_PRESET));
run('Naive FCFS (mediocre, should not unfairly fail)', createPolicyDispatch(NAIVE_FCFS_PRESET));
run('Broken policy (should fail, and not instantly)', createPolicyDispatch(BROKEN_POLICY));
