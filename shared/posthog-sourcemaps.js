const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * Release builds only: needs a PostHog personal API key, the project id and
 * the path to the CLI's Node launcher (installed by the release workflows).
 * Local and fork builds have none of these and skip it.
 */
function sourcemapUploadEnabled(env = process.env) {
  return Boolean(
    env.POSTHOG_CLI_API_KEY?.trim() &&
    env.POSTHOG_CLI_PROJECT_ID?.trim() &&
    env.POSTHOG_CLI_SCRIPT?.trim(),
  );
}

function removeSourcemaps(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeSourcemaps(entryPath);
    } else if (entry.name.endsWith('.map')) {
      fs.rmSync(entryPath, { force: true });
    } else if (entry.name.endsWith('.js')) {
      // A failed upload leaves the comment pointing at the map deleted above.
      const code = fs.readFileSync(entryPath, 'utf8');
      const stripped = code.replace(/\/\/# sourceMappingURL=\S+\s*$/, '');
      if (stripped !== code) {
        // Write beside it and swap in only once complete: a write that fails
        // partway (a full disk) must not leave the shipped asset truncated.
        // If it fails, keep the original — a dangling comment is harmless —
        // and carry on removing the .map files.
        const tmpPath = `${entryPath}.tmp`;
        try {
          fs.writeFileSync(tmpPath, stripped);
          fs.renameSync(tmpPath, entryPath);
        } catch {
          fs.rmSync(tmpPath, { force: true });
        }
      }
    }
  }
}

/**
 * Injects chunk ids into the packaged renderer bundle and uploads its source
 * maps to PostHog, so error-tracking stacks resolve to real files and lines.
 * Never throws and never ships a .map file: a failed upload only costs
 * readable stacks for that release, not the build.
 *
 * Runs the CLI's launcher with Node rather than through a shell, so a
 * Windows `.cmd` shim or a path with spaces can't break it.
 */
function uploadRendererSourcemaps(
  buildPath,
  version,
  { env = process.env, run = spawnSync, log = console } = {},
) {
  const rendererDir = path.join(buildPath, '.vite', 'renderer');
  if (!fs.existsSync(rendererDir)) {
    return 'skipped';
  }

  try {
    if (!sourcemapUploadEnabled(env)) {
      return 'skipped';
    }

    const result = run(
      process.execPath,
      [
        env.POSTHOG_CLI_SCRIPT,
        'sourcemap',
        'process',
        '--directory',
        rendererDir,
        '--release-name',
        'screenforge',
        '--release-version',
        version,
        // The default `event` mode needs the SDK to report the release on
        // each exception; posthog-node in the main process doesn't, so bind
        // the release to the uploaded maps instead.
        '--release-mode',
        'symbol-set',
        '--delete-after',
      ],
      { env, stdio: 'inherit' },
    );
    if (result.error || result.status !== 0) {
      log.warn(
        `[posthog-sourcemaps] upload failed (${result.error?.message ?? `exit ${result.status}`}); continuing without source maps`,
      );
      return 'failed';
    }
    log.info('[posthog-sourcemaps] renderer source maps uploaded');
    return 'uploaded';
  } catch (err) {
    log.warn(
      `[posthog-sourcemaps] upload failed (${err?.message ?? err}); continuing without source maps`,
    );
    return 'failed';
  } finally {
    // This runs on every build, keyed or not, so it must not throw either.
    try {
      removeSourcemaps(rendererDir);
    } catch (err) {
      log.warn(
        `[posthog-sourcemaps] cleanup failed (${err?.message ?? err}); renderer .map files may remain in the package`,
      );
    }
  }
}

module.exports = { sourcemapUploadEnabled, uploadRendererSourcemaps };
