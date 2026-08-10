import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StarRating } from '../levels/scoring';

export interface LevelProgress {
  readonly stars: StarRating;
  readonly bestComposite: number;
}

interface ProgressState {
  levelProgress: Record<string, LevelProgress>;
  /** Records a level attempt, keeping only the best result seen so far. */
  recordLevelResult: (levelId: string, stars: StarRating, composite: number) => void;
}

export const useProgressStore = create<ProgressState>()(
  persist(
    (set) => ({
      levelProgress: {},

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
