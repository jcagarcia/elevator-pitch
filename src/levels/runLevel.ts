import type { DispatchStrategy } from '../sim/dispatch';
import { runShift, type SimResult } from '../sim/simulate';
import type { LevelDef } from './types';

/** Runs a level's fixed scenario against a dispatch strategy — the one
 *  place that turns a LevelDef into a ShiftConfig, so every caller (the
 *  app, the level-balance dev script, tests) builds it identically. */
export function runLevel(level: LevelDef, dispatch: DispatchStrategy): SimResult {
  return runShift({
    building: {
      floors: level.floors,
      carCount: level.carCount,
      capacityPerCar: level.capacityPerCar,
      faultyHallSensorFloors: level.faultyHallSensorFloors ?? [],
    },
    seed: level.seed,
    durationTicks: level.durationTicks,
    passengerGenSpec: level.passengerGenSpec,
    dispatch,
  });
}
