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
import { useOptimizer } from '@/hooks/useOptimizer';
import { Button } from '@/components/ui/button';
import { Scissors, Undo2, Redo2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function Home() {
  useAutoSave();

  // Undo/redo keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const entry = useHistoryStore.getState().undo();
        if (entry) {
          useLayoutStore.getState().setSolutions(entry.solutions);
          useLayoutStore.getState().setActive(entry.activeSolutionIndex);
        }
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const entry = useHistoryStore.getState().redo();
        if (entry) {
          useLayoutStore.getState().setSolutions(entry.solutions);
          useLayoutStore.getState().setActive(entry.activeSolutionIndex);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { stockSheets, panels } = useProjectStore();
  const { isOptimizing, solutions } = useLayoutStore();
  const optimize = useOptimizer();

  const canOptimize =
    stockSheets.some((s) => s.length > 0 && s.width > 0) &&
    panels.some((p) => p.length > 0 && p.width > 0);

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="h-12 border-b border-slate-200 px-4 flex items-center justify-between bg-white shrink-0 z-10"
        style={{ boxShadow: '0 1px 0 rgba(0,0,0,0.06)' }}>
        <div className="flex items-center gap-3">
          {/* Logo mark */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)' }}>
              <Scissors className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-extrabold text-slate-900 text-sm tracking-tight">
              Cut <span className="font-medium text-slate-400">Planner</span>
            </span>
          </div>
          <div className="w-px h-4 bg-slate-200" />
          <ProjectMenu />
        </div>

        <div className="flex items-center gap-2">
          {solutions.length > 0 && (
            <>
              <LayoutControls />
              <div className="w-px h-5 bg-slate-200" />
              <ExportMenu />
            </>
          )}
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <aside className="w-[360px] shrink-0 flex flex-col border-r border-slate-200"
          style={{ background: 'var(--sidebar)' }}>

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-5">

              {/* Unit system — must be set before entering any measurements */}
              <UnitToggle />

              {/* Divider */}
              <div className="border-t border-slate-200/70" />

              {/* Stock Sheets */}
              <section>
                <div className="section-header mb-3">Stock Sheets</div>
                <StockSheetForm />
              </section>

              {/* Divider */}
              <div className="border-t border-slate-200/70" />

              {/* Panels */}
              <section>
                <div className="section-header mb-3">Required Panels</div>
                <PanelForm />
              </section>

              {/* Divider */}
              <div className="border-t border-slate-200/70" />

              {/* Settings */}
              <section>
                <div className="section-header mb-3">Blade Settings</div>
                <KerfSetting />
              </section>

            </div>
          </ScrollArea>

          {/* ── Optimize CTA ───────────────────────────────────────────── */}
          <div className="p-4 border-t border-slate-200 bg-white">
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
        <main className="flex-1 min-w-0 bg-slate-50/50">
          <LayoutViewer />
        </main>

      </div>
    </div>
  );
}
