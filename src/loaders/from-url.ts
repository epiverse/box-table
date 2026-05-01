// Fetches a public URL into a PreparedSource. XLSX URLs are converted to
// CSV before handing off.

import { detectFormat, isXlsx } from './format';
import type { PreparedSource } from './types';
import { xlsxToCsv } from './xlsx';

export async function prepareFromUrl(url: string): Promise<PreparedSource> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  const path = new URL(url).pathname;
  const fileSeg = path.split('/').pop() || '';

  if (isXlsx(fileSeg)) {
    const csv = await xlsxToCsv(new Uint8Array(buf));
    return {
      bytes: new TextEncoder().encode(csv),
      format: 'csv',
      sourceName: fileSeg.replace(/\.(xlsx|xls)$/i, '.csv'),
    };
  }
  return {
    bytes: new Uint8Array(buf),
    format: detectFormat(fileSeg),
    sourceName: fileSeg || url,
  };
}
