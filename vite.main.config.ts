import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Load all .env variables (no VITE_ prefix restriction) for build-time inlining.
  // These values are baked into main.js at compile time — the .env file itself is
  // never shipped with the packaged app.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    build: {
      minify: true,
      rollupOptions: {
        external: ['uiohook-napi', 'electron', '@huggingface/transformers', 'onnxruntime-node'],
      },
    },
    define: {
      // Inline telemetry credentials so they work in the packaged app where
      // process.env is not populated from a .env file.
      'process.env.POSTHOG_API_KEY': JSON.stringify(env.POSTHOG_API_KEY ?? ''),
      'process.env.POSTHOG_HOST': JSON.stringify(env.POSTHOG_HOST ?? ''),
      'process.env.SCREENFORGE_MAC_UPDATE_BASE_URL': JSON.stringify(
        env.SCREENFORGE_MAC_UPDATE_BASE_URL ?? '',
      ),
      'process.env.SCREENFORGE_WIN_UPDATE_BASE_URL': JSON.stringify(
        env.SCREENFORGE_WIN_UPDATE_BASE_URL ?? '',
      ),
    },
  };
});
