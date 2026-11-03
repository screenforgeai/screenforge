import { CH } from '../../channels';
import { handleChannel, handleChannelWithSender } from '../../lib/ipc-main';
import type {
  CaptureWindowParams,
  CaptureWindowResult,
  ExportFormat,
  ExportRequest,
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
} from './service';

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
    (sender, request) =>
      startExport(request, (progress) => {
        sender.send(CH.export.PROGRESS, progress);
      }),
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
}
