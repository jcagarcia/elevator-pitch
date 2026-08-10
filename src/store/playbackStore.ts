import { create } from 'zustand';

export const PLAYBACK_SPEEDS = [1, 2, 4, 8] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

interface PlaybackState {
  isPlaying: boolean;
  speed: PlaybackSpeed;
  /** Fractional tick, updated ~every animation frame by the PlaybackDriver.
   *  UI panels (scrub bar, elapsed-time readout) subscribe to this; the
   *  canvas renderer reads it via the driver directly and never re-renders
   *  through React. */
  currentTick: number;
  /** Which rule fired the currently-in-effect decision for the car the
   *  editor is watching, at currentTick — null if none has fired yet or no
   *  rule matched. Only set when it actually changes (see RunView), so this
   *  doesn't churn on every animation frame. */
  activeRuleId: string | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  setCurrentTick: (tick: number) => void;
  setActiveRuleId: (ruleId: string | null) => void;
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  isPlaying: false,
  speed: 1,
  currentTick: 0,
  activeRuleId: null,
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  toggle: () => set({ isPlaying: !get().isPlaying }),
  setSpeed: (speed) => set({ speed }),
  setCurrentTick: (currentTick) => set({ currentTick }),
  setActiveRuleId: (activeRuleId) => set({ activeRuleId }),
}));
