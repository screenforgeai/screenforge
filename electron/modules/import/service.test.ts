// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

const exportServiceMock = vi.hoisted(() => ({
  probeExportSource: vi.fn(),
}));

vi.mock('electron', () => electronMock);
vi.mock('../export/service', () => exportServiceMock);

describe('pickAndImportVideo', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenforge-import-'));
    electronMock.app.getPath.mockReturnValue(path.join(tempDir, 'userData'));
    exportServiceMock.probeExportSource.mockResolvedValue({ duration: 2, width: 640, height: 360 });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('reopens the picker in the folder the last video was imported from', async () => {
    // Electron 43+ opens dialogs in Downloads unless defaultPath is given, and
    // the OS no longer remembers the last folder on its own.
    const videosDir = path.join(tempDir, 'videos');
    await fs.mkdir(videosDir);
    const sourcePath = path.join(videosDir, 'clip.mp4');
    await fs.writeFile(sourcePath, 'video');
    electronMock.dialog.showOpenDialog
      .mockResolvedValueOnce({ canceled: false, filePaths: [sourcePath] })
      .mockResolvedValueOnce({ canceled: true, filePaths: [] });

    const { pickAndImportVideo } = await import('./service');
    const imported = await pickAndImportVideo();
    await pickAndImportVideo();

    expect(imported?.isImported).toBe(true);
    expect(electronMock.dialog.showOpenDialog.mock.calls[0]?.[0].defaultPath).toBeUndefined();
    expect(electronMock.dialog.showOpenDialog.mock.calls[1]?.[0].defaultPath).toBe(videosDir);
  });

  it('keeps the previous folder when the picker is cancelled', async () => {
    const videosDir = path.join(tempDir, 'videos');
    await fs.mkdir(videosDir);
    const sourcePath = path.join(videosDir, 'clip.mp4');
    await fs.writeFile(sourcePath, 'video');
    electronMock.dialog.showOpenDialog
      .mockResolvedValueOnce({ canceled: false, filePaths: [sourcePath] })
      .mockResolvedValueOnce({ canceled: true, filePaths: [] })
      .mockResolvedValueOnce({ canceled: true, filePaths: [] });

    const { pickAndImportVideo } = await import('./service');
    await pickAndImportVideo();
    await pickAndImportVideo();
    await pickAndImportVideo();

    expect(electronMock.dialog.showOpenDialog.mock.calls[2]?.[0].defaultPath).toBe(videosDir);
  });
});
