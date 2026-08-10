import { describe, expect, it } from 'vitest';
import { generatePassengers } from '../../src/sim/passengerGenerator';
import { createRng } from '../../src/sim/rng';

describe('generatePassengers forcedPassengers', () => {
  it('merges forced passengers into the roster in spawn-tick order with contiguous ids', () => {
    const rng = createRng(1);
    const passengers = generatePassengers(
      rng,
      {
        meanArrivalsPerMinute: 4,
        forcedPassengers: [{ spawnTick: 500, originFloor: 2, destFloor: 9, traits: ['vip'] }],
      },
      10,
      1200,
    );

    // ids must be exactly 0..n-1 matching array order.
    passengers.forEach((p, index) => expect(p.id).toBe(index));

    // Roster stays sorted by spawnTick throughout, forced passenger included.
    for (let i = 1; i < passengers.length; i++) {
      expect(passengers[i]!.spawnTick).toBeGreaterThanOrEqual(passengers[i - 1]!.spawnTick);
    }

    const vip = passengers.find((p) => p.traits.includes('vip'));
    expect(vip).toBeDefined();
    expect(vip?.spawnTick).toBe(500);
    expect(vip?.originFloor).toBe(2);
    expect(vip?.destFloor).toBe(9);
  });

  it('is deterministic for a given seed', () => {
    const spec = { meanArrivalsPerMinute: 5, forcedPassengers: [{ spawnTick: 100, originFloor: 0, destFloor: 5 }] };
    const a = generatePassengers(createRng(7), spec, 10, 2000);
    const b = generatePassengers(createRng(7), spec, 10, 2000);
    expect(a).toEqual(b);
  });
});
