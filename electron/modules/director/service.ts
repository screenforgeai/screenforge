import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron';
import type { DirectorProjectEvent } from '../../../src/types/index';
import { getProjects, saveProject } from '../library/service';
import { readProjectBundle } from './project-bundle';
import { downloadProjectBundle, type ProjectBundleManifest } from './project-download';
import { createProjectOpener } from './project-opener';
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
      broadcast(CH.director.ACCOUNT_CHANGED, state);
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

let projectOpener: ReturnType<typeof createProjectOpener> | null = null;

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

/** Opens Director recordings and project bundles into the library (#28). */
export function getProjectOpener(): ReturnType<typeof createProjectOpener> {
  if (!projectOpener) {
    const account = getDirectorAccount();
    projectOpener = createProjectOpener({
      account,
      download: (demoId, dir, onProgress) =>
        downloadProjectBundle({
          demoId,
          request: (requestPath) =>
            getDirectorClient().request<ProjectBundleManifest>(requestPath, { auth: true }),
          fetch: globalThis.fetch,
          dir,
          onProgress,
        }),
      readBundle: readProjectBundle,
      library: { getProjects, saveProject },
      makeTempDir: () => fs.mkdtemp(path.join(app.getPath('temp'), 'screenforge-director-')),
      removeDir: (dir) => fs.rm(dir, { recursive: true, force: true }),
      newId: () => randomUUID(),
      notify: (event: DirectorProjectEvent) => {
        log.info('[director] project', { status: event.status });
        broadcast(CH.director.PROJECT_EVENT, event);
      },
    });
  }
  return projectOpener;
}

/** "Open project…": pick a bundle's project.json. */
export async function openProjectBundleFromDisk(): Promise<void> {
  const window = BrowserWindow.getFocusedWindow();
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: 'Screenforge project', extensions: ['json'] }],
  };
  const picked = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (!picked.canceled && picked.filePaths[0]) {
    await getProjectOpener().openBundleFile(picked.filePaths[0]);
  }
}
