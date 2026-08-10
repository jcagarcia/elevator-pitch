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
   to happen. The level starts immediately, loaded with a blank policy —
   no rules, default parameters — and running live at a fixed 1x pace.
   There's no "run" button, no pause, and no speed control: this is a
   real-time game, not a simulation you drive.
2. The car won't move on its own — with zero rules it just sits at floor 0.
   Build the policy live, elsewhere in the UI, under real passengers: the
   parameter panel and the rule editor share a single "Policy" tab (drag
   rules to reorder, or use the ↑/↓ buttons). Changes land on the very next
   simulated tick, not on some future re-run — watch the elevator react to
   what you just did, in real time, with nothing to pause or rewind.
3. Watch the morale meter. It's the pressure you're managing: cumulative
   penalty for everyone who's given up and walked to the stairs, plus the
   average frustration of everyone still waiting or riding. If it collapses
   below the failure threshold, the shift ends early — "service
   interrupted" — and the stairwell fills with the people you lost.
4. If the shift instead runs its full duration, it ends successfully and
   the shaft holds on its final frame while the status banner and report
   explain what happened.
5. Read the report: composite score, stars, and a ranked list of worst
   moments.
6. **Restart shift** to try again on the same level — this resets the
   policy back to the same blank slate a fresh level starts with (see
   "Live mode" below for why re-runs on an edited live policy aren't
   byte-identical the way a fixed batch run is). Nothing is ever saved
   between shifts; there's no "load my best policy" — every attempt is
   built from scratch, live.

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
  render/    liveRun.ts's LiveRunController is the one rAF-driven
             controller left — no canvas, no scrub/replay driver. It steps
             a live sim forward in real time, tick by tick, rebuilding the
             DispatchStrategy from the current policy before every single
             tick. getSpeed/getIsPaused keep the engine itself capable of
             pause/variable speed even though the game always calls it
             with fixed values (1x, never paused) — the player has no
             control over either. sceneBuilder.ts turns a passenger roster
             + a tick into per-floor waiting lists and per-car rider lists
             — a pure function of (passengers, tick, frustrationAt) — plus
             frustrationToProgress, the mapping from a passenger's raw
             frustration number onto PassengerFigure's 0-4 posture scale.
             ruleHighlight.ts's ruleFiredPulseAt turns a car's rule-fired
             events into a bounded "still inside its ~0.6s pulse window"
             check (not a persistent "currently active" flag) for the rule
             panel.
  store/     zustand: current policy draft (editorStore), which rule is
             currently pulsing — shared between the Shift Screen's
             read-only rule panel and the Policy tab's rule editor so both
             flash in step (ruleFireStore), and level progress (stars,
             best composite score) persisted to localStorage
             (progressStore). Nothing about the policy itself persists —
             every shift starts from the same blank slate.
  ui/        React. PassengerFigure.tsx is the signature element — see
             "Design notes" below. ui/viewport/ElevatorViewport is the main
             game surface: the DOM "Shift Screen" (top bar, shaft, rule
             panel). A level starts it running live immediately; once the
             shift ends, the LiveRunController simply stops calling back,
             so re-deriving the scene from the sim's now-frozen state
             naturally holds on the final frame — there's no separate
             review/scrub data path to keep in sync. Every tick's scene
             (car position/doors, per-floor waiting figures, the rule
             pulse) is derived fresh via sceneBuilder.ts, not accumulated
             as extra state. Everything else (the merged parameter+rule
             "Policy" tab, the report) lives in a tabbed sidebar next to
             it, not stacked above/below it.
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
`src/policy` reads `Date.now()`, `Math.random()`, or the DOM.
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
- `tests/render/sceneBuilder.test.ts` — frustrationToProgress's band
  mapping and monotonicity, and buildFloorScenes/ridersOfCar's filtering
  (excludes riding/delivered/not-yet-spawned passengers, keeps a
  just-gave-up passenger as a fading "exiting" entry until its grace window
  elapses, sorts worst-first).
- `tests/render/ruleHighlight.test.ts` — ruleFiredPulseAt's pulse window:
  lit while inside it, off once it elapses even with no newer firing, and
  never lights up for a fall-through (null-ruleId) decision.

## Design notes

The visual language follows the "Elevator frustration gauge" design
handoff: chunky "juicy" 2D game UI — thick ink outlines, hard offset
drop-shadows (no blur), punchy flat color, press-down buttons — layered
over a building-maintenance material world (a worn-beige shaft interior,
warning orange/yellow, amber LED-style digit readouts). Oswald for
display/headers, IBM Plex Sans for body, IBM Plex Mono for every data
readout (timers, rule conditions, the floor digit).

The signature element is `src/ui/PassengerFigure.tsx` — a two-shape
passenger (circle head, rounded-rect torso, tick-mark foot) whose posture
is the primary frustration encoding: lean angle, foot-tap tempo, a pacing
drift, and a breathing "squash," all continuous with how frustrated the
passenger is. A mounted dial (needle angle plus a crosshatch texture that
ramps in with frustration) is the colorblind-safe second encoding — angle
and texture density carry the signal independent of the dial's hue, which
only shifts along the same ramp for sighted users. Only the worst-off
waiting passenger on a floor gets a dial, to avoid clutter. The shaft
itself is plain DOM/CSS (see "Architecture" above) — no canvas — which is
what makes per-figure continuous animation like this practical: each
figure owns its own small rAF loop, keyed by passenger id so reordering
the (worst-first) waiting list never resets one mid-animation.

The Shift Screen is deliberately the loudest part of the app; the sidebar
(the merged Policy tab, the report) reuses the same tokens — panels,
buttons, sliders — but stays visually quieter, since it's where the player
reads and clicks rather than watches. Copy is written in the voice of a
maintenance manual: "Restart shift," not "Reset simulation!"

Sound is a handful of synthesized tones (no audio files), off by default,
one checkbox to turn on.

`prefers-reduced-motion` is handled inside PassengerFigure itself: it
keeps the interpolated pose (lean angle, dial needle angle, dial hue/
crosshatch — the actual signal) but cuts the continuous tap/pace/squash
oscillation, which only exists as a peripheral-vision motion-density cue.

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
