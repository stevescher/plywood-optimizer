'use client';

import { Solution, StockSheet } from '@/lib/optimizer/types';
import { formatDisplay, unitSuffix } from '@/lib/fractions';
import { useProjectStore } from '@/store/useProjectStore';
import { useChecklistStore } from '@/store/useChecklistStore';
import { PrintCutSheet } from './PrintCutSheet';

interface CutChecklistProps {
  solution: Solution;
  stockSheets: StockSheet[];
}

export function CutChecklist({ solution, stockSheets }: CutChecklistProps) {
  const units = useProjectStore((s) => s.units);
  const checked = useChecklistStore((s) => s.checked);
  const toggle = useChecklistStore((s) => s.toggle);
  const suffix = unitSuffix(units);
  return (
    <div className="p-6 space-y-6 print:p-0">
      {/* On-screen interactive checklist. Hidden when printing — the print path
          renders PrintCutSheet (the ordered rip/crosscut cut sequence) instead. */}
      <div className="print:hidden space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Shop Checklist</h3>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 text-sm bg-foreground text-background rounded-md hover:opacity-90"
          >
            Print Cut Sheet
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Take this list to the shop and check off each piece as you cut it. Organized by sheet so you can work through one sheet at a time. Printing produces an ordered rip/crosscut cut sequence per sheet.
        </p>
      </div>

      {solution.sheets.map((sheet, si) => {
        const stockSheet = stockSheets.find((s) => s.id === sheet.stockSheetId);
        return (
          <div key={`${sheet.stockSheetId}-${sheet.sheetIndex}`} className="space-y-2">
            <h4 className="text-sm font-semibold border-b pb-1">
              Sheet {si + 1}
              {stockSheet?.label && ` — ${stockSheet.label}`}
              <span className="text-muted-foreground font-normal ml-2">
                ({formatDisplay(stockSheet?.length || 0, units)}{suffix} x{' '}
                {formatDisplay(stockSheet?.width || 0, units)}{suffix})
              </span>
            </h4>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground text-xs">
                  <th scope="col" className="w-8 pb-1"><span className="sr-only">Cut</span></th>
                  <th scope="col" className="pb-1">Panel</th>
                  <th scope="col" className="pb-1">Length</th>
                  <th scope="col" className="pb-1">Width</th>
                  <th scope="col" className="pb-1">Rotated</th>
                </tr>
              </thead>
              <tbody>
                {sheet.placements.map((p, pi) => {
                  // Include solution.id so checks don't bleed across layout
                  // alternatives that reuse the same sheet id / index / position.
                  const key = `${solution.id}:${sheet.stockSheetId}-${sheet.sheetIndex}:${pi}`;
                  const isChecked = !!checked[key];
                  const label = `${p.label} ${formatDisplay(p.width, units)}${suffix} by ${formatDisplay(p.height, units)}${suffix}${p.rotated ? ', rotated' : ''}`;
                  return (
                    <tr key={pi} className="border-b border-muted/50">
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggle(key)}
                          aria-label={`Mark ${label} as cut`}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </td>
                      <td className={`py-1.5 font-medium ${isChecked ? 'line-through text-muted-foreground' : ''}`}>
                        {p.label}
                      </td>
                      <td className="py-1.5">
                        {formatDisplay(p.width, units)}{suffix}
                      </td>
                      <td className="py-1.5">
                        {formatDisplay(p.height, units)}{suffix}
                      </td>
                      <td className="py-1.5 text-muted-foreground">
                        {p.rotated ? 'Yes' : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {solution.unplacedPanels.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-destructive border-b pb-1">
            Unable to Fit
          </h4>
          <ul className="text-sm space-y-1">
            {solution.unplacedPanels.map((p) => (
              <li key={p.id} className="text-destructive">
                {p.label} ({formatDisplay(p.length, units)}{suffix} x{' '}
                {formatDisplay(p.width, units)}{suffix}) x{p.quantity}
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>

      {/* Print-only artifact: ordered cut sequence + finished pieces per sheet. */}
      <PrintCutSheet solution={solution} stockSheets={stockSheets} />
    </div>
  );
}
