import { defineConfig } from 'vitest/config.js';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Integration tests drive a real `astro build`, which takes noticeably
    // longer than a unit test — give the whole suite room to breathe.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
