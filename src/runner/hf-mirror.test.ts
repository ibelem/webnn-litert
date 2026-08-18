import {describe, expect, it} from 'vitest';

import {rewriteHost} from './hf-mirror';

describe('rewriteHost', () => {
  it('swaps only the origin, keeping the path unchanged', () => {
    const url = 'https://huggingface.co/webnn/torchvision-mobilenet-v2/resolve/main/tflite/model.tflite';
    expect(rewriteHost(url, 'https://hf-mirror.com'))
        .toBe('https://hf-mirror.com/webnn/torchvision-mobilenet-v2/resolve/main/tflite/model.tflite');
  });

  it('preserves a query string', () => {
    expect(rewriteHost('https://huggingface.co/a/b?download=true', 'https://hf-mirror.com'))
        .toBe('https://hf-mirror.com/a/b?download=true');
  });

  it('is a no-op in content when the target base equals the original origin', () => {
    const url = 'https://huggingface.co/x/y/resolve/main/f.tflite';
    expect(rewriteHost(url, 'https://huggingface.co')).toBe(url);
  });
});
