import { useMemo, useState } from 'react';
import { cumulativeUnlocksThrough, getLevel, LEVELS } from './levels';
import { runLevel } from './levels/runLevel';
import { computeCompositeScore, computeStars, type StarRating } from './levels/scoring';
import { createPolicyDispatch } from './policy/ruleEngine';
import type { SimResult } from './sim/simulate';
import { useEditorStore } from './store/editorStore';
import { useProgressStore } from './store/progressStore';
import { ParameterPanel } from './ui/editor/ParameterPanel';
import { RuleEditor } from './ui/editor/RuleEditor';
import { SavedPolicies } from './ui/editor/SavedPolicies';
import { ShiftReport } from './ui/report/ShiftReport';
import { RunView } from './ui/run/RunView';

function starGlyphs(stars: StarRating): string {
  return '★★★☆☆☆'.slice(3 - stars, 6 - stars);
}

export function App(): JSX.Element {
  const [selectedLevelId, setSelectedLevelId] = useState(LEVELS[0]!.id);
  const [result, setResult] = useState<SimResult | null>(null);
  const policyName = useEditorStore((s) => s.policy.name);
  const levelProgress = useProgressStore((s) => s.levelProgress);

  const level = getLevel(selectedLevelId) ?? LEVELS[0]!;
  const unlocks = useMemo(() => cumulativeUnlocksThrough(selectedLevelId), [selectedLevelId]);

  function selectLevel(levelId: string): void {
    setSelectedLevelId(levelId);
    setResult(null);
  }

  function runShiftWithCurrentPolicy(): void {
    const policy = useEditorStore.getState().policy;
    const shiftResult = runLevel(level, createPolicyDispatch(policy));
    setResult(shiftResult);

    const composite = computeCompositeScore(shiftResult.score);
    const stars = computeStars(composite, level.starThresholds);
    useProgressStore.getState().recordLevelResult(level.id, stars, composite);
  }

  return (
    <main>
      <h1>Elevator Pitch</h1>

      <nav aria-label="Level select">
        <h2>Levels</h2>
        <ol>
          {LEVELS.map((l) => {
            const progress = levelProgress[l.id];
            return (
              <li key={l.id}>
                <button type="button" onClick={() => selectLevel(l.id)} aria-pressed={l.id === selectedLevelId}>
                  {l.name} {progress ? starGlyphs(progress.stars) : ''}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <article aria-label="Level briefing">
        <h2>{level.name}</h2>
        <p>{level.briefing}</p>
      </article>

      <p>Dispatch policy: {policyName}</p>
      <ParameterPanel floors={level.floors} />
      <RuleEditor unlockedConditions={unlocks.conditions} unlockedActions={unlocks.actions} />
      <SavedPolicies />
      <button type="button" onClick={runShiftWithCurrentPolicy}>
        Run shift
      </button>

      {result && (
        <>
          <RunView result={result} floors={level.floors} carCount={level.carCount} />
          <ShiftReport result={result} starThresholds={level.starThresholds} />
        </>
      )}
    </main>
  );
}
