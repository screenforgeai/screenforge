// Playback writes `currentTime` to the store on every animation frame. Panels and
// overlays must only re-render when something they show changes (the clip under
// the playhead, the time label's text), never once per frame: that per-frame
// re-rendering was most of the editor's main-thread work during playback.
import { Profiler, type ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from 'src/store';
import type { RecordingResult } from 'src/types';
import { CameraWidget } from './WidgetLibrary/_components/CameraWidget';
import { CaptionWidget } from './WidgetLibrary/_components/CaptionWidget/CaptionWidget';
import { MaskWidget } from './WidgetLibrary/_components/MaskWidget';
import { MotionWidget } from './WidgetLibrary/_components/MotionWidget/MotionWidget';
import { MusicWidget } from './WidgetLibrary/_components/MusicWidget/MusicWidget';
import { TextWidget } from './WidgetLibrary/_components/TextWidget/TextWidget';
import { VideoWidget } from './WidgetLibrary/_components/VideoWidget/VideoWidget';
import { MaskOverlayEditor } from './Canvas/_components/MaskOverlayEditor';
import { TextOverlayEditor } from './Canvas/_components/TextOverlayEditor';
import { CameraOverlayEditor } from './Canvas/_components/CameraOverlayEditor';
import { TimelineToolbar } from './Canvas/_components/CanvasTimeline/_components/TimelineToolbar';

const RECORDING_RESULT: RecordingResult = {
  filePath: '/tmp/test-recording.mp4',
  mouseData: [],
  duration: 20,
  startTime: 0,
  recordingArea: { x: 0, y: 0, width: 1920, height: 1080 },
};

const SEGMENTS = [
  { id: 'seg-a', timelineStart: 0, timelineEnd: 10, sourceStart: 0, sourceEnd: 10 },
  { id: 'seg-b', timelineStart: 10, timelineEnd: 20, sourceStart: 10, sourceEnd: 20 },
];

beforeEach(() => {
  act(() => {
    const store = useStore.getState();
    store.resetEditorSession();
    store.loadRecordingSession(RECORDING_RESULT);
    useStore.setState({
      mediaSegments: SEGMENTS,
      maskClips: [
        {
          id: 'mask-1',
          start: 1,
          end: 4,
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.1,
          type: 'blur',
          blurAmount: 20,
          color: '#000000',
        },
      ],
      musicClips: [
        {
          id: 'music-1',
          name: 'Song',
          filePath: '/tmp/song.mp3',
          startTime: 0,
          duration: 30,
          timelineStart: 0,
          timelineEnd: 20,
          fitToVideo: true,
          volume: 0.5,
        },
      ],
      captions: {
        ...store.captions,
        segments: [
          {
            id: 'cap-1',
            start: 1,
            end: 4,
            text: 'hello there world',
            words: [
              { word: 'hello', start: 1, end: 2 },
              { word: 'there', start: 2, end: 3 },
              { word: 'world', start: 3, end: 4 },
            ],
          },
        ],
      },
    });
    store.setCurrentTime(1.5);
  });
});

afterEach(() => {
  cleanup();
});

/** Renders `ui`, then plays `ticks` frames from `from` to `to`, one commit per frame. */
const countRendersDuringPlayback = (ui: ReactNode, from: number, to: number, ticks = 30) => {
  let renders = 0;
  render(
    <Profiler id="under-test" onRender={() => (renders += 1)}>
      {ui}
    </Profiler>,
  );
  const before = renders;
  for (let i = 0; i < ticks; i += 1) {
    act(() => {
      useStore.getState().setCurrentTime(from + ((to - from) * i) / ticks);
    });
  }
  return renders - before;
};

const containerRef = { current: document.createElement('div') };
const canvasRef = { current: document.createElement('canvas') };

describe('playback does not re-render panels every frame', () => {
  it.each([
    ['Video panel', () => <VideoWidget />],
    ['Mask panel', () => <MaskWidget />],
    ['Music panel', () => <MusicWidget />],
    ['Camera panel', () => <CameraWidget />],
    ['Motion panel', () => <MotionWidget />],
    ['Mask overlay', () => <MaskOverlayEditor containerRef={containerRef} canvasRef={canvasRef} />],
    ['Text overlay', () => <TextOverlayEditor containerRef={containerRef} canvasRef={canvasRef} />],
    [
      'Camera overlay',
      () => <CameraOverlayEditor containerRef={containerRef} canvasRef={canvasRef} />,
    ],
  ])('%s stays put while the playhead moves within the same clip', (_name, ui) => {
    expect(countRendersDuringPlayback(ui(), 1.5, 1.9)).toBe(0);
  });

  it('the Text panel stays put while the playhead moves within the same clip', async () => {
    const user = userEvent.setup();
    render(<TextWidget />);
    await user.click(screen.getByRole('button', { name: /add text/i }));
    cleanup();
    const clip = useStore.getState().textClips[0];
    expect(clip).toBeDefined();
    act(() => {
      useStore.getState().setCurrentTime(clip.start + 0.1);
    });

    expect(countRendersDuringPlayback(<TextWidget />, clip.start + 0.1, clip.start + 0.6)).toBe(0);
  });

  it('the Captions panel re-renders only when the highlighted word changes', () => {
    // The panel asks the main process about the speech model when it mounts.
    Object.assign(window, {
      screenforge: {
        onTranscribeProgress: () => () => {},
        getWhisperModelStatus: () => new Promise(() => {}),
        cancelTranscription: () => Promise.resolve(),
        transcribeAudio: () => new Promise(() => {}),
      },
    });
    // 30 frames from 1.5 s to ~2.47 s cross one word boundary (2 s): hello -> there.
    const renders = countRendersDuringPlayback(<CaptionWidget />, 1.5, 2.5);
    expect(renders).toBeGreaterThan(0);
    expect(renders).toBeLessThanOrEqual(2);
  });

  it('the Video panel still follows the playhead into the next segment', () => {
    render(<VideoWidget />);
    act(() => {
      useStore.getState().setCurrentTime(12);
    });
    const current = document.querySelector('[aria-current="true"]');
    expect(current).not.toBeNull();
    expect(current?.textContent).toContain('10.0s');
  });

  it('the time label re-renders only when its text changes', () => {
    const renders = countRendersDuringPlayback(
      <TimelineToolbar
        playing
        totalDur={20}
        scaleWidth={80}
        canUndo={false}
        canRedo={false}
        onTogglePlay={() => {}}
        onStop={() => {}}
        onSplit={() => {}}
        onUndo={() => {}}
        onRedo={() => {}}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
      />,
      1.5,
      2.0,
    );
    // 30 frames over half a second (1.5 s … 1.98 s) show 1.5s … 2.0s: six
    // texts, so at most six renders, not 30.
    expect(renders).toBeLessThanOrEqual(6);
    expect(screen.getByText('2.0s')).toBeInTheDocument();
  });
});
