/**
 * Loads LiteRT.js from CDN at runtime so any published version can be
 * exercised without a rebuild. Pattern ported from web-ai-run's
 * inference.worker.ts.
 *
 * `@litertjs/core` is a devDependency for TYPES ONLY. It is never imported at
 * runtime — hence `import type` below. Do not add a value import: that would
 * bundle a fixed version and defeat `&litertjs=`.
 */
import type * as LiteRtCore from '@litertjs/core';

import {errorMessage} from './errors';
import {fetchWithRetry, retryAsync} from './fetch-retry';

export type LiteRt = typeof LiteRtCore;

export const DEFAULT_LITERT_VERSION = '2.5.3';

/**
 * The version string is interpolated into a module URL, which makes it
 * untrusted input: `1.0.0/../../@attacker/pkg` walks out of the package and
 * import() would execute whatever resolves. Validate before building the URL,
 * never after.
 */
const VERSION_RE = /^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/;

export function isValidVersion(v: string): boolean {
  return VERSION_RE.test(v);
}

/** esm.sh resolves bare specifiers into real ESM for the module graph. */
const moduleUrl = (v: string) => `https://esm.sh/@litertjs/core@${v}`;
/** jsDelivr serves the raw wasm/ assets. Not interchangeable with esm.sh. */
const wasmRoot = (v: string) => `https://cdn.jsdelivr.net/npm/@litertjs/core@${v}/wasm`;

/** Load mode is derived from the backend and is module-global per realm. */
export type LoadMode = 'jspi' | 'threaded' | 'standard';

/**
 * Emscripten reads `globalThis.Module` for overrides at init. Two concurrent
 * loads in one realm would race on it — one more reason M1 gives each backend
 * its own worker.
 */
interface EmscriptenOverrides {
  locateFile(path: string): string;
  mainScriptUrlOrBlob?: string;
}

let loaded: {mod: LiteRt; version: string; mode: LoadMode} | null = null;

/** The most recently created pthread-host blob URL, so it can be revoked
 *  before the next one is created. Without this, each reload into 'threaded'
 *  mode leaks one blob for the tab's lifetime — invisible on a demo page that
 *  loads once, but real on /debug, which reloads repeatedly during a version
 *  sweep. */
let lastThreadedBlobUrl: string | null = null;

function revokeLastThreadedBlobUrl(): void {
  if (lastThreadedBlobUrl) {
    URL.revokeObjectURL(lastThreadedBlobUrl);
    lastThreadedBlobUrl = null;
  }
}

/**
 * Idempotent per (version, mode). Changing either requires unloadLiteRt(),
 * which is why a single realm cannot host two modes at once.
 *
 * `signal` bounds both the compile-adjacent CDN fetches and the load call
 * itself — a hung driver or a dead CDN must not leave the caller waiting
 * forever with no way to cancel.
 */
export async function ensureLiteRt(
    version: string, mode: LoadMode, signal?: AbortSignal,
    onLog?: (message: string) => void): Promise<LiteRt> {
  if (!isValidVersion(version)) {
    throw new Error(`Refusing to load "${version}" — must be strict semver (x.y.z).`);
  }

  if (loaded && loaded.version === version && loaded.mode === mode) {
    return loaded.mod;
  }

  if (loaded) {
    onLog?.(`Reloading LiteRT WASM (${loaded.version} → ${version}, ${loaded.mode} → ${mode})...`);
    const unload = (loaded.mod as {unloadLiteRt?: () => void}).unloadLiteRt;
    if (typeof unload === 'function') {
      try {
        unload();
      } catch {
        // Best effort. A failed unload is not worth aborting the run over.
      }
    }
    loaded = null;
  }

  onLog?.(`Loading LiteRT WASM (${mode})...`);
  const root = wasmRoot(version);

  let mod: LiteRt;
  try {
    // Retried: a single flaky network moment during a version sweep
    // previously forced re-running the whole sweep. Not retried past an abort
    // (retryAsync re-throws AbortError immediately) or a genuine 404/bad
    // version — those fail the same on every attempt, so the retries would
    // just add latency to an outcome that was never going to change.
    mod = await retryAsync(
        async () => await import(/* @vite-ignore */ moduleUrl(version)) as LiteRt,
        {signal});
  } catch (e) {
    // A CDN outage or network failure is an environment fault, not a bug in
    // this code — surface it as one rather than letting an opaque import()
    // rejection propagate.
    throw new Error(`Failed to load @litertjs/core@${version} from esm.sh: ${errorMessage(e)}`);
  }

  // Older published builds lack exports. Probe, don't assume.
  if (typeof mod.loadLiteRt !== 'function') {
    throw new Error(`@litertjs/core@${version} has no loadLiteRt export.`);
  }

  // loadLiteRt(root) alone does NOT redirect Emscripten's own .wasm fetches;
  // locateFile is what actually points the runtime at the CDN.
  const overrides: EmscriptenOverrides = {locateFile: (path) => `${root}/${path}`};

  if (mode === 'threaded') {
    // A cross-origin script cannot be a pthread host under COEP, so re-host it
    // same-origin as a blob. This is what makes threaded WASM work off a CDN.
    const pthreadUrl = `${root}/litert_wasm_threaded_internal.js`;
    const res = await fetchWithRetry(pthreadUrl, {signal});
    if (!res.ok) throw new Error(`pthread host fetch ${res.status} from ${pthreadUrl}`);
    const source = await res.text();
    revokeLastThreadedBlobUrl();
    const url = URL.createObjectURL(new Blob([source], {type: 'application/javascript'}));
    overrides.mainScriptUrlOrBlob = url;
    lastThreadedBlobUrl = url;
  }

  (globalThis as {Module?: EmscriptenOverrides}).Module = overrides;
  try {
    const opts = mode === 'jspi' ? {jspi: true} : {threads: mode === 'threaded'};
    await withTimeout(mod.loadLiteRt(root, opts), signal, 'loadLiteRt');
  } catch (e) {
    // Reloading an already-loaded runtime is not an error for our purposes.
    if (!/already load/i.test(errorMessage(e))) throw e;
  } finally {
    delete (globalThis as {Module?: EmscriptenOverrides}).Module;
  }

  loaded = {mod, version, mode};
  return mod;
}

/**
 * Rejects with a named AbortError if `signal` fires before `promise` settles.
 * A driver hang during compile must not leave the page stuck on "measuring…"
 * forever with no way out.
 */
export function withTimeout<T>(
    promise: Promise<T>, signal: AbortSignal | undefined, label: string): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException(`${label} aborted`, 'AbortError'));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException(`${label} aborted`, 'AbortError'));
    signal.addEventListener('abort', onAbort, {once: true});
    promise
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export {errorMessage};
