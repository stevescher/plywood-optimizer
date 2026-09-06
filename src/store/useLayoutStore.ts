import { create } from 'zustand';
import { Solution } from '@/lib/optimizer/types';
import { useChecklistStore } from './useChecklistStore';

interface LayoutState {
  solutions: Solution[];
  activeSolutionIndex: number;
  isOptimizing: boolean;
  /** How many solutions have been revealed (for shuffle) */
  revealedCount: number;

  setSolutions: (solutions: Solution[]) => void;
  updateSolutions: (solutions: Solution[]) => void;
  setActive: (index: number) => void;
  setOptimizing: (optimizing: boolean) => void;
  shuffleNext: () => void;
  reset: () => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  solutions: [],
  activeSolutionIndex: 0,
  isOptimizing: false,
  revealedCount: 3,

  setSolutions: (solutions) => {
    // A fresh plan invalidates any checked-off pieces from the previous one.
    useChecklistStore.getState().reset();
    set({
      solutions,
      activeSolutionIndex: 0,
      revealedCount: Math.min(3, solutions.length),
    });
  },

  /** Patch the solutions array in place — for edits (drag/rotate/nudge a piece,
   *  re-optimize around pinned pieces) to an already-planned layout. Unlike
   *  setSolutions, this is not a fresh plan: it must not reset
   *  activeSolutionIndex, revealedCount, or the checklist, or an edit to a
   *  non-first alternative would silently jump the view back to layout 1 and
   *  wipe the shop checklist the user may already be working from. */
  updateSolutions: (solutions) => set({ solutions }),

  setActive: (index) => set({ activeSolutionIndex: index }),
  setOptimizing: (optimizing) => set({ isOptimizing: optimizing }),

  shuffleNext: () => {
    const { solutions, revealedCount } = get();
    if (revealedCount < solutions.length) {
      set({ revealedCount: Math.min(revealedCount + 3, solutions.length) });
    }
  },

  reset: () => {
    useChecklistStore.getState().reset();
    set({
      solutions: [],
      activeSolutionIndex: 0,
      isOptimizing: false,
      revealedCount: 3,
    });
  },
}));
