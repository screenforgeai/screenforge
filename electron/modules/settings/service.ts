import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';

export interface AppSettings {
  profile: { name: string; email: string };
  language: string;
}

const DEFAULTS: AppSettings = {
  profile: { name: '', email: '' },
  language: 'en',
};

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      profile: { ...DEFAULTS.profile, ...parsed.profile },
      language: parsed.language ?? DEFAULTS.language,
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
  };
  await fs.writeFile(settingsPath(), JSON.stringify(next), 'utf8');
  return next;
}
