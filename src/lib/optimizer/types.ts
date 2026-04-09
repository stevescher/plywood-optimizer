/** A stock sheet definition from user input */
export interface StockSheet {
  id: string;
  label: string;
  length: number; // inches
  width: number; // inches
  quantity: number;
  trimTop: number;
  trimRight: number;
  trimBottom: number;
  trimLeft: number;
}

/** A required panel/part from user input */
export interface Panel {
  id: string;
  label: string;
  length: number; // inches
  width: number; // inches
  quantity: number;
}

/** A panel placed on a specific sheet */
export interface Placement {
  panelId: string;
  label: string;
  x: number;
  y: number;
  width: number; // as placed (may be rotated)
  height: number; // as placed (may be rotated)
  rotated: boolean;
  pinned: boolean;
  color: string;
}

/** A single cut step in the cutting sequence */
export interface CutStep {
  stepNumber: number;
  orientation: 'horizontal' | 'vertical';
  /** Badge anchor — midpoint of the longest segment */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /**
   * One or more line segments that make up this cut.
   * Segments are clipped to not pass through any placed piece —
   * a cut at y=16 only appears where no panel straddles that line.
   * Falls back to the x1/y1→x2/y2 span when not present (legacy data).
   */
  segments: Array<{ x1: number; y1: number; x2: number; y2: number }>;
}

/** One stock sheet with its assigned placements */
export interface SheetLayout {
  stockSheetId: string;
  sheetIndex: number;
  placements: Placement[];
  cutSequence: CutStep[];
  wastePercent: number;
  usedArea: number;
}

/** A complete solution across all sheets */
export interface Solution {
  id: string;
  strategyName: string;
  sheets: SheetLayout[];
  totalWaste: number;
  totalSheets: number;
  unplacedPanels: Panel[];
}

/** Guillotine tree node — represents recursive splits */
export interface GuillotineNode {
  x: number;
  y: number;
  width: number;
  height: number;
  split: 'horizontal' | 'vertical' | null;
  placement: Placement | null;
  children: [GuillotineNode, GuillotineNode] | null;
}

export type SortCriterion =
  | 'area-desc'
  | 'perimeter-desc'
  | 'longest-side-desc'
  | 'width-desc'
  | 'height-desc';

export type SplitRule =
  | 'shorter-axis'
  | 'longer-axis'
  | 'horizontal-first'
  | 'vertical-first';

export type SelectionRule =
  | 'best-short-side-fit'
  | 'best-long-side-fit'
  | 'best-area-fit'
  | 'worst-fit';

export interface PackingStrategy {
  name: string;
  sort: SortCriterion;
  splitRule: SplitRule;
  selectionRule: SelectionRule;
  allowRotation: boolean;
}

/** Configuration passed to optimizer */
export interface OptimizerConfig {
  stockSheets: StockSheet[];
  panels: Panel[];
  kerf: number;
  pinnedPlacements: Record<string, Placement[]>;
  strategy: PackingStrategy;
}

/** Common stock sheet preset */
export interface StockPreset {
  label: string;
  length: number;
  width: number;
}

export const STOCK_PRESETS_IMPERIAL: StockPreset[] = [
  { label: "4' × 8' (48 × 96\")", length: 96, width: 48 },
  { label: "5' × 5' (60 × 60\")", length: 60, width: 60 },
  { label: "4' × 4' (48 × 48\")", length: 48, width: 48 },
  { label: "2' × 4' (24 × 48\")", length: 48, width: 24 },
  { label: "2' × 2' (24 × 24\")", length: 24, width: 24 },
];

/** Metric sheet sizes stored in inches internally (values ÷ 25.4) */
export const STOCK_PRESETS_METRIC: StockPreset[] = [
  { label: '2440 × 1220 mm', length: 2440 / 25.4, width: 1220 / 25.4 },
  { label: '2500 × 1250 mm', length: 2500 / 25.4, width: 1250 / 25.4 },
  { label: '1220 × 1220 mm', length: 1220 / 25.4, width: 1220 / 25.4 },
  { label: '2440 × 610 mm',  length: 2440 / 25.4, width:  610 / 25.4 },
  { label: '1220 × 610 mm',  length: 1220 / 25.4, width:  610 / 25.4 },
];

/** @deprecated use STOCK_PRESETS_IMPERIAL */
export const STOCK_PRESETS = STOCK_PRESETS_IMPERIAL;

/** Serializable project data for save/load */
export interface ProjectData {
  version: 1;
  name: string;
  stockSheets: StockSheet[];
  panels: Panel[];
  kerf: number;
  units: 'imperial' | 'metric';
  savedAt: string;
}
