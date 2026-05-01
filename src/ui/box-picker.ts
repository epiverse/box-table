// Modal Box file browser. Folder navigation with breadcrumb; clicking a
// spreadsheet file fires `onSelect` and closes. Non-spreadsheet files render
// dimmed and inert.

import { listFolder, type BoxItem } from '../box/api';
import { SUPPORTED_EXTENSIONS, type SupportedExtension } from '../config';

const SUPPORTED_SET = new Set<string>(SUPPORTED_EXTENSIONS);

export interface BoxFileSelection {
  id: string;
  name: string;
}

export interface PickerOptions {
  onSelect: (selection: BoxFileSelection) => void;
  onError: (message: string) => void;
}

function isSupportedFile(item: BoxItem): boolean {
  if (item.type !== 'file') return false;
  const ext = (item.extension ?? '').toLowerCase();
  return SUPPORTED_SET.has(ext as SupportedExtension);
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function compareItems(a: BoxItem, b: BoxItem): number {
  // Folders first, then files. Within each group, by name (case-insensitive).
  if (a.type !== b.type) {
    if (a.type === 'folder') return -1;
    if (b.type === 'folder') return 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

export function openBoxPicker(opts: PickerOptions): void {
  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';
  overlay.innerHTML = `
    <div class="picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
      <header class="picker__header">
        <h2 id="picker-title" class="picker__title">Browse Box files</h2>
        <button type="button" class="picker__close" aria-label="Close">×</button>
      </header>
      <nav class="picker__crumbs" aria-label="Folder path"></nav>
      <div class="picker__body">
        <div class="picker__loading">Loading…</div>
        <ul class="picker__list" hidden></ul>
      </div>
      <footer class="picker__footer">
        <span class="picker__hint">Click a folder to open it. Spreadsheets (CSV, JSON, Parquet, XLSX) are loadable.</span>
      </footer>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector<HTMLButtonElement>('.picker__close')!;
  const crumbsEl = overlay.querySelector<HTMLElement>('.picker__crumbs')!;
  const listEl = overlay.querySelector<HTMLUListElement>('.picker__list')!;
  const loadingEl = overlay.querySelector<HTMLDivElement>('.picker__loading')!;

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  async function navigate(folderId: string): Promise<void> {
    loadingEl.hidden = false;
    listEl.hidden = true;
    listEl.innerHTML = '';
    crumbsEl.innerHTML = '';

    let listing;
    try {
      listing = await listFolder(folderId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load folder.';
      loadingEl.textContent = message;
      opts.onError(message);
      return;
    }

    // Render breadcrumb
    listing.pathCollection.forEach((crumb, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'picker__crumb-sep';
        sep.textContent = '/';
        crumbsEl.appendChild(sep);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'picker__crumb';
      btn.textContent = crumb.name;
      btn.disabled = crumb.id === listing.folderId;
      btn.addEventListener('click', () => void navigate(crumb.id));
      crumbsEl.appendChild(btn);
    });

    // Render list
    const sorted = [...listing.items].sort(compareItems);
    if (sorted.length === 0) {
      listEl.innerHTML = '<li class="picker__empty">This folder is empty.</li>';
    } else {
      for (const item of sorted) {
        const li = document.createElement('li');
        li.className = 'picker__item';
        const isFolder = item.type === 'folder';
        const supported = isSupportedFile(item);
        if (isFolder) li.classList.add('picker__item--folder');
        if (item.type === 'file' && !supported) li.classList.add('picker__item--dim');

        const icon = isFolder ? '📁' : '📄';
        const meta = item.type === 'file' ? formatBytes(item.size) : '';

        li.innerHTML = `
          <span class="picker__icon" aria-hidden="true">${icon}</span>
          <span class="picker__name"></span>
          <span class="picker__meta"></span>
        `;
        li.querySelector<HTMLElement>('.picker__name')!.textContent = item.name;
        li.querySelector<HTMLElement>('.picker__meta')!.textContent = meta;

        if (isFolder) {
          li.tabIndex = 0;
          li.addEventListener('click', () => void navigate(item.id));
          li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              void navigate(item.id);
            }
          });
        } else if (supported) {
          li.tabIndex = 0;
          li.addEventListener('click', () => {
            opts.onSelect({ id: item.id, name: item.name });
            close();
          });
          li.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              opts.onSelect({ id: item.id, name: item.name });
              close();
            }
          });
        }
        listEl.appendChild(li);
      }
    }

    loadingEl.hidden = true;
    listEl.hidden = false;
  }

  void navigate('0');
}
