import { windowBarHeight } from './layout';
import type { WindowBarStyle } from './types';

export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowFit {
  /** Bar and page together: what the preset's radius and shadow wrap. */
  window: BarRect;
  /** The page (the recording) under the bar. */
  media: BarRect;
  barHeight: number;
}

/**
 * Fits a window (a bar over a `mediaWidth` x `mediaHeight` page) inside a
 * box, centered, as large as it goes: the page keeps its shape and the bar
 * takes its height from the window's width.
 */
export function fitWindowWithBar(
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
  mediaWidth: number,
  mediaHeight: number,
  style: WindowBarStyle,
): WindowFit {
  const ratio = mediaHeight / Math.max(mediaWidth, 1);
  const fits = (w: number) => w * ratio + windowBarHeight(style, w) <= boxHeight;
  let width = boxWidth;
  if (!fits(width)) {
    // Height-bound. The window's height grows with its width (page and bar
    // both do), so the widest width that fits is a bisection away.
    let lo = 0;
    let hi = boxWidth;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    width = lo;
  }
  const bar = windowBarHeight(style, width);
  const pageHeight = width * ratio;
  const totalHeight = pageHeight + bar;
  const x = boxX + (boxWidth - width) / 2;
  const y = boxY + (boxHeight - totalHeight) / 2;
  return {
    window: { x, y, width, height: totalHeight },
    media: { x, y: y + bar, width, height: pageHeight },
    barHeight: bar,
  };
}
