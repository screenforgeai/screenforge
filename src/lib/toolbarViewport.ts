import type { ToolbarViewportMode } from 'src/types';

export const TOOLBAR_W = 760;
export const TOOLBAR_COMPACT_H = 84;
export const TOOLBAR_EXPANDED_H = 300;

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function getToolbarViewportHeight(mode: ToolbarViewportMode): number {
  return mode === 'expanded' ? TOOLBAR_EXPANDED_H : TOOLBAR_COMPACT_H;
}

export function getBottomAnchoredBounds(bounds: WindowBounds, nextHeight: number): WindowBounds {
  const bottom = bounds.y + bounds.height;

  return {
    ...bounds,
    y: bottom - nextHeight,
    height: nextHeight,
  };
}
