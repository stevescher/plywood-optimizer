import { nanoid } from 'nanoid';
import { Solution, SheetLayout, StockSheet, Placement, CutStep } from './types';

// ─── Free-rectangle helpers ───────────────────────────────────────────────────

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: FreeRect, b: FreeRect): boolean {
  return !(
    b.x >= a.x + a.w ||
    b.x + b.w <= a.x ||
    b.y >= a.y + a.h ||
    b.y + b.h <= a.y
  );
}

function subtractRect(freeRects: FreeRect[], used: FreeRect): FreeRect[] {
  const result: FreeRect[] = [];
  for (const f of freeRects) {
    if (!overlaps(f, used)) { result.push(f); continue; }
    if (used.x > f.x)
      result.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
    if (used.x + used.w < f.x + f.w)
      result.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - (used.x + used.w), h: f.h });
    if (used.y > f.y)
      result.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
    if (used.y + used.h < f.y + f.h)
      result.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - (used.y + used.h) });
  }
  return result;
}

function pruneContained(freeRects: FreeRect[]): FreeRect[] {
  return freeRects.filter(
    (a) => !freeRects.some(
      (b) => b !== a && b.x <= a.x && b.y <= a.y &&
             b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h
    )
  );
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

// ─── Cut-sequence from placements ─────────────────────────────────────────────

/**
 * Subtract a list of blocked intervals from [lo, hi].
 * Returns the remaining free sub-intervals (each at least minLen wide).
 */
function subtractRanges(
  lo: number,
  hi: number,
  blocked: Array<[number, number]>,
  minLen = 0.05,
): Array<[number, number]> {
  const sorted = [...blocked].sort((a, b) => a[0] - b[0]);
  let remaining: Array<[number, number]> = [[lo, hi]];
  for (const [blo, bhi] of sorted) {
    const next: Array<[number, number]> = [];
    for (const [rlo, rhi] of remaining) {
      if (bhi <= rlo || blo >= rhi) { next.push([rlo, rhi]); continue; }
      if (rlo < blo - minLen) next.push([rlo, blo]);
      if (bhi < rhi - minLen) next.push([bhi, rhi]);
    }
    remaining = next;
  }
  return remaining.filter(([a, b]) => b - a > minLen);
}

/** Return the midpoint of the longest segment (for badge placement). */
function badgeAnchor(
  segs: Array<{ x1: number; y1: number; x2: number; y2: number }>,
  fallback: { x1: number; y1: number; x2: number; y2: number },
) {
  if (segs.length === 0) return fallback;
  const longest = segs.reduce((best, s) => {
    const len = Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
    const blen = Math.abs(best.x2 - best.x1) + Math.abs(best.y2 - best.y1);
    return len > blen ? s : best;
  }, segs[0]);
  return {
    x1: (longest.x1 + longest.x2) / 2,
    y1: (longest.y1 + longest.y2) / 2,
    x2: (longest.x1 + longest.x2) / 2,
    y2: (longest.y1 + longest.y2) / 2,
  };
}

/**
 * Derive a practical cut sequence using a recursive guillotine approach.
 *
 * At each region, all valid straight cuts (where no piece is split) are
 * scored and the best is chosen first. Waste-isolation cuts (freeing an
 * empty strip) score higher than piece-separating cuts unless the
 * separation is very well-aligned.
 */
export function deriveCutSequenceFromPlacements(
  placements: Placement[],
  sheetW: number,
  sheetH: number,
): CutStep[] {
  if (placements.length < 2) return [];

  const POS_EPS = 0.05;   // straddle-check tolerance (≈ saw kerf)
  const ALIGN_EPS = 0.25; // edge-alignment tolerance (~quarter inch)

  interface Region { x0: number; y0: number; x1: number; y1: number; }

  function straddlesH(p: Placement, y: number): boolean {
    return p.y < y - POS_EPS && p.y + p.height > y + POS_EPS;
  }

  function straddlesV(p: Placement, x: number): boolean {
    return p.x < x - POS_EPS && p.x + p.width > x + POS_EPS;
  }

  /** Cut segments clipped to the current region (straddling pieces should be none for valid cuts). */
  function segmentsForCut(
    orientation: 'horizontal' | 'vertical',
    position: number,
    pieces: Placement[],
    region: Region,
  ): Array<{ x1: number; y1: number; x2: number; y2: number }> {
    if (orientation === 'horizontal') {
      const blockedX = pieces
        .filter(p => straddlesH(p, position))
        .map((p): [number, number] => [p.x, p.x + p.width]);
      return subtractRanges(region.x0, region.x1, blockedX).map(([lo, hi]) => ({
        x1: lo, y1: position, x2: hi, y2: position,
      }));
    } else {
      const blockedY = pieces
        .filter(p => straddlesV(p, position))
        .map((p): [number, number] => [p.y, p.y + p.height]);
      return subtractRanges(region.y0, region.y1, blockedY).map(([lo, hi]) => ({
        x1: position, y1: lo, x2: position, y2: hi,
      }));
    }
  }

  /**
   * Score a candidate cut.
   * Waste-isolation (one side empty): 0.8 + wasteRatio * 0.2
   * Piece-separating: alignmentFrac * 0.5 + balance * 0.3 + 0.2
   */
  function scoreCut(
    orientation: 'horizontal' | 'vertical',
    position: number,
    pieces: Placement[],
    region: Region,
  ): number {
    const g1: Placement[] = [];
    const g2: Placement[] = [];
    if (orientation === 'horizontal') {
      for (const p of pieces) {
        if (p.y + p.height <= position + POS_EPS) g1.push(p);
        else g2.push(p);
      }
    } else {
      for (const p of pieces) {
        if (p.x + p.width <= position + POS_EPS) g1.push(p);
        else g2.push(p);
      }
    }

    if (g1.length === 0 || g2.length === 0) {
      // Waste-isolation cut
      const regionLen = orientation === 'horizontal'
        ? region.y1 - region.y0
        : region.x1 - region.x0;
      const wasteLen = orientation === 'horizontal'
        ? (g1.length === 0 ? position - region.y0 : region.y1 - position)
        : (g1.length === 0 ? position - region.x0 : region.x1 - position);
      const wasteRatio = regionLen > 0 ? wasteLen / regionLen : 0;
      return 0.8 + wasteRatio * 0.2;
    }

    // Piece-separating cut: score by edge alignment and balance
    let alignCount = 0;
    if (orientation === 'horizontal') {
      for (const p of pieces) {
        if (Math.abs(p.y + p.height - position) < ALIGN_EPS ||
            Math.abs(p.y - position) < ALIGN_EPS) alignCount++;
      }
    } else {
      for (const p of pieces) {
        if (Math.abs(p.x + p.width - position) < ALIGN_EPS ||
            Math.abs(p.x - position) < ALIGN_EPS) alignCount++;
      }
    }
    const alignmentFrac = pieces.length > 0 ? alignCount / pieces.length : 0;
    const balance = Math.min(g1.length, g2.length) / Math.max(g1.length, g2.length);
    return alignmentFrac * 0.5 + balance * 0.3 + 0.2;
  }

  const steps: CutStep[] = [];
  let stepNum = 1;

  function planRegion(pieces: Placement[], region: Region): void {
    if (pieces.length <= 1) return;

    type Candidate = { orientation: 'horizontal' | 'vertical'; position: number; score: number };
    const candidates: Candidate[] = [];
    const seen = new Set<string>();

    for (const p of pieces) {
      // Try all four edges of each piece as potential cut positions
      const edges: Array<['horizontal' | 'vertical', number]> = [
        ['horizontal', p.y + p.height],  // bottom edge
        ['horizontal', p.y],             // top edge
        ['vertical',   p.x + p.width],   // right edge
        ['vertical',   p.x],             // left edge
      ];

      for (const [orientation, position] of edges) {
        const [lo, hi] = orientation === 'horizontal'
          ? [region.y0, region.y1]
          : [region.x0, region.x1];

        // Skip positions at or outside region boundaries
        if (position <= lo + POS_EPS || position >= hi - POS_EPS) continue;

        const key = `${orientation[0]}:${position.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Valid only if no piece in this region straddles the cut
        const straddles = orientation === 'horizontal'
          ? pieces.some(q => straddlesH(q, position))
          : pieces.some(q => straddlesV(q, position));
        if (straddles) continue;

        candidates.push({ orientation, position, score: scoreCut(orientation, position, pieces, region) });
      }
    }

    if (candidates.length === 0) return;

    // Pick the highest-scoring cut
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // Emit cut segments for this region
    const segs = segmentsForCut(best.orientation, best.position, pieces, region);
    if (segs.length > 0) {
      const fallback = best.orientation === 'horizontal'
        ? { x1: region.x0, y1: best.position, x2: region.x1, y2: best.position }
        : { x1: best.position, y1: region.y0, x2: best.position, y2: region.y1 };
      const anchor = badgeAnchor(segs, fallback);
      steps.push({ stepNumber: stepNum++, orientation: best.orientation, ...anchor, segments: segs });
    }

    // Split pieces into sub-groups and recurse
    if (best.orientation === 'horizontal') {
      const g1 = pieces.filter(p => p.y + p.height <= best.position + POS_EPS);
      const g2 = pieces.filter(p => p.y >= best.position - POS_EPS);
      planRegion(g1, { ...region, y1: best.position });
      planRegion(g2, { ...region, y0: best.position });
    } else {
      const g1 = pieces.filter(p => p.x + p.width <= best.position + POS_EPS);
      const g2 = pieces.filter(p => p.x >= best.position - POS_EPS);
      planRegion(g1, { ...region, x1: best.position });
      planRegion(g2, { ...region, x0: best.position });
    }
  }

  planRegion(placements, { x0: 0, y0: 0, x1: sheetW, y1: sheetH });
  return steps;
}

// ─── Main re-optimizer ────────────────────────────────────────────────────────

/**
 * Re-pack all non-pinned pieces on each sheet using free-rectangle packing.
 * Pinned pieces act as SOFT ANCHORS — they get priority to land nearest their
 * preferred center, but can shift to any valid free rect if kerf or space
 * prevents an exact fit. This is a "preference" not a fixed coordinate.
 */
export function reOptimizeAroundPinned(
  solution: Solution,
  stockSheets: StockSheet[],
  pinnedPieces: Set<string>, // keys: "stockSheetId-sheetIndex:placementIndex"
  kerf: number
): Solution {
  const newSheets: SheetLayout[] = solution.sheets.map((sheet) => {
    const stockSheet = stockSheets.find((s) => s.id === sheet.stockSheetId);
    if (!stockSheet) return sheet;

    const sheetKey = `${sheet.stockSheetId}-${sheet.sheetIndex}`;

    // Separate pinned (soft-anchor) from free-floating
    type AnchoredPanel = Placement & { prefCX: number; prefCY: number };
    const anchored: AnchoredPanel[] = [];
    const floating: Placement[] = [];

    sheet.placements.forEach((p, pi) => {
      if (pinnedPieces.has(`${sheetKey}:${pi}`)) {
        anchored.push({ ...p, prefCX: p.x + p.width / 2, prefCY: p.y + p.height / 2 });
      } else {
        floating.push(p);
      }
    });

    // Full usable free area
    const usableX = stockSheet.trimLeft;
    const usableY = stockSheet.trimTop;
    const usableW = stockSheet.length - stockSheet.trimLeft - stockSheet.trimRight;
    const usableH = stockSheet.width - stockSheet.trimTop - stockSheet.trimBottom;
    let freeRects: FreeRect[] = [{ x: usableX, y: usableY, w: usableW, h: usableH }];

    const newPlacements: Placement[] = [];
    const unplacedFloating: Placement[] = [];

    // ── Pass 1: soft-anchored pieces → closest free rect to preference ──────
    // Sort by area desc so large anchored pieces claim their space first
    const sortedAnchored = [...anchored].sort(
      (a, b) => b.width * b.height - a.width * a.height
    );

    for (const panel of sortedAnchored) {
      const pw = panel.width + kerf;
      const ph = panel.height + kerf;

      // Score each free rect by distance from preferred center
      let bestIdx = -1;
      let bestScore = Infinity;
      let bestRotated = false;

      for (let i = 0; i < freeRects.length; i++) {
        const r = freeRects[i];
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;

        if (r.w >= pw && r.h >= ph) {
          const score = dist2(cx, cy, panel.prefCX, panel.prefCY);
          if (score < bestScore) { bestScore = score; bestIdx = i; bestRotated = false; }
        }
        // Try rotated
        if (r.w >= ph && r.h >= pw) {
          const score = dist2(cx, cy, panel.prefCX, panel.prefCY);
          if (score < bestScore) { bestScore = score; bestIdx = i; bestRotated = true; }
        }
      }

      if (bestIdx === -1) {
        // Can't place it at all — put it back as a floating piece
        floating.push(panel);
        continue;
      }

      const rect = freeRects[bestIdx];
      const placeW = bestRotated ? panel.height : panel.width;
      const placeH = bestRotated ? panel.width : panel.height;

      // Place as close to preferred position as possible within the rect
      const clampedX = Math.max(rect.x, Math.min(panel.prefCX - placeW / 2, rect.x + rect.w - placeW));
      const clampedY = Math.max(rect.y, Math.min(panel.prefCY - placeH / 2, rect.y + rect.h - placeH));

      newPlacements.push({
        ...panel,
        x: clampedX,
        y: clampedY,
        width: placeW,
        height: placeH,
        rotated: bestRotated ? !panel.rotated : panel.rotated,
      });

      freeRects = subtractRect(freeRects, { x: clampedX, y: clampedY, w: placeW + kerf, h: placeH + kerf });
      freeRects = pruneContained(freeRects);
    }

    // ── Pass 2: floating pieces → best-fit (smallest area) ──────────────────
    const sortedFloating = [...floating].sort((a, b) => b.width * b.height - a.width * a.height);

    for (const panel of sortedFloating) {
      const pw = panel.width + kerf;
      const ph = panel.height + kerf;

      let bestIdx = -1;
      let bestArea = Infinity;
      let bestRotated = false;

      for (let i = 0; i < freeRects.length; i++) {
        const r = freeRects[i];
        if (r.w >= pw && r.h >= ph) {
          const area = r.w * r.h;
          if (area < bestArea) { bestArea = area; bestIdx = i; bestRotated = false; }
        }
        if (r.w >= ph && r.h >= pw) {
          const area = r.w * r.h;
          if (area < bestArea) { bestArea = area; bestIdx = i; bestRotated = true; }
        }
      }

      if (bestIdx === -1) { unplacedFloating.push(panel); continue; }

      const rect = freeRects[bestIdx];
      const placeW = bestRotated ? panel.height : panel.width;
      const placeH = bestRotated ? panel.width : panel.height;

      newPlacements.push({
        ...panel,
        x: rect.x,
        y: rect.y,
        width: placeW,
        height: placeH,
        rotated: bestRotated ? !panel.rotated : panel.rotated,
      });

      freeRects = subtractRect(freeRects, { x: rect.x, y: rect.y, w: placeW + kerf, h: placeH + kerf });
      freeRects = pruneContained(freeRects);
    }

    // ── Derive fresh cut sequence from new placements ────────────────────────
    const cutSequence = deriveCutSequenceFromPlacements(
      newPlacements,
      stockSheet.length,
      stockSheet.width,
    );

    // Recalculate waste against usable area (excluding trim)
    const usableL = stockSheet.length - stockSheet.trimLeft - stockSheet.trimRight;
    const usableW = stockSheet.width - stockSheet.trimTop - stockSheet.trimBottom;
    const totalArea = usableL * usableW;
    const usedArea = newPlacements.reduce((s, p) => s + p.width * p.height, 0);

    return {
      ...sheet,
      placements: newPlacements,
      cutSequence,
      wastePercent: ((totalArea - usedArea) / totalArea) * 100,
      usedArea,
    };
  });

  const totalArea = newSheets.reduce((s, sl) => {
    const ss = stockSheets.find((x) => x.id === sl.stockSheetId);
    if (!ss) return s;
    const usableL = ss.length - ss.trimLeft - ss.trimRight;
    const usableW = ss.width - ss.trimTop - ss.trimBottom;
    return s + usableL * usableW;
  }, 0);
  const totalUsed = newSheets.reduce((s, sl) => s + sl.usedArea, 0);

  return {
    ...solution,
    id: nanoid(),
    strategyName: 'Re-planned (anchored)',
    sheets: newSheets,
    totalWaste: totalArea > 0 ? ((totalArea - totalUsed) / totalArea) * 100 : 0,
    totalSheets: newSheets.length,
    unplacedPanels: solution.unplacedPanels,
  };
}
