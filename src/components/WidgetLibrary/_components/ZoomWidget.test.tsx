import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultCinematicZoomClip, defaultZoomClip } from 'src/lib/effects/zoom';
import { useStore } from 'src/store';
import type { RecordingResult } from 'src/types';
import { ZoomWidget } from './ZoomWidget';

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
    useStore.getState().setZoom([defaultZoomClip('zoom-1', 0, 3, 0.5, 0.5, 2)]);
    useStore.getState().setCurrentTime(1);
    useStore.getState().setActiveWidget('zoom');
  });
});

afterEach(() => {
  cleanup();
});

describe('ZoomWidget zoom clip controls', () => {
  it('keeps standard zoom clips in the simple zoom panel', async () => {
    const user = userEvent.setup();

    render(<ZoomWidget />);

    const clipButton = screen.getByText('2.0× zoom').closest('button');
    expect(clipButton).not.toBeNull();
    await user.click(clipButton as HTMLButtonElement);

    expect(screen.getByText('Zoom mode')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advanced' })).toBeInTheDocument();
    expect(screen.queryByText('Ease in')).not.toBeInTheDocument();
    expect(screen.queryByText('Preset')).not.toBeInTheDocument();
    expect(screen.queryByText('Look')).not.toBeInTheDocument();
  });

  it('shows cinematic camera focus controls for cinematic zoom clips', async () => {
    const user = userEvent.setup();

    act(() => {
      useStore
        .getState()
        .setZoom([defaultCinematicZoomClip('zoom-cinematic', 0, 3, 0.5, 0.5, 2.4)]);
    });

    render(<ZoomWidget />);

    await user.click(screen.getByText('Cinematic zoom').closest('button') as HTMLButtonElement);

    expect(screen.getAllByText('Cinematic zoom')).toHaveLength(1);
    expect(screen.queryByText('Zoom mode')).not.toBeInTheDocument();
    expect(screen.getByText('Tilt')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Follow' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Lock' })).not.toBeInTheDocument();
    expect(screen.queryByText('Cinematic look')).not.toBeInTheDocument();
    expect(screen.getByText('Depth')).toBeInTheDocument();
    expect(screen.getByText('Focus size')).toBeInTheDocument();
    expect(screen.getByText('Background fade')).toBeInTheDocument();
    expect(screen.queryByText('Film grain')).not.toBeInTheDocument();
    expect(screen.queryByText('Motion blur')).not.toBeInTheDocument();
    expect(screen.queryByText('Ease in')).not.toBeInTheDocument();
    expect(screen.queryByText('Preset')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Advanced' }));

    expect(screen.getByText('Focus size')).toBeInTheDocument();
    expect(screen.getByText('Background fade')).toBeInTheDocument();
    expect(screen.queryByText('Motion blur')).not.toBeInTheDocument();
    expect(screen.getByText('Ease in')).toBeInTheDocument();
    expect(screen.getByText('Ease out')).toBeInTheDocument();
  });

  it('adds cinematic clips from the add menu', async () => {
    const user = userEvent.setup();

    render(<ZoomWidget />);

    await user.click(screen.getByRole('button', { name: 'Add zoom' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cinematic zoom' }));

    await waitFor(() => {
      const clips = useStore.getState().zoomClips;
      expect(clips).toHaveLength(2);
      expect(clips[1].preset).toBe('cinematic');
    });
  });
});

describe('ZoomWidget intensity slider history', () => {
  const intensityThumb = () => {
    let root = screen.getByText('Intensity').closest('[data-orientation]') as HTMLElement;
    while (root.parentElement?.closest('[data-orientation]')) {
      root = root.parentElement.closest('[data-orientation]') as HTMLElement;
    }
    return within(root).getByRole('slider', { hidden: true });
  };

  it('closes its undo group when a press ends without changing the value', () => {
    render(<ZoomWidget />);
    const thumb = intensityThumb();

    fireEvent.pointerDown(thumb, { pointerId: 1, button: 0 });
    expect(useStore.getState().activeGroup?.key).toBe('zoom-intensity');
    // Radix only commits a changed value; the press still releases the pointer.
    fireEvent.lostPointerCapture(thumb, { pointerId: 1 });
    expect(useStore.getState().activeGroup).toBeNull();

    // So the next edit counts as unsaved on its own, instead of vanishing into the group.
    const before = useStore.getState().editVersion;
    act(() => {
      useStore.getState().commitEdit('Add zoom', () => ({
        zoomClips: [defaultZoomClip('zoom-2', 4, 6, 0.5, 0.5, 2)],
      }));
    });
    expect(useStore.getState().editVersion).toBeGreaterThan(before);
  });

  it('closes its undo group if the panel closes mid-drag', () => {
    const { unmount } = render(<ZoomWidget />);
    fireEvent.pointerDown(intensityThumb(), { pointerId: 1, button: 0 });
    expect(useStore.getState().activeGroup?.key).toBe('zoom-intensity');
    unmount();
    expect(useStore.getState().activeGroup).toBeNull();
  });
});
