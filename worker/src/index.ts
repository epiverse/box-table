// BoxTable token-exchange Worker.
// Browsers cannot POST to https://api.box.com/oauth2/token directly because
// Box's CORS implementation is keyed off a Bearer token (which the token
// endpoint doesn't have). This Worker performs that one POST on behalf of
// the SPA, keeping client_secret in env vars rather than the public bundle.

export interface Env {
  BOX_CLIENT_ID: string;
  BOX_CLIENT_SECRET: string;
  // Comma-separated allowlist (e.g. "http://localhost:5173,https://username.github.io").
  ALLOWED_ORIGIN: string;
}

interface ExchangeBody {
  grant_type: 'authorization_code' | 'refresh_token';
  code?: string;
  refresh_token?: string;
  redirect_uri?: string;
}

const TOKEN_URL = 'https://api.box.com/oauth2/token';

function pickAllowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('Origin');
  if (!origin) return null;
  const allowed = env.ALLOWED_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function corsHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    Vary: 'Origin',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = pickAllowedOrigin(req, env);

    if (req.method === 'OPTIONS') {
      // Preflight. If origin isn't allowed, omit the CORS headers — the
      // browser will block automatically.
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!origin) {
      return jsonResponse({ error: 'origin_not_allowed' }, 403, null);
    }

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, origin);
    }

    let body: ExchangeBody;
    try {
      body = (await req.json()) as ExchangeBody;
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400, origin);
    }

    const params = new URLSearchParams();
    params.set('client_id', env.BOX_CLIENT_ID);
    params.set('client_secret', env.BOX_CLIENT_SECRET);

    if (body.grant_type === 'authorization_code') {
      if (!body.code) return jsonResponse({ error: 'missing_code' }, 400, origin);
      params.set('grant_type', 'authorization_code');
      params.set('code', body.code);
      if (body.redirect_uri) params.set('redirect_uri', body.redirect_uri);
    } else if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) {
        return jsonResponse({ error: 'missing_refresh_token' }, 400, origin);
      }
      params.set('grant_type', 'refresh_token');
      params.set('refresh_token', body.refresh_token);
    } else {
      return jsonResponse({ error: 'unsupported_grant_type' }, 400, origin);
    }

    let upstream: Response;
    try {
      upstream = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });
    } catch {
      return jsonResponse({ error: 'upstream_unreachable' }, 502, origin);
    }

    // Pass through Box's response body verbatim (success or error). Strip
    // upstream Set-Cookie / caching headers and force CORS + no-store.
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  },
};
