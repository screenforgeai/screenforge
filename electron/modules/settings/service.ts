import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { setTelemetryEnabled } from '../../lib/telemetry';

export interface AppSettings {
  profile: { name: string; email: string };
  language: string;
  /** "Share usage data": usage events, error reports and the profile go to PostHog. */
  telemetryEnabled: boolean;
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

function withDefaults(parsed: Partial<AppSettings>): AppSettings {
  return {
    profile: { ...DEFAULTS.profile, ...parsed.profile },
    language: parsed.language ?? DEFAULTS.language,
    telemetryEnabled: isBoolean(parsed.telemetryEnabled)
      ? parsed.telemetryEnabled
      : DEFAULTS.telemetryEnabled,
  };
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
  const next: AppSettings = {
    profile: { ...current.profile, ...patch.profile },
    language: patch.language ?? current.language,
    telemetryEnabled: isBoolean(patch.telemetryEnabled)
      ? patch.telemetryEnabled
      : current.telemetryEnabled,
  };
  await fs.writeFile(settingsPath(), JSON.stringify(next), 'utf8');
  if (isBoolean(patch.telemetryEnabled)) {
    setTelemetryEnabled(next.telemetryEnabled);
  }
  return next;
}
