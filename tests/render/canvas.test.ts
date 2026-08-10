import { describe, expect, it } from 'vitest';
import { computeGeometry } from '../../src/render/canvas';

describe('computeGeometry', () => {
  it('splits the shaft evenly across car lanes', () => {
    const geometry = computeGeometry(1000, 500, 10, 2);
    expect(geometry.floorHeight).toBeCloseTo(50, 5);
    expect(geometry.carLaneWidth * geometry.carCount).toBeCloseTo(geometry.shaftWidth, 5);
  });

  it('leaves room to the right of the shaft for waiting-passenger dots', () => {
    const geometry = computeGeometry(1000, 500, 10, 1);
    expect(geometry.shaftWidth).toBeLessThan(geometry.width);
  });

  it('orders the hallway and stairwell lanes left to right without overlap', () => {
    const geometry = computeGeometry(1000, 500, 10, 1);
    expect(geometry.hallwayX).toBe(geometry.shaftWidth);
    expect(geometry.stairwellX).toBeGreaterThan(geometry.hallwayX);
    expect(geometry.stairwellX).toBeLessThan(geometry.width);
  });
});
