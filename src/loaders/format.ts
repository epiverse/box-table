// File-format detection by extension. XLSX/XLS are normalized into CSV
// upstream so the data-table library only ever sees its native formats.

import type { FileFormat } from './types';

export function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export function detectFormat(name: string): FileFormat {
  const ext = extensionOf(name);
  if (ext === 'parquet' || ext === 'pq') return 'parquet';
  if (ext === 'json' || ext === 'ndjson' || ext === 'jsonl') return 'json';
  return 'csv';
}

export function isXlsx(name: string): boolean {
  const ext = extensionOf(name);
  return ext === 'xlsx' || ext === 'xls';
}
