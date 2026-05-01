import { defineConfig } from 'vite';

// `base` must match the GitHub Pages subpath. Override at build time with
// VITE_BASE=/some-other-path/ if the repo gets renamed.
const base = process.env.VITE_BASE ?? '/box-table/';

export default defineConfig({
  base,
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5173,
  },
  optimizeDeps: {
    // SheetJS ships as CommonJS; let Vite pre-bundle it on first dev run.
    include: ['xlsx'],
    // data-table resolves its DuckDB worker via `new URL("assets/worker-*.js",
    // import.meta.url)`. Pre-bundling moves the JS into .vite/deps/ but does
    // not copy the sibling `assets/` folder, so the worker URL 404s in dev.
    // Serving the package straight from node_modules keeps the URL valid.
    exclude: ['@jeyabbalas/data-table'],
  },
});
