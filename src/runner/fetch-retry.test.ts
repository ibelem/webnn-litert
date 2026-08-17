import {afterEach, describe, expect, it, vi} from 'vitest';

import {fetchWithRetry, retryAsync} from './fetch-retry';

describe('retryAsync', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the result immediately on first success, no retry', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(retryAsync(fn, {baseDelayMs: 0})).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and succeeds within the attempt budget', async () => {
    const fn = vi.fn()
        .mockRejectedValueOnce(new Error('flaky'))
        .mockResolvedValueOnce('ok');
    await expect(retryAsync(fn, {baseDelayMs: 0, attempts: 3})).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(retryAsync(fn, {baseDelayMs: 0, attempts: 3})).rejects.toThrow(/3 attempts/);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry an AbortError — the caller cancelled on purpose', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    const fn = vi.fn().mockRejectedValue(abortError);
    await expect(retryAsync(fn, {baseDelayMs: 0, attempts: 3})).rejects.toBe(abortError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('checks the signal before each attempt, not just the first', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error('fails, then caller aborts'));
    });
    await expect(retryAsync(fn, {baseDelayMs: 0, attempts: 5, signal: controller.signal}))
        .rejects.toThrow();
    // First call runs (signal wasn't aborted yet), aborts inside, second
    // attempt's pre-check should stop it well before the attempt budget.
    expect(fn.mock.calls.length).toBeLessThan(5);
  });
});

describe('fetchWithRetry', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a 4xx response immediately without retrying', async () => {
    const response = new Response('not found', {status: 404});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const result = await fetchWithRetry('https://example.test/x', {baseDelayMs: 0});
    expect(result.status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx response and succeeds if a later attempt returns ok', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('err', {status: 503}))
        .mockResolvedValueOnce(new Response('ok', {status: 200}));
    const result = await fetchWithRetry('https://example.test/x', {baseDelayMs: 0});
    expect(result.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
