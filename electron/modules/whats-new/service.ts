import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { decideWhatsNew } from '../../../src/lib/whatsNew/decision';
import log from '../../lib/logger';
import { getSettings, saveSettings } from '../settings/service';

export type WhatsNewLaunchState = {
  /** Open the dialog now. */
  show: boolean;
  /** Show releases newer than this; null means only `currentVersion`. */
  sinceVersion: string | null;
  currentVersion: string;
};

// Files in userData that exist only once Screenforge has run here before.
// "Local State" is Chromium's own and covers builds older than any of ours.
const PRIOR_RUN_MARKERS = [
  'Local State',
  'settings.json',
  'analytics-id.txt',
  'presets.json',
  'projects',
];

let existingInstallAtLaunch = false;
let snapshotTaken = false;
let inFlight: Promise<WhatsNewLaunchState> | null = null;

/**
 * Must run before anything this launch writes to userData (telemetry creates
 * analytics-id.txt at startup), or a fresh install looks like an update.
 */
export function recordInstallStateAtLaunch(): void {
  if (snapshotTaken) {
    return;
  }
  snapshotTaken = true;
  try {
    const userData = app.getPath('userData');
    existingInstallAtLaunch = PRIOR_RUN_MARKERS.some((name) =>
      fs.existsSync(path.join(userData, name)),
    );
  } catch (error) {
    log.warn('[whats-new] could not inspect userData', error);
  }
}

async function decideAndRecord(): Promise<WhatsNewLaunchState> {
  const currentVersion = app.getVersion();
  const settings = await getSettings();
  const decision = decideWhatsNew({
    lastSeenVersion: settings.lastSeenVersion ?? null,
    currentVersion,
    isExistingInstall: existingInstallAtLaunch,
  });

  if (decision.markSeen) {
    // Recorded before the dialog opens, so a crash or a second window can't
    // bring the same notes back.
    await saveSettings({ lastSeenVersion: currentVersion });
  }

  return { show: decision.show, sinceVersion: decision.sinceVersion, currentVersion };
}

/** Called once by the main window on startup; marks the running version as seen. */
export function consumeWhatsNewOnLaunch(): Promise<WhatsNewLaunchState> {
  if (!inFlight) {
    inFlight = decideAndRecord()
      .catch((error: unknown) => {
        log.warn('[whats-new] launch check failed', error);
        return { show: false, sinceVersion: null, currentVersion: app.getVersion() };
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
