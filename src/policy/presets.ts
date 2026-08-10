import {
  DEFAULT_CAPACITY_RESERVE,
  DEFAULT_DIRECTION_COMMIT_THRESHOLD,
  DEFAULT_MIN_DOOR_DWELL_TICKS,
} from '../sim/config';
import type { DispatchPolicy, Rule } from './types';

function rule(id: string, conditions: Rule['conditions'], action: Rule['action']): Rule {
  return { id, enabled: true, conditions, action };
}

/**
 * Serve calls in the order they arrived: go straight to whoever's been
 * waiting longest when empty, and never so much as glance at a hall call
 * while carrying someone. Distance, direction, and who gets passed along
 * the way are irrelevant to this policy — that's the point. Terrible, and
 * instructive: every other preset should measurably beat it.
 */
export const NAIVE_FCFS_PRESET: DispatchPolicy = {
  name: 'Naive FCFS',
  parameters: {
    lookaheadFloors: Infinity,
    directionCommitThreshold: DEFAULT_DIRECTION_COMMIT_THRESHOLD,
    minDoorDwellTicks: DEFAULT_MIN_DOOR_DWELL_TICKS,
    acceptReverseDirectionPickup: true,
    capacityReserve: DEFAULT_CAPACITY_RESERVE,
    idleParkingFloor: null,
  },
  rules: [
    rule('fcfs-go-to-oldest', [{ id: 'car-empty', params: {} }], { id: 'go-to-oldest-call', params: {} }),
    rule('fcfs-serve-riders', [{ id: 'always', params: {} }], { id: 'serve-first-boarded', params: {} }),
  ],
};

/**
 * The classic elevator algorithm: sweep to the top, sweep to the bottom,
 * serving every compatible call along the way. Only reverses once it
 * physically reaches the end of the shaft, even if nothing's left ahead —
 * that's what SCAN means, and what LOOK fixes.
 */
export const SCAN_PRESET: DispatchPolicy = {
  name: 'SCAN',
  parameters: {
    lookaheadFloors: Infinity,
    directionCommitThreshold: DEFAULT_DIRECTION_COMMIT_THRESHOLD,
    minDoorDwellTicks: DEFAULT_MIN_DOOR_DWELL_TICKS,
    acceptReverseDirectionPickup: false,
    capacityReserve: DEFAULT_CAPACITY_RESERVE,
    idleParkingFloor: null,
  },
  rules: [
    rule('scan-start', [{ id: 'car-empty', params: {} }, { id: 'has-waiting-call', params: {} }], {
      id: 'go-to-nearest-call',
      params: {},
    }),
    rule('scan-reverse-at-end', [{ id: 'at-direction-terminal', params: {} }], { id: 'reverse-sweep', params: {} }),
    rule('scan-continue', [{ id: 'always', params: {} }], { id: 'continue-sweep', params: {} }),
  ],
};

/**
 * Like SCAN, but reverses as soon as nothing is left ahead in the current
 * direction instead of riding all the way to the end of the shaft first.
 */
export const LOOK_PRESET: DispatchPolicy = {
  name: 'LOOK',
  parameters: {
    lookaheadFloors: Infinity,
    directionCommitThreshold: DEFAULT_DIRECTION_COMMIT_THRESHOLD,
    minDoorDwellTicks: DEFAULT_MIN_DOOR_DWELL_TICKS,
    acceptReverseDirectionPickup: false,
    capacityReserve: DEFAULT_CAPACITY_RESERVE,
    idleParkingFloor: null,
  },
  rules: [
    rule('look-start', [{ id: 'car-empty', params: {} }, { id: 'has-waiting-call', params: {} }], {
      id: 'go-to-nearest-call',
      params: {},
    }),
    rule('look-reverse-early', [{ id: 'nothing-ahead-in-direction', params: {} }], { id: 'reverse-sweep', params: {} }),
    rule('look-continue', [{ id: 'always', params: {} }], { id: 'continue-sweep', params: {} }),
  ],
};

export const PRESETS: readonly DispatchPolicy[] = [NAIVE_FCFS_PRESET, SCAN_PRESET, LOOK_PRESET];
