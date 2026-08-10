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
   to happen.
2. Load a preset (Naive FCFS, SCAN, or LOOK) or start from scratch. Adjust
   the parameters (lookahead distance, capacity reserve, door dwell, idle
   parking, reverse-direction pickup) and the rule list (drag to reorder,
   or use the ↑/↓ buttons — both work identically).
3. **Run shift.** The whole shift computes instantly; playback is just a
   scrub through the result, so pause/scrub/rewind are free and the live
   "which rule fired" highlight in the rule list is exact, not a guess.
4. Read the report: composite score, stars, and a ranked list of worst
   moments. Click one to jump the playhead straight to it.
5. Change one thing. Run it again on the same seed. The result is
   byte-identical unless the policy changed — this is the whole point.

## Architecture

```
src/
  sim/       pure simulation core — zero React, zero DOM, seeded PRNG only.
             Runnable and testable in plain Node. Building/car/passenger
             types, kinematic physics, the door state machine, the
             frustration model (every constant named and commented in
             config.ts), and runShift(), which computes an entire shift
             synchronously into an immutable SimResult.
  policy/    the rule engine. DispatchPolicy = parameters + an ordered list
             of Rules (AND-combined conditions -> one action). catalog.ts
             is the registry of condition/action implementations;
             ruleEngine.ts evaluates a policy's rules top-down and
             implements the same DispatchStrategy interface simulate.ts
             already knows how to call — the sim core has no idea policies
             exist. presets.ts ships Naive FCFS, SCAN, and LOOK as data.
  levels/    level definitions (fixed seed, traffic spec, star thresholds,
             which catalog entries a level unlocks), the composite scoring
             formula, and the worst-moments report generator.
  render/    canvas drawing and the playback driver. Imperative, driven by
             its own requestAnimationFrame loop — the simulation is never
             re-rendered through React state per tick.
  store/     zustand: current policy draft (editorStore), playback state
             (playbackStore), saved policies + level progress, persisted to
             localStorage (progressStore).
  ui/        React. ui/viewport/ElevatorViewport is the main game surface —
             a responsive canvas (resizes with the window via
             ResizeObserver) showing the building, idle before the first
             run and fully played back after. Everything else (parameter
             panel, rule editor, saved policies, report) lives in a tabbed
             sidebar next to it, not stacked above/below it.
  audio/     a handful of synthesized tones (Web Audio API, no audio
             files), off by default.
tests/       mirrors src/. Vitest.
scripts/     dump-run.ts (text dump of a shift) and check-levels.ts (preset
             scores across every level) — dev tools, not part of the app.
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
`src/policy` reads `Date.now()`, `Math.random()`, or the DOM. Playback
doesn't run the simulation again — it's a scrub through the one array of
frames and events `runShift` already produced. `tests/sim/simulate.test.ts`
asserts this directly: the same seed and policy, run twice, produce a
byte-identical serialized result.

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
