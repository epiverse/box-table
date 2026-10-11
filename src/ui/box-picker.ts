// Box file browser, in the page's #box-dialog. Folder navigation with a
// breadcrumb; choosing a file BoxTable can open fires `onSelect` and closes
// the dialog. Other files show dimmed and disabled. The dialog reopens on
// the folder it was last in.

import { listFolder, type BoxFolderListing, type BoxItem } from '../box/api';
import { BoxAuthError } from '../box/auth';
import { extensionOf, isLoadableName } from '../loaders/format';
import { formatSize } from '../util';

export interface BoxFileSelection {
  id: string;
  name: string;
  size?: number;
}

export interface PickerOptions {
  onSelect: (selection: BoxFileSelection) => void;
  /** The Box session ended while browsing; the dialog has closed. */
  onAuthError: (error: BoxAuthError) => void;
}

const ROOT_FOLDER = '0';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  folder: ['M3.5 7.5a2 2 0 0 1 2-2h3.7l2 2.25h7.3a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z'],
  file: [
    'M6.5 3.5h7.25L18.5 8.25V19a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z',
    'M13.5 3.5V8.5h5',
  ],
  chevron: ['m9.5 6.5 5.5 5.5-5.5 5.5'],
} as const;

function icon(name: keyof typeof ICONS, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function compareItems(a: BoxItem, b: BoxItem): number {
  // Folders first, then files. Within each group, by name (case-insensitive).
  if (a.type !== b.type) {
    if (a.type === 'folder') return -1;
    if (b.type === 'folder') return 1;
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// The dialog is wired once; each open swaps in its own callbacks.
let wired = false;
let current: PickerOptions | null = null;
let lastFolderId = ROOT_FOLDER;
// Each navigation's number: a folder that answers after a later click on
// another one is dropped.
let navigation = 0;

function elements(): {
  dialog: HTMLDialogElement;
  crumbs: HTMLElement;
  list: HTMLElement;
  note: HTMLElement;
} {
  return {
    dialog: document.getElementById('box-dialog') as HTMLDialogElement,
    crumbs: document.getElementById('box-crumbs')!,
    list: document.getElementById('box-list')!,
    note: document.getElementById('box-note')!,
  };
}

function wire(): void {
  if (wired) return;
  wired = true;
  const { dialog } = elements();
  document.getElementById('box-dialog-close')!.addEventListener('click', () => dialog.close());
  // A click on the backdrop lands on the <dialog> itself: its content fills it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    navigation++;
    current = null;
  });
}

export function openBoxPicker(opts: PickerOptions): void {
  wire();
  current = opts;
  const { dialog } = elements();
  dialog.showModal();
  void navigate(lastFolderId);
}

function choose(item: BoxItem): void {
  const opts = current;
  elements().dialog.close();
  const selection: BoxFileSelection = { id: item.id, name: item.name };
  if (item.size !== undefined) selection.size = item.size;
  opts?.onSelect(selection);
}

function showStatus(message: string, { error = false, retry = '' } = {}): void {
  const { list } = elements();
  const status = document.createElement('div');
  status.className = error ? 'box-status box-status--error' : 'box-status';
  status.append(span('', message));
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--quiet';
    button.textContent = 'Try again';
    button.addEventListener('click', () => void navigate(retry));
    status.append(button);
  }
  list.replaceChildren(status);
}

async function navigate(folderId: string): Promise<void> {
  const nav = ++navigation;
  const { dialog, list } = elements();
  list.setAttribute('aria-busy', 'true');
  showStatus('Loading…');

  let listing: BoxFolderListing;
  try {
    listing = await listFolder(folderId);
  } catch (err) {
    if (nav !== navigation) return;
    list.removeAttribute('aria-busy');
    if (err instanceof BoxAuthError) {
      const opts = current;
      dialog.close();
      opts?.onAuthError(err);
      return;
    }
    // A folder that went away (or lost its sharing) since last time: start
    // over at the top next time.
    if (folderId !== ROOT_FOLDER) lastFolderId = ROOT_FOLDER;
    const message = err instanceof Error ? err.message : 'Failed to load the folder.';
    showStatus(message, { error: true, retry: folderId });
    return;
  }
  if (nav !== navigation) return;
  lastFolderId = folderId;
  renderCrumbs(listing);
  renderItems(listing);
  list.removeAttribute('aria-busy');
}

function renderCrumbs(listing: BoxFolderListing): void {
  const { crumbs } = elements();
  crumbs.replaceChildren();
  listing.pathCollection.forEach((crumb, i) => {
    if (i > 0) crumbs.append(icon('chevron', 'crumb-sep'));
    const here = crumb.id === listing.folderId;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'crumb';
    button.textContent = crumb.name;
    if (here) button.setAttribute('aria-current', 'location');
    else button.addEventListener('click', () => void navigate(crumb.id));
    crumbs.append(button);
  });
}

function renderItems(listing: BoxFolderListing): void {
  const { list, note } = elements();
  const items = listing.items.filter((item) => item.type !== 'web_link').sort(compareItems);
  if (items.length === 0) {
    showStatus('This folder is empty.');
  } else {
    const ul = document.createElement('ul');
    ul.className = 'box-items';
    for (const item of items) {
      const isFolder = item.type === 'folder';
      const loadable = !isFolder && isLoadableName(item.name);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = isFolder ? 'box-item box-item--folder' : 'box-item';
      const meta = isFolder
        ? formatDate(item.modified_at)
        : [item.size !== undefined ? formatSize(item.size) : '', formatDate(item.modified_at)]
            .filter(Boolean)
            .join(' · ');
      button.append(
        icon(isFolder ? 'folder' : 'file', 'box-item-icon'),
        span('box-item-name', item.name),
      );
      if (loadable) button.append(span('chip-format', extensionOf(item.name)));
      button.append(span('box-item-meta', meta));

      if (isFolder) {
        button.addEventListener('click', () => void navigate(item.id));
      } else if (loadable) {
        button.addEventListener('click', () => choose(item));
      } else {
        button.disabled = true;
        button.title = 'Not a file BoxTable can open';
      }
      const li = document.createElement('li');
      li.append(button);
      ul.append(li);
    }
    list.replaceChildren(ul);
  }
  note.textContent = listing.hasMore
    ? `Showing the first ${listing.items.length.toLocaleString()} items of this folder.`
    : 'CSV, TSV, JSON, Parquet and Excel files can be opened.';
}
