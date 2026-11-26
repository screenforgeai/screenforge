import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { setTelemetryEnabled } from '../../lib/telemetry';
import { refreshFeatureFlags } from '../features/service';

export interface AppSettings {
  profile: { name: string; email: string };
  language: string;
  /** "Share usage data": usage events, error reports and the profile go to PostHog. */
  telemetryEnabled: boolean;
  /** Version whose release notes were last offered in "What's new"; absent before the first check. */
  lastSeenVersion?: string;
  /** "Get early updates": this install reads the beta update feed; absent until set. */
  earlyUpdates?: boolean;
}

const DEFAULTS: AppSettings = {
  profile: { name: '', email: '' },
  language: 'en',
  telemetryEnabled: true,
};

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

// Settings arrive over IPC and from a hand-editable file, so a "false" string must not read as on.
function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Adds the optional fields that hold a valid value; leaves the rest out. */
function withOptionalFields(
  settings: AppSettings,
  values: { lastSeenVersion?: unknown; earlyUpdates?: unknown },
): AppSettings {
  const next: AppSettings = { ...settings };
  if (isNonEmptyString(values.lastSeenVersion)) {
    next.lastSeenVersion = values.lastSeenVersion;
  }
  if (isBoolean(values.earlyUpdates)) {
    next.earlyUpdates = values.earlyUpdates;
  }
  return next;
}

function withDefaults(parsed: Partial<AppSettings>): AppSettings {
  return withOptionalFields(
    {
      profile: { ...DEFAULTS.profile, ...parsed.profile },
      language: parsed.language ?? DEFAULTS.language,
      telemetryEnabled: isBoolean(parsed.telemetryEnabled)
        ? parsed.telemetryEnabled
        : DEFAULTS.telemetryEnabled,
    },
    parsed,
  );
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    return withDefaults(JSON.parse(raw) as Partial<AppSettings>);
  } catch {
    return withDefaults({});
  }
}

/** For startup, before telemetry sends its first event. */
export function getSettingsSync(): AppSettings {
  try {
    return withDefaults(JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<AppSettings>);
  } catch {
    return withDefaults({});
  }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = withOptionalFields(
    {
      profile: { ...current.profile, ...patch.profile },
      language: patch.language ?? current.language,
      telemetryEnabled: isBoolean(patch.telemetryEnabled)
        ? patch.telemetryEnabled
        : current.telemetryEnabled,
    },
    {
      lastSeenVersion: isNonEmptyString(patch.lastSeenVersion)
        ? patch.lastSeenVersion
        : current.lastSeenVersion,
      earlyUpdates: isBoolean(patch.earlyUpdates) ? patch.earlyUpdates : current.earlyUpdates,
    },
  );
  await fs.writeFile(settingsPath(), JSON.stringify(next), 'utf8');
  if (isBoolean(patch.telemetryEnabled)) {
    setTelemetryEnabled(next.telemetryEnabled);
    refreshFeatureFlags();
  }
  return next;
}
