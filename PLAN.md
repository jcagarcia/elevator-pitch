# Elevator Pitch — Plan

Browser game where the player tunes an elevator dispatch policy and watches a
deterministic simulation react to it. Player never touches a car directly.

## Flags before building (per brief's request)

**1. Stacked anger sources can compound past any policy's ability to recover.**
The brief lists eight frustration sources, several superlinear or spike-shaped
(hall wait, wrong-direction, passed-by). A single passenger can rack up three
or four of these in the same tick (waiting a long time, then getting passed,
then boarding into a detour that goes the wrong way). Naively additive, worst
case runs stop being informative — everyone gives up regardless of policy
quality, and the report can't tell the player which decision mattered.
Mitigation I'm building in: every source is additive as specified (I won't
silently change the model), but (a) each source's curve is a named,
independently-tunable function in `sim/frustration.ts`, not a hardcoded
formula, and (b) I'll ship conservative starting constants sized so a
*mediocre* policy produces "annoyed/angry" outcomes, not mass give-ups, on the
default levels. You'll want to rebalance these against your own taste; the
single config file is built for that.

**2. "Give-ups" as hard failures could make early levels unwinnable while the
player is still learning the editor.** I'm reading "hard failure" as *scoring*
impact (kills star rating), not a level-ending abort — the shift keeps
running so the player still gets a full report. Flagging in case you intended
give-ups to end the shift early.

**3. Byte-identical determinism + "runs on its own at adjustable speed" +
scrubbable timeline together imply the sim should NOT be advanced by
`requestAnimationFrame` in real time.** Instead: pressing "Run shift"
synchronously computes the *entire* shift (it's pure functions over fixed
ticks, this is fast — thousands of ticks in milliseconds), producing an
immutable result (per-tick car/passenger snapshots + a discrete event log for
rule firings and frustration events). Playback controls (play/pause/speed/
scrub) then just move a playhead through that precomputed result. This is
what makes reruns trivially byte-identical (no wall-clock or frame-timing
coupling anywhere), makes scrubbing free, and lets "highlight which rule
fired" during playback just be a lookup into the event log instead of
re-deriving anything. I think this is clearly the right call, not really
optional — flagging so the architecture choice is visible before I build on
top of it.

**4. Two-car "don't both answer the same call" needs a shared claim, which
means dispatch decisions can't be purely per-car-local.** I'll model this as
a small piece of shared world state (`claimedCalls: Map<callId, carId>`) that
rules can read/release, rather than each car deciding in total isolation.
Noting this because it's a small deviation from "policy = per-car rule list"
— the rule *language* stays per-car, but evaluation context includes shared
building state.

None of these block starting; they just affect the constants I'll pick first
and one architectural default. Say the word if you want any of them handled
differently.

## Architecture

```
src/
  sim/       pure, framework-free, Node-testable
    rng.ts            seeded PRNG (mulberry32), deterministic stream
    types.ts          Building, Car, Passenger, SimState, events
    physics.ts         accel/decel ramps, door timing, dwell
    frustration.ts      per-source curves, config-driven, attributable
    building.ts        floor/car setup
    dispatch.ts        resolves each car's next target via a policy
    simulate.ts        stepSimulation(state) -> state; runShift(level, policy) -> SimResult
    config.ts          every tunable constant, named + commented
  policy/
    types.ts           Rule/Condition/Action/DispatchPolicy types
    catalog.ts         registry of condition/action implementations + unlock levels
    presets.ts         Naive FCFS, SCAN, LOOK as DispatchPolicy data
  levels/
    types.ts           LevelDef
    level-01-morning-rush.ts ... level-07-two-cars.ts
    index.ts
  render/
    canvas.ts          shaft + car + passenger drawing, tick interpolation
    playback.ts         playhead driver (rAF loop reads SimResult, no sim math)
  ui/
    editor/            parameter sliders/toggles, rule list (drag-reorder)
    run/                run controls, canvas host, live rule highlight
    report/             end-of-shift report, scrubbable timeline, worst moments
  store/
    editorStore.ts      current policy draft, selected level (zustand)
    playbackStore.ts    isPlaying, speed, currentTick (zustand, transient updates)
    progressStore.ts    saved policies + level stars, synced to localStorage
tests/
  sim/, policy/, levels/
```

