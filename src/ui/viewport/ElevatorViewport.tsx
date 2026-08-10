import { useEffect, useRef, useState } from 'react';
import { isSoundEnabled, playDelivered, playGaveUp, setSoundEnabled } from '../../audio/sound';
import { LIVE_MORALE_MAX } from '../../levels/liveScore';
import type { LevelDef } from '../../levels/types';
import { ACTIONS, CONDITIONS } from '../../policy/catalog';
import { BLANK_POLICY } from '../../policy/presets';
import type { Rule } from '../../policy/types';
import { LiveRunController, type LiveRunStatus } from '../../render/liveRun';
import { ruleFiredPulseAt, type RuleFiredEvent } from '../../render/ruleHighlight';
import { buildFloorScenes, ridersOfCar, type FigurePax } from '../../render/sceneBuilder';
import { DOOR_CLOSE_TICKS, DOOR_OPEN_TICKS, TICK_RATE } from '../../sim/config';
import { computeScore, initLiveSim, type LiveSim, type SimResult } from '../../sim/simulate';
import type { CarFrame, DoorState } from '../../sim/types';
import { useEditorStore } from '../../store/editorStore';
import { useRuleFireStore } from '../../store/ruleFireStore';
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

/** Continuous 0-1 door fraction from a live Car's own door-phase ticks. */
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

export interface ElevatorViewportProps {
  level: LevelDef;
  /** Fired once, the moment a shift ends (either by finishing the roster or
   *  by morale collapsing) — the caller records progress and can show the
   *  full report. */
  onShiftEnd: (result: SimResult, status: 'succeeded' | 'failed') => void;
  /** Jump the sidebar to the policy tab — wired to the mini rule panel's
   *  "+ ADD RULE" affordance, which is otherwise read-only here. */
  onRequestRuleEdit?: () => void;
  /** Which car's floor/active-rule the top bar and rule panel track. */
  watchedCarId?: number;
}

/**
 * The game's main viewport, a DOM "Shift Screen" per the "Elevator
 * frustration gauge" design handoff — chunky bordered panels, hard-offset
 * shadows, and PassengerFigure driving the frustration signal. A level
 * starts here: as soon as one is picked, a shift begins running in real
 * time, always at a fixed 1x pace with no pause — the player edits the
 * policy live, elsewhere in the UI, and changes take effect on the very
 * next simulated tick (see LiveRunController). There is no scrub/replay:
 * once the shift ends, the shaft simply holds on its final frame (the
 * LiveSim stops advancing, so re-reading its state keeps returning the
 * same thing) while the status banner and report explain what happened.
 */
