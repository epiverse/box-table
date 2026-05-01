// Lazy XLSX → CSV converter. SheetJS (~400 KB) only loads when the user
// actually opens an .xlsx/.xls file.

export async function xlsxToCsv(bytes: Uint8Array): Promise<string> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(bytes, { type: 'array' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error('Workbook is empty.');
  const sheet = wb.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_csv(sheet);
}
