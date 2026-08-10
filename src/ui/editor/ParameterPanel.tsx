import { BASE_MIN_DOOR_DWELL_TICKS, TICK_RATE } from '../../sim/config';
import { useEditorStore } from '../../store/editorStore';

const LOOKAHEAD_MAX = 20;
const MAX_DOOR_DWELL_TICKS = 60;

export interface ParameterPanelProps {
  floors: number;
}

export function ParameterPanel({ floors }: ParameterPanelProps): JSX.Element {
  const policy = useEditorStore((s) => s.policy);
  const { setParameter } = useEditorStore.getState();
  const params = policy.parameters;

  return (
    <section aria-label="Dispatch policy parameters">
      <h2>Policy: {policy.name}</h2>

      <fieldset>
        <legend>Lookahead distance</legend>
        <label>
          {params.lookaheadFloors === Infinity ? 'Unlimited' : `${params.lookaheadFloors} floors`}
          <input
            type="range"
            min={1}
            max={LOOKAHEAD_MAX}
            step={1}
            value={params.lookaheadFloors === Infinity ? LOOKAHEAD_MAX : params.lookaheadFloors}
            onChange={(e) => {
              const value = Number(e.target.value);
              setParameter('lookaheadFloors', value >= LOOKAHEAD_MAX ? Infinity : value);
            }}
          />
        </label>
        <p>Calls farther than this from a car are invisible to it for that decision.</p>
      </fieldset>

      <fieldset>
        <legend>Minimum door dwell</legend>
        <label>
          {(params.minDoorDwellTicks / TICK_RATE).toFixed(1)}s
          <input
            type="range"
            min={BASE_MIN_DOOR_DWELL_TICKS}
            max={MAX_DOOR_DWELL_TICKS}
            step={1}
            value={params.minDoorDwellTicks}
            onChange={(e) => setParameter('minDoorDwellTicks', Number(e.target.value))}
          />
        </label>
        <p>Doors never close faster than this, even with nobody to board or alight.</p>
      </fieldset>

      <fieldset>
        <legend>Capacity reserve</legend>
        <label>
          {Math.round(params.capacityReserve * 100)}%
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={Math.round(params.capacityReserve * 100)}
            onChange={(e) => setParameter('capacityReserve', Number(e.target.value) / 100)}
          />
        </label>
        <p>Fraction of each car held back — boarding stops early to leave room in reserve.</p>
      </fieldset>

      <fieldset>
        <legend>Idle parking</legend>
        <label>
          <input
            type="checkbox"
            checked={params.idleParkingFloor === null}
            onChange={(e) => setParameter('idleParkingFloor', e.target.checked ? null : 0)}
          />
          Stay wherever last stopped
        </label>
        {params.idleParkingFloor !== null && (
          <label>
            Park at floor {params.idleParkingFloor}
            <input
              type="range"
              min={0}
              max={Math.max(0, floors - 1)}
              step={1}
              value={params.idleParkingFloor}
              onChange={(e) => setParameter('idleParkingFloor', Number(e.target.value))}
            />
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend>Reverse-direction pickup</legend>
        <label>
          <input
            type="checkbox"
            checked={params.acceptReverseDirectionPickup}
            onChange={(e) => setParameter('acceptReverseDirectionPickup', e.target.checked)}
          />
          Accept hall calls going the opposite way while sweeping
        </label>
      </fieldset>
    </section>
  );
}
