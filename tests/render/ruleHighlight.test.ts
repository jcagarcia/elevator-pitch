import { describe, expect, it } from 'vitest';
import { groupRuleFiredByCar, ruleFiredPulseAt } from '../../src/render/ruleHighlight';
import type { SimEvent } from '../../src/sim/types';

const events: SimEvent[] = [
  { type: 'spawn', tick: 0, passengerId: 0, floor: 0 },
  { type: 'rule-fired', tick: 5, carId: 0, ruleId: 'rule-a', targetFloor: 3 },
  { type: 'rule-fired', tick: 5, carId: 1, ruleId: 'rule-x', targetFloor: 9 },
  { type: 'rule-fired', tick: 40, carId: 0, ruleId: 'rule-b', targetFloor: 7 },
  { type: 'rule-fired', tick: 90, carId: 1, ruleId: 'rule-y', targetFloor: 0 },
  { type: 'rule-fired', tick: 120, carId: 0, ruleId: null, targetFloor: null },
];

describe('groupRuleFiredByCar / ruleFiredPulseAt', () => {
  const byCar = groupRuleFiredByCar(events);

  it('separates rule-fired events per car in chronological order', () => {
    expect(byCar.get(0)?.map((e) => e.ruleId)).toEqual(['rule-a', 'rule-b', null]);
    expect(byCar.get(1)?.map((e) => e.ruleId)).toEqual(['rule-x', 'rule-y']);
  });

  it('returns null before any rule has fired for that car', () => {
    expect(ruleFiredPulseAt(byCar.get(0), 2, 10)).toBeNull();
  });

  it('returns the rule while inside its pulse window', () => {
    expect(ruleFiredPulseAt(byCar.get(0), 5, 10)).toBe('rule-a');
    expect(ruleFiredPulseAt(byCar.get(0), 14, 10)).toBe('rule-a');
  });

  it('returns null once the pulse window has elapsed, even with no newer firing', () => {
    expect(ruleFiredPulseAt(byCar.get(0), 15, 10)).toBeNull();
    expect(ruleFiredPulseAt(byCar.get(0), 39, 10)).toBeNull();
  });

  it('picks up the next firing once it happens', () => {
    expect(ruleFiredPulseAt(byCar.get(0), 40, 10)).toBe('rule-b');
    expect(ruleFiredPulseAt(byCar.get(0), 49, 10)).toBe('rule-b');
    expect(ruleFiredPulseAt(byCar.get(0), 50, 10)).toBeNull();
  });

  it('treats a fall-through (null ruleId) decision as nothing to highlight', () => {
    expect(ruleFiredPulseAt(byCar.get(0), 120, 10)).toBeNull();
  });

  it('is independent per car', () => {
    expect(ruleFiredPulseAt(byCar.get(1), 90, 10)).toBe('rule-y');
    expect(ruleFiredPulseAt(byCar.get(1), 4, 10)).toBeNull();
  });

  it('returns null for a car with no rule-fired events at all', () => {
    expect(ruleFiredPulseAt(byCar.get(2), 100, 10)).toBeNull();
  });

  it('defaults its window to RULE_FIRED_PULSE_TICKS when not given one', () => {
    expect(ruleFiredPulseAt(byCar.get(0), 5)).toBe('rule-a');
    expect(ruleFiredPulseAt(byCar.get(0), 39)).toBeNull();
  });
});