Key boundary: `sim/` and `policy/` never import React or touch the DOM/
`Date.now`/`Math.random`. `runShift(level, policy)` is the single entry point
UI code calls; everything downstream (renderer, report, playback) consumes
its output.

## Data model

### Passenger / Car (`sim/types.ts`)

```ts
type Trait = 'impatient' | 'heavy' | 'vip' | 'luggage';
type FrustrationState = 'calm' | 'annoyed' | 'angry' | 'furious' | 'gave-up';

interface Passenger {
  id: PassengerId;
  originFloor: number;
  destFloor: number;
  spawnTick: number;
  traits: Trait[];
  patienceMultiplier: number;      // derived from traits, scales frustration accrual
  state: 'waiting' | 'riding' | 'delivered' | 'gave-up';
  frustration: number;             // accumulated score
  frustrationBySource: Record<FrustrationSource, number>; // for the report
  carId: CarId | null;
  boardedTick: number | null;
  deliveredTick: number | null;
}

interface Car {
  id: CarId;
  position: number;                // float, floors
  velocity: number;
  direction: 'up' | 'down' | 'idle';
  doorState: 'closed' | 'opening' | 'open' | 'closing';
  doorTimer: number;
  passengers: PassengerId[];
  targetQueue: number[];
  capacity: number;
}
```

### Dispatch policy (`policy/types.ts`)

```ts
type ConditionId =
  | 'car-idle' | 'has-waiting-call' | 'call-ahead-in-direction'
  | 'capacity-at-least' | 'call-waited-longer-than' | 'nothing-ahead'
  | ...;                      // grows per level unlock

type ActionId =
  | 'go-to-nearest-call' | 'serve-call-ahead' | 'ignore-hall-calls'
  | 'treat-as-highest-priority' | 'reverse-direction' | 'park-at-floor'
  | ...;

interface Rule {
  id: string;
  enabled: boolean;
  condition: { id: ConditionId; params: Record<string, number | boolean> };
  action: { id: ActionId; params: Record<string, number | boolean> };
}

interface DispatchPolicy {
  name: string;
  parameters: {
    lookaheadFloors: number;
    directionCommitThreshold: number;
    minDoorDwellTicks: number;
    acceptReverseDirectionPickup: boolean;
    capacityReserve: number;      // 0..1, fraction reserved before ignoring new hall calls
    idleParkingFloor: number | null;
  };
  rules: Rule[];                  // evaluated top-down, first match wins, per car per decision point
}
```

