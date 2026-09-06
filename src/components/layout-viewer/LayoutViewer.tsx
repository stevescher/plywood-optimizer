'use client';

import { useState, useEffect, useRef } from 'react';
import { useLayoutStore } from '@/store/useLayoutStore';
import { useDragStore } from '@/store/useDragStore';
import { SheetCanvas } from './SheetCanvas';
import { CutChecklist } from '@/components/cut-list/CutChecklist';
import { useProjectStore } from '@/store/useProjectStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { reOptimizeAroundPinned } from '@/lib/optimizer/reoptimize';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LayoutGrid, ClipboardList, Anchor, RefreshCw, ZoomIn, ZoomOut, AlertTriangle, PlusCircle, Shuffle, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useViewStore, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from '@/store/useViewStore';
import { useOptimizer } from '@/hooks/useOptimizer';
import { Panel, StockSheet, Solution } from '@/lib/optimizer/types';
import { formatDisplay, unitSuffix } from '@/lib/fractions';
import { computeCost, formatCurrency } from '@/lib/cost';

// ── Fix suggestion helpers ────────────────────────────────────────────────────

export interface SheetSuggestion {
  sheet: StockSheet;
  extraQty: number;
  entries: Array<{ panel: Panel; unplacedCount: number }>;
}

export function suggestFixes(
  solution: Solution,
  stockSheets: StockSheet[]
): { suggestions: SheetSuggestion[]; unfittable: Panel[] } {
  const groups = new Map<string, { sheet: StockSheet; entries: Array<{ panel: Panel; unplacedCount: number }> }>();
  const unfittable: Panel[] = [];

  for (const panel of solution.unplacedPanels) {
    // panel.quantity now equals the number of unplaced instances (set by solver)
    const unplacedCount = panel.quantity;
    if (unplacedCount <= 0) continue;

    const fitting = stockSheets
      .filter((s) => s.length > 0 && s.width > 0)
      .filter((s) => {
        const l = s.length - s.trimLeft - s.trimRight;
        const w = s.width - s.trimTop - s.trimBottom;
        // The rotated orientation is only reachable if rotation is allowed —
        // the optimizer keeps a lockRotation panel in its given orientation, so
        // offering an add-sheets fix for a locked panel that only fits rotated
        // would leave it unplaced after the re-plan. (OPUS-405)
        return (
          (panel.length <= l && panel.width <= w) ||
          (!panel.lockRotation && panel.width <= l && panel.length <= w)
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
  const { stockSheets, panels, kerf, updateStockSheet, units } = useProjectStore();
  const { pinnedPieces, clearPins } = useDragStore();
  const { zoom, setZoom } = useViewStore();
  const optimize = useOptimizer();
  const fmt = (v: number) => formatDisplay(v, units);
  const sfx = unitSuffix(units);
  const pinnedCount = pinnedPieces.size;
  const [view, setView] = useState<'diagram' | 'checklist'>('diagram');
  const [reOptimizing, setReOptimizing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [expandedSheetIdx, setExpandedSheetIdx] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Lock background scroll + keyboard nav while lightbox is open.
  // Deliberately depends only on `expandedSheetIdx` (open/close/sheet-switch),
  // not `solutions` — a keyboard nudge or rotate inside the lightbox updates
  // `solutions`, and re-running this effect on every such edit would restore
  // focus to the dialog container (see the focus-management block below),
  // yanking focus off the piece the user is actively moving after a single
  // arrow-key press. Live values needed inside the handler are read fresh from
  // the store instead of closing over stale props.
  useEffect(() => {
    if (expandedSheetIdx === null) { document.body.style.overflow = ''; return; }
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedSheetIdx(null);
      const total = useLayoutStore.getState().solutions[useLayoutStore.getState().activeSolutionIndex]?.sheets.length ?? 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
        setExpandedSheetIdx((i) => (i !== null && i < total - 1 ? i + 1 : i));
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
        setExpandedSheetIdx((i) => (i !== null && i > 0 ? i - 1 : i));
      // Trap Tab focus inside the dialog.
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement;
        const inList = Array.prototype.includes.call(focusable, active);
        // Focus starts on the dialog container itself (outside the list), so an
        // immediate Shift+Tab would otherwise escape the modal. Treat any focus
        // outside the collected elements as a wrap to the correct end.
        if (e.shiftKey && (active === first || !inList)) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && (active === last || !inList)) {
          e.preventDefault(); first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    // Move focus into the dialog and restore it to the trigger on close.
    lastFocusedRef.current = document.activeElement as HTMLElement;
    requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      lastFocusedRef.current?.focus?.();
    };
  }, [expandedSheetIdx]);

  if (solutions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
          <LayoutGrid className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="text-center">
          <p className="text-base font-semibold text-muted-foreground">No layouts yet</p>
          <p className="text-sm text-muted-foreground mt-1">Add stock sheets and panels, then click Plan Cuts</p>
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
        kerf,
        panels
      );
      // Inject re-optimized result as a new top solution
      const updated = [reOptimized, ...solutions.filter((s) => s.id !== activeSolution.id)];
      setSolutions(updated);
      setActive(0);
      // The repack rebuilds placement arrays in a new order, so the old
      // index-keyed pins no longer identify the same pieces. Clear them now
      // that they've been consumed, so the "anchored" banner and any later
      // re-plan don't act on stale keys. (OPUS-402)
      clearPins();
      setReOptimizing(false);
    }, 50);
  };

  const handleFix = (fixes: Array<{ sheet: StockSheet; extraQty: number }>) => {
    setFixing(true);
    for (const { sheet, extraQty } of fixes) {
      updateStockSheet(sheet.id, { quantity: sheet.quantity + extraQty });
    }
    // optimize reads fresh store state, so schedule after state settles
    setTimeout(async () => {
      await optimize();
      setFixing(false);
    }, 50);
  };

  return (
    <div className="flex flex-col h-full">

      {/* ── Top bar: layout selector + view toggle ───────────────────── */}
      <div className="px-4 py-2.5 border-b border-border bg-card shrink-0 flex items-center justify-between gap-4">
        {/* Layout pills + More Layouts */}
        <div className="flex items-center gap-1.5">
          {visibleSolutions.length > 1 && (
            <>
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mr-1">
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
                      : 'bg-muted text-muted-foreground hover:bg-muted',
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
                         bg-muted text-muted-foreground hover:bg-accent hover:text-primary transition-all"
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
              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground
                         hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="text-[11px] font-semibold text-muted-foreground w-9 text-center tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(zoom + ZOOM_STEP)}
              disabled={zoom >= ZOOM_MAX}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground
                         hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
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
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            ].join(' ')}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            Shop List
          </button>
        </div>
      </div>

      {/* Screen-reader-only status announcements for re-optimize / add-sheets-
          and-replan actions — the buttons' own label changes aren't reliably
          announced without a dedicated live region. */}
      <div role="status" aria-live="polite" className="sr-only">
        {reOptimizing ? 'Re-planning cuts around anchored pieces…' : ''}
        {fixing ? 'Adding sheets and re-planning cuts…' : ''}
      </div>

      {/* ── Anchor banner ────────────────────────────────────────────── */}
      {pinnedCount > 0 && view === 'diagram' && (
        <div className="mx-4 mt-3 px-4 py-2.5 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40
                        flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
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
        const totalUnplaced = activeSolution.unplacedPanels.reduce((s, p) => s + p.quantity, 0);
        return (
          <div
            role="status"
            aria-live="polite"
            className="mx-4 mt-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 shrink-0 overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 py-2.5 flex items-center gap-2 border-b border-red-100 dark:border-red-900">
              <AlertTriangle className="h-4 w-4 text-red-500 dark:text-red-400 shrink-0" />
              <span className="text-sm font-semibold text-red-800 dark:text-red-400">
                {totalUnplaced} panel{totalUnplaced !== 1 ? 's' : ''}{' '}couldn&apos;t fit
              </span>
            </div>

            <div className="px-4 py-3 space-y-3">
              {/* Panels too large for any sheet */}
              {unfittable.length > 0 && (
                <div className="space-y-1">
                  {unfittable.map((p) => (
                    <p key={p.id} className="text-xs text-red-700 dark:text-red-400">
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
                    <div className="text-xs text-red-700 dark:text-red-400 pt-0.5">
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
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sheets</span>
                    <span className="text-lg font-bold text-foreground">{activeSolution.totalSheets}</span>
                  </div>
                  <div className="w-px h-5 bg-border" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Waste</span>
                    <span className={`text-lg font-bold ${
                      activeSolution.totalWaste < 15 ? 'text-emerald-600 dark:text-emerald-400' :
                      activeSolution.totalWaste < 30 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500 dark:text-red-400'
                    }`}>
                      {activeSolution.totalWaste.toFixed(1)}%
                    </span>
                  </div>
                  {activeSolution.unplacedPanels.length > 0 && (() => {
                    const n = activeSolution.unplacedPanels.reduce((s, p) => s + p.quantity, 0);
                    return (
                      <>
                        <div className="w-px h-5 bg-border" />
                        <span className="text-sm font-semibold text-red-500 dark:text-red-400">
                          ⚠ {n} panel{n !== 1 ? 's' : ''}{' '}couldn&apos;t fit
                        </span>
                      </>
                    );
                  })()}
                  {activeSolution.strategyName === 'Re-planned (anchored)' && (
                    <span className="ml-auto text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40
                                     border border-amber-200 dark:border-amber-900 rounded-full px-2.5 py-0.5">
                      ⚓ Anchored layout
                    </span>
                  )}
                </div>

                {/* Material cost breakdown — only when at least one used sheet is priced */}
                {(() => {
                  const cost = computeCost(activeSolution, stockSheets);
                  if (!cost.hasPricing) return null;
                  return (
                    <div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
                      <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Material Cost
                        </span>
                        <span className="text-base font-bold text-foreground tabular-nums">
                          {formatCurrency(cost.grandTotal)}
                        </span>
                      </div>
                      <div className="divide-y divide-border">
                        {cost.lines.map((line) => (
                          <div
                            key={line.stockSheetId}
                            className="px-4 py-1.5 flex items-center justify-between text-sm"
                          >
                            <span className="text-muted-foreground">
                              {line.label}
                              <span className="text-muted-foreground">
                                {' '}· {line.sheetsUsed} sheet{line.sheetsUsed !== 1 ? 's' : ''}
                                {line.pricePerSheet !== undefined
                                  ? ` × ${formatCurrency(line.pricePerSheet)}`
                                  : ''}
                              </span>
                            </span>
                            <span className="font-semibold text-foreground tabular-nums">
                              {line.subtotal !== undefined ? formatCurrency(line.subtotal) : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                      {cost.hasUnpriced && (
                        <div className="px-4 py-1.5 text-[11px] text-muted-foreground border-t border-border">
                          Some sheets are unpriced — total is a partial estimate.
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Sheet canvases */}
                {activeSolution.sheets.map((sheetLayout, i) => {
                  const stockSheet = stockSheets.find(
                    (s) => s.id === sheetLayout.stockSheetId
                  );
                  if (!stockSheet) return null;
                  return (
                    <SheetCanvas
                      key={`${sheetLayout.stockSheetId}-${sheetLayout.sheetIndex}`}
                      sheetLayout={sheetLayout}
                      stockSheet={stockSheet}
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
                           bg-card/90 hover:bg-card shadow-lg flex items-center justify-center
                           text-foreground transition-all"
                title="Previous sheet" aria-label="Previous sheet"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}

            {/* Next arrow */}
            {hasNext && (
              <button
                onClick={(e) => { e.stopPropagation(); setExpandedSheetIdx(idx + 1); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 z-20 h-10 w-10 rounded-full
                           bg-card/90 hover:bg-card shadow-lg flex items-center justify-center
                           text-foreground transition-all"
                title="Next sheet" aria-label="Next sheet"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}

            {/* Card */}
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={`Sheet ${idx + 1}${totalSheets > 1 ? ` of ${totalSheets}` : ''}${stockSheet.label ? ` — ${stockSheet.label}` : ''}`}
              tabIndex={-1}
              className="relative bg-card rounded-2xl shadow-2xl overflow-auto p-6
                         max-w-[95vw] max-h-[92vh] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header row: sheet counter + close */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-muted-foreground">
                  Sheet {idx + 1}{totalSheets > 1 ? ` of ${totalSheets}` : ''}
                  {stockSheet.label && ` — ${stockSheet.label}`}
                </span>
                <button
                  onClick={() => setExpandedSheetIdx(null)}
                  className="h-8 w-8 rounded-full bg-muted hover:bg-muted
                             flex items-center justify-center transition-colors"
                  title="Close (Esc)" aria-label="Close"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
              <SheetCanvas
                sheetLayout={sheetLayout}
                stockSheet={stockSheet}
                sheetNumber={idx + 1}
                maxWidth={Math.min(Math.round((typeof window !== 'undefined' ? window.innerWidth : 1400) * 0.88), 1400)}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
