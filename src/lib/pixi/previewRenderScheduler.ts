/**
 * How long the paused preview keeps drawing after the last change. Effects smooth
 * with the frame delta (the cursor spring, clip fades), so the scene needs a few
 * hundred milliseconds of frames to come to rest after an edit or a seek.
 */
export const PREVIEW_SETTLE_MS = 1_000;

export interface PreviewRenderScheduler {
  /** Something the preview shows changed at `now` (ms). */
  markDirty: (now: number) => void;
  /** Whether the frame at `now` (ms) should be drawn. */
  shouldRender: (now: number, playing: boolean) => boolean;
}

/**
 * Decides when the preview draws: every frame while the video plays, and while
 * paused only until the scene has settled after the last change.
 */
export function createPreviewRenderScheduler(
  settleMs: number = PREVIEW_SETTLE_MS,
): PreviewRenderScheduler {
  let lastDirtyAt = Number.NEGATIVE_INFINITY;
  return {
    markDirty: (now) => {
      lastDirtyAt = Math.max(lastDirtyAt, now);
    },
    shouldRender: (now, playing) => playing || now - lastDirtyAt < settleMs,
  };
}
