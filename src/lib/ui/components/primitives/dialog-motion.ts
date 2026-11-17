/*
 * Open/close motion shared by Dialog and AlertDialog content.
 *
 * Only `opacity` and a single `transform` string are animated, so motion hands
 * both to the compositor (WAAPI) and the animation keeps its frame rate while
 * React mounts the modal's body and the editor works behind it. No `filter:
 * blur()`: a blur on the full-window overlay or the content is re-rasterized
 * every frame and was the costliest part of opening a modal.
 *
 * A short tween rather than the old spring: that one took ~0.5s to settle, and
 * on close its exit kept the overlay catching clicks for just as long. The 3D
 * perspective flip is gone with it; a small slide and scale reads the same.
 */

export type DialogMotionDirection = 'top' | 'bottom' | 'left' | 'right';

export const DIALOG_ENTER_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;
export const DIALOG_EXIT_TRANSITION = { duration: 0.12, ease: [0.4, 0, 1, 1] } as const;
export const DIALOG_OVERLAY_TRANSITION = { duration: 0.15, ease: 'easeOut' } as const;

export const DIALOG_SHOWN_TRANSFORM = 'translate(0px, 0px) scale(1)';

const ENTER_OFFSET_PX = 8;

/** Where the content starts (and ends on close): nudged toward `from`, slightly smaller. */
export const dialogHiddenTransform = (from: DialogMotionDirection): string => {
  const d = ENTER_OFFSET_PX;
  const [x, y] =
    from === 'top' ? [0, -d] : from === 'bottom' ? [0, d] : from === 'left' ? [-d, 0] : [d, 0];
  return `translate(${x}px, ${y}px) scale(0.96)`;
};
