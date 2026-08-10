import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DispatchPolicy } from '../policy/types';
import type { StarRating } from '../levels/scoring';

export interface SavedPolicy {
  readonly id: string;
  readonly name: string;
  readonly policy: DispatchPolicy;
  readonly savedAt: number;
}

export interface LevelProgress {
  readonly stars: StarRating;
  readonly bestComposite: number;
}

interface ProgressState {
  savedPolicies: SavedPolicy[];
  levelProgress: Record<string, LevelProgress>;
  savePolicy: (name: string, policy: DispatchPolicy) => void;
  deleteSavedPolicy: (id: string) => void;
  /** Records a level attempt, keeping only the best result seen so far. */
  recordLevelResult: (levelId: string, stars: StarRating, composite: number) => void;
}

export const useProgressStore = create<ProgressState>()(
  persist(
    (set) => ({
      savedPolicies: [],
      levelProgress: {},

      savePolicy: (name, policy) =>
        set((s) => ({
          savedPolicies: [...s.savedPolicies, { id: `policy-${crypto.randomUUID()}`, name, policy: structuredClone(policy), savedAt: Date.now() }],
        })),

      deleteSavedPolicy: (id) => set((s) => ({ savedPolicies: s.savedPolicies.filter((p) => p.id !== id) })),

      recordLevelResult: (levelId, stars, composite) =>
        set((s) => {
          const existing = s.levelProgress[levelId];
          if (existing && existing.bestComposite >= composite) return s;
          return {
            levelProgress: {
              ...s.levelProgress,
              [levelId]: {
                stars: Math.max(stars, existing?.stars ?? 0) as StarRating,
                bestComposite: Math.max(composite, existing?.bestComposite ?? 0),
              },
            },
          };
        }),
    }),
    { name: 'elevator-pitch-progress' },
  ),
);
