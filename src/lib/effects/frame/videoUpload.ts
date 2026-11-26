export interface VideoCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What the GPU copy of the screen video holds: the frame and, for the cropped
 * path, which pixels of it. The same key means the texture already has those
 * pixels. Null means the source does not say which frame it shows (export
 * passes no frame id), so every tick uploads, as before.
 */
export function videoUploadKey(
  path: 'whole' | 'crop',
  frameId: number | undefined,
  crop: VideoCropRect,
): string | null {
  if (frameId === undefined) {
    return null;
  }
  if (path === 'whole') {
    return `whole:${frameId}`;
  }
  return `crop:${frameId}:${crop.x},${crop.y},${crop.width},${crop.height}`;
}

/** Whether the texture must be refreshed to show the frame `nextKey` names. */
export function needsVideoUpload(lastKey: string | null, nextKey: string | null): boolean {
  return nextKey === null || nextKey !== lastKey;
}
