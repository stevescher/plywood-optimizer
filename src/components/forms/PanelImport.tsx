'use client';

import { useState, useRef } from 'react';
import { Upload, Download, X, AlertCircle, Check } from 'lucide-react';
import { useProjectStore } from '@/store/useProjectStore';
import { parseInput, parseStrictNumber } from '@/lib/fractions';
import { Panel } from '@/lib/optimizer/types';
import { csvRow } from '@/lib/safe-export';
import { nanoid } from 'nanoid';

interface ParsedRow {
  rowNum: number;
  label: string;
  length: number;
  width: number;
  qty: number;
  error?: string;
}

/**
 * Parse CSV text into rows (RFC 4180). A single character-stream pass so a
 * newline *inside* a quoted field (common in Excel exports) stays part of that
 * field instead of splitting the row.
 */
export function parseCSV(text: string): string[][] {
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let fields: string[] = [];
  let cur = '';
  let inQuote = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuote) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; }  // escaped quote
        else inQuote = false;
      } else {
        cur += ch;                                     // includes newlines
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      fields.push(cur.trim());
      cur = '';
    } else if (ch === '\n') {
      fields.push(cur.trim());
      rows.push(fields);
      fields = [];
      cur = '';
    } else {
      cur += ch;
    }
  }
  // Flush the trailing field/row (no final newline).
  if (cur !== '' || fields.length > 0) {
    fields.push(cur.trim());
    rows.push(fields);
  }

  // Drop rows that are entirely empty.
  return rows.filter((r) => r.some((f) => f !== ''));
}

/** Parse CSV text into preview rows, with per-row error messages */
function parseRows(csvText: string, units: 'imperial' | 'metric'): ParsedRow[] {
  const rows = parseCSV(csvText);
  if (rows.length === 0) return [];

  // Detect header row — find column indices case-insensitively
  const header = rows[0].map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
  const colLabel = header.findIndex((h) => h === 'label' || h === 'name' || h === 'part');
  const colLength = header.findIndex((h) => h === 'length' || h === 'len' || h === 'l');
  const colWidth = header.findIndex((h) => h === 'width' || h === 'wid' || h === 'w');
  const colQty = header.findIndex((h) => h === 'qty' || h === 'quantity' || h === 'count' || h === 'q');

  if (colLength === -1 || colWidth === -1) {
    return [{
      rowNum: 1,
      label: '',
      length: 0,
      width: 0,
      qty: 1,
      error: 'Could not find "length" and "width" columns. Check your header row.',
    }];
  }

  const parsed: ParsedRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1;
    const rawLabel = colLabel !== -1 ? row[colLabel] ?? '' : '';
    const rawLength = row[colLength] ?? '';
    const rawWidth = row[colWidth] ?? '';
    const rawQty = colQty !== -1 ? row[colQty] ?? '1' : '1';

    const length = parseInput(rawLength, units);
    const width = parseInput(rawWidth, units);
    // Clamp qty to the same 1..100 range the project validator enforces, so a
    // fat-fingered "9999" can't be imported and later choke the optimizer.
    // Strict: reject numeric-prefix garbage ("3x" → NaN) so a malformed qty
    // cell is flagged invalid rather than silently coerced. (OPUS-406)
    const parsedQty = parseStrictNumber(rawQty);
    const qty = Math.min(100, Math.max(1, Math.round(isFinite(parsedQty) ? parsedQty : 1)));

    const errors: string[] = [];
    if (!isFinite(length) || length <= 0)
      errors.push(`invalid length "${rawLength}"`);
    if (!isFinite(width) || width <= 0)
      errors.push(`invalid width "${rawWidth}"`);
    if (rawQty.trim() !== '' && !isFinite(parsedQty))
      errors.push(`invalid qty "${rawQty}"`);

    parsed.push({
      rowNum,
      label: rawLabel,
      length: isFinite(length) && length > 0 ? length : 0,
      width: isFinite(width) && width > 0 ? width : 0,
      qty,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    });
  }
  return parsed;
}

