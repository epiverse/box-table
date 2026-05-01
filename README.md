# BoxTable

Privacy-first, client-side spreadsheet viewer. Load CSV / JSON / Parquet /
XLSX from a local file, a public URL, or your Box account, and explore them
in an interactive table powered by [`@jeyabbalas/data-table`](https://github.com/jeyabbalas/data-table).

All parsing happens in the browser via DuckDB-WASM (and SheetJS for XLSX).
Your data never leaves your machine — the only network call BoxTable makes
on its own behalf is the OAuth token exchange that lets you connect to
your Box account, and that goes through a tiny Cloudflare Worker that
holds the OAuth `client_secret` so it stays out of the public bundle.

## Quickstart

```bash
npm install
npm run dev
```

Open `http://localhost:5173/box-table/`. You can use the File and URL
loaders right away; Box requires the one-time setup below.

## Setup for Box connectivity

You need two things wired up: the **Box developer app** (where the OAuth
redirect URIs and CORS allowlist live) and the **Cloudflare Worker** (the
token-exchange proxy).

### 1. Configure the Box app

In the [Box Developer Console](https://app.box.com/developers/console),
open the app this repo is wired to (`627lww8un9twnoa8f9rjvldf7kb56q1m`):

- **Configuration → OAuth 2.0 Redirect URIs**: add
  - `http://localhost:5173/box-table/` (local dev)
  - `https://<your-username>.github.io/box-table/` (production)
- **Configuration → CORS Domains**: add
  - `http://localhost:5173`
  - `https://<your-username>.github.io`
- **Configuration → Application Scopes**: ensure "Read all files and folders
  stored in Box" is enabled.

### 2. Deploy the Cloudflare Worker

The Worker handles the one OAuth call the browser cannot make directly. See
[`worker/README.md`](worker/README.md) for full details. Short version:

```bash
cd worker
npm install
wrangler login
wrangler secret put BOX_CLIENT_ID            # 627lww8un9twnoa8f9rjvldf7kb56q1m
wrangler secret put BOX_CLIENT_SECRET        # <the secret>
wrangler secret put ALLOWED_ORIGIN           # http://localhost:5173,https://<user>.github.io
wrangler deploy
```

`wrangler deploy` prints the worker URL — copy it.

### 3. Tell the SPA where the Worker lives

For local dev:

```bash
VITE_WORKER_URL=https://boxtable-token.<account>.workers.dev npm run dev
```

For GitHub Pages production: add a repo variable named `VITE_WORKER_URL`
under **Settings → Secrets and variables → Actions → Variables** with the
worker URL. The deploy workflow reads it on each build.

If `VITE_WORKER_URL` is unset, the rest of BoxTable still works — the
"Connect to Box" button just stays disabled with an explanatory tooltip.

## Deploy to GitHub Pages

1. Push the repo to GitHub. Default branch should be `main`.
2. **Settings → Pages → Build and deployment**: set **Source = GitHub Actions**.
3. Optionally add `VITE_WORKER_URL` repo variable (see above).
4. Push. The `Deploy to GitHub Pages` workflow runs on push to `main` and
   publishes `dist/` to Pages.

If the repo is named something other than `box-table`, also set a repo
variable `VITE_BASE` to `/<repo-name>/` (with leading and trailing slash).
The Box redirect URIs and CORS domains in step 1 must match.

## Privacy

- File contents stay in your browser — they are parsed by DuckDB-WASM (and
  SheetJS for XLSX), not uploaded anywhere.
- Box content is downloaded from Box directly into your browser.
- Box OAuth tokens live only in `sessionStorage` (cleared when you close
  the tab).
- The Cloudflare Worker only handles the OAuth code-for-token swap. It does
  not see file contents and does not log request bodies or token responses.
- `client_secret` lives in the Worker's env vars, never in the browser.
- No analytics, no third-party scripts.

## Project layout

```
src/                  Browser SPA (TypeScript, Vite)
  main.ts             Entry point + library wiring
  config.ts           BOX_CLIENT_ID, WORKER_URL, etc.
  box/                OAuth + Box API client
  loaders/            File / URL / Box / XLSX → PreparedSource
  ui/                 Brand, picker modal, toasts
  style.css           Page chrome (light/dark)
worker/               Cloudflare Worker (OAuth token exchange)
.github/workflows/    GitHub Pages deploy
```

## License

MIT — see [LICENSE](LICENSE).
