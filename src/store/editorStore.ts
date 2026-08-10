import { create } from 'zustand';
import { SCAN_PRESET } from '../policy/presets';
import type { DispatchParameters, DispatchPolicy } from '../policy/types';

interface EditorState {
  policy: DispatchPolicy;
  loadPreset: (preset: DispatchPolicy) => void;
  setParameter: <K extends keyof DispatchParameters>(key: K, value: DispatchParameters[K]) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  policy: structuredClone(SCAN_PRESET),
  loadPreset: (preset) => set({ policy: structuredClone(preset) }),
  setParameter: (key, value) =>
    set((s) => ({ policy: { ...s.policy, parameters: { ...s.policy.parameters, [key]: value } } })),
}));
