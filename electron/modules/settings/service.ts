import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { AppSettings } from '../../../src/types/index';

export type { AppSettings };

const DEFAULTS: AppSettings = {
  profile: { name: '', email: '' },
  language: 'en',
  permissionsGuideDismissed: false,
};

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      profile: { ...DEFAULTS.profile, ...parsed.profile },
      language: parsed.language ?? DEFAULTS.language,
      permissionsGuideDismissed: parsed.permissionsGuideDismissed === true,
    };
  } catch {
    return { ...DEFAULTS, profile: { ...DEFAULTS.profile } };
  }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = {
    profile: { ...current.profile, ...patch.profile },
    language: patch.language ?? current.language,
    permissionsGuideDismissed: patch.permissionsGuideDismissed ?? current.permissionsGuideDismissed,
  };
  await fs.writeFile(settingsPath(), JSON.stringify(next), 'utf8');
  return next;
}
