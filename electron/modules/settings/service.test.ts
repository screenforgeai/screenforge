// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(),
  },
}));

vi.mock('electron', () => electronMock);

describe('settings service', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenforge-settings-'));
    electronMock.app.getPath.mockReturnValue(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('has not dismissed the permissions guide on a fresh install', async () => {
    const { getSettings } = await import('./service');

    await expect(getSettings()).resolves.toMatchObject({ permissionsGuideDismissed: false });
  });

  it('remembers that the permissions guide was skipped without touching other settings', async () => {
    const { getSettings, saveSettings } = await import('./service');
    await saveSettings({ language: 'de', profile: { name: 'Ada', email: '' } });

    await saveSettings({ permissionsGuideDismissed: true });

    await expect(getSettings()).resolves.toEqual({
      profile: { name: 'Ada', email: '' },
      language: 'de',
      permissionsGuideDismissed: true,
    });
  });

  it('reads settings files written before the flag existed', async () => {
    await fs.writeFile(
      path.join(tempDir, 'settings.json'),
      JSON.stringify({ profile: { name: '', email: '' }, language: 'fr' }),
    );
    const { getSettings } = await import('./service');

    await expect(getSettings()).resolves.toMatchObject({
      language: 'fr',
      permissionsGuideDismissed: false,
    });
  });
});
