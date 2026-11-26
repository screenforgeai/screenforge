import { CH } from '../../channels';
import {
  createInvokeBridge,
  createSendBridge,
  createSubscription,
  createVoidSubscription,
} from '../../lib/ipc-renderer';
import type {
  CaptureWindowParams,
  CaptureWindowResult,
  ExportChunkSpec,
  ExportFormat,
  ExportPrerenderStatus,
  ExportProgress,
  ExportRunSpec,
  ExportRuntimeStats,
  ExportRequest,
  ExportResult,
  ExportSourceInfo,
  ExportWorkspace,
  SerializedChunk,
  SerializedDecoderConfig,
} from '../../../src/types/index';

export const exportBridge = {
  startExport: createInvokeBridge<[ExportRequest], ExportResult>(CH.export.START),
  cancelExport: createInvokeBridge<[string], void>(CH.export.CANCEL),
  pickExportPath: createInvokeBridge<[string, ExportFormat, string?], string | null>(
    CH.export.PICK_PATH,
  ),
  suggestExportPath: createInvokeBridge<[string, ExportFormat, string?], string>(
    CH.export.SUGGEST_PATH,
  ),
  revealExportInFolder: createInvokeBridge<[string], void>(CH.export.REVEAL_IN_FOLDER),
  onExportProgress: createSubscription<ExportProgress>(CH.export.PROGRESS),
  createExportWorkspace: createInvokeBridge<[string], ExportWorkspace>(CH.export.CREATE_WORKSPACE),
  initMuxer: createInvokeBridge<
    [string, ExportFormat, SerializedDecoderConfig | null, number, number, number],
    void
  >(CH.export.INIT_MUXER),
  writeEncodedChunks: createInvokeBridge<[string, SerializedChunk[]], void>(CH.export.WRITE_CHUNKS),
  writeExportAudio: createInvokeBridge<[string, ArrayBuffer], string>(CH.export.WRITE_AUDIO),
  cleanupExportWorkspace: createInvokeBridge<[string], void>(CH.export.CLEANUP_WORKSPACE),
  probeExportSource: createInvokeBridge<[string], ExportSourceInfo>(CH.export.PROBE_SOURCE),
  getExportStats: createInvokeBridge<[string | undefined], ExportRuntimeStats>(CH.export.GET_STATS),
  checkFileExists: createInvokeBridge<[string], boolean>(CH.export.FILE_EXISTS),
  // ── Hidden-window capture ─────────────────────────────────────────────────
  runCapture: createInvokeBridge<[CaptureWindowParams], CaptureWindowResult>(CH.export.RUN_CAPTURE),
  onCaptureProgress: createSubscription<number>(CH.export.CAPTURE_PROGRESS),
  notifyCaptureProgress: createSendBridge<[number]>(CH.export.CAPTURE_PROGRESS),
  notifyCaptureDone: createSendBridge<[CaptureWindowResult]>(CH.export.CAPTURE_DONE),
  notifyCaptureError: createSendBridge<[string]>(CH.export.CAPTURE_ERROR),
  notifyCaptureReady: createSendBridge<[]>(CH.export.CAPTURE_READY),
  onCaptureParams: createSubscription<CaptureWindowParams>(CH.export.CAPTURE_PARAMS),
  onCaptureAbort: createVoidSubscription(CH.export.CAPTURE_ABORT),
  // ── Chunked export ────────────────────────────────────────────────────────
  lookupExportChunks: createInvokeBridge<[string, ExportChunkSpec[]], boolean[]>(
    CH.export.CHUNK_LOOKUP,
  ),
  startChunkRun: createInvokeBridge<
    [string, number, ExportRunSpec, SerializedDecoderConfig | null],
    void
  >(CH.export.CHUNK_RUN_START),
  writeChunkRun: createInvokeBridge<[string, number, SerializedChunk[]], void>(
    CH.export.CHUNK_RUN_WRITE,
  ),
  endChunkRun: createInvokeBridge<[string, number], void>(CH.export.CHUNK_RUN_END),
  startExportPrerender: createInvokeBridge<[CaptureWindowParams], boolean>(
    CH.export.PRERENDER_START,
  ),
  stopExportPrerender: createInvokeBridge<[], void>(CH.export.PRERENDER_STOP),
  setExportPrerenderPace: createSendBridge<[number]>(CH.export.PRERENDER_PACE),
  onPrerenderPace: createSubscription<number>(CH.export.PRERENDER_PACE),
  reportPrerenderStatus: createSendBridge<[ExportPrerenderStatus]>(CH.export.PRERENDER_STATUS),
  onPrerenderStatus: createSubscription<ExportPrerenderStatus>(CH.export.PRERENDER_STATUS),
  canPrerenderOnPower: createInvokeBridge<[], boolean>(CH.export.PRERENDER_POWER),
  onPrerenderPowerChanged: createSubscription<boolean>(CH.export.PRERENDER_POWER_CHANGED),
};
