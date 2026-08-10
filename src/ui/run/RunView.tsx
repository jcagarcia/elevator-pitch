import { useEffect, useMemo, useRef, useState } from 'react';
import { isSoundEnabled, playDelivered, playGaveUp, setSoundEnabled } from '../../audio/sound';
import { computeGeometry, drawShift } from '../../render/canvas';
import { PlaybackDriver } from '../../render/playback';
import { activeRuleIdAt, groupRuleFiredByCar } from '../../render/ruleHighlight';
import { TICK_RATE } from '../../sim/config';
import type { SimResult } from '../../sim/simulate';
import { PLAYBACK_SPEEDS, usePlaybackStore, type PlaybackSpeed } from '../../store/playbackStore';
import { DotMatrixDisplay } from '../DotMatrixDisplay';

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 480;

function formatTick(tick: number): string {
  const totalSeconds = Math.floor(tick / TICK_RATE);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export interface RunViewProps {
  result: SimResult;
  floors: number;
  carCount: number;
  /** Which car's active rule to report for the live rule highlight. */
  watchedCarId?: number;
}

export function RunView({ result, floors, carCount, watchedCarId = 0 }: RunViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const driverRef = useRef<PlaybackDriver | null>(null);
  const eventIndexRef = useRef(0);
  const geometry = useMemo(() => computeGeometry(CANVAS_WIDTH, CANVAS_HEIGHT, floors, carCount), [floors, carCount]);
  const ruleFiredByCar = useMemo(() => groupRuleFiredByCar(result.events), [result]);
  const [soundOn, setSoundOn] = useState(isSoundEnabled());

  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const speed = usePlaybackStore((s) => s.speed);
  const currentTick = usePlaybackStore((s) => s.currentTick);
  const seekRequestId = usePlaybackStore((s) => s.seekRequestId);
  const { toggle, setSpeed, setCurrentTick } = usePlaybackStore.getState();

  function resyncEventPointer(tick: number): void {
    let i = 0;
    while (i < result.events.length && result.events[i]!.tick <= tick) i++;
    eventIndexRef.current = i;
  }

  function playSoundsUpTo(flooredTick: number): void {
    while (eventIndexRef.current < result.events.length && result.events[eventIndexRef.current]!.tick <= flooredTick) {
      const event = result.events[eventIndexRef.current]!;
      if (isSoundEnabled()) {
        if (event.type === 'delivered') playDelivered();
        else if (event.type === 'gave-up') playGaveUp();
      }
      eventIndexRef.current++;
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    usePlaybackStore.setState({ isPlaying: false, currentTick: 0, activeRuleId: null });
    eventIndexRef.current = 0;
    const watchedCarEvents = ruleFiredByCar.get(watchedCarId);

    const driver = new PlaybackDriver({
      durationTicks: result.frames.length,
      getIsPlaying: () => usePlaybackStore.getState().isPlaying,
      getSpeed: () => usePlaybackStore.getState().speed,
      onTick: (tick) => {
        drawShift(ctx, result, geometry, tick);
        usePlaybackStore.setState({ currentTick: tick });
        playSoundsUpTo(Math.floor(tick));

        const active = activeRuleIdAt(watchedCarEvents, tick);
        if (active !== usePlaybackStore.getState().activeRuleId) {
          usePlaybackStore.setState({ activeRuleId: active });
        }
      },
      onEnd: () => {
        usePlaybackStore.setState({ isPlaying: false });
      },
    });
    driverRef.current = driver;
    driver.start();

    return () => {
      driver.stop();
      driverRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playSoundsUpTo/resyncEventPointer close over result, which is already a dep
  }, [result, geometry, ruleFiredByCar, watchedCarId]);

  function handleScrub(tick: number): void {
    driverRef.current?.seek(tick);
    setCurrentTick(tick);
    resyncEventPointer(tick);
  }

  // Requests to jump the playhead from outside this component (the "worst
  // moments" list in the report). Skipped on mount (id starts at 0) so this
  // doesn't fire for a stale request left over from a previous run.
  const isFirstSeekEffect = useRef(true);
  useEffect(() => {
    if (isFirstSeekEffect.current) {
      isFirstSeekEffect.current = false;
      return;
    }
    const tick = usePlaybackStore.getState().seekRequestTick;
    handleScrub(tick);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawShift(ctx, result, geometry, tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setCurrentTick/handleScrub are stable across renders
  }, [seekRequestId, result, geometry]);

  const watchedFrame = result.frames[Math.min(Math.floor(currentTick), result.frames.length - 1)]?.[watchedCarId];
  const floorReadout = watchedFrame ? String(Math.max(0, Math.round(watchedFrame.position))).padStart(2, '0') : '--';

  return (
    <section aria-label="Shift playback" className="run-view">
      <div className="run-view__instruments">
        <DotMatrixDisplay value={floorReadout} label="Current floor" />
        <DotMatrixDisplay value={formatTick(currentTick)} label="Shift clock" />
      </div>
      <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} role="img" aria-label="Elevator shaft simulation" />
      <div className="run-view__controls">
        <button type="button" onClick={toggle} aria-pressed={isPlaying}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        {PLAYBACK_SPEEDS.map((s: PlaybackSpeed) => (
          <button key={s} type="button" onClick={() => setSpeed(s)} aria-pressed={speed === s}>
            {s}x
          </button>
        ))}
        <label>
          <input
            type="checkbox"
            checked={soundOn}
            onChange={(e) => {
              setSoundEnabled(e.target.checked);
              setSoundOn(e.target.checked);
            }}
          />
          Sound
        </label>
        <label>
          {formatTick(currentTick)} / {formatTick(result.frames.length)}
          <input
            type="range"
            min={0}
            max={Math.max(0, result.frames.length - 1)}
            step={1}
            value={Math.round(currentTick)}
            onChange={(e) => handleScrub(Number(e.target.value))}
          />
        </label>
      </div>
      <p>
        Delivered {result.score.delivered} / {result.score.spawned} — gave up {result.score.gaveUp} — worst wait{' '}
        {formatTick(result.score.worstWaitTicks)}
      </p>
    </section>
  );
}
