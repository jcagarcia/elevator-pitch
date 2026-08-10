import { useEffect, useRef, useState } from 'react';
import { isSoundEnabled, playDelivered, playGaveUp, setSoundEnabled } from '../../audio/sound';
import { LIVE_MORALE_MAX } from '../../levels/liveScore';
import type { LevelDef } from '../../levels/types';
import { computeGeometry, drawIdleShaft, drawLiveState, drawShift, type RenderGeometry } from '../../render/canvas';
import { LiveRunController, type LiveRunStatus } from '../../render/liveRun';
import { PlaybackDriver } from '../../render/playback';
import { activeRuleIdAt, groupRuleFiredByCar } from '../../render/ruleHighlight';
import { StairwellAnimator } from '../../render/stairwellAnimator';
import { TICK_RATE } from '../../sim/config';
import { computeScore, initLiveSim, type LiveSim, type SimResult } from '../../sim/simulate';
import type { CarFrame, SimEvent } from '../../sim/types';
import { useEditorStore } from '../../store/editorStore';
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

interface LiveHud {
  tick: number;
  morale: number;
  floor: number;
}

const INITIAL_HUD: LiveHud = { tick: 0, morale: LIVE_MORALE_MAX, floor: 0 };

export interface ElevatorViewportProps {
  level: LevelDef;
  /** Fired once, the moment a shift ends (either by finishing the roster or
   *  by morale collapsing) — the caller records progress and can show the
   *  full report. The viewport itself switches into a scrubbable review of
   *  what just happened, so this is a notification, not a request for UI. */
  onShiftEnd: (result: SimResult, status: 'succeeded' | 'failed') => void;
  /** Which car's active rule to report for the live rule highlight. */
  watchedCarId?: number;
}

/**
 * The game's main viewport. A level starts here: as soon as one is picked,
 * a shift begins running in real time against whatever policy is currently
 * loaded, and stays editable — parameter and rule changes elsewhere in the
 * UI take effect on the very next simulated tick (see LiveRunController).
 * When the shift ends (roster exhausted, or morale collapsed) the viewport
 * switches to a review phase that scrubs back through the finished result,
 * reusing the same PlaybackDriver/drawShift the old batch-mode viewport used.
 */
