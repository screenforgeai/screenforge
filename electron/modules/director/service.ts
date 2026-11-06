import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, safeStorage, shell } from 'electron';
import log from '../../lib/logger';
import { CH } from '../../channels';
import { createDirectorAccount, type DirectorAccount } from './account';
import { createDirectorClient, directorApiBase, type DirectorClient } from './client';
import { createTokenStore } from './token-store';
import {
  createBrandKitCache,
  createBrandKitSync,
  downloadLogo,
  type BrandKitSync,
} from './brand-kit';
import { createPresetAssets, PRESET_ASSETS_FOLDER } from '../presets/assets';

let account: DirectorAccount | null = null;
let client: DirectorClient | null = null;
let brandKit: BrandKitSync | null = null;

/** Director's API, signed in as this app's desktop connection when there is one. */
export function getDirectorClient(): DirectorClient {
  client ??= createDirectorClient({
    baseUrl: directorApiBase(process.env),
    fetch: globalThis.fetch,
    getToken: () => account?.getToken() ?? null,
  });
  return client;
}

export function getDirectorAccount(): DirectorAccount {
  if (!account) {
    account = createDirectorAccount({
      store: createTokenStore({
        filePath: path.join(app.getPath('userData'), 'director-account.bin'),
        safeStorage,
      }),
      client: getDirectorClient(),
      openExternal: (url) => shell.openExternal(url),
      deviceName: os.hostname() || 'Screenforge',
    });
    account.onChange((state) => {
      log.info('[director] account', { status: state.status });
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(CH.director.ACCOUNT_CHANGED, state);
        }
      }
    });
  }
  return account;
}

/** The workspace brand kit, kept as a read-only style preset while signed in. */
export function getBrandKitSync(): BrandKitSync {
  if (!brandKit) {
    const userData = app.getPath('userData');
    brandKit = createBrandKitSync({
      account: getDirectorAccount(),
      client: getDirectorClient(),
      cache: createBrandKitCache({
        filePath: path.join(userData, 'director-brand-kit.json'),
        assets: createPresetAssets(path.join(userData, PRESET_ASSETS_FOLDER)),
      }),
      downloadLogo: (url) => downloadLogo(globalThis.fetch, url),
      log: (message, detail) => log.warn(`[director] ${message}`, detail),
    });
    brandKit.onChange(() => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(CH.presets.CHANGED);
        }
      }
    });
  }
  return brandKit;
}

/**
 * Restores a remembered sign-in, then syncs the brand kit. Call once the app
 * is ready (safeStorage needs it).
 */
export async function initDirectorAccount(): Promise<void> {
  await getDirectorAccount()
    .init()
    .catch((err: unknown) => log.warn('[director] could not restore sign-in', err));
  await getBrandKitSync()
    .start()
    .catch((err: unknown) => log.warn('[director] could not sync the brand kit', err));
}
