/**
 * BoxTable — entry point.
 *
 * Wires three data sources (file, URL, Box) to the @jeyabbalas/data-table
 * library. Session caching, hash-based content identity, and snapshot
 * restoration are ported from the data-table demo. Box adds the OAuth
 * round-trip + a folder-browser modal.
 */

import '@jeyabbalas/data-table/styles';
import {
  VERSION,
  createDataTable,
  quoteIdentifier,
  SessionStore,
  type ColorScheme,
  type DataTable,
} from '@jeyabbalas/data-table';
import {
  isNumericType,
  isDateType,
  isTimeType,
  isCategoricalType,
} from '@jeyabbalas/data-table/advanced';

import { renderBrand } from './ui/branding';
import { toast } from './ui/status';
import { openBoxPicker } from './ui/box-picker';
import {
  beginAuth,
  disconnect,
  handleCallback,
  isAuthenticated,
  isConfigured,
  BoxAuthError,
} from './box/auth';
import { prepareFromFile } from './loaders/from-file';
import { prepareFromUrl } from './loaders/from-url';
import { prepareFromBox } from './loaders/from-box';
import type { LoadKind, PreparedSource } from './loaders/types';

// ----- DOM refs -----
renderBrand(document.getElementById('brand-host')!);

const versionEl = document.getElementById('version')!;
const initStatusEl = document.getElementById('init-status')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const loadFileBtn = document.getElementById('load-file-btn') as HTMLButtonElement;
const urlInput = document.getElementById('url-input') as HTMLInputElement;
const loadUrlBtn = document.getElementById('load-url-btn') as HTMLButtonElement;
const boxConnectBtn = document.getElementById('box-connect-btn') as HTMLButtonElement;
const boxBrowseBtn = document.getElementById('box-browse-btn') as HTMLButtonElement;
const boxDisconnectBtn = document.getElementById('box-disconnect-btn') as HTMLButtonElement;
const tableContainerEl = document.getElementById('table-container')!;
const tableInfoEl = document.getElementById('table-info')!;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
const clearSessionBtn = document.getElementById('clear-session-btn') as HTMLButtonElement;
const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
const themeRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="theme"]'));

versionEl.textContent = VERSION;

// ----- Theme toggle -----
let currentScheme: ColorScheme = 'auto';
for (const radio of themeRadios) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    currentScheme = radio.value as ColorScheme;
    table?.setColorScheme(currentScheme);
  });
}

// ----- Shareable `?url=` deep links (URL loads only) -----
const URL_PARAM_KEY = 'url';

function getUrlParam(): string | null {
  try {
    return new URLSearchParams(window.location.search).get(URL_PARAM_KEY);
  } catch {
    return null;
  }
}

