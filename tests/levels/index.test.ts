import { describe, expect, it } from 'vitest';
import { cumulativeUnlocksThrough, getLevel, isLevelUnlocked, LEVELS } from '../../src/levels';

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

describe('isLevelUnlocked', () => {
  it('level 1 is always unlocked, even with no progress at all', () => {
    expect(isLevelUnlocked('morning-rush', {})).toBe(true);
  });

  it('a later level is locked until the previous one has at least one star', () => {
    expect(isLevelUnlocked('evening-down-peak', {})).toBe(false);
    expect(isLevelUnlocked('evening-down-peak', { 'morning-rush': { stars: 0 } })).toBe(false);
    expect(isLevelUnlocked('evening-down-peak', { 'morning-rush': { stars: 1 } })).toBe(true);
    expect(isLevelUnlocked('evening-down-peak', { 'morning-rush': { stars: 3 } })).toBe(true);
  });

  it('stars on other levels do not unlock a level whose immediate predecessor is uncleared', () => {
    // 3 stars on level 1, but level 3 needs level 2 cleared, not level 1.
    expect(isLevelUnlocked('lunch-scatter', { 'morning-rush': { stars: 3 } })).toBe(false);
    expect(
      isLevelUnlocked('lunch-scatter', {
        'morning-rush': { stars: 3 },
        'evening-down-peak': { stars: 1 },
      }),
    ).toBe(true);
  });

  it('an unknown level id is treated as unlocked (defensive default, matches cumulativeUnlocksThrough)', () => {
    expect(isLevelUnlocked('does-not-exist', {})).toBe(true);
  });
});
