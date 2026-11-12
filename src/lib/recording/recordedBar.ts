/**
 * Cropping a person's own browser toolbar off their recording, so the
 * window bar replaces it instead of stacking a second bar on top. Detection
 * itself is window-bar/recorded-toolbar.ts; this decides when it applies and
 * turns its answer into the frame's crop.
 */
import type { CropRect, FrameSettings, RecordedBarSettings } from '../effects/frame';
import { activeBarStyle, type RecordedBarCropMode } from '../window-bar';
import type { RecordingCaptureSource, RecordingResult } from '../../types/index';

export type RecordedBarEligibility =
  /** A window: look for a toolbar. */
  | 'detect'
  /** A browser tab shared on its own: the page alone, no toolbar in it. */
  | 'tab'
  /** A whole screen or a selected area: no single window, so no window bar by default. */
  | 'screen'
  /** An import, or a recording from before the source was kept. */
  | 'unknown';

export function recordedBarEligibility(
  source: RecordingCaptureSource | undefined,
): RecordedBarEligibility {
  if (!source) {
    return 'unknown';
  }
  if (source.displaySurface === 'browser') {
    return 'tab';
  }
  if (source.displaySurface === 'monitor' || source.kind !== 'window') {
    return 'screen';
  }
  return 'detect';
}

/** Whether detection should run for this recording: an eligible window not yet looked at. */
export function shouldDetectRecordedBar(
  result: RecordingResult | null | undefined,
  frame: FrameSettings,
): boolean {
  return (
    !!result &&
    !result.isImported &&
    recordedBarEligibility(result.captureSource) === 'detect' &&
    !frame.recordedBar
  );
}

/** The crop with its top edge at `cropTop` source rows, everything else about it kept. */
export function cropRectWithTop(crop: CropRect, cropTop: number, sourceHeight: number): CropRect {
  const bottom = crop.y + crop.height;
  const top = Math.min(Math.max(0, cropTop / Math.max(sourceHeight, 1)), bottom - 0.05);
  return { ...crop, y: top, height: bottom - top };
}

/**
 * The frame with the recorded toolbar handled: cropped off at `bar.cropTop`
 * while the window bar is on and the mode allows it (detection, or the
 * person, settled on a line); the top edge restored when the bar or the
 * crop is switched off.
 */
export function applyRecordedBar(
  frame: FrameSettings,
  bar: RecordedBarSettings,
  sourceHeight: number,
): FrameSettings {
  const previous = frame.recordedBar;
  // Only undo a top crop this feature put there, never one the person drew.
  const ownTop =
    previous && previous.mode !== 'off' && previous.cropTop > 0
      ? previous.cropTop / Math.max(sourceHeight, 1)
      : null;
  const ownsTop = ownTop !== null && Math.abs(frame.cropRect.y - ownTop) < 1e-6;
  // Only crop the real toolbar when the window bar is there to replace it.
  const barOn = activeBarStyle(frame.windowBar) !== 'none';
  const crops =
    barOn &&
    (bar.mode === 'manual' || (bar.mode === 'auto' && bar.detected === 'crop' && bar.cropTop > 0));
  let cropRect = frame.cropRect;
  if (crops && bar.cropTop > 0) {
    cropRect = cropRectWithTop(frame.cropRect, bar.cropTop, sourceHeight);
  } else if (ownsTop) {
    cropRect = cropRectWithTop(frame.cropRect, 0, sourceHeight);
  }
  return { ...frame, cropRect, recordedBar: { ...bar } };
}

/** The mode a person picks, applied: Auto goes back to what detection said. */
export function withRecordedBarMode(
  bar: RecordedBarSettings,
  mode: RecordedBarCropMode,
): RecordedBarSettings {
  return { ...bar, mode };
}

/**
 * Detection's answer, found on frames scaled to `sampleHeight` rows, as the
 * recording's own settings: the crop line in the video's rows.
 */
export function recordedBarFromDetection(
  detection: { action: 'crop' | 'adjust' | 'none'; cropTop: number },
  sampleHeight: number,
  video: { width: number; height: number },
  mode: RecordedBarCropMode = 'auto',
): RecordedBarSettings {
  return {
    mode,
    detected: detection.action,
    cropTop: Math.round((detection.cropTop * video.height) / Math.max(sampleHeight, 1)),
    width: video.width,
    height: video.height,
  };
}
