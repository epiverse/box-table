// Downloads a Box file and prepares it as a library source. XLSX gets
// converted to CSV inline.

import { downloadFile } from '../box/api';
import { detectFormat, isXlsx } from './format';
import type { PreparedSource } from './types';
import { xlsxToCsv } from './xlsx';

export async function prepareFromBox(
  fileId: string,
  fileName: string,
): Promise<PreparedSource> {
  const { bytes, name } = await downloadFile(fileId, fileName);

  if (isXlsx(name)) {
    const csv = await xlsxToCsv(bytes);
    return {
      bytes: new TextEncoder().encode(csv),
      format: 'csv',
      sourceName: name.replace(/\.(xlsx|xls)$/i, '.csv'),
    };
  }
  return {
    bytes,
    format: detectFormat(name),
    sourceName: name,
  };
}
