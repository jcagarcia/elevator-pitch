import { TICK_RATE } from '../sim/config';
import type { LevelDef } from './types';

export const LEVEL_05_CAPACITY_CRUNCH: LevelDef = {
  id: 'capacity-crunch',
  name: 'Capacity Crunch',
  briefing:
    'One car, more demand than it can carry. Nobody clears this shift with everyone happy — ' +
    'the job is learning to leave people behind gracefully instead of catastrophically.',
  floors: 10,
  carCount: 1,
  capacityPerCar: 6,
  seed: 505,
  durationTicks: 6 * 60 * TICK_RATE,
  passengerGenSpec: {
    meanArrivalsPerMinute: 16,
    originFloorWeights: [12, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    destinationBias: 'up',
    traitChances: { impatient: 0.2, heavy: 0.1 },
  },
  starThresholds: { one: 380, two: 520, three: 650 },
  unlocks: {
    conditions: [],
    actions: [],
  },
};
