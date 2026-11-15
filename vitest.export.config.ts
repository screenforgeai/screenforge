import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Software WebGL (GPU-less CI) renders several times slower.
const TIMEOUT_MS = process.env.SCREENFORGE_SOFTWARE_GL === '1' ? 1_200_000 : 240_000;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/export/**/*.test.ts'],
    fileParallelism: false,
    maxConcurrency: 1,
    hookTimeout: TIMEOUT_MS,
    testTimeout: TIMEOUT_MS,
  },
  resolve: {
    alias: {
      src: path.resolve(__dirname, 'src'),
    },
  },
});
