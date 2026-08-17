/*
 * Zero-dependency static server for the M0 spike.
 *
 * Exists only to set COOP/COEP, which the browser requires before it will hand
 * out SharedArrayBuffer (threaded WASM). Also lets us verify early that the
 * cross-origin fetches this project depends on -- models from HuggingFace, the
 * runtime from esm.sh, wasm from jsDelivr -- all survive `require-corp`.
 * That is Open Question 5 in the design doc, answered here for free.
 *
 *   node spike/serve.mjs
 *   -> http://localhost:8099
 */

import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 8099;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

createServer(async (req, res) => {
  // Cross-origin isolation. Without both of these, crossOriginIsolated is
  // false and threaded WASM silently falls back to single-threaded.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cache-Control', 'no-store');

  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = normalize(urlPath === '/' ? 'index.html' : urlPath.slice(1));

  // Don't serve outside the spike directory.
  if (rel.startsWith('..')) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, {'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream'});
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => {
  console.log(`spike harness  ->  http://localhost:${PORT}`);
  console.log('open in Chrome M153+ or Canary');
});
