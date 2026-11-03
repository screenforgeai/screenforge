import { describe, expect, it } from 'vitest';
import {
  TOOLBAR_COMPACT_H,
  TOOLBAR_EXPANDED_H,
  getBottomAnchoredBounds,
  getToolbarViewportHeight,
} from './toolbarViewport';

describe('toolbar viewport sizing', () => {
  it('maps viewport modes to expected heights', () => {
    expect(getToolbarViewportHeight('compact')).toBe(TOOLBAR_COMPACT_H);
    expect(getToolbarViewportHeight('expanded')).toBe(TOOLBAR_EXPANDED_H);
  });

  it('keeps the bottom edge fixed when expanding', () => {
    const initialBounds = { x: 120, y: 900, width: 520, height: TOOLBAR_COMPACT_H };
    const nextBounds = getBottomAnchoredBounds(initialBounds, TOOLBAR_EXPANDED_H);

    expect(nextBounds).toEqual({
      x: 120,
      y: 900 + TOOLBAR_COMPACT_H - TOOLBAR_EXPANDED_H,
      width: 520,
      height: TOOLBAR_EXPANDED_H,
    });
    expect(nextBounds.y + nextBounds.height).toBe(initialBounds.y + initialBounds.height);
  });

  it('keeps the bottom edge fixed when collapsing', () => {
    const initialBounds = { x: 120, y: 684, width: 520, height: TOOLBAR_EXPANDED_H };
    const nextBounds = getBottomAnchoredBounds(initialBounds, TOOLBAR_COMPACT_H);

    expect(nextBounds).toEqual({
      x: 120,
      y: 684 + TOOLBAR_EXPANDED_H - TOOLBAR_COMPACT_H,
      width: 520,
      height: TOOLBAR_COMPACT_H,
    });
    expect(nextBounds.y + nextBounds.height).toBe(initialBounds.y + initialBounds.height);
  });
});
