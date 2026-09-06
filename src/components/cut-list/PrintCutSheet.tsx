'use client';

import { Solution, StockSheet } from '@/lib/optimizer/types';
import { formatDisplay, unitSuffix } from '@/lib/fractions';
import { describeSheetCuts } from '@/lib/cut-instructions';
import { useProjectStore } from '@/store/useProjectStore';
import { useChecklistStore } from '@/store/useChecklistStore';

interface PrintCutSheetProps {
  solution: Solution;
  stockSheets: StockSheet[];
}

/**
 * Print-optimized, follow-at-the-saw cut sheet (OPUS-394).
 *
 * Per sheet it renders, in physical cutting order:
 *   1. The numbered cut sequence — square-the-stock trim cuts first, then the
 *      rip/crosscut steps with their measurement and orientation.
 *   2. The finished pieces, each with a checklist checkbox.
 *
 * High-contrast black-on-white with a hard page break per sheet, so a shop can
 * print one page per board and work straight down it. On screen the component is
 * hidden (`hidden print:block`) — the interactive checklist covers on-screen use;
 * this is the paper artifact.
 */
export function PrintCutSheet({ solution, stockSheets }: PrintCutSheetProps) {
  const units = useProjectStore((s) => s.units);
  const checked = useChecklistStore((s) => s.checked);
  const suffix = unitSuffix(units);
  const fmt = (v: number) => formatDisplay(v, units);

  return (
    <div className="hidden print:block cut-sheet-print text-black">
      {solution.sheets.map((sheet, si) => {
        const stockSheet = stockSheets.find((s) => s.id === sheet.stockSheetId);
        const sheetLength = stockSheet?.length ?? 0;
        const sheetWidth = stockSheet?.width ?? 0;
        const instructions = describeSheetCuts(sheet, units, sheetLength, sheetWidth);

        return (
          <section
            key={`${sheet.stockSheetId}-${sheet.sheetIndex}`}
            className="cut-sheet-page"
          >
            {/* ── Sheet header ─────────────────────────────────────────── */}
            <header className="border-b-2 border-black pb-1 mb-3">
              <h2 className="text-lg font-bold">
                Sheet {si + 1}
                {stockSheet?.label ? ` — ${stockSheet.label}` : ''}
              </h2>
              <p className="text-sm">
                {fmt(sheetLength)}{suffix} × {fmt(sheetWidth)}{suffix}
                {'  ·  '}
                {sheet.placements.length} piece{sheet.placements.length !== 1 ? 's' : ''}
                {'  ·  '}
                {sheet.wastePercent.toFixed(1)}% waste
              </p>
            </header>

            {sheet.cutSequenceApproximate && (
              <p className="text-sm font-semibold border border-black px-2 py-1 mb-3">
                ⚠ Approximate cut sequence — this layout is not fully guillotine-cuttable.
                Some cut lines may pass through a piece; verify measurements before cutting.
              </p>
            )}

            {/* ── Cut sequence ─────────────────────────────────────────── */}
            <h3 className="text-sm font-bold uppercase tracking-wide mb-1">
              Cut Sequence
            </h3>
            {instructions.length > 0 ? (
              <ol className="mb-4">
                {instructions.map((cut) => (
                  <li
                    key={cut.stepNumber}
                    className="flex items-baseline gap-2 border-b border-black/30 py-1 text-sm"
                  >
                    <span className="inline-flex items-center justify-center w-6 h-6 shrink-0 border border-black rounded-full text-xs font-bold">
                      {cut.stepNumber}
                    </span>
                    <span className="font-semibold uppercase text-xs w-20 shrink-0">
                      {cut.kind === 'trim' ? 'Trim' : cut.kind === 'rip' ? 'Rip' : 'Crosscut'}
                    </span>
                    <span className="flex-1">
                      {cut.label}
                      {cut.approximate && (
                        <span className="ml-2 text-xs font-semibold">(approx.)</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm mb-4">
                No cuts required — the piece already matches the stock size.
              </p>
            )}

            {/* ── Finished pieces ──────────────────────────────────────── */}
            <h3 className="text-sm font-bold uppercase tracking-wide mb-1">
              Finished Pieces
            </h3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left border-b-2 border-black">
                  <th scope="col" className="w-8 py-1"><span className="sr-only">Cut</span>✓</th>
                  <th scope="col" className="py-1">Panel</th>
                  <th scope="col" className="py-1">Length</th>
                  <th scope="col" className="py-1">Width</th>
                  <th scope="col" className="py-1">Rotated</th>
                </tr>
              </thead>
              <tbody>
                {sheet.placements.map((p, pi) => {
                  // Mirror CutChecklist's key so a piece already ticked on screen
                  // shows ticked on paper.
                  const key = `${solution.id}:${sheet.stockSheetId}-${sheet.sheetIndex}:${pi}`;
                  const isChecked = !!checked[key];
                  return (
                    <tr key={pi} className="border-b border-black/30">
                      <td className="py-1">
                        <span className="inline-block w-4 h-4 border border-black text-center leading-4">
                          {isChecked ? '✓' : ''}
                        </span>
                      </td>
                      <td className="py-1 font-medium">{p.label}</td>
                      <td className="py-1">{fmt(p.width)}{suffix}</td>
                      <td className="py-1">{fmt(p.height)}{suffix}</td>
                      <td className="py-1">{p.rotated ? 'Yes' : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}

      {solution.unplacedPanels.length > 0 && (
        <section className="cut-sheet-page">
          <h2 className="text-lg font-bold border-b-2 border-black pb-1 mb-3">
            Unable to Fit
          </h2>
          <ul className="text-sm space-y-1">
            {solution.unplacedPanels.map((p) => (
              <li key={p.id}>
                {p.label} ({fmt(p.length)}{suffix} × {fmt(p.width)}{suffix}) ×{p.quantity}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
