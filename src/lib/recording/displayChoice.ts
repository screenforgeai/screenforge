import type { DisplayInfo } from '../../types/index';

/** "2560 × 1440", the display's size in DIPs. */
export function formatDisplaySize(display: DisplayInfo): string {
  return `${display.width} × ${display.height}`;
}
