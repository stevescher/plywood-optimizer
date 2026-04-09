'use client';

import { Solution, StockSheet } from '@/lib/optimizer/types';
import { formatDisplay, unitSuffix } from '@/lib/fractions';
import { useProjectStore } from '@/store/useProjectStore';

interface CutChecklistProps {
  solution: Solution;
  stockSheets: StockSheet[];
}

export function CutChecklist({ solution, stockSheets }: CutChecklistProps) {
  const units = useProjectStore((s) => s.units);
  const suffix = unitSuffix(units);
  return (
    <div className="p-6 space-y-6 print:p-0">
      <div className="print:hidden space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Shop Checklist</h3>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 text-sm bg-foreground text-background rounded-md hover:opacity-90"
          >
            Print
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          Take this list to the shop and check off each piece as you cut it. Organized by sheet so you can work through one sheet at a time.
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
                  <th className="w-8 pb-1"></th>
                  <th className="pb-1">Panel</th>
                  <th className="pb-1">Length</th>
                  <th className="pb-1">Width</th>
                  <th className="pb-1">Rotated</th>
                </tr>
              </thead>
              <tbody>
                {sheet.placements.map((p, pi) => (
                  <tr key={pi} className="border-b border-muted/50">
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </td>
                    <td className="py-1.5 font-medium">{p.label}</td>
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
                ))}
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
  );
}
