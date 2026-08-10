import type { SimResult } from '../sim/simulate';
import { frustrationState } from '../sim/frustration';
import { passengerStateAtTick, type CarFrame, type FrustrationState } from '../sim/types';

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
}

export function computeGeometry(width: number, height: number, floors: number, carCount: number): RenderGeometry {
  return {
    width,
    height,
    floors,
    carCount,
    floorHeight: height / floors,
    shaftWidth: width * 0.62,
    carLaneWidth: (width * 0.62) / carCount,
  };
}

/**
 * Draws one frame of the shift at a (possibly fractional) playhead tick.
 * Pure imperative canvas drawing — never called from a React render; the
 * caller drives this from its own animation loop.
 */
export function drawShift(ctx: CanvasRenderingContext2D, result: SimResult, geometry: RenderGeometry, playheadTick: number): void {
  const { width, height, floors, carCount, floorHeight, shaftWidth, carLaneWidth } = geometry;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#15181c';
  ctx.fillRect(0, 0, width, height);

  drawFloorGrid(ctx, floors, floorHeight, shaftWidth);

  const tickA = Math.max(0, Math.floor(playheadTick));
  const tickB = Math.min(tickA + 1, result.frames.length - 1);
  const fraction = playheadTick - tickA;
  const framesA = frameAt(result, tickA);
  const framesB = frameAt(result, tickB);

  for (let carIndex = 0; carIndex < carCount; carIndex++) {
    const a = framesA[carIndex];
    const b = framesB[carIndex];
    if (!a) continue;
    const position = b ? lerp(a.position, b.position, fraction) : a.position;
    drawCar(ctx, result, a, position, carIndex, carLaneWidth, floorHeight, height, tickA);
  }

  drawWaitingPassengers(ctx, result, tickA, shaftWidth, width, floorHeight, height);
}

function drawFloorGrid(ctx: CanvasRenderingContext2D, floors: number, floorHeight: number, shaftWidth: number): void {
  ctx.strokeStyle = '#33383f';
  ctx.fillStyle = '#8a939c';
  ctx.font = '11px ui-monospace, monospace';
  ctx.lineWidth = 1;
  for (let floor = 0; floor < floors; floor++) {
    const y = ctx.canvas.height - (floor + 1) * floorHeight;
    ctx.strokeRect(0.5, y + 0.5, shaftWidth, floorHeight);
    ctx.fillText(String(floor).padStart(2, '0'), 4, y + floorHeight - 4);
  }
  ctx.strokeStyle = '#20242a';
  ctx.beginPath();
  ctx.moveTo(shaftWidth, 0);
  ctx.lineTo(shaftWidth, ctx.canvas.height);
  ctx.stroke();
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

function drawCar(
  ctx: CanvasRenderingContext2D,
  result: SimResult,
  frame: CarFrame,
  position: number,
  carIndex: number,
  carLaneWidth: number,
  floorHeight: number,
  canvasHeight: number,
  tick: number,
): void {
  const x = carIndex * carLaneWidth;
  const y = canvasHeight - (position + 1) * floorHeight;
  const padding = 4;
  const carWidth = carLaneWidth - padding * 2;
  const carHeight = floorHeight - padding * 2;

  ctx.fillStyle = '#3f6fa8';
  ctx.fillRect(x + padding, y + padding, carWidth, carHeight);

  // The door gap is drawn as a shallow notch top/bottom rather than a full
  // vertical cut, so a car with doors open still reads as one solid car
  // (an interior seam), not two separate boxes either side of a hole.
  const doorGapWidth = doorOpenFraction(frame.doorState) * carWidth * 0.5;
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
  for (const passengerId of frame.passengerIds) {
    const history = result.frustrationHistory[passengerId];
    const frustration = history ? (history[tick] ?? 0) : 0;
    ctx.fillStyle = FRUSTRATION_COLORS[frustrationState(frustration)];
    ctx.beginPath();
    ctx.arc(dotX, dotY, 3.5, 0, Math.PI * 2);
    ctx.fill();
    dotX += 9;
    if (dotX > x + carLaneWidth - padding) break;
  }
}

function drawWaitingPassengers(
  ctx: CanvasRenderingContext2D,
  result: SimResult,
  tick: number,
  shaftWidth: number,
  canvasWidth: number,
  floorHeight: number,
  canvasHeight: number,
): void {
  const columns = Math.max(1, Math.floor((canvasWidth - shaftWidth) / 11));
  const perFloorCount = new Map<number, number>();

  for (const passenger of result.passengers) {
    if (passengerStateAtTick(passenger, tick) !== 'waiting') continue;
    const count = perFloorCount.get(passenger.originFloor) ?? 0;
    perFloorCount.set(passenger.originFloor, count + 1);

    const history = result.frustrationHistory[passenger.id];
    const frustration = history ? (history[tick] ?? 0) : 0;
    const y = canvasHeight - (passenger.originFloor + 0.5) * floorHeight;
    const x = shaftWidth + 8 + (count % columns) * 11;

    ctx.fillStyle = FRUSTRATION_COLORS[frustrationState(frustration)];
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
