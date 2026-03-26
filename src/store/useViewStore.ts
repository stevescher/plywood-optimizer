import { create } from 'zustand';

export type ViewMode = 'color' | 'mono' | 'outline';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3.0;
export const ZOOM_STEP = 0.25;

interface ViewState {
  showLabels: boolean;
  viewMode: ViewMode;
  showCutSequence: boolean;
  showEdgeDims: boolean;
  zoom: number;

  toggleLabels: () => void;
  setViewMode: (mode: ViewMode) => void;
  toggleCutSequence: () => void;
  toggleEdgeDims: () => void;
  setZoom: (zoom: number) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  showLabels: true,
  viewMode: 'color',
  showCutSequence: false,
  showEdgeDims: false,
  zoom: 1.0,

  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleCutSequence: () => set((s) => ({ showCutSequence: !s.showCutSequence })),
  toggleEdgeDims: () => set((s) => ({ showEdgeDims: !s.showEdgeDims })),
  setZoom: (zoom) => set({ zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom)) }),
}));
