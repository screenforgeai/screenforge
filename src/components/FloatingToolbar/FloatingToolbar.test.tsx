import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureBackend } from '../../types/index';

// framer-motion's AnimatePresence exit animations never complete under jsdom
// fake timers, leaving the recording controls unmounted. Replace motion
// components with plain elements so state transitions render synchronously.
vi.mock('framer-motion', () => {
  const MOTION_ONLY_PROPS = [
    'initial',
    'animate',
    'exit',
    'transition',
    'variants',
    'whileHover',
    'whileTap',
    'whileDrag',
    'layout',
    'drag',
    'dragControls',
    'dragListener',
    'dragMomentum',
    'dragElastic',
    'dragConstraints',
    'onDragStart',
    'onDragEnd',
    'onAnimationComplete',
  ];

  const passthrough = (tag: string) => {
    const Passthrough = ({
      children,
      ...props
    }: { children?: ReactNode } & Record<string, unknown>) => {
      const domProps = Object.fromEntries(
        Object.entries(props).filter(([key]) => !MOTION_ONLY_PROPS.includes(key)),
      );
      return createElement(tag, domProps, children as ReactNode);
    };
    Passthrough.displayName = `motion.${tag}`;
    return Passthrough;
  };

  return {
    motion: new Proxy({}, { get: (_target, key) => passthrough(String(key)) }),
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    useDragControls: () => ({ start: () => undefined }),
  };
});

import { FloatingToolbar } from './FloatingToolbar';

// ── Fake portal stream / MediaRecorder ────────────────────────────────────────

class FakeVideoTrack {
  private listeners = new Map<string, Set<() => void>>();
  stop = vi.fn();

  getSettings() {
    return { width: 1280, height: 720 };
  }

  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

class FakeMediaStream {
  constructor(public track: FakeVideoTrack) {}

  getVideoTracks() {
    return [this.track];
  }

  getTracks() {
    return [this.track];
  }
}

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn(() => true);

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  private stopListeners = new Set<() => void>();

  constructor(
    public stream: FakeMediaStream,
    public options?: MediaRecorderOptions,
  ) {
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  pause(): void {
    this.state = 'paused';
  }

  resume(): void {
    this.state = 'recording';
  }

  requestData(): void {
    this.ondataavailable?.({ data: new Blob(['webm-bytes'], { type: 'video/webm' }) });
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'stop') {
      this.stopListeners.add(listener);
    }
  }

  stop(): void {
    this.state = 'inactive';
    for (const listener of this.stopListeners) {
      listener();
    }
  }
}

// ── window.screenforge mock ───────────────────────────────────────────────────

const noopUnsubscribe = () => () => undefined;

function createScreenforgeMock(backend: CaptureBackend) {
  return {
    getCaptureBackend: vi.fn().mockResolvedValue(backend),
    getAppendMode: vi.fn().mockResolvedValue(false),
    clearAppendMode: vi.fn().mockResolvedValue(undefined),
    onTeleprompterReady: vi.fn(noopUnsubscribe),
    onTeleprompterClosed: vi.fn(noopUnsubscribe),
    onSceneOverlayReady: vi.fn(noopUnsubscribe),
    onSceneOverlayClosed: vi.fn(noopUnsubscribe),
    onStopRequested: vi.fn(noopUnsubscribe),
    onRecordingSourceLost: vi.fn(noopUnsubscribe),
    getSystemAudioSupport: vi.fn().mockResolvedValue({ supported: true }),
    prepareRecordingStartPermissions: vi.fn().mockResolvedValue(undefined),
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn().mockResolvedValue({
      mouseData: [],
      startTime: 1000,
      stopTime: 4000,
      durationMs: 3000,
      recordingArea: { x: 0, y: 0, width: 1280, height: 720 },
      captureBoundsTimeline: undefined,
      hasEmbeddedAudio: false,
      filePath: '/tmp/final.mp4',
    }),
    pauseRecording: vi.fn(),
    resumeRecording: vi.fn(),
    discardRecording: vi.fn().mockResolvedValue(undefined),
    saveRecording: vi.fn().mockResolvedValue('/tmp/portal-capture.webm'),
    saveAudioCapture: vi.fn().mockResolvedValue('/tmp/audio.webm'),
    saveCameraCapture: vi.fn().mockResolvedValue('/tmp/camera.webm'),
    mergeAudio: vi.fn().mockResolvedValue('/tmp/merged.mp4'),
    recordingFinished: vi.fn(),
    recordingFailed: vi.fn(),
    recordingProcessing: vi.fn(),
    hideToolbar: vi.fn(),
    closeTeleprompter: vi.fn(),
    toggleTeleprompter: vi.fn(),
    closeSceneOverlay: vi.fn(),
    openCameraPreview: vi.fn(),
    closeCameraPreview: vi.fn(),
    openAreaSelector: vi.fn().mockResolvedValue(null),
    getSources: vi.fn().mockResolvedValue([]),
    getStartupPermissionStatuses: vi.fn().mockResolvedValue({
      screen: 'granted',
      microphone: 'granted',
      camera: 'granted',
      accessibility: 'granted',
    }),
    requestMediaAccess: vi.fn().mockResolvedValue('granted'),
    focusWindow: vi.fn(),
    systemWarning: vi.fn(),
    setToolbarMouseInteractivity: vi.fn(),
    setToolbarShape: vi.fn(),
    minimizeToDock: vi.fn(),
    showMain: vi.fn(),
    writeDiagnosticLog: vi.fn(),
    trackEvent: vi.fn(),
    identifyUser: vi.fn(),
  };
}

