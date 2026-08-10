import type { DispatchDecision, DispatchStrategy } from '../sim/dispatch';
import { hallCallKey, passengerDirection, type Car, type Direction, type SimState } from '../sim/types';
import { ACTIONS, CONDITIONS } from './catalog';
import type { DispatchContext, DispatchPolicy, FocusCall } from './types';

/** Builds the hall-call list a car is allowed to consider for one decision:
 *  waiting passengers grouped by (floor, direction), filtered by
 *  lookaheadFloors, acceptReverseDirectionPickup, and calls already claimed
 *  by a different car (the two-car "don't both answer the same call" fix). */
function buildHallCalls(car: Car, state: SimState, policy: DispatchPolicy): FocusCall[] {
  const groups = new Map<string, { floor: number; direction: 'up' | 'down'; passengerIds: number[]; oldestSpawnTick: number }>();

  for (const passenger of state.passengers) {
    if (passenger.state !== 'waiting') continue;
    const direction = passengerDirection(passenger);

    if (Math.abs(passenger.originFloor - car.position) > policy.parameters.lookaheadFloors) continue;
    if (!policy.parameters.acceptReverseDirectionPickup && car.committedDirection !== 'idle' && direction !== car.committedDirection) {
      continue;
    }

    const key = hallCallKey(passenger.originFloor, direction);
    const claimedBy = state.claimedCalls.get(key);
    if (claimedBy !== undefined && claimedBy !== car.id) continue;

    const existing = groups.get(key);
    if (existing) {
      existing.passengerIds.push(passenger.id);
      existing.oldestSpawnTick = Math.min(existing.oldestSpawnTick, passenger.spawnTick);
    } else {
      groups.set(key, {
        floor: passenger.originFloor,
        direction,
        passengerIds: [passenger.id],
        oldestSpawnTick: passenger.spawnTick,
      });
    }
  }

  return [...groups.values()];
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
      const hallCalls = buildHallCalls(car, state, policy);
      const ctx: DispatchContext = { car, state, building: state.building, policy, hallCalls };

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
        if (decision.targetFloor !== null) claimCallsAtFloor(state, car.id, hallCalls, decision.targetFloor);

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
