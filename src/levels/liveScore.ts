import type { SimState } from '../sim/types';

/**
 * The live "how's it going right now" meter shown while a shift is
 * running, distinct from computeCompositeScore (scoring.ts), which is an
 * end-of-shift summary. They can't share a formula: composite score's
 * delivered/spawned ratio is meaningless on a tiny early sample — "0 of 1
 * delivered" three seconds into a six-minute shift isn't a policy failure,
 * it's just early — but that same ratio is exactly what makes the
 * end-of-shift score fair. This meter instead tracks only two things that
 * are meaningful *at any moment*: how frustrated the passengers currently
 * in the building are, and how many have already given up and left via
 * the stairs.
 */

export const LIVE_MORALE_MAX = 1000;

/** Below this, the shift is over — the policy just failed live. Tuned so
 *  a handful of give-ups plus a generally fuming building triggers it, not
 *  one unlucky passenger. Rebalance freely; see scripts/check-live-morale.ts. */
export const LIVE_MORALE_FAIL_THRESHOLD = 200;

/** Flat penalty per give-up so far. This is the dominant term on purpose —
 *  give-ups are the visible, dramatic failure (the stairwell animation),
 *  and they never "heal": a passenger who gave up stays counted for the
 *  rest of the shift, unlike the frustration term below. */
const GIVE_UP_PENALTY = 90;

/** Penalty per point of *current* average frustration among passengers
 *  still waiting or riding right now. Deliberately excludes delivered
 *  passengers (their frustration is history, not a live problem) and
 *  isn't normalized by how many have spawned in total, so the meter can
 *  recover as a fixed policy starts actually serving people. */
const ACTIVE_FRUSTRATION_PENALTY_PER_POINT = 4;

export function computeLiveMorale(state: SimState): number {
  let gaveUp = 0;
  let activeCount = 0;
  let activeFrustration = 0;

  for (const passenger of state.passengers) {
    if (passenger.state === 'gave-up') {
      gaveUp++;
    } else if (passenger.state === 'waiting' || passenger.state === 'riding') {
      activeCount++;
      activeFrustration += passenger.frustration;
    }
  }

  const avgActiveFrustration = activeCount > 0 ? activeFrustration / activeCount : 0;
  const raw = LIVE_MORALE_MAX - GIVE_UP_PENALTY * gaveUp - ACTIVE_FRUSTRATION_PENALTY_PER_POINT * avgActiveFrustration;
  return Math.round(Math.max(0, Math.min(LIVE_MORALE_MAX, raw)));
}