type ScreenforgeMock = ReturnType<typeof createScreenforgeMock>;

let screenforge: ScreenforgeMock;
let portalTrack: FakeVideoTrack;
let getDisplayMedia: ReturnType<typeof vi.fn>;

function installMocks(backend: CaptureBackend): void {
  screenforge = createScreenforgeMock(backend);
  Object.defineProperty(window, 'screenforge', {
    value: screenforge,
    writable: true,
    configurable: true,
  });

  portalTrack = new FakeVideoTrack();
  getDisplayMedia = vi.fn().mockResolvedValue(new FakeMediaStream(portalTrack));
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getDisplayMedia, enumerateDevices: vi.fn().mockResolvedValue([]) },
    writable: true,
    configurable: true,
  });

  FakeMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
}

// ── Flows ────────────────────────────────────────────────────────────────────

// Generous enough for a loaded 2-core CI runner; local runs finish in ms.
const ASYNC_UI_TIMEOUT_MS = 5000;

async function clickRecordAndFinishCountdown(): Promise<void> {
  render(<FloatingToolbar />);
  await waitFor(() => expect(screenforge.getCaptureBackend).toHaveBeenCalled());

  // The toolbar re-renders its controls as mount-time data (permissions,
  // devices, sources) arrives. On a slow runner that can replace the Record
  // button between finding and clicking it, so the click hits a detached node.
  // Re-query and click until the record flow has actually started.
  const appendModeCallsBeforeClick = screenforge.getAppendMode.mock.calls.length;
  await waitFor(
    () => {
      fireEvent.click(screen.getByRole('button', { name: 'Record' }));
      expect(screenforge.getAppendMode.mock.calls.length).toBeGreaterThan(
        appendModeCallsBeforeClick,
      );
    },
    { timeout: ASYNC_UI_TIMEOUT_MS },
  );

  // Record awaits the append-mode and permission checks before the countdown
  // starts. Wait for it, or the timer advances below can run before it
  // exists (seen on slower CI runners) and recording never starts in time.
  await screen.findByText('Starting in', undefined, { timeout: ASYNC_UI_TIMEOUT_MS });

  // Countdown ticks once per second, three times, then recording starts.
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
  }
}

async function waitForRecordingState(): Promise<void> {
  await screen.findByRole('button', { name: 'Stop recording' }, { timeout: ASYNC_UI_TIMEOUT_MS });
}

