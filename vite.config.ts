import {defineConfig} from 'vite';

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

  worker: {
    // LiteRT's Emscripten WASM loader calls importScripts() internally,
    // which module-type workers reject outright. `format: 'iife'` is what
    // makes Vite's `?worker` import produce a classic worker CORRECTLY in
    // both `vite dev` and `vite build` — the raw `new Worker(new URL(...))`
    // pattern (no `?worker` suffix) only gets IIFE bundling at build time;
    // in dev it serves untransformed ESM into a classic script context and
    // throws "Cannot use import statement outside a module". See
    // src/demos/depth-anything/stage.ts for the `?worker` import.
    format: 'iife',
  },

  build: {
    // Multi-page, not SPA. Vercel's cleanUrls turns debug.html into /debug,
    // so every page is a real prerendered document with its own <title> and
    // meta — no client-side router, no blank-flash before hydration.
    // M1 note: per-demo pages get generated into this input map from the
    // registry, so the home page and detail pages cannot diverge.
    rollupOptions: {
      // Relative to Vite's project root. Deliberately NOT node:path +
      // import.meta.dirname: that needs @types/node, which this config would
      // then depend on transitively. The Vercel build failed on exactly that
      // (TS2591 / TS2339) while the local build passed, because a transitive
      // @types/node happened to be present locally. Strings need nothing.
      input: {
        home: 'index.html',
        debug: 'debug.html',
        'depth-anything': 'depth-anything.html',
        'selfie-multiclass': 'selfie-multiclass.html',
        mobilenetv2: 'mobilenetv2.html',
        'efficientvit-seg': 'efficientvit-seg.html',
        'real-esrgan': 'real-esrgan.html',
        'efficientvit-live': 'efficientvit-live.html',
      },
    },
    target: 'es2022',
    sourcemap: true,
  },
});
