import type { CSSProperties } from 'react';

/**
 * The timeline panel's size. It changes instantly: animating height re-laid out
 * the whole editor and resized the preview canvas on every animation frame, both
 * when toggling focus mode and on every move of the divider drag.
 */
export function getTimelineWrapperStyle({
  focusMode,
  height,
  maxHeight,
  minHeight,
}: {
  focusMode: boolean;
  height: number;
  maxHeight: number;
  minHeight: number;
}): CSSProperties {
  return {
    height: focusMode ? minHeight : height,
    maxHeight: focusMode ? minHeight : maxHeight,
    background: '#0d0d0f',
  };
}
