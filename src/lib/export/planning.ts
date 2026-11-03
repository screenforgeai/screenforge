import type { ExportResolution } from '../../types';
import type { MediaSegment } from '../../types/timeline';
import type { FrameSettings } from '../effects/frame';
import { getFrameGeometry } from '../effects/frame';

export const RESOLUTION_MAX_DIMS: Record<ExportResolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
};

export function roundEven(value: number): number {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

export function computeTimelineDuration(
  recordingDuration: number,
  mediaSegments: Pick<MediaSegment, 'timelineEnd'>[],
): number {
  if (mediaSegments.length === 0) {
    return recordingDuration;
  }

  return mediaSegments.reduce((max, segment) => Math.max(max, segment.timelineEnd), 0);
}

export function computeRequestedExportSize(
  frame: FrameSettings,
  sourceWidth: number,
  sourceHeight: number,
  resolution: ExportResolution,
): { width: number; height: number } {
  const maxDims = RESOLUTION_MAX_DIMS[resolution];
  const geometry = getFrameGeometry(frame, Math.max(1, sourceWidth), Math.max(1, sourceHeight));

  // Fit the canvas into the resolution's bounding box while preserving aspect
  // ratio. Use orientation-aware max dims so portrait/square presets produce
  // correct output dimensions: 9:16 at 1080p → 1080×1920, 1:1 → 1080×1080.
  const maxDimLong = Math.max(maxDims.width, maxDims.height);
  const maxDimShort = Math.min(maxDims.width, maxDims.height);
  const geoLong = Math.max(geometry.canvasWidth, geometry.canvasHeight);
  const geoShort = Math.min(geometry.canvasWidth, geometry.canvasHeight);

  const scale = Math.min(maxDimLong / Math.max(geoLong, 1), maxDimShort / Math.max(geoShort, 1));

  return {
    width: roundEven(geometry.canvasWidth * scale),
    height: roundEven(geometry.canvasHeight * scale),
  };
}
