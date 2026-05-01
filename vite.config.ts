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
  // SheetJS ships as CommonJS; let Vite pre-bundle it on first dev run.
  optimizeDeps: {
    include: ['xlsx'],
  },
});
