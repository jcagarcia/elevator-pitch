import type { Building, Car } from './types';

export interface BuildingSpec {
  floors: number;
  carCount: number;
  capacityPerCar: number;
  /** Floor each car starts parked at. Defaults to ground (0). */
  startFloor?: number;
}

export function createBuilding(spec: BuildingSpec): Building {
  const startFloor = spec.startFloor ?? 0;
  const cars: Car[] = [];
  for (let i = 0; i < spec.carCount; i++) {
    cars.push({
      id: i,
      capacity: spec.capacityPerCar,
      position: startFloor,
      velocity: 0,
      direction: 'idle',
      doorState: 'closed',
      doorPhaseTicks: 0,
      doorOpenElapsedTicks: 0,
      requiredDwellTicks: 0,
      passengers: [],
      targetFloor: null,
      lastFloorPassed: startFloor,
    });
  }
  return { floors: spec.floors, cars };
}
