import {describe, expect, it} from 'vitest';

import {DEMOS, findDemo} from './registry';

describe('findDemo', () => {
  it('finds an existing demo by slug', () => {
    expect(findDemo('mobilenetv2')?.title).toBe('MobileNetV2');
  });

  it('returns undefined for an unknown slug', () => {
    expect(findDemo('does-not-exist')).toBeUndefined();
  });
});

describe('DEMOS registry integrity', () => {
  it('has a unique slug per entry', () => {
    const slugs = DEMOS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('gives every demo at least one backend', () => {
    for (const demo of DEMOS) {
      expect(demo.backends.length).toBeGreaterThan(0);
    }
  });

  it('gives every model URL an https HuggingFace origin', () => {
    for (const demo of DEMOS) {
      expect(demo.model.url).toMatch(/^https:\/\/huggingface\.co\//);
    }
  });
});
