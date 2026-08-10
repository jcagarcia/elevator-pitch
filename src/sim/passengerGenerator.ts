import { TICK_RATE } from './config';
import { chance, exponentialSample, weightedIndex, type Rng } from './rng';
import { emptyFrustrationBySource, type Passenger, type Trait } from './types';

const ALL_TRAITS: readonly Trait[] = ['impatient', 'heavy', 'vip', 'luggage'];

export interface PassengerGenSpec {
  /** Average number of new passengers per simulated minute. */
  meanArrivalsPerMinute: number;
  /** Relative weight per floor for where passengers originate. Length must
   *  equal the building's floor count. Defaults to uniform. */
  originFloorWeights?: readonly number[];
  /** Skews destination choice: 'up' picks only floors above the origin (or
   *  below, if origin is the top floor), 'down' the mirror, 'none' is
   *  uniform over every other floor. Defaults to 'none'. */
  destinationBias?: 'up' | 'down' | 'none';
  /** Independent per-passenger probability of rolling each trait. Traits
   *  are not mutually exclusive. */
  traitChances?: Partial<Record<Trait, number>>;
}

/** Deterministically generates the full passenger roster for a shift from a
 *  seeded RNG. Consumes the RNG stream in a fixed order per passenger
 *  (arrival gap, origin, destination, then each trait in ALL_TRAITS order)
 *  so the same seed always produces the same roster. */
export function generatePassengers(
  rng: Rng,
  spec: PassengerGenSpec,
  floors: number,
  durationTicks: number,
): Passenger[] {
  const originWeights = spec.originFloorWeights ?? Array<number>(floors).fill(1);
  if (originWeights.length !== floors) {
    throw new Error(`originFloorWeights length (${originWeights.length}) must equal floors (${floors}).`);
  }
  const meanRatePerTick = spec.meanArrivalsPerMinute / (60 * TICK_RATE);
  const bias = spec.destinationBias ?? 'none';
  const traitChances = spec.traitChances ?? {};

  const passengers: Passenger[] = [];
  let clock = 0;
  let nextId = 0;

  for (;;) {
    clock += exponentialSample(rng, meanRatePerTick);
    const spawnTick = Math.round(clock);
    if (spawnTick >= durationTicks) break;

    const originFloor = weightedIndex(rng, originWeights);
    const destFloor = pickDestination(rng, originFloor, floors, bias);
    const traits = ALL_TRAITS.filter((trait) => chance(rng, traitChances[trait] ?? 0));

    passengers.push({
      id: nextId++,
      originFloor,
      destFloor,
      spawnTick,
      traits,
      state: 'waiting',
      frustration: 0,
      frustrationBySource: emptyFrustrationBySource(),
      carId: null,
      boardedTick: null,
      deliveredTick: null,
      stalledTicks: 0,
    });
  }

  return passengers;
}

function pickDestination(rng: Rng, originFloor: number, floors: number, bias: 'up' | 'down' | 'none'): number {
  const candidates: number[] = [];
  for (let floor = 0; floor < floors; floor++) {
    if (floor === originFloor) continue;
    if (bias === 'up' && floor < originFloor) continue;
    if (bias === 'down' && floor > originFloor) continue;
    candidates.push(floor);
  }
  if (candidates.length === 0) {
    // Origin is at the extreme end for the requested bias (e.g. top floor,
    // bias 'up') — fall back to every other floor.
    for (let floor = 0; floor < floors; floor++) {
      if (floor !== originFloor) candidates.push(floor);
    }
  }
  const index = weightedIndex(rng, candidates.map(() => 1));
  const destination = candidates[index];
  if (destination === undefined) {
    throw new Error('pickDestination: no candidate floors available.');
  }
  return destination;
}
