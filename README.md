# Elevator Pitch

You are the building's elevator technician. You never touch a button. Your
job is to tune the dispatch policy — parameters and an ordered list of
rules — and then watch, in silence, as the elevator does exactly what you
told it to and the passengers react accordingly. Loudly.

Run a shift. Read the report. Find out which decision cost you the most.
Change one thing. Run it again on the same seed. See if it actually helped.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test            # vitest, run once
npm run build       # typecheck + production build
```

Other useful scripts:

```bash
npm run dump-run      # text dump of a shift with no UI — proves the sim works standalone
npm run check-levels  # runs all three presets against all seven levels, prints scores
npm run typecheck     # tsc -b --noEmit
npm run lint           # eslint
```

## The loop

1. Pick a level. Each one is a fixed building, a fixed seeded traffic
   pattern, and a duration — read the briefing, it tells you what's about
   to happen. The level starts immediately, loaded with the SCAN preset and
   running live — there's no separate "run" button.
2. While it's running, edit the policy: load a different preset (Naive
   FCFS, SCAN, LOOK) or adjust it from scratch — parameters (lookahead
   distance, capacity reserve, door dwell, idle parking, reverse-direction
   pickup) and the rule list (drag to reorder, or the ↑/↓ buttons). Changes
   land on the very next simulated tick, not on some future re-run — watch
   the elevator react to what you just did.
3. Watch the morale meter. It's the pressure you're managing: cumulative
   penalty for everyone who's given up and walked to the stairs, plus the
   average frustration of everyone still waiting or riding. If it collapses
   below the failure threshold, the shift ends early — "service
   interrupted" — and the stairwell fills with the people you lost.
4. If the shift instead runs its full duration, it ends successfully and
   the viewport switches into a review phase: the same canvas, now
   scrubbable start to finish, with the live "which rule fired" highlight
   in the rule list exact for any point you scrub to (not a guess).
5. Read the report: composite score, stars, and a ranked list of worst
   moments. Click one to jump the playhead straight to it.
6. **Restart shift** to try again on the same level with whatever policy
   you currently have loaded (picking a *different* level instead resets to
   the SCAN baseline — see "Live mode" below for why re-runs on an edited
   live policy aren't byte-identical the way a fixed batch run is).

## Architecture

```
src/
  sim/       pure simulation core — zero React, zero DOM, seeded PRNG only.
             Runnable and testable in plain Node. Building/car/passenger
             types, kinematic physics, the door state machine, the
             frustration model (every constant named and commented in
             config.ts). simulate.ts exposes both layers on top of that:
             the steppable primitives (initLiveSim/stepLiveSim/
             isLiveSimFinished — advance exactly one tick against whatever
             DispatchStrategy is passed *that call*) and runShift(), a thin
             loop over those primitives that runs an entire shift against
             one fixed strategy synchronously into an immutable SimResult.
  policy/    the rule engine. DispatchPolicy = parameters + an ordered list
             of Rules (AND-combined conditions -> one action). catalog.ts
             is the registry of condition/action implementations;
             ruleEngine.ts evaluates a policy's rules top-down and
             implements the same DispatchStrategy interface simulate.ts
             already knows how to call — the sim core has no idea policies
             exist. presets.ts ships Naive FCFS, SCAN, and LOOK as data.
  levels/    level definitions (fixed seed, traffic spec, star thresholds,
             which catalog entries a level unlocks), the end-of-shift
             composite scoring formula, the worst-moments report generator,
             and liveScore.ts's computeLiveMorale — a deliberately
             different, streaming-friendly metric for the live HUD (see
             "Live mode" below for why it isn't the same formula).
  render/    canvas drawing plus two independent rAF-driven controllers.
             playback.ts's PlaybackDriver scrubs an already-computed
             SimResult (review phase, and the old batch flow). liveRun.ts's
             LiveRunController instead steps a live sim forward in real
             time, tick by tick, rebuilding the DispatchStrategy from the
             current policy before every single tick. stairwellAnimator.ts
             is a small wall-clock-driven (not sim-tick-driven) tracker for
             the "walking to the stairs" dots — cosmetic only, never read
             by the simulation. Nothing here re-renders the simulation
             through React state per tick.
  store/     zustand: current policy draft (editorStore), playback/live-run
             transport state — play/pause, speed, current tick, active-rule
             highlight (playbackStore, shared by both phases), saved
             policies + level progress persisted to localStorage
             (progressStore).
  ui/        React. ui/viewport/ElevatorViewport is the main game surface —
             a responsive canvas (resizes with the window via
             ResizeObserver) that owns a live/review phase switch: a level
             starts it running live immediately, and it flips to review
             once the shift ends (success or failure) so the finished
             result can be scrubbed. Everything else (parameter panel, rule
             editor, saved policies, report) lives in a tabbed sidebar next
             to it, not stacked above/below it.
  audio/     a handful of synthesized tones (Web Audio API, no audio
             files), off by default.
tests/       mirrors src/. Vitest.
scripts/     dump-run.ts (text dump of a shift), check-levels.ts (preset
             scores across every level), and check-live-morale.ts (tunes/
             verifies the live morale constants — how long a good, a
             mediocre, and a deliberately broken policy each survive) — dev
             tools, not part of the app.
```

The dependency direction is strict: `sim` knows nothing above it; `policy`
depends only on `sim`; `render` and `ui` depend on both but never the
reverse. `policy/ruleEngine.ts` plugging into `sim/simulate.ts` through the
`DispatchStrategy` interface is the seam that let the rule engine (phase 3)
replace the hardcoded naive-FCFS stub (phase 1) without changing a line of
the sim loop.

## Determinism

`runShift(config)` is a pure function of its input: a seed, a building, a
passenger generator spec, and a dispatch strategy. Nothing in `src/sim` or
`src/policy` reads `Date.now()`, `Math.random()`, or the DOM. Review-phase
playback doesn't run the simulation again — it's a scrub through the one
array of frames and events the finished shift already produced.
`tests/sim/simulate.test.ts` asserts this directly: the same seed and
policy, run twice through `runShift`, produce a byte-identical serialized
result — and separately, that stepping a `LiveSim` one tick at a time via
`stepLiveSim` produces exactly the same frames as `runShift` did, tick for
tick, when driven by the same fixed strategy throughout.

### Live mode

The passenger roster (who spawns when, wanting what) is generated up front
from the seed and stays fixed for the whole shift — that part is still
deterministic. What isn't: while a shift is live, `LiveRunController`
rebuilds the `DispatchStrategy` from whatever policy is currently loaded
before *every tick* (see `src/render/liveRun.ts`), so if the player edits a
parameter or reorders a rule mid-shift, the outcome from that point on
depends on the real-time sequence of edits — not just the seed and a fixed
policy. Re-running the same level with the same policy and never touching
it during the run is still byte-identical to a `runShift` batch call (this
is exactly what the equivalence tests above check); it's live editing
specifically, the whole point of the mode, that trades that guarantee away.
The live morale score (`computeLiveMorale`) is deliberately a different
formula from the end-of-shift composite score, too — a ratio-based score is
misleading on the tiny, early sample a live HUD has to work with (0
delivered of 1 spawned reads as a disaster that isn't one), so the live
metric instead tracks a permanent penalty for each passenger who's given up
plus the average frustration of whoever's still active — see
`scripts/check-live-morale.ts` for how the constants were tuned.

## The anger model

Frustration is per-passenger, accrues per tick, and every source is
attributed separately (`Passenger.frustrationBySource`) so the report can
say which decision cost the points. Continuous sources (hall wait, ride
time, crowding, idle-in-car) accumulate silently; discrete/spike sources
(passed-by, detour stop, doors reopened, gave-up) each get an event in the
log, which is what the end-of-shift report's worst-moments list is built
from.

Every constant is named and commented in `src/sim/config.ts` — hall-wait's
superlinear curve, the give-up threshold, the VIP weight multiplier, all of
it. It's meant to be rebalanced constantly; nothing else in the sim depends
on the specific numbers.

## Levels

Seven, in order, each unlocking more of the rule catalog:

1. **Morning Rush** — lobby-heavy, one direction. The basics.
2. **Evening Down-Peak** — the reverse. Whatever you tuned for level 1 gets
   tested against opposite traffic.
3. **Lunch Scatter** — inter-floor, no dominant direction.
4. **The VIP** — one passenger weighted 10x, unannounced, guaranteed to
   spawn (not left to chance the way ordinary traffic is).
5. **Capacity Crunch** — more demand than one car can serve. The job is
   leaving people behind gracefully, not never leaving anyone behind.
6. **Stuck Sensor** — one floor's hall call is only visible on a fixed duty
   cycle. Normal dispatch conditions can't see it reliably; a
   "call waited longer than N seconds → treat as highest priority" rule
   deliberately bypasses that filter, which is what unlocks here.
7. **Two Cars** — coordination. The dispatcher itself won't let two cars
   claim the same call (that failure mode is structurally prevented, see
   `policy/ruleEngine.ts`'s claim/release logic) — the remaining challenge
   is covering the building instead of clustering.

## Testing

Vitest, mirroring `src/`. Notably:

- `tests/sim/simulate.test.ts` — the determinism guarantee, plus sanity
  checks (capacity never exceeded, delivered passengers end up where they
  said they would).
- `tests/sim/frustration.test.ts` — curve shapes (hall wait is superlinear,
  passed-by is the biggest single spike, VIP is a flat 10x on every source).
- `tests/policy/presets.test.ts` — SCAN vs. LOOK's reversal behavior against
  hand-built car/state fixtures (not just score comparisons, which can mask
  the actual mechanism), two-car call claiming and release, and an
  end-to-end ordering check.
- `tests/policy/faultySensor.test.ts` — the Stuck Sensor mechanic: hidden
  during the invisible window, visible during the duty cycle, and reachable
  through the timeout override regardless.
- `tests/levels/scoring.test.ts` — composite score monotonicity and bounds.
- `tests/render/liveRun.test.ts` — `LiveRunController` against a fake rAF
  clock: stays paused when told to, steps roughly `TICK_RATE * speed` ticks
  per real second, picks up a policy switch on the very next tick, and
  reports `succeeded`/`failed` at the right moments.
- `tests/levels/liveScore.test.ts` — the live morale formula in isolation.
- `tests/render/stairwellAnimator.test.ts` — walker lifecycle (added on
  gave-up, progresses, pruned once its walk duration elapses).

## Design notes

The visual language is a service panel installed sometime in the 90s and
never replaced: worn brushed metal, riveted panel borders, warning-tag
amber, monospace throughout. One signature element carries the boldness —
the dot-matrix floor/clock readout (`src/ui/DotMatrixDisplay.tsx`) — and
everything else stays quiet on purpose. Copy is written in the voice of a
maintenance manual: "Run shift," not "Start simulation!"

Sound is a handful of synthesized tones (no audio files), off by default,
one checkbox to turn on.

## What's not here yet

- Level balance (star thresholds, traffic parameters) is a first pass, not
  a final one — `npm run check-levels` is there specifically so it's cheap
  to check after changing constants.
- `directionCommitThreshold` exists in `DispatchParameters` for a stable
  saved-policy shape but has no consumer yet and so isn't exposed in the
  parameter panel — a slider with no effect would be worse than no slider.
- No further level content beyond the seven the brief calls for.

## Two bugs worth knowing about

Both were caught by actually running the simulation against realistic
traffic and looking at the numbers, not by tests going green:

1. **Physics oscillation.** `advanceCarPosition` could jitter forever
   around a target instead of arriving, whenever the remaining distance was
   smaller than one tick's acceleration step. Fixed by clamping to the
   target and zeroing velocity whenever a tick's move would reach or pass
   it, instead of relying on a distance epsilon after the fact.
2. **Direction starvation.** A car's `committedDirection` never reset after
   emptying out mid-shift, so once it happened to commit to a direction
   with no current demand, every condition that reads hall calls stayed
   blind to the opposite direction — permanently, even on a scenario where
   *all* traffic wanted that direction. Delivery dropped from 46/57 to
   3/57 on one otherwise-ordinary scenario before the fix. See the "Direction
   starvation" commit in the log, or `policy/ruleEngine.ts`'s
   `directionIsProtected` comment, for the full mechanism.
