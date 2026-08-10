import { TICK_RATE } from '../sim/config';
import type { ShiftScore } from '../sim/simulate';

/**
 * Composite score constants. Every level's star thresholds are cutoffs on
 * this same 0–1000 scale, so a level author only has to reason about "what
 * score should earn a star here," not re-derive the formula. Rebalance
 * freely — nothing about the sim depends on these values, only the report
 * and star ratings do.
 */

/** Every shift starts from this cushion so a working-but-imperfect policy
 *  doesn't bottom out at zero — zero is reserved for shifts that go badly
 *  wrong, not merely imperfect ones. */
const BASE_SCORE = 450;
/** Up to this many points for delivering every spawned passenger. */
const DELIVERED_WEIGHT = 550;
/** Subtracted per point of *average* frustration per spawned passenger —
 *  this is what mostly separates a good policy from a mediocre one, since
 *  it reflects everyone's experience, not just the worst case. Kept modest
 *  because a give-up passenger's frustration (~150) is already folded into
 *  this average on top of their own flat GIVE_UP_PENALTY below — a higher
 *  weight here would double-penalize give-ups and make the score collapse
 *  to 0 far too easily on any run with more than a handful of them. */
const FRUSTRATION_PENALTY_PER_AVG_POINT = 1.5;
/** Flat penalty per give-up, on top of the (small) share of the frustration
 *  average above — a give-up is a harder failure than being merely very
 *  annoyed, and the score should say so, without needing every other
 *  passenger's experience to also crater the average to make the point. */
const GIVE_UP_PENALTY = 35;
/** Subtracted per second of the single worst wait in the shift. Deliberately
 *  light — it's one data point, not the shift's overall quality. */
const WORST_WAIT_PENALTY_PER_SECOND = 1;

export const COMPOSITE_SCORE_MAX = 1000;

export function computeCompositeScore(score: ShiftScore): number {
  const deliveredRatio = score.spawned > 0 ? score.delivered / score.spawned : 1;
  const avgFrustration = score.spawned > 0 ? score.totalFrustration / score.spawned : 0;
  const worstWaitSeconds = score.worstWaitTicks / TICK_RATE;

  const raw =
    BASE_SCORE +
    DELIVERED_WEIGHT * deliveredRatio -
    FRUSTRATION_PENALTY_PER_AVG_POINT * avgFrustration -
    GIVE_UP_PENALTY * score.gaveUp -
    WORST_WAIT_PENALTY_PER_SECOND * worstWaitSeconds;

  return Math.round(Math.max(0, Math.min(COMPOSITE_SCORE_MAX, raw)));
}

export type StarRating = 0 | 1 | 2 | 3;

export function computeStars(compositeScore: number, thresholds: { one: number; two: number; three: number }): StarRating {
  if (compositeScore >= thresholds.three) return 3;
  if (compositeScore >= thresholds.two) return 2;
  if (compositeScore >= thresholds.one) return 1;
  return 0;
}