Rules are pure data; `policy/catalog.ts` maps each `ConditionId`/`ActionId` to
a pure evaluator function `(ctx: DispatchContext) => boolean` /
`(ctx) => TargetDecision`. `dispatch.ts` walks a car's rule list top-down each
time it needs a new target, records which rule (or "no rule matched, fell
back to default") fired into the event log for live highlighting.

Presets (`policy/presets.ts`) are just `DispatchPolicy` literals built from
the same catalog — no special-cased engine paths, so mutating a preset in the
editor is exactly the same code path as building from scratch.

### Level (`levels/types.ts`)

```ts
interface LevelDef {
  id: string;
  name: string;
  briefing: string;               // maintenance-manual voice
  floors: number;
  cars: number;
  capacityPerCar: number;
  seed: number;
  durationTicks: number;
  passengerGenerator: PassengerGenSpec;  // declarative, consumed via seeded RNG only
  starThresholds: { one: number; two: number; three: number }; // composite score
  unlocks: { conditions: ConditionId[]; actions: ActionId[] };
}
```

### Sim output (`sim/simulate.ts`)

```ts
interface SimResult {
  frames: CarFrame[][];           // [tick][carIndex] — position/direction/door/passengers, for rendering
  events: SimEvent[];             // boardings, alightings, rule firings, frustration spikes, give-ups
  passengers: Passenger[];        // final state, per-passenger frustrationBySource
  score: ShiftScore;
}
```

`frames` drives the canvas renderer via interpolation between adjacent ticks
at whatever playback speed is selected; `events` drives the report and the
live rule-highlight during playback.

## Anger model constants (`sim/config.ts`)

Every number below becomes a named, commented constant. Sketch of the shape
(not final values — this is what gets rebalanced):

- Hall wait: `frustration/tick = HALL_WAIT_BASE * (ticksWaited / HALL_WAIT_KNEE)^HALL_WAIT_EXP`
- Ride time: `RIDE_TIME_BASE` flat per tick while riding toward destination
- Detour stop: `DETOUR_STOP_PENALTY` flat, applied once per non-destination stop while aboard
- Wrong direction: `WRONG_DIR_BASE * floorsTravelledWrongWay`
- Passed by: `PASSED_BY_PENALTY` one-time spike, only fires if car had free capacity
- Doors reopened: `DOOR_REOPEN_PENALTY` small flat
- Crowding: `CROWDING_BASE * max(0, occupancy - CROWDING_THRESHOLD)` per tick
- Idle in car: `IDLE_IN_CAR_BASE`, ramping (multiplied by ticks stalled)
- State thresholds: `CALM_MAX`, `ANNOYED_MAX`, `ANGRY_MAX`, `FURIOUS_MAX` → `gave-up` at `GIVE_UP_THRESHOLD`
- `VIP_WEIGHT_MULTIPLIER = 10`

## Phases (commit at the end of each; repo stays green throughout)

1. **Sim core** — rng, building/car/passenger types, physics, frustration
   model, dispatch stub (naive FCFS only), `runShift`. No UI. Prove it with a
   CLI script producing a text dump of a shift (per-tick summary + final
   report) run via `tsx` or a Vitest snapshot. Tests: RNG determinism,
   frustration curves, determinism test (same seed+policy twice → deep-equal
   `SimResult`).
2. **Canvas renderer + playback** — shaft/car/passenger drawing, frame
   interpolation, play/pause/speed/scrub controls reading a precomputed
   `SimResult`. Still only the naive policy; no editor yet.
3. **Policy engine + presets + parameter panel** — full condition/action
   catalog (unrestricted, all unlocked, for dev purposes), FCFS/SCAN/LOOK
   presets, parameter sliders/toggles wired to `DispatchPolicy.parameters`.
   Tests: each preset's qualitative behavior (e.g. SCAN beats FCFS on the
   rush-hour generator by composite score), two-car call-claiming.
4. **Rule editor** — drag-to-reorder rule list UI, add/remove/toggle rules
   from the catalog, live highlight of the firing rule during playback.
5. **Levels, scoring, report, persistence** — the 7 levels as data, star
   thresholds, end-of-shift report with scrubbable timeline and "worst
   moments" list, localStorage persistence of policies + progress, per-level
   condition/action unlocks wired into the editor.
6. **Polish** — control-panel visual design pass (one signature element,
   dot-matrix/inspection-tag/brushed-metal treatment), optional sound
   (off by default), accessibility pass (focus states, contrast, keyboard
   drag-reorder, tablet-width responsiveness).

`README.md` written last, once the game exists.

## Open (non-blocking) defaults I'm picking — override if you want different

- Shift length: default levels run **4–6 minutes of simulated time**
  (~5–7k ticks at 20/s) — long enough for patterns to matter, short enough to
  replay quickly while iterating.
- Composite score: weighted sum of (delivered ratio, −avg wait, −worst wait,
  −give-ups, −total frustration), weights in `levels/scoring.ts`, tuned per
  level's star thresholds rather than globally fixed.
- Playback speeds: 1x/2x/4x/8x plus scrub; no true "unlimited fast-forward"
  in v1 since the whole shift is already precomputed instantly — "speed"
  only affects how fast the playhead advances.

Waiting for your go-ahead before writing implementation code.
