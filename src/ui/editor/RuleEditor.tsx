import { useRef, useState } from 'react';
import { ACTIONS, CONDITIONS } from '../../policy/catalog';
import type { ActionId, Condition, ConditionId, Rule } from '../../policy/types';
import { useEditorStore } from '../../store/editorStore';
import { usePlaybackStore } from '../../store/playbackStore';

const CONDITION_IDS = Object.keys(CONDITIONS) as ConditionId[];
const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];

function describeRule(rule: Rule): string {
  const conditions = rule.conditions.map((c) => CONDITIONS[c.id].describe(c.params)).join(' and ');
  const action = ACTIONS[rule.action.id].describe(rule.action.params);
  return `If ${conditions}, ${action}.`;
}

interface ParamEditorProps {
  params: Record<string, number | string | boolean>;
  onChange: (key: string, value: number | string | boolean) => void;
}

function ParamEditor({ params, onChange }: ParamEditorProps): JSX.Element | null {
  const entries = Object.entries(params);
  if (entries.length === 0) return null;
  return (
    <span>
      {entries.map(([key, value]) => (
        <label key={key}>
          {key}
          {typeof value === 'boolean' ? (
            <input type="checkbox" checked={value} onChange={(e) => onChange(key, e.target.checked)} />
          ) : key === 'direction' ? (
            <select value={String(value)} onChange={(e) => onChange(key, e.target.value)}>
              <option value="up">up</option>
              <option value="down">down</option>
            </select>
          ) : (
            <input type="number" value={Number(value)} onChange={(e) => onChange(key, Number(e.target.value))} />
          )}
        </label>
      ))}
    </span>
  );
}

interface ConditionRowProps {
  rule: Rule;
  condition: Condition;
  index: number;
}

function ConditionRow({ rule, condition, index }: ConditionRowProps): JSX.Element {
  const { setConditionId, setConditionParam, removeCondition } = useEditorStore.getState();
  return (
    <li>
      <select value={condition.id} onChange={(e) => setConditionId(rule.id, index, e.target.value as ConditionId)}>
        {CONDITION_IDS.map((id) => (
          <option key={id} value={id}>
            {CONDITIONS[id].label}
          </option>
        ))}
      </select>
      <ParamEditor params={condition.params} onChange={(key, value) => setConditionParam(rule.id, index, key, value)} />
      <button type="button" onClick={() => removeCondition(rule.id, index)} disabled={rule.conditions.length <= 1} aria-label="Remove condition">
        &times;
      </button>
    </li>
  );
}

interface RuleRowProps {
  rule: Rule;
  index: number;
  isActive: boolean;
  isDragOver: boolean;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDrop: (index: number) => void;
  onMove: (from: number, to: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

function RuleRow({ rule, index, isActive, isDragOver, onDragStart, onDragOver, onDrop, onMove, canMoveUp, canMoveDown }: RuleRowProps): JSX.Element {
  const { toggleRule, removeRule, addCondition, setActionId, setActionParam } = useEditorStore.getState();

  return (
    <li
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(index);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(index);
      }}
      aria-current={isActive ? 'step' : undefined}
      data-active={isActive || undefined}
      data-drag-over={isDragOver || undefined}
    >
      <span aria-hidden="true" title="Drag to reorder">
        ⠿
      </span>
      <button type="button" onClick={() => onMove(index, index - 1)} disabled={!canMoveUp} aria-label="Move rule up">
        ↑
      </button>
      <button type="button" onClick={() => onMove(index, index + 1)} disabled={!canMoveDown} aria-label="Move rule down">
        ↓
      </button>
      <input type="checkbox" checked={rule.enabled} onChange={() => toggleRule(rule.id)} aria-label="Rule enabled" />

      <strong>If</strong>
      <ol>
        {rule.conditions.map((condition, i) => (
          <ConditionRow key={i} rule={rule} condition={condition} index={i} />
        ))}
      </ol>
      <button type="button" onClick={() => addCondition(rule.id)}>
        + and
      </button>

      <strong>then</strong>
      <select value={rule.action.id} onChange={(e) => setActionId(rule.id, e.target.value as ActionId)}>
        {ACTION_IDS.map((id) => (
          <option key={id} value={id}>
            {ACTIONS[id].label}
          </option>
        ))}
      </select>
      <ParamEditor params={rule.action.params} onChange={(key, value) => setActionParam(rule.id, key, value)} />

      <button type="button" onClick={() => removeRule(rule.id)} aria-label="Remove rule">
        Remove
      </button>

      <p>{describeRule(rule)}</p>
    </li>
  );
}

export function RuleEditor(): JSX.Element {
  const policy = useEditorStore((s) => s.policy);
  const activeRuleId = usePlaybackStore((s) => s.activeRuleId);
  const { addRule, reorderRule } = useEditorStore.getState();
  const draggedIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  function handleDrop(targetIndex: number): void {
    if (draggedIndex.current !== null) {
      reorderRule(draggedIndex.current, targetIndex);
    }
    draggedIndex.current = null;
    setDragOverIndex(null);
  }

  return (
    <section aria-label="Dispatch rules">
      <h2>Rules</h2>
      <p>Evaluated top to bottom. The first rule whose conditions all match decides the car&rsquo;s next target.</p>
      <ol>
        {policy.rules.map((rule, index) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            index={index}
            isActive={rule.id === activeRuleId}
            isDragOver={dragOverIndex === index}
            onDragStart={(i) => (draggedIndex.current = i)}
            onDragOver={(i) => setDragOverIndex(i)}
            onDrop={handleDrop}
            onMove={(from, to) => reorderRule(from, to)}
            canMoveUp={index > 0}
            canMoveDown={index < policy.rules.length - 1}
          />
        ))}
      </ol>
      <button type="button" onClick={addRule}>
        + Add rule
      </button>
    </section>
  );
}
