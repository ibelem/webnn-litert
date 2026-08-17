import {errorMessage} from './errors';

export interface RetryOptions {
  attempts?: number;
  /** Base delay; actual wait is `baseDelayMs * 2^attempt`. */
  baseDelayMs?: number;
  signal?: AbortSignal | undefined;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 300;

/**
 * Retries a transient async operation with exponential backoff. Covers the
 * CDN call sites (esm.sh dynamic import, jsDelivr wasm/pthread assets,
 * HuggingFace models) — a single flaky network moment during a version sweep
 * previously forced re-running the whole thing.
 *
 * Does NOT retry an abort (the caller cancelled on purpose). Retrying a
 * genuinely broken request (bad URL, 404 model) is the caller's job to avoid
 * by not calling this for those — see fetchWithRetry below, which stops early
 * on 4xx specifically because retrying won't change the outcome.
 */
export async function retryAsync<T>(
    fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {attempts = DEFAULT_ATTEMPTS, baseDelayMs = DEFAULT_BASE_DELAY_MS, signal} = options;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      lastError = e;
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw new Error(`failed after ${attempts} attempts: ${errorMessage(lastError)}`);
}

/**
 * `retryAsync` specialised for fetch: stops immediately on a 4xx (a bad
 * request or a 404 model URL won't improve on retry) but retries 5xx,
 * network failures, and anything else transient.
 */
export async function fetchWithRetry(
    url: string, options: RetryOptions = {}): Promise<Response> {
  const {signal} = options;
  return retryAsync(async () => {
    const res = await (signal ? fetch(url, {signal}) : fetch(url));
    if (!res.ok && res.status < 400) {
      // Unusual (e.g. a redirect chain the fetch spec didn't resolve) —
      // treat as retryable rather than silently accepting it as final.
      throw new Error(`unexpected non-ok, non-4xx status ${res.status} from ${url}`);
    }
    if (!res.ok && res.status >= 500) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return res; // ok, or a 4xx we deliberately return rather than retry
  }, options);
}
