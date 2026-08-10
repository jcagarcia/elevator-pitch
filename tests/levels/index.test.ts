import { describe, expect, it } from 'vitest';
import { cumulativeUnlocksThrough, getLevel, LEVELS } from '../../src/levels';

describe('LEVELS', () => {
  it('has exactly the seven levels the brief calls for, in a fixed order', () => {
    expect(LEVELS).toHaveLength(7);
    expect(LEVELS.map((l) => l.id)).toEqual([
      'morning-rush',
      'evening-down-peak',
      'lunch-scatter',
      'the-vip',
      'capacity-crunch',
      'stuck-sensor',
      'two-cars',
    ]);
  });

  it('every level has ascending star thresholds', () => {
    for (const level of LEVELS) {
      expect(level.starThresholds.one).toBeLessThan(level.starThresholds.two);
      expect(level.starThresholds.two).toBeLessThan(level.starThresholds.three);
    }
  });

  it('getLevel finds a level by id and returns undefined for an unknown one', () => {
    expect(getLevel('the-vip')?.name).toBe('The VIP');
    expect(getLevel('does-not-exist')).toBeUndefined();
  });
});

describe('cumulativeUnlocksThrough', () => {
  it('accumulates unlocks from every level up to and including the given one', () => {
    const throughLevel2 = cumulativeUnlocksThrough('evening-down-peak');
    expect(throughLevel2.conditions).toEqual(expect.arrayContaining(['car-empty', 'has-waiting-call', 'traveling-direction']));
    expect(throughLevel2.actions).toEqual(expect.arrayContaining(['go-to-nearest-call', 'serve-call-ahead']));
    // Not yet unlocked at level 2:
    expect(throughLevel2.conditions).not.toContain('call-waited-longer-than');
  });

  it('the final level unlocks the entire catalog', () => {
    const everything = cumulativeUnlocksThrough('two-cars');
    expect(everything.conditions).toEqual(
      expect.arrayContaining([
        'always',
        'car-empty',
        'direction-uncommitted',
        'has-waiting-call',
        'traveling-direction',
        'capacity-at-least',
        'call-waited-longer-than',
        'at-direction-terminal',
        'nothing-ahead-in-direction',
      ]),
    );
    expect(everything.actions.length).toBe(9);
  });

  it('an unknown level id unlocks everything, matching a sandbox/no-level context', () => {
    const result = cumulativeUnlocksThrough('unknown');
    expect(result.conditions.length).toBeGreaterThan(0);
  });
});
