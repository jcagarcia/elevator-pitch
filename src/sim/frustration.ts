import {
  CROWDING_BASE,
  CROWDING_OCCUPANCY_THRESHOLD,
  DETOUR_STOP_PENALTY,
  DOOR_REOPEN_PENALTY,
  FRUSTRATION_ANGRY_MAX,
  FRUSTRATION_ANNOYED_MAX,
  FRUSTRATION_CALM_MAX,
  GIVE_UP_THRESHOLD,
  HALL_WAIT_BASE,
  HALL_WAIT_EXPONENT,
  HALL_WAIT_KNEE_TICKS,
  IDLE_IN_CAR_BASE,
  IDLE_IN_CAR_RAMP,
  IMPATIENT_TRAIT_MULTIPLIER,
  PASSED_BY_PENALTY,
  RIDE_TIME_BASE,
  VIP_WEIGHT_MULTIPLIER,
  WRONG_DIRECTION_BASE,
} from './config';
import type { FrustrationSource, FrustrationState, Trait } from './types';

/** Hall wait is superlinear: growth is gentle below the knee, then bends
 *  sharply upward — the last 30 seconds hurt far more than the first 30.
 *  Called once per tick with the passenger's total ticks waited so far, so
 *  the per-tick amount itself grows as the wait drags on — that's what
 *  produces the accelerating total without any special-casing. */
export function hallWaitDelta(ticksWaited: number): number {
  const ratio = ticksWaited / HALL_WAIT_KNEE_TICKS;
  return HALL_WAIT_BASE * Math.pow(Math.max(ratio, 0), HALL_WAIT_EXPONENT);
}

export function rideTimeDelta(): number {
  return RIDE_TIME_BASE;
}

export function detourStopPenalty(): number {
  return DETOUR_STOP_PENALTY;
}

export function wrongDirectionDelta(floorsMovedWrongWay: number): number {
  return WRONG_DIRECTION_BASE * floorsMovedWrongWay;
}

export function passedByPenalty(): number {
  return PASSED_BY_PENALTY;
}

export function doorReopenPenalty(): number {
  return DOOR_REOPEN_PENALTY;
}

export function crowdingDelta(occupancy: number, capacity: number): number {
  const occupancyRatio = occupancy / capacity;
  const over = occupancyRatio - CROWDING_OCCUPANCY_THRESHOLD;
  return over > 0 ? CROWDING_BASE * over * capacity : 0;
}

export function idleInCarDelta(stalledTicks: number): number {
  return IDLE_IN_CAR_BASE + IDLE_IN_CAR_RAMP * stalledTicks;
}

/** Combines trait effects into a single multiplier for a given source.
 *  Impatient passengers feel waiting and stalling more acutely; VIPs count
 *  every source at 10x weight in the score, regardless of how it felt to
 *  them. */
export function traitMultiplier(traits: readonly Trait[], source: FrustrationSource): number {
  let multiplier = 1;
  if (traits.includes('impatient') && (source === 'hallWait' || source === 'idleInCar')) {
    multiplier *= IMPATIENT_TRAIT_MULTIPLIER;
  }
  if (traits.includes('vip')) {
    multiplier *= VIP_WEIGHT_MULTIPLIER;
  }
  return multiplier;
}

export function frustrationState(frustration: number): FrustrationState {
  if (frustration >= GIVE_UP_THRESHOLD) return 'gave-up';
  if (frustration >= FRUSTRATION_ANGRY_MAX) return 'furious';
  if (frustration >= FRUSTRATION_ANNOYED_MAX) return 'angry';
  if (frustration >= FRUSTRATION_CALM_MAX) return 'annoyed';
  return 'calm';
}
