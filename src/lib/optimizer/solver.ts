import { nanoid } from 'nanoid';
import {
  StockSheet,
  Panel,
  Solution,
  SheetLayout,
  PackingStrategy,
  Placement,
  GuillotineNode,
} from './types';
import { createTree, placeInTree, collectPlacements } from './guillotine';
import { deriveCutSequenceFromPlacements } from './reoptimize';
import { generateStrategies, sortPanels } from './strategies';
import { getColor } from '../colors';

interface ExpandedPanel {
  panelId: string;
  label: string;
  length: number;
  width: number;
  originalIndex: number;
}

interface OpenSheet {
  stockSheet: StockSheet;
  sheetIndex: number;
  tree: GuillotineNode;
  usableLength: number;
  usableWidth: number;
}

/** Expand panels by quantity into individual items */
function expandPanels(panels: Panel[]): ExpandedPanel[] {
  const expanded: ExpandedPanel[] = [];
  panels.forEach((panel, idx) => {
    for (let q = 0; q < panel.quantity; q++) {
      expanded.push({
        panelId: panel.id,
        label: panel.label || `Panel ${idx + 1}`,
        length: panel.length,
        width: panel.width,
        originalIndex: idx,
      });
    }
  });
  return expanded;
}

/** Get usable dimensions of a stock sheet after trim */
function getUsableDimensions(sheet: StockSheet): { length: number; width: number } {
  return {
    length: sheet.length - sheet.trimLeft - sheet.trimRight,
    width: sheet.width - sheet.trimTop - sheet.trimBottom,
  };
}

