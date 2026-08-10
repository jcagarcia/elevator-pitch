/**
 * Every tunable constant in the simulation lives here, named and commented.
 * This file gets rebalanced constantly — nothing below should be considered
 * final. Keep new constants here rather than inlining magic numbers anywhere
 * else in src/sim or src/policy.
 */

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Fixed simulation timestep. The renderer interpolates between ticks; the
 *  sim itself never reads wall-clock time. */
export const TICK_RATE = 20;

// ---------------------------------------------------------------------------
// Physics — car movement
// ---------------------------------------------------------------------------

/** Cruise speed, in floors per tick. ~2 floors/sec. */
export const MAX_SPEED_FLOORS_PER_TICK = 0.1;

/** Acceleration ramp, in floors per tick^2. Reaches max speed in ~1s (20 ticks). */
export const ACCEL_FLOORS_PER_TICK2 = 0.005;

/** Deceleration ramp. Symmetric with acceleration — no dramatic braking. */
export const DECEL_FLOORS_PER_TICK2 = 0.005;

/** How close (in floors) the car must be to a target, at near-zero velocity,
 *  to be considered "arrived" and snapped to the exact floor. Without this
 *  the kinematic approach asymptotically approaches but never exactly hits
 *  the target. */
export const ARRIVAL_EPSILON_FLOORS = 0.002;
export const ARRIVAL_EPSILON_VELOCITY = 0.002;

// ---------------------------------------------------------------------------
// Physics — doors and dwell
// ---------------------------------------------------------------------------

/** Ticks for doors to go from closed to fully open. 0.8s. */
export const DOOR_OPEN_TICKS = 16;

/** Ticks for doors to go from open to fully closed. 0.8s. */
export const DOOR_CLOSE_TICKS = 16;

/** Doors must stay open at least this long even if nobody boards/alights —
 *  this is the *base* dwell; the policy parameter minDoorDwellTicks can only
 *  raise it, never lower it below this floor. 0.5s. */
export const BASE_MIN_DOOR_DWELL_TICKS = 10;

/** Extra dwell added per passenger who boards or alights during a stop, on
 *  top of the base dwell (they overlap: dwell = max(minDwell, sum of these)).
 *  This is what makes "skip the stop" a real optimization — moving past a
 *  floor is cheap, but stopping costs at minimum ~1.3s plus ~0.3s per rider
 *  handled there. 0.3s per passenger. */
export const BOARD_ALIGHT_TICKS_PER_PASSENGER = 6;

/** Heavy/luggage passengers take longer to get through the doors. */
export const HEAVY_TRAIT_DWELL_MULTIPLIER = 1.8;

// ---------------------------------------------------------------------------
// Frustration — hall wait (superlinear: the last stretch hurts far more
// than the first). frustration/tick = HALL_WAIT_BASE * (ticksWaited / HALL_WAIT_KNEE) ^ HALL_WAIT_EXP
// ---------------------------------------------------------------------------

export const HALL_WAIT_BASE = 0.02;
/** "Knee" of the curve, in ticks (30s). Below this, growth is gentle. */
export const HALL_WAIT_KNEE_TICKS = 30 * TICK_RATE;
/** Exponent controlling how sharply the curve bends upward past the knee. */
export const HALL_WAIT_EXPONENT = 2.2;

// ---------------------------------------------------------------------------
// Frustration — ride time (mild, linear)
// ---------------------------------------------------------------------------

export const RIDE_TIME_BASE = 0.01;

// ---------------------------------------------------------------------------
// Frustration — detour stop (flat, per stop, while aboard and it isn't yours)
// ---------------------------------------------------------------------------

export const DETOUR_STOP_PENALTY = 3;

// ---------------------------------------------------------------------------
// Frustration — wrong direction (the most hated event; scales with distance
// travelled away from the passenger's destination)
// ---------------------------------------------------------------------------

export const WRONG_DIRECTION_BASE = 4;

// ---------------------------------------------------------------------------
// Frustration — passed by (car had room, skipped a compatible waiting call)
// ---------------------------------------------------------------------------

export const PASSED_BY_PENALTY = 8;

// ---------------------------------------------------------------------------
// Frustration — doors reopened on the same floor (small, comedic)
// ---------------------------------------------------------------------------

export const DOOR_REOPEN_PENALTY = 0.5;

// ---------------------------------------------------------------------------
// Frustration — crowding (small, ambient, once at/near capacity)
// ---------------------------------------------------------------------------

/** Fraction of capacity above which crowding starts to register. */
export const CROWDING_OCCUPANCY_THRESHOLD = 0.75;
export const CROWDING_BASE = 0.05;

// ---------------------------------------------------------------------------
// Frustration — idle in car (doors closed, not moving, rises quickly)
// ---------------------------------------------------------------------------

export const IDLE_IN_CAR_BASE = 0.1;
/** How much the idle penalty ramps per additional consecutive stalled tick. */
export const IDLE_IN_CAR_RAMP = 0.02;

// ---------------------------------------------------------------------------
// Frustration — traits
// ---------------------------------------------------------------------------

/** Impatient passengers accrue hall-wait and idle-in-car frustration faster. */
export const IMPATIENT_TRAIT_MULTIPLIER = 1.5;
/** VIPs aren't more easily annoyed — they just count 10x when it happens. */
export const VIP_WEIGHT_MULTIPLIER = 10;

// ---------------------------------------------------------------------------
// Frustration — state buckets (visible to the player as passenger color)
// ---------------------------------------------------------------------------

/** Frustration state bands. Below CALM_MAX: calm. [CALM_MAX, ANNOYED_MAX):
 *  annoyed. [ANNOYED_MAX, ANGRY_MAX): angry. [ANGRY_MAX, GIVE_UP_THRESHOLD):
 *  furious. At or above GIVE_UP_THRESHOLD the passenger gives up and takes
 *  the stairs — that gap (80 to 150) is deliberately wide so "furious" is a
 *  real, visible stage the player has time to react to before anyone leaves. */
export const FRUSTRATION_CALM_MAX = 15;
export const FRUSTRATION_ANNOYED_MAX = 40;
export const FRUSTRATION_ANGRY_MAX = 80;
export const GIVE_UP_THRESHOLD = 150;

// ---------------------------------------------------------------------------
// Dispatch defaults (policy parameter starting points, see policy/types.ts)
// ---------------------------------------------------------------------------

export const DEFAULT_LOOKAHEAD_FLOORS = 5;
export const DEFAULT_DIRECTION_COMMIT_THRESHOLD = 1;
export const DEFAULT_MIN_DOOR_DWELL_TICKS = BASE_MIN_DOOR_DWELL_TICKS;
export const DEFAULT_CAPACITY_RESERVE = 0;
