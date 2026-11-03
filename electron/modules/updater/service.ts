import { app, autoUpdater } from 'electron';
import type { AutoUpdater } from 'electron';
import type { UpdaterDisabledReason, UpdaterState } from '../../../src/types/index';
import log from '../../lib/logger';
import {
  UpdaterController,
  type ActiveUpdaterAdapter,
  type UpdaterAdapter,
  type UpdaterAdapterListeners,
} from './controller';

const MAC_UPDATE_BASE_URL = process.env.SCREENFORGE_MAC_UPDATE_BASE_URL?.trim() ?? '';
const WIN_UPDATE_BASE_URL = process.env.SCREENFORGE_WIN_UPDATE_BASE_URL?.trim() ?? '';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type StartUpdaterOptions = {
  isAppBusy: () => boolean;
};

type AutoUpdaterLike = Pick<
  AutoUpdater,
  'checkForUpdates' | 'on' | 'quitAndInstall' | 'setFeedURL'
>;

type AdapterFactoryOptions = {
  platform?: NodeJS.Platform;
  arch?: string;
  isPackaged?: boolean;
  macUpdateBaseUrl?: string;
  winUpdateBaseUrl?: string;
  updater?: AutoUpdaterLike;
};

function parseVersionFromReleaseName(releaseName?: string): string | undefined {
  if (!releaseName) {
    return undefined;
  }

  const match = releaseName.match(/v([0-9A-Za-z._-]+)$/);
  return match?.[1];
}

