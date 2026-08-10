import { describe, expect, it } from 'vitest';
import { ruleFiredPulseAt, type RuleFiredEvent } from '../../src/render/ruleHighlight';

function firedAt(tick: number, ruleId: string | null): RuleFiredEvent {
  return { type: 'rule-fired', tick, carId: 0, ruleId, targetFloor: null };
}

const events: RuleFiredEvent[] = [firedAt(5, 'rule-a'), firedAt(40, 'rule-b'), firedAt(120, null)];

describe('ruleFiredPulseAt', () => {
  it('returns null before any rule has fired', () => {
    expect(ruleFiredPulseAt(events, 2, 10)).toBeNull();
  });

  it('returns the rule while inside its pulse window', () => {
    expect(ruleFiredPulseAt(events, 5, 10)).toBe('rule-a');
    expect(ruleFiredPulseAt(events, 14, 10)).toBe('rule-a');
  });

  it('returns null once the pulse window has elapsed, even with no newer firing', () => {
    expect(ruleFiredPulseAt(events, 15, 10)).toBeNull();
    expect(ruleFiredPulseAt(events, 39, 10)).toBeNull();
  });

  it('picks up the next firing once it happens', () => {
    expect(ruleFiredPulseAt(events, 40, 10)).toBe('rule-b');
    expect(ruleFiredPulseAt(events, 49, 10)).toBe('rule-b');
    expect(ruleFiredPulseAt(events, 50, 10)).toBeNull();
  });

  it('treats a fall-through (null ruleId) decision as nothing to highlight', () => {
    expect(ruleFiredPulseAt(events, 120, 10)).toBeNull();
  });

  it('returns null when there are no events at all', () => {
    expect(ruleFiredPulseAt(undefined, 100, 10)).toBeNull();
    expect(ruleFiredPulseAt([], 100, 10)).toBeNull();
  });

  it('defaults its window to RULE_FIRED_PULSE_TICKS when not given one', () => {
    expect(ruleFiredPulseAt(events, 5)).toBe('rule-a');
    expect(ruleFiredPulseAt(events, 39)).toBeNull();
  });
});
