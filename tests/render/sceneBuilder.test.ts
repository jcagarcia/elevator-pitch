import { describe, expect, it } from 'vitest';
import { FRUSTRATION_ANGRY_MAX, FRUSTRATION_ANNOYED_MAX, FRUSTRATION_CALM_MAX, GIVE_UP_THRESHOLD } from '../../src/sim/config';
import { buildFloorScenes, frustrationToProgress, GAVE_UP_EXIT_GRACE_TICKS, ridersOfCar } from '../../src/render/sceneBuilder';
import { emptyFrustrationBySource, type Passenger } from '../../src/sim/types';

function makePax(overrides: Partial<Passenger> & { id: number; originFloor: number }): Passenger {
  return {
    destFloor: overrides.originFloor + 1,
    spawnTick: 0,
    traits: [],
    state: 'waiting',
    frustration: 0,
    frustrationBySource: emptyFrustrationBySource(),
    carId: null,
    boardedTick: null,
    deliveredTick: null,
    gaveUpTick: null,
    stalledTicks: 0,
    ...overrides,
  };
}

describe('frustrationToProgress', () => {
  it('maps 0 to calm (0)', () => {
    expect(frustrationToProgress(0)).toBe(0);
  });

  it('maps each band boundary onto the matching integer stage', () => {
    expect(frustrationToProgress(FRUSTRATION_CALM_MAX)).toBeCloseTo(1, 5);
    expect(frustrationToProgress(FRUSTRATION_ANNOYED_MAX)).toBeCloseTo(2, 5);
    expect(frustrationToProgress(FRUSTRATION_ANGRY_MAX)).toBeCloseTo(3, 5);
    expect(frustrationToProgress(GIVE_UP_THRESHOLD)).toBeCloseTo(4, 5);
  });

  it('interpolates within a band', () => {
    const mid = FRUSTRATION_CALM_MAX / 2;
    const progress = frustrationToProgress(mid);
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(1);
  });

  it('clamps above the give-up threshold to 4', () => {
    expect(frustrationToProgress(GIVE_UP_THRESHOLD + 500)).toBe(4);
  });

  it('is monotonically non-decreasing', () => {
    let prev = frustrationToProgress(0);
    for (let f = 5; f <= GIVE_UP_THRESHOLD + 20; f += 5) {
      const cur = frustrationToProgress(f);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });
});

describe('buildFloorScenes', () => {
  const frustrationAt = (passengers: Passenger[]) => (id: number) => passengers.find((p) => p.id === id)?.frustration ?? 0;

  it('places a waiting passenger on their floor with showDial true', () => {
    const passengers = [makePax({ id: 0, originFloor: 2, frustration: 10 })];
    const scenes = buildFloorScenes(passengers, 5, 0, frustrationAt(passengers));
    expect(scenes[2]!.showDial).toBe(true);
    expect(scenes[2]!.waiting).toHaveLength(1);
    expect(scenes[0]!.showDial).toBe(false);
  });

  it('sorts waiting passengers worst-first and reports the worst as worstProgress/worstDestFloor', () => {
    const passengers = [
      makePax({ id: 0, originFloor: 1, destFloor: 9, frustration: 5 }),
      makePax({ id: 1, originFloor: 1, destFloor: 4, frustration: 50 }),
    ];
    const scenes = buildFloorScenes(passengers, 3, 0, frustrationAt(passengers));
    expect(scenes[1]!.waiting.map((w) => w.id)).toEqual([1, 0]);
    expect(scenes[1]!.worstProgress).toBeCloseTo(frustrationToProgress(50), 5);
    expect(scenes[1]!.worstDestFloor).toBe(4);
  });

  it('reports worstDestFloor as null when there is no dial to anchor it to', () => {
    const scenes = buildFloorScenes([], 3, 0, () => 0);
    expect(scenes[1]!.showDial).toBe(false);
    expect(scenes[1]!.worstDestFloor).toBeNull();
  });

  it('excludes riding, delivered, and not-yet-spawned passengers', () => {
    const passengers = [
      makePax({ id: 0, originFloor: 1, state: 'riding', boardedTick: 0, carId: 0 }),
      makePax({ id: 1, originFloor: 1, state: 'delivered', boardedTick: 0, deliveredTick: 0, carId: 0 }),
      makePax({ id: 2, originFloor: 1, spawnTick: 10 }),
    ];
    const scenes = buildFloorScenes(passengers, 3, 5, frustrationAt(passengers));
    expect(scenes[1]!.waiting).toEqual([]);
  });

  it('keeps a passenger who just gave up as an exiting entry, worst progress', () => {
    const passengers = [makePax({ id: 0, originFloor: 1, destFloor: 6, state: 'gave-up', gaveUpTick: 100, frustration: GIVE_UP_THRESHOLD })];
    const scenes = buildFloorScenes(passengers, 3, 105, frustrationAt(passengers));
    expect(scenes[1]!.waiting).toEqual([{ id: 0, progress: 4, exiting: true, destFloor: 6 }]);
    // A give-up-only floor has nobody left actually waiting, so no dial.
    expect(scenes[1]!.showDial).toBe(false);
  });

  it('drops a given-up passenger once the exit grace window has elapsed', () => {
    const passengers = [makePax({ id: 0, originFloor: 1, state: 'gave-up', gaveUpTick: 100 })];
    const scenes = buildFloorScenes(passengers, 3, 100 + GAVE_UP_EXIT_GRACE_TICKS, frustrationAt(passengers));
    expect(scenes[1]!.waiting).toEqual([]);
  });
});

describe('ridersOfCar', () => {
  it('includes only passengers currently riding the given car, with their destination', () => {
    const passengers = [
      makePax({ id: 0, originFloor: 0, destFloor: 8, state: 'riding', carId: 0, boardedTick: 0, frustration: 20 }),
      makePax({ id: 1, originFloor: 0, state: 'riding', carId: 1, boardedTick: 0 }),
      makePax({ id: 2, originFloor: 0, state: 'delivered', carId: 0, boardedTick: 0, deliveredTick: 1 }),
    ];
    const frustrationAt = (id: number) => passengers.find((p) => p.id === id)?.frustration ?? 0;
    const riders = ridersOfCar(passengers, 0, 5, frustrationAt);
    expect(riders.map((r) => r.id)).toEqual([0]);
    expect(riders[0]!.progress).toBeCloseTo(frustrationToProgress(20), 5);
    expect(riders[0]!.destFloor).toBe(8);
  });
});
