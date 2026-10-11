// File-format detection. Excel workbooks are converted to NDJSON upstream
// (see excel.ts), so the data-table library only ever sees its native
// formats.

import type { FileFormat } from './types';

export const FORMAT_EXTENSIONS: Record<string, FileFormat> = {
  parquet: 'parquet',
  pq: 'parquet',
  json: 'json',
  ndjson: 'json',
  jsonl: 'json',
  csv: 'csv',
  tsv: 'csv',
  txt: 'csv',
};

export const WORKBOOK_EXTENSIONS = new Set(['xlsx', 'xlsm', 'xlsb', 'xls', 'ods']);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Whether the name ends in a dataset's extension (not a workbook's). */
export function hasDatasetExtension(name: string): boolean {
  return extensionOf(name) in FORMAT_EXTENSIONS;
}

/** Whether BoxTable can open a file of this name: a dataset or a workbook. */
export function isLoadableName(name: string): boolean {
  return hasDatasetExtension(name) || WORKBOOK_EXTENSIONS.has(extensionOf(name));
}

export function detectFormatFromName(name: string): FileFormat {
  return FORMAT_EXTENSIONS[extensionOf(name)] ?? 'csv';
}

/**
 * A dataset's format when its name does not say: Parquet starts with
 * `PAR1`, JSON with `[` or `{`; anything else is read as CSV, whose
 * dialect DuckDB detects.
 */
export async function sniffFormat(blob: Blob, contentType: string): Promise<FileFormat> {
  const head = await blob.slice(0, 64).text();
  if (head.startsWith('PAR1')) return 'parquet';
  if (/json/i.test(contentType) || /^\s*[[{]/.test(head)) return 'json';
  return 'csv';
}
