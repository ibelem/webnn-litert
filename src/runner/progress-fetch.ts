/**
 * Reads a Response body as bytes while reporting progress, so a large model
 * download doesn't look identical to a hang on a slow connection — the same
 * "don't let a slow thing look broken" principle behind the delegation
 * receipts, applied to network transfer instead of inference.
 *
 * Falls back to a single non-streaming read if the body isn't a stream or
 * Content-Length is missing (some CDN responses omit it for chunked
 * transfers) — progress just won't be reported in that case.
 */
export interface DownloadProgress {
  loadedBytes: number;
  /** Undefined when the server didn't send Content-Length. */
  totalBytes: number | undefined;
}

export async function readWithProgress(
    response: Response, onProgress: (p: DownloadProgress) => void): Promise<Uint8Array> {
  const totalHeader = response.headers.get('content-length');
  const totalBytes = totalHeader ? Number(totalHeader) : undefined;

  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    onProgress({loadedBytes: buf.byteLength, totalBytes: buf.byteLength});
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;

  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    loadedBytes += value.byteLength;
    onProgress({loadedBytes, totalBytes});
  }

  const out = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function formatProgress(p: DownloadProgress): string {
  const loadedMb = (p.loadedBytes / 1_048_576).toFixed(1);
  if (p.totalBytes === undefined) return `${loadedMb} MB…`;
  const totalMb = (p.totalBytes / 1_048_576).toFixed(1);
  const pct = Math.round((p.loadedBytes / p.totalBytes) * 100);
  return `${loadedMb} / ${totalMb} MB (${pct}%)`;
}
