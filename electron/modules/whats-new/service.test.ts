// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  app: { getPath: vi.fn<[string], string>(), getVersion: vi.fn<[], string>() },
}));

vi.mock('electron', () => ({ app: electronMock.app }));
vi.mock('../../lib/telemetry', () => ({ setTelemetryEnabled: vi.fn() }));

const readSettingsFile = (userData: string) =>
  JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')) as Record<
    string,
    unknown
  >;

describe('whats-new service', () => {
  let userData: string;

  // The launch snapshot is module state, so each test gets a fresh module.
  const loadService = async () => {
    vi.resetModules();
    return import('./service');
  };

  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'screenforge-whats-new-'));
    electronMock.app.getPath.mockReturnValue(userData);
    electronMock.app.getVersion.mockReturnValue('0.8.0');
  });

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it('does not show on a fresh install, and records the version', async () => {
    const service = await loadService();
    service.recordInstallStateAtLaunch();

    expect(await service.consumeWhatsNewOnLaunch()).toEqual({
      show: false,
      sinceVersion: null,
      currentVersion: '0.8.0',
    });
    expect(readSettingsFile(userData).lastSeenVersion).toBe('0.8.0');
  });

  it('shows the current notes for an existing user without a recorded version', async () => {
    fs.writeFileSync(path.join(userData, 'analytics-id.txt'), 'abc');
    const service = await loadService();
    service.recordInstallStateAtLaunch();

    expect(await service.consumeWhatsNewOnLaunch()).toMatchObject({
      show: true,
      sinceVersion: null,
    });
  });

  it('treats files created after launch as a fresh install', async () => {
    const service = await loadService();
    service.recordInstallStateAtLaunch();
    // e.g. telemetry writing its id right after the snapshot
    fs.writeFileSync(path.join(userData, 'analytics-id.txt'), 'abc');

    expect((await service.consumeWhatsNewOnLaunch()).show).toBe(false);
  });

  it('shows everything since the last seen version, then never again', async () => {
    fs.writeFileSync(
      path.join(userData, 'settings.json'),
      JSON.stringify({ language: 'de', lastSeenVersion: '0.6.19' }),
    );
    const service = await loadService();
    service.recordInstallStateAtLaunch();

    expect(await service.consumeWhatsNewOnLaunch()).toEqual({
      show: true,
      sinceVersion: '0.6.19',
      currentVersion: '0.8.0',
    });
    expect(readSettingsFile(userData)).toMatchObject({ language: 'de', lastSeenVersion: '0.8.0' });

    expect((await service.consumeWhatsNewOnLaunch()).show).toBe(false);
  });

  it('answers concurrent calls with the same result', async () => {
    fs.writeFileSync(
      path.join(userData, 'settings.json'),
      JSON.stringify({ lastSeenVersion: '0.7.0' }),
    );
    const service = await loadService();
    service.recordInstallStateAtLaunch();

    const [first, second] = await Promise.all([
      service.consumeWhatsNewOnLaunch(),
      service.consumeWhatsNewOnLaunch(),
    ]);

    expect(first.show).toBe(true);
    expect(second).toEqual(first);
  });
});
