import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    // Without this, Vitest also tries to run reference/webnn-developer-preview's
    // own __tests__ suite (vendored, read-only, not ours to run or fix).
    include: ['src/**/*.test.ts'],
  },
});
