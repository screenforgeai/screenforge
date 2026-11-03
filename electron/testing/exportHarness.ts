import fs from 'node:fs/promises';
import path from 'node:path';
import type { CaptureWindowParams, ExportRequest } from '../../src/types';
import { createCaptureStoreSnapshot } from '../../src/lib/export/captureSnapshot';
import { normalizeExportFpsForFormat } from '../../src/lib/export/gif';
import { computeRequestedExportSize, computeTimelineDuration } from '../../src/lib/export/planning';
import { VIDEO_DECODE_STALL_ERROR } from '../../src/lib/export/captureScheduling';
import {
  cleanupExportWorkspace,
  createExportWorkspace,
  probeExportSource,
  runCaptureInWindow,
  startExport,
  writeExportAudio,
} from '../modules/export/service';
import type { ExportHarnessResult } from './exportHarnessManifest';
import { readResolvedExportFixtureManifest } from './exportHarnessManifest';

async function writeHarnessResult(resultPath: string, result: ExportHarnessResult): Promise<void> {
  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, JSON.stringify(result, null, 2));
}

export async function runExportHarness(
  preloadPath: string,
  manifestPath: string,
  resultPath: string,
): Promise<number> {
  const startedAt = Date.now();
  let workspaceId: string | null = null;
  let manifestId = path.basename(manifestPath, path.extname(manifestPath));
  await writeHarnessResult(resultPath, {
    success: false,
    manifestId,
    error: 'Harness started',
    elapsedMs: 0,
  });

  try {
    console.info(`[export-harness] loading manifest ${manifestPath}`);
    const manifest = await readResolvedExportFixtureManifest(manifestPath);
    manifestId = manifest.id;
    console.info(`[export-harness] running ${manifest.id}`);

    const sourceInfo = await probeExportSource(manifest.recording.filePath);
    const sourceWidth = sourceInfo.width ?? manifest.recording.recordingArea.width ?? 1280;
    const sourceHeight = sourceInfo.height ?? manifest.recording.recordingArea.height ?? 720;
    const effectiveFps = normalizeExportFpsForFormat(manifest.export.format, manifest.export.fps);
    const sourceFps = sourceInfo.fps != null && sourceInfo.fps > 0 ? sourceInfo.fps : effectiveFps;
    const duration = computeTimelineDuration(manifest.recording.duration, manifest.mediaSegments);
    const targetSize = computeRequestedExportSize(
      manifest.frame,
      sourceWidth,
      sourceHeight,
      manifest.export.resolution,
    );

    const workspace = await createExportWorkspace(`export-test-${manifest.id}-${Date.now()}`);
    workspaceId = workspace.workspaceId;

    const storeSnapshot = createCaptureStoreSnapshot({
      frame: manifest.frame,
      zoomClips: manifest.zoomClips,
      textClips: [],
      camera: manifest.camera,
      keyboard: manifest.keyboard,
      cursorEnabled: true,
      cursorStyle: manifest.cursor.style,
      cursorSize: manifest.cursor.size,
      cursorClickEffect: manifest.cursor.clickEffect,
      cursorHalflife: manifest.cursor.halflife,
      cursorMotionBlur: manifest.cursor.motionBlur,
      cursorMaxTilt: manifest.cursor.maxTilt,
      cursorHideWhenIdle: manifest.cursor.hideWhenIdle,
      cursorIdleHideSeconds: manifest.cursor.idleHideSeconds,
      cameraClips: [],
      maskClips: [],
    });

    const captureParams: CaptureWindowParams = {
      workspaceId,
      jobId: `export-test-${manifest.id}`,
      recording: manifest.recording,
      mediaSegments: manifest.mediaSegments,
      frame: manifest.frame,
      storeSnapshot,
      duration,
      fps: effectiveFps,
      sourceFps,
      targetWidth: targetSize.width,
      targetHeight: targetSize.height,
      format: manifest.export.format,
      quality: manifest.export.quality,
      resolution: manifest.export.resolution,
      includeAudio: manifest.export.includeAudio,
      cursor: {
        clickSound: manifest.cursor.clickSound,
        clickSoundVolume: manifest.cursor.clickSoundVolume,
      },
    };

    const captureResult = await runCaptureInWindow(captureParams, preloadPath);
    console.info(`[export-harness] capture finished for ${manifest.id}`);

    if (
      workspaceId &&
      manifest.export.includeAudio &&
      manifest.export.format !== 'gif' &&
      captureResult.audioWavBuffer
    ) {
      await writeExportAudio(workspaceId, captureResult.audioWavBuffer);
    }

    const outputPath = path.join(path.dirname(resultPath), manifest.export.outputFileName);
    const request: ExportRequest = {
      jobId: captureParams.jobId,
      workspaceId,
      effectiveFps,
      outputPath,
      settings: manifest.export,
    };

    const exportResult = await startExport(request);
    const outputInfo = await probeExportSource(exportResult.outputPath);
    console.info(`[export-harness] export finished for ${manifest.id}: ${exportResult.outputPath}`);

    await writeHarnessResult(resultPath, {
      success: true,
      manifestId: manifest.id,
      outputPath: exportResult.outputPath,
      captureFrameCount: captureResult.frameCount,
      effectiveFps,
      capturePerf: captureResult.perfStats,
      duration,
      targetWidth: targetSize.width,
      targetHeight: targetSize.height,
      sourceInfo,
      outputInfo,
      elapsedMs: Date.now() - startedAt,
    });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[export-harness] failed for ${manifestId}: ${message}`);
    try {
      await writeHarnessResult(resultPath, {
        success: false,
        manifestId,
        error: message,
        stallError: message.includes(VIDEO_DECODE_STALL_ERROR),
        elapsedMs: Date.now() - startedAt,
      });
    } catch (writeError) {
      console.error(`[export-harness] failed to write result file: ${String(writeError)}`);
    }
    return 1;
  } finally {
    if (workspaceId) {
      await cleanupExportWorkspace(workspaceId).catch(() => undefined);
    }
  }
}
