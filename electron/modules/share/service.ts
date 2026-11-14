import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, clipboard } from 'electron';
import log from '../../lib/logger';
import { CH } from '../../channels';
import { directorApiBase, isLoopbackUrl } from '../director/client';
import { getDirectorAccount, getDirectorClient } from '../director/service';
import { createShareApi } from './api';
import { exportedFiles, sameFile } from './exports';
import { createShareManager, type ShareManager } from './shares';
import { createShareStore } from './store';

let manager: ShareManager | null = null;

const broadcast = (channel: string, payload: unknown) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
};

/** Share links through the signed-in Director account; the token stays in this process. */
export function getShareManager(): ShareManager {
  manager ??= createShareManager({
    api: createShareApi(getDirectorClient().request, (fn) => getDirectorAccount().call(fn)),
    store: createShareStore({
      filePath: path.join(app.getPath('userData'), 'share-links.json'),
      fs,
    }),
    fetch: globalThis.fetch,
    async stat(filePath) {
      try {
        const stats = await fs.stat(filePath);
        return stats.isFile() ? { size: stats.size, mtimeMs: stats.mtimeMs } : null;
      } catch {
        return null;
      }
    },
    currentAccount() {
      const state = getDirectorAccount().getState();
      return state.status === 'signed-in' ? `${state.workspace.id}:${state.user.id}` : null;
    },
    async isExported(filePath) {
      try {
        const stats = await fs.stat(filePath);
        return (
          stats.isFile() &&
          exportedFiles.matches(filePath, {
            size: stats.size,
            mtimeMs: stats.mtimeMs,
            dev: stats.dev,
            ino: stats.ino,
          })
        );
      } catch {
        return false;
      }
    },
    async openSource(filePath, expected) {
      const handle = await fs.open(filePath, 'r');
      // Checked on the open handle, so the path can't be swapped for another
      // file between the checks and the read.
      const stats = await handle.stat();
      const opened = { size: stats.size, mtimeMs: stats.mtimeMs, dev: stats.dev, ino: stats.ino };
      const known = exportedFiles.known(filePath);
      if (
        !stats.isFile() ||
        !sameFile(expected, opened) ||
        (known !== null && !sameFile(known, opened))
      ) {
        await handle.close();
        throw new Error('The file changed before it could be shared.');
      }
      return {
        source: {
          async read(position, length) {
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await handle.read(buffer, 0, length, position);
            return buffer.subarray(0, bytesRead);
          },
        },
        close: () => handle.close(),
      };
    },
    writeClipboard: (text) => clipboard.writeText(text),
    onState(state) {
      if (state.status !== 'uploading') {
        log.info('[share] state', {
          status: state.status,
          error: state.status === 'failed' ? state.error : undefined,
        });
      }
      broadcast(CH.share.STATE_CHANGED, state);
    },
    onLibrary: (library) => broadcast(CH.share.LIBRARY_CHANGED, library),
    allowLoopbackUploads: isLoopbackUrl(directorApiBase(process.env)),
  });
  return manager;
}
