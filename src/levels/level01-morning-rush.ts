import { TICK_RATE } from '../sim/config';
import type { LevelDef } from './types';

export const LEVEL_01_MORNING_RUSH: LevelDef = {
  id: 'morning-rush',
  name: 'Morning Rush',
  briefing:
    'Building opens at 8:00. Nearly everyone boards at the lobby and rides up. ' +
    'Tune the dispatch policy so the lobby queue does not become a mob scene.',
  floors: 10,
  carCount: 1,
  capacityPerCar: 8,
  seed: 101,
  durationTicks: 6 * 60 * TICK_RATE,
  passengerGenSpec: {
    meanArrivalsPerMinute: 8,
    originFloorWeights: [20, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    destinationBias: 'up',
    traitChances: { impatient: 0.1 },
  },
  starThresholds: { one: 500, two: 700, three: 850 },
  unlocks: {
    conditions: ['always', 'car-empty', 'direction-uncommitted', 'has-waiting-call'],
    actions: ['go-to-nearest-call', 'go-to-oldest-call', 'serve-first-boarded', 'continue-sweep', 'serve-onboard-only'],
  },
};
