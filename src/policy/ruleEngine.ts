import { FAULTY_SENSOR_CYCLE_TICKS, FAULTY_SENSOR_VISIBLE_TICKS } from '../sim/config';
import type { DispatchDecision, DispatchStrategy } from '../sim/dispatch';
import { hallCallKey, passengerDirection, type Car, type Direction, type SimState } from '../sim/types';
import { ACTIONS, CONDITIONS } from './catalog';
import type { DispatchContext, DispatchPolicy, FocusCall } from './types';

function isSensorVisible(tick: number): boolean {
  return tick % FAULTY_SENSOR_CYCLE_TICKS < FAULTY_SENSOR_VISIBLE_TICKS;
}

type CallGroup = { floor: number; direction: 'up' | 'down'; passengerIds: number[]; oldestSpawnTick: number };

/** Groups every currently-waiting passenger into hall calls by (floor,
 *  direction), filtered only by the two-car claim — the one filter that
 *  applies unconditionally, since two cars answering the same call is a
 *  bug, not a tunable. This is DispatchContext.allHallCalls. */
function buildAllHallCalls(car: Car, state: SimState): CallGroup[] {
  const groups = new Map<string, CallGroup>();
  for (const passenger of state.passengers) {
    if (passenger.state !== 'waiting') continue;
    const direction = passengerDirection(passenger);
    const key = hallCallKey(passenger.originFloor, direction);
    const claimedBy = state.claimedCalls.get(key);
    if (claimedBy !== undefined && claimedBy !== car.id) continue;

    const existing = groups.get(key);
    if (existing) {
      existing.passengerIds.push(passenger.id);
      existing.oldestSpawnTick = Math.min(existing.oldestSpawnTick, passenger.spawnTick);
    } else {
      groups.set(key, { floor: passenger.originFloor, direction, passengerIds: [passenger.id], oldestSpawnTick: passenger.spawnTick });
    }
  }
  return [...groups.values()];
}

/** Filters allHallCalls down to what this car is actually allowed to see
 *  for this decision: lookaheadFloors, acceptReverseDirectionPickup, and a
 *  faulty sensor's duty cycle. This is DispatchContext.hallCalls — what
 *  every condition and action except 'call-waited-longer-than' should use. */
function filterVisibleHallCalls(car: Car, state: SimState, policy: DispatchPolicy, allCalls: readonly CallGroup[]): FocusCall[] {
  // acceptReverseDirectionPickup=false protects riders already aboard from
  // an opposite-direction detour — it has nothing to protect once the car
  // is empty. Without this, a car that just finished a 'down' sweep stays
  // permanently blind to 'down' calls the instant it commits to 'up' while
  // idle-empty, since nothing else ever resets committedDirection back to
  // 'idle'. Confirmed by hand: on a scenario where every passenger wants
  // the same direction, a policy-driven SCAN car reduced to delivering 3
  // of 57 passengers before this fix.
  const directionIsProtected = car.passengers.length > 0;

  return allCalls.filter((call) => {
    if (Math.abs(call.floor - car.position) > policy.parameters.lookaheadFloors) return false;
    if (
      directionIsProtected &&
      !policy.parameters.acceptReverseDirectionPickup &&
      car.committedDirection !== 'idle' &&
      call.direction !== car.committedDirection
    ) {
      return false;
    }
    if (state.building.faultyHallSensorFloors.includes(call.floor) && !isSensorVisible(state.tick)) return false;
    return true;
  });
}

function releaseClaimsFor(state: SimState, carId: number): void {
  for (const [key, holder] of state.claimedCalls) {
    if (holder === carId) state.claimedCalls.delete(key);
  }
}

function claimCallsAtFloor(state: SimState, carId: number, hallCalls: readonly FocusCall[], targetFloor: number): void {
  for (const call of hallCalls) {
    if (call.floor === targetFloor) {
      state.claimedCalls.set(hallCallKey(call.floor, call.direction), carId);
    }
  }
}

/**
 * Turns a DispatchPolicy (parameters + ordered rules) into the
 * DispatchStrategy interface simulate.ts already knows how to call. Rules
 * are evaluated top down; the first rule whose conditions all match decides
 * the target. No match falls back to the policy's idle parking floor.
 */
export function createPolicyDispatch(policy: DispatchPolicy): DispatchStrategy {
  return {
    name: policy.name,

    decideNextTarget(car: Car, state: SimState): DispatchDecision {
      releaseClaimsFor(state, car.id);
      const allHallCalls = buildAllHallCalls(car, state);
      const hallCalls = filterVisibleHallCalls(car, state, policy, allHallCalls);
      const ctx: DispatchContext = { car, state, building: state.building, policy, hallCalls, allHallCalls };

      for (const rule of policy.rules) {
        if (!rule.enabled) continue;

        let focus: FocusCall | undefined;
        let allMatched = true;
        for (const condition of rule.conditions) {
          const def = CONDITIONS[condition.id];
          const result = def.evaluate(ctx, condition.params);
          if (!result.matched) {
            allMatched = false;
            break;
          }
          if (result.focus) focus = result.focus;
        }
        if (!allMatched) continue;

        const actionDef = ACTIONS[rule.action.id];
        const decision = actionDef.evaluate(ctx, rule.action.params, focus ?? null);
        if (decision.committedDirection) car.committedDirection = decision.committedDirection;
        if (decision.targetFloor !== null) claimCallsAtFloor(state, car.id, allHallCalls, decision.targetFloor);

        return { targetFloor: decision.targetFloor, ruleId: rule.id };
      }

      const parkFloor = policy.parameters.idleParkingFloor;
      if (parkFloor !== null && Math.abs(parkFloor - car.position) > 1e-3) {
        car.committedDirection = (parkFloor > car.position ? 'up' : 'down') as Direction;
        return { targetFloor: parkFloor, ruleId: null };
      }

      car.committedDirection = 'idle';
      return { targetFloor: null, ruleId: null };
    },

    effectiveCapacity(car: Car): number {
      return Math.max(1, Math.floor(car.capacity * (1 - policy.parameters.capacityReserve)));
    },

    minDoorDwellTicks(): number {
      return policy.parameters.minDoorDwellTicks;
    },
  };
}