/** Download a template CSV */
function downloadTemplate(units: 'imperial' | 'metric') {
  const dim1 = units === 'metric' ? '600' : '24';
  const dim2 = units === 'metric' ? '300' : '12';
  const dim3 = units === 'metric' ? '400' : '16';
  const dim4 = units === 'metric' ? '200' : '8';
  const content = [
    csvRow(['label', 'length', 'width', 'qty']),
    csvRow(['Side Panel', dim1, dim2, 2]),
    csvRow(['Shelf', dim3, dim4, 4]),
    csvRow(['Top', dim1, dim4, 1]),
  ].join('\n');
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'panel-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

interface PanelImportProps {
  onClose: () => void;
}

export function PanelImport({ onClose }: PanelImportProps) {
  const { units } = useProjectStore();
  const [parsedRows, setParsedRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [mergeMode, setMergeMode] = useState<'replace' | 'merge'>('replace');
  const fileRef = useRef<HTMLInputElement>(null);

  const validRows = parsedRows?.filter((r) => !r.error) ?? [];
  const errorRows = parsedRows?.filter((r) => r.error) ?? [];

  function handleFile(file: File) {
    const MAX_SIZE = 1 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setParsedRows([{ rowNum: 0, label: '', length: 0, width: 0, qty: 1, error: 'File too large (max 1 MB).' }]);
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setParsedRows(parseRows(text, units));
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleConfirm() {
    if (validRows.length === 0) return;

    // Build Panel objects
    const newPanels: Panel[] = validRows.map((r) => ({
      id: nanoid(),
      label: r.label,
      length: r.length,
      width: r.width,
      quantity: r.qty,
      lockRotation: false,
    }));

    const store = useProjectStore.getState();
    if (mergeMode === 'replace') {
      // One atomic write — avoids N autosave cycles and the mid-loop live-state
      // read the old per-panel loop depended on.
      store.setPanels(newPanels);
    } else {
      // Merge: append to the existing list in a single write.
      store.setPanels([...store.panels, ...newPanels]);
    }

    onClose();
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Import Panels from CSV</span>
        <button onClick={onClose} aria-label="Close import dialog" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Drop zone */}
      {!parsedRows && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-border rounded-xl p-6 text-center
                     hover:border-primary hover:bg-accent transition-colors cursor-pointer"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground font-medium">Drop a CSV file here, or click to browse</p>
          <p className="text-xs text-muted-foreground mt-1">Required columns: label, length, width, qty</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>
      )}

      {/* Download template */}
      <button
        onClick={() => downloadTemplate(units)}
        className="flex items-center gap-1.5 text-xs text-primary hover:text-primary transition-colors"
      >
        <Download className="h-3.5 w-3.5" />
        Download CSV template
      </button>

      {/* Preview */}
      {parsedRows && (
        <>
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{fileName}</span>
            {' — '}
            {validRows.length} valid row{validRows.length !== 1 ? 's' : ''}
            {errorRows.length > 0 && (
              <span className="text-red-500 dark:text-red-400 ml-1">
                , {errorRows.length} error{errorRows.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Rows table */}
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border text-xs">
            <table className="w-full">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left text-muted-foreground font-medium">#</th>
                  <th className="px-2 py-1 text-left text-muted-foreground font-medium">Label</th>
                  <th className="px-2 py-1 text-right text-muted-foreground font-medium">Length</th>
                  <th className="px-2 py-1 text-right text-muted-foreground font-medium">Width</th>
                  <th className="px-2 py-1 text-right text-muted-foreground font-medium">Qty</th>
                  <th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row) => (
                  <tr
                    key={row.rowNum}
                    className={row.error ? 'bg-red-50 dark:bg-red-950/40' : 'even:bg-muted'}
                  >
                    <td className="px-2 py-1 text-muted-foreground">{row.rowNum}</td>
                    <td className="px-2 py-1 text-foreground">{row.label || <span className="text-muted-foreground italic">—</span>}</td>
                    <td className="px-2 py-1 text-right text-foreground">{row.error && row.length === 0 ? '—' : row.length}</td>
                    <td className="px-2 py-1 text-right text-foreground">{row.error && row.width === 0 ? '—' : row.width}</td>
                    <td className="px-2 py-1 text-right text-foreground">{row.qty}</td>
                    <td className="px-2 py-1">
                      {row.error
                        ? <AlertCircle className="h-3 w-3 text-red-400" aria-label={row.error} />
                        : <Check className="h-3 w-3 text-green-500" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Error details */}
          {errorRows.length > 0 && (
            <div className="text-xs text-red-600 dark:text-red-400 space-y-0.5">
              {errorRows.map((r) => (
                <div key={r.rowNum}>Row {r.rowNum}: {r.error}</div>
              ))}
            </div>
          )}

          {/* Merge mode */}
          <div className="flex gap-3 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="mergeMode"
                value="replace"
                checked={mergeMode === 'replace'}
                onChange={() => setMergeMode('replace')}
                className="accent-indigo-600"
              />
              <span className="text-foreground">Replace existing panels</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="mergeMode"
                value="merge"
                checked={mergeMode === 'merge'}
                onChange={() => setMergeMode('merge')}
                className="accent-indigo-600"
              />
              <span className="text-foreground">Append to existing</span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={validRows.length === 0}
              className="flex-1 h-8 rounded-lg bg-indigo-600 text-white text-xs font-semibold
                         hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Import {validRows.length} panel{validRows.length !== 1 ? 's' : ''}
            </button>
            <button
              onClick={() => { setParsedRows(null); setFileName(''); }}
              className="h-8 px-3 rounded-lg border border-border text-xs text-muted-foreground
                         hover:bg-muted transition-colors"
            >
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
