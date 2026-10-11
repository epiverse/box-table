/**
 * Excel workbooks: telling a workbook from a dataset, and the chosen sheet's
 * conversion, which runs in a worker (`excel.worker.ts`). SheetJS loads with
 * that worker, the first time a workbook is opened, so the page itself never
 * downloads it. Ported from the @jeyabbalas/data-table demo (demo/excel.ts);
 * the sheet picker lives in `ui/sheet-picker.ts`.
 */

import type { ExcelRequest, ExcelResponse, SheetSummary } from './excel.worker';
import { WORKBOOK_EXTENSIONS, extensionOf } from './format';

export type { SheetSummary };

const WORKBOOK_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml',
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
];

/**
 * Whether a file is a workbook: by its extension, else by its media type,
 * else by its first bytes, a ZIP (xlsx, xlsm, xlsb, ods) or an OLE2 compound
 * file (xls). `knownExtension` says the name ends in a dataset's extension,
 * which settles it: Windows gives a .csv file Excel's media type.
 */
export async function isWorkbook(
  blob: Blob,
  name: string,
  contentType = '',
  knownExtension = false,
): Promise<boolean> {
  if (WORKBOOK_EXTENSIONS.has(extensionOf(name))) return true;
  if (knownExtension) return false;
  if (WORKBOOK_TYPES.some((type) => contentType.toLowerCase().startsWith(type))) return true;
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const zip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => head[i] === b);
  return zip || ole;
}

/** An open workbook, parsed in its own worker until {@link Workbook.close}. */
export class Workbook {
  private constructor(
    private readonly worker: Worker,
    readonly sheets: SheetSummary[],
  ) {}

  /** Parse `file` and list its sheets that hold data. */
  static async open(file: Blob): Promise<Workbook> {
    const worker = new Worker(new URL('./excel.worker.ts', import.meta.url), { type: 'module' });
    try {
      const reply = await ask(worker, { type: 'open', file });
      if (reply.type !== 'sheets') throw new Error('The workbook reader answered out of turn');
      return new Workbook(worker, reply.sheets);
    } catch (err) {
      worker.terminate();
      throw err;
    }
  }

  /** The sheet named `sheet` as NDJSON, one object per row. */
  async convert(sheet: string): Promise<{ blob: Blob; rows: number; columns: number }> {
    const reply = await ask(this.worker, { type: 'convert', sheet });
    if (reply.type !== 'converted') throw new Error('The workbook reader answered out of turn');
    return reply;
  }

  close(): void {
    this.worker.terminate();
  }
}

/** Send one request and wait for its answer: the worker answers in order. */
function ask(worker: Worker, request: ExcelRequest): Promise<ExcelResponse> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ExcelResponse>): void => {
      if (event.data.type === 'error') reject(new Error(event.data.message));
      else resolve(event.data);
    };
    worker.onerror = (event): void => {
      event.preventDefault();
      reject(new Error(event.message || 'The workbook could not be read'));
    };
    worker.postMessage(request);
  });
}