describe('FloatingToolbar recording widget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('native/FFmpeg backends (macOS, Windows, Linux X11)', () => {
    beforeEach(() => installMocks('native'));

    it('starts recording through the main process without touching getDisplayMedia', async () => {
      await clickRecordAndFinishCountdown();
      await waitForRecordingState();

      expect(screenforge.startRecording).toHaveBeenCalledWith('screen:0', null);
      expect(getDisplayMedia).not.toHaveBeenCalled();
      expect(FakeMediaRecorder.instances).toHaveLength(0);
      expect(screenforge.hideToolbar).toHaveBeenCalled();
    });

    it('stops recording and reports the result to the editor', async () => {
      await clickRecordAndFinishCountdown();
      await waitForRecordingState();

      fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));

      await waitFor(() => expect(screenforge.recordingFinished).toHaveBeenCalled());
      expect(screenforge.stopRecording).toHaveBeenCalledWith();
      expect(screenforge.recordingFinished).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: '/tmp/final.mp4', duration: 3 }),
      );
      expect(screenforge.recordingFailed).not.toHaveBeenCalled();
    });

    it('stops and explains why when the recorded display is disconnected', async () => {
      await clickRecordAndFinishCountdown();
      await waitForRecordingState();

      const onSourceLost = screenforge.onRecordingSourceLost.mock.calls.at(-1)?.[0] as (info: {
        reason: 'display-removed';
      }) => void;
      act(() => onSourceLost({ reason: 'display-removed' }));

      await waitFor(() => expect(screenforge.recordingFinished).toHaveBeenCalled());
      expect(screenforge.stopRecording).toHaveBeenCalledTimes(1);
      expect(screenforge.systemWarning).toHaveBeenCalledWith(
        'The display you were recording was disconnected, so the recording stopped. Everything up to that point was kept.',
      );
    });

    it('ignores a disconnected display while not recording', async () => {
      render(<FloatingToolbar />);
      await waitFor(() => expect(screenforge.onRecordingSourceLost).toHaveBeenCalled());

      const onSourceLost = screenforge.onRecordingSourceLost.mock.calls.at(-1)?.[0] as (info: {
        reason: 'display-removed';
      }) => void;
      act(() => onSourceLost({ reason: 'display-removed' }));

      expect(screenforge.stopRecording).not.toHaveBeenCalled();
      expect(screenforge.systemWarning).not.toHaveBeenCalled();
    });
  });

  describe('Wayland portal backend (Linux)', () => {
    beforeEach(() => installMocks('wayland-portal'));

    it('records the portal stream in the renderer and hands the webm to the main process', async () => {
      await clickRecordAndFinishCountdown();
      await waitForRecordingState();

      // The portal picker was opened and a MediaRecorder captures the stream.
      expect(getDisplayMedia).toHaveBeenCalledWith({
        audio: false,
        video: { frameRate: { ideal: 60, max: 60 } },
      });
      expect(FakeMediaRecorder.instances).toHaveLength(1);
      expect(FakeMediaRecorder.instances[0].state).toBe('recording');
      expect(screenforge.startRecording).toHaveBeenCalledWith('screen:0', null, {
        rendererCapture: true,
      });

      fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));

      await waitFor(() => expect(screenforge.recordingFinished).toHaveBeenCalled());
      // The recorded webm was uploaded, then finalized with its pixel size.
      expect(screenforge.saveRecording).toHaveBeenCalledTimes(1);
      expect(screenforge.saveRecording.mock.calls[0][0]).toBeInstanceOf(ArrayBuffer);
      expect(screenforge.stopRecording).toHaveBeenCalledWith({
        webmPath: '/tmp/portal-capture.webm',
        width: 1280,
        height: 720,
      });
      expect(portalTrack.stop).toHaveBeenCalled();
      expect(screenforge.recordingFinished).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: '/tmp/final.mp4', duration: 3 }),
      );
      expect(screenforge.recordingFailed).not.toHaveBeenCalled();
    });

    it('returns to idle with a warning when the user cancels the portal dialog', async () => {
      getDisplayMedia.mockRejectedValue(new Error('Permission denied by the screen-share dialog'));

      await clickRecordAndFinishCountdown();

      await waitFor(() => expect(screenforge.systemWarning).toHaveBeenCalled());
      expect(screenforge.startRecording).not.toHaveBeenCalled();
      // Back to idle: the record button is available again.
      expect(await screen.findByRole('button', { name: 'Record' })).toBeInTheDocument();
    });

    it('pauses and resumes the portal recorder together with the main process', async () => {
      await clickRecordAndFinishCountdown();
      await waitForRecordingState();
      const recorder = FakeMediaRecorder.instances[0];

      fireEvent.click(screen.getByRole('button', { name: 'Pause recording' }));
      expect(screenforge.pauseRecording).toHaveBeenCalled();
      expect(recorder.state).toBe('paused');

      fireEvent.click(await screen.findByRole('button', { name: 'Resume recording' }));
      expect(screenforge.resumeRecording).toHaveBeenCalled();
      expect(recorder.state).toBe('recording');
    });

    it('stops the recording when the OS screen-share indicator ends the track', async () => {
      await clickRecordAndFinishCountdown();
      await waitForRecordingState();

      act(() => {
        portalTrack.dispatch('ended');
      });

      await waitFor(() => expect(screenforge.recordingFinished).toHaveBeenCalled());
      expect(screenforge.stopRecording).toHaveBeenCalledWith({
        webmPath: '/tmp/portal-capture.webm',
        width: 1280,
        height: 720,
      });
    });

    it('discards an in-flight recording and releases the portal stream', async () => {
      await clickRecordAndFinishCountdown();
      await waitForRecordingState();
      const recorder = FakeMediaRecorder.instances[0];

      fireEvent.click(screen.getByRole('button', { name: 'Discard recording' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Confirm discard' }));

      await waitFor(() => expect(screenforge.discardRecording).toHaveBeenCalled());
      expect(recorder.state).toBe('inactive');
      expect(portalTrack.stop).toHaveBeenCalled();
      expect(screenforge.recordingFinished).not.toHaveBeenCalled();
    });
  });
});
