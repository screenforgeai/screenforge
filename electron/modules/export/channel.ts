import fs from 'node:fs/promises';
import { ipcMain } from 'electron';
import { CH } from '../../channels';
import { handleChannel, handleChannelWithSender } from '../../lib/ipc-main';
import type {
  CaptureWindowParams,
  CaptureWindowResult,
  ExportChunkSpec,
  ExportFormat,
  ExportPrerenderStatus,
  ExportRequest,
  ExportRunSpec,
  SerializedChunk,
  SerializedDecoderConfig,
} from '../../../src/types/index';
import {
  cancelExport,
  checkFileExists,
  cleanupExportWorkspace,
  createExportWorkspace,
  getExportStats,
  pickExportPath,
  probeExportSource,
  revealExportInFolder,
  runCaptureInWindow,
  suggestExportPath,
  startExport,
  writeExportAudio,
  initMuxer,
  writeEncodedChunks,
  lookupExportChunks,
  startChunkRun,
  writeChunkRun,
  endChunkRun,
  runExportPrerender,
  stopExportPrerender,
  forwardPrerenderStatus,
  powerAllowsExportPrerender,
  watchPrerenderPower,
} from './service';
import { exportedFiles } from '../share/exports';
import { getShareManager } from '../share/service';

/** Notes the file an export wrote, so it (and only such files) can be shared. */
async function rememberExport(outputPath: string): Promise<void> {
  try {
    const stats = await fs.stat(outputPath);
    exportedFiles.remember(outputPath, {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      dev: stats.dev,
      ino: stats.ino,
    });
  } catch {
    // Gone already: there's nothing to share.
  }
}

export function registerExportChannels(preloadPath: string): void {
  handleChannel<[string, ExportFormat, string?], string | null>(
    CH.export.PICK_PATH,
    (defaultName, format, preferredDir) => pickExportPath(defaultName, format, preferredDir),
  );
  handleChannel<[string, ExportFormat, string?], string>(
    CH.export.SUGGEST_PATH,
    (defaultName, format, preferredDir) => suggestExportPath(defaultName, format, preferredDir),
  );
  handleChannel<[string], void>(CH.export.REVEAL_IN_FOLDER, (filePath) =>
    revealExportInFolder(filePath),
  );

  handleChannelWithSender<[ExportRequest], Awaited<ReturnType<typeof startExport>>>(
    CH.export.START,
    async (sender, request) => {
      const result = await startExport(request, (progress) => {
        sender.send(CH.export.PROGRESS, progress);
      });
      await rememberExport(result.outputPath);
      // A share of the file this export replaced is now out of date.
      getShareManager().clearFor(result.outputPath);
      return result;
    },
  );

  handleChannel<[string], void>(CH.export.CANCEL, (jobId) => cancelExport(jobId));
  handleChannel<[string], Awaited<ReturnType<typeof createExportWorkspace>>>(
    CH.export.CREATE_WORKSPACE,
    (jobId) => createExportWorkspace(jobId),
  );
  handleChannel<
    [string, ExportFormat, SerializedDecoderConfig | null, number, number, number],
    Awaited<ReturnType<typeof initMuxer>>
  >(CH.export.INIT_MUXER, (workspaceId, format, decoderConfig, width, height, fps) =>
    initMuxer(workspaceId, format, decoderConfig, width, height, fps),
  );
  handleChannel<[string, SerializedChunk[]], Awaited<ReturnType<typeof writeEncodedChunks>>>(
    CH.export.WRITE_CHUNKS,
    (workspaceId, chunks) => writeEncodedChunks(workspaceId, chunks),
  );
  handleChannel<[string, ArrayBuffer], string>(CH.export.WRITE_AUDIO, (workspaceId, buffer) =>
    writeExportAudio(workspaceId, buffer),
  );
  handleChannel<[string], void>(CH.export.CLEANUP_WORKSPACE, (workspaceId) =>
    cleanupExportWorkspace(workspaceId),
  );
  handleChannel<[string], Awaited<ReturnType<typeof probeExportSource>>>(
    CH.export.PROBE_SOURCE,
    (filePath) => probeExportSource(filePath),
  );
  handleChannel<[string | undefined], Awaited<ReturnType<typeof getExportStats>>>(
    CH.export.GET_STATS,
    (jobId) => getExportStats(jobId),
  );
  handleChannel<[string], boolean>(CH.export.FILE_EXISTS, (filePath) => checkFileExists(filePath));

  handleChannelWithSender<[CaptureWindowParams], CaptureWindowResult>(
    CH.export.RUN_CAPTURE,
    (_sender, params) => runCaptureInWindow(params, preloadPath),
  );

  // ── Chunked export ────────────────────────────────────────────────────────
  handleChannel<[string, ExportChunkSpec[]], boolean[]>(
    CH.export.CHUNK_LOOKUP,
    (workspaceId, chunks) => lookupExportChunks(workspaceId, chunks),
  );
  handleChannel<[string, number, ExportRunSpec, SerializedDecoderConfig | null], void>(
    CH.export.CHUNK_RUN_START,
    (workspaceId, runIndex, run, decoderConfig) =>
      startChunkRun(workspaceId, runIndex, run, decoderConfig),
  );
  handleChannel<[string, number, SerializedChunk[]], void>(
    CH.export.CHUNK_RUN_WRITE,
    (workspaceId, runIndex, chunks) => writeChunkRun(workspaceId, runIndex, chunks),
  );
  handleChannel<[string, number], void>(CH.export.CHUNK_RUN_END, (workspaceId, runIndex) =>
    endChunkRun(workspaceId, runIndex),
  );
  handleChannel<[CaptureWindowParams], boolean>(CH.export.PRERENDER_START, (params) =>
    runExportPrerender(params, preloadPath),
  );
  handleChannel<[], void>(CH.export.PRERENDER_STOP, () => stopExportPrerender());
  // Only the prerender hook asks, and only with the chunked-export flag on, so
  // the power watch never starts while the flag is off.
  handleChannel<[], boolean>(CH.export.PRERENDER_POWER, () => {
    watchPrerenderPower();
    return powerAllowsExportPrerender();
  });
  ipcMain.on(CH.export.PRERENDER_STATUS, (_event, status: ExportPrerenderStatus) => {
    forwardPrerenderStatus(status);
  });
}
