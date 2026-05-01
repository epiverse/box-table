// Box OAuth 2.0 client (authorization code flow).
// All token storage in sessionStorage so credentials never outlive the tab.

import {
  BOX_AUTHORIZE_URL,
  BOX_CLIENT_ID,
  WORKER_URL,
  getRedirectUri,
} from '../config';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  // Wall-clock ms when the access token expires.
  expiresAt: number;
}

const SESSION_STATE_KEY = 'boxtable.oauth.state';
const SESSION_TOKENS_KEY = 'boxtable.oauth.tokens';
// Skew accounts for clock drift + the time it takes to actually use the token.
const REFRESH_SKEW_MS = 60_000;

export class BoxAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'BoxAuthError';
  }
}

function readTokens(): StoredTokens | null {
  try {
    const raw = sessionStorage.getItem(SESSION_TOKENS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTokens;
    if (!parsed.accessToken || typeof parsed.expiresAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeTokens(tokens: StoredTokens): void {
  sessionStorage.setItem(SESSION_TOKENS_KEY, JSON.stringify(tokens));
}

function clearTokens(): void {
  sessionStorage.removeItem(SESSION_TOKENS_KEY);
  sessionStorage.removeItem(SESSION_STATE_KEY);
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function exchange(body: Record<string, string>): Promise<TokenResponse> {
  if (!WORKER_URL) {
    throw new BoxAuthError(
      'Box token-exchange worker URL is not configured. Set VITE_WORKER_URL or update src/config.ts.',
    );
  }
  let res: Response;
  try {
    res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new BoxAuthError('Network error contacting token-exchange worker.', err);
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new BoxAuthError(
      `Token exchange failed (${res.status} ${res.statusText}). ${detail.slice(0, 200)}`,
    );
  }
  return (await res.json()) as TokenResponse;
}

function persistFromResponse(token: TokenResponse): StoredTokens {
  const tokens: StoredTokens = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
  writeTokens(tokens);
  return tokens;
}

export function isConfigured(): boolean {
  return WORKER_URL.length > 0;
}

export function isAuthenticated(): boolean {
  return readTokens() !== null;
}

// Redirects away from the current page; never returns.
export function beginAuth(): void {
  if (!isConfigured()) {
    throw new BoxAuthError(
      'Box is not available — the token-exchange worker is not configured.',
    );
  }
  const state = randomState();
  sessionStorage.setItem(SESSION_STATE_KEY, state);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: BOX_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    state,
  });
  window.location.assign(`${BOX_AUTHORIZE_URL}?${params.toString()}`);
}

// Inspects window.location for an OAuth callback. If found, validates state,
// exchanges the code, and scrubs the URL. Returns true if a callback was
// handled (caller should re-render auth-aware UI).
export async function handleCallback(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  if (!code && !error) return false;

  // Always scrub the OAuth params from the URL, even on failure, so they
  // don't leak into bookmarks/history.
  const scrubbed = window.location.pathname + window.location.hash;
  window.history.replaceState(null, '', scrubbed);

  if (error) {
    throw new BoxAuthError(`Box authorization denied: ${error}`);
  }
  if (!code) return false;

  const expectedState = sessionStorage.getItem(SESSION_STATE_KEY);
  sessionStorage.removeItem(SESSION_STATE_KEY);
  if (!expectedState || expectedState !== state) {
    throw new BoxAuthError('OAuth state mismatch — refusing to exchange the code.');
  }

  const token = await exchange({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
  });
  persistFromResponse(token);
  return true;
}

// Returns a usable access token, refreshing transparently if the cached one
// is within REFRESH_SKEW_MS of expiry.
export async function getAccessToken(): Promise<string> {
  const tokens = readTokens();
  if (!tokens) throw new BoxAuthError('Not authenticated.');
  if (tokens.expiresAt - Date.now() > REFRESH_SKEW_MS) return tokens.accessToken;
  return refreshAccessToken();
}

export async function refreshAccessToken(): Promise<string> {
  const tokens = readTokens();
  if (!tokens) throw new BoxAuthError('Not authenticated.');
  let refreshed: TokenResponse;
  try {
    refreshed = await exchange({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    });
  } catch (err) {
    // Refresh failed — likely a revoked / rotated refresh token. Force re-auth.
    clearTokens();
    throw err instanceof BoxAuthError
      ? err
      : new BoxAuthError('Token refresh failed.', err);
  }
  return persistFromResponse(refreshed).accessToken;
}

export function disconnect(): void {
  clearTokens();
}
