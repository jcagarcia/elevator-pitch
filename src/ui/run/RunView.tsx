import { useEffect, useMemo, useRef } from 'react';
import { computeGeometry, drawShift } from '../../render/canvas';
import { PlaybackDriver } from '../../render/playback';
import { TICK_RATE } from '../../sim/config';
import type { SimResult } from '../../sim/simulate';
import { PLAYBACK_SPEEDS, usePlaybackStore, type PlaybackSpeed } from '../../store/playbackStore';

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
}

export function RunView({ result, floors, carCount }: RunViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const driverRef = useRef<PlaybackDriver | null>(null);
  const geometry = useMemo(() => computeGeometry(CANVAS_WIDTH, CANVAS_HEIGHT, floors, carCount), [floors, carCount]);

  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const speed = usePlaybackStore((s) => s.speed);
  const currentTick = usePlaybackStore((s) => s.currentTick);
  const { toggle, setSpeed, setCurrentTick } = usePlaybackStore.getState();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    usePlaybackStore.setState({ isPlaying: false, currentTick: 0 });

    const driver = new PlaybackDriver({
      durationTicks: result.frames.length,
      getIsPlaying: () => usePlaybackStore.getState().isPlaying,
      getSpeed: () => usePlaybackStore.getState().speed,
      onTick: (tick) => {
        drawShift(ctx, result, geometry, tick);
        usePlaybackStore.setState({ currentTick: tick });
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
  }, [result, geometry]);

  function handleScrub(tick: number): void {
    driverRef.current?.seek(tick);
    setCurrentTick(tick);
  }

  return (
    <section aria-label="Shift playback">
      <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} role="img" aria-label="Elevator shaft simulation" />
      <div>
        <button type="button" onClick={toggle} aria-pressed={isPlaying}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        {PLAYBACK_SPEEDS.map((s: PlaybackSpeed) => (
          <button key={s} type="button" onClick={() => setSpeed(s)} aria-pressed={speed === s}>
            {s}x
          </button>
        ))}
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
