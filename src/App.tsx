import { useMemo, useState } from 'react';
import { cumulativeUnlocksThrough, getLevel, isLevelUnlocked, LEVELS } from './levels';
import { computeCompositeScore, computeStars, type StarRating } from './levels/scoring';
import { SCAN_PRESET } from './policy/presets';
import type { SimResult } from './sim/simulate';
import { useEditorStore } from './store/editorStore';
import { useProgressStore } from './store/progressStore';
import { ParameterPanel } from './ui/editor/ParameterPanel';
import { RuleEditor } from './ui/editor/RuleEditor';
import { SavedPolicies } from './ui/editor/SavedPolicies';
import { ShiftReport } from './ui/report/ShiftReport';
import { ElevatorViewport } from './ui/viewport/ElevatorViewport';

type SidebarTab = 'parameters' | 'rules' | 'saved' | 'report';

const SIDEBAR_TABS: { id: SidebarTab; label: string }[] = [
  { id: 'parameters', label: 'Parameters' },
  { id: 'rules', label: 'Rules' },
  { id: 'saved', label: 'Saved' },
  { id: 'report', label: 'Report' },
];

function starGlyphs(stars: StarRating): string {
  return '★★★☆☆☆'.slice(3 - stars, 6 - stars);
}

export function App(): JSX.Element {
  const [selectedLevelId, setSelectedLevelId] = useState(LEVELS[0]!.id);
  const [result, setResult] = useState<SimResult | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>('parameters');
  const policyName = useEditorStore((s) => s.policy.name);
  const levelProgress = useProgressStore((s) => s.levelProgress);

  const level = getLevel(selectedLevelId) ?? LEVELS[0]!;
  const unlocks = useMemo(() => cumulativeUnlocksThrough(selectedLevelId), [selectedLevelId]);

  function selectLevel(levelId: string): void {
    if (!isLevelUnlocked(levelId, levelProgress)) return;
    // Every level starts from the same known-good baseline, running
    // immediately — the player edits it live rather than pressing a
    // separate "run" button first. Restarting the *same* level (via the
    // viewport's own Restart control) intentionally keeps whatever policy
    // the player has already edited instead of resetting it.
    useEditorStore.getState().loadPreset(SCAN_PRESET);
    setSelectedLevelId(levelId);
    setResult(null);
    setActiveTab('parameters');
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
          <ElevatorViewport level={level} onShiftEnd={handleShiftEnd} onRequestRuleEdit={() => setActiveTab('rules')} />
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
            {activeTab === 'parameters' && <ParameterPanel floors={level.floors} />}
            {activeTab === 'rules' && <RuleEditor unlockedConditions={unlocks.conditions} unlockedActions={unlocks.actions} />}
            {activeTab === 'saved' && <SavedPolicies />}
            {activeTab === 'report' && result && <ShiftReport result={result} starThresholds={level.starThresholds} />}
          </div>
        </aside>
      </div>
    </main>
  );
}
