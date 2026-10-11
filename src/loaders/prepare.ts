/**
 * Turning a source (a local file, a URL, or a Box file) into what the
 * library loads. Follows the @jeyabbalas/data-table demo's `prepareSource`:
 * the page never reads a dataset itself. A file, or a download's bytes, goes
 * to the library as a File, so a large Parquet file takes the library's
 * large-file path: DuckDB reads it from disk as it loads, and nothing copies
 * it into the page. Excel workbooks are the exception: the library does not
 * read them, so `excel.ts` converts the chosen sheet to JSON first.
 */

import { downloadFile } from '../box/api';
import { escapeHtml, formatSize } from '../util';
import { Workbook, isWorkbook, type SheetSummary } from './excel';
import { detectFormatFromName, hasDatasetExtension, sniffFormat } from './format';
import type { PreparedSource } from './types';

/** How a preparation tells the page what it is doing. */
export interface PrepareHooks {
  /** A stage begins: `title` for the loading overlay, `status` (HTML) for the status bar. */
  begin(title: string, status: string): void;
  step(text: string): void;
  /** Determinate progress, 0 to 1; `null` for none. */
  progress(fraction: number | null): void;
  /** Ask which of a workbook's sheets to load; `null` when the picker is dismissed. */
  pickSheet(fileName: string, sheets: SheetSummary[]): Promise<string | null>;
}

/** Bytes downloaded from a URL, with the server's media type. */
interface Download {
  blob: Blob;
  contentType: string;
}

/**
 * A local file. Resolves `null` when the user dismisses a workbook's sheet
 * picker.
 */
export async function prepareFile(
  file: File,
  hooks: PrepareHooks,
  sheet?: string | null,
): Promise<PreparedSource | null> {
  const known = hasDatasetExtension(file.name);
  if (await isWorkbook(file, file.name, file.type, known)) {
    return prepareWorkbook(file, file.name, hooks, sheet);
  }
  const format = known ? detectFormatFromName(file.name) : await sniffFormat(file, '');
  return { file, format, sourceName: file.name };
}

/** A public URL, downloaded. Resolves `null` when the sheet picker is dismissed. */
export async function prepareUrl(
  url: string,
  hooks: PrepareHooks,
  sheet?: string | null,
): Promise<PreparedSource | null> {
  const sourceName = url.split('/').pop() || url;
  hooks.begin(`Downloading ${sourceName}`, `Downloading <strong>${escapeHtml(sourceName)}</strong>…`);
  const { blob, contentType } = await download(url, (loaded, total) =>
    reportProgress(hooks, loaded, total),
  );
  hooks.progress(null);
  // A web page is no dataset, though it would load as a CSV of its HTML: a
  // server that answers any path with its app's page sends one, as Vite's
  // dev server does for a relative `?url=` it has no file for.
  const head = (await blob.slice(0, 1024).text()).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) {
    throw new Error('The URL returned a web page, not a data file');
  }
  // Relative to the page, as the request reads it: a relative `?url=`.
  const path = new URL(url, window.location.href).pathname;
  const fileSeg = decodeURIComponent(path.split('/').pop() || '');
  return prepareDownload({ blob, contentType }, fileSeg, sourceName, hooks, sheet);
}

/**
 * A file in the user's Box account, downloaded. `size` (from the folder
 * listing) stands in for the total when the download does not say it.
 * Resolves `null` when the sheet picker is dismissed.
 */
export async function prepareBox(
  file: { id: string; name: string; size?: number },
  hooks: PrepareHooks,
  sheet?: string | null,
): Promise<PreparedSource | null> {
  hooks.begin(
    `Downloading ${file.name}`,
    `Downloading <strong>${escapeHtml(file.name)}</strong> from Box…`,
  );
  const downloaded = await downloadFile(file.id, (loaded, total) =>
    reportProgress(hooks, loaded, total || file.size || 0),
  );
  hooks.progress(null);
  return prepareDownload(downloaded, file.name, file.name, hooks, sheet);
}

