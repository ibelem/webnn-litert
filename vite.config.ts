import {resolve} from 'node:path';
import {defineConfig} from 'vite';

// import.meta.dirname, not __dirname: Vite 8 warns that __dirname is
// unsupported by the native config loader that becomes the default next major.
const here = import.meta.dirname;

// The same two headers as vercel.json. Without cross-origin isolation the
// browser withholds SharedArrayBuffer and threaded WASM silently degrades to
// single-threaded — which would quietly inflate every accelerated backend's
// advantage over the CPU baseline.
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  server: {headers: ISOLATION_HEADERS},
  preview: {headers: ISOLATION_HEADERS},

  build: {
    // Multi-page, not SPA. Vercel's cleanUrls turns debug.html into /debug,
    // so every page is a real prerendered document with its own <title> and
    // meta — no client-side router, no blank-flash before hydration.
    // M1 note: per-demo pages get generated into this input map from the
    // registry, so the home page and detail pages cannot diverge.
    rollupOptions: {
      input: {
        home: resolve(here, 'index.html'),
        debug: resolve(here, 'debug.html'),
      },
    },
    target: 'es2022',
    sourcemap: true,
  },
});
