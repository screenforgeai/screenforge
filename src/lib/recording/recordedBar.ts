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

/**
 * The crop with its top edge at `top` (0–1), everything else about it kept.
 * A top pushed down past the crop's last 5% stops there, but a crop already
 * shorter than that (the person's own) is never stretched upward to make room.
 */
export function cropRectWithTop(crop: CropRect, top: number): CropRect {
  const bottom = crop.y + crop.height;
  const limit = bottom - 0.05;
  const y = Math.max(0, top <= limit ? top : Math.max(limit, Math.min(top, crop.y)));
  return y === crop.y ? { ...crop } : { ...crop, y, height: bottom - y };
}

/** Whether this bar, with the window bar on, crops the recorded toolbar off. */
export function recordedBarCrops(frame: FrameSettings, bar: RecordedBarSettings): boolean {
  // Only crop the real toolbar when the window bar is there to replace it.
  if (activeBarStyle(frame.windowBar) === 'none' || bar.cropTop <= 0) {
    return false;
  }
  return bar.mode === 'manual' || (bar.mode === 'auto' && bar.detected === 'crop');
}

function withoutAppliedTop(bar: RecordedBarSettings): RecordedBarSettings {
  const next = { ...bar };
  delete next.appliedTop;
  return next;
}

/**
 * The frame with the recorded toolbar handled: cropped off at `bar.cropTop`
 * while the window bar is on and the mode allows it (detection, or the
 * person, settled on a line); the top edge given back when the bar or the
 * crop is switched off. The person's own crop is never widened: the toolbar
 * crop only ever adds to it (the lower of the two tops wins), and lifting it
 * returns the person's top as it was.
 */
export function applyRecordedBar(
  frame: FrameSettings,
  bar: RecordedBarSettings,
  sourceHeight: number,
): FrameSettings {
  const previous = frame.recordedBar;
  // The top is the person's unless it is still exactly what this feature set.
  const stillOurs =
    previous?.appliedTop !== undefined && Math.abs(frame.cropRect.y - previous.appliedTop) < 1e-6;
  const personTop = stillOurs ? (previous?.personTop ?? 0) : frame.cropRect.y;
  const rest = withoutAppliedTop(bar);
  if (recordedBarCrops(frame, bar)) {
    const top = Math.max(personTop, bar.cropTop / Math.max(sourceHeight, 1));
    const cropRect = cropRectWithTop(frame.cropRect, top);
    return { ...frame, cropRect, recordedBar: { ...rest, personTop, appliedTop: cropRect.y } };
  }
  return {
    ...frame,
    cropRect: stillOurs ? cropRectWithTop(frame.cropRect, personTop) : frame.cropRect,
    recordedBar: { ...rest, personTop },
  };
}

/**
 * The frame with the person's own crop reset to the whole recording: the
 * recorded toolbar's crop, when it is on, stays.
 */
export function withFullCrop(frame: FrameSettings): FrameSettings {
  const full = { ...frame, cropRect: { x: 0, y: 0, width: 1, height: 1 } };
  const bar = frame.recordedBar;
  if (!bar) {
    return full;
  }
  return applyRecordedBar({ ...full, recordedBar: withoutAppliedTop(bar) }, bar, bar.height);
}

/** The mode a person picks, applied: Auto goes back to detection's own line. */
export function withRecordedBarMode(
  bar: RecordedBarSettings,
  mode: RecordedBarCropMode,
): RecordedBarSettings {
  return mode === 'auto' && bar.detectedTop !== undefined
    ? { ...bar, mode, cropTop: bar.detectedTop }
    : { ...bar, mode };
}

/**
 * Detection's answer, found on frames scaled to `sampleHeight` rows, as the
 * recording's own settings: the crop line in the video's rows.
 */
export function recordedBarFromDetection(
  detection: { action: RecordedBarSettings['detected']; cropTop: number },
  sampleHeight: number,
  video: { width: number; height: number },
  mode: RecordedBarCropMode = 'auto',
): RecordedBarSettings {
  const cropTop = Math.round((detection.cropTop * video.height) / Math.max(sampleHeight, 1));
  return {
    mode,
    detected: detection.action,
    cropTop,
    detectedTop: cropTop,
    width: video.width,
    height: video.height,
  };
}

/** The frame with a new window bar, the recorded toolbar's crop following it on or off. */
export function withWindowBar(
  frame: FrameSettings,
  windowBar: NonNullable<FrameSettings['windowBar']>,
): FrameSettings {
  const next = { ...frame, windowBar };
  return next.recordedBar
    ? applyRecordedBar(next, next.recordedBar, next.recordedBar.height)
    : next;
}
