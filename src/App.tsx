import { useMemo, useState } from 'react';
import { cumulativeUnlocksThrough, getLevel, isLevelUnlocked, LEVELS } from './levels';
import { computeCompositeScore, computeStars, type StarRating } from './levels/scoring';
import { BLANK_POLICY } from './policy/presets';
import type { SimResult } from './sim/simulate';
import { useEditorStore } from './store/editorStore';
import { useProgressStore } from './store/progressStore';
import { ParameterPanel } from './ui/editor/ParameterPanel';
import { RuleEditor } from './ui/editor/RuleEditor';
import { ShiftReport } from './ui/report/ShiftReport';
import { ElevatorViewport } from './ui/viewport/ElevatorViewport';

type SidebarTab = 'policy' | 'report';

const SIDEBAR_TABS: { id: SidebarTab; label: string }[] = [
  { id: 'policy', label: 'Policy' },
  { id: 'report', label: 'Report' },
];

function starGlyphs(stars: StarRating): string {
  return '★★★☆☆☆'.slice(3 - stars, 6 - stars);
}

export function App(): JSX.Element {
  const [selectedLevelId, setSelectedLevelId] = useState(LEVELS[0]!.id);
  const [result, setResult] = useState<SimResult | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>('policy');
  const policyName = useEditorStore((s) => s.policy.name);
  const levelProgress = useProgressStore((s) => s.levelProgress);

  const level = getLevel(selectedLevelId) ?? LEVELS[0]!;
  const unlocks = useMemo(() => cumulativeUnlocksThrough(selectedLevelId), [selectedLevelId]);

  function selectLevel(levelId: string): void {
    if (!isLevelUnlocked(levelId, levelProgress)) return;
    // Nothing carries over between shifts, ever — every level (and every
    // restart of the same level, handled inside ElevatorViewport) starts
    // from the same blank policy: no rules, default parameters. The
    // player builds it live, from scratch, under real passengers.
    useEditorStore.getState().loadPreset(BLANK_POLICY);
    setSelectedLevelId(levelId);
    setResult(null);
    setActiveTab('policy');
  }

  function handleShiftEnd(shiftResult: SimResult, status: 'succeeded' | 'failed'): void {
    setResult(shiftResult);
    if (status === 'succeeded') {
      const composite = computeCompositeScore(shiftResult.score);
      const stars = computeStars(composite, level.starThresholds);
      useProgressStore.getState().recordLevelResult(level.id, stars, composite);
    }
    setActiveTab('report');
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Elevator Pitch</h1>
        <nav aria-label="Level select">
          <ol>
            {LEVELS.map((l, index) => {
              const progress = levelProgress[l.id];
              const unlocked = isLevelUnlocked(l.id, levelProgress);
              const previous = LEVELS[index - 1];
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => selectLevel(l.id)}
                    aria-pressed={l.id === selectedLevelId}
                    disabled={!unlocked}
                    aria-label={unlocked ? undefined : `${l.name}, locked — clear ${previous?.name ?? 'the previous level'} first`}
                  >
                    {l.name} {unlocked ? (progress ? starGlyphs(progress.stars) : '') : '(locked)'}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </header>

      <div className="game-layout">
        <section className="viewport-column" aria-label="Elevator viewport">
          <article aria-label="Level briefing">
            <h2>{level.name}</h2>
            <p>{level.briefing}</p>
          </article>
          <ElevatorViewport level={level} onShiftEnd={handleShiftEnd} onRequestRuleEdit={() => setActiveTab('policy')} />
        </section>

        <aside className="sidebar" aria-label="Policy editor">
          <p className="sidebar__policy-name">Dispatch policy: {policyName}</p>
          <nav className="sidebar__tabs" aria-label="Editor sections">
            {SIDEBAR_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={activeTab === tab.id}
                disabled={tab.id === 'report' && !result}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="sidebar__content">
            {activeTab === 'policy' && (
              <>
                <ParameterPanel floors={level.floors} />
                <RuleEditor unlockedConditions={unlocks.conditions} unlockedActions={unlocks.actions} />
              </>
            )}
            {activeTab === 'report' && result && <ShiftReport result={result} starThresholds={level.starThresholds} />}
          </div>
        </aside>
      </div>
    </main>
  );
}
