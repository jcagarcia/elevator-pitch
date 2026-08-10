import type { SimResult } from '../sim/simulate';
import { frustrationState } from '../sim/frustration';
import { passengerStateAtTick, type Building, type CarFrame, type FrustrationState, type Passenger } from '../sim/types';

/** Colors are placeholders — Phase 6 does the real visual design pass. This
 *  mapping just needs to make the frustration state legible at a glance,
 *  since it's the game's primary information channel. */
const FRUSTRATION_COLORS: Record<FrustrationState, string> = {
  calm: '#5fb98c',
  annoyed: '#d9c34a',
  angry: '#e0862f',
  furious: '#d33f3f',
  'gave-up': '#5a5a5a',
};

const STAIRWELL_WALKER_COLOR = '#8a8378';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function frameAt(result: SimResult, tick: number): CarFrame[] {
  return result.frames[Math.max(0, Math.min(tick, result.frames.length - 1))] ?? [];
}

export interface RenderGeometry {
  width: number;
  height: number;
  floors: number;
  carCount: number;
  floorHeight: number;
  shaftWidth: number;
  carLaneWidth: number;
  /** Left edge of the waiting-passenger hallway, same as shaftWidth. */
  hallwayX: number;
  /** Left edge of the stairwell lane, where gave-up passengers walk down. */
  stairwellX: number;
}

export function computeGeometry(width: number, height: number, floors: number, carCount: number): RenderGeometry {
  const shaftWidth = width * 0.58;
  const stairwellX = width * 0.86;
  return {
    width,
    height,
    floors,
    carCount,
    floorHeight: height / floors,
    shaftWidth,
    carLaneWidth: shaftWidth / carCount,
    hallwayX: shaftWidth,
    stairwellX,
  };
}

/** A single passenger dot: floor-Y is the caller's job, this just picks
 *  the color and paints the circle. */
function drawPassengerDot(ctx: CanvasRenderingContext2D, x: number, y: number, frustration: number): void {
  ctx.fillStyle = FRUSTRATION_COLORS[frustrationState(frustration)];
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawBackground(ctx: CanvasRenderingContext2D, geometry: RenderGeometry): void {
  ctx.clearRect(0, 0, geometry.width, geometry.height);
  ctx.fillStyle = '#15181c';
  ctx.fillRect(0, 0, geometry.width, geometry.height);
  drawFloorGrid(ctx, geometry);
  drawStairwellBackground(ctx, geometry);
}

function drawFloorGrid(ctx: CanvasRenderingContext2D, geometry: RenderGeometry): void {
  const { floors, floorHeight, shaftWidth, height } = geometry;
  ctx.strokeStyle = '#33383f';
  ctx.fillStyle = '#8a939c';
  ctx.font = '11px ui-monospace, monospace';
  ctx.lineWidth = 1;
  for (let floor = 0; floor < floors; floor++) {
    const y = height - (floor + 1) * floorHeight;
    ctx.strokeRect(0.5, y + 0.5, shaftWidth, floorHeight);
    ctx.fillText(String(floor).padStart(2, '0'), 4, y + floorHeight - 4);
  }
  ctx.strokeStyle = '#20242a';
  ctx.beginPath();
  ctx.moveTo(shaftWidth, 0);
  ctx.lineTo(shaftWidth, height);
  ctx.stroke();
}

/** Decorative zigzag suggesting a staircase — drawn once per frame as part
 *  of the static background, behind whatever walkers are on it. */
function drawStairwellBackground(ctx: CanvasRenderingContext2D, geometry: RenderGeometry): void {
  const { stairwellX, width, height, floors, floorHeight } = geometry;
  ctx.strokeStyle = '#262b31';
  ctx.beginPath();
  ctx.moveTo(stairwellX, 0);
  ctx.lineTo(stairwellX, height);
  ctx.stroke();

  ctx.strokeStyle = '#20242a';
  ctx.lineWidth = 1;
  const laneWidth = width - stairwellX;
  for (let floor = 0; floor < floors; floor++) {
    const yTop = height - (floor + 1) * floorHeight;
    ctx.beginPath();
    ctx.moveTo(stairwellX + 4, yTop + floorHeight - 4);
    ctx.lineTo(stairwellX + laneWidth - 4, yTop + 4);
    ctx.stroke();
  }
}

function doorOpenFraction(doorState: string): number {
  switch (doorState) {
    case 'open':
      return 1;
    case 'opening':
    case 'closing':
      return 0.5;
    default:
      return 0;
  }
}

function drawCarBody(
  ctx: CanvasRenderingContext2D,
  geometry: RenderGeometry,
  position: number,
  carIndex: number,
  doorState: string,
  passengerIds: readonly number[],
  getFrustration: (passengerId: number) => number,
): void {
  const { carLaneWidth, floorHeight, height } = geometry;
  const x = carIndex * carLaneWidth;
  const y = height - (position + 1) * floorHeight;
  const padding = 4;
  const carWidth = carLaneWidth - padding * 2;
  const carHeight = floorHeight - padding * 2;

  ctx.fillStyle = '#3f6fa8';
  ctx.fillRect(x + padding, y + padding, carWidth, carHeight);

  // The door gap is drawn as a shallow notch top/bottom rather than a full
  // vertical cut, so a car with doors open still reads as one solid car
  // (an interior seam), not two separate boxes either side of a hole.
  const doorGapWidth = doorOpenFraction(doorState) * carWidth * 0.5;
  if (doorGapWidth > 0) {
    const notchDepth = carHeight * 0.28;
    ctx.fillStyle = '#15181c';
    ctx.fillRect(x + carLaneWidth / 2 - doorGapWidth, y + padding, doorGapWidth * 2, notchDepth);
    ctx.fillRect(x + carLaneWidth / 2 - doorGapWidth, y + padding + carHeight - notchDepth, doorGapWidth * 2, notchDepth);
  }

  ctx.strokeStyle = '#8fb4de';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + padding + 0.5, y + padding + 0.5, carWidth - 1, carHeight - 1);

  let dotX = x + padding + 8;
  const dotY = y + floorHeight / 2;
  for (const passengerId of passengerIds) {
    drawPassengerDot(ctx, dotX, dotY, getFrustration(passengerId));
    dotX += 9;
    if (dotX > x + carLaneWidth - padding) break;
  }
}

