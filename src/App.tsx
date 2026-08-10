import { useState } from 'react';
import { createPolicyDispatch } from './policy/ruleEngine';
import { TICK_RATE } from './sim/config';
import type { BuildingSpec } from './sim/building';
import { runShift, type SimResult } from './sim/simulate';
import type { PassengerGenSpec } from './sim/passengerGenerator';
import { useEditorStore } from './store/editorStore';
import { ParameterPanel } from './ui/editor/ParameterPanel';
import { RuleEditor } from './ui/editor/RuleEditor';
import { RunView } from './ui/run/RunView';

const DEMO_BUILDING: BuildingSpec = { floors: 10, carCount: 1, capacityPerCar: 8 };
const DEMO_SEED = 42;
const DEMO_DURATION_TICKS = 5 * 60 * TICK_RATE;
const DEMO_PASSENGER_SPEC: PassengerGenSpec = {
  meanArrivalsPerMinute: 6,
  originFloorWeights: [10, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  destinationBias: 'up',
  traitChances: { impatient: 0.15, heavy: 0.05, vip: 0.03, luggage: 0.05 },
};

export function App(): JSX.Element {
  const [result, setResult] = useState<SimResult | null>(null);
  const policyName = useEditorStore((s) => s.policy.name);

  function runShiftWithCurrentPolicy(): void {
    const policy = useEditorStore.getState().policy;
    setResult(
      runShift({
        building: DEMO_BUILDING,
        seed: DEMO_SEED,
        durationTicks: DEMO_DURATION_TICKS,
        passengerGenSpec: DEMO_PASSENGER_SPEC,
        dispatch: createPolicyDispatch(policy),
      }),
    );
  }

  return (
    <main>
      <h1>Elevator Pitch</h1>
      <p>Service panel under construction. Dispatch policy: {policyName} (demo, seed {DEMO_SEED}).</p>
      <ParameterPanel floors={DEMO_BUILDING.floors} />
      <RuleEditor />
      <button type="button" onClick={runShiftWithCurrentPolicy}>
        Run shift
      </button>
      {result && <RunView result={result} floors={DEMO_BUILDING.floors} carCount={DEMO_BUILDING.carCount} />}
    </main>
  );
}
