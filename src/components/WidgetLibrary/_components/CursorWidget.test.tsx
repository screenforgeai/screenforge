import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from 'src/store';
import type { RecordingResult } from 'src/types';
import { CursorWidget } from './CursorWidget';

const audition = vi.hoisted(() => vi.fn(() => Promise.resolve()));
// Tiles draw their cursor on a canvas; the test only checks what they ask to draw.
const drawCursorStyle = vi.hoisted(() =>
  vi.fn<(ctx: unknown, style: string, state: string, options?: { color?: string }) => void>(),
);

vi.mock('../../../lib/effects/cursor/styles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/effects/cursor/styles')>()),
  drawCursorStyle,
}));

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

// The sound picker sits under Clicks, labelled "Sound".
const clickSoundSection = () => screen.getByText('Sound').parentElement as HTMLElement;
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
    ).toEqual(['None', 'Mouse', 'Mouse 2', 'Trackpad', 'Soft']);
    for (const name of ['Mouse', 'Mouse 2', 'Trackpad', 'Soft']) {
      expect(screen.getByRole('button', { name: `Play ${name}` })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Play None' })).not.toBeInTheDocument();
  });

  it('plays an option without selecting it or closing the list', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    await openDropdown(user);
    await user.click(screen.getByRole('button', { name: 'Play Soft' }));

    expect(audition).toHaveBeenCalledWith('soft', 0.5);
    expect(useStore.getState().cursorClickSound).toBe('none');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('plays each option reached with the arrow keys, without selecting it', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    await openDropdown(user);
    await waitFor(() => expect(screen.getByRole('option', { name: 'None' })).toHaveFocus());
    expect(audition).not.toHaveBeenCalled();

    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(audition).toHaveBeenLastCalledWith('mouse', 0.5));

    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(audition).toHaveBeenLastCalledWith('mouse-2', 0.5));

    expect(useStore.getState().cursorClickSound).toBe('none');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('stays silent when moving the mouse over options', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    await openDropdown(user);
    await user.hover(screen.getByRole('option', { name: 'Soft' }));
    await user.hover(screen.getByRole('option', { name: 'Trackpad' }));

    expect(audition).not.toHaveBeenCalled();
  });

  it('stops previewing when the mouse moves after keyboard browsing', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    await openDropdown(user);
    await waitFor(() => expect(screen.getByRole('option', { name: 'None' })).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(audition).toHaveBeenLastCalledWith('mouse', 0.5));
    audition.mockClear();

    await user.hover(screen.getByRole('option', { name: 'Soft' }));

    expect(screen.getByRole('option', { name: 'Soft' })).toHaveFocus();
    expect(audition).not.toHaveBeenCalled();
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
      useStore.getState().setCursorClickSound('soft');
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

describe('CursorWidget style grid', () => {
  it('shows every style as a tile in one grid, standard styles first', () => {
    render(<CursorWidget />);

    expect(screen.queryByText('Decorative')).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole('radio')
        .slice(0, 2)
        .map((tile) => tile.getAttribute('aria-label')),
    ).toEqual(['macOS', 'macOS white']);
    for (const name of ['macOS', 'Windows', 'Touch', 'Wedge', 'Collaborator', 'Glass', 'Sparkle']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('radio', { name: 'macOS' })).toHaveAttribute('aria-checked', 'true');
  });

  it('selects a style from any row, with one selection across the grid', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    await user.click(screen.getByRole('radio', { name: 'Glitter' }));

    expect(useStore.getState().cursorStyle).toBe('glitter');
    expect(screen.getByRole('radio', { name: 'Glitter' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'macOS' })).toHaveAttribute('aria-checked', 'false');
  });

  it('asks for a name and colour only for the collaborator cursor', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Collaborator' }));
    await user.click(screen.getByRole('radio', { name: 'Green' }));

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('You');
    expect(useStore.getState().cursorColor).toBe('#16A34A');
  });
});

describe('CursorWidget layout', () => {
  it('keeps fine-tuning under a closed Advanced section', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    const advanced = screen.getByRole('button', { name: 'Advanced' });
    expect(advanced).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('switch', { name: 'Motion blur' })).not.toBeInTheDocument();

    await user.click(advanced);

    expect(advanced).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('switch', { name: 'Motion blur' })).toBeChecked();
    expect(screen.getByText('Rotation')).toBeInTheDocument();
  });

  it('turns hide-when-idle on from its switch and shows the delay', async () => {
    const user = userEvent.setup();
    render(<CursorWidget />);

    expect(screen.queryByText('Idle delay')).not.toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Hide when idle' }));

    expect(useStore.getState().cursorHideWhenIdle).toBe(true);
    expect(screen.getByText('Idle delay')).toBeInTheDocument();
  });
});

describe('CursorWidget name-tag colour', () => {
  it('redraws the name-tag tiles when the colour changes', async () => {
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(
        () => new Proxy({}, { get: () => () => undefined }) as unknown as CanvasRenderingContext2D,
      );
    const user = userEvent.setup();
    render(<CursorWidget />);

    await user.click(screen.getByRole('radio', { name: 'Rounded' }));
    drawCursorStyle.mockClear();
    await user.click(screen.getByRole('radio', { name: 'Green' }));

    const redrawn = drawCursorStyle.mock.calls.filter(([, style]) => style === 'rounded');
    expect(redrawn.length).toBeGreaterThan(0);
    expect(redrawn.every(([, , , options]) => options?.color === '#16A34A')).toBe(true);
    getContext.mockRestore();
  });
});
