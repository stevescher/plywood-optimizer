'use client';

import { useState, useEffect } from 'react';
import { useLayoutStore } from '@/store/useLayoutStore';
import { useDragStore } from '@/store/useDragStore';
import { SheetCanvas } from './SheetCanvas';
import { CutChecklist } from '@/components/cut-list/CutChecklist';
import { useProjectStore } from '@/store/useProjectStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { reOptimizeAroundPinned } from '@/lib/optimizer/reoptimize';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { LayoutGrid, ClipboardList, Anchor, RefreshCw, ZoomIn, ZoomOut, AlertTriangle, PlusCircle, Shuffle, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useViewStore, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from '@/store/useViewStore';
import { useOptimizer } from '@/hooks/useOptimizer';
import { Panel, StockSheet, Solution } from '@/lib/optimizer/types';
import { formatDisplay, unitSuffix } from '@/lib/fractions';

// ── Fix suggestion helpers ────────────────────────────────────────────────────

interface SheetSuggestion {
  sheet: StockSheet;
  extraQty: number;
  entries: Array<{ panel: Panel; unplacedCount: number }>;
}

function suggestFixes(
  solution: Solution,
  stockSheets: StockSheet[]
): { suggestions: SheetSuggestion[]; unfittable: Panel[] } {
  const groups = new Map<string, { sheet: StockSheet; entries: Array<{ panel: Panel; unplacedCount: number }> }>();
  const unfittable: Panel[] = [];

  for (const panel of solution.unplacedPanels) {
    const placedCount = solution.sheets.reduce(
      (sum, sl) => sum + sl.placements.filter((pl) => pl.panelId === panel.id).length,
      0
    );
    const unplacedCount = panel.quantity - placedCount;
    if (unplacedCount <= 0) continue;

    const fitting = stockSheets
      .filter((s) => s.length > 0 && s.width > 0)
      .filter((s) => {
        const l = s.length - s.trimLeft - s.trimRight;
        const w = s.width - s.trimTop - s.trimBottom;
        return (
          (panel.length <= l && panel.width <= w) ||
          (panel.width <= l && panel.length <= w)
        );
      })
      .sort((a, b) => a.length * a.width - b.length * b.width);

    if (fitting.length === 0) {
      unfittable.push(panel);
      continue;
    }

    const best = fitting[0];
    if (!groups.has(best.id)) {
      groups.set(best.id, { sheet: best, entries: [] });
    }
    groups.get(best.id)!.entries.push({ panel, unplacedCount });
  }

  const suggestions: SheetSuggestion[] = [...groups.values()].map(({ sheet, entries }) => {
    const totalArea = entries.reduce(
      (sum, { panel, unplacedCount }) => sum + panel.length * panel.width * unplacedCount,
      0
    );
    const usableL = sheet.length - sheet.trimLeft - sheet.trimRight;
    const usableW = sheet.width - sheet.trimTop - sheet.trimBottom;
    const usableArea = usableL * usableW * 0.7; // 70% packing efficiency estimate
    const extraQty = Math.max(1, Math.ceil(totalArea / usableArea));
    return { sheet, extraQty, entries };
  });

  return { suggestions, unfittable };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LayoutViewer() {
  const { solutions, activeSolutionIndex, revealedCount, setActive, setSolutions, shuffleNext } =
    useLayoutStore();
  const { stockSheets, kerf, updateStockSheet, units } = useProjectStore();
  const { pinnedPieces } = useDragStore();
  const { zoom, setZoom } = useViewStore();
  const optimize = useOptimizer();
  const fmt = (v: number) => formatDisplay(v, units);
  const sfx = unitSuffix(units);
  const pinnedCount = pinnedPieces.size;
  const [view, setView] = useState<'diagram' | 'checklist'>('diagram');
  const [reOptimizing, setReOptimizing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [expandedSheetIdx, setExpandedSheetIdx] = useState<number | null>(null);

  // Lock background scroll + keyboard nav while lightbox is open
  useEffect(() => {
    if (expandedSheetIdx === null) { document.body.style.overflow = ''; return; }
    document.body.style.overflow = 'hidden';
    const total = solutions[activeSolutionIndex]?.sheets.length ?? 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedSheetIdx(null);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
        setExpandedSheetIdx((i) => (i !== null && i < total - 1 ? i + 1 : i));
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
        setExpandedSheetIdx((i) => (i !== null && i > 0 ? i - 1 : i));
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [expandedSheetIdx, solutions, activeSolutionIndex]);

  if (solutions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
          <LayoutGrid className="h-8 w-8 text-slate-300" />
        </div>
        <div className="text-center">
          <p className="text-base font-semibold text-slate-500">No layouts yet</p>
          <p className="text-sm text-slate-400 mt-1">Add stock sheets and panels, then click Plan Cuts</p>
        </div>
      </div>
    );
  }

  const visibleSolutions = solutions.slice(0, revealedCount);
  const activeSolution = solutions[activeSolutionIndex];

  const handleReOptimize = () => {
    if (!activeSolution) return;
    setReOptimizing(true);

    // Save for undo
    const layoutStore = useLayoutStore.getState();
    useHistoryStore.getState().pushState({
      solutions: layoutStore.solutions,
      activeSolutionIndex: layoutStore.activeSolutionIndex,
    });

    setTimeout(() => {
      const reOptimized = reOptimizeAroundPinned(
        activeSolution,
        stockSheets,
        pinnedPieces,
        kerf
      );
      // Inject re-optimized result as a new top solution
      const updated = [reOptimized, ...solutions.filter((s) => s.id !== activeSolution.id)];
      setSolutions(updated);
      setActive(0);
      setReOptimizing(false);
    }, 50);
  };

  const handleFix = (fixes: Array<{ sheet: StockSheet; extraQty: number }>) => {
    setFixing(true);
    for (const { sheet, extraQty } of fixes) {
      updateStockSheet(sheet.id, { quantity: sheet.quantity + extraQty });
    }
    // optimize reads fresh store state, so schedule after state settles
    setTimeout(() => {
      optimize();
      setFixing(false);
    }, 50);
  };

  return (
    <div className="flex flex-col h-full">

      {/* ── Top bar: layout selector + view toggle ───────────────────── */}
      <div className="px-4 py-2.5 border-b border-slate-200 bg-white shrink-0 flex items-center justify-between gap-4">
        {/* Layout pills + More Layouts */}
        <div className="flex items-center gap-1.5">
          {visibleSolutions.length > 1 && (
            <>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mr-1">
                Layout
              </span>
              {visibleSolutions.map((sol, i) => (
                <button
                  key={sol.id}
                  onClick={() => setActive(i)}
                  title={`${sol.totalSheets} sheet${sol.totalSheets !== 1 ? 's' : ''} · ${sol.totalWaste.toFixed(1)}% waste`}
                  className={[
                    'h-7 min-w-[28px] px-2.5 rounded-full text-[11px] font-bold transition-all',
                    i === activeSolutionIndex
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                  ].join(' ')}
                >
                  {i + 1}
                </button>
              ))}
            </>
          )}
          {solutions.length > revealedCount && (
            <button
              onClick={shuffleNext}
              title="Show more layout alternatives"
              className="h-7 px-2.5 rounded-full text-[11px] font-semibold flex items-center gap-1
                         bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 transition-all"
            >
              <Shuffle className="h-3 w-3" />
              More Layouts
            </button>
          )}
        </div>

        {/* Zoom controls */}
        {view === 'diagram' && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setZoom(zoom - ZOOM_STEP)}
              disabled={zoom <= ZOOM_MIN}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-500
                         hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="text-[11px] font-semibold text-slate-400 w-9 text-center tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(zoom + ZOOM_STEP)}
              disabled={zoom >= ZOOM_MAX}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-500
                         hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* View toggle */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setView('diagram')}
            className={[
              'h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all',
              view === 'diagram'
                ? 'bg-slate-900 text-white'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100',
            ].join(' ')}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Diagram
          </button>
          <button
            onClick={() => setView('checklist')}
            className={[
              'h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all',
              view === 'checklist'
                ? 'bg-slate-900 text-white'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100',
            ].join(' ')}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            Shop List
          </button>
        </div>
      </div>

      {/* ── Anchor banner ────────────────────────────────────────────── */}
      {pinnedCount > 0 && view === 'diagram' && (
        <div className="mx-4 mt-3 px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50
                        flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <Anchor className="h-4 w-4 shrink-0 text-amber-500" />
            <span>
              <strong>{pinnedCount} piece{pinnedCount !== 1 ? 's' : ''} anchored</strong>
              {' '}— click Re-Plan to pack everything else around them
            </span>
          </div>
          <button
            onClick={handleReOptimize}
            disabled={reOptimizing}
            className="shrink-0 h-8 px-3 rounded-lg bg-amber-500 hover:bg-amber-600
                       text-white text-xs font-bold flex items-center gap-1.5
                       disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reOptimizing ? 'animate-spin' : ''}`} />
            {reOptimizing ? 'Planning…' : 'Re-Plan Cuts'}
          </button>
        </div>
      )}

      {/* ── Unplaced panel banner ─────────────────────────────────────── */}
      {activeSolution?.unplacedPanels.length > 0 && view === 'diagram' && (() => {
        const { suggestions, unfittable } = suggestFixes(activeSolution, stockSheets);
        return (
          <div className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 shrink-0 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-2.5 flex items-center gap-2 border-b border-red-100">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
              <span className="text-sm font-semibold text-red-800">
                {activeSolution.unplacedPanels.length} panel{activeSolution.unplacedPanels.length !== 1 ? 's' : ''}{' '}couldn&apos;t fit
              </span>
            </div>

            <div className="px-4 py-3 space-y-3">
              {/* Panels too large for any sheet */}
              {unfittable.length > 0 && (
                <div className="space-y-1">
                  {unfittable.map((p) => (
                    <p key={p.id} className="text-xs text-red-700">
                      <strong>{p.label || 'Unnamed panel'}</strong>{' '}
                      ({fmt(p.length)}{sfx} × {fmt(p.width)}{sfx}) is larger than all stock sheets — add a larger sheet type in the left panel.
                    </p>
                  ))}
                </div>
              )}

              {/* Fixable suggestions */}
              {suggestions.map(({ sheet, extraQty, entries }) => {
                const panelSummary = entries
                  .map(({ panel, unplacedCount }) =>
                    `${panel.label || 'Panel'} ×${unplacedCount}`
                  )
                  .join(', ');
                return (
                  <div key={sheet.id} className="flex items-start justify-between gap-3">
                    <div className="text-xs text-red-700 pt-0.5">
                      <span className="font-medium">{panelSummary}</span>
                      {' '}— needs approx.{' '}
                      <strong>{extraQty} more {sheet.label || `${fmt(sheet.length)}${sfx} × ${fmt(sheet.width)}${sfx}`} sheet{extraQty !== 1 ? 's' : ''}</strong>
                    </div>
                    <button
                      onClick={() => handleFix([{ sheet, extraQty }])}
                      disabled={fixing}
                      className="shrink-0 h-8 px-3 rounded-lg bg-red-500 hover:bg-red-600
                                 text-white text-xs font-bold flex items-center gap-1.5
                                 disabled:opacity-50 transition-colors"
                    >
                      <PlusCircle className={`h-3.5 w-3.5 ${fixing ? 'animate-spin' : ''}`} />
                      {fixing ? 'Planning…' : `Add ${extraQty} sheet${extraQty !== 1 ? 's' : ''} & Re-Plan`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Content ──────────────────────────────────────────────────── */}
      <ScrollArea className="flex-1">
        {view === 'checklist' && activeSolution ? (
          <CutChecklist solution={activeSolution} stockSheets={stockSheets} />
        ) : (
          <div className="p-6 space-y-8" data-export-target>
            {activeSolution && (
              <>
                {/* Summary stats */}
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Sheets</span>
                    <span className="text-lg font-bold text-slate-800">{activeSolution.totalSheets}</span>
                  </div>
                  <div className="w-px h-5 bg-slate-200" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Waste</span>
                    <span className={`text-lg font-bold ${
                      activeSolution.totalWaste < 15 ? 'text-emerald-600' :
                      activeSolution.totalWaste < 30 ? 'text-amber-600' : 'text-red-500'
                    }`}>
                      {activeSolution.totalWaste.toFixed(1)}%
                    </span>
                  </div>
                  {activeSolution.unplacedPanels.length > 0 && (
                    <>
                      <div className="w-px h-5 bg-slate-200" />
                      <span className="text-sm font-semibold text-red-500">
                        ⚠ {activeSolution.unplacedPanels.length} panel{activeSolution.unplacedPanels.length !== 1 ? 's' : ''}{' '}couldn&apos;t fit
                      </span>
                    </>
                  )}
                  {activeSolution.strategyName === 'Re-planned (anchored)' && (
                    <span className="ml-auto text-[11px] font-semibold text-amber-600 bg-amber-50
                                     border border-amber-200 rounded-full px-2.5 py-0.5">
                      ⚓ Anchored layout
                    </span>
                  )}
                </div>

                {/* Sheet canvases */}
                {activeSolution.sheets.map((sheetLayout, i) => {
                  const stockSheet = stockSheets.find(
                    (s) => s.id === sheetLayout.stockSheetId
                  );
                  return (
                    <SheetCanvas
                      key={`${sheetLayout.stockSheetId}-${sheetLayout.sheetIndex}`}
                      sheetLayout={sheetLayout}
                      stockSheet={stockSheet!}
                      sheetNumber={i + 1}
                      onExpand={() => setExpandedSheetIdx(i)}
                    />
                  );
                })}
              </>
            )}
          </div>
        )}
      </ScrollArea>

      {/* ── Lightbox modal ───────────────────────────────────────────── */}
      {expandedSheetIdx !== null && activeSolution && (() => {
        const totalSheets = activeSolution.sheets.length;
        const idx = Math.max(0, Math.min(expandedSheetIdx, totalSheets - 1));
        const sheetLayout = activeSolution.sheets[idx];
        const stockSheet = stockSheets.find((s) => s.id === sheetLayout.stockSheetId);
        if (!stockSheet) return null;
        const hasPrev = idx > 0;
        const hasNext = idx < totalSheets - 1;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-6"
            style={{ background: 'rgba(15,23,42,0.8)', backdropFilter: 'blur(6px)' }}
            onClick={() => setExpandedSheetIdx(null)}
          >
            {/* Prev arrow */}
            {hasPrev && (
              <button
                onClick={(e) => { e.stopPropagation(); setExpandedSheetIdx(idx - 1); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full
                           bg-white/90 hover:bg-white shadow-lg flex items-center justify-center
                           text-slate-700 transition-all"
                title="Previous sheet"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}

            {/* Next arrow */}
            {hasNext && (
              <button
                onClick={(e) => { e.stopPropagation(); setExpandedSheetIdx(idx + 1); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full
                           bg-white/90 hover:bg-white shadow-lg flex items-center justify-center
                           text-slate-700 transition-all"
                title="Next sheet"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}

            {/* Card */}
            <div
              className="relative bg-white rounded-2xl shadow-2xl overflow-auto p-6
                         max-w-[95vw] max-h-[92vh]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header row: sheet counter + close */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-slate-500">
                  Sheet {idx + 1}{totalSheets > 1 ? ` of ${totalSheets}` : ''}
                  {stockSheet.label && ` — ${stockSheet.label}`}
                </span>
                <button
                  onClick={() => setExpandedSheetIdx(null)}
                  className="h-8 w-8 rounded-full bg-slate-100 hover:bg-slate-200
                             flex items-center justify-center transition-colors"
                  title="Close (Esc)"
                >
                  <X className="h-4 w-4 text-slate-600" />
                </button>
              </div>
              <SheetCanvas
                sheetLayout={sheetLayout}
                stockSheet={stockSheet}
                sheetNumber={idx + 1}
                maxWidth={Math.min(Math.round(window.innerWidth * 0.88), 1400)}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