function getFeedLogInfo(baseUrl: string): { host: string; path: string } {
  try {
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/RELEASES.json`);
    return {
      host: url.host,
      path: url.pathname,
    };
  } catch {
    return {
      host: 'invalid',
      path: baseUrl,
    };
  }
}

class MacUpdaterAdapter implements ActiveUpdaterAdapter {
  readonly kind = 'active' as const;

  private started = false;

  constructor(
    private readonly updater: AutoUpdaterLike,
    private readonly baseUrl: string,
  ) {}

  start(listeners: UpdaterAdapterListeners): void {
    if (this.started) {
      return;
    }

    this.started = true;

    const normalizedBaseUrl = this.baseUrl.replace(/\/$/, '');
    const feedUrl = `${normalizedBaseUrl}/RELEASES.json`;
    log.info('[updater] configuring macOS feed', getFeedLogInfo(normalizedBaseUrl));

    this.updater.setFeedURL({
      url: feedUrl,
      serverType: 'json',
    });

    this.updater.on('checking-for-update', () => {
      log.info('[updater] checking for updates');
      listeners.onChecking();
    });
    this.updater.on('update-available', () => {
      log.info('[updater] update available');
      listeners.onUpdateAvailable();
    });
    this.updater.on('update-not-available', () => {
      log.info('[updater] no update available');
      listeners.onUpdateNotAvailable();
    });
    this.updater.on('update-downloaded', (_event, releaseNotes, releaseName) => {
      const update = {
        version: parseVersionFromReleaseName(releaseName),
        releaseNotes: releaseNotes?.trim() || undefined,
      };
      log.info('[updater] update downloaded', update);
      listeners.onUpdateDownloaded(update);
    });
    this.updater.on('error', (error) => {
      log.warn('[updater] autoUpdater error', error);
      listeners.onError(error);
    });
  }

  async checkForUpdates(): Promise<void> {
    await Promise.resolve(this.updater.checkForUpdates());
  }

  quitAndInstall(): void {
    this.updater.quitAndInstall();
  }
}

class WinUpdaterAdapter implements ActiveUpdaterAdapter {
  readonly kind = 'active' as const;

  private started = false;

  constructor(
    private readonly updater: AutoUpdaterLike,
    private readonly baseUrl: string,
  ) {}

  start(listeners: UpdaterAdapterListeners): void {
    if (this.started) {
      return;
    }

    this.started = true;

    const normalizedBaseUrl = this.baseUrl.replace(/\/$/, '');
    // Squirrel.Windows consumes a RELEASES manifest plus .nupkg packages.
    const feedUrl = `${normalizedBaseUrl}/RELEASES`;
    log.info('[updater] configuring Windows feed', { feedUrl });

    this.updater.setFeedURL({ url: feedUrl });

    this.updater.on('checking-for-update', () => {
      log.info('[updater] checking for updates');
      listeners.onChecking();
    });
    this.updater.on('update-available', () => {
      log.info('[updater] update available');
      listeners.onUpdateAvailable();
    });
    this.updater.on('update-not-available', () => {
      log.info('[updater] no update available');
      listeners.onUpdateNotAvailable();
    });
    this.updater.on('update-downloaded', (_event, releaseNotes, releaseName) => {
      const update = {
        version: parseVersionFromReleaseName(releaseName),
        releaseNotes: releaseNotes?.trim() || undefined,
      };
      log.info('[updater] update downloaded', update);
      listeners.onUpdateDownloaded(update);
    });
    this.updater.on('error', (error) => {
      log.warn('[updater] autoUpdater error', error);
      listeners.onError(error);
    });
  }

  async checkForUpdates(): Promise<void> {
    await Promise.resolve(this.updater.checkForUpdates());
  }

  quitAndInstall(): void {
    this.updater.quitAndInstall();
  }
}

function createDisabledAdapter(reason: UpdaterDisabledReason): UpdaterAdapter {
  return {
    kind: 'disabled',
    reason,
  };
}

export function createUpdaterAdapter(options: AdapterFactoryOptions = {}): UpdaterAdapter {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const isPackaged = options.isPackaged ?? app.isPackaged;
  const macUpdateBaseUrl = options.macUpdateBaseUrl ?? MAC_UPDATE_BASE_URL;
  const winUpdateBaseUrl = options.winUpdateBaseUrl ?? WIN_UPDATE_BASE_URL;
  const updater = options.updater ?? autoUpdater;

  if (!isPackaged) {
    log.info('[updater] disabled', {
      reason: 'not_packaged',
      currentVersion: app.getVersion(),
      platform,
      arch,
    });
    return createDisabledAdapter('not_packaged');
  }

  if (platform === 'linux') {
    log.info('[updater] disabled', {
      reason: 'unsupported',
      currentVersion: app.getVersion(),
      platform,
      arch,
    });
    return createDisabledAdapter('unsupported');
  }

  if (platform === 'win32') {
    if (!winUpdateBaseUrl) {
      log.info('[updater] disabled', {
        reason: 'missing_feed',
        currentVersion: app.getVersion(),
        platform,
        arch,
      });
      return createDisabledAdapter('missing_feed');
    }

    log.info('[updater] enabled', {
      currentVersion: app.getVersion(),
      platform,
      arch,
      feed: getFeedLogInfo(winUpdateBaseUrl),
    });
    return new WinUpdaterAdapter(updater, winUpdateBaseUrl);
  }

  if (platform !== 'darwin' || arch !== 'arm64') {
    log.info('[updater] disabled', {
      reason: 'not_implemented',
      currentVersion: app.getVersion(),
      platform,
      arch,
    });
    return createDisabledAdapter('not_implemented');
  }

  if (!macUpdateBaseUrl) {
    log.info('[updater] disabled', {
      reason: 'missing_feed',
      currentVersion: app.getVersion(),
      platform,
      arch,
    });
    return createDisabledAdapter('missing_feed');
  }

  log.info('[updater] enabled', {
    currentVersion: app.getVersion(),
    platform,
    arch,
    feed: getFeedLogInfo(macUpdateBaseUrl),
  });

  return new MacUpdaterAdapter(updater, macUpdateBaseUrl);
}

let controller: UpdaterController | null = null;
let willQuitForUpdate = false;
let unsubscribeDiagnosticLogger: (() => void) | null = null;

export function isQuittingForUpdate(): boolean {
  return willQuitForUpdate;
}

function getController(): UpdaterController {
  if (!controller) {
    controller = new UpdaterController({
      currentVersion: app.getVersion(),
      adapter: createUpdaterAdapter(),
      isAppBusy: () => false,
      checkIntervalMs: UPDATE_CHECK_INTERVAL_MS,
    });
    log.info('[updater] controller initialized', controller.getState());
    unsubscribeDiagnosticLogger = controller.subscribe((state) => {
      log.info('[updater] state changed', state);
    });
  }

  return controller;
}

export function startUpdater(options: StartUpdaterOptions): void {
  const currentController = getController();
  currentController.setIsAppBusy(options.isAppBusy);
  log.info('[updater] starting', currentController.getState());
  currentController.start();
}

export function getUpdaterState(): UpdaterState {
  return getController().getState();
}

export function onUpdaterStateChanged(listener: (state: UpdaterState) => void): () => void {
  return getController().subscribe(listener);
}

export function notifyUpdaterActivityChanged(): void {
  getController().notifyActivityChanged();
}

export async function checkForUpdatesNow(): Promise<UpdaterState> {
  log.info('[updater] manual check requested', getController().getState());
  return getController().checkForUpdatesNow();
}

export async function restartToApplyUpdate(): Promise<void> {
  willQuitForUpdate = true;
  try {
    await getController().restartToApplyUpdate();
  } catch (error) {
    willQuitForUpdate = false;
    throw error;
  }
}

export function resetUpdaterForTests(): void {
  controller?.stop();
  unsubscribeDiagnosticLogger?.();
  unsubscribeDiagnosticLogger = null;
  controller = null;
  willQuitForUpdate = false;
}
