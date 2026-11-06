import fs from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, clipboard } from 'electron';
import log from '../../lib/logger';
import { CH } from '../../channels';
import { getDirectorAccount, getDirectorClient } from '../director/service';
import { createShareApi } from './api';
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
    async openSource(filePath) {
      const handle = await fs.open(filePath, 'r');
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
  });
  return manager;
}