/** Run a single strategy and produce a Solution */
function solveWithStrategy(
  stockSheets: StockSheet[],
  panels: Panel[],
  kerf: number,
  strategy: PackingStrategy
): Solution {
  const expanded = expandPanels(panels.filter((p) => p.length > 0 && p.width > 0));

  // Sort panels according to strategy
  const sortable = expanded.map((p, i) => ({
    length: p.length,
    width: p.width,
    index: i,
  }));
  const sorted = sortPanels(sortable, strategy.sort);

  // Track open sheets and how many of each stock sheet type we've used
  const openSheets: OpenSheet[] = [];
  const sheetUsage = new Map<string, number>();
  const unplaced: Panel[] = [];

  // Sort stock sheets by area (largest first) for sheet selection
  const availableSheets = [...stockSheets]
    .filter((s) => s.length > 0 && s.width > 0)
    .sort((a, b) => a.length * a.width - b.length * b.width); // smallest first to minimize waste

  function openNewSheet(minLength: number, minWidth: number): OpenSheet | null {
    // Find the smallest stock sheet that can fit the piece
    for (const ss of availableSheets) {
      const usable = getUsableDimensions(ss);
      const currentUsage = sheetUsage.get(ss.id) || 0;
      if (currentUsage >= ss.quantity) continue;

      const fits =
        (usable.length >= minLength && usable.width >= minWidth) ||
        (strategy.allowRotation &&
          usable.length >= minWidth &&
          usable.width >= minLength);

      if (fits) {
        sheetUsage.set(ss.id, currentUsage + 1);
        const open: OpenSheet = {
          stockSheet: ss,
          sheetIndex: currentUsage,
          tree: createTree(usable.length, usable.width),
          usableLength: usable.length,
          usableWidth: usable.width,
        };
        // Offset placements by trim
        open.tree.x = ss.trimLeft;
        open.tree.y = ss.trimTop;
        openSheets.push(open);
        return open;
      }
    }
    return null;
  }

  // Place each panel
  for (const sortedItem of sorted) {
    const panel = expanded[sortedItem.index];
    const pieceW = panel.length + kerf;
    const pieceH = panel.width + kerf;
    const color = getColor(panel.originalIndex);
    let placed = false;

    // Try existing open sheets
    for (const os of openSheets) {
      const placement = placeInTree(
        os.tree,
        pieceW,
        pieceH,
        panel.length,
        panel.width,
        strategy.selectionRule,
        strategy.splitRule,
        strategy.allowRotation,
        { panelId: panel.panelId, label: panel.label, color }
      );
      if (placement) {
        placed = true;
        break;
      }
    }

    // Open a new sheet if needed
    if (!placed) {
      const newSheet = openNewSheet(pieceW, pieceH);
      if (newSheet) {
        const placement = placeInTree(
          newSheet.tree,
          pieceW,
          pieceH,
          panel.length,
          panel.width,
          strategy.selectionRule,
          strategy.splitRule,
          strategy.allowRotation,
          { panelId: panel.panelId, label: panel.label, color }
        );
        if (placement) {
          placed = true;
        }
      }
    }

    if (!placed) {
      // Check if this panel was already counted as unplaced
      const existing = unplaced.find(
        (u) => u.id === panel.panelId
      );
      if (!existing) {
        const original = panels.find((p) => p.id === panel.panelId);
        if (original) unplaced.push(original);
      }
    }
  }

  // Build sheet layouts
  const sheetLayouts: SheetLayout[] = openSheets.map((os) => {
    const placements = collectPlacements(os.tree);
    const cutSequence = deriveCutSequenceFromPlacements(
      placements,
      os.stockSheet.length,
      os.stockSheet.width,
    );
    const usableL = os.stockSheet.length - os.stockSheet.trimLeft - os.stockSheet.trimRight;
    const usableW = os.stockSheet.width - os.stockSheet.trimTop - os.stockSheet.trimBottom;
    const totalArea = usableL * usableW;
    const usedArea = placements.reduce((sum, p) => sum + p.width * p.height, 0);
    const wastePercent = ((totalArea - usedArea) / totalArea) * 100;

    return {
      stockSheetId: os.stockSheet.id,
      sheetIndex: os.sheetIndex,
      placements,
      cutSequence,
      wastePercent,
      usedArea,
    };
  });

  const totalArea = sheetLayouts.reduce(
    (sum, sl) => {
      const ss = stockSheets.find((s) => s.id === sl.stockSheetId)!;
      const usableL = ss.length - ss.trimLeft - ss.trimRight;
      const usableW = ss.width - ss.trimTop - ss.trimBottom;
      return sum + usableL * usableW;
    },
    0
  );
  const totalUsed = sheetLayouts.reduce((sum, sl) => sum + sl.usedArea, 0);
  const totalWaste = totalArea > 0 ? ((totalArea - totalUsed) / totalArea) * 100 : 0;

  return {
    id: nanoid(),
    strategyName: strategy.name,
    sheets: sheetLayouts,
    totalWaste,
    totalSheets: sheetLayouts.length,
    unplacedPanels: unplaced,
  };
}

/** Run all strategies and return solutions sorted by waste (best first) */
export function solveAll(config: {
  stockSheets: StockSheet[];
  panels: Panel[];
  kerf: number;
}): Solution[] {
  const strategies = generateStrategies();
  const solutions: Solution[] = [];

  for (const strategy of strategies) {
    try {
      const solution = solveWithStrategy(
        config.stockSheets,
        config.panels,
        config.kerf,
        strategy
      );
      solutions.push(solution);
    } catch (e) {
      console.warn(`Strategy ${strategy.name} failed:`, e);
    }
  }

  // Sort by: fewer sheets first, then less waste
  solutions.sort((a, b) => {
    if (a.totalSheets !== b.totalSheets) return a.totalSheets - b.totalSheets;
    return a.totalWaste - b.totalWaste;
  });

  // Deduplicate solutions that produce identical layouts
  const unique: Solution[] = [];
  const seen = new Set<string>();
  for (const sol of solutions) {
    const key = sol.sheets
      .map((s) =>
        s.placements
          .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.width.toFixed(2)},${p.height.toFixed(2)}`)
          .sort()
          .join('|')
      )
      .join('||');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(sol);
    }
  }

  return unique;
}
