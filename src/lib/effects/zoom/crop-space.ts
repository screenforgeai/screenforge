import type { RecordingArea, RecordingResult } from '../../../types/index';
import type { CropRect, FrameSettings } from '../frame';

/**
 * Zoom works in the space of the picture on screen: 0–1 across the frame's
 * crop. Cursor and click positions are 0–1 across the whole recording, so
 * zoom converts them with these before using them. Without a crop the two
 * spaces are the same and nothing changes.
 */

interface NormalizedPoint {
  nx: number;
  ny: number;
}

const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

function isFullCrop(crop: CropRect): boolean {
  return crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
}

/**
 * The crop the picture on screen has right now. While the crop is being
 * edited the preview shows the whole recording, so zoom does too.
 */
export function getZoomCrop(state: { frame: FrameSettings; isCropEditing?: boolean }): CropRect {
  return state.isCropEditing ? FULL_CROP : state.frame.cropRect;
}

/** A position across the whole recording, as a position across the crop. */
export function toCropSpacePoint<T extends NormalizedPoint>(point: T, crop: CropRect): T {
  if (isFullCrop(crop)) {
    return point;
  }
  return {
    ...point,
    nx: (point.nx - crop.x) / crop.width,
    ny: (point.ny - crop.y) / crop.height,
  };
}

function cropArea<T extends RecordingArea>(area: T, crop: CropRect): T {
  return {
    ...area,
    x: area.x + crop.x * area.width,
    y: area.y + crop.y * area.height,
    width: area.width * crop.width,
    height: area.height * crop.height,
  };
}

/**
 * The recording as zoom analysis should see it: its capture bounds narrowed
 * to the crop, so every cursor and click position comes out across the crop.
 */
export function toCropSpaceRecording(recording: RecordingResult, crop: CropRect): RecordingResult {
  if (isFullCrop(crop)) {
    return recording;
  }
  return {
    ...recording,
    recordingArea: cropArea(recording.recordingArea, crop),
    captureBoundsTimeline: recording.captureBoundsTimeline?.map((sample) => cropArea(sample, crop)),
  };
}
