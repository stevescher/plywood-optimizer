'use client';

import { useCallback, useRef, useState } from 'react';
import { SheetLayout, StockSheet } from '@/lib/optimizer/types';
import { useViewStore } from '@/store/useViewStore';
import { useDragStore } from '@/store/useDragStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { getColor } from '@/lib/colors';
import { formatDisplay, unitSuffix } from '@/lib/fractions';
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
  const { showLabels, viewMode, showCutSequence, showEdgeDims, zoom } = useViewStore();
  const { units } = useProjectStore();
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
      if (!svg) return { x: 0, y: 0 };
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const svgPt = pt.matrixTransform(svg.getScreenCTM()!.inverse());
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
    [sheetLayout.placements, sheetW, sheetH, scale]
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
    [dragState, getSvgPoint, sheetLayout.placements, sheetW, sheetH, snapToEdges]
  );

  const handlePointerUp = useCallback(() => {
    if (!dragState) return;

    const p = sheetLayout.placements[dragState.placementIndex];
    const snappedX = dragState.currentX;
    const snappedY = dragState.currentY;

    if (Math.abs(snappedX - p.x) > 0.05 || Math.abs(snappedY - p.y) > 0.05) {
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
              if (pi !== dragState!.placementIndex) return pl;
              return { ...pl, x: snappedX, y: snappedY };
            });
            return {
              ...sheet,
              placements: newPlacements,
              cutSequence: deriveCutSequenceFromPlacements(newPlacements, sheetW, sheetH),
            };
          }),
        };
      });
      layoutStore.setSolutions(updatedSolutions);

      if (!isPinned(sheetKey, dragState.placementIndex)) {
        togglePin(sheetKey, dragState.placementIndex);
      }
    }
    setDragState(null);
  }, [dragState, sheetLayout, stockSheet.id, sheetKey, sheetW, sheetH, isPinned, togglePin]);

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
    (e: React.MouseEvent, placementIndex: number) => {
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
              const newX = Math.max(0, Math.min(pl.x + (pl.width - newW) / 2, sheetW - newW));
              const newY = Math.max(0, Math.min(pl.y + (pl.height - newH) / 2, sheetH - newH));
              return { ...pl, x: newX, y: newY, width: newW, height: newH, rotated: !pl.rotated };
            });

            return {
              ...sheet,
              placements: newPlacements,
              cutSequence: deriveCutSequenceFromPlacements(newPlacements, sheetW, sheetH),
            };
          }),
        };
      });

      layoutStore.setSolutions(updatedSolutions);

      // Auto-pin on rotate
      if (!isPinned(sheetKey, placementIndex)) {
        togglePin(sheetKey, placementIndex);
      }
    },
    [sheetLayout, stockSheet.id, sheetKey, sheetW, sheetH, isPinned, togglePin]
  );

  // ── Rendering ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">
          Sheet {sheetNumber}
          {stockSheet.label && ` — ${stockSheet.label}`}
          <span className="text-slate-400 font-normal ml-2">
            ({fmt(sheetW)}{sfx} &times; {fmt(sheetH)}{sfx})
          </span>
        </h4>
        <span className="text-xs text-slate-400">
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
        className="rounded-xl border border-slate-200 bg-white select-none shadow-sm"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Sheet background */}
        <rect
          x={PADDING} y={PADDING}
          width={sheetW * scale} height={sheetH * scale}
          fill={outlineMode ? '#fafafa' : '#f8fafc'}
          stroke="#cbd5e1"
          strokeWidth={1.5}
        />

        {/* Trim areas */}
        {stockSheet.trimTop > 0 && (
          <rect x={PADDING} y={PADDING} width={sheetW * scale} height={stockSheet.trimTop * scale}
            fill="#fee2e2" opacity={0.5} />
        )}
        {stockSheet.trimBottom > 0 && (
          <rect x={PADDING} y={PADDING + (sheetH - stockSheet.trimBottom) * scale}
            width={sheetW * scale} height={stockSheet.trimBottom * scale}
            fill="#fee2e2" opacity={0.5} />
        )}
        {stockSheet.trimLeft > 0 && (
          <rect x={PADDING} y={PADDING} width={stockSheet.trimLeft * scale} height={sheetH * scale}
            fill="#fee2e2" opacity={0.5} />
        )}
        {stockSheet.trimRight > 0 && (
          <rect x={PADDING + (sheetW - stockSheet.trimRight) * scale} y={PADDING}
            width={stockSheet.trimRight * scale} height={sheetH * scale}
            fill="#fee2e2" opacity={0.5} />
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
            fill = 'white';
            stroke = pinned ? '#f59e0b' : '#1e293b'; // black outlines
            strokeWidth = pinned ? 2.5 : 1.5;
            labelFill = '#1e293b';
            dimFill = '#64748b';
          } else if (monoMode) {
            fill = color;
            stroke = pinned ? '#f59e0b' : '#555';
            strokeWidth = pinned ? 2.5 : 1;
            labelFill = '#000';
            dimFill = '#555';
          } else {
            fill = color;
            stroke = pinned ? '#f59e0b' : 'rgba(255,255,255,0.6)';
            strokeWidth = pinned ? 2.5 : 1;
            labelFill = '#fff';
            dimFill = 'rgba(255,255,255,0.8)';
          }

          const rotateBtnSize = 9;
          const smallPiece = pw < 28 || ph < 28;
          // For small pieces, float the button above-left the piece; otherwise inside bottom-left
          const rotateBtnX = smallPiece ? px + rotateBtnSize : px + rotateBtnSize + 3;
          const rotateBtnY = smallPiece ? py - rotateBtnSize - 2 : py + ph - rotateBtnSize - 3;

          return (
            <g
              key={`${p.panelId}-${i}`}
              style={{ cursor: isDragging ? 'grabbing' : 'grab', opacity: isDragging ? 0.75 : 0.9 }}
              onPointerDown={(e) => handlePointerDown(e, i)}
            >
              <rect
                x={px} y={py} width={pw} height={ph}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                rx={2}
              />

              {/* Rotate button — bottom-left corner (or above piece if too small) */}
              {(
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

              {/* Cut-list index badge — top-left corner */}
              {pw >= 18 && ph >= 16 && (
                <text
                  x={px + 5} y={py + 5}
                  textAnchor="start" dominantBaseline="hanging"
                  fill={outlineMode ? '#475569' : 'rgba(255,255,255,0.65)'}
                  fontSize={8} fontWeight="700"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {i + 1}
                </text>
              )}

              {/* Labels */}
              {showLabels && pw > 36 && ph > 24 && (
                <>
                  <text
                    x={px + pw / 2} y={py + ph / 2 - 6}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={labelFill} fontSize={11} fontWeight="600"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {p.label || `Panel ${i + 1}`}
                  </text>
                  <text
                    x={px + pw / 2} y={py + ph / 2 + 8}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={dimFill} fontSize={9}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {fmt(p.width)}{sfx} &times; {fmt(p.height)}{sfx}
                  </text>
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
                      fill={outlineMode ? '#334155' : 'rgba(255,255,255,0.9)'}
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
                      fill={outlineMode ? '#334155' : 'rgba(255,255,255,0.9)'}
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
          return (
            <g key={`cut-${cut.stepNumber}`}>
              {segs.map((seg, si) => (
                <line
                  key={si}
                  x1={PADDING + seg.x1 * scale} y1={PADDING + seg.y1 * scale}
                  x2={PADDING + seg.x2 * scale} y2={PADDING + seg.y2 * scale}
                  stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 2"
                />
              ))}
              <circle cx={bx} cy={by} r={8} fill="#ef4444" />
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
          textAnchor="middle" fill="#94a3b8" fontSize={11}>
          {fmt(sheetW)}{sfx}
        </text>
        <text
          x={PADDING - 10} y={PADDING + (sheetH * scale) / 2}
          textAnchor="middle"
          transform={`rotate(-90, ${PADDING - 10}, ${PADDING + (sheetH * scale) / 2})`}
          fill="#94a3b8" fontSize={11}
        >
          {fmt(sheetH)}{sfx}
        </text>
      </svg>

        {/* Expand button — top-right corner of the outer SVG card border */}
        {onExpand && (
          <button
            onClick={onExpand}
            title="Expand to full view"
            className="absolute flex items-center justify-center rounded-md
                       bg-white hover:bg-slate-50 text-slate-400 hover:text-slate-700
                       shadow-sm border border-slate-200 transition-all"
            style={{ top: -11, right: -11, width: 22, height: 22, zIndex: 1 }}
          >
            <Maximize2 style={{ width: 12, height: 12 }} />
          </button>
        )}
      </div>{/* end relative wrapper */}

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
              <div key={idx} className="flex items-center gap-1.5 text-xs text-slate-500">
                <span
                  className="inline-block w-3 h-3 rounded-sm shrink-0"
                  style={{
                    backgroundColor: outlineMode ? 'white' : color,
                    border: outlineMode ? '1.5px solid #1e293b' : '1px solid rgba(0,0,0,0.1)',
                  }}
                />
                <span>
                  {label} — {fmt(width)}{sfx}&thinsp;&times;&thinsp;{fmt(height)}{sfx}
                  {count > 1 && <strong className="text-slate-700 ml-1">&times;{count}</strong>}
                </span>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
