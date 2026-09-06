'use client';

import { useState } from 'react';
import { useProjectStore } from '@/store/useProjectStore';
import { NumberInput } from './NumberInput';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Lock, Unlock, Upload } from 'lucide-react';
import { getColor } from '@/lib/colors';
import { PanelImport } from './PanelImport';

/** Matches the import validator's ceiling (src/lib/project-io.ts). */
const MAX_DIMENSION = 10_000;

export function PanelForm() {
  const { panels, addPanel, updatePanel, removePanel, units } = useProjectStore();
  const [showImport, setShowImport] = useState(false);

  return (
    <div className="space-y-1.5">
      {/* Column headers (align with the dimension row below the label) */}
      <div className="grid grid-cols-[minmax(0,1fr)_64px_64px_40px_24px_24px] gap-2 px-2 pb-0.5">
        <span className="field-label">Label</span>
        <span className="field-label">Length</span>
        <span className="field-label">Width</span>
        <span className="field-label">Qty</span>
        <span />
        <span />
      </div>

      {/* Panel rows */}
      <div className="space-y-1.5">
        {panels.map((panel, idx) => (
          <div
            key={panel.id}
            className="bg-card rounded-lg border border-border px-2 py-1.5
                       hover:border-primary transition-colors"
          >
            {/* Label — full width so long names aren't clipped */}
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-sm shrink-0"
                style={{ backgroundColor: getColor(idx) }}
              />
              <Input
                value={panel.label}
                onChange={(e) => updatePanel(panel.id, { label: e.target.value })}
                placeholder={`Panel ${idx + 1}`}
                className="h-7 text-sm border-0 p-0 shadow-none focus-visible:ring-0 bg-transparent"
              />
            </div>

            {/* Dimensions + controls row */}
            <div className="grid grid-cols-[minmax(0,1fr)_64px_64px_40px_24px_24px] gap-2 items-center">
            <span />
            <NumberInput
              value={panel.length}
              onChange={(v) => updatePanel(panel.id, { length: v })}
              placeholder={units === 'metric' ? '600' : '24'}
              units={units}
              max={MAX_DIMENSION}
              aria-label={`${panel.label || `Panel ${idx + 1}`} length`}
              className="h-8 text-sm"
            />
            <NumberInput
              value={panel.width}
              onChange={(v) => updatePanel(panel.id, { width: v })}
              placeholder={units === 'metric' ? '300' : '12'}
              units={units}
              max={MAX_DIMENSION}
              aria-label={`${panel.label || `Panel ${idx + 1}`} width`}
              className="h-8 text-sm"
            />
            <NumberInput
              value={panel.quantity}
              onChange={(v) => updatePanel(panel.id, { quantity: Math.min(100, Math.max(1, Math.round(v))) })}
              placeholder="1"
              min={1}
              max={100}
              aria-label={`${panel.label || `Panel ${idx + 1}`} quantity`}
              className="h-8 text-sm"
            />
            {/* Lock rotation toggle */}
            <button
              onClick={() => updatePanel(panel.id, { lockRotation: !panel.lockRotation })}
              title={panel.lockRotation ? 'Rotation locked — click to allow' : 'Click to lock grain direction'}
              aria-label={
                panel.lockRotation
                  ? `Rotation locked for ${panel.label || `Panel ${idx + 1}`} — click to allow`
                  : `Lock grain direction for ${panel.label || `Panel ${idx + 1}`}`
              }
              aria-pressed={panel.lockRotation}
              className={`h-6 w-6 rounded flex items-center justify-center transition-colors
                ${panel.lockRotation
                  ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
            >
              {panel.lockRotation
                ? <Lock className="h-3 w-3" />
                : <Unlock className="h-3 w-3" />}
            </button>
            <button
              onClick={() => removePanel(panel.id)}
              disabled={panels.length <= 1}
              aria-label={`Remove ${panel.label || `Panel ${idx + 1}`}`}
              className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground
                         hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-30
                         transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
            </div>
          </div>
        ))}
      </div>

      {/* Import panel (inline) */}
      {showImport && (
        <div className="rounded-xl border border-border bg-muted/30 p-3 mt-1">
          <PanelImport onClose={() => setShowImport(false)} />
        </div>
      )}

      {/* Add Panel + Import CSV buttons */}
      {!showImport && (
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => addPanel()}
            className="flex-1 h-9 rounded-xl border-2 border-dashed border-border text-xs font-semibold text-muted-foreground
                       hover:border-primary hover:text-primary hover:bg-accent
                       transition-all flex items-center justify-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Panel
          </button>
          <button
            onClick={() => setShowImport(true)}
            title="Import panels from CSV"
            className="h-9 px-3 rounded-xl border-2 border-dashed border-border text-xs font-semibold text-muted-foreground
                       hover:border-primary hover:text-primary hover:bg-accent
                       transition-all flex items-center justify-center gap-1.5"
          >
            <Upload className="h-3.5 w-3.5" />
            CSV
          </button>
        </div>
      )}
    </div>
  );
}
