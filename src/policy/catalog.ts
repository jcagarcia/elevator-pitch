import { TICK_RATE } from '../sim/config';
import type { Direction, PassengerId } from '../sim/types';
import type {
  ActionEvaluator,
  ActionId,
  ActionParams,
  ConditionEvaluator,
  ConditionId,
  ConditionParams,
  DispatchContext,
  FocusCall,
  TargetDecision,
} from './types';

export interface ConditionDef {
  readonly id: ConditionId;
  readonly label: string;
  readonly defaultParams: ConditionParams;
  readonly evaluate: ConditionEvaluator;
  readonly describe: (params: ConditionParams) => string;
}

export interface ActionDef {
  readonly id: ActionId;
  readonly label: string;
  readonly defaultParams: ActionParams;
  readonly evaluate: ActionEvaluator;
  readonly describe: (params: ActionParams) => string;
}

function directionTo(fromPosition: number, floor: number): Direction {
  if (floor > fromPosition) return 'up';
  if (floor < fromPosition) return 'down';
  return 'idle';
}

function isAhead(floor: number, position: number, direction: Direction): boolean {
  if (direction === 'up') return floor > position;
  if (direction === 'down') return floor < position;
  return false;
}

function nearestCall(position: number, calls: readonly FocusCall[]): FocusCall | null {
  let best: FocusCall | null = null;
  let bestDistance = Infinity;
  for (const call of calls) {
    const distance = Math.abs(call.floor - position);
    if (distance < bestDistance) {
      best = call;
      bestDistance = distance;
    }
  }
  return best;
}

function onboardDestinations(ctx: DispatchContext): number[] {
  const destinations: number[] = [];
  for (const passengerId of ctx.car.passengers) {
    const passenger = findPassenger(ctx, passengerId);
    if (passenger) destinations.push(passenger.destFloor);
  }
  return destinations;
}

function findPassenger(ctx: DispatchContext, id: PassengerId): { destFloor: number } | undefined {
  return ctx.state.passengers.find((p) => p.id === id);
}

/** Nearest stop (hall call or onboard destination) strictly ahead of the car
 *  in `direction`; falls back to the terminal floor in that direction when
 *  nothing is ahead but something still needs service elsewhere in the
 *  building — the classic SCAN "ride to the end anyway" behavior. Returns
 *  null only when there's truly nothing left anywhere, so an idle car
 *  doesn't tour an empty shaft forever bouncing between terminals. Shared by
 *  continue-sweep and reverse-sweep so both actions sweep identically, just
 *  starting from a different direction. */
function sweepTarget(ctx: DispatchContext, direction: Direction): number | null {
  if (direction === 'idle') return null;
  const destinations = onboardDestinations(ctx);
  const candidates = [
    ...ctx.hallCalls.filter((c) => isAhead(c.floor, ctx.car.position, direction)).map((c) => c.floor),
    ...destinations.filter((floor) => isAhead(floor, ctx.car.position, direction)),
  ];
  if (candidates.length > 0) {
    return direction === 'up' ? Math.min(...candidates) : Math.max(...candidates);
  }
  if (ctx.hallCalls.length === 0 && destinations.length === 0) return null;
  return direction === 'up' ? ctx.building.floors - 1 : 0;
}

