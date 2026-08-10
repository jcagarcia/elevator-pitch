import { useEffect, useMemo, useRef, useState } from 'react';
import { isSoundEnabled, playDelivered, playGaveUp, setSoundEnabled } from '../../audio/sound';
import { computeGeometry, drawIdleShaft, drawShift, type RenderGeometry } from '../../render/canvas';
import { PlaybackDriver } from '../../render/playback';
import { activeRuleIdAt, groupRuleFiredByCar } from '../../render/ruleHighlight';
import { TICK_RATE } from '../../sim/config';
import type { SimResult } from '../../sim/simulate';
import { PLAYBACK_SPEEDS, usePlaybackStore, type PlaybackSpeed } from '../../store/playbackStore';
import { DotMatrixDisplay } from '../DotMatrixDisplay';

const FALLBACK_WIDTH = 640;
const FALLBACK_HEIGHT = 480;

function formatTick(tick: number): string {
  const totalSeconds = Math.floor(tick / TICK_RATE);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export interface ElevatorViewportProps {
  floors: number;
  carCount: number;
  /** Null before the first run of the current level — the shaft still
   *  renders (parked cars, empty), just without playback controls. */
  result: SimResult | null;
  onRunShift: () => void;
  /** Which car's active rule to report for the live rule highlight. */
  watchedCarId?: number;
}

/**
 * The game's main viewport: a responsive canvas showing the building,
 * always visible once a level is picked (idle before the first run, full
 * played-back shift after). This is the primary surface — everything else
 * (parameters, rules, saved policies, the report) lives in a sidebar next
 * to it, not above or below it.
 */
export function ElevatorViewport({ floors, carCount, result, onRunShift, watchedCarId = 0 }: ElevatorViewportProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometryRef = useRef<RenderGeometry>(computeGeometry(FALLBACK_WIDTH, FALLBACK_HEIGHT, floors, carCount));
  const driverRef = useRef<PlaybackDriver | null>(null);
  const eventIndexRef = useRef(0);
  const ruleFiredByCar = useMemo(() => (result ? groupRuleFiredByCar(result.events) : new Map()), [result]);
  const [soundOn, setSoundOn] = useState(isSoundEnabled());

  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const speed = usePlaybackStore((s) => s.speed);
  const currentTick = usePlaybackStore((s) => s.currentTick);
  const seekRequestId = usePlaybackStore((s) => s.seekRequestId);
  const { toggle, setSpeed, setCurrentTick } = usePlaybackStore.getState();

  function redraw(tick: number): void {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    if (result) drawShift(ctx, result, geometryRef.current, tick);
    else drawIdleShaft(ctx, geometryRef.current);
  }

  // Keep the canvas sized to whatever room the layout gives it — the
  // shaft is the "instrument," so it should fill its column rather than
  // sit at a fixed size regardless of viewport width.
  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.max(240, Math.floor(entry.contentRect.width));
      const height = Math.max(180, Math.floor(entry.contentRect.height));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      geometryRef.current = computeGeometry(width, height, floors, carCount);
      redraw(usePlaybackStore.getState().currentTick);
    });
    observer.observe(frame);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw closes over result/floors/carCount, already deps below
  }, [floors, carCount, result]);

  function resyncEventPointer(tick: number): void {
    if (!result) return;
    let i = 0;
    while (i < result.events.length && result.events[i]!.tick <= tick) i++;
    eventIndexRef.current = i;
  }

  function playSoundsUpTo(flooredTick: number): void {
    if (!result) return;
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

    driverRef.current?.stop();
    driverRef.current = null;

    if (!result) {
      usePlaybackStore.setState({ isPlaying: false, currentTick: 0, activeRuleId: null });
      drawIdleShaft(ctx, geometryRef.current);
      return;
    }

    usePlaybackStore.setState({ isPlaying: false, currentTick: 0, activeRuleId: null });
    eventIndexRef.current = 0;
    const watchedCarEvents = ruleFiredByCar.get(watchedCarId);

    const driver = new PlaybackDriver({
      durationTicks: result.frames.length,
      getIsPlaying: () => usePlaybackStore.getState().isPlaying,
      getSpeed: () => usePlaybackStore.getState().speed,
      onTick: (tick) => {
        drawShift(ctx, result, geometryRef.current, tick);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- playSoundsUpTo/resyncEventPointer close over result, already a dep
  }, [result, ruleFiredByCar, watchedCarId]);

  function handleScrub(tick: number): void {
    driverRef.current?.seek(tick);
    setCurrentTick(tick);
    resyncEventPointer(tick);
  }

  const isFirstSeekEffect = useRef(true);
  useEffect(() => {
    if (isFirstSeekEffect.current) {
      isFirstSeekEffect.current = false;
      return;
    }
    if (!result) return;
    const tick = usePlaybackStore.getState().seekRequestTick;
    handleScrub(tick);
    redraw(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleScrub/redraw are stable across renders
  }, [seekRequestId]);

  const watchedFrame = result?.frames[Math.min(Math.floor(currentTick), result.frames.length - 1)]?.[watchedCarId];
  const floorReadout = watchedFrame ? String(Math.max(0, Math.round(watchedFrame.position))).padStart(2, '0') : '--';

  return (
    <div className="viewport">
      <div className="viewport__toolbar">
        <button type="button" className="viewport__run-button" onClick={onRunShift}>
          {result ? 'Run shift again' : 'Run shift'}
        </button>
        <DotMatrixDisplay value={floorReadout} label="Current floor" />
        <DotMatrixDisplay value={formatTick(currentTick)} label="Shift clock" />
        {result && (
          <>
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
          </>
        )}
      </div>

      <div className="viewport__canvas-frame" ref={frameRef}>
        <canvas
          ref={canvasRef}
          width={FALLBACK_WIDTH}
          height={FALLBACK_HEIGHT}
          role="img"
          aria-label={result ? 'Elevator shaft simulation, in progress' : 'Elevator shaft, idle — press Run shift to start'}
        />
      </div>

      {result ? (
        <>
          <label className="viewport__scrub">
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
          <p>
            Delivered {result.score.delivered} / {result.score.spawned} — gave up {result.score.gaveUp} — worst wait{' '}
            {formatTick(result.score.worstWaitTicks)}
          </p>
        </>
      ) : (
        <p className="viewport__hint">Car parked, doors closed. Press Run shift to start the clock.</p>
      )}
    </div>
  );
}
