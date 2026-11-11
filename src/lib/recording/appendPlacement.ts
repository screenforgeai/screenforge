import type { AreaCrop, ConcatRecordingsOptions, ExportSourceInfo } from '../../types';
import { getFrameGeometry, type FrameSettings } from '../effects/frame';

function isFullCrop(frame: FrameSettings): boolean {
  const { x, y, width, height } = frame.cropRect;
  return x === 0 && y === 0 && width === 1 && height === 1;
}

/**
 * How to join a clip onto the project's video. An appended area recording is
 * cut to its area, and when the project is cropped the clip goes inside the
 * crop's exact pixels, so it fills the picture the editor shows instead of
 * being cut off by the crop.
 */
export async function getAppendPlacement(
  firstPath: string,
  frame: FrameSettings,
  appendedAreaCrop: AreaCrop | undefined,
  probe: (filePath: string) => Promise<ExportSourceInfo>,
): Promise<ConcatRecordingsOptions> {
  const placement: ConcatRecordingsOptions = {};

  if (appendedAreaCrop) {
    const { x, y, width, height } = appendedAreaCrop;
    placement.secondCrop = { x, y, width, height };
  }

  if (!isFullCrop(frame)) {
    const first = await probe(firstPath).catch(() => null);
    if (first?.width && first?.height) {
      placement.target = getFrameGeometry(frame, first.width, first.height).cropRectPixels;
    }
  }

  return placement;
}
