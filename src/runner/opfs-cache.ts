/**
 * OPFS-backed model cache, ported from web-ai-run's getFromOPFS/saveToOPFS
 * (reference/web-ai-run/.../inference.worker.ts). Runs on the MAIN THREAD,
 * same scope note as hf-mirror.ts — model bytes are always fetched there,
 * never in the worker.
 *
 * A repeat visit to a demo page reads the model straight from OPFS instead
 * of re-downloading it, so `loadMs` below is near-instant on a cache hit —
 * separate from LiteRT's own `load_and_compile_ms` (measure.ts), which only
 * times the WASM-side parse + compile of bytes already in memory.
 *
 * Cache key is the filename plus the response's ETag, so a model update
 * upstream naturally invalidates the old entry instead of serving stale
 * bytes forever.
 */
import {fetchModelWithMirrorFallback, getHfBase, rewriteHost} from './hf-mirror';
import {readWithProgress, type DownloadProgress} from './progress-fetch';

const OPFS_DIR = 'models';

function sanitizeFileName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '--');
}

async function getFromOpfs(fileName: string): Promise<ArrayBuffer | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR, {create: true});
    const handle = await dir.getFileHandle(fileName);
    return await (await handle.getFile()).arrayBuffer();
  } catch {
    return null;
  }
}

async function saveToOpfs(fileName: string, data: ArrayBuffer): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(OPFS_DIR, {create: true});
  const handle = await dir.getFileHandle(fileName, {create: true});
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

export interface ModelLoadResult {
  bytes: ArrayBuffer;
  /** Wall-clock time to make the bytes available: an OPFS read, or a
   *  network download plus the cache write. */
  loadMs: number;
  fromCache: boolean;
}

/**
 * Fetches model bytes through an OPFS cache. `navigator.storage` is
 * unavailable in some contexts (private browsing, storage pressure) — a
 * failed cache read or write is never fatal, it just falls back to
 * fetching every time.
 */
export async function loadModelBytesCached(
    url: string,
    onLog?: (message: string) => void,
    onProgress?: (p: DownloadProgress) => void,
    ): Promise<ModelLoadResult> {
  const started = performance.now();
  const fileName = url.split('/').pop() ?? url;

  let etag = '';
  let expectedSize = 0;
  try {
    const base = await getHfBase();
    const head = await fetch(rewriteHost(url, base), {method: 'HEAD'});
    if (head.ok) {
      etag = (head.headers.get('etag') ?? '').replace(/"/g, '');
      expectedSize = Number(head.headers.get('content-length') ?? 0);
    }
  } catch {
    // No HEAD support, or a network hiccup — fall through to a full GET.
  }

  const cacheKey = etag ? sanitizeFileName(`${fileName}--${etag}`) : null;
  if (cacheKey) {
    const cached = await getFromOpfs(cacheKey);
    if (cached && (expectedSize === 0 || cached.byteLength === expectedSize)) {
      const loadMs = performance.now() - started;
      onLog?.(
          `read ${fileName} from OPFS cache — ${(cached.byteLength / 1_048_576).toFixed(1)} MB ` +
          `in ${loadMs.toFixed(0)}ms`);
      return {bytes: cached, loadMs, fromCache: true};
    }
  }

  onLog?.(`downloading ${fileName}…`);
  const downloadStarted = performance.now();
  const res = await fetchModelWithMirrorFallback(url);
  if (!res.ok) throw new Error(`model fetch ${res.status} — ${url}`);
  const data = await readWithProgress(res, (p) => onProgress?.(p));
  const bytes = data.buffer as ArrayBuffer;
  const downloadMs = performance.now() - downloadStarted;
  onLog?.(
      `downloaded ${fileName} — ${(bytes.byteLength / 1_048_576).toFixed(1)} MB ` +
      `in ${downloadMs.toFixed(0)}ms`);

  if (cacheKey) {
    try {
      await saveToOpfs(cacheKey, bytes);
      onLog?.(`saved ${fileName} to OPFS cache`);
    } catch {
      // Best effort — quota or private-browsing failures don't fail the run.
    }
  }

  return {bytes, loadMs: performance.now() - started, fromCache: false};
}
