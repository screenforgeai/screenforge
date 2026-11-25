import { afterEach, describe, expect, it, vi } from 'vitest';
import { onPreviewInvalidated } from '../../pixi/previewInvalidation';
import { isKeyboardPreviewActive, triggerKeyboardPreview } from './preview';

describe('keyboard shortcut sample', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('wakes the paused preview to show the sample, and again to take it away', () => {
    vi.useFakeTimers();
    const invalidated = vi.fn();
    const off = onPreviewInvalidated(invalidated);

    triggerKeyboardPreview();
    expect(isKeyboardPreviewActive()).toBe(true);
    expect(invalidated).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_100);
    expect(isKeyboardPreviewActive()).toBe(false);
    expect(invalidated).toHaveBeenCalledTimes(2);
    off();
  });
});
