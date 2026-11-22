import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from 'src/store';
import type { CaptionSegment, RecordingResult } from 'src/types';
import { CaptionWidget } from './CaptionWidget';

const recording: RecordingResult = {
  filePath: '/tmp/test-recording.mp4',
  audioPath: '/tmp/test-recording.wav',
  mouseData: [],
  duration: 12,
  startTime: 0,
  recordingArea: { x: 0, y: 0, width: 1920, height: 1080 },
};

const line = (id: string, words: Array<[string, number, number]>): CaptionSegment => ({
  id,
  start: words[0][1],
  end: words[words.length - 1][2],
  text: words.map(([w]) => w).join(' '),
  words: words.map(([word, start, end]) => ({ word, start, end })),
});

const transcript = [
  line('s1', [
    ['Hello', 0.5, 0.9],
    ['um', 1.0, 1.4],
    ['world', 1.5, 2.0],
  ]),
  line('s2', [
    ['next', 5.0, 5.4],
    ['part', 5.5, 6.0],
  ]),
];

const totalLength = () =>
  useStore.getState().mediaSegments.reduce((sum, s) => sum + (s.timelineEnd - s.timelineStart), 0);

beforeEach(() => {
  window.screenforge = {
    ...window.screenforge,
    onTranscribeProgress: vi.fn(() => () => undefined),
    cancelTranscription: vi.fn(),
    trackEvent: vi.fn(),
  } as unknown as typeof window.screenforge;
  act(() => {
    useStore.getState().resetEditorSession();
    useStore.getState().loadRecordingSession(recording);
    const { captions } = useStore.getState();
    useStore.getState().setCaptions({ ...captions, segments: transcript, captionsEnabled: true });
  });
});

afterEach(() => {
  cleanup();
});

describe('CaptionWidget — edit by transcript', () => {
  it('cuts shift-click-selected words with Delete as one undo step', async () => {
    const user = userEvent.setup();
    render(<CaptionWidget />);
    expect(totalLength()).toBeCloseTo(12);

    await user.click(screen.getByRole('button', { name: 'Hello' }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('button', { name: 'um' }));
    await user.keyboard('{/Shift}');

    expect(screen.getByText('2 words · 0.9s')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 'um' }), { key: 'Delete' });

    expect(totalLength()).toBeCloseTo(12 - 0.9);
    expect(screen.getByRole('button', { name: 'um' })).toHaveAttribute(
      'title',
      'Cut from the video',
    );

    act(() => {
      useStore.getState().undo();
    });
    expect(totalLength()).toBeCloseTo(12);
  });

  it('previews filler words and pauses, then applies them together', async () => {
    const user = userEvent.setup();
    render(<CaptionWidget />);

    await user.click(screen.getByRole('button', { name: 'Remove filler words & pauses' }));

    // "um" (0.4s) and the 2.0→5.0 pause trimmed to 2.2→4.8 (2.6s).
    expect(screen.getByText('2 cuts · 3.0s shorter')).toBeInTheDocument();
    expect(screen.getByLabelText('2.6s pause')).toBeInTheDocument();
    expect(totalLength()).toBeCloseTo(12);

    await user.click(screen.getByRole('button', { name: 'Apply cuts' }));
    expect(totalLength()).toBeCloseTo(9);

    act(() => {
      useStore.getState().undo();
    });
    expect(totalLength()).toBeCloseTo(12);
  });
});
