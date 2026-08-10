import { useState } from 'react';
import { TICK_RATE } from './sim/config';
import { naiveFcfsDispatch } from './sim/dispatch';
import { runShift, type ShiftConfig, type SimResult } from './sim/simulate';
import { RunView } from './ui/run/RunView';

const DEMO_CONFIG: ShiftConfig = {
  building: { floors: 10, carCount: 1, capacityPerCar: 8 },
  seed: 42,
  durationTicks: 5 * 60 * TICK_RATE,
  passengerGenSpec: {
    meanArrivalsPerMinute: 6,
    originFloorWeights: [10, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    destinationBias: 'up',
    traitChances: { impatient: 0.15, heavy: 0.05, vip: 0.03, luggage: 0.05 },
  },
  dispatch: naiveFcfsDispatch,
};

export function App(): JSX.Element {
  const [result, setResult] = useState<SimResult | null>(null);

  return (
    <main>
      <h1>Elevator Pitch</h1>
      <p>Service panel under construction. Dispatch policy: {DEMO_CONFIG.dispatch.name} (demo, seed {DEMO_CONFIG.seed}).</p>
      <button type="button" onClick={() => setResult(runShift(DEMO_CONFIG))}>
        Run shift
      </button>
      {result && <RunView result={result} floors={DEMO_CONFIG.building.floors} carCount={DEMO_CONFIG.building.carCount} />}
    </main>
  );
}
