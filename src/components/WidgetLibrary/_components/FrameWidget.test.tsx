import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FRAME, useStore } from 'src/store';
import type { RecordingResult } from 'src/types';
import { FrameWidget } from './FrameWidget';

const RECORDING_RESULT: RecordingResult = {
  filePath: '/tmp/test-recording.mp4',
  mouseData: [],
  duration: 12,
  startTime: 0,
  recordingArea: {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  },
};

beforeEach(() => {
  act(() => {
    useStore.getState().resetEditorSession();
    useStore.getState().loadRecordingSession(RECORDING_RESULT);
    useStore.getState().clearPendingPauseSeek();
    useStore.getState().setFrame(DEFAULT_FRAME);
    useStore.getState().setActiveWidget('frame');
  });
});

afterEach(() => {
  cleanup();
});

describe('FrameWidget crop mode', () => {
  it('does not reopen crop mode after switching widgets before pause-seek completes', async () => {
    const user = userEvent.setup();

    render(<FrameWidget />);

    await user.click(screen.getByRole('button', { name: /edit crop/i }));

    expect(useStore.getState().pendingPauseSeekTime).not.toBeNull();
    expect(useStore.getState().isCropEditing).toBe(false);

    act(() => {
      useStore.getState().setActiveWidget('camera');
    });

    expect(useStore.getState().isCropEditing).toBe(false);

    act(() => {
      useStore.getState().clearPendingPauseSeek();
    });

    await waitFor(() => {
      expect(useStore.getState().pendingPauseSeekTime).toBeNull();
      expect(useStore.getState().isCropEditing).toBe(false);
    });
  });
});
