import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPreviewDrawing, onPreviewDrawingChanged, setPreviewDrawing } from './previewActivity';

afterEach(() => {
  setPreviewDrawing(false);
});

describe('previewActivity', () => {
  it('tells listeners when the preview starts and stops drawing, once per change', () => {
    const listener = vi.fn();
    const unsubscribe = onPreviewDrawingChanged(listener);

    setPreviewDrawing(true);
    setPreviewDrawing(true);
    expect(isPreviewDrawing()).toBe(true);
    setPreviewDrawing(false);
    expect(listener.mock.calls).toEqual([[true], [false]]);

    unsubscribe();
    setPreviewDrawing(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