function setUrlParam(url: string | null): void {
  try {
    const params = new URLSearchParams(window.location.search);
    if (url) params.set(URL_PARAM_KEY, url);
    else params.delete(URL_PARAM_KEY);
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? '?' + qs : ''}${window.location.hash}`;
    window.history.replaceState(null, '', next);
  } catch {
    /* history API unavailable */
  }
}

// ----- Parquet snapshot cache (IndexedDB) -----
const DATA_CACHE_DB = 'boxtable-data-cache';
const DATA_CACHE_STORE = 'data';
const LAST_SESSION_KEY = 'boxtable.last-session';

interface LastSession {
  type: LoadKind;
  source: string;
  // For Box: the file ID, used for re-download on restore.
  boxFileId?: string;
  tableName: string;
}

function openDataCache(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DATA_CACHE_DB, 1);
      req.onupgradeneeded = (): void => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DATA_CACHE_STORE)) {
          db.createObjectStore(DATA_CACHE_STORE, { keyPath: 'tableName' });
        }
      };
      req.onsuccess = (): void => resolve(req.result);
      req.onerror = (): void => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cacheTableData(
  tableName: string,
  buffer: Uint8Array,
  sourceName: string,
): Promise<void> {
  const db = await openDataCache();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(DATA_CACHE_STORE, 'readwrite');
    tx.objectStore(DATA_CACHE_STORE).put({ tableName, buffer, sourceName });
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => resolve();
  });
  db.close();
}

async function loadCachedData(
  tableName: string,
): Promise<{ buffer: Uint8Array; sourceName: string } | null> {
  const db = await openDataCache();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(DATA_CACHE_STORE, 'readonly');
    const req = tx.objectStore(DATA_CACHE_STORE).get(tableName);
    req.onsuccess = (): void => {
      db.close();
      resolve(req.result ? { buffer: req.result.buffer, sourceName: req.result.sourceName } : null);
    };
    req.onerror = (): void => {
      db.close();
      resolve(null);
    };
  });
}

async function clearCachedData(tableName: string): Promise<void> {
  const db = await openDataCache();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(DATA_CACHE_STORE, 'readwrite');
    tx.objectStore(DATA_CACHE_STORE).delete(tableName);
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => resolve();
  });
  db.close();
}

async function listCachedTableNames(): Promise<string[]> {
  const db = await openDataCache();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(DATA_CACHE_STORE, 'readonly');
    const req = tx.objectStore(DATA_CACHE_STORE).getAllKeys();
    req.onsuccess = (): void => {
      db.close();
      resolve((req.result as string[]) ?? []);
    };
    req.onerror = (): void => {
      db.close();
      resolve([]);
    };
  });
}

// First 64 bits of SHA-256 over the loaded bytes — same content yields the
// same tableName, so library snapshots restore. ~50–200ms on 100MB.
async function hashBytes(bytes: Uint8Array): Promise<string> {
  // Slice produces an ArrayBufferLike; we know it's an ArrayBuffer because
  // Uint8Array's underlying buffer is one in browser code.
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 8; i++) hex += view[i].toString(16).padStart(2, '0');
  return hex;
}

// ----- Library state -----
const sessionStore = new SessionStore();
let table: DataTable | null = null;
// Per-page counter so back-to-back file uploads always get unique tableNames
// even if the millisecond timestamp collides.
let fileUploadCounter = 0;

function readPreviousSession(): LastSession | null {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as LastSession;
    return typeof session.tableName === 'string' ? session : null;
  } catch {
    return null;
  }
}

async function pruneOrphans(currentTableName: string | null): Promise<void> {
  try {
    const sessionNames = await sessionStore.list();
    for (const name of sessionNames) {
      if (name !== currentTableName) await sessionStore.delete(name);
    }
  } catch {
    /* IDB unavailable */
  }
  try {
    const cacheKeys = await listCachedTableNames();
    for (const name of cacheKeys) {
      if (name !== currentTableName) await clearCachedData(name);
    }
  } catch {
    /* IDB unavailable */
  }
}

function updateInfo(message: string): void {
  tableInfoEl.innerHTML = message;
}

function updateTableInfo(): void {
  if (!table) return;
  const { state } = table;
  const tableName = state.tableName.get();
  if (!tableName) return;

  const totalRows = state.totalRows.get();
  const filteredRows = state.filteredRows.get();
  const schema = state.schema.get();
  const filters = state.filters.get();

  const numericCols = schema.filter((c) => isNumericType(c.type)).length;
  const dateCols = schema.filter((c) => isDateType(c.type)).length;
  const timeCols = schema.filter((c) => isTimeType(c.type)).length;
  const categoricalCols = schema.filter((c) => isCategoricalType(c.type)).length;

  let info =
    filters.length > 0
      ? `<strong>${filteredRows.toLocaleString()}</strong> / ${totalRows.toLocaleString()} rows, <strong>${schema.length}</strong> columns | <strong>${filters.length}</strong> filter${filters.length > 1 ? 's' : ''}`
      : `<strong>${totalRows.toLocaleString()}</strong> rows, <strong>${schema.length}</strong> columns`;
  info += ` (${numericCols} numeric, ${dateCols} date, ${timeCols} time, ${categoricalCols} categorical)`;

  const derived = state.derivedColumns.get();
  if (derived.length > 0) info += ` | <strong>${derived.length}</strong> derived`;
  const pinned = state.pinnedColumns.get();
  if (pinned.length > 0) info += ` | <strong>${pinned.length}</strong> pinned`;
  const sort = state.sortColumns.get();
  if (sort.length > 0) {
    const desc = sort
      .map(
        (s, i) =>
          `${s.column} (${s.direction === 'asc' ? '▲' : '▼'}${sort.length > 1 ? ` #${i + 1}` : ''})`,
      )
      .join(', ');
    info += ` | <strong>Sort:</strong> ${desc}`;
  }
  updateInfo(info);
}

interface LoadBytesOptions {
  meta: { type: LoadKind; source: string; boxFileId?: string };
  knownTableName?: string;
  skipParquetCache?: boolean;
}

async function loadBytes(prepared: PreparedSource, opts: LoadBytesOptions): Promise<void> {
  updateInfo('Loading data…');

  // Identity policy:
  //   file → unique per-click (always fresh)
  //   url, box → SHA-256 of bytes (content-aware caching)
  let tableName: string;
  if (opts.knownTableName) {
    tableName = opts.knownTableName;
  } else if (opts.meta.type === 'file') {
    tableName = `dt_file_${Date.now().toString(36)}_${++fileUploadCounter}`;
  } else {
    tableName = `dt_${await hashBytes(prepared.bytes)}`;
  }
  const previousSession = readPreviousSession();
  const previousTableName = previousSession?.tableName ?? null;

  // Skip-if-current: re-loading the same content into the same table is a
  // no-op at the DuckDB layer; just refresh the labels.
  if (table) {
    const currentBaseTable = table.state.baseTableName.get() ?? table.state.tableName.get();
    if (currentBaseTable === tableName) {
      persistSession(opts, tableName);
      setUrlParam(opts.meta.type === 'url' ? opts.meta.source : null);
      updateTableInfo();
      return;
    }
  }

  const librarySource: ArrayBuffer | string =
    prepared.format === 'parquet'
      ? (prepared.bytes.buffer.slice(
          prepared.bytes.byteOffset,
          prepared.bytes.byteOffset + prepared.bytes.byteLength,
        ) as ArrayBuffer)
      : new TextDecoder('utf-8').decode(prepared.bytes);

  try {
    if (!table) {
      table = await createDataTable({
        container: tableContainerEl,
        source: librarySource,
        sourceFormat: prepared.format,
        tableName,
        persistence: { sessionStore },
        presets: true,
        undoRedo: true,
        expressionFilter: true,
        visualizations: true,
        colorScheme: currentScheme,
      });
      wireTableEvents(table);
    } else {
      await table.loadData(librarySource, {
        tableName,
        sourceFormat: prepared.format,
      });
    }

    updateTableInfo();
    persistSession(opts, tableName);

    if (previousTableName && previousTableName !== tableName) {
      try {
        await sessionStore.delete(previousTableName);
      } catch {
        /* best-effort */
      }
      try {
        await clearCachedData(previousTableName);
      } catch {
        /* best-effort */
      }
    }

    setUrlParam(opts.meta.type === 'url' ? opts.meta.source : null);

    // Cache the loaded table as Parquet for refresh-restore. Skipped when
    // we just restored from this exact cache entry.
    if (!opts.skipParquetCache) {
      const currentTableName = table.state.tableName.get();
      const baseTable = table.state.baseTableName.get() ?? currentTableName;
      if (currentTableName && baseTable) {
        const cacheCols = table.state.schema
          .get()
          .filter((c) => !c.system && !c.isDerived)
          .map((c) => quoteIdentifier(c.name))
          .join(', ');
        if (cacheCols) {
          table.bridge
            .exportToBuffer(`SELECT ${cacheCols} FROM ${quoteIdentifier(baseTable)}`, 'parquet')
            .then((buffer) => cacheTableData(currentTableName, buffer, prepared.sourceName))
            .catch(() => {
              /* caching is best-effort */
            });
        }
      }
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'LOAD_RESERVED_COLUMN_NAME') {
      try {
        await sessionStore.delete(tableName);
      } catch {
        /* ignore */
      }
      try {
        await clearCachedData(tableName);
      } catch {
        /* ignore */
      }
      try {
        localStorage.removeItem(LAST_SESSION_KEY);
      } catch {
        /* ignore */
      }
      updateInfo('Cached session was stale and has been cleared. Load a file or URL to continue.');
      return;
    }
    updateInfo(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function persistSession(opts: LoadBytesOptions, tableName: string): void {
  try {
    const session: LastSession = {
      type: opts.meta.type,
      source: opts.meta.source,
      tableName,
    };
    if (opts.meta.boxFileId) session.boxFileId = opts.meta.boxFileId;
    localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* localStorage unavailable */
  }
}

async function loadFromFile(file: File): Promise<void> {
  try {
    const prepared = await prepareFromFile(file);
    await loadBytes(prepared, { meta: { type: 'file', source: file.name } });
    fileInput.value = '';
  } catch (error) {
    updateInfo(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function loadFromUrl(url: string): Promise<void> {
  try {
    const prepared = await prepareFromUrl(url);
    await loadBytes(prepared, { meta: { type: 'url', source: url } });
  } catch (error) {
    updateInfo(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function loadFromBox(fileId: string, fileName: string): Promise<void> {
  try {
    updateInfo(`Downloading <strong>${fileName}</strong> from Box…`);
    const prepared = await prepareFromBox(fileId, fileName);
    await loadBytes(prepared, {
      meta: { type: 'box', source: fileName, boxFileId: fileId },
    });
  } catch (error) {
    if (error instanceof BoxAuthError) {
      updateAuthUi();
      toast(error.message, 'error');
      return;
    }
    updateInfo(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function wireTableEvents(t: DataTable): void {
  t.on('filterChange', updateTableInfo);
  t.on('sortChange', updateTableInfo);
  t.on('columnChange', updateTableInfo);
  t.on('derivedChange', updateTableInfo);

  t.on('undoChange', ({ canUndo, canRedo }) => {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
    resetBtn.disabled = !canUndo;
  });

  const syncDataDependentBtns = (name: string | null): void => {
    exportBtn.disabled = !name;
    clearSessionBtn.disabled = !name;
  };
  t.state.tableName.subscribe(syncDataDependentBtns);
  syncDataDependentBtns(t.state.tableName.get());
}

// ----- Box auth UI -----
function updateAuthUi(): void {
  if (!isConfigured()) {
    boxConnectBtn.disabled = true;
    boxConnectBtn.title = 'Box token-exchange worker is not configured. See README.';
    boxConnectBtn.hidden = false;
    boxBrowseBtn.hidden = true;
    boxDisconnectBtn.hidden = true;
    return;
  }
  if (isAuthenticated()) {
    boxConnectBtn.hidden = true;
    boxBrowseBtn.hidden = false;
    boxDisconnectBtn.hidden = false;
  } else {
    boxConnectBtn.hidden = false;
    boxConnectBtn.disabled = false;
    boxBrowseBtn.hidden = true;
    boxDisconnectBtn.hidden = true;
  }
}

boxConnectBtn.addEventListener('click', () => {
  try {
    beginAuth();
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Failed to start Box authentication.', 'error');
  }
});

boxBrowseBtn.addEventListener('click', () => {
  openBoxPicker({
    onSelect: ({ id, name }) => void loadFromBox(id, name),
    onError: (msg) => toast(msg, 'error'),
  });
});

boxDisconnectBtn.addEventListener('click', () => {
  disconnect();
  updateAuthUi();
  toast('Disconnected from Box.', 'info');
});

// ----- UI wiring -----
exportBtn.addEventListener('click', () => table?.openExportDialog());
undoBtn.addEventListener('click', () => table?.actions.undo());
redoBtn.addEventListener('click', () => table?.actions.redo());
resetBtn.addEventListener('click', () => table?.actions.resetToInitial());

clearSessionBtn.addEventListener('click', async () => {
  const tableName = table?.state.baseTableName.get() ?? table?.state.tableName.get() ?? null;
  if (table) await table.clearSession();
  if (tableName) await clearCachedData(tableName);
  try {
    localStorage.removeItem(LAST_SESSION_KEY);
  } catch {
    /* ignore */
  }
  setUrlParam(null);
  fileInput.value = '';
  urlInput.value = '';
  updateInfo('Session cleared. Load a file, URL, or Box spreadsheet to start fresh.');
});

loadFileBtn.addEventListener('click', () => {
  const file = fileInput.files?.[0];
  if (file) void loadFromFile(file);
});
loadUrlBtn.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (url) void loadFromUrl(url);
});
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !loadUrlBtn.disabled) {
    const url = urlInput.value.trim();
    if (url) void loadFromUrl(url);
  }
});

for (const chip of document.querySelectorAll<HTMLButtonElement>('.chip[data-url]')) {
  chip.addEventListener('click', () => {
    const url = chip.dataset.url;
    if (!url || loadUrlBtn.disabled) return;
    urlInput.value = url;
    void loadFromUrl(url);
  });
}

// ----- Init + auto-restore -----
(async () => {
  // OAuth callback first — may throw if state mismatched. Run before
  // anything else so the URL is scrubbed before any other code reads it.
  try {
    if (await handleCallback()) {
      toast('Connected to Box.', 'info');
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Box authentication failed.', 'error');
  }

  initStatusEl.textContent = 'DuckDB Ready';
  initStatusEl.classList.add('init-status--success');
  loadFileBtn.disabled = false;
  loadUrlBtn.disabled = false;
  updateAuthUi();
  updateInfo('Load a file, URL, or Box spreadsheet to begin.');

  await sessionStore.open();

  // Shared `?url=` deep links take precedence over session restore.
  const sharedUrl = getUrlParam();
  if (sharedUrl) {
    urlInput.value = sharedUrl;
    updateInfo(`Loading shared dataset: <strong>${sharedUrl}</strong>…`);
    let prepared: PreparedSource;
    try {
      prepared = await prepareFromUrl(sharedUrl);
    } catch (err) {
      updateInfo(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return;
    }
    const tableName = `dt_${await hashBytes(prepared.bytes)}`;
    await pruneOrphans(tableName);
    await loadBytes(prepared, {
      meta: { type: 'url', source: sharedUrl },
      knownTableName: tableName,
    });
    return;
  }

  try {
    const session = readPreviousSession();
    if (!session) {
      await pruneOrphans(null);
      return;
    }
    await pruneOrphans(session.tableName);
    const cached = await loadCachedData(session.tableName);
    if (cached) {
      updateInfo(`Restoring session: <strong>${cached.sourceName}</strong>…`);
      const bytes = new Uint8Array(cached.buffer as unknown as ArrayBufferLike);
      await loadBytes(
        { bytes, format: 'parquet', sourceName: cached.sourceName },
        {
          meta: { type: session.type, source: session.source, boxFileId: session.boxFileId },
          knownTableName: session.tableName,
          skipParquetCache: true,
        },
      );
    } else if (session.type === 'url') {
      urlInput.value = session.source;
      void loadFromUrl(session.source);
    } else if (session.type === 'box' && session.boxFileId && isAuthenticated()) {
      void loadFromBox(session.boxFileId, session.source);
    } else {
      updateInfo(
        `Previous session: <strong>${session.source}</strong> — ` +
          `load the same file to restore your state, or ` +
          `<a href="#" id="dismiss-session">dismiss</a>.`,
      );
      document.getElementById('dismiss-session')?.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          localStorage.removeItem(LAST_SESSION_KEY);
        } catch {
          /* ignore */
        }
        updateInfo('Load a file, URL, or Box spreadsheet to begin.');
      });
    }
  } catch {
    /* localStorage unavailable */
  }
})();
