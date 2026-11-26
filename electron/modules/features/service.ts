import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { CH } from '../../channels';
import log from '../../lib/logger';
import { evaluateFeatureFlag } from '../../lib/telemetry';
import { createFeatureFlags, type FeatureFlagStore } from './flags';
import type { FeatureFlags } from '../../../src/types/index';

let store: FeatureFlagStore | null = null;

const cacheFile = () => path.join(app.getPath('userData'), 'feature-flags.json');

function flags(): FeatureFlagStore {
  store ??= createFeatureFlags({
    isPackaged: app.isPackaged,
    overrides: {
      directorSharing: process.env.SCREENFORGE_FEATURE_DIRECTOR_SHARING?.trim(),
      chunkedExport: process.env.SCREENFORGE_FEATURE_CHUNKED_EXPORT?.trim(),
      fastExportEdges: process.env.SCREENFORGE_FEATURE_FAST_EXPORT_EDGES?.trim(),
      betaUpdates: process.env.SCREENFORGE_FEATURE_BETA_UPDATES?.trim(),
    },
    evaluate: evaluateFeatureFlag,
    async readCache() {
      try {
        const parsed = JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as Record<
          string,
          unknown
        >;
        const cached: Partial<FeatureFlags> = {};
        for (const name of [
          'directorSharing',
          'chunkedExport',
          'fastExportEdges',
          'betaUpdates',
        ] as const) {
          if (typeof parsed[name] === 'boolean') {
            cached[name] = parsed[name] as boolean;
          }
        }
        return cached;
      } catch {
        return null;
      }
    },
    async writeCache(flags) {
      await fs.writeFile(cacheFile(), JSON.stringify(flags), 'utf8');
    },
    onChange(next: FeatureFlags) {
      log.info('[features] flags', next);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(CH.features.CHANGED, next);
        }
      }
    },
  });
  return store;
}

export function getFeatureFlags(): FeatureFlags {
  return flags().get();
}

/** The last answer at once, then PostHog's in the background. */
export async function initFeatureFlags(): Promise<void> {
  await flags().load();
  void flags().refresh();
}

/** Asks PostHog again, e.g. after the "Share usage data" setting changes. */
export function refreshFeatureFlags(): void {
  void flags().refresh();
}
