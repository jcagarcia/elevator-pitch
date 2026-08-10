import { useEffect, useRef, useState } from 'react';
import { isSoundEnabled, playDelivered, playGaveUp, setSoundEnabled } from '../../audio/sound';
import { LIVE_MORALE_MAX } from '../../levels/liveScore';
import type { LevelDef } from '../../levels/types';
import { ACTIONS, CONDITIONS } from '../../policy/catalog';
import type { Rule } from '../../policy/types';
import { LiveRunController, type LiveRunStatus } from '../../render/liveRun';
import { PlaybackDriver } from '../../render/playback';
import { groupRuleFiredByCar, ruleFiredPulseAt, RULE_FIRED_PULSE_TICKS } from '../../render/ruleHighlight';
import { buildFloorScenes, ridersOfCar, type FigurePax } from '../../render/sceneBuilder';
import { DOOR_CLOSE_TICKS, DOOR_OPEN_TICKS, TICK_RATE } from '../../sim/config';
import { computeScore, initLiveSim, type LiveSim, type SimResult } from '../../sim/simulate';
import type { CarFrame, DoorState } from '../../sim/types';
import { useEditorStore } from '../../store/editorStore';
import { PLAYBACK_SPEEDS, usePlaybackStore, type PlaybackSpeed } from '../../store/playbackStore';
import { DotMatrixDisplay } from '../DotMatrixDisplay';
import { PassengerFigure } from '../PassengerFigure';

// Pixel constants mirroring index.css's .shift-screen__* rem values (at the
// standard 16px root), so the absolutely-positioned car block(s) line up
// with the floor rows they're drawn over. Not pixel-perfect science — a few
// px of slack reads fine on a chunky, hand-drawn-feeling UI like this one.
const REM = 16;
const SHAFT_PAD_X = 1.1 * REM;
const SHAFT_PAD_Y = 0.9 * REM;
const FLOOR_ROW_HEIGHT = 3.6 * REM;
const FLOOR_NUM_WIDTH = 1.8 * REM;
const ROW_GAP = 0.7 * REM;
const CAR_LANE_WIDTH = 74;
const CAR_WIDTH = 62;
const CAR_HEIGHT = FLOOR_ROW_HEIGHT - 14;

/** First second of a shift reads as START rather than IN PROGRESS — long
 *  enough to be legible, short enough not to feel stuck. */
const START_LABEL_TICKS = TICK_RATE;

