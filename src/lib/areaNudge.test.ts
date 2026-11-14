import { describe, expect, it } from 'vitest';
import { nudgeForKey } from './areaNudge';

const viewport = { width: 1000, height: 800 };
const rect = { x: 100, y: 100, width: 200, height: 100 };

describe('nudgeForKey', () => {
  it('moves the selection 1px per arrow key', () => {
    expect(nudgeForKey(rect, 'ArrowLeft', false, viewport)).toEqual({ ...rect, x: 99 });
    expect(nudgeForKey(rect, 'ArrowDown', false, viewport)).toEqual({ ...rect, y: 101 });
  });

  it('moves 10px with Shift', () => {
    expect(nudgeForKey(rect, 'ArrowRight', true, viewport)).toEqual({ ...rect, x: 110 });
    expect(nudgeForKey(rect, 'ArrowUp', true, viewport)).toEqual({ ...rect, y: 90 });
  });

  it('keeps the selection on screen', () => {
    expect(nudgeForKey({ ...rect, x: 3 }, 'ArrowLeft', true, viewport)).toEqual({ ...rect, x: 0 });
    expect(nudgeForKey({ ...rect, y: 695 }, 'ArrowDown', true, viewport)).toEqual({
      ...rect,
      y: 700,
    });
  });

  it('ignores other keys', () => {
    expect(nudgeForKey(rect, 'a', false, viewport)).toBeNull();
  });
});
