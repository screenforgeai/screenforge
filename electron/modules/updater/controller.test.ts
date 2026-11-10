// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UpdaterController,
  type ActiveUpdaterAdapter,
  type UpdaterAdapterListeners,
} from './controller';

function createActiveAdapter(checkForUpdates = vi.fn().mockResolvedValue(undefined)) {
  let listeners: UpdaterAdapterListeners | null = null;

  const adapter: ActiveUpdaterAdapter = {
    kind: 'active',
    start: (nextListeners) => {
      listeners = nextListeners;
    },
    checkForUpdates,
    quitAndInstall: vi.fn(),
  };

  return {
    adapter,
    getListeners: () => {
      if (!listeners) {
        throw new Error('Updater listeners were not registered.');
      }
      return listeners;
    },
  };
}

describe('UpdaterController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('transitions through checking and back to idle when no update is available', async () => {
    const { adapter, getListeners } = createActiveAdapter();
    const controller = new UpdaterController({
      currentVersion: '0.0.22',
      adapter,
      isAppBusy: () => false,
      checkIntervalMs: 60_000,
    });

    controller.start();
    getListeners().onChecking();
    expect(controller.getState()).toMatchObject({
      currentVersion: '0.0.22',
      status: 'checking',
    });

    getListeners().onUpdateNotAvailable();
    expect(controller.getState()).toMatchObject({
      currentVersion: '0.0.22',
      status: 'idle',
    });
  });

  it('holds a downloaded update until the app becomes idle', async () => {
    const { adapter, getListeners } = createActiveAdapter();
    let isBusy = true;
    const controller = new UpdaterController({
      currentVersion: '0.0.22',
      adapter,
      isAppBusy: () => isBusy,
      checkIntervalMs: 60_000,
    });

    controller.start();
    getListeners().onUpdateAvailable();
    getListeners().onUpdateDownloaded({
      version: '0.0.23',
      releaseNotes: 'Bug fixes',
    });

    expect(controller.getState()).toMatchObject({
      status: 'downloaded',
      availableVersion: '0.0.23',
      releaseNotes: 'Bug fixes',
    });

    isBusy = false;
    controller.notifyActivityChanged();

    expect(controller.getState()).toMatchObject({
      status: 'ready',
      availableVersion: '0.0.23',
      releaseNotes: 'Bug fixes',
    });
  });

  it('suppresses duplicate checks while a check is already in flight', async () => {
    vi.useFakeTimers();
    let resolveCheck: (() => void) | null = null;
    const checkForUpdates = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const { adapter } = createActiveAdapter(checkForUpdates);
    const controller = new UpdaterController({
      currentVersion: '0.0.22',
      adapter,
      isAppBusy: () => false,
      checkIntervalMs: 1_000,
    });

    controller.start();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(checkForUpdates).toHaveBeenCalledTimes(1);

    resolveCheck?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('runs a manual check from idle and error states', async () => {
    const checkForUpdates = vi.fn().mockResolvedValue(undefined);
    const { adapter, getListeners } = createActiveAdapter(checkForUpdates);
    const controller = new UpdaterController({
      currentVersion: '0.0.22',
      adapter,
      isAppBusy: () => false,
      checkIntervalMs: 60_000,
    });

    controller.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    await controller.checkForUpdatesNow();
    expect(checkForUpdates).toHaveBeenCalledTimes(2);

    getListeners().onError(new Error('feed unavailable'));
    await controller.checkForUpdatesNow();

    expect(checkForUpdates).toHaveBeenCalledTimes(3);
  });

  it('ignores manual checks while update work is already active or ready', async () => {
    const checkForUpdates = vi.fn().mockResolvedValue(undefined);
    const { adapter, getListeners } = createActiveAdapter(checkForUpdates);
    const controller = new UpdaterController({
      currentVersion: '0.0.22',
      adapter,
      isAppBusy: () => false,
      checkIntervalMs: 60_000,
    });

    controller.start();
    await Promise.resolve();
    expect(checkForUpdates).toHaveBeenCalledTimes(1);

    getListeners().onChecking();
    await controller.checkForUpdatesNow();
    expect(checkForUpdates).toHaveBeenCalledTimes(1);

    getListeners().onUpdateAvailable();
    await controller.checkForUpdatesNow();
    expect(checkForUpdates).toHaveBeenCalledTimes(1);

    getListeners().onUpdateDownloaded({ version: '0.0.23' });
    await controller.checkForUpdatesNow();
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('ignores manual checks while a downloaded update is waiting for activity to finish', async () => {
    const checkForUpdates = vi.fn().mockResolvedValue(undefined);
    const { adapter, getListeners } = createActiveAdapter(checkForUpdates);
    const controller = new UpdaterController({
      currentVersion: '0.0.22',
      adapter,
      isAppBusy: () => true,
      checkIntervalMs: 60_000,
    });

    controller.start();
    await Promise.resolve();
    getListeners().onUpdateDownloaded({ version: '0.0.23' });

    await controller.checkForUpdatesNow();

    expect(controller.getState()).toMatchObject({ status: 'downloaded' });
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('moves into error state when the adapter reports an error', () => {
    const { adapter, getListeners } = createActiveAdapter();
    const controller = new UpdaterController({
      currentVersion: '0.0.22',
      adapter,
      isAppBusy: () => false,
      checkIntervalMs: 60_000,
    });

    controller.start();
    getListeners().onError(new Error('feed unavailable'));

    expect(controller.getState()).toMatchObject({
      status: 'error',
      errorMessage: 'feed unavailable',
    });
  });

  it('keeps showing a newer version that has to be installed by hand while re-checking', async () => {
    const checkForUpdates = vi.fn().mockResolvedValue(undefined);
    const { adapter, getListeners } = createActiveAdapter(checkForUpdates);
    const controller = new UpdaterController({
      currentVersion: '0.0.22',
      adapter,
      isAppBusy: () => false,
      checkIntervalMs: 60_000,
    });

    controller.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    getListeners().onManualUpdateAvailable({ version: '0.0.23' });

    expect(controller.getState()).toMatchObject({
      status: 'available',
      availableVersion: '0.0.23',
    });

    getListeners().onChecking();
    expect(controller.getState()).toMatchObject({
      status: 'available',
      availableVersion: '0.0.23',
    });

    await controller.checkForUpdatesNow();
    expect(checkForUpdates).toHaveBeenCalledTimes(2);

    getListeners().onManualUpdateAvailable({ version: '0.0.24' });
    expect(controller.getState()).toMatchObject({
      status: 'available',
      availableVersion: '0.0.24',
    });
  });

  it('invokes quitAndInstall when restart is requested for a ready update', async () => {
    const { adapter, getListeners } = createActiveAdapter();
    const controller = new UpdaterController({
      currentVersion: '0.0.22',
      adapter,
      isAppBusy: () => false,
      checkIntervalMs: 60_000,
    });

    controller.start();
    getListeners().onUpdateDownloaded({ version: '0.0.23' });

    await controller.restartToApplyUpdate();

    expect(adapter.quitAndInstall).toHaveBeenCalledOnce();
  });
});