export function ElevatorViewport({ level, onShiftEnd, onRequestRuleEdit, watchedCarId = 0 }: ElevatorViewportProps): JSX.Element {
  const liveSimRef = useRef<LiveSim | null>(null);
  const liveControllerRef = useRef<LiveRunController | null>(null);
  const framesRef = useRef<CarFrame[][]>([]);
  const frustrationHistoryRef = useRef<Float32Array[]>([]);
  const lastScannedEventIndexRef = useRef(0);
  const watchedCarEventsRef = useRef<RuleFiredEvent[]>([]);

  const onShiftEndRef = useRef(onShiftEnd);
  useEffect(() => {
    onShiftEndRef.current = onShiftEnd;
  }, [onShiftEnd]);

  const [liveTick, setLiveTick] = useState(0);
  const [liveMorale, setLiveMorale] = useState(LIVE_MORALE_MAX);
  const [pulsedRuleId, setPulsedRuleId] = useState<string | null>(null);
  const [finishedStatus, setFinishedStatus] = useState<LiveRunStatus | null>(null);
  const [restartToken, setRestartToken] = useState(0);
  const [soundOn, setSoundOn] = useState(isSoundEnabled());

  const policy = useEditorStore((s) => s.policy);

  // The live shift itself: starts as soon as a level is selected (or
  // re-selected via Restart), and keeps running — including through UI
  // edits to the policy elsewhere in the app — until it ends. Always real
  // time, always 1x, never paused: this is the whole game, not a scrubbable
  // recording of it.
  useEffect(() => {
    liveControllerRef.current?.stop();
    liveControllerRef.current = null;
    lastScannedEventIndexRef.current = 0;
    watchedCarEventsRef.current = [];

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

    setFinishedStatus(null);
    setLiveTick(0);
    setLiveMorale(LIVE_MORALE_MAX);
    setPulsedRuleId(null);
    useRuleFireStore.getState().setActiveRuleId(null);

    const controller = new LiveRunController({
      sim,
      getPolicy: () => useEditorStore.getState().policy,
      getSpeed: () => 1,
      getIsPaused: () => false,
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
            watchedCarEventsRef.current.push(event);
          }
        }
        lastScannedEventIndexRef.current = events.length;
        const pulsing = ruleFiredPulseAt(watchedCarEventsRef.current, tick);
        setPulsedRuleId((prev) => (prev === pulsing ? prev : pulsing));
        if (useRuleFireStore.getState().activeRuleId !== pulsing) useRuleFireStore.getState().setActiveRuleId(pulsing);

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
        const result: SimResult = {
          frames: framesRef.current,
          events: sim.state.events,
          passengers: sim.state.passengers,
          score: computeScore(sim.state),
          frustrationHistory: frustrationHistoryRef.current,
        };
        setFinishedStatus(status);
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

  function restart(): void {
    // Nothing carries over — same rule as picking a level in the first
    // place (see App.tsx's selectLevel).
    useEditorStore.getState().loadPreset(BLANK_POLICY);
    setRestartToken((t) => t + 1);
  }

  // --- Derive the current scene -----------------------------------------
  // Always read straight from the mutable LiveSim, which by construction
  // has already been stepped to `liveTick` by the time this render runs
  // (the state bump that triggers this render always happens synchronously
  // right after stepLiveSim mutates it — see onFrame above). Once the shift
  // ends the controller simply stops calling onFrame, so this keeps
  // re-deriving the same final scene from the sim's now-frozen state —
  // there's no separate "review" data path to keep in sync.
  const sim = liveSimRef.current;
  let carPoses: CarPose[] = [];
  let floorScenes = buildFloorScenes([], level.floors, 0, () => 0);

  if (sim) {
    const passengerById = new Map(sim.state.passengers.map((p) => [p.id, p]));
    const frustrationAt = (id: number): number => passengerById.get(id)?.frustration ?? 0;
    floorScenes = buildFloorScenes(sim.state.passengers, level.floors, liveTick, frustrationAt);
    carPoses = sim.state.building.cars.map((car) => ({
      id: car.id,
      position: car.position,
      doorFraction: liveDoorFraction(car.doorState, car.doorPhaseTicks),
      riders: ridersOfCar(sim.state.passengers, car.id, liveTick, frustrationAt),
    }));
  }

  const watchedCar = carPoses.find((c) => c.id === watchedCarId) ?? carPoses[0];
  const floorDisplay = watchedCar ? Math.max(0, Math.round(watchedCar.position)) : 0;
  const isFailed = finishedStatus === 'failed';
  const isSucceeded = finishedStatus === 'succeeded';
  const runState =
    finishedStatus !== null ? (isFailed ? 'TERMINATED' : 'COMPLETE') : liveTick <= START_LABEL_TICKS ? 'START' : 'IN PROGRESS';
  const runStateClass = isFailed ? ' shift-screen__run-state--terminated' : isSucceeded ? ' shift-screen__run-state--complete' : '';
  const moraleFraction = Math.max(0, Math.min(1, liveMorale / LIVE_MORALE_MAX));
  const ruleRows = buildRulePanelRows(policy.rules);
  const carLanesWidth = level.carCount * CAR_LANE_WIDTH;

  return (
    <div className="shift-screen">
      <div className="shift-screen__topbar">
        <div className="shift-screen__title">{level.name.toUpperCase()}</div>
        <div className="shift-screen__floor-wrap">
          <DotMatrixDisplay key={floorDisplay} value={String(floorDisplay).padStart(2, '0')} label={`${carLabel(watchedCarId)} · Floor`} />
          <DotMatrixDisplay value={formatTick(liveTick)} label="Shift clock" />
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
          <button type="button" onClick={restart}>
            Restart shift
          </button>
        </div>
      </div>

      {finishedStatus === null && (
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

      {(isFailed || isSucceeded) && (
        <p className={`shift-screen__status ${isFailed ? 'shift-screen__status--failed' : 'shift-screen__status--succeeded'}`}>
          {isFailed
            ? 'SERVICE INTERRUPTED — morale collapsed and the stairwell took the overflow.'
            : 'SHIFT COMPLETE — see the report for how it went.'}
        </p>
      )}

      <div className="shift-screen__body">
        <div
          className="shift-screen__shaft"
          role="img"
          aria-label={
            finishedStatus === null
              ? `Elevator shaft, running live, car at floor ${floorDisplay}`
              : `Elevator shaft, ${isFailed ? 'shift terminated' : 'shift complete'}, holding on its final frame`
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
          {ruleRows.length === 0 && <p className="shift-screen__rule-note">No rules yet — the car won&rsquo;t move on its own. Add one in the policy tab.</p>}
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
          <div className="shift-screen__rule-note">edit in the policy tab — this panel only shows what just fired.</div>
        </div>
      </div>
    </div>
  );
}
