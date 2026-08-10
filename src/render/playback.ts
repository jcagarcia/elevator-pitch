import { TICK_RATE } from '../sim/config';

export interface PlaybackDriverOptions {
  durationTicks: number;
  getIsPlaying: () => boolean;
  getSpeed: () => number;
  /** Called every animation frame with the current (possibly fractional) playhead tick. */
  onTick: (tick: number) => void;
  /** Called once when playback reaches the last tick while playing. */
  onEnd: () => void;
}

/**
 * Owns the requestAnimationFrame loop and advances a playhead through an
 * already-computed SimResult. This is the only place wall-clock time enters
 * the picture — it drives how fast the playhead moves, never what the
 * simulation computed. Framework-free by design so it can't accidentally
 * couple playback speed to React's render cycle.
 */
export class PlaybackDriver {
  private rafHandle: number | null = null;
  private lastTimestamp: number | null = null;
  private tick = 0;

  constructor(private readonly options: PlaybackDriverOptions) {}

  start(): void {
    if (this.rafHandle !== null) return;
    this.lastTimestamp = null;
    const loop = (timestamp: number): void => {
      if (this.lastTimestamp === null) this.lastTimestamp = timestamp;
      const deltaSeconds = (timestamp - this.lastTimestamp) / 1000;
      this.lastTimestamp = timestamp;

      const maxTick = Math.max(0, this.options.durationTicks - 1);
      if (this.options.getIsPlaying()) {
        const next = this.tick + deltaSeconds * TICK_RATE * this.options.getSpeed();
        if (next >= maxTick) {
          this.tick = maxTick;
          this.options.onTick(this.tick);
          this.options.onEnd();
        } else {
          this.tick = next;
          this.options.onTick(this.tick);
        }
      } else {
        this.options.onTick(this.tick);
      }

      this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  seek(tick: number): void {
    const maxTick = Math.max(0, this.options.durationTicks - 1);
    this.tick = Math.max(0, Math.min(tick, maxTick));
  }

  currentTick(): number {
    return this.tick;
  }
}
