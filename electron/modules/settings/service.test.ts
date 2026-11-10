// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  app: { getPath: vi.fn<[string], string>() },
}));

const telemetryMock = vi.hoisted(() => ({
  setTelemetryEnabled: vi.fn(),
}));

vi.mock('electron', () => ({ app: electronMock.app }));
vi.mock('../../lib/telemetry', () => telemetryMock);

import { getSettings, getSettingsSync, saveSettings } from './service';

describe('settings service', () => {
  let userData: string;

  beforeEach(() => {
    vi.clearAllMocks();
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'screenforge-settings-'));
    electronMock.app.getPath.mockReturnValue(userData);
  });

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it('shares usage data by default', async () => {
    expect((await getSettings()).telemetryEnabled).toBe(true);
    expect(getSettingsSync().telemetryEnabled).toBe(true);
  });

  it('keeps sharing on for a settings file saved before the toggle existed', async () => {
    fs.writeFileSync(
      path.join(userData, 'settings.json'),
      JSON.stringify({ profile: { name: 'Ada', email: '' }, language: 'fr' }),
    );

    const settings = await getSettings();

    expect(settings).toEqual({
      profile: { name: 'Ada', email: '' },
      language: 'fr',
      telemetryEnabled: true,
    });
    expect(getSettingsSync()).toEqual(settings);
  });

  it('ignores a telemetryEnabled that is not a boolean', async () => {
    await saveSettings({ telemetryEnabled: false });
    vi.clearAllMocks();

    await saveSettings({ telemetryEnabled: 'true' as unknown as boolean });

    expect((await getSettings()).telemetryEnabled).toBe(false);
    expect(telemetryMock.setTelemetryEnabled).not.toHaveBeenCalled();
  });

  it('treats a non-boolean telemetryEnabled in the file as on', async () => {
    fs.writeFileSync(
      path.join(userData, 'settings.json'),
      JSON.stringify({ telemetryEnabled: 'no' }),
    );

    expect((await getSettings()).telemetryEnabled).toBe(true);
    expect(getSettingsSync().telemetryEnabled).toBe(true);
  });

  it('remembers sharing turned off and applies it right away', async () => {
    await saveSettings({ language: 'de' });
    await saveSettings({ telemetryEnabled: false });

    expect(await getSettings()).toMatchObject({ language: 'de', telemetryEnabled: false });
    expect(getSettingsSync().telemetryEnabled).toBe(false);
    expect(telemetryMock.setTelemetryEnabled).toHaveBeenCalledTimes(1);
    expect(telemetryMock.setTelemetryEnabled).toHaveBeenCalledWith(false);
  });
});
