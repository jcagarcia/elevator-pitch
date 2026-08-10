import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybackDriver } from '../../src/render/playback';
import { TICK_RATE } from '../../src/sim/config';

/** vitest's node environment has no requestAnimationFrame; this fake driver
 *  lets the test control frame timing manually via advanceFrame(). */
function installFakeRaf(): { advanceFrame: (deltaMs: number) => void } {
  let now = 0;
  let pendingCallback: FrameRequestCallback | null = null;

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pendingCallback = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    pendingCallback = null;
  });

  return {
    advanceFrame(deltaMs: number) {
      now += deltaMs;
      const cb = pendingCallback;
      pendingCallback = null;
      cb?.(now);
    },
  };
}

describe('PlaybackDriver', () => {
  let raf: ReturnType<typeof installFakeRaf>;

  beforeEach(() => {
    raf = installFakeRaf();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not advance the playhead while paused', () => {
    let lastTick = -1;
    const driver = new PlaybackDriver({
      durationTicks: 100,
      getIsPlaying: () => false,
      getSpeed: () => 1,
      onTick: (tick) => (lastTick = tick),
      onEnd: () => {},
    });
    driver.start();
    raf.advanceFrame(0); // first frame just establishes lastTimestamp
    raf.advanceFrame(1000);
    expect(lastTick).toBe(0);
  });

  it('advances the playhead at TICK_RATE * speed ticks per second while playing', () => {
    let lastTick = 0;
    const driver = new PlaybackDriver({
      durationTicks: 10_000,
      getIsPlaying: () => true,
      getSpeed: () => 2,
      onTick: (tick) => (lastTick = tick),
      onEnd: () => {},
    });
    driver.start();
    raf.advanceFrame(0);
    raf.advanceFrame(1000); // 1 simulated second at 2x speed
    expect(lastTick).toBeCloseTo(TICK_RATE * 2, 1);
  });

  it('clamps to the last tick and fires onEnd exactly once', () => {
    let endCount = 0;
    let lastTick = 0;
    const driver = new PlaybackDriver({
      durationTicks: 10,
      getIsPlaying: () => true,
      getSpeed: () => 1,
      onTick: (tick) => (lastTick = tick),
      onEnd: () => endCount++,
    });
    driver.start();
    raf.advanceFrame(0);
    raf.advanceFrame(10_000); // way more than enough to reach the end
    expect(lastTick).toBe(9);
    expect(endCount).toBe(1);
  });

  it('seek clamps into [0, durationTicks - 1]', () => {
    const driver = new PlaybackDriver({
      durationTicks: 50,
      getIsPlaying: () => false,
      getSpeed: () => 1,
      onTick: () => {},
      onEnd: () => {},
    });
    driver.seek(-5);
    expect(driver.currentTick()).toBe(0);
    driver.seek(999);
    expect(driver.currentTick()).toBe(49);
    driver.seek(20);
    expect(driver.currentTick()).toBe(20);
  });
});
