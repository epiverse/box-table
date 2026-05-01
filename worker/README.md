# BoxTable token-exchange Worker

Tiny Cloudflare Worker that performs the OAuth code-for-token swap on behalf
of the BoxTable browser app. Exists because Box's `/oauth2/token` endpoint
does not honor browser CORS preflights.

## Why not in the browser?

Box keys CORS off a Bearer token to identify which app's whitelist to apply.
The token endpoint doesn't carry one, so it never sets
`Access-Control-Allow-Origin` and the browser blocks the response. A 30-line
Worker is the simplest fix and has the side benefit of keeping
`client_secret` out of the public bundle.

## Deploy

Requires Cloudflare account + `wrangler` (`npm install -g wrangler`).

```bash
cd worker
npm install
wrangler login

# Set secrets (paste each value when prompted):
wrangler secret put BOX_CLIENT_ID
wrangler secret put BOX_CLIENT_SECRET
wrangler secret put ALLOWED_ORIGIN   # e.g. http://localhost:5173,https://USER.github.io

wrangler deploy
```

`wrangler deploy` prints the worker URL (e.g.
`https://boxtable-token.<account>.workers.dev`). Put it in:

- the BoxTable build env: `VITE_WORKER_URL=https://boxtable-token.<account>.workers.dev`
  (or the `WORKER_URL` constant in `../src/config.ts`).
- the Box developer console's CORS allowlist is NOT needed here — the
  browser hits the Worker, not Box, for the token swap.

## Local dev

```bash
cd worker
wrangler dev --local --port 8787
```

Then point `VITE_WORKER_URL=http://localhost:8787` while running
`npm run dev` in the project root.
