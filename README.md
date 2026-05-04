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


## License

MIT — see [LICENSE](LICENSE).
