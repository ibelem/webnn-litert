/**
 * HuggingFace mirror fallback for model downloads — ported from web-ai-run's
 * `src/lib/engine/worker/shared/download.ts` (`getHfBase`), ONLY the parts
 * that apply here. Their file mixes this with OPFS caching we don't have;
 * this file is model-hosting selection alone.
 *
 * hf-mirror.com mirrors huggingface.co's full path structure verbatim, so
 * switching host is a plain origin swap — never a path rewrite.
 *
 * Scope note: model bytes are fetched on the MAIN THREAD in this project
 * (see stage.ts, debug/main.ts) and handed to the worker as an already-
 * fetched ArrayBuffer — unlike web-ai-run's classic inference worker, which
 * fetches models itself and therefore couldn't ESM-import this module (their
 * comment: "module workers don't support importScripts()", the same
 * constraint that made our own worker-entry.ts a classic worker). Our
 * worker never fetches from huggingface.co at all, so this module only ever
 * needs to be imported from main-thread code.
 */
import {fetchWithRetry, type RetryOptions} from './fetch-retry';

const HF_MAIN = 'https://huggingface.co';
const HF_MIRROR = 'https://hf-mirror.com';

/**
 * Reachability probe path. Deliberately one of our OWN registry's real model
 * files (mobilenetv2's, the smallest to route metadata for) rather than an
 * unrelated external test file — nothing outside this project needs to stay
 * alive for the probe to mean anything. HEAD doesn't transfer the body, so
 * file size is irrelevant to probe cost.
 */
const HF_TEST_PATH = '/webnn/torchvision-mobilenet-v2/resolve/main/tflite/model.tflite';

const HF_BASE_TTL_MS = 10 * 60 * 1000;
let cachedHfBase: string | null = null;
let cachedHfBaseAt = 0;

async function checkDomain(base: string, signal?: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  const combined = signal ? anySignal([signal, controller.signal]) : controller.signal;
  try {
    const res = await fetch(`${base}${HF_TEST_PATH}`, {
      method: 'HEAD',
      signal: combined,
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), {once: true});
  }
  return controller.signal;
}

/**
 * Resolves which HuggingFace host to use, cached for 10 minutes so every
 * model fetch on a page doesn't re-probe. Tries huggingface.co first, then
 * hf-mirror.com; falls back to huggingface.co if both probes fail, so the
 * real model fetch still gets attempted and produces a real error rather
 * than the probe silently swallowing a total outage.
 */
export async function getHfBase(signal?: AbortSignal): Promise<string> {
  if (cachedHfBase && Date.now() - cachedHfBaseAt < HF_BASE_TTL_MS) {
    return cachedHfBase;
  }
  for (const base of [HF_MAIN, HF_MIRROR]) {
    if (await checkDomain(base, signal)) {
      cachedHfBase = base;
      cachedHfBaseAt = Date.now();
      return base;
    }
  }
  cachedHfBase = HF_MAIN;
  cachedHfBaseAt = Date.now();
  return HF_MAIN;
}

/** Origin swap only — hf-mirror.com serves the identical path structure. */
export function rewriteHost(url: string, base: string): string {
  return new URL(new URL(url).pathname + new URL(url).search, base).toString();
}

/**
 * Fetches a huggingface.co model URL, preferring whichever host `getHfBase`
 * resolved. If that attempt still fails (fetchWithRetry already retried
 * transiently on that host) and the resolved base wasn't already the
 * mirror, retries once against hf-mirror.com as a defense-in-depth beyond
 * web-ai-run's design — the reachability probe only tests ONE fixed path,
 * so a host can be generally up while the specific model 404s or is
 * geo-blocked on that host alone.
 */
export async function fetchModelWithMirrorFallback(
    url: string, options: RetryOptions = {}): Promise<Response> {
  const base = await getHfBase(options.signal);
  const primaryUrl = rewriteHost(url, base);

  try {
    const res = await fetchWithRetry(primaryUrl, options);
    if (res.ok) return res;
    if (base === HF_MIRROR) return res; // already on the mirror; nothing left to fall back to
  } catch (e) {
    if (options.signal?.aborted) throw e;
    if (base === HF_MIRROR) throw e;
  }

  const mirrorUrl = rewriteHost(url, HF_MIRROR);
  return fetchWithRetry(mirrorUrl, options);
}
