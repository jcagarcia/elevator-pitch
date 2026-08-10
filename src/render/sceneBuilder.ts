import { FRUSTRATION_ANGRY_MAX, FRUSTRATION_ANNOYED_MAX, FRUSTRATION_CALM_MAX, GIVE_UP_THRESHOLD, TICK_RATE } from '../sim/config';
import { passengerStateAtTick, type CarId, type Passenger, type PassengerId } from '../sim/types';

/**
 * Maps a passenger's raw frustration number onto PassengerFigure's 0-4
 * continuous scale (0 calm, 1 annoyed, 2 angry, 3 furious, 4 gave up) —
 * piecewise-linear across the same band boundaries the frustration state
 * machine itself uses (sim/frustration.ts's frustrationState), so a
 * figure's posture always agrees with the passenger's actual
 * FrustrationState, not a separately-tuned curve.
 */
export function frustrationToProgress(frustration: number): number {
  const bands = [0, FRUSTRATION_CALM_MAX, FRUSTRATION_ANNOYED_MAX, FRUSTRATION_ANGRY_MAX, GIVE_UP_THRESHOLD];
  if (frustration <= 0) return 0;
  for (let i = 1; i < bands.length; i++) {
    const hi = bands[i]!;
    if (frustration <= hi) {
      const lo = bands[i - 1]!;
      const frac = hi > lo ? (frustration - lo) / (hi - lo) : 1;
      return i - 1 + frac;
    }
  }
  return 4;
}

/** How long a passenger who's given up keeps rendering (playing the
 *  give-up exit animation) before disappearing from their floor's wait
 *  area entirely — covers PassengerFigure's 850ms exit transform plus its
 *  250ms opacity delay, with a little slack. Measured in sim ticks (not
 *  wall-clock) so review-phase scrubbing can derive it the same pure way
 *  live play does. */
export const GAVE_UP_EXIT_GRACE_TICKS = Math.round(1.2 * TICK_RATE);

export interface FigurePax {
  readonly id: PassengerId;
  readonly progress: number;
  readonly exiting: boolean;
}

export interface FloorScene {
  readonly showDial: boolean;
  readonly worstProgress: number;
  /** Waiting passengers plus anyone still mid-exit, worst-first — the row
   *  of small figures rendered along the floor's wait area. */
  readonly waiting: readonly FigurePax[];
}

/**
 * Builds the per-floor waiting scene at `tick`, for every floor in
 * [0, floors). A pure function of the passenger roster, the tick, and a
 * frustration lookup — works identically whether `passengers` is a live
 * sim's in-progress roster (frustrationAt reads the live value) or a
 * finished SimResult's roster (frustrationAt reads frustrationHistory),
 * which is what lets both the live and review phases share it.
 */
export function buildFloorScenes(
  passengers: readonly Passenger[],
  floors: number,
  tick: number,
  frustrationAt: (id: PassengerId) => number,
): FloorScene[] {
  const waitingByFloor = new Map<number, FigurePax[]>();
  const worstByFloor = new Map<number, number>();

  for (const passenger of passengers) {
    const state = passengerStateAtTick(passenger, tick);
    if (state === 'waiting') {
      const progress = frustrationToProgress(frustrationAt(passenger.id));
      pushPax(waitingByFloor, passenger.originFloor, { id: passenger.id, progress, exiting: false });
      const worst = worstByFloor.get(passenger.originFloor) ?? 0;
      if (progress > worst) worstByFloor.set(passenger.originFloor, progress);
    } else if (state === 'gave-up' && passenger.gaveUpTick !== null && tick - passenger.gaveUpTick < GAVE_UP_EXIT_GRACE_TICKS) {
      pushPax(waitingByFloor, passenger.originFloor, { id: passenger.id, progress: 4, exiting: true });
    }
  }

  const scenes: FloorScene[] = [];
  for (let floor = 0; floor < floors; floor++) {
    const waiting = (waitingByFloor.get(floor) ?? []).sort((a, b) => b.progress - a.progress);
    const worstProgress = worstByFloor.get(floor) ?? 0;
    scenes.push({ showDial: worstByFloor.has(floor), worstProgress, waiting });
  }
  return scenes;
}

function pushPax(map: Map<number, FigurePax[]>, floor: number, pax: FigurePax): void {
  const list = map.get(floor);
  if (list) list.push(pax);
  else map.set(floor, [pax]);
}

/** Passengers currently riding a given car at `tick`, for the small
 *  no-gauge figures shown between its doors — same pure-function-of-tick
 *  shape as buildFloorScenes, shared by live and review phases. */
export function ridersOfCar(
  passengers: readonly Passenger[],
  carId: CarId,
  tick: number,
  frustrationAt: (id: PassengerId) => number,
): FigurePax[] {
  const riders: FigurePax[] = [];
  for (const passenger of passengers) {
    if (passenger.carId !== carId) continue;
    if (passengerStateAtTick(passenger, tick) !== 'riding') continue;
    riders.push({ id: passenger.id, progress: frustrationToProgress(frustrationAt(passenger.id)), exiting: false });
  }
  return riders;
}
