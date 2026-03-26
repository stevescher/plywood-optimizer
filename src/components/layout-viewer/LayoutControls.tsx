'use client';

import { useViewStore, ViewMode } from '@/store/useViewStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { useDragStore } from '@/store/useDragStore';
import { Tag, ListOrdered, Unlock, Palette, Ruler } from 'lucide-react';

function ToggleBtn({
  active, onClick, title, icon: Icon, label,
}: {
  active: boolean; onClick: () => void; title: string;
  icon: React.ElementType; label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all',
        active ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
      ].join(' ')}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

const VIEW_MODES: { value: ViewMode; label: string; title: string }[] = [
  { value: 'color',   label: 'Color',   title: 'Color-coded pieces' },
  { value: 'mono',    label: 'Mono',    title: 'Grayscale, no color' },
  { value: 'outline', label: 'Outline', title: 'Black outlines only, no fill' },
];

export function LayoutControls() {
  const { showLabels, viewMode, showCutSequence, showEdgeDims, toggleLabels, setViewMode, toggleCutSequence, toggleEdgeDims } = useViewStore();
  const { solutions, revealedCount } = useLayoutStore();
  const { pinnedPieces, clearPins } = useDragStore();
  const pinnedCount = pinnedPieces.size;

  return (
    <div className="flex items-center gap-1.5">
      <ToggleBtn active={showLabels} onClick={toggleLabels} title="Toggle piece labels" icon={Tag} label="Labels" />
      <ToggleBtn active={showEdgeDims} onClick={toggleEdgeDims} title="Show dimensions on each piece edge" icon={Ruler} label="Dimensions" />
      <ToggleBtn active={showCutSequence} onClick={toggleCutSequence} title="Toggle cut sequence numbers" icon={ListOrdered} label="Cuts" />

      {/* View mode segmented control */}
      <div className="flex items-center rounded-lg bg-slate-100 p-0.5 gap-px" title="View mode">
        <Palette className="h-3.5 w-3.5 text-slate-400 mx-1.5" />
        {VIEW_MODES.map(({ value, label, title }) => (
          <button
            key={value}
            onClick={() => setViewMode(value)}
            title={title}
            className={[
              'px-2.5 h-7 rounded-md text-xs font-semibold capitalize transition-all',
              viewMode === value
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {pinnedCount > 0 && (
        <>
          <div className="w-px h-4 bg-slate-200" />
          <button
            onClick={clearPins}
            title="Release all anchored pieces"
            className="h-8 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5
                       bg-amber-100 text-amber-700 hover:bg-amber-200 transition-all"
          >
            <Unlock className="h-3.5 w-3.5" />
            Release {pinnedCount}
          </button>
        </>
      )}

    </div>
  );
}
