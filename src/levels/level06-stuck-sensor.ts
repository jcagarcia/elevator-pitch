import { TICK_RATE } from '../sim/config';
import type { LevelDef } from './types';

export const LEVEL_06_STUCK_SENSOR: LevelDef = {
  id: 'stuck-sensor',
  name: 'Stuck Sensor',
  briefing:
    "Floor 5's hall call button is failing intermittently — some calls from that floor " +
    'never reach the dispatcher. A policy that only reacts to calls it can see will never serve it reliably. Add a timeout.',
  floors: 10,
  carCount: 1,
  capacityPerCar: 8,
  seed: 606,
  durationTicks: 6 * 60 * TICK_RATE,
  passengerGenSpec: {
    meanArrivalsPerMinute: 6,
    destinationBias: 'none',
    traitChances: { impatient: 0.15 },
  },
  faultyHallSensorFloors: [5],
  starThresholds: { one: 480, two: 680, three: 830 },
  unlocks: {
    conditions: ['call-waited-longer-than'],
    actions: ['treat-as-highest-priority'],
  },
};
