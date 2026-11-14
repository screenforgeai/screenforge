import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from './index';
import type { ScreenshotCapture } from '../types';

const capture: ScreenshotCapture = {
  kind: 'area',
  imageUrl: 'blob:screenforge/a',
  width: 10,
  height: 10,
};

describe('screenshot editor state', () => {
  beforeEach(() => {
    URL.revokeObjectURL = vi.fn();
    useStore.getState().closeScreenshotEditor();
    vi.mocked(URL.revokeObjectURL).mockClear();
  });

  it('starts closed', () => {
    expect(useStore.getState().screenshotCapture).toBeNull();
  });

  it('opens and closes without touching undo history or the edit version', () => {
    const before = useStore.getState();
    before.openScreenshotEditor(capture);
    expect(useStore.getState().screenshotCapture).toEqual(capture);
    expect(useStore.getState().past).toBe(before.past);
    expect(useStore.getState().editVersion).toBe(before.editVersion);
    useStore.getState().closeScreenshotEditor();
    expect(useStore.getState().screenshotCapture).toBeNull();
  });

  it("frees the capture's blob URL when it closes or is replaced", () => {
    const { openScreenshotEditor, closeScreenshotEditor } = useStore.getState();
    openScreenshotEditor(capture);
    openScreenshotEditor(capture);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    openScreenshotEditor({ ...capture, imageUrl: 'blob:screenforge/b' });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:screenforge/a');

    closeScreenshotEditor();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:screenforge/b');
  });
});
