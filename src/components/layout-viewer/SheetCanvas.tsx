'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { SheetLayout, StockSheet } from '@/lib/optimizer/types';
import { useViewStore } from '@/store/useViewStore';
import { useDragStore } from '@/store/useDragStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { getColor } from '@/lib/colors';
import { formatDisplay, unitSuffix } from '@/lib/fractions';
import { pieceGrainAxis, sheetGrainAxis, isGrainMismatch } from '@/lib/grain';
import { useProjectStore } from '@/store/useProjectStore';
import { deriveCutSequenceFromPlacements } from '@/lib/optimizer/reoptimize';
import { Maximize2 } from 'lucide-react';

interface SheetCanvasProps {
  sheetLayout: SheetLayout;
  stockSheet: StockSheet;
  sheetNumber: number;
  maxWidth?: number;     // override default 800 (used by lightbox)
  onExpand?: () => void; // when set, shows the expand button
}

const PADDING = 40;
const DEFAULT_MAX_WIDTH = 800;

export function SheetCanvas({ sheetLayout, stockSheet, sheetNumber, maxWidth, onExpand }: SheetCanvasProps) {
  const MAX_WIDTH = maxWidth ?? DEFAULT_MAX_WIDTH;
  // Unique per component instance so the thumbnail and lightbox canvases (same
  // sheetKey, different scale) don't collide on clipPath ids. Strip colons —
  // React's useId output contains them and they're unsafe in url(#id) refs.
  const uid = useId().replace(/:/g, '');
  const { showLabels, viewMode, showCutSequence, showEdgeDims, showGrain, zoom } = useViewStore();
  const { units, panels } = useProjectStore();
  const fmt = (v: number) => formatDisplay(v, units);
  const sfx = unitSuffix(units);
  const monoMode = viewMode === 'mono';
  const outlineMode = viewMode === 'outline';
  const { togglePin, isPinned } = useDragStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragState, setDragState] = useState<{
    placementIndex: number;
    offsetX: number;
    offsetY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  const sheetKey = `${stockSheet.id}-${sheetLayout.sheetIndex}`;
  const sheetW = stockSheet.length;
  const sheetH = stockSheet.width;
  const scale = Math.min((MAX_WIDTH - PADDING * 2) / sheetW, 400 / sheetH) * zoom;
  const svgW = sheetW * scale + PADDING * 2;
  const svgH = sheetH * scale + PADDING * 2;

  // ── Coordinate helpers ─────────────────────────────────────────────────────

  const getSvgPoint = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      if (!svg || !ctm) return { x: 0, y: 0 };
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const svgPt = pt.matrixTransform(ctm.inverse());
      return { x: (svgPt.x - PADDING) / scale, y: (svgPt.y - PADDING) / scale };
    },
    [scale]
  );

  const snapToEdges = useCallback(
    (rawX: number, rawY: number, placementIndex: number) => {
      const p = sheetLayout.placements[placementIndex];
      const threshold = 8 / scale;
      const others = sheetLayout.placements.filter((_, pi) => pi !== placementIndex);

      const xCandidates = [
        stockSheet.trimLeft,
        sheetW - stockSheet.trimRight - p.width,
        ...others.flatMap((o) => [o.x, o.x + o.width, o.x - p.width, o.x + o.width - p.width]),
      ];
      const yCandidates = [
        stockSheet.trimTop,
        sheetH - stockSheet.trimBottom - p.height,
        ...others.flatMap((o) => [o.y, o.y + o.height, o.y - p.height, o.y + o.height - p.height]),
      ];

      let x = rawX;
      let y = rawY;
      for (const cx of xCandidates) {
        if (Math.abs(rawX - cx) <= threshold) { x = cx; break; }
      }
      for (const cy of yCandidates) {
        if (Math.abs(rawY - cy) <= threshold) { y = cy; break; }
      }
      return {
        x: Math.max(stockSheet.trimLeft, Math.min(x, sheetW - stockSheet.trimRight - p.width)),
        y: Math.max(stockSheet.trimTop, Math.min(y, sheetH - stockSheet.trimBottom - p.height)),
      };
    },
    [
      sheetLayout.placements,
      sheetW,
      sheetH,
      scale,
      stockSheet.trimLeft,
      stockSheet.trimRight,
      stockSheet.trimTop,
      stockSheet.trimBottom,
    ]
  );

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, placementIndex: number) => {
      if (e.button !== 0) return;
      const p = sheetLayout.placements[placementIndex];
      const svgPt = getSvgPoint(e.clientX, e.clientY);
      setDragState({
        placementIndex,
        offsetX: svgPt.x - p.x,
        offsetY: svgPt.y - p.y,
        currentX: p.x,
        currentY: p.y,
      });
      (e.target as Element).setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [sheetLayout.placements, getSvgPoint]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState) return;
      const svgPt = getSvgPoint(e.clientX, e.clientY);
      const p = sheetLayout.placements[dragState.placementIndex];

      let rawX = svgPt.x - dragState.offsetX;
      let rawY = svgPt.y - dragState.offsetY;
      rawX = Math.max(stockSheet.trimLeft, Math.min(rawX, sheetW - stockSheet.trimRight - p.width));
      rawY = Math.max(stockSheet.trimTop, Math.min(rawY, sheetH - stockSheet.trimBottom - p.height));

      const { x: newX, y: newY } = snapToEdges(rawX, rawY, dragState.placementIndex);
      setDragState((prev) => prev ? { ...prev, currentX: newX, currentY: newY } : null);
    },
    [
      dragState,
      getSvgPoint,
      sheetLayout.placements,
      sheetW,
      sheetH,
      snapToEdges,
      stockSheet.trimLeft,
      stockSheet.trimRight,
      stockSheet.trimTop,
      stockSheet.trimBottom,
    ]
  );

  /** Commit a piece's new (already-snapped/clamped) position to the store, push
   *  undo history, and auto-pin it. Shared by pointer-drag release and the
   *  keyboard arrow-key nudge path so both interaction methods stay in sync. */
  const commitMove = useCallback(
    (placementIndex: number, x: number, y: number) => {
      const layoutStore = useLayoutStore.getState();
      useHistoryStore.getState().pushState({
        solutions: layoutStore.solutions,
        activeSolutionIndex: layoutStore.activeSolutionIndex,
      });

      const updatedSolutions = layoutStore.solutions.map((sol, si) => {
        if (si !== layoutStore.activeSolutionIndex) return sol;
        return {
          ...sol,
          sheets: sol.sheets.map((sheet) => {
            if (sheet.stockSheetId !== stockSheet.id || sheet.sheetIndex !== sheetLayout.sheetIndex)
              return sheet;
            const newPlacements = sheet.placements.map((pl, pi) => {
              if (pi !== placementIndex) return pl;
              return { ...pl, x, y };
            });
            const { steps: cutSequence, isApproximate: cutSequenceApproximate } =
              deriveCutSequenceFromPlacements(newPlacements, sheetW, sheetH, {
                left: stockSheet.trimLeft,
                top: stockSheet.trimTop,
                right: stockSheet.trimRight,
                bottom: stockSheet.trimBottom,
              });
            return {
              ...sheet,
              placements: newPlacements,
              cutSequence,
              cutSequenceApproximate,
            };
          }),
        };
      });
      layoutStore.updateSolutions(updatedSolutions);

      if (!isPinned(sheetKey, placementIndex)) {
        togglePin(sheetKey, placementIndex);
      }
    },
    [sheetLayout, stockSheet, sheetKey, sheetW, sheetH, isPinned, togglePin]
  );

  const handlePointerUp = useCallback(() => {
    if (!dragState) return;

    const p = sheetLayout.placements[dragState.placementIndex];
    const snappedX = dragState.currentX;
    const snappedY = dragState.currentY;

    if (Math.abs(snappedX - p.x) > 0.05 || Math.abs(snappedY - p.y) > 0.05) {
      commitMove(dragState.placementIndex, snappedX, snappedY);
    }
    setDragState(null);
  }, [dragState, sheetLayout, commitMove]);

  // ── Pin click ──────────────────────────────────────────────────────────────

  const handlePinClick = useCallback(
    (e: React.MouseEvent, placementIndex: number) => {
      e.stopPropagation();
      togglePin(sheetKey, placementIndex);
    },
    [sheetKey, togglePin]
  );

  // ── Rotate piece ───────────────────────────────────────────────────────────

  const handleRotate = useCallback(
    (e: { stopPropagation(): void; preventDefault(): void }, placementIndex: number) => {
      e.stopPropagation();
      e.preventDefault();

      const layoutStore = useLayoutStore.getState();
      useHistoryStore.getState().pushState({
        solutions: layoutStore.solutions,
        activeSolutionIndex: layoutStore.activeSolutionIndex,
      });

      const updatedSolutions = layoutStore.solutions.map((sol, si) => {
        if (si !== layoutStore.activeSolutionIndex) return sol;
        return {
          ...sol,
          sheets: sol.sheets.map((sheet) => {
            if (sheet.stockSheetId !== stockSheet.id || sheet.sheetIndex !== sheetLayout.sheetIndex)
              return sheet;

            const newPlacements = sheet.placements.map((pl, pi) => {
              if (pi !== placementIndex) return pl;
              const newW = pl.height;
              const newH = pl.width;
              // Keep same center, clamped to sheet bounds
              const centeredX = Math.max(0, Math.min(pl.x + (pl.width - newW) / 2, sheetW - newW));
              const centeredY = Math.max(0, Math.min(pl.y + (pl.height - newH) / 2, sheetH - newH));

              // Re-snap the rotated piece to trim edges / neighbor edges so it trues up
              const threshold = 8 / scale;
              const others = sheet.placements.filter((_, oi) => oi !== placementIndex);
              const xCandidates = [
                stockSheet.trimLeft,
                sheetW - stockSheet.trimRight - newW,
                ...others.flatMap((o) => [o.x, o.x + o.width, o.x - newW, o.x + o.width - newW]),
              ];
              const yCandidates = [
                stockSheet.trimTop,
                sheetH - stockSheet.trimBottom - newH,
                ...others.flatMap((o) => [o.y, o.y + o.height, o.y - newH, o.y + o.height - newH]),
              ];
              let snapX = centeredX;
              let snapY = centeredY;
              for (const cx of xCandidates) {
                if (Math.abs(centeredX - cx) <= threshold) { snapX = cx; break; }
              }
              for (const cy of yCandidates) {
                if (Math.abs(centeredY - cy) <= threshold) { snapY = cy; break; }
              }
              const newX = Math.max(stockSheet.trimLeft, Math.min(snapX, sheetW - stockSheet.trimRight - newW));
              const newY = Math.max(stockSheet.trimTop, Math.min(snapY, sheetH - stockSheet.trimBottom - newH));

              return { ...pl, x: newX, y: newY, width: newW, height: newH, rotated: !pl.rotated };
            });

            const { steps: cutSequence, isApproximate: cutSequenceApproximate } =
              deriveCutSequenceFromPlacements(newPlacements, sheetW, sheetH, {
                left: stockSheet.trimLeft,
                top: stockSheet.trimTop,
                right: stockSheet.trimRight,
                bottom: stockSheet.trimBottom,
              });
            return {
              ...sheet,
              placements: newPlacements,
              cutSequence,
              cutSequenceApproximate,
            };
          }),
        };
      });

      layoutStore.updateSolutions(updatedSolutions);

      // Auto-pin on rotate
      if (!isPinned(sheetKey, placementIndex)) {
        togglePin(sheetKey, placementIndex);
      }
    },
    [sheetLayout, stockSheet, sheetKey, sheetW, sheetH, scale, isPinned, togglePin]
  );

  // ── Keyboard nudge (arrow keys) ────────────────────────────────────────────
  // Keyboard/switch-device equivalent to pointer drag: arrow keys move the
  // focused piece by one step (a larger step with Shift), snapping to sheet
  // edges/trim and neighboring pieces exactly like a pointer drag release.
  // Enter/Space rotates (same as clicking the rotate button); "P" toggles pin.
  //
  // The step must clear snapToEdges' own snap radius (8px in screen space, i.e.
  // 8/scale sheet units) or every nudge snaps straight back to the edge/piece it
  // started against and the piece never visibly moves. Deriving both steps from
  // that same radius keeps them correct at any zoom level or sheet size, instead
  // of a fixed unit value that works only for some scales.
  const snapThreshold = 8 / scale;
  const NUDGE_STEP = snapThreshold * 1.5;
  const NUDGE_STEP_LARGE = snapThreshold * 6;
  const [announcement, setAnnouncement] = useState('');

  const handlePieceKeyDown = useCallback(
    (e: React.KeyboardEvent, placementIndex: number) => {
      const p = sheetLayout.placements[placementIndex];
      const label = p.label || `Panel ${placementIndex + 1}`;
      const rotationLocked = panels.find((pl) => pl.id === p.panelId)?.lockRotation ?? false;

      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        // Stop the lightbox's window-level Escape/arrow handler from also
        // seeing this key — it isn't arrow/Escape so it's a no-op there today,
        // but stopping propagation keeps this control self-contained.
        e.stopPropagation();
        if (rotationLocked) {
          setAnnouncement(`${label} rotation is locked`);
        } else {
          handleRotate(e, placementIndex);
          setAnnouncement(`${label} rotated`);
        }
        return;
      }
      // Unmodified "P" only — Ctrl/Cmd+P is the browser's print shortcut and
      // must keep working while a piece has focus.
      if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const wasPinned = isPinned(sheetKey, placementIndex);
        togglePin(sheetKey, placementIndex);
        setAnnouncement(`${label} ${wasPinned ? 'unpinned' : 'pinned'}`);
        return;
      }

      let dx = 0;
      let dy = 0;
      const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;

      e.preventDefault();
      // Stop the lightbox's window-level arrow-key handler from also
      // interpreting this as "go to next/previous sheet" while a piece has
      // keyboard focus inside the expanded view.
      e.stopPropagation();
      const rawX = Math.max(stockSheet.trimLeft, Math.min(p.x + dx, sheetW - stockSheet.trimRight - p.width));
      const rawY = Math.max(stockSheet.trimTop, Math.min(p.y + dy, sheetH - stockSheet.trimBottom - p.height));
      const { x: newX, y: newY } = snapToEdges(rawX, rawY, placementIndex);
      if (Math.abs(newX - p.x) > 0.001 || Math.abs(newY - p.y) > 0.001) {
        commitMove(placementIndex, newX, newY);
        const suffix = unitSuffix(units);
        setAnnouncement(
          `${label} moved to ${formatDisplay(newX, units)}${suffix}, ${formatDisplay(newY, units)}${suffix}`
        );
      }
    },
    [sheetLayout.placements, panels, stockSheet, sheetW, sheetH, units, snapToEdges, commitMove, sheetKey, togglePin, isPinned, handleRotate, NUDGE_STEP, NUDGE_STEP_LARGE]
  );

  // ── Rendering ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">
          Sheet {sheetNumber}
          {stockSheet.label && ` — ${stockSheet.label}`}
          <span className="text-muted-foreground font-normal ml-2">
            ({fmt(sheetW)}{sfx} &times; {fmt(sheetH)}{sfx})
          </span>
        </h4>
        <span className="text-xs text-muted-foreground">
          Waste: {sheetLayout.wastePercent.toFixed(1)}%
        </span>
      </div>

      {/* SVG wrapper — expand button sits on the top-right corner of the sheet border */}
      <div className="relative inline-block">
      <svg
        ref={svgRef}
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        role="group"
        aria-label={`Cutting diagram for sheet ${sheetNumber}${stockSheet.label ? ` (${stockSheet.label})` : ''}: ${fmt(sheetW)}${sfx} by ${fmt(sheetH)}${sfx}, ${sheetLayout.placements.length} pieces, ${sheetLayout.wastePercent.toFixed(0)}% waste. Tab to a piece to move, rotate, or pin it with the keyboard. The Shop List tab also lists every piece in an accessible table.`}
        className="rounded-xl border border-border bg-card select-none shadow-sm"
        // Stop the browser from scrolling/panning the page when a drag starts on
        // a touch device, so panels can actually be dragged on a shop tablet.
        style={{ touchAction: 'none' }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Grain-direction hatch patterns — parallel lines running ALONG the
            grain axis. Horizontal lines = grain runs left-right (X); vertical
            lines = grain runs top-bottom (Y). Pattern (not color) carries the
            direction, so it stays colorblind-safe. A separate amber pattern
            marks pieces whose grain is perpendicular to the sheet grain. */}
        {showGrain && (
          <defs>
            <pattern id={`grain-x-${uid}`} width={7} height={7} patternUnits="userSpaceOnUse">
              <line x1={0} y1={3.5} x2={7} y2={3.5} stroke="var(--canvas-grain)" strokeWidth={0.75} opacity={0.28} />
            </pattern>
            <pattern id={`grain-y-${uid}`} width={7} height={7} patternUnits="userSpaceOnUse">
              <line x1={3.5} y1={0} x2={3.5} y2={7} stroke="var(--canvas-grain)" strokeWidth={0.75} opacity={0.28} />
            </pattern>
            <pattern id={`grain-mismatch-x-${uid}`} width={7} height={7} patternUnits="userSpaceOnUse">
              <line x1={0} y1={3.5} x2={7} y2={3.5} stroke="var(--canvas-grain-mismatch)" strokeWidth={1} opacity={0.6} />
            </pattern>
            <pattern id={`grain-mismatch-y-${uid}`} width={7} height={7} patternUnits="userSpaceOnUse">
              <line x1={3.5} y1={0} x2={3.5} y2={7} stroke="var(--canvas-grain-mismatch)" strokeWidth={1} opacity={0.6} />
            </pattern>
          </defs>
        )}

        {/* Sheet background */}
        <rect
          x={PADDING} y={PADDING}
          width={sheetW * scale} height={sheetH * scale}
          fill={outlineMode ? 'var(--canvas-sheet-outline-mode)' : 'var(--canvas-sheet)'}
          stroke="var(--canvas-sheet-border)"
          strokeWidth={1.5}
        />

        {/* Sheet grain indicator — a double-headed arrow along the sheet grain
            axis, anchored just inside the top-left of the sheet, with a "grain"
            label. Tells the woodworker which way the stock grain runs. */}
        {showGrain && (() => {
          const axis = sheetGrainAxis(stockSheet);
          const ox = PADDING + 14;
          const oy = PADDING + 14;
          const len = 34;
          const x2 = axis === 'x' ? ox + len : ox;
          const y2 = axis === 'x' ? oy : oy + len;
          return (
            <g aria-hidden style={{ pointerEvents: 'none' }}>
              <line
                x1={ox} y1={oy} x2={x2} y2={y2}
                stroke="var(--canvas-grain-arrow)" strokeWidth={1.5}
                markerStart={`url(#grain-arrow-start-${uid})`}
                markerEnd={`url(#grain-arrow-end-${uid})`}
              />
              <text
                x={axis === 'x' ? ox + len / 2 : ox + 6}
                y={axis === 'x' ? oy - 5 : oy + len / 2}
                textAnchor={axis === 'x' ? 'middle' : 'start'}
                dominantBaseline={axis === 'x' ? 'auto' : 'middle'}
                fill="var(--canvas-grain-arrow-label)" fontSize={8} fontWeight={600}
              >
                grain
              </text>
              <defs>
                <marker id={`grain-arrow-end-${uid}`} markerWidth={6} markerHeight={6}
                  refX={5} refY={3} orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="var(--canvas-grain-arrow)" />
                </marker>
                <marker id={`grain-arrow-start-${uid}`} markerWidth={6} markerHeight={6}
                  refX={1} refY={3} orient="auto">
                  <path d="M6,0 L0,3 L6,6 Z" fill="var(--canvas-grain-arrow)" />
                </marker>
              </defs>
            </g>
          );
        })()}

        {/* Trim areas */}
        {stockSheet.trimTop > 0 && (
          <rect x={PADDING} y={PADDING} width={sheetW * scale} height={stockSheet.trimTop * scale}
            fill="var(--canvas-trim)" opacity={0.5} />
        )}
        {stockSheet.trimBottom > 0 && (
          <rect x={PADDING} y={PADDING + (sheetH - stockSheet.trimBottom) * scale}
            width={sheetW * scale} height={stockSheet.trimBottom * scale}
            fill="var(--canvas-trim)" opacity={0.5} />
        )}
        {stockSheet.trimLeft > 0 && (
          <rect x={PADDING} y={PADDING} width={stockSheet.trimLeft * scale} height={sheetH * scale}
            fill="var(--canvas-trim)" opacity={0.5} />
        )}
        {stockSheet.trimRight > 0 && (
          <rect x={PADDING + (sheetW - stockSheet.trimRight) * scale} y={PADDING}
            width={stockSheet.trimRight * scale} height={sheetH * scale}
            fill="var(--canvas-trim)" opacity={0.5} />
        )}

        {/* ── Pieces ───────────────────────────────────────────────────── */}
        {sheetLayout.placements.map((p, i) => {
          const isDragging = dragState?.placementIndex === i;
          const pinned = isPinned(sheetKey, i);
          const displayX = isDragging ? dragState.currentX : p.x;
          const displayY = isDragging ? dragState.currentY : p.y;

          const px = PADDING + displayX * scale;
          const py = PADDING + displayY * scale;
          const pw = p.width * scale;
          const ph = p.height * scale;
          const color = monoMode ? getColor(i, true) : p.color;

          // Visual style by mode
          let fill: string;
          let stroke: string;
          let strokeWidth: number;
          let labelFill: string;
          let dimFill: string;

          if (outlineMode) {
            fill = 'var(--canvas-outline-fill)';
            stroke = pinned ? '#f59e0b' : 'var(--canvas-outline-stroke)';
            strokeWidth = pinned ? 2.5 : 1.5;
            labelFill = 'var(--canvas-outline-label)';
            dimFill = 'var(--canvas-outline-dim)';
          } else if (monoMode) {
            fill = color;
            stroke = pinned ? '#f59e0b' : 'var(--canvas-mono-stroke)';
            strokeWidth = pinned ? 2.5 : 1;
            labelFill = 'var(--canvas-mono-label)';
            dimFill = 'var(--canvas-mono-dim)';
          } else {
            fill = color;
            stroke = pinned ? '#f59e0b' : 'var(--canvas-piece-stroke)';
            strokeWidth = pinned ? 2.5 : 1;
            labelFill = 'var(--canvas-piece-label)';
            dimFill = 'var(--canvas-piece-dim)';
          }

          const rotateBtnSize = 9;
          const smallPiece = pw < 28 || ph < 28;
          // For small pieces, float the button above-left the piece; otherwise inside bottom-left
          const rotateBtnX = smallPiece ? px + rotateBtnSize : px + rotateBtnSize + 3;
          const rotateBtnY = smallPiece ? py - rotateBtnSize - 2 : py + ph - rotateBtnSize - 3;
          const rotationLocked = panels.find(pl => pl.id === p.panelId)?.lockRotation ?? false;

          const grainAxis = pieceGrainAxis(p);
          const grainMismatch = isGrainMismatch(p, stockSheet, rotationLocked);
          const grainPatternId = grainMismatch
            ? `grain-mismatch-${grainAxis}-${uid}`
            : `grain-${grainAxis}-${uid}`;

          const pieceLabel = p.label || `Panel ${i + 1}`;
          const rotateHint = rotationLocked ? 'rotation is locked' : 'Enter to rotate';
          const pinHint = pinned ? 'P to unpin' : 'P to pin';
          const pieceDescription =
            `${pieceLabel}, ${fmt(p.width)}${sfx} by ${fmt(p.height)}${sfx}` +
            `${pinned ? ', pinned' : ''}${rotationLocked ? ', rotation locked' : ''}. ` +
            `Use arrow keys to move, ${rotateHint}, ${pinHint}.`;

          return (
            <g
              key={`${p.panelId}-${i}`}
              role="button"
              tabIndex={0}
              aria-label={pieceDescription}
              style={{ cursor: isDragging ? 'grabbing' : 'grab', opacity: isDragging ? 0.75 : 0.9 }}
              className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
              onPointerDown={(e) => handlePointerDown(e, i)}
              onKeyDown={(e) => handlePieceKeyDown(e, i)}
            >
              <rect
                x={px} y={py} width={pw} height={ph}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                rx={2}
              />

              {/* Grain hatch overlay — directional lines fill the piece along its
                  grain axis; amber when the grain is perpendicular to the sheet
                  grain (a mismatch worth catching before cutting). */}
              {showGrain && (
                <rect
                  x={px} y={py} width={pw} height={ph}
                  fill={`url(#${grainPatternId})`}
                  rx={2}
                  aria-hidden
                  style={{ pointerEvents: 'none' }}
                />
              )}

              {/* Grain-mismatch flag — amber ⚠ badge, bottom-right corner */}
              {showGrain && grainMismatch && pw >= 16 && ph >= 16 && (
                <g aria-hidden style={{ pointerEvents: 'none' }}>
                  <circle cx={px + pw - 9} cy={py + ph - 9} r={7} fill="#b45309" />
                  <text
                    x={px + pw - 9} y={py + ph - 9}
                    textAnchor="middle" dominantBaseline="central"
                    fill="white" fontSize={9} fontWeight="bold"
                  >
                    ⚠
                  </text>
                </g>
              )}

              {/* Rotate button — bottom-left corner (or above piece if too small) */}
              {rotationLocked ? (
                <g>
                  <circle
                    cx={rotateBtnX} cy={rotateBtnY} r={rotateBtnSize}
                    fill="rgba(245,158,11,0.6)"
                  />
                  <text
                    x={rotateBtnX} y={rotateBtnY}
                    textAnchor="middle" dominantBaseline="central"
                    fill="white" fontSize={8}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    🔒
                  </text>
                </g>
              ) : (
                <g
                  onClick={(e) => handleRotate(e, i)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    cx={rotateBtnX} cy={rotateBtnY} r={rotateBtnSize}
                    fill="rgba(0,0,0,0.25)"
                    className="hover:fill-[rgba(0,0,0,0.45)]"
                  />
                  <text
                    x={rotateBtnX} y={rotateBtnY}
                    textAnchor="middle" dominantBaseline="central"
                    fill="white" fontSize={10}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    ↺
                  </text>
                </g>
              )}

              {/* Pin badge — top-right corner */}
              {pinned && (
                <g onClick={(e) => handlePinClick(e, i)} style={{ cursor: 'pointer' }}>
                  <circle cx={px + pw - 10} cy={py + 10} r={8} fill="#f59e0b" />
                  <text
                    x={px + pw - 10} y={py + 10}
                    textAnchor="middle" dominantBaseline="central"
                    fill="white" fontSize={9} fontWeight="bold"
                    style={{ pointerEvents: 'none' }}
                  >
                    ⚓
                  </text>
                </g>
              )}

              {/* Cut-list index badge — top-left corner. Always shown on any
                  piece big enough to hold a digit so it stays legible for
                  colorblind users (color is not the only cue). */}
              {pw >= 11 && ph >= 11 && (
                <text
                  x={px + 5} y={py + 5}
                  textAnchor="start" dominantBaseline="hanging"
                  fill={outlineMode ? 'var(--canvas-outline-index)' : 'rgba(255,255,255,0.8)'}
                  fontSize={8} fontWeight="700"
                  aria-hidden
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {i + 1}
                </text>
              )}

              {/* Labels — clipped to the piece so long names don't overflow.
                  The dimensions line is suppressed when edge dims are shown, to
                  avoid printing the same measurement twice. */}
              {showLabels && pw > 36 && ph > 24 && (
                <>
                  <clipPath id={`label-clip-${uid}-${i}`}>
                    <rect x={px + 2} y={py} width={Math.max(0, pw - 4)} height={ph} />
                  </clipPath>
                  <text
                    x={px + pw / 2} y={py + ph / 2 - (showEdgeDims ? 0 : 6)}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={labelFill} fontSize={11} fontWeight="600"
                    clipPath={`url(#label-clip-${uid}-${i})`}
                    aria-hidden
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {p.label || `Panel ${i + 1}`}
                  </text>
                  {!showEdgeDims && (
                    <text
                      x={px + pw / 2} y={py + ph / 2 + 8}
                      textAnchor="middle" dominantBaseline="middle"
                      fill={dimFill} fontSize={9}
                      aria-hidden
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {fmt(p.width)}{sfx} &times; {fmt(p.height)}{sfx}
                    </text>
                  )}
                </>
              )}

              {/* Edge dimension labels */}
              {showEdgeDims && (
                <>
                  {/* Width — along top edge */}
                  {pw >= 20 && (
                    <text
                      x={px + pw / 2} y={py + 5}
                      textAnchor="middle" dominantBaseline="hanging"
                      fill={outlineMode ? 'var(--canvas-outline-edgedim)' : 'rgba(255,255,255,0.9)'}
                      fontSize={8} fontWeight="700"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {fmt(p.width)}{sfx}
                    </text>
                  )}
                  {/* Height — along left edge, rotated */}
                  {ph >= 20 && (
                    <text
                      x={px + 5} y={py + ph / 2}
                      textAnchor="middle" dominantBaseline="hanging"
                      transform={`rotate(-90, ${px + 5}, ${py + ph / 2})`}
                      fill={outlineMode ? 'var(--canvas-outline-edgedim)' : 'rgba(255,255,255,0.9)'}
                      fontSize={8} fontWeight="700"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {fmt(p.height)}{sfx}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}

        {/* ── Cut sequence overlay ──────────────────────────────────────── */}
        {showCutSequence && sheetLayout.cutSequence.map((cut) => {
          // Use clipped segments when available (new data); fall back to full span
          const segs = cut.segments?.length
            ? cut.segments
            : [{ x1: cut.x1, y1: cut.y1, x2: cut.x2, y2: cut.y2 }];
          // Badge goes at the stored anchor midpoint
          const bx = PADDING + ((cut.x1 + cut.x2) / 2) * scale;
          const by = PADDING + ((cut.y1 + cut.y2) / 2) * scale;
          // Approximate cuts render in amber to signal they may pass through a piece
          const cutColor = cut.approximate ? '#f59e0b' : '#ef4444';
          return (
            <g key={`cut-${cut.stepNumber}`}>
              {segs.map((seg, si) => (
                <line
                  key={si}
                  x1={PADDING + seg.x1 * scale} y1={PADDING + seg.y1 * scale}
                  x2={PADDING + seg.x2 * scale} y2={PADDING + seg.y2 * scale}
                  stroke={cutColor} strokeWidth={1.5} strokeDasharray="4 2"
                />
              ))}
              <circle cx={bx} cy={by} r={8} fill={cutColor} />
              <text
                x={bx} y={by}
                textAnchor="middle" dominantBaseline="central"
                fill="white" fontSize={9} fontWeight="bold"
                style={{ pointerEvents: 'none' }}
              >
                {cut.stepNumber}
              </text>
            </g>
          );
        })}

        {/* Sheet dimension labels */}
        <text x={PADDING + (sheetW * scale) / 2} y={PADDING - 10}
          textAnchor="middle" fill="var(--canvas-dim-label)" fontSize={11}>
          {fmt(sheetW)}{sfx}
        </text>
        <text
          x={PADDING - 10} y={PADDING + (sheetH * scale) / 2}
          textAnchor="middle"
          transform={`rotate(-90, ${PADDING - 10}, ${PADDING + (sheetH * scale) / 2})`}
          fill="var(--canvas-dim-label)" fontSize={11}
        >
          {fmt(sheetH)}{sfx}
        </text>
      </svg>

        {/* Expand button — top-right corner of the outer SVG card border */}
        {onExpand && (
          <button
            onClick={onExpand}
            title="Expand to full view"
            aria-label="Expand sheet to full view"
            className="absolute flex items-center justify-center rounded-md
                       bg-card hover:bg-muted text-muted-foreground hover:text-foreground
                       shadow-sm border border-border transition-all"
            style={{ top: -11, right: -11, width: 22, height: 22, zIndex: 1 }}
          >
            <Maximize2 style={{ width: 12, height: 12 }} />
          </button>
        )}
      </div>{/* end relative wrapper */}

      {/* Screen-reader-only announcements for keyboard move/rotate/pin actions
          on a focused piece — these mutate visual position/state only, with no
          other on-screen text change an AT user would otherwise be told about. */}
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>

      {/* ── Approximate cut sequence notice ─────────────────────────────── */}
      {showCutSequence && sheetLayout.cutSequenceApproximate && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <span aria-hidden>⚠</span>
          Cut sequence is approximate — pieces are not in a guillotine-valid layout. Amber cuts may pass through a piece; re-optimize to restore a valid sequence.
        </p>
      )}

      {/* ── Grain mismatch notice ───────────────────────────────────────── */}
      {showGrain && (() => {
        const mismatches = sheetLayout.placements.filter((p) => {
          const locked = panels.find((pl) => pl.id === p.panelId)?.lockRotation ?? false;
          return isGrainMismatch(p, stockSheet, locked);
        }).length;
        if (mismatches === 0) return null;
        return (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1">
            <span aria-hidden>⚠</span>
            {mismatches} piece{mismatches !== 1 ? 's' : ''} placed cross-grain (grain runs perpendicular to the sheet grain). Rotate to align if grain direction matters for this cut.
          </p>
        );
      })()}

      {/* ── Piece legend (deduplicated) ──────────────────────────────────── */}
      {(() => {
        // Group by panelId → keep first occurrence's color/dims, count multiples
        const seen = new Map<string, { label: string; width: number; height: number; color: string; count: number; idx: number }>();
        sheetLayout.placements.forEach((p, i) => {
          if (!seen.has(p.panelId)) {
            seen.set(p.panelId, {
              label: p.label || `Panel ${i + 1}`,
              width: p.width,
              height: p.height,
              color: monoMode ? getColor(i, true) : p.color,
              count: 1,
              idx: i,
            });
          } else {
            seen.get(p.panelId)!.count++;
          }
        });
        return (
          <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1">
            {[...seen.values()].map(({ label, width, height, color, count, idx }) => (
              <div key={idx} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="inline-block w-3 h-3 rounded-sm shrink-0"
                  style={{
                    backgroundColor: outlineMode ? 'var(--canvas-outline-fill)' : color,
                    border: outlineMode ? '1.5px solid var(--canvas-outline-stroke)' : '1px solid rgba(0,0,0,0.1)',
                  }}
                />
                <span>
                  {label} — {fmt(width)}{sfx}&thinsp;&times;&thinsp;{fmt(height)}{sfx}
                  {count > 1 && <strong className="text-foreground ml-1">&times;{count}</strong>}
                </span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
