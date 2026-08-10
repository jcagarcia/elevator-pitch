import { describe, expect, it } from 'vitest';
import { activeRuleIdAt, groupRuleFiredByCar } from '../../src/render/ruleHighlight';
import type { SimEvent } from '../../src/sim/types';

const events: SimEvent[] = [
  { type: 'spawn', tick: 0, passengerId: 0, floor: 0 },
  { type: 'rule-fired', tick: 5, carId: 0, ruleId: 'rule-a', targetFloor: 3 },
  { type: 'rule-fired', tick: 5, carId: 1, ruleId: 'rule-x', targetFloor: 9 },
  { type: 'rule-fired', tick: 40, carId: 0, ruleId: 'rule-b', targetFloor: 7 },
  { type: 'rule-fired', tick: 90, carId: 1, ruleId: 'rule-y', targetFloor: 0 },
];

describe('groupRuleFiredByCar / activeRuleIdAt', () => {
  const byCar = groupRuleFiredByCar(events);

  it('separates rule-fired events per car in chronological order', () => {
    expect(byCar.get(0)?.map((e) => e.ruleId)).toEqual(['rule-a', 'rule-b']);
    expect(byCar.get(1)?.map((e) => e.ruleId)).toEqual(['rule-x', 'rule-y']);
  });

  it('returns null before any rule has fired for that car', () => {
    expect(activeRuleIdAt(byCar.get(0), 2)).toBeNull();
  });

  it('returns the most recent rule at or before the given tick', () => {
    expect(activeRuleIdAt(byCar.get(0), 5)).toBe('rule-a');
    expect(activeRuleIdAt(byCar.get(0), 39)).toBe('rule-a');
    expect(activeRuleIdAt(byCar.get(0), 40)).toBe('rule-b');
    expect(activeRuleIdAt(byCar.get(0), 10_000)).toBe('rule-b');
  });

  it('is independent per car', () => {
    expect(activeRuleIdAt(byCar.get(1), 40)).toBe('rule-x');
    expect(activeRuleIdAt(byCar.get(1), 90)).toBe('rule-y');
  });

  it('returns null for a car with no rule-fired events at all', () => {
    expect(activeRuleIdAt(byCar.get(2), 100)).toBeNull();
  });
});
