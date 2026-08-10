import { TICK_RATE } from '../sim/config';
import type { LevelDef } from './types';

export const LEVEL_03_LUNCH_SCATTER: LevelDef = {
  id: 'lunch-scatter',
  name: 'Lunch Scatter',
  briefing:
    'Midday. Traffic is inter-floor with no dominant direction — the cafeteria on 4, ' +
    'meetings everywhere. A policy tuned for one-way rushes has no obvious advantage here.',
  floors: 10,
  carCount: 1,
  capacityPerCar: 8,
  seed: 303,
  durationTicks: 6 * 60 * TICK_RATE,
  passengerGenSpec: {
    meanArrivalsPerMinute: 7,
    destinationBias: 'none',
    traitChances: { impatient: 0.15, luggage: 0.05 },
  },
  starThresholds: { one: 480, two: 650, three: 800 },
  unlocks: {
    conditions: ['nothing-ahead-in-direction'],
    actions: [],
  },
};
