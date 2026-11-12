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
  let width = boxWidth;
  let bar = windowBarHeight(style, width);
  if (width * ratio + bar > boxHeight) {
    // Height-bound: the bar's height depends on the width it ends up at, so
    // settle the two together (it converges in a few steps: the bar changes
    // far less than the page does).
    width = Math.max(0, (boxHeight - bar) / Math.max(ratio, 1e-6));
    for (let i = 0; i < 8; i++) {
      bar = windowBarHeight(style, width);
      const next = Math.max(0, (boxHeight - bar) / Math.max(ratio, 1e-6));
      if (Math.abs(next - width) < 0.01) {
        width = next;
        break;
      }
      width = next;
    }
    width = Math.min(width, boxWidth);
    bar = windowBarHeight(style, width);
  }
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
