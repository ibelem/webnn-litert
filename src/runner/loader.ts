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

/**
 * Idempotent per (version, mode). Changing either requires unloadLiteRt(),
 * which is why a single realm cannot host two modes at once.
 */
export async function ensureLiteRt(version: string, mode: LoadMode): Promise<LiteRt> {
  if (!isValidVersion(version)) {
    throw new Error(`Refusing to load "${version}" — must be strict semver (x.y.z).`);
  }

  if (loaded && loaded.version === version && loaded.mode === mode) {
    return loaded.mod;
  }

  if (loaded) {
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

  const root = wasmRoot(version);
  const mod = await import(/* @vite-ignore */ moduleUrl(version)) as LiteRt;

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
    const res = await fetch(`${root}/litert_wasm_threaded_internal.js`);
    if (!res.ok) throw new Error(`pthread host fetch ${res.status} from ${root}`);
    const source = await res.text();
    overrides.mainScriptUrlOrBlob =
        URL.createObjectURL(new Blob([source], {type: 'application/javascript'}));
  }

  (globalThis as {Module?: EmscriptenOverrides}).Module = overrides;
  try {
    const opts = mode === 'jspi' ? {jspi: true} : {threads: mode === 'threaded'};
    await mod.loadLiteRt(root, opts);
  } catch (e) {
    // Reloading an already-loaded runtime is not an error for our purposes.
    if (!/already load/i.test(errorMessage(e))) throw e;
  } finally {
    delete (globalThis as {Module?: EmscriptenOverrides}).Module;
  }

  loaded = {mod, version, mode};
  return mod;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
