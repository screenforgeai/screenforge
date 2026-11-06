import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, safeStorage, shell } from 'electron';
import log from '../../lib/logger';
import { CH } from '../../channels';
import { createDirectorAccount, type DirectorAccount } from './account';
import { createDirectorClient, directorApiBase, type DirectorClient } from './client';
import { createTokenStore } from './token-store';

let account: DirectorAccount | null = null;
let client: DirectorClient | null = null;

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

/** Restores a remembered sign-in. Call once the app is ready (safeStorage needs it). */
export async function initDirectorAccount(): Promise<void> {
  await getDirectorAccount()
    .init()
    .catch((err: unknown) => log.warn('[director] could not restore sign-in', err));
}
