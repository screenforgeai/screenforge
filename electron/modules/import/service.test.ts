// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(),
    getAppPath: vi.fn(),
    isPackaged: false,
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

describe('importSampleProject', () => {
  let tempDir: string;
  let appDir: string;
  const originalResourcesPath = process.resourcesPath;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenforge-sample-'));
    appDir = path.join(tempDir, 'app');
    const sampleDir = path.join(appDir, 'src/assets/sample-project');
    await fs.mkdir(sampleDir, { recursive: true });
    await fs.writeFile(path.join(sampleDir, 'sample-project.mp4'), 'sample video');
    electronMock.app.getPath.mockReturnValue(path.join(tempDir, 'userData'));
    electronMock.app.getAppPath.mockReturnValue(appDir);
    electronMock.app.isPackaged = false;
  });

  afterEach(async () => {
    electronMock.app.isPackaged = false;
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: originalResourcesPath,
    });
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('copies the bundled sample into imports as a fresh file each time', async () => {
    const { importSampleProject } = await import('./service');

    const first = await importSampleProject();
    const second = await importSampleProject();

    const importsDir = path.join(tempDir, 'userData', 'imports');
    expect(path.dirname(first.filePath)).toBe(importsDir);
    expect(first.filePath).not.toBe(second.filePath);
    await expect(fs.readFile(first.filePath, 'utf8')).resolves.toBe('sample video');
    // Opening the sample never writes into the project library by itself.
    await expect(fs.stat(path.join(tempDir, 'userData', 'projects'))).rejects.toThrow();
  });

  it('returns the scripted cursor data anchored to now', async () => {
    const before = Date.now();
    const { importSampleProject } = await import('./service');

    const result = await importSampleProject();

    expect(result.startTime).toBeGreaterThanOrEqual(before);
    expect(result.mouseData.length).toBeGreaterThan(0);
    expect(result.mouseData.some((event) => event.type === 'mousedown')).toBe(true);
    expect(result.mouseData[0].timestamp).toBeGreaterThanOrEqual(result.startTime);
    expect(result.isImported).toBeUndefined();
    expect(exportServiceMock.probeExportSource).not.toHaveBeenCalled();
  });

  it('reads the sample from the app resources in a packaged build', async () => {
    const resourcesDir = path.join(tempDir, 'resources');
    await fs.mkdir(resourcesDir);
    await fs.writeFile(path.join(resourcesDir, 'sample-project.mp4'), 'packaged sample');
    electronMock.app.isPackaged = true;
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resourcesDir });

    const { importSampleProject } = await import('./service');
    const result = await importSampleProject();

    await expect(fs.readFile(result.filePath, 'utf8')).resolves.toBe('packaged sample');
  });
});
