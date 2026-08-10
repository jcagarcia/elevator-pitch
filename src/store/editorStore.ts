import { create } from 'zustand';
import { ACTIONS, CONDITIONS } from '../policy/catalog';
import { BLANK_POLICY } from '../policy/presets';
import type { Action, ActionId, Condition, ConditionId, DispatchParameters, DispatchPolicy, Rule } from '../policy/types';

function newRuleId(): string {
  return `rule-${crypto.randomUUID()}`;
}

function mapRule(rules: Rule[], ruleId: string, update: (rule: Rule) => Rule): Rule[] {
  return rules.map((r) => (r.id === ruleId ? update(r) : r));
}

interface EditorState {
  policy: DispatchPolicy;
  loadPreset: (preset: DispatchPolicy) => void;
  setParameter: <K extends keyof DispatchParameters>(key: K, value: DispatchParameters[K]) => void;

  addRule: () => void;
  removeRule: (ruleId: string) => void;
  toggleRule: (ruleId: string) => void;
  reorderRule: (fromIndex: number, toIndex: number) => void;

  addCondition: (ruleId: string) => void;
  removeCondition: (ruleId: string, conditionIndex: number) => void;
  setConditionId: (ruleId: string, conditionIndex: number, conditionId: ConditionId) => void;
  setConditionParam: (ruleId: string, conditionIndex: number, key: string, value: Condition['params'][string]) => void;

  setActionId: (ruleId: string, actionId: ActionId) => void;
  setActionParam: (ruleId: string, key: string, value: Action['params'][string]) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  policy: structuredClone(BLANK_POLICY),

  loadPreset: (preset) => set({ policy: structuredClone(preset) }),

  setParameter: (key, value) =>
    set((s) => ({ policy: { ...s.policy, parameters: { ...s.policy.parameters, [key]: value } } })),

  addRule: () =>
    set((s) => {
      const newRule: Rule = {
        id: newRuleId(),
        enabled: true,
        conditions: [{ id: 'always', params: { ...CONDITIONS.always.defaultParams } }],
        action: { id: 'go-to-nearest-call', params: { ...ACTIONS['go-to-nearest-call'].defaultParams } },
      };
      return { policy: { ...s.policy, rules: [...s.policy.rules, newRule] } };
    }),

  removeRule: (ruleId) => set((s) => ({ policy: { ...s.policy, rules: s.policy.rules.filter((r) => r.id !== ruleId) } })),

  toggleRule: (ruleId) =>
    set((s) => ({ policy: { ...s.policy, rules: mapRule(s.policy.rules, ruleId, (r) => ({ ...r, enabled: !r.enabled })) } })),

  reorderRule: (fromIndex, toIndex) =>
    set((s) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= s.policy.rules.length || toIndex >= s.policy.rules.length) {
        return s;
      }
      const rules = [...s.policy.rules];
      const [moved] = rules.splice(fromIndex, 1);
      if (!moved) return s;
      rules.splice(toIndex, 0, moved);
      return { policy: { ...s.policy, rules } };
    }),

  addCondition: (ruleId) =>
    set((s) => ({
      policy: {
        ...s.policy,
        rules: mapRule(s.policy.rules, ruleId, (r) => ({
          ...r,
          conditions: [...r.conditions, { id: 'always', params: { ...CONDITIONS.always.defaultParams } }],
        })),
      },
    })),

  removeCondition: (ruleId, conditionIndex) =>
    set((s) => ({
      policy: {
        ...s.policy,
        rules: mapRule(s.policy.rules, ruleId, (r) =>
          r.conditions.length <= 1 ? r : { ...r, conditions: r.conditions.filter((_, i) => i !== conditionIndex) },
        ),
      },
    })),

  setConditionId: (ruleId, conditionIndex, conditionId) =>
    set((s) => ({
      policy: {
        ...s.policy,
        rules: mapRule(s.policy.rules, ruleId, (r) => ({
          ...r,
          conditions: r.conditions.map((c, i) =>
            i === conditionIndex ? { id: conditionId, params: { ...CONDITIONS[conditionId].defaultParams } } : c,
          ),
        })),
      },
    })),

  setConditionParam: (ruleId, conditionIndex, key, value) =>
    set((s) => ({
      policy: {
        ...s.policy,
        rules: mapRule(s.policy.rules, ruleId, (r) => ({
          ...r,
          conditions: r.conditions.map((c, i) => (i === conditionIndex ? { ...c, params: { ...c.params, [key]: value } } : c)),
        })),
      },
    })),

  setActionId: (ruleId, actionId) =>
    set((s) => ({
      policy: {
        ...s.policy,
        rules: mapRule(s.policy.rules, ruleId, (r) => ({
          ...r,
          action: { id: actionId, params: { ...ACTIONS[actionId].defaultParams } },
        })),
      },
    })),

  setActionParam: (ruleId, key, value) =>
    set((s) => ({
      policy: {
        ...s.policy,
        rules: mapRule(s.policy.rules, ruleId, (r) => ({ ...r, action: { ...r.action, params: { ...r.action.params, [key]: value } } })),
      },
    })),
}));
