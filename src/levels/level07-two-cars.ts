import { TICK_RATE } from '../sim/config';
import type { LevelDef } from './types';

export const LEVEL_07_TWO_CARS: LevelDef = {
  id: 'two-cars',
  name: 'Two Cars',
  briefing:
    'A second car goes into service today. The dispatcher already keeps both cars off the same ' +
    'call — your job is making sure they cover the building instead of clustering on top of each other.',
  floors: 12,
  carCount: 2,
  capacityPerCar: 8,
  seed: 707,
  durationTicks: 6 * 60 * TICK_RATE,
  passengerGenSpec: {
    meanArrivalsPerMinute: 14,
    originFloorWeights: [8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    destinationBias: 'none',
    traitChances: { impatient: 0.12 },
  },
  starThresholds: { one: 500, two: 700, three: 850 },
  unlocks: {
    conditions: [],
    actions: [],
  },
};
