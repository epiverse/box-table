// Tiny toast for transient errors. The info bar in the bottom card shows
// long-form status; toasts are for things the user might miss while focused
// on the table.

let host: HTMLDivElement | null = null;

function ensureHost(): HTMLDivElement {
  if (host) return host;
  host = document.createElement('div');
  host.className = 'toast-host';
  document.body.appendChild(host);
  return host;
}

export function toast(message: string, kind: 'error' | 'info' = 'info'): void {
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.textContent = message;
  ensureHost().appendChild(el);
  // Force a layout so the entry transition runs.
  void el.offsetHeight;
  el.classList.add('toast--visible');
  setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 250);
  }, 4500);
}
