import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from 'src/store';
import type { RecordingResult } from 'src/types';
import { CursorWidget } from './CursorWidget';

const audition = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('../../../lib/effects/cursor/audio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/effects/cursor/audio')>()),
  auditionCursorClickSound: audition,
}));

const RECORDING: RecordingResult = {
  filePath: '/tmp/test-recording.mp4',
  mouseData: [],
  duration: 5,
  startTime: 1_000,
  recordingArea: { x: 0, y: 0, width: 1920, height: 1080 },
};

beforeEach(() => {
  audition.mockClear();
  act(() => {
    useStore.getState().resetEditorSession();
    useStore.getState().loadRecordingSession(RECORDING);
    useStore.getState().setActiveWidget('cursor');
  });
});

afterEach(() => {
  cleanup();
});

const clickSoundSection = () => screen.getByText('Click sound').parentElement as HTMLElement;
const tile = (name: string) => within(clickSoundSection()).getByRole('radio', { name });

describe('CursorWidget click sound', () => {
  it('starts with no sound and no volume slider', () => {
    render(<CursorWidget />);

    expect(screen.getByText('Click sound')).toBeInTheDocument();
    expect(tile('None')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('Volume')).not.toBeInTheDocument();
  });

  it('selects a sound, plays it, and shows the volume slider', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    await user.click(tile('Trackpad'));

    expect(useStore.getState().cursorClickSound).toBe('trackpad');
    expect(audition).toHaveBeenCalledWith('trackpad', 0.5);
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(within(clickSoundSection()).getAllByText('50%').length).toBeGreaterThan(0);
  });

  it('replays the selected sound when its tile is clicked again', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    await user.click(tile('Soft'));
    await user.click(tile('Soft'));

    expect(useStore.getState().cursorClickSound).toBe('soft');
    expect(audition).toHaveBeenCalledTimes(2);
  });

  it('hides the volume slider when the sound is turned off', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    await user.click(tile('Pop'));
    await user.click(tile('None'));

    expect(useStore.getState().cursorClickSound).toBe('none');
    expect(screen.queryByText('Volume')).not.toBeInTheDocument();
  });

  it('can be undone', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    await user.click(tile('Mouse'));
    act(() => {
      useStore.getState().undo();
    });

    expect(useStore.getState().cursorClickSound).toBe('none');
  });
});
