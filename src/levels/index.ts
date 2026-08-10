import type { ActionId, ConditionId } from '../policy/types';
import { LEVEL_01_MORNING_RUSH } from './level01-morning-rush';
import { LEVEL_02_EVENING_DOWN_PEAK } from './level02-evening-down-peak';
import { LEVEL_03_LUNCH_SCATTER } from './level03-lunch-scatter';
import { LEVEL_04_THE_VIP } from './level04-the-vip';
import { LEVEL_05_CAPACITY_CRUNCH } from './level05-capacity-crunch';
import { LEVEL_06_STUCK_SENSOR } from './level06-stuck-sensor';
import { LEVEL_07_TWO_CARS } from './level07-two-cars';
import type { LevelDef } from './types';

export const LEVELS: readonly LevelDef[] = [
  LEVEL_01_MORNING_RUSH,
  LEVEL_02_EVENING_DOWN_PEAK,
  LEVEL_03_LUNCH_SCATTER,
  LEVEL_04_THE_VIP,
  LEVEL_05_CAPACITY_CRUNCH,
  LEVEL_06_STUCK_SENSOR,
  LEVEL_07_TWO_CARS,
];

export function getLevel(id: string): LevelDef | undefined {
  return LEVELS.find((level) => level.id === id);
}

/** Everything unlocked by clearing levels up to and including `levelId`
 *  (levels are unlocked in fixed order — this sums every level at or before
 *  it in LEVELS, not just ones the player has actually starred). */
export function cumulativeUnlocksThrough(levelId: string): { conditions: ConditionId[]; actions: ActionId[] } {
  const index = LEVELS.findIndex((level) => level.id === levelId);
  const upTo = index === -1 ? LEVELS : LEVELS.slice(0, index + 1);

  const conditions = new Set<ConditionId>();
  const actions = new Set<ActionId>();
  for (const level of upTo) {
    for (const c of level.unlocks.conditions) conditions.add(c);
    for (const a of level.unlocks.actions) actions.add(a);
  }
  return { conditions: [...conditions], actions: [...actions] };
}
