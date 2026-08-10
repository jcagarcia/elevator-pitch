import { computeLiveMorale, LIVE_MORALE_FAIL_THRESHOLD } from '../levels/liveScore';
import { createPolicyDispatch } from '../policy/ruleEngine';
import type { DispatchPolicy } from '../policy/types';
import { TICK_RATE } from '../sim/config';
import { isLiveSimFinished, stepLiveSim, type LiveSim } from '../sim/simulate';
import type { CarFrame, SimEvent } from '../sim/types';

export type LiveRunStatus = 'running' | 'succeeded' | 'failed';

export interface LiveRunOptions {
  sim: LiveSim;
  /** Read fresh every tick — this is the whole mechanism by which editing
   *  the policy while the shift is running takes effect immediately. */
  getPolicy: () => DispatchPolicy;
  getSpeed: () => number;
  getIsPaused: () => boolean;
  /** Called once per simulated tick with that tick's car frames. */
  onFrame: (frame: CarFrame[], tick: number) => void;
  /** Called with only the events newly appended since the last call — for
   *  sound cues, which react to occurrences, not state. */
  onNewEvents: (events: readonly SimEvent[]) => void;
  onMoraleChange: (morale: number) => void;
  onStatusChange: (status: LiveRunStatus) => void;
}

/**
 * Drives a LiveSim forward in real time: a requestAnimationFrame loop that
 * converts elapsed wall-clock time into simulation ticks (scaled by
 * getSpeed()), stepping the sim that many ticks per frame. The dispatch
 * strategy is rebuilt from getPolicy() before every tick, so a rule change
 * lands on the very next tick rather than only on a future re-run.
 * getSpeed/getIsPaused keep the engine itself capable of pause/speed even
 * though the player-facing UI doesn't expose either — the game always
 * calls this with fixed values (1x, never paused).
 */
export class LiveRunController {
  private rafHandle: number | null = null;
  private lastTimestamp: number | null = null;
  private tickAccumulator = 0;
  private status: LiveRunStatus = 'running';
  private lastEventCount = 0;

  constructor(private readonly options: LiveRunOptions) {}

  start(): void {
    if (this.rafHandle !== null) return;
    this.lastTimestamp = null;
    this.rafHandle = requestAnimationFrame(this.loop);
  }

  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  getStatus(): LiveRunStatus {
    return this.status;
  }

  private readonly loop = (timestamp: number): void => {
    if (this.status !== 'running') return;

    if (this.lastTimestamp === null) this.lastTimestamp = timestamp;
    const deltaSeconds = (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;

    if (!this.options.getIsPaused()) {
      this.tickAccumulator += deltaSeconds * TICK_RATE * this.options.getSpeed();

      // Cap how many ticks a single frame can catch up on — a stalled tab
      // regaining focus after minutes away would otherwise replay the
      // entire backlog in one synchronous burst.
      const maxTicksPerFrame = TICK_RATE * 2;
      let ticksThisFrame = 0;

      while (this.tickAccumulator >= 1 && this.status === 'running' && ticksThisFrame < maxTicksPerFrame) {
        if (isLiveSimFinished(this.options.sim)) {
          this.finish('succeeded');
          break;
        }

        this.tickAccumulator -= 1;
        ticksThisFrame++;
        const dispatch = createPolicyDispatch(this.options.getPolicy());
        const frame = stepLiveSim(this.options.sim, dispatch);
        this.options.onFrame(frame, this.options.sim.state.tick);

        const events = this.options.sim.state.events;
        if (events.length > this.lastEventCount) {
          this.options.onNewEvents(events.slice(this.lastEventCount));
          this.lastEventCount = events.length;
        }

        const morale = computeLiveMorale(this.options.sim.state);
        this.options.onMoraleChange(morale);
        if (morale < LIVE_MORALE_FAIL_THRESHOLD) {
          this.finish('failed');
          break;
        }
      }
    }

    if (this.status === 'running') {
      this.rafHandle = requestAnimationFrame(this.loop);
    }
  };

  private finish(status: LiveRunStatus): void {
    this.status = status;
    this.options.onStatusChange(status);
    this.stop();
  }
}