export function ElevatorViewport({ level, onShiftEnd, watchedCarId = 0 }: ElevatorViewportProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometryRef = useRef<RenderGeometry>(computeGeometry(FALLBACK_WIDTH, FALLBACK_HEIGHT, level.floors, level.carCount));

  const liveSimRef = useRef<LiveSim | null>(null);
  const liveControllerRef = useRef<LiveRunController | null>(null);
  const stairwellRef = useRef(new StairwellAnimator());
  const framesRef = useRef<CarFrame[][]>([]);
  const frustrationHistoryRef = useRef<Float32Array[]>([]);
  const reviewDriverRef = useRef<PlaybackDriver | null>(null);
  const reviewEventIndexRef = useRef(0);

  const onShiftEndRef = useRef(onShiftEnd);
  useEffect(() => {
    onShiftEndRef.current = onShiftEnd;
  }, [onShiftEnd]);

  const [phase, setPhase] = useState<'live' | 'review'>('live');
  const [hud, setHud] = useState<LiveHud>(INITIAL_HUD);
  const [finishedResult, setFinishedResult] = useState<SimResult | null>(null);
  const [finishedStatus, setFinishedStatus] = useState<LiveRunStatus | null>(null);
  const [restartToken, setRestartToken] = useState(0);
  const [soundOn, setSoundOn] = useState(isSoundEnabled());

  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const speed = usePlaybackStore((s) => s.speed);
  const currentTick = usePlaybackStore((s) => s.currentTick);
  const seekRequestId = usePlaybackStore((s) => s.seekRequestId);
  const { toggle, setSpeed } = usePlaybackStore.getState();

  // Keep the canvas sized to whatever room the layout gives it, and redraw
  // whatever the current phase considers "now" whenever it's resized.
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
      geometryRef.current = computeGeometry(width, height, level.floors, level.carCount);

      if (!ctx) return;
      if (phase === 'review' && finishedResult) {
        drawShift(ctx, finishedResult, geometryRef.current, usePlaybackStore.getState().currentTick);
      } else if (liveSimRef.current) {
        const walkers = stairwellRef.current.getActiveWalkers(performance.now());
        drawLiveState(ctx, geometryRef.current, liveSimRef.current.state.building, liveSimRef.current.state.passengers, walkers);
      } else {
        drawIdleShaft(ctx, geometryRef.current);
      }
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [level.floors, level.carCount, phase, finishedResult]);

  // The live shift itself: starts as soon as a level is selected (or
  // re-selected via Restart), and keeps running — including through UI
  // edits to the policy elsewhere in the app — until it ends.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    liveControllerRef.current?.stop();
    liveControllerRef.current = null;
    reviewDriverRef.current?.stop();
    reviewDriverRef.current = null;
    stairwellRef.current.reset();

    const sim = initLiveSim({
      building: {
        floors: level.floors,
        carCount: level.carCount,
        capacityPerCar: level.capacityPerCar,
        faultyHallSensorFloors: level.faultyHallSensorFloors ?? [],
      },
      seed: level.seed,
      durationTicks: level.durationTicks,
      passengerGenSpec: level.passengerGenSpec,
    });
    liveSimRef.current = sim;
    framesRef.current = [];
    frustrationHistoryRef.current = sim.roster.map(() => new Float32Array(sim.durationTicks));

    setPhase('live');
    setFinishedResult(null);
    setFinishedStatus(null);
    setHud(INITIAL_HUD);
    usePlaybackStore.setState((s) => ({ isPlaying: true, speed: s.speed, currentTick: 0, activeRuleId: null }));

    const controller = new LiveRunController({
      sim,
      getPolicy: () => useEditorStore.getState().policy,
      getSpeed: () => usePlaybackStore.getState().speed,
      getIsPaused: () => !usePlaybackStore.getState().isPlaying,
      onFrame: (frame, tick) => {
        framesRef.current.push(frame);
        const index = tick - 1;
        for (const passenger of sim.state.passengers) {
          const history = frustrationHistoryRef.current[passenger.id];
          if (history) history[index] = passenger.frustration;
        }

        const walkers = stairwellRef.current.getActiveWalkers(performance.now());
        drawLiveState(ctx, geometryRef.current, sim.state.building, sim.state.passengers, walkers);

        const watched = frame[watchedCarId];
        setHud((h) => ({ ...h, tick, floor: watched ? Math.max(0, Math.round(watched.position)) : h.floor }));
        usePlaybackStore.setState({ currentTick: tick });
      },
      onNewEvents: (events) => {
        stairwellRef.current.addFromEvents(events, performance.now());
        if (isSoundEnabled()) {
          for (const event of events) {
            if (event.type === 'delivered') playDelivered();
            else if (event.type === 'gave-up') playGaveUp();
          }
        }
        let lastRuleFired: Extract<SimEvent, { type: 'rule-fired' }> | null = null;
        for (const event of events) {
          if (event.type === 'rule-fired' && event.carId === watchedCarId) lastRuleFired = event;
        }
        if (lastRuleFired) usePlaybackStore.setState({ activeRuleId: lastRuleFired.ruleId });
      },
      onMoraleChange: (morale) => setHud((h) => ({ ...h, morale })),
      onStatusChange: (status: LiveRunStatus) => {
        if (status === 'running') return;
        usePlaybackStore.setState({ isPlaying: false });
        const result: SimResult = {
          frames: framesRef.current,
          events: sim.state.events,
          passengers: sim.state.passengers,
          score: computeScore(sim.state),
          frustrationHistory: frustrationHistoryRef.current,
        };
        setFinishedResult(result);
        setFinishedStatus(status);
        setPhase('review');
        onShiftEndRef.current(result, status);
      },
    });

    liveControllerRef.current = controller;
    drawLiveState(ctx, geometryRef.current, sim.state.building, sim.state.passengers, []);
    controller.start();

    return () => {
      controller.stop();
      liveControllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new level or an explicit restart should tear down and restart the run
  }, [level.id, restartToken]);

  // The review phase: a finished shift, scrubbable via the same
  // PlaybackDriver the old batch-mode viewport used.
  useEffect(() => {
    if (phase !== 'review' || !finishedResult) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const lastTick = Math.max(0, finishedResult.frames.length - 1);
    usePlaybackStore.setState({ isPlaying: false, currentTick: lastTick, activeRuleId: null });
    reviewEventIndexRef.current = finishedResult.events.length;
    const watchedCarEvents = groupRuleFiredByCar(finishedResult.events).get(watchedCarId);

    function playSoundsUpTo(flooredTick: number): void {
      // Walking forward from wherever the pointer currently sits — this
      // only replays sounds during forward playback, never on the initial
      // jump into review (the pointer starts synced to the end above).
      while (reviewEventIndexRef.current < finishedResult!.events.length && finishedResult!.events[reviewEventIndexRef.current]!.tick <= flooredTick) {
        const event = finishedResult!.events[reviewEventIndexRef.current]!;
        if (isSoundEnabled()) {
          if (event.type === 'delivered') playDelivered();
          else if (event.type === 'gave-up') playGaveUp();
        }
        reviewEventIndexRef.current++;
      }
      while (reviewEventIndexRef.current > 0 && finishedResult!.events[reviewEventIndexRef.current - 1]!.tick > flooredTick) {
        reviewEventIndexRef.current--;
      }
    }

    const driver = new PlaybackDriver({
      durationTicks: finishedResult.frames.length,
      getIsPlaying: () => usePlaybackStore.getState().isPlaying,
      getSpeed: () => usePlaybackStore.getState().speed,
      onTick: (tick) => {
        drawShift(ctx, finishedResult, geometryRef.current, tick);
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
    driver.seek(lastTick);
    reviewDriverRef.current = driver;
    driver.start();
    drawShift(ctx, finishedResult, geometryRef.current, lastTick);

    return () => {
      driver.stop();
      reviewDriverRef.current = null;
    };
  }, [phase, finishedResult, watchedCarId]);

  function handleScrub(tick: number): void {
    reviewDriverRef.current?.seek(tick);
    usePlaybackStore.getState().setCurrentTick(tick);
    if (finishedResult) {
      let i = 0;
      while (i < finishedResult.events.length && finishedResult.events[i]!.tick <= tick) i++;
      reviewEventIndexRef.current = i;
    }
  }

  const isFirstSeekEffect = useRef(true);
  useEffect(() => {
    if (isFirstSeekEffect.current) {
      isFirstSeekEffect.current = false;
      return;
    }
    if (phase !== 'review' || !finishedResult) return;
    const tick = usePlaybackStore.getState().seekRequestTick;
    handleScrub(tick);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawShift(ctx, finishedResult, geometryRef.current, tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleScrub closes over finishedResult, already a dep
  }, [seekRequestId]);

  function restart(): void {
    setRestartToken((t) => t + 1);
  }

  const isFailed = finishedStatus === 'failed';
  const isSucceeded = finishedStatus === 'succeeded';
  const displayTick = phase === 'live' ? hud.tick : currentTick;
  const displayFloor = phase === 'live' ? hud.floor : (finishedResult?.frames[Math.min(Math.floor(currentTick), finishedResult.frames.length - 1)]?.[watchedCarId]?.position ?? 0);
  const moraleFraction = Math.max(0, Math.min(1, hud.morale / LIVE_MORALE_MAX));

  return (
    <div className="viewport">
      <div className="viewport__toolbar">
        <button type="button" className="viewport__run-button" onClick={restart}>
          Restart shift
        </button>
        <DotMatrixDisplay value={String(Math.max(0, Math.round(displayFloor))).padStart(2, '0')} label="Current floor" />
        <DotMatrixDisplay value={formatTick(displayTick)} label="Shift clock" />
        <button type="button" onClick={toggle} aria-pressed={isPlaying}>
          {isPlaying ? 'Pause' : phase === 'live' ? 'Resume' : 'Play'}
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
      </div>

      {phase === 'live' && (
        <div className="viewport__morale" role="status" aria-label={`Passenger morale: ${hud.morale} of ${LIVE_MORALE_MAX}`}>
          <span className="viewport__morale-label">Morale</span>
          <span className="viewport__morale-track">
            <span
              className={`viewport__morale-fill${moraleFraction < 0.35 ? ' viewport__morale-fill--danger' : ''}`}
              style={{ width: `${moraleFraction * 100}%` }}
            />
          </span>
          <span className="viewport__morale-value">{hud.morale}</span>
        </div>
      )}

      {phase === 'review' && (isFailed || isSucceeded) && (
        <p className={`viewport__status ${isFailed ? 'viewport__status--failed' : 'viewport__status--succeeded'}`}>
          {isFailed
            ? 'Service interrupted — morale collapsed and the stairwell took the overflow.'
            : 'Shift complete. Reviewing the recording below.'}
        </p>
      )}

      <div className="viewport__canvas-frame" ref={frameRef}>
        <canvas
          ref={canvasRef}
          width={FALLBACK_WIDTH}
          height={FALLBACK_HEIGHT}
          role="img"
          aria-label={
            phase === 'live'
              ? 'Elevator shaft simulation, running live'
              : isFailed
                ? 'Elevator shaft, shift terminated — reviewing recording'
                : 'Elevator shaft, shift complete — reviewing recording'
          }
        />
      </div>

      {phase === 'review' && finishedResult ? (
        <>
          <label className="viewport__scrub">
            {formatTick(currentTick)} / {formatTick(finishedResult.frames.length)}
            <input
              type="range"
              min={0}
              max={Math.max(0, finishedResult.frames.length - 1)}
              step={1}
              value={Math.round(currentTick)}
              onChange={(e) => handleScrub(Number(e.target.value))}
            />
          </label>
          <p>
            Delivered {finishedResult.score.delivered} / {finishedResult.score.spawned} — gave up {finishedResult.score.gaveUp} — worst wait{' '}
            {formatTick(finishedResult.score.worstWaitTicks)}
          </p>
        </>
      ) : (
        <p className="viewport__hint">Shift in progress — edit parameters and rules in the sidebar; changes apply on the next tick.</p>
      )}
    </div>
  );
}
