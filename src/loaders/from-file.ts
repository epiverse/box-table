// Reads a local File into a PreparedSource. XLSX gets converted to CSV
// before handing off, so downstream code only deals with library-native
// formats.

import { detectFormat, isXlsx } from './format';
import type { PreparedSource } from './types';
import { xlsxToCsv } from './xlsx';

export async function prepareFromFile(file: File): Promise<PreparedSource> {
  const buf = await file.arrayBuffer();
  if (isXlsx(file.name)) {
    const csv = await xlsxToCsv(new Uint8Array(buf));
    return {
      bytes: new TextEncoder().encode(csv),
      format: 'csv',
      sourceName: file.name.replace(/\.(xlsx|xls)$/i, '.csv'),
    };
  }
  return {
    bytes: new Uint8Array(buf),
    format: detectFormat(file.name),
    sourceName: file.name,
  };
}
