/**
 * Builds the hidden capture window's params from the editor state. Shared by
 * the export itself and the background pre-render, so both produce the same
 * chunk keys for the same project.
 */
import type { CaptureStoreSnapshot, CaptureWindowParams, ExportSettings } from '../../types';
import { useStore } from '../../store';
import { createCaptureStoreSnapshot } from './captureSnapshot';
import { getCustomWallpaperUrl } from '../effects/frame/wallpapers';
import { normalizeExportFpsForFormat } from './gif';
import { computeRequestedExportSize, computeTimelineDuration } from './planning';
import {
  estimateEncodedVideoBytes,
  isRandomAccessMuxFormat,
  resolveSupportedExportTarget,
} from './support';

export type PreparedCaptureParams = Omit<CaptureWindowParams, 'workspaceId' | 'jobId'>;

export interface PreparedExportCapture {
  params: PreparedCaptureParams;
  effectiveFps: number;
  duration: number;
  warnings: string[];
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  if (bytes >= 1_000_000) {
    return `${Math.round(bytes / 1_000_000)} MB`;
  }
  if (bytes >= 1_000) {
    return `${Math.round(bytes / 1_000)} KB`;
  }
  return `${Math.round(bytes)} B`;
}

export async function prepareExportCapture(
  settings: ExportSettings,
  assertNotCancelled: () => void = () => undefined,
): Promise<PreparedExportCapture> {
  const {
    recordingResult,
    mediaSegments,
    frame,
    cursorClickSound,
    cursorClickSoundVolume,
    cursorEnabled,
    zoomClips,
    textClips,
    camera,
    keyboard,
    captions,
    cursorStyle,
    cursorSize,
    cursorClickEffect,
    cursorHalflife,
    cursorMotionBlur,
    cursorMaxTilt,
    cursorHideWhenIdle,
    cursorIdleHideSeconds,
    cursorEffect,
    cursorClickShrink,
    cursorColor,
    cursorLabel,
    musicClips,
    cameraClips,
    maskClips,
    motionClips,
    hiddenLayers,
  } = useStore.getState();
  if (!recordingResult) {
    throw new Error('No recording loaded');
  }

  const sourceInfo = await window.screenforge.probeExportSource(recordingResult.filePath);
  assertNotCancelled();
  const effectiveFps = normalizeExportFpsForFormat(settings.format, settings.fps);
  const sourceFps = sourceInfo.fps != null && sourceInfo.fps > 0 ? sourceInfo.fps : effectiveFps;

  // Compute output dimensions by fitting the source canvas (which has the
  // frame geometry's actual aspect ratio, e.g. 16:10 from a MacBook display)
  // into the selected resolution's bounding box while preserving aspect ratio.
  // Fixed 16:9 targets would squish non-16:9 recordings.
  const srcW = sourceInfo.width ?? 1280;
  const srcH = sourceInfo.height ?? 800;
  const { width: requestedTargetWidth, height: requestedTargetHeight } = computeRequestedExportSize(
    frame,
    srcW,
    srcH,
    settings.resolution,
  );
  const duration = computeTimelineDuration(recordingResult.duration, mediaSegments);

  const warnings: string[] = [];
  if (settings.format === 'gif' && effectiveFps !== settings.fps) {
    warnings.push(
      `GIF exports are normalized to ${effectiveFps} FPS for smoother playback across apps.`,
    );
  }

  const supportedTarget = await resolveSupportedExportTarget({
    format: settings.format,
    quality: settings.quality,
    resolution: settings.resolution,
    width: requestedTargetWidth,
    height: requestedTargetHeight,
    fps: effectiveFps,
  });

  if (!supportedTarget) {
    throw new Error(
      `This system cannot encode ${settings.format.toUpperCase()} exports at ${requestedTargetWidth}x${requestedTargetHeight} @ ${effectiveFps} FPS. Try a lower resolution or frame rate.`,
    );
  }

  if (supportedTarget.capped) {
    warnings.push(
      `Your system cannot encode ${requestedTargetWidth}x${requestedTargetHeight} for this export profile. Screenforge will cap the export to ${supportedTarget.width}x${supportedTarget.height}.`,
    );
  }

  if (isRandomAccessMuxFormat(settings.format)) {
    const estimatedVideoBytes = estimateEncodedVideoBytes(
      settings.quality,
      settings.resolution,
      duration,
    );
    if (estimatedVideoBytes >= 400_000_000) {
      warnings.push(
        `This ${settings.format.toUpperCase()} export may buffer about ${formatBytes(
          estimatedVideoBytes,
        )} of encoded video in memory before finalization. Longer high-resolution exports can use a lot of memory or fail.`,
      );
    }
  }

  // Snapshot the relevant Zustand store fields so the hidden capture window
  // can reconstruct the same rendering state without importing renderer modules.
  const captionsOverride =
    settings.burnCaptions && captions.segments.length > 0
      ? { ...captions, captionsEnabled: true }
      : undefined;
  const storeSnapshot: CaptureStoreSnapshot = createCaptureStoreSnapshot(
    {
      frame,
      zoomClips,
      textClips,
      camera,
      keyboard,
      cursorEnabled,
      cursorStyle,
      cursorSize,
      cursorClickEffect,
      cursorHalflife,
      cursorMotionBlur,
      cursorMaxTilt,
      cursorHideWhenIdle,
      cursorIdleHideSeconds,
      cursorEffect,
      cursorClickShrink,
      cursorColor,
      cursorLabel,
      cameraClips,
      maskClips,
      // A hidden Motion lane exports without motion, matching the preview.
      motionClips: hiddenLayers.motion ? [] : motionClips,
    },
    captionsOverride,
  );

  return {
    params: {
      recording: recordingResult,
      mediaSegments,
      frame,
      storeSnapshot,
      duration,
      fps: effectiveFps,
      sourceFps,
      targetWidth: supportedTarget.width,
      targetHeight: supportedTarget.height,
      format: settings.format,
      quality: settings.quality,
      resolution: settings.resolution,
      includeAudio: settings.includeAudio,
      cursor: {
        clickSound: cursorClickSound,
        clickSoundVolume: cursorClickSoundVolume,
      },
      customWallpaperDataUrl: getCustomWallpaperUrl(),
      musicClips: musicClips,
    },
    effectiveFps,
    duration,
    warnings,
  };
}
