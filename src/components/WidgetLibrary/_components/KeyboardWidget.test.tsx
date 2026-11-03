import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from 'src/store';
import type { CursorEvent, RecordingResult } from 'src/types';
import { KeyboardWidget } from './KeyboardWidget';

const START_TIME = 1_000;

function shortcut(t: number, keyLabel: string): CursorEvent {
  return {
    type: 'keydown',
    keyCategory: 'shortcut',
    keyLabel,
    modifiers: { meta: true, ctrl: false, alt: false, shift: false },
    timestamp: START_TIME + t * 1000,
  };
}

function recording(mouseData: CursorEvent[] = []): RecordingResult {
  return {
    filePath: '/tmp/test-recording.mp4',
    mouseData,
    duration: 5,
    startTime: START_TIME,
    recordingArea: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    },
  };
}

beforeEach(() => {
  act(() => {
    useStore.getState().resetEditorSession();
    useStore.getState().setActiveWidget('keyboard');
  });
});

afterEach(() => {
  cleanup();
});

describe('KeyboardWidget', () => {
  it('shows an empty state without a selected recording', () => {
    render(<KeyboardWidget />);

    expect(screen.getByText('No recording selected.')).toBeInTheDocument();
  });

  it('toggles keyboard captions when shortcut metadata exists', async () => {
    const user = userEvent.setup();
    act(() => {
      useStore.getState().loadRecordingSession(recording([shortcut(0.2, 'K')]));
    });

    render(<KeyboardWidget />);

    await user.click(screen.getByRole('switch', { name: /keyboard on/i }));
    expect(useStore.getState().keyboard.enabled).toBe(false);
    expect(screen.getByRole('switch', { name: /keyboard off/i })).toBeInTheDocument();
  });

  it('updates size and background options', async () => {
    const user = userEvent.setup();
    act(() => {
      useStore.getState().loadRecordingSession(recording([shortcut(0.2, 'K')]));
    });

    render(<KeyboardWidget />);

    await user.click(screen.getByText('Large'));
    await user.click(screen.getByText('Light'));

    expect(useStore.getState().keyboard.size).toBe('large');
    expect(useStore.getState().keyboard.background).toBe('light');
  });
});