function formatTick(tick: number): string {
  const totalSeconds = Math.floor(tick / TICK_RATE);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Continuous 0-1 door fraction from a live Car's own door-phase ticks —
 *  only available while live, since a recorded CarFrame doesn't carry
 *  doorPhaseTicks (see frameDoorFraction for the review-phase fallback). */
function liveDoorFraction(doorState: DoorState, doorPhaseTicks: number): number {
  switch (doorState) {
    case 'open':
      return 1;
    case 'opening':
      return Math.min(1, doorPhaseTicks / DOOR_OPEN_TICKS);
    case 'closing':
      return Math.max(0, 1 - doorPhaseTicks / DOOR_CLOSE_TICKS);
    default:
      return 0;
  }
}

/** Coarser door fraction for review-phase scrubbing, where only the
 *  discrete DoorState survives in a recorded CarFrame. */
function frameDoorFraction(doorState: DoorState): number {
  switch (doorState) {
    case 'open':
      return 1;
    case 'opening':
    case 'closing':
      return 0.5;
    default:
      return 0;
  }
}

function carLeftPx(carIndex: number): number {
  return SHAFT_PAD_X + FLOOR_NUM_WIDTH + ROW_GAP + carIndex * CAR_LANE_WIDTH;
}

function carBottomPx(position: number): number {
  return SHAFT_PAD_Y + position * FLOOR_ROW_HEIGHT + (FLOOR_ROW_HEIGHT - CAR_HEIGHT) / 2;
}

function carLabel(index: number): string {
  return `CAR ${String.fromCharCode(65 + index)}`;
}

interface RulePanelRow {
  readonly ruleId: string;
  readonly condText: string;
  readonly actionText: string;
  readonly enabled: boolean;
}

function buildRulePanelRows(rules: readonly Rule[]): RulePanelRow[] {
  return rules.map((rule) => ({
    ruleId: rule.id,
    condText: rule.conditions.map((c) => CONDITIONS[c.id].describe(c.params)).join(' and '),
    actionText: ACTIONS[rule.action.id].describe(rule.action.params),
    enabled: rule.enabled,
  }));
}

interface CarPose {
  readonly id: number;
  readonly position: number;
  readonly doorFraction: number;
  readonly riders: readonly FigurePax[];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface ElevatorViewportProps {
  level: LevelDef;
  /** Fired once, the moment a shift ends (either by finishing the roster or
   *  by morale collapsing) — the caller records progress and can show the
   *  full report. The viewport itself switches into a scrubbable review of
   *  what just happened, so this is a notification, not a request for UI. */
  onShiftEnd: (result: SimResult, status: 'succeeded' | 'failed') => void;
  /** Jump the sidebar to the full rule editor — wired to the mini rule
   *  panel's "+ ADD RULE" affordance, which is otherwise read-only here. */
  onRequestRuleEdit?: () => void;
  /** Which car's floor/active-rule the top bar and rule panel track. */
  watchedCarId?: number;
}

/**
 * The game's main viewport, rebuilt as a DOM "Shift Screen" per the
 * "Elevator frustration gauge" design handoff — chunky bordered panels,
 * hard-offset shadows, and PassengerFigure driving the frustration signal,
 * rather than canvas drawing. A level starts here: as soon as one is
 * picked, a shift begins running in real time against whatever policy is
 * currently loaded, and stays editable — parameter and rule changes
 * elsewhere in the UI take effect on the very next simulated tick (see
 * LiveRunController). When the shift ends the viewport switches to a
 * review phase that scrubs back through the finished result, reusing the
 * same PlaybackDriver the old batch-mode viewport used.
 */
export function ElevatorViewport({ level, onShiftEnd, onRequestRuleEdit, watchedCarId = 0 }: ElevatorViewportProps): JSX.Element {
  const liveSimRef = useRef<LiveSim | null>(null);
  const liveControllerRef = useRef<LiveRunController | null>(null);
  const framesRef = useRef<CarFrame[][]>([]);
  const frustrationHistoryRef = useRef<Float32Array[]>([]);
  const reviewDriverRef = useRef<PlaybackDriver | null>(null);
  const reviewEventIndexRef = useRef(0);
  const lastScannedEventIndexRef = useRef(0);
  const lastFiredRef = useRef<{ ruleId: string; tick: number } | null>(null);

  const onShiftEndRef = useRef(onShiftEnd);
  useEffect(() => {
    onShiftEndRef.current = onShiftEnd;
  }, [onShiftEnd]);

  const [phase, setPhase] = useState<'live' | 'review'>('live');
  const [liveTick, setLiveTick] = useState(0);
  const [liveMorale, setLiveMorale] = useState(LIVE_MORALE_MAX);
  const [pulsedRuleId, setPulsedRuleId] = useState<string | null>(null);
  const [finishedResult, setFinishedResult] = useState<SimResult | null>(null);
  const [finishedStatus, setFinishedStatus] = useState<LiveRunStatus | null>(null);
  const [restartToken, setRestartToken] = useState(0);
  const [soundOn, setSoundOn] = useState(isSoundEnabled());

  const policy = useEditorStore((s) => s.policy);
  const isPlaying = usePlaybackStore((s) => s.isPlaying);
  const speed = usePlaybackStore((s) => s.speed);
  const currentTick = usePlaybackStore((s) => s.currentTick);
  const { toggle, setSpeed, setCurrentTick } = usePlaybackStore.getState();

  // The live shift itself: starts as soon as a level is selected (or
  // re-selected via Restart), and keeps running — including through UI
  // edits to the policy elsewhere in the app — until it ends.
  useEffect(() => {
    liveControllerRef.current?.stop();
    liveControllerRef.current = null;
    reviewDriverRef.current?.stop();
    reviewDriverRef.current = null;
    lastScannedEventIndexRef.current = 0;
    lastFiredRef.current = null;

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
    setLiveTick(0);
    setLiveMorale(LIVE_MORALE_MAX);
    setPulsedRuleId(null);
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

        // stepLiveSim has already appended this tick's events (including
        // any rule-fired decision) before onFrame runs — scan just the
        // slice we haven't seen yet rather than waiting for onNewEvents,
        // which fires after onFrame and would make the pulse a tick stale.
        const events = sim.state.events;
        for (let i = lastScannedEventIndexRef.current; i < events.length; i++) {
          const event = events[i]!;
          if (event.type === 'rule-fired' && event.carId === watchedCarId) {
            lastFiredRef.current = { ruleId: event.ruleId ?? '', tick: event.tick };
          }
        }
        lastScannedEventIndexRef.current = events.length;
        const fired = lastFiredRef.current;
        const pulsing = fired && fired.ruleId !== '' && tick - fired.tick < RULE_FIRED_PULSE_TICKS ? fired.ruleId : null;
        setPulsedRuleId((prev) => (prev === pulsing ? prev : pulsing));
        if (usePlaybackStore.getState().activeRuleId !== pulsing) usePlaybackStore.setState({ activeRuleId: pulsing });

        setLiveTick(tick);
      },
      onNewEvents: (events) => {
        if (!isSoundEnabled()) return;
        for (const event of events) {
          if (event.type === 'delivered') playDelivered();
          else if (event.type === 'gave-up') playGaveUp();
        }
      },
      onMoraleChange: (morale) => setLiveMorale(morale),
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
    controller.start();

    return () => {
      controller.stop();
      liveControllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new level or an explicit restart should tear down and restart the run
  }, [level.id, restartToken]);

  // The review phase: a finished shift, scrubbable via the same
  // PlaybackDriver the old batch-mode viewport used. Only the transport
  // clock is driven here — the scene itself is derived from
  // finishedResult + currentTick directly in render, below.
  useEffect(() => {
    if (phase !== 'review' || !finishedResult) return;

    const lastTick = Math.max(0, finishedResult.frames.length - 1);
    usePlaybackStore.setState({ isPlaying: false, currentTick: lastTick, activeRuleId: null });
    reviewEventIndexRef.current = finishedResult.events.length;
    const watchedCarEvents = groupRuleFiredByCar(finishedResult.events).get(watchedCarId);

    function playSoundsAt(flooredTick: number): void {
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
        usePlaybackStore.setState({ currentTick: tick });
        playSoundsAt(Math.floor(tick));
        const pulsing = ruleFiredPulseAt(watchedCarEvents, tick, RULE_FIRED_PULSE_TICKS);
        if (usePlaybackStore.getState().activeRuleId !== pulsing) usePlaybackStore.setState({ activeRuleId: pulsing });
      },
      onEnd: () => {
        usePlaybackStore.setState({ isPlaying: false });
      },
    });
    driver.seek(lastTick);
    reviewDriverRef.current = driver;
    driver.start();

    return () => {
      driver.stop();
      reviewDriverRef.current = null;
    };
  }, [phase, finishedResult, watchedCarId]);

  function restart(): void {
    setRestartToken((t) => t + 1);
  }

  function handleScrub(tick: number): void {
    reviewDriverRef.current?.seek(tick);
    setCurrentTick(tick);
  }

  // --- Derive the current scene -----------------------------------------
  // Live: read straight from the mutable LiveSim, which by construction has
  // already been stepped to `liveTick` by the time this render runs (the
  // state bump that triggers this render always happens synchronously right
  // after stepLiveSim mutates it — see onFrame above). Review: interpolate
  // between the two recorded frames bracketing the (possibly fractional)
  // scrub position, the same way the old canvas playback did.

  const sim = liveSimRef.current;
  const displayTick = phase === 'live' ? liveTick : currentTick;
  let carPoses: CarPose[] = [];
  let floorScenes = level.floors > 0 ? buildFloorScenes([], level.floors, 0, () => 0) : [];

  if (phase === 'live' && sim) {
    const passengerById = new Map(sim.state.passengers.map((p) => [p.id, p]));
    const frustrationAt = (id: number): number => passengerById.get(id)?.frustration ?? 0;
    floorScenes = buildFloorScenes(sim.state.passengers, level.floors, liveTick, frustrationAt);
    carPoses = sim.state.building.cars.map((car) => ({
      id: car.id,
      position: car.position,
      doorFraction: liveDoorFraction(car.doorState, car.doorPhaseTicks),
      riders: ridersOfCar(sim.state.passengers, car.id, liveTick, frustrationAt),
    }));
  } else if (phase === 'review' && finishedResult) {
    const tickA = Math.max(0, Math.min(Math.floor(currentTick), finishedResult.frames.length - 1));
    const tickB = Math.min(tickA + 1, finishedResult.frames.length - 1);
    const fraction = currentTick - tickA;
    const framesA = finishedResult.frames[tickA] ?? [];
    const framesB = finishedResult.frames[tickB] ?? [];
    const frustrationAt = (id: number): number => finishedResult.frustrationHistory[id]?.[tickA] ?? 0;
    floorScenes = buildFloorScenes(finishedResult.passengers, level.floors, tickA, frustrationAt);
    carPoses = framesA.map((frameA, index) => {
      const frameB = framesB[index];
      const position = frameB ? lerp(frameA.position, frameB.position, fraction) : frameA.position;
      return {
        id: frameA.carId,
        position,
        doorFraction: frameDoorFraction(frameA.doorState),
        riders: ridersOfCar(finishedResult.passengers, frameA.carId, tickA, frustrationAt),
      };
    });
  }

  const watchedCar = carPoses.find((c) => c.id === watchedCarId) ?? carPoses[0];
  const floorDisplay = watchedCar ? Math.max(0, Math.round(watchedCar.position)) : 0;
  const isFailed = finishedStatus === 'failed';
  const isSucceeded = finishedStatus === 'succeeded';
  const runState = phase === 'review' ? (isFailed ? 'TERMINATED' : 'COMPLETE') : displayTick <= START_LABEL_TICKS ? 'START' : 'IN PROGRESS';
  const runStateClass =
    phase === 'review' ? (isFailed ? ' shift-screen__run-state--terminated' : ' shift-screen__run-state--complete') : '';
  const moraleFraction = Math.max(0, Math.min(1, liveMorale / LIVE_MORALE_MAX));
  const ruleRows = buildRulePanelRows(policy.rules);
  const carLanesWidth = level.carCount * CAR_LANE_WIDTH;
  const scrubMax = finishedResult ? Math.max(0, finishedResult.frames.length - 1) : 0;

  return (
    <div className="shift-screen">
      <div className="shift-screen__topbar">
        <div className="shift-screen__title">{level.name.toUpperCase()}</div>
        <div className="shift-screen__floor-wrap">
          <DotMatrixDisplay key={floorDisplay} value={String(floorDisplay).padStart(2, '0')} label={`${carLabel(watchedCarId)} · Floor`} />
          <DotMatrixDisplay value={formatTick(displayTick)} label="Shift clock" />
        </div>
        <div className="shift-screen__floor-wrap">
          <span className={`shift-screen__run-state${runStateClass}`}>{runState}</span>
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
      </div>

      {phase === 'live' && (
        <div className="shift-screen__morale" role="status" aria-label={`Passenger morale: ${liveMorale} of ${LIVE_MORALE_MAX}`}>
          <span className="shift-screen__morale-label">Morale</span>
          <span className="shift-screen__morale-track">
            <span
              className={`shift-screen__morale-fill${moraleFraction < 0.35 ? ' shift-screen__morale-fill--danger' : ''}`}
              style={{ width: `${moraleFraction * 100}%` }}
            />
          </span>
          <span className="shift-screen__morale-value">{liveMorale}</span>
        </div>
      )}

      {phase === 'review' && (isFailed || isSucceeded) && (
        <p className={`shift-screen__status ${isFailed ? 'shift-screen__status--failed' : 'shift-screen__status--succeeded'}`}>
          {isFailed
            ? 'SERVICE INTERRUPTED — morale collapsed and the stairwell took the overflow.'
            : 'SHIFT COMPLETE — reviewing the recording below.'}
        </p>
      )}

      <div className="shift-screen__body">
        <div
          className="shift-screen__shaft"
          role="img"
          aria-label={
            phase === 'live'
              ? `Elevator shaft, running live, car at floor ${floorDisplay}`
              : `Elevator shaft, ${isFailed ? 'shift terminated' : 'shift complete'} — reviewing recording`
          }
        >
          {floorScenes.map((scene, floor) => (
            <div className="shift-screen__floor-row" key={floor}>
              <div className="shift-screen__floor-num">{floor}</div>
              <div className="shift-screen__floor-track">
                <div style={{ flexShrink: 0, width: carLanesWidth }} />
                <div className="shift-screen__call-dial">
                  {scene.showDial && <PassengerFigure progress={scene.worstProgress} showGauge scale={0.85} />}
                </div>
                <div className="shift-screen__wait-area">
                  {scene.waiting.map((pax) => (
                    <PassengerFigure key={pax.id} progress={pax.progress} exiting={pax.exiting} showGauge={false} scale={0.75} />
                  ))}
                </div>
                <div className="shift-screen__stairs">STAIRS</div>
              </div>
            </div>
          ))}

          {carPoses.map((car, index) => (
            <div key={car.id}>
              {level.carCount > 1 && (
                <div
                  className="shift-screen__car-label"
                  style={{ left: carLeftPx(index), bottom: carBottomPx(car.position) + CAR_HEIGHT + 4 }}
                >
                  {carLabel(index)}
                </div>
              )}
              <div
                className="shift-screen__car"
                style={{ left: carLeftPx(index), bottom: carBottomPx(car.position), width: CAR_WIDTH, height: CAR_HEIGHT }}
              >
                <div className="shift-screen__car-door shift-screen__car-door--left" style={{ transform: `translateX(${-car.doorFraction * 100}%)` }} />
                <div className="shift-screen__car-door" style={{ transform: `translateX(${car.doorFraction * 100}%)` }} />
                {car.doorFraction > 0.15 && car.riders.length > 0 && (
                  <div className="shift-screen__car-riders">
                    {car.riders.slice(0, 4).map((rider) => (
                      <PassengerFigure key={rider.id} progress={rider.progress} showGauge={false} scale={0.4} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="shift-screen__rule-panel">
          <div className="shift-screen__rule-panel-header">POLICY — TOP DOWN</div>
          {ruleRows.map((rule) => (
            <div
              key={rule.ruleId}
              className={`shift-screen__rule-row${rule.ruleId === pulsedRuleId ? ' shift-screen__rule-row--fired' : ''}${
                rule.enabled ? '' : ' shift-screen__rule-row--disabled'
              }`}
            >
              <span className="shift-screen__rule-cond">IF {rule.condText.toUpperCase()}</span>
              <span className="shift-screen__rule-action">{rule.actionText.toUpperCase()}</span>
            </div>
          ))}
          <button type="button" className="shift-screen__add-rule" onClick={onRequestRuleEdit}>
            + ADD RULE
          </button>
          <div className="shift-screen__rule-note">edit in the rules tab — this panel only shows what just fired.</div>
        </div>
      </div>

      <div className="shift-screen__transport">
        <button type="button" className="shift-screen__play-btn" onClick={toggle} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <label className="shift-screen__scrub">
          <input
            type="range"
            min={0}
            max={scrubMax}
            step={0.05}
            value={phase === 'review' ? currentTick : 0}
            onChange={(e) => handleScrub(Number(e.target.value))}
            disabled={phase !== 'review'}
            aria-label="Scrub shift"
          />
        </label>
        <div className="shift-screen__time">
          {formatTick(displayTick)} / {formatTick(phase === 'review' ? scrubMax : level.durationTicks)}
        </div>
        <div className="shift-screen__speed-row">
          {PLAYBACK_SPEEDS.map((s: PlaybackSpeed) => (
            <button key={s} type="button" onClick={() => setSpeed(s)} aria-pressed={speed === s}>
              {s}x
            </button>
          ))}
        </div>
        <button type="button" onClick={restart}>
          Restart shift
        </button>
      </div>
    </div>
  );
}
