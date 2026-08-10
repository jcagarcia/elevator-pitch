import { ACCEL_FLOORS_PER_TICK2, ARRIVAL_EPSILON_FLOORS, ARRIVAL_EPSILON_VELOCITY, DECEL_FLOORS_PER_TICK2, MAX_SPEED_FLOORS_PER_TICK } from './config';
import type { Car } from './types';

export interface MoveResult {
  /** True if the car reached targetFloor and was snapped/stopped exactly on it this tick. */
  arrived: boolean;
  /** Integer floors whose boundary was crossed this tick without the car stopping there. */
  floorsCrossed: number[];
}

function moveTowardZero(velocity: number, decel: number): number {
  if (velocity > 0) return Math.max(0, velocity - decel);
  if (velocity < 0) return Math.min(0, velocity + decel);
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function floorsCrossedBetween(prevPosition: number, newPosition: number): number[] {
  const crossed: number[] = [];
  if (newPosition > prevPosition) {
    for (let floor = Math.ceil(prevPosition); floor < newPosition; floor++) {
      if (floor > prevPosition) crossed.push(floor);
    }
  } else if (newPosition < prevPosition) {
    for (let floor = Math.floor(prevPosition); floor > newPosition; floor--) {
      if (floor < prevPosition) crossed.push(floor);
    }
  }
  return crossed;
}

/** Advances a car by one tick's worth of kinematics. Only call this when
 *  car.doorState === 'closed' — movement never happens with doors open.
 *
 *  The target-approach step deliberately clamps to the target and zeroes
 *  velocity whenever this tick's move would reach or pass it, rather than
 *  relying solely on an epsilon-distance check after moving. With a small
 *  MAX_SPEED and a small remaining gap, an unclamped accelerate-then-check
 *  approach can overshoot past the epsilon window every tick and oscillate
 *  around the target forever instead of ever landing inside it. */
export function advanceCarPosition(car: Car): MoveResult {
  const prevPosition = car.position;

  if (car.targetFloor === null) {
    car.velocity = moveTowardZero(car.velocity, DECEL_FLOORS_PER_TICK2);
    car.position += car.velocity;
    car.direction = car.velocity === 0 ? 'idle' : car.direction;
    return { arrived: false, floorsCrossed: floorsCrossedBetween(prevPosition, car.position) };
  }

  const remaining = car.targetFloor - car.position;
  if (Math.abs(remaining) <= ARRIVAL_EPSILON_FLOORS && Math.abs(car.velocity) <= ARRIVAL_EPSILON_VELOCITY) {
    car.position = car.targetFloor;
    car.velocity = 0;
    car.direction = 'idle';
    return { arrived: true, floorsCrossed: [] };
  }

  const targetSign = Math.sign(remaining);
  const velocitySign = Math.sign(car.velocity);

  let nextVelocity: number;
  if (velocitySign !== 0 && velocitySign !== targetSign) {
    // Moving the wrong way relative to a newly (re)assigned target — brake first.
    nextVelocity = moveTowardZero(car.velocity, DECEL_FLOORS_PER_TICK2);
  } else {
    const stoppingDistance = (car.velocity * car.velocity) / (2 * DECEL_FLOORS_PER_TICK2);
    if (Math.abs(remaining) <= stoppingDistance) {
      nextVelocity = car.velocity - targetSign * DECEL_FLOORS_PER_TICK2;
      if (Math.sign(nextVelocity) !== 0 && Math.sign(nextVelocity) !== targetSign) nextVelocity = 0;
    } else {
      nextVelocity = clamp(car.velocity + targetSign * ACCEL_FLOORS_PER_TICK2, -MAX_SPEED_FLOORS_PER_TICK, MAX_SPEED_FLOORS_PER_TICK);
    }
  }

  let nextPosition = car.position + nextVelocity;
  const overshot = (targetSign > 0 && nextPosition >= car.targetFloor) || (targetSign < 0 && nextPosition <= car.targetFloor);
  if (overshot) {
    nextPosition = car.targetFloor;
    nextVelocity = 0;
  }

  car.position = nextPosition;
  car.velocity = nextVelocity;
  car.direction = nextVelocity > 0 ? 'up' : nextVelocity < 0 ? 'down' : targetSign > 0 ? 'up' : 'down';

  const floorsCrossed = floorsCrossedBetween(prevPosition, car.position);

  if (overshot) {
    car.direction = 'idle';
    return { arrived: true, floorsCrossed };
  }

  return { arrived: false, floorsCrossed };
}