export const CONDITIONS: Record<ConditionId, ConditionDef> = {
  always: {
    id: 'always',
    label: 'Always',
    defaultParams: {},
    evaluate: () => ({ matched: true }),
    describe: () => 'always',
  },

  'car-empty': {
    id: 'car-empty',
    label: 'Car is empty',
    defaultParams: {},
    evaluate: (ctx) => ({ matched: ctx.car.passengers.length === 0 }),
    describe: () => 'the car is empty',
  },

  'has-waiting-call': {
    id: 'has-waiting-call',
    label: 'There is a waiting call',
    defaultParams: {},
    evaluate: (ctx) => {
      const nearest = nearestCall(ctx.car.position, ctx.hallCalls);
      return nearest ? { matched: true, focus: nearest } : { matched: false };
    },
    describe: () => 'there is a waiting call',
  },

  'traveling-direction': {
    id: 'traveling-direction',
    label: 'Traveling in direction',
    defaultParams: { direction: 'up' },
    evaluate: (ctx, params) => ({ matched: ctx.car.committedDirection === params.direction }),
    describe: (params) => `traveling ${String(params.direction)}`,
  },

  'capacity-at-least': {
    id: 'capacity-at-least',
    label: 'Capacity at least',
    defaultParams: { fraction: 0.8 },
    evaluate: (ctx, params) => {
      const fraction = typeof params.fraction === 'number' ? params.fraction : 0;
      return { matched: ctx.car.passengers.length / ctx.car.capacity >= fraction };
    },
    describe: (params) => `the car is at ${Math.round(Number(params.fraction) * 100)}% capacity`,
  },

  'call-waited-longer-than': {
    id: 'call-waited-longer-than',
    label: 'Call has waited longer than',
    defaultParams: { seconds: 45 },
    evaluate: (ctx, params) => {
      const seconds = typeof params.seconds === 'number' ? params.seconds : 0;
      const thresholdTicks = seconds * TICK_RATE;
      let oldest: FocusCall | null = null;
      for (const call of ctx.hallCalls) {
        if (ctx.state.tick - call.oldestSpawnTick < thresholdTicks) continue;
        if (!oldest || call.oldestSpawnTick < oldest.oldestSpawnTick) oldest = call;
      }
      return oldest ? { matched: true, focus: oldest } : { matched: false };
    },
    describe: (params) => `a call has waited more than ${String(params.seconds)}s`,
  },

  'at-direction-terminal': {
    id: 'at-direction-terminal',
    label: 'At the end of the shaft in this direction',
    defaultParams: {},
    evaluate: (ctx) => {
      const direction = ctx.car.committedDirection;
      if (direction === 'idle') return { matched: false };
      const terminal = direction === 'up' ? ctx.building.floors - 1 : 0;
      return { matched: Math.abs(ctx.car.position - terminal) < 1e-3 };
    },
    describe: () => 'the car is at the end of the shaft',
  },

  'nothing-ahead-in-direction': {
    id: 'nothing-ahead-in-direction',
    label: 'Nothing left ahead in this direction',
    defaultParams: {},
    evaluate: (ctx) => {
      const direction = ctx.car.committedDirection;
      // A car that was never sweeping has nothing to "reverse" out of —
      // treat idle as not-yet-committed rather than as nothing-ahead, or
      // this condition would spuriously kick an idle car into motion.
      if (direction === 'idle') return { matched: false };
      const hasCallAhead = ctx.hallCalls.some((c) => isAhead(c.floor, ctx.car.position, direction));
      const hasDestAhead = onboardDestinations(ctx).some((floor) => isAhead(floor, ctx.car.position, direction));
      return { matched: !hasCallAhead && !hasDestAhead };
    },
    describe: () => 'nothing is left ahead',
  },
};

