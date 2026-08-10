import { TICK_RATE } from '../sim/config';
import type { LevelDef } from './types';

export const LEVEL_04_THE_VIP: LevelDef = {
  id: 'the-vip',
  name: 'The VIP',
  briefing:
    'Routine traffic today. Nothing on the manifest says otherwise — but the building ' +
    'sometimes carries someone who counts for a lot more than one passenger. Serve everyone well.',
  floors: 10,
  carCount: 1,
  capacityPerCar: 8,
  seed: 404,
  durationTicks: 6 * 60 * TICK_RATE,
  passengerGenSpec: {
    meanArrivalsPerMinute: 7,
    originFloorWeights: [10, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    destinationBias: 'up',
    traitChances: { impatient: 0.1 },
    forcedPassengers: [{ spawnTick: 3 * 60 * TICK_RATE, originFloor: 1, destFloor: 9, traits: ['vip'] }],
  },
  starThresholds: { one: 480, two: 680, three: 850 },
  unlocks: {
    conditions: ['capacity-at-least'],
    actions: ['park-at-floor'],
  },
};
