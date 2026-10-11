/**
 * Text for the status bar's HTML. A shared `?url=` link, a file name, a
 * column name or an error message is not the page's to trust.
 */
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
}

export function formatSize(bytes: number): string {
  if (bytes >= 2 ** 30) return `${(bytes / 2 ** 30).toFixed(1)} GB`;
  if (bytes >= 2 ** 20) return `${(bytes / 2 ** 20).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 2 ** 10)} KB`;
}
