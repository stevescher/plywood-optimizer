'use client';

import { useEffect } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';
import { StockSheetForm } from '@/components/forms/StockSheetForm';
import { PanelForm } from '@/components/forms/PanelForm';
import { KerfSetting } from '@/components/forms/KerfSetting';
import { UnitToggle } from '@/components/forms/UnitToggle';
import { ProjectMenu } from '@/components/project/ProjectMenu';
import { LayoutViewer } from '@/components/layout-viewer/LayoutViewer';
import { LayoutControls } from '@/components/layout-viewer/LayoutControls';
import { ExportMenu } from '@/components/export/ExportMenu';
import { useProjectStore } from '@/store/useProjectStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { useHistoryStore } from '@/store/useHistoryStore';
import { useDragStore } from '@/store/useDragStore';
import { useSaveStatusStore } from '@/store/useSaveStatusStore';
import { useOptimizer } from '@/hooks/useOptimizer';
import { Scissors, Undo2, Redo2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AppFooter } from '@/components/AppFooter';
import type { HistoryEntry } from '@/store/useHistoryStore';

/** Snapshot of the live layout, handed to undo()/redo() so the state being
 *  left behind can be moved onto the opposite history stack. */
function currentEntry(): HistoryEntry {
  const layout = useLayoutStore.getState();
  return {
    solutions: layout.solutions,
    activeSolutionIndex: layout.activeSolutionIndex,
  };
}

/** Apply a restored history entry to the live layout (no-op if null). */
function applyHistoryEntry(entry: HistoryEntry | null) {
  if (!entry) return;
  const layout = useLayoutStore.getState();
  layout.setSolutions(entry.solutions);
  layout.setActive(entry.activeSolutionIndex);
  // The restored layout has a different placement order than the live one, so
  // index-keyed pins would now point at the wrong pieces. Clear them. (OPUS-402)
  useDragStore.getState().clearPins();
}

export default function Home() {
  useAutoSave();

  // Undo/redo keyboard shortcuts
  useEffect(() => {
    const isEditableTarget = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't hijack the browser's native text undo while editing a field.
      if (isEditableTarget(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        applyHistoryEntry(useHistoryStore.getState().undo(currentEntry()));
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        applyHistoryEntry(useHistoryStore.getState().redo(currentEntry()));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { stockSheets, panels } = useProjectStore();
  const { isOptimizing, solutions } = useLayoutStore();
  const saveFailed = useSaveStatusStore((s) => s.saveFailed);
  const optimize = useOptimizer();
  const canUndo = useHistoryStore((s) => s.past.length > 0);
  const canRedo = useHistoryStore((s) => s.future.length > 0);

  const handleUndo = () => applyHistoryEntry(useHistoryStore.getState().undo(currentEntry()));
  const handleRedo = () => applyHistoryEntry(useHistoryStore.getState().redo(currentEntry()));

  const canOptimize =
    stockSheets.some((s) => s.length > 0 && s.width > 0) &&
    panels.some((p) => p.length > 0 && p.width > 0);

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Skip link — visually hidden until focused, lets keyboard users jump
          past the header/sidebar straight to the layout viewer. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50
                   focus:px-3 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-primary-foreground
                   focus:text-sm focus:font-semibold"
      >
        Skip to layout viewer
      </a>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="h-12 border-b border-border px-4 flex items-center justify-between bg-card shrink-0 z-10 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
        <div className="flex items-center gap-3">
          {/* Logo mark */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)' }}>
              <Scissors className="h-3.5 w-3.5 text-white" />
            </div>
            <h1 className="font-extrabold text-foreground text-sm tracking-tight">
              Cut <span className="font-medium text-muted-foreground">Planner</span>
            </h1>
          </div>
          <div className="w-px h-4 bg-border" />
          <ProjectMenu />
          {solutions.length > 0 && (
            <>
              <div className="w-px h-4 bg-border" />
              <ExportMenu />
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {solutions.length > 0 && (
            <>
              <button
                onClick={handleUndo}
                disabled={!canUndo}
                title="Undo (⌘Z)"
                aria-label="Undo"
                className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground
                           hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleRedo}
                disabled={!canRedo}
                title="Redo (⌘⇧Z)"
                aria-label="Redo"
                className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground
                           hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </button>
              <div className="w-px h-4 bg-border" />
              <LayoutControls />
            </>
          )}
          <div className="w-px h-4 bg-border" />
          <ThemeToggle />
        </div>
      </header>

      {/* Autosave failure banner — storage full or unavailable */}
      {saveFailed && (
        <div
          role="alert"
          className="shrink-0 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 text-xs px-4 py-2 text-center"
        >
          Autosave failed — your browser storage may be full or disabled. Export your project
          to a file to avoid losing work.
        </div>
      )}

      {/* Screen-reader-only status announcements for the Plan Cuts action —
          the button's own label change ("Plan Cuts" → "Planning…") isn't
          reliably announced without a dedicated live region. */}
      <div role="status" aria-live="polite" className="sr-only">
        {isOptimizing
          ? 'Planning cuts…'
          : solutions.length > 0
            ? `${solutions.length} layout${solutions.length !== 1 ? 's' : ''} ready`
            : ''}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      {/* Stacks vertically on narrow screens (shop tablets/phones) so the
          fixed-width sidebar never crushes the viewer; side-by-side from md up. */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0">

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <aside className="w-full md:w-[360px] shrink-0 flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-border max-h-[55%] md:max-h-none"
          style={{ background: 'var(--sidebar)' }}>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 space-y-5">

              {/* Unit system — must be set before entering any measurements */}
              <UnitToggle />

              {/* Divider */}
              <div className="border-t border-border/70" />

              {/* Stock Sheets */}
              <section>
                <h2 className="section-header mb-3">Stock Sheets</h2>
                <StockSheetForm />
              </section>

              {/* Divider */}
              <div className="border-t border-border/70" />

              {/* Panels */}
              <section>
                <h2 className="section-header mb-3">Required Panels</h2>
                <PanelForm />
              </section>

              {/* Divider */}
              <div className="border-t border-border/70" />

              {/* Settings */}
              <section>
                <h2 className="section-header mb-3">Blade Settings</h2>
                <KerfSetting />
              </section>

            </div>
          </ScrollArea>

          {/* ── Optimize CTA ───────────────────────────────────────────── */}
          <div className="p-4 border-t border-border bg-card">
            <button
              className="btn-optimize w-full h-11 rounded-xl text-sm flex items-center justify-center gap-2"
              onClick={optimize}
              disabled={!canOptimize || isOptimizing}
            >
              <Scissors className="h-4 w-4" />
              {isOptimizing ? 'Planning…' : 'Plan Cuts'}
            </button>
          </div>
        </aside>

        {/* ── Main viewer ──────────────────────────────────────────────── */}
        <main id="main-content" tabIndex={-1} className="flex-1 min-w-0 bg-muted/30 focus:outline-none">
          <LayoutViewer />
        </main>

      </div>

      <AppFooter />
    </div>
  );
}