function drawWaitingDots(
  ctx: CanvasRenderingContext2D,
  geometry: RenderGeometry,
  waiting: readonly { originFloor: number; frustration: number }[],
): void {
  const { hallwayX, stairwellX, floorHeight, height } = geometry;
  const columns = Math.max(1, Math.floor((stairwellX - hallwayX) / 11));
  const perFloorCount = new Map<number, number>();

  for (const passenger of waiting) {
    const count = perFloorCount.get(passenger.originFloor) ?? 0;
    perFloorCount.set(passenger.originFloor, count + 1);
    const y = height - (passenger.originFloor + 0.5) * floorHeight;
    const x = hallwayX + 8 + (count % columns) * 11;
    drawPassengerDot(ctx, x, y, passenger.frustration);
  }
}

/**
 * Draws one frame of a precomputed batch result at a (possibly fractional)
 * playhead tick — used by report/replay scrubbing. Pure imperative canvas
 * drawing; never called from a React render.
 */
export function drawShift(ctx: CanvasRenderingContext2D, result: SimResult, geometry: RenderGeometry, playheadTick: number): void {
  drawBackground(ctx, geometry);

  const tickA = Math.max(0, Math.floor(playheadTick));
  const tickB = Math.min(tickA + 1, result.frames.length - 1);
  const fraction = playheadTick - tickA;
  const framesA = frameAt(result, tickA);
  const framesB = frameAt(result, tickB);

  const frustrationAt = (passengerId: number): number => result.frustrationHistory[passengerId]?.[tickA] ?? 0;

  for (let carIndex = 0; carIndex < geometry.carCount; carIndex++) {
    const a = framesA[carIndex];
    const b = framesB[carIndex];
    if (!a) continue;
    const position = b ? lerp(a.position, b.position, fraction) : a.position;
    drawCarBody(ctx, geometry, position, carIndex, a.doorState, a.passengerIds, frustrationAt);
  }

  const waiting = result.passengers
    .filter((p) => passengerStateAtTick(p, tickA) === 'waiting')
    .map((p) => ({ originFloor: p.originFloor, frustration: frustrationAt(p.id) }));
  drawWaitingDots(ctx, geometry, waiting);
}

/**
 * Draws the building with cars parked at the ground floor and nobody
 * aboard or waiting — the "nothing has run yet" state, shown as soon as a
 * level is selected so the viewport reads as a real instrument, not an
 * empty box waiting for you to press a button first.
 */
export function drawIdleShaft(ctx: CanvasRenderingContext2D, geometry: RenderGeometry): void {
  drawBackground(ctx, geometry);
  for (let carIndex = 0; carIndex < geometry.carCount; carIndex++) {
    drawCarBody(ctx, geometry, 0, carIndex, 'closed', [], () => 0);
  }
}

export interface StairwellWalker {
  readonly originFloor: number;
  /** 0 = just gave up, still at their floor. 1 = reached the ground and
   *  should be dropped by the caller. */
  readonly progress: number;
}

/**
 * Draws the building live, straight from the current simulation state —
 * no history array, no interpolation between recorded frames, just "what
 * does it look like right now." This is what the real-time run loop draws
 * every tick; drawShift (above) is only for scrubbing a finished result.
 */
export function drawLiveState(
  ctx: CanvasRenderingContext2D,
  geometry: RenderGeometry,
  building: Building,
  passengers: readonly Passenger[],
  stairwellWalkers: readonly StairwellWalker[] = [],
): void {
  drawBackground(ctx, geometry);

  const passengerById = new Map(passengers.map((p) => [p.id, p]));
  const frustrationAt = (passengerId: number): number => passengerById.get(passengerId)?.frustration ?? 0;

  for (const car of building.cars) {
    drawCarBody(ctx, geometry, car.position, car.id, car.doorState, car.passengers, frustrationAt);
  }

  const waiting = passengers
    .filter((p) => p.state === 'waiting')
    .map((p) => ({ originFloor: p.originFloor, frustration: p.frustration }));
  drawWaitingDots(ctx, geometry, waiting);

  drawStairwellWalkers(ctx, geometry, stairwellWalkers);
}

function drawStairwellWalkers(ctx: CanvasRenderingContext2D, geometry: RenderGeometry, walkers: readonly StairwellWalker[]): void {
  const { stairwellX, width, floorHeight, height } = geometry;
  const laneWidth = width - stairwellX;

  for (const walker of walkers) {
    const startY = height - (walker.originFloor + 0.5) * floorHeight;
    const endY = height - 0.5 * floorHeight;
    const y = lerp(startY, endY, walker.progress);
    const x = stairwellX + laneWidth * 0.5;
    const alpha = walker.progress > 0.8 ? lerp(1, 0, (walker.progress - 0.8) / 0.2) : 1;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = STAIRWELL_WALKER_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}
