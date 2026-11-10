import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './index';
import type { ScreenshotCapture } from '../types';

const capture: ScreenshotCapture = {
  kind: 'area',
  dataUrl: 'data:image/png;base64,abc',
  width: 10,
  height: 10,
};

describe('screenshot editor state', () => {
  beforeEach(() => {
    useStore.getState().closeScreenshotEditor();
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
});
