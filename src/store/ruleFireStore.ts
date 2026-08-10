import { create } from 'zustand';

interface RuleFireState {
  /** Which rule fired the currently-in-effect decision for the car the
   *  player is watching — null once its pulse window has elapsed (see
   *  render/ruleHighlight.ts's ruleFiredPulseAt) or no rule has fired yet.
   *  Shared between the Shift Screen's read-only rule panel and the full
   *  Policy tab's rule editor, so both flash in step. */
  activeRuleId: string | null;
  setActiveRuleId: (ruleId: string | null) => void;
}

export const useRuleFireStore = create<RuleFireState>((set) => ({
  activeRuleId: null,
  setActiveRuleId: (activeRuleId) => set({ activeRuleId }),
}));