function reportProgress(hooks: PrepareHooks, loaded: number, total: number): void {
  const known = total > 0 && loaded <= total;
  hooks.step(known ? `${formatSize(loaded)} of ${formatSize(total)}` : formatSize(loaded));
  hooks.progress(known ? loaded / total : null);
}

/** Downloaded bytes named `fileSeg`: a workbook's sheet, or a dataset as a File. */
async function prepareDownload(
  { blob, contentType }: Download,
  fileSeg: string,
  sourceName: string,
  hooks: PrepareHooks,
  sheet?: string | null,
): Promise<PreparedSource | null> {
  const known = hasDatasetExtension(fileSeg);
  if (await isWorkbook(blob, fileSeg, contentType, known)) {
    return prepareWorkbook(blob, sourceName, hooks, sheet);
  }
  return {
    file: new File([blob], fileSeg || 'data', { type: blob.type }),
    format: known ? detectFormatFromName(fileSeg) : await sniffFormat(blob, contentType),
    sourceName,
  };
}

/**
 * Download `url` as a Blob, reporting progress as it goes. An XHR rather
 * than `fetch`: its blob response is written to the browser's blob store
 * as it arrives, so a large download is kept on disk rather than in the
 * page, and it still reports bytes received, which `response.blob()` does
 * not.
 */
function download(
  url: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<Download> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'blob';
    xhr.onprogress = (event): void =>
      onProgress(event.loaded, event.lengthComputable ? event.total : 0);
    xhr.onload = (): void => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({
          blob: xhr.response as Blob,
          contentType: xhr.getResponseHeader('content-type') ?? '',
        });
      } else {
        reject(new Error(`Failed to fetch URL: ${xhr.status} ${xhr.statusText}`.trimEnd()));
      }
    };
    // A network failure or a refused cross-origin request: the browser says
    // which in the console, and nothing more here.
    xhr.onerror = (): void =>
      reject(
        new Error(
          'Failed to fetch URL: the server could not be reached, or it does not let ' +
            'other sites read the file (CORS)',
        ),
      );
    xhr.send();
  });
}

/**
 * A workbook's sheet, converted to JSON: `wanted` if the workbook has it,
 * the only sheet with data if there is one, or the one picked in the sheet
 * picker. Resolves `null` when the picker is dismissed.
 */
async function prepareWorkbook(
  blob: Blob,
  sourceName: string,
  hooks: PrepareHooks,
  wanted?: string | null,
): Promise<PreparedSource | null> {
  const opening = (): void =>
    hooks.begin(`Opening ${sourceName}`, `Opening <strong>${escapeHtml(sourceName)}</strong>…`);
  opening();
  hooks.step('Reading the workbook…');
  let workbook: Workbook;
  try {
    workbook = await Workbook.open(blob);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read ${sourceName} as a workbook: ${reason}`, { cause: err });
  }
  try {
    const { sheets } = workbook;
    if (sheets.length === 0) throw new Error(`${sourceName} has no sheet with data`);
    let sheet = sheets.find((s) => s.name === wanted)?.name ?? null;
    if (sheet === null && sheets.length === 1) sheet = sheets[0]!.name;
    if (sheet === null) {
      sheet = await hooks.pickSheet(sourceName, sheets);
      if (sheet === null) return null;
      opening();
    }
    hooks.step(`Converting the sheet ${sheet}…`);
    const converted = await workbook.convert(sheet);
    const base = sourceName.replace(/\.[^.]+$/, '');
    return {
      file: new File([converted.blob], `${base} - ${sheet}.ndjson`, {
        type: 'application/x-ndjson',
      }),
      format: 'json',
      sourceName: `${sourceName} › ${sheet}`,
      // Read every row to type the columns: a column empty for the first
      // 20,480 rows would otherwise be typed from nothing.
      sourceOptions: { json: { format: 'ndjson', sampleSize: -1 } },
      sheet,
      size: blob.size,
    };
  } finally {
    workbook.close();
  }
}
