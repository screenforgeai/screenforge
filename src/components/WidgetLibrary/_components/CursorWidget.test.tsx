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
const trigger = () => within(clickSoundSection()).getByRole('combobox');

async function openDropdown(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger());
  return screen.getByRole('listbox');
}

describe('CursorWidget click sound', () => {
  it('starts with no sound and no volume slider', () => {
    render(<CursorWidget />);

    expect(trigger()).toHaveTextContent('None');
    expect(within(clickSoundSection()).queryByText('Volume')).not.toBeInTheDocument();
  });

  it('lists every sound with a play button, except None', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    const listbox = await openDropdown(user);

    expect(
      within(listbox)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['None', 'Soft', 'Mouse', 'Trackpad', 'Pop', 'Tick']);
    for (const name of ['Soft', 'Mouse', 'Trackpad', 'Pop', 'Tick']) {
      expect(screen.getByRole('button', { name: `Play ${name}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Play None' })).not.toBeInTheDocument();
  });

  it('plays an option without selecting it or closing the list', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    await openDropdown(user);
    await user.click(screen.getByRole('button', { name: 'Play Pop' }));

    expect(audition).toHaveBeenCalledWith('pop', 0.5);
    expect(useStore.getState().cursorClickSound).toBe('none');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('selects a sound, plays it, and shows the volume slider', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    await openDropdown(user);
    await user.click(screen.getByRole('option', { name: 'Trackpad' }));

    expect(useStore.getState().cursorClickSound).toBe('trackpad');
    expect(audition).toHaveBeenCalledWith('trackpad', 0.5);
    expect(trigger()).toHaveTextContent('Trackpad');
    expect(within(clickSoundSection()).getByText('Volume')).toBeInTheDocument();
  });

  it('hides the volume slider when the sound is turned off', async () => {
    const user = userEvent.setup();
    act(() => {
      useStore.getState().setCursorClickSound('pop');
    });
    render(<CursorWidget />);

    await openDropdown(user);
    await user.click(screen.getByRole('option', { name: 'None' }));

    expect(useStore.getState().cursorClickSound).toBe('none');
    expect(within(clickSoundSection()).queryByText('Volume')).not.toBeInTheDocument();
  });

  it('can be undone', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    await openDropdown(user);
    await user.click(screen.getByRole('option', { name: 'Mouse' }));
    act(() => {
      useStore.getState().undo();
    });

    expect(useStore.getState().cursorClickSound).toBe('none');
  });
});
