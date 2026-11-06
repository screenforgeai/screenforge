import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FRAME, useStore } from 'src/store';
import type { RecordingResult } from 'src/types';
import { LogoSection } from './LogoSection';

const RECORDING_RESULT: RecordingResult = {
  filePath: '/tmp/test-recording.mp4',
  mouseData: [],
  duration: 12,
  startTime: 0,
  recordingArea: { x: 0, y: 0, width: 1920, height: 1080 },
};

const LOGO = {
  src: 'data:image/png;base64,AA==',
  corner: 'bottom-right' as const,
  size: 0.1,
  opacity: 100,
};

beforeEach(() => {
  act(() => {
    useStore.getState().resetEditorSession();
    useStore.getState().loadRecordingSession(RECORDING_RESULT);
    useStore.getState().setFrame(DEFAULT_FRAME);
  });
});

afterEach(() => {
  cleanup();
});

describe('LogoSection', () => {
  it('adds a logo from an image file', async () => {
    const user = userEvent.setup();
    render(<LogoSection />);

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', {
      type: 'image/png',
    });
    await user.upload(screen.getByLabelText('Logo image'), file);

    await waitFor(() => {
      expect(useStore.getState().frame.logo).toEqual({
        src: expect.stringMatching(/^data:image\/png;base64,/),
        corner: 'bottom-right',
        size: 0.1,
        opacity: 100,
      });
    });
  });

  it('moves the logo to another corner and removes it, both undoable', async () => {
    const user = userEvent.setup();
    act(() => useStore.getState().setFrame({ ...DEFAULT_FRAME, logo: LOGO }));
    render(<LogoSection />);

    await user.click(screen.getByRole('radio', { name: 'Top left' }));
    expect(useStore.getState().frame.logo?.corner).toBe('top-left');

    await user.click(screen.getByRole('button', { name: 'Remove logo' }));
    expect(useStore.getState().frame.logo ?? null).toBeNull();

    act(() => useStore.getState().undo());
    expect(useStore.getState().frame.logo?.corner).toBe('top-left');
  });
});