export const ACTIONS: Record<ActionId, ActionDef> = {
  'go-to-nearest-call': {
    id: 'go-to-nearest-call',
    label: 'Go to the nearest call',
    defaultParams: {},
    evaluate: (ctx, _params, focus): TargetDecision => {
      const call = focus ?? nearestCall(ctx.car.position, ctx.hallCalls);
      if (!call) return { targetFloor: null };
      // Adopt the call's own direction, not the direction of travel to reach
      // it — those differ whenever the call is already at (or the car ends
      // up passing through) the car's current position, and it's the call's
      // direction that determines which way the car sweeps after pickup.
      return { targetFloor: call.floor, committedDirection: call.direction };
    },
    describe: () => 'go to the nearest call',
  },

  'go-to-oldest-call': {
    id: 'go-to-oldest-call',
    label: 'Go to the oldest call',
    defaultParams: {},
    evaluate: (ctx): TargetDecision => {
      let oldest: FocusCall | null = null;
      for (const call of ctx.hallCalls) {
        if (!oldest || call.oldestSpawnTick < oldest.oldestSpawnTick) oldest = call;
      }
      if (!oldest) return { targetFloor: null };
      return { targetFloor: oldest.floor, committedDirection: oldest.direction };
    },
    describe: () => 'go to the call that arrived first',
  },

  'serve-call-ahead': {
    id: 'serve-call-ahead',
    label: 'Serve the next call ahead',
    defaultParams: {},
    evaluate: (ctx): TargetDecision => {
      const direction = ctx.car.committedDirection;
      const ahead = direction === 'idle' ? [] : ctx.hallCalls.filter((c) => isAhead(c.floor, ctx.car.position, direction));
      const target = ahead.length > 0 ? nearestCall(ctx.car.position, ahead) : nearestCall(ctx.car.position, ctx.hallCalls);
      if (!target) return { targetFloor: null };
      return { targetFloor: target.floor, committedDirection: target.direction };
    },
    describe: () => 'serve the next call ahead',
  },

  'continue-sweep': {
    id: 'continue-sweep',
    label: 'Continue the sweep',
    defaultParams: {},
    evaluate: (ctx): TargetDecision => {
      const direction = ctx.car.committedDirection;
      const target = sweepTarget(ctx, direction);
      return target === null ? { targetFloor: null } : { targetFloor: target, committedDirection: direction };
    },
    describe: () => 'continue sweeping in the current direction',
  },

  'reverse-sweep': {
    id: 'reverse-sweep',
    label: 'Reverse and sweep the other way',
    defaultParams: {},
    evaluate: (ctx): TargetDecision => {
      const newDirection: Direction = ctx.car.committedDirection === 'up' ? 'down' : 'up';
      const target = sweepTarget(ctx, newDirection);
      return target === null ? { targetFloor: null, committedDirection: newDirection } : { targetFloor: target, committedDirection: newDirection };
    },
    describe: () => 'reverse direction and continue sweeping',
  },

  'serve-onboard-only': {
    id: 'serve-onboard-only',
    label: 'Serve only current riders (ignore hall calls)',
    defaultParams: {},
    evaluate: (ctx): TargetDecision => {
      const destinations = onboardDestinations(ctx);
      if (destinations.length === 0) return { targetFloor: null };
      const direction = ctx.car.committedDirection;
      const ahead = direction === 'idle' ? [] : destinations.filter((floor) => isAhead(floor, ctx.car.position, direction));
      const pool = ahead.length > 0 ? ahead : destinations;
      const target = pool.reduce((best, floor) => (Math.abs(floor - ctx.car.position) < Math.abs(best - ctx.car.position) ? floor : best));
      return { targetFloor: target, committedDirection: directionTo(ctx.car.position, target) };
    },
    describe: () => 'ignore hall calls and serve current riders only',
  },

  'serve-first-boarded': {
    id: 'serve-first-boarded',
    label: 'Serve whoever boarded first (ignore everyone else)',
    defaultParams: {},
    evaluate: (ctx): TargetDecision => {
      const firstAboardId = ctx.car.passengers[0];
      if (firstAboardId === undefined) return { targetFloor: null };
      const passenger = findPassenger(ctx, firstAboardId);
      if (!passenger) return { targetFloor: null };
      return { targetFloor: passenger.destFloor, committedDirection: directionTo(ctx.car.position, passenger.destFloor) };
    },
    describe: () => 'take the first passenger who boarded straight to their floor, ignoring everyone else aboard or waiting',
  },

  'treat-as-highest-priority': {
    id: 'treat-as-highest-priority',
    label: 'Treat this call as highest priority',
    defaultParams: {},
    evaluate: (_ctx, _params, focus): TargetDecision => {
      if (!focus) return { targetFloor: null };
      return { targetFloor: focus.floor, committedDirection: focus.direction };
    },
    describe: () => 'go serve it immediately',
  },

  'park-at-floor': {
    id: 'park-at-floor',
    label: 'Park at floor',
    defaultParams: { floor: 0 },
    evaluate: (ctx, params): TargetDecision => {
      const floor = typeof params.floor === 'number' ? params.floor : 0;
      return { targetFloor: floor, committedDirection: directionTo(ctx.car.position, floor) };
    },
    describe: (params) => `park at floor ${String(params.floor)}`,
  },
};
