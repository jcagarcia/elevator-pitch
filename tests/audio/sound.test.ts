import { afterEach, describe, expect, it } from 'vitest';
import { isSoundEnabled, playDelivered, playGaveUp, setSoundEnabled } from '../../src/audio/sound';

describe('sound', () => {
  afterEach(() => {
    setSoundEnabled(false);
  });

  it('defaults to disabled', () => {
    expect(isSoundEnabled()).toBe(false);
  });

  it('reflects setSoundEnabled', () => {
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
  });

  it('never touches AudioContext while disabled (safe in non-browser environments)', () => {
    expect(isSoundEnabled()).toBe(false);
    expect(() => playDelivered()).not.toThrow();
    expect(() => playGaveUp()).not.toThrow();
  });
});
