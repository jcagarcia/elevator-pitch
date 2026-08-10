/**
 * Dev proof: runs a shift with the naive FCFS dispatch and prints a text
 * summary. Run with `npm run dump-run`. This is the Phase 1 "prove it
 * works" artifact called for in PLAN.md — no UI needed to see the sim work.
 */
import { naiveFcfsDispatch } from '../src/sim/dispatch';
import { frustrationState } from '../src/sim/frustration';
import { runShift, type ShiftConfig } from '../src/sim/simulate';
import { TICK_RATE } from '../src/sim/config';

const config: ShiftConfig = {
  building: { floors: 10, carCount: 1, capacityPerCar: 8 },
  seed: 42,
  durationTicks: 5 * 60 * TICK_RATE, // 5 simulated minutes
  passengerGenSpec: {
    meanArrivalsPerMinute: 6,
    originFloorWeights: [10, 1, 1, 1, 1, 1, 1, 1, 1, 1], // lobby-heavy, morning-rush-ish
    destinationBias: 'up',
    traitChances: { impatient: 0.15, heavy: 0.05, vip: 0.03, luggage: 0.05 },
  },
  dispatch: naiveFcfsDispatch,
};

function formatTick(tick: number): string {
  const totalSeconds = Math.floor(tick / TICK_RATE);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const result = runShift(config);

console.log(`=== Elevator Pitch — shift dump (seed ${config.seed}, dispatch: ${config.dispatch.name}) ===\n`);

console.log('-- Notable events --');
const notable = result.events.filter((e) =>
  ['passed-by', 'doors-reopened', 'gave-up', 'delivered'].includes(e.type),
);
for (const event of notable.slice(0, 40)) {
  console.log(`[${formatTick(event.tick)}] ${event.type} ${JSON.stringify(event)}`);
}
console.log(`... (${notable.length} notable events total)\n`);

console.log('-- Final passenger states --');
for (const passenger of result.passengers.slice(0, 20)) {
  const waited = (passenger.boardedTick ?? passenger.deliveredTick ?? passenger.spawnTick) - passenger.spawnTick;
  console.log(
    `#${passenger.id} floor ${passenger.originFloor}->${passenger.destFloor} ` +
      `[${passenger.traits.join(',') || 'none'}] state=${passenger.state} ` +
      `frustration=${passenger.frustration.toFixed(1)} (${frustrationState(passenger.frustration)}) ` +
      `waited=${waited}t`,
  );
}
console.log(`... (${result.passengers.length} passengers total)\n`);

console.log('-- Score --');
console.log(result.score);
