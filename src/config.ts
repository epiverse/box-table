// Public Box OAuth client ID. Safe to embed in the browser bundle —
// `client_secret` lives only in the Cloudflare Worker's env vars.
export const BOX_CLIENT_ID = '627lww8un9twnoa8f9rjvldf7kb56q1m';

// Cloudflare Worker that exchanges an OAuth authorization code for an access
// token (and refreshes tokens). Override at build time with `VITE_WORKER_URL`
// if the worker subdomain differs from the default. Empty string disables Box
// connectivity — the app still works for File / URL loads.
export const WORKER_URL: string =
  (import.meta.env.VITE_WORKER_URL as string | undefined) ?? '';

// Box OAuth endpoints.
export const BOX_AUTHORIZE_URL = 'https://account.box.com/api/oauth2/authorize';
export const BOX_API_BASE = 'https://api.box.com/2.0';

// Spreadsheet-like extensions the picker highlights as loadable.
export const SUPPORTED_EXTENSIONS = ['csv', 'tsv', 'xlsx', 'xls', 'json', 'ndjson', 'jsonl', 'parquet'] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

// The redirect URI sent to Box must match (a) the value in the Box developer
// console and (b) the value sent in the token-exchange call. We always send
// `${origin}${BASE_URL}` so the same code works in dev (localhost:5173) and
// production (username.github.io/box-table).
export function getRedirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}
