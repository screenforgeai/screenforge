// @vitest-environment node

import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportSettings } from '../../../src/types';

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(),
  },
  dialog: {
    showSaveDialog: vi.fn(),
  },
  ipcMain: {
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  },
  shell: {
    showItemInFolder: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}));

const ffmpegJobsMock = vi.hoisted(() => ({
  startExportJob: vi.fn(),
  startGifExportJob: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const videoMuxerMock = vi.hoisted(() => ({
  createExportVideoMuxer: vi.fn(),
}));

vi.mock('electron', () => ({
  app: electronMock.app,
  BrowserWindow: electronMock.BrowserWindow,
  dialog: electronMock.dialog,
  ipcMain: electronMock.ipcMain,
  shell: electronMock.shell,
}));

vi.mock('../ffmpeg/jobs/export', () => ffmpegJobsMock);

vi.mock('../ffmpeg/index', () => ({
  getFFmpegPath: vi.fn().mockResolvedValue('/usr/bin/ffmpeg'),
}));

vi.mock('../../lib/logger', () => ({
  default: loggerMock,
}));

vi.mock('../../lib/telemetry', () => ({
  trackMemorySnapshot: vi.fn(),
  trackEvent: vi.fn(),
  initTelemetry: vi.fn(),
  getAnonymousId: vi.fn(),
  shutdownTelemetry: vi.fn(),
}));

vi.mock('./videoMuxer', () => ({
  createExportVideoMuxer: videoMuxerMock.createExportVideoMuxer,
}));

const settings: ExportSettings = {
  format: 'mp4',
  quality: 'balanced',
  resolution: '1080p',
  fps: 60,
  includeAudio: false,
  audioBitrateKbps: 192,
};

describe('export service', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    tempRoot = path.join('/tmp', `screenforge-export-service-${Date.now()}-${Math.random()}`);
    electronMock.app.getPath.mockReturnValue(tempRoot);
    ffmpegJobsMock.startExportJob.mockImplementation(() => {
      throw new Error('FFmpeg should not start for this test');
    });
    ffmpegJobsMock.startGifExportJob.mockImplementation(() => {
      throw new Error('GIF export should not start for this test');
    });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it('moves a video-only export directly without starting FFmpeg', async () => {
    videoMuxerMock.createExportVideoMuxer.mockImplementation(
      async ({ videoPath }: { videoPath: string }) => ({
        videoPath,
        writeEncodedChunks: vi.fn(),
        finalize: vi.fn(async () => {
          await fs.writeFile(videoPath, 'video');
          return videoPath;
        }),
        cancel: vi.fn(),
      }),
    );

    const { createExportWorkspace, initMuxer, startExport } = await import('./service');

    const jobId = 'export-direct-move';
    const workspace = await createExportWorkspace(jobId);
    await initMuxer(workspace.workspaceId, 'mp4', null, 1920, 1080, 60);

    const outputPath = path.join(tempRoot, 'final.mp4');
    const progress = vi.fn();
    const result = await startExport(
      {
        jobId,
        workspaceId: workspace.workspaceId,
        effectiveFps: 60,
        outputPath,
        settings,
      },
      progress,
    );

    expect(result.outputPath).toBe(outputPath);
    await expect(fs.readFile(outputPath, 'utf8')).resolves.toBe('video');
    expect(ffmpegJobsMock.startExportJob).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId,
        percent: 0.98,
      }),
    );
  });

  it('cancels muxer finalization before FFmpeg starts', async () => {
    let resolveFinalizeStarted!: () => void;
    let rejectFinalize!: (error: Error) => void;
    const finalizeStarted = new Promise<void>((resolve) => {
      resolveFinalizeStarted = resolve;
    });
    const cancel = vi.fn(async () => {
      rejectFinalize(new Error('Muxer finalization cancelled'));
    });

    videoMuxerMock.createExportVideoMuxer.mockImplementation(
      async ({ videoPath }: { videoPath: string }) => ({
        videoPath,
        writeEncodedChunks: vi.fn(),
        finalize: vi.fn(
          () =>
            new Promise<string>((_resolve, reject) => {
              rejectFinalize = reject;
              resolveFinalizeStarted();
            }),
        ),
        cancel,
      }),
    );

    const { cancelExport, createExportWorkspace, initMuxer, startExport } =
      await import('./service');

    const jobId = 'export-cancel-finalize';
    const workspace = await createExportWorkspace(jobId);
    await initMuxer(workspace.workspaceId, 'mp4', null, 1920, 1080, 60);

    const exportPromise = startExport({
      jobId,
      workspaceId: workspace.workspaceId,
      effectiveFps: 60,
      outputPath: path.join(tempRoot, 'cancelled.mp4'),
      settings,
    });

    await finalizeStarted;
    await cancelExport(jobId);

    await expect(exportPromise).rejects.toThrow('Export cancelled');
    expect(cancel).toHaveBeenCalled();
    expect(ffmpegJobsMock.startExportJob).not.toHaveBeenCalled();
  });
});
