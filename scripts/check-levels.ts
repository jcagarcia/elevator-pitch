/**
 * Dev tool for level balancing: runs the three presets against every level
 * and prints delivered/gave-up/composite/stars, so a rebalance (level
 * traffic, star thresholds, scoring constants) can be sanity-checked
 * without opening the app. Run with `npx tsx scripts/check-levels.ts`.
 */
import { LEVELS } from '../src/levels';
import { runLevel } from '../src/levels/runLevel';
import { computeCompositeScore, computeStars } from '../src/levels/scoring';
import { createPolicyDispatch } from '../src/policy/ruleEngine';
import { LOOK_PRESET, NAIVE_FCFS_PRESET, SCAN_PRESET } from '../src/policy/presets';
import { TICK_RATE } from '../src/sim/config';

for (const level of LEVELS) {
  console.log(`\n=== ${level.name} (${level.id}) ===`);
  console.log(`stars: 1=${level.starThresholds.one} 2=${level.starThresholds.two} 3=${level.starThresholds.three}`);
  for (const preset of [NAIVE_FCFS_PRESET, SCAN_PRESET, LOOK_PRESET]) {
    const result = runLevel(level, createPolicyDispatch(preset));
    const composite = computeCompositeScore(result.score);
    const stars = computeStars(composite, level.starThresholds);
    console.log(
      `  ${preset.name.padEnd(12)} composite=${composite.toString().padStart(4)} stars=${stars} ` +
        `delivered=${result.score.delivered}/${result.score.spawned} gaveUp=${result.score.gaveUp} ` +
        `avgWait=${(result.score.averageWaitTicks / TICK_RATE).toFixed(1)}s worstWait=${(result.score.worstWaitTicks / TICK_RATE).toFixed(1)}s`,
    );
  }
}
