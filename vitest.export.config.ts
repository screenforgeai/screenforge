import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/export/**/*.test.ts'],
    fileParallelism: false,
    maxConcurrency: 1,
    hookTimeout: 240_000,
    testTimeout: 240_000,
  },
  resolve: {
    alias: {
      src: path.resolve(__dirname, 'src'),
    },
  },
});
