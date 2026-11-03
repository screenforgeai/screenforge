import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'src/**/*.test.{ts,tsx}',
      'electron/**/*.test.{ts,tsx}',
      'shared/**/*.test.{ts,tsx}',
      'scripts/**/*.test.{ts,tsx}',
    ],
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    alias: {
      src: path.resolve(__dirname, 'src'),
    },
  },
});
