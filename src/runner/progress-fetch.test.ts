import {describe, expect, it} from 'vitest';

import {formatProgress, readWithProgress} from './progress-fetch';

function streamedResponse(chunks: Uint8Array[], contentLength?: number): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  const headers = new Headers();
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  return new Response(stream, {headers});
}

describe('readWithProgress', () => {
  it('reassembles chunks into a single Uint8Array in order', async () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
    const bytes = await readWithProgress(streamedResponse(chunks, 5), () => {});
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
  });

  it('reports cumulative loaded bytes across chunks, and total from Content-Length', async () => {
    const chunks = [new Uint8Array(10), new Uint8Array(15)];
    const reports: Array<{loadedBytes: number; totalBytes: number | undefined}> = [];
    await readWithProgress(streamedResponse(chunks, 25), (p) => reports.push({...p}));
    expect(reports).toEqual([
      {loadedBytes: 10, totalBytes: 25},
      {loadedBytes: 25, totalBytes: 25},
    ]);
  });

  it('reports totalBytes as undefined when Content-Length is missing', async () => {
    const reports: Array<number | undefined> = [];
    await readWithProgress(
        streamedResponse([new Uint8Array(4)]), (p) => reports.push(p.totalBytes));
    expect(reports).toEqual([undefined]);
  });
});

describe('formatProgress', () => {
  it('formats loaded/total with a percentage when total is known', () => {
    expect(formatProgress({loadedBytes: 1_048_576, totalBytes: 2_097_152}))
        .toBe('1.0 / 2.0 MB (50%)');
  });

  it('falls back to loaded-only when total is unknown', () => {
    expect(formatProgress({loadedBytes: 1_048_576, totalBytes: undefined})).toBe('1.0 MB…');
  });
});
