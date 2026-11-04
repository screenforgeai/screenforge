import path from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const require = createRequire(import.meta.url);
const { sourcemapUploadEnabled } = require('./shared/posthog-sourcemaps.js');

// https://vitejs.dev/config
export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    // Only for release builds that upload them to PostHog; the forge
    // packageAfterCopy hook removes them before packaging either way.
    sourcemap: sourcemapUploadEnabled(),
  },
  resolve: {
    alias: {
      src: path.resolve(__dirname, 'src'),
    },
  },
});
