import { TICK_RATE } from '../sim/config';
import type { LevelDef } from './types';

export const LEVEL_02_EVENING_DOWN_PEAK: LevelDef = {
  id: 'evening-down-peak',
  name: 'Evening Down-Peak',
  briefing:
    'Building empties at 5:00. Everyone is upstairs and everyone wants down. ' +
    'The policy that cleared Morning Rush was tuned for the opposite traffic — check it still holds.',
  floors: 10,
  carCount: 1,
  capacityPerCar: 8,
  seed: 202,
  durationTicks: 6 * 60 * TICK_RATE,
  passengerGenSpec: {
    meanArrivalsPerMinute: 8,
    originFloorWeights: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    destinationBias: 'down',
    traitChances: { impatient: 0.1 },
  },
  starThresholds: { one: 500, two: 700, three: 850 },
  unlocks: {
    conditions: ['traveling-direction', 'at-direction-terminal'],
    actions: ['serve-call-ahead', 'reverse-sweep'],
  },
};
