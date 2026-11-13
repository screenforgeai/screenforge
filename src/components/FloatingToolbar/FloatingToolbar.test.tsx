import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureBackend } from '../../types/index';

// framer-motion's AnimatePresence exit animations never complete under jsdom
// fake timers, leaving the recording controls unmounted. Replace motion
// components with plain elements so state transitions render synchronously.
vi.mock('src/lib/recording/streamStill', () => ({
  grabStreamStill: vi.fn().mockResolvedValue({
    png: new Uint8Array([137, 80, 78, 71]),
    width: 2560,
    height: 1440,
  }),
}));

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
    'layoutId',
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
    useReducedMotion: () => false,
  };
});

import { FloatingToolbar } from './FloatingToolbar';

// ── Fake portal stream / MediaRecorder ────────────────────────────────────────

class FakeVideoTrack {
  private listeners = new Map<string, Set<() => void>>();
  readyState: 'live' | 'ended' = 'live';
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
    onVideoModeRequested: vi.fn(noopUnsubscribe),
    setToolbarRecording: vi.fn(),
    getCaptureShortcuts: vi
      .fn()
      .mockResolvedValue({ screenshot: 'Alt+Shift+S', record: 'Alt+Shift+R' }),
    getSystemAudioSupport: vi.fn().mockResolvedValue({ supported: true }),
    prepareRecordingStartPermissions: vi.fn().mockResolvedValue(undefined),
    prepareScreenshotPermissions: vi.fn().mockResolvedValue(undefined),
    captureScreenshot: vi.fn().mockResolvedValue(undefined),
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
    getToolbarLayout: vi.fn().mockResolvedValue('overlay'),
    setShareKind: vi.fn().mockResolvedValue(undefined),
    takeScreenshot: vi.fn().mockResolvedValue(undefined),
    selectAreaOnStill: vi.fn().mockResolvedValue(null),
    setToolbarSize: vi.fn(),
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

/** The toolbar's most recent onRecordingSourceLost callback. */
function latestSourceLostHandler(): (info: { reason: 'display-removed' }) => void {
  const calls = screenforge.onRecordingSourceLost.mock.calls as unknown as Array<
    [(info: { reason: 'display-removed' }) => void]
  >;
  return calls[calls.length - 1][0];
}

async function clickRecordAndFinishCountdown(): Promise<void> {
  await clickRecord();
  await finishCountdown();
}

async function clickRecord(): Promise<void> {
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
}

async function finishCountdown(): Promise<void> {
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

    const lastReportedBusy = () => screenforge.setToolbarRecording.mock.calls.at(-1)?.[0];

    const clickRecord = async () => {
      render(<FloatingToolbar />);
      await waitFor(() => expect(screenforge.getCaptureBackend).toHaveBeenCalled());
      await waitFor(
        () => {
          fireEvent.click(screen.getByRole('button', { name: 'Record' }));
          expect(screenforge.prepareRecordingStartPermissions).toHaveBeenCalled();
        },
        { timeout: ASYNC_UI_TIMEOUT_MS },
      );
    };

    it('counts as busy while the permission check before the countdown runs', async () => {
      screenforge.prepareRecordingStartPermissions.mockImplementation(
        () => new Promise<void>(() => undefined),
      );
      await clickRecord();
      await waitFor(() => expect(lastReportedBusy()).toBe(true));
    });

    it('goes back to idle when recording permissions are refused', async () => {
      screenforge.prepareRecordingStartPermissions.mockRejectedValue(new Error('No access'));
      await clickRecord();
      await waitFor(() => expect(lastReportedBusy()).toBe(false));
      expect(screenforge.setToolbarRecording).toHaveBeenCalledWith(true);
    });

    it('counts as busy during the countdown, before recording starts', async () => {
      await clickRecord();
      await screen.findByText('Starting in', undefined, { timeout: ASYNC_UI_TIMEOUT_MS });
      expect(screenforge.startRecording).not.toHaveBeenCalled();
      expect(lastReportedBusy()).toBe(true);
    });

    it('stays busy after Stop until the recording reaches the editor', async () => {
      let finishStop: (value: unknown) => void = () => undefined;
      const stopResult = await screenforge.stopRecording();
      screenforge.stopRecording.mockClear();
      screenforge.stopRecording.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishStop = resolve;
          }),
      );
      await clickRecordAndFinishCountdown();
      await waitForRecordingState();

      fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
      await waitFor(() => expect(screenforge.stopRecording).toHaveBeenCalled());
      expect(lastReportedBusy()).toBe(true);

      finishStop(stopResult);
      await waitFor(() => expect(screenforge.recordingFinished).toHaveBeenCalled());
      await waitFor(() => expect(lastReportedBusy()).toBe(false));
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

    // The stop error crosses IPC, where Electron prefixes "Error invoking remote method".
    it('shows a failed stop in plain words and reports it', async () => {
      const message = 'Nothing was captured. Try again.';
      screenforge.stopRecording.mockRejectedValue(
        new Error(`Error invoking remote method 'recording:stop': Error: ${message}`),
      );
      await clickRecordAndFinishCountdown();
      await waitForRecordingState();

      fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));

      await waitFor(() => expect(screenforge.recordingFailed).toHaveBeenCalledWith(message));
      expect(screenforge.recordingFinished).not.toHaveBeenCalled();
      expect(screenforge.trackEvent).toHaveBeenCalledWith(
        'recording_failed',
        expect.objectContaining({ error: message }),
      );
      expect(screenforge.trackEvent).not.toHaveBeenCalledWith(
        'recording_completed',
        expect.anything(),
      );
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

    it('stops only once when the display-removed event arrives twice', async () => {
      await clickRecordAndFinishCountdown();
      await waitForRecordingState();

      const onSourceLost = latestSourceLostHandler();
      act(() => {
        onSourceLost({ reason: 'display-removed' });
        onSourceLost({ reason: 'display-removed' });
      });

      await waitFor(() => expect(screenforge.recordingFinished).toHaveBeenCalled());
      expect(screenforge.stopRecording).toHaveBeenCalledTimes(1);
    });

    it('stops as soon as it starts when the display went away while starting', async () => {
      let finishStart: () => void = () => undefined;
      screenforge.startRecording.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishStart = resolve;
          }),
      );
      await clickRecordAndFinishCountdown();
      await waitFor(() => expect(screenforge.startRecording).toHaveBeenCalled());

      const onSourceLost = latestSourceLostHandler();
      act(() => onSourceLost({ reason: 'display-removed' }));
      await act(async () => finishStart());

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

    it('asks the share dialog for a screen when recording the display', async () => {
      await clickRecordAndFinishCountdown();
      await waitForRecordingState();
      expect(screenforge.setShareKind).toHaveBeenCalledWith('screen');
      expect(screenforge.setShareKind.mock.invocationCallOrder[0]).toBeLessThan(
        getDisplayMedia.mock.invocationCallOrder[0],
      );
    });

    it('records a window picked in the share dialog: Wayland cannot list windows in-app', async () => {
      render(<FloatingToolbar />);
      await waitFor(() => expect(screenforge.getCaptureBackend).toHaveBeenCalled());
      // Let the backend answer: the toolbar now knows windows are picked in the share dialog.
      await act(async () => {
        await Promise.resolve();
      });
      // The Window tab selects window capture without a list (it could only ever be empty).
      const windowTab = screen.getByRole('button', { name: 'Window' });
      // It says when the app is chosen instead.
      fireEvent.focus(windowTab);
      expect(
        await screen.findAllByText("Window: you'll choose the app when recording starts"),
      ).not.toHaveLength(0);
      fireEvent.blur(windowTab);
      fireEvent.pointerDown(windowTab, { button: 0, pointerType: 'mouse' });
      fireEvent.click(windowTab);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(windowTab).not.toHaveAttribute('aria-haspopup');
      expect(screen.getByRole('button', { name: 'Record' })).toBeEnabled();

      const appendModeCalls = screenforge.getAppendMode.mock.calls.length;
      await waitFor(
        () => {
          fireEvent.click(screen.getByRole('button', { name: 'Record' }));
          expect(screenforge.getAppendMode.mock.calls.length).toBeGreaterThan(appendModeCalls);
        },
        { timeout: ASYNC_UI_TIMEOUT_MS },
      );
      await screen.findByText('Starting in', undefined, { timeout: ASYNC_UI_TIMEOUT_MS });
      for (let i = 0; i < 4; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1100);
        });
      }
      await waitForRecordingState();

      expect(screenforge.setShareKind).toHaveBeenCalledWith('window');
      expect(getDisplayMedia).toHaveBeenCalled();
      // The portal stream is the capture; there is no window: source id to resolve.
      expect(screenforge.startRecording.mock.calls[0][0]).not.toMatch(/^window:/);
    });

    const screenshotModeOnPortal = async () => {
      render(<FloatingToolbar />);
      await waitFor(() => expect(screenforge.getCaptureBackend).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }));
    };

    it('takes a screenshot of a window picked in the share dialog', async () => {
      await screenshotModeOnPortal();
      fireEvent.click(screen.getByRole('button', { name: 'Window' }));
      fireEvent.click(screen.getByRole('button', { name: 'Take screenshot' }));
      await waitFor(() =>
        expect(screenforge.captureScreenshot).toHaveBeenCalledWith({
          kind: 'window',
          sourceId: 'window:wayland',
        }),
      );
    });

    it('says nothing when the share dialog is closed without a pick', async () => {
      screenforge.captureScreenshot.mockResolvedValue('cancelled');
      await screenshotModeOnPortal();
      fireEvent.click(screen.getByRole('button', { name: 'Take screenshot' }));
      await waitFor(() => expect(screenforge.captureScreenshot).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
      });
      expect(screenforge.systemWarning).not.toHaveBeenCalled();
    });

    it('starts an area screenshot by picking the screen first, not by drawing on the live one', async () => {
      await screenshotModeOnPortal();
      fireEvent.click(screen.getByRole('button', { name: 'Area' }));
      await waitFor(() => expect(screenforge.takeScreenshot).toHaveBeenCalled());
      expect(screenforge.openAreaSelector).not.toHaveBeenCalled();
    });

    it('opens the share dialog before the countdown, and records once the countdown ends', async () => {
      let pick: (stream: FakeMediaStream) => void = () => undefined;
      getDisplayMedia.mockReturnValue(
        new Promise<FakeMediaStream>((resolve) => {
          pick = resolve;
        }),
      );
      await clickRecord();
      await waitFor(() => expect(getDisplayMedia).toHaveBeenCalledTimes(1));
      // The dialog is open: nothing counts down while the user is still choosing.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4400);
      });
      expect(screen.queryByText('Starting in')).not.toBeInTheDocument();

      await act(async () => {
        pick(new FakeMediaStream(portalTrack));
      });
      await screen.findByText('Starting in', undefined, { timeout: ASYNC_UI_TIMEOUT_MS });
      // Picked, but not recorded yet: the countdown comes first.
      expect(FakeMediaRecorder.instances).toHaveLength(0);
      expect(screenforge.startRecording).not.toHaveBeenCalled();

      await finishCountdown();
      await waitForRecordingState();
      expect(getDisplayMedia).toHaveBeenCalledTimes(1);
      expect(FakeMediaRecorder.instances).toHaveLength(1);
      expect(FakeMediaRecorder.instances[0].state).toBe('recording');
    });

    it('goes back to idle, without a countdown or a warning, when the share dialog is closed', async () => {
      getDisplayMedia.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));

      await clickRecord();
      await waitFor(() => expect(getDisplayMedia).toHaveBeenCalled());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4400);
      });

      expect(screen.queryByText('Starting in')).not.toBeInTheDocument();
      expect(screenforge.startRecording).not.toHaveBeenCalled();
      expect(screenforge.systemWarning).not.toHaveBeenCalled();
      expect(await screen.findByRole('button', { name: 'Record' })).toBeEnabled();
    });

    it('warns, without a countdown, when the share dialog fails', async () => {
      getDisplayMedia.mockRejectedValue(new Error('PipeWire is not running'));

      await clickRecord();

      await waitFor(() => expect(screenforge.systemWarning).toHaveBeenCalled());
      expect(screen.queryByText('Starting in')).not.toBeInTheDocument();
      expect(screenforge.startRecording).not.toHaveBeenCalled();
      expect(await screen.findByRole('button', { name: 'Record' })).toBeInTheDocument();
    });

    it('cancels the countdown when the share is ended from the system indicator', async () => {
      await clickRecord();
      await screen.findByText('Starting in', undefined, { timeout: ASYNC_UI_TIMEOUT_MS });

      act(() => {
        portalTrack.dispatch('ended');
      });
      expect(await screen.findByRole('button', { name: 'Record' })).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4400);
      });

      expect(screenforge.startRecording).not.toHaveBeenCalled();
      expect(FakeMediaRecorder.instances).toHaveLength(0);
    });

    const clickAreaOnPortal = async () => {
      render(<FloatingToolbar />);
      await waitFor(() => expect(screenforge.getCaptureBackend).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Area' }));
    };

    it('records an area by picking the screen first, then drawing on a still of it', async () => {
      const area = { x: 1, y: 2, width: 300, height: 200, frame: { width: 2560, height: 1440 } };
      screenforge.selectAreaOnStill.mockResolvedValue(area);
      await clickAreaOnPortal();
      await screen.findByText('Starting in', undefined, { timeout: ASYNC_UI_TIMEOUT_MS });

      // Not drawn on the live screen: Wayland would put that selector on any monitor.
      expect(screenforge.openAreaSelector).not.toHaveBeenCalled();
      expect(screenforge.setShareKind).toHaveBeenCalledWith('screen');
      expect(getDisplayMedia.mock.invocationCallOrder[0]).toBeLessThan(
        screenforge.selectAreaOnStill.mock.invocationCallOrder[0],
      );
      expect(screenforge.selectAreaOnStill).toHaveBeenCalledWith({
        png: expect.any(Uint8Array),
        width: 2560,
        height: 1440,
      });

      await finishCountdown();
      await waitForRecordingState();
      expect(getDisplayMedia).toHaveBeenCalledTimes(1);
      expect(screenforge.startRecording).toHaveBeenCalledWith('screen:0', area, {
        rendererCapture: true,
      });
    });

    it('lets go of the picked screen when its share ends while the area is drawn', async () => {
      screenforge.selectAreaOnStill.mockImplementation(async () => {
        portalTrack.readyState = 'ended';
        portalTrack.dispatch('ended');
        return { x: 1, y: 2, width: 300, height: 200, frame: { width: 2560, height: 1440 } };
      });
      await clickAreaOnPortal();
      await waitFor(() => expect(portalTrack.stop).toHaveBeenCalled());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4400);
      });

      expect(screen.queryByText('Starting in')).not.toBeInTheDocument();
      expect(screenforge.startRecording).not.toHaveBeenCalled();
      expect(FakeMediaRecorder.instances).toHaveLength(0);
    });

    it('opens one share dialog however often Record or Area is clicked while it is open', async () => {
      let pick: (stream: FakeMediaStream) => void = () => undefined;
      getDisplayMedia.mockReturnValue(
        new Promise<FakeMediaStream>((resolve) => {
          pick = resolve;
        }),
      );
      await clickRecord();
      await waitFor(() => expect(getDisplayMedia).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: 'Record' }));
      fireEvent.click(screen.getByRole('button', { name: 'Area' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(getDisplayMedia).toHaveBeenCalledTimes(1);

      await act(async () => {
        pick(new FakeMediaStream(portalTrack));
      });
      await finishCountdown();
      await waitForRecordingState();
      expect(getDisplayMedia).toHaveBeenCalledTimes(1);
      expect(FakeMediaRecorder.instances).toHaveLength(1);
    });

    it('can record again when the share ends before its still is taken', async () => {
      const { grabStreamStill } = await import('src/lib/recording/streamStill');
      vi.mocked(grabStreamStill).mockRejectedValueOnce(new Error('Sharing stopped.'));
      portalTrack.readyState = 'ended';
      await clickAreaOnPortal();
      await waitFor(() => expect(portalTrack.stop).toHaveBeenCalled());
      // Ended by the user from the system indicator: nothing to warn about.
      expect(screenforge.systemWarning).not.toHaveBeenCalled();
      expect(screenforge.selectAreaOnStill).not.toHaveBeenCalled();

      // The share dialog guard was let go: Record opens the dialog again.
      portalTrack.readyState = 'live';
      fireEvent.click(screen.getByRole('button', { name: 'Record' }));
      await waitFor(() => expect(getDisplayMedia).toHaveBeenCalledTimes(2));
    });

    it('opens one share dialog when Record is clicked twice before it appears', async () => {
      render(<FloatingToolbar />);
      await waitFor(() => expect(screenforge.getCaptureBackend).toHaveBeenCalled());
      await act(async () => {
        await Promise.resolve();
      });
      // Both clicks land while the first is still preparing; the second's checks finish only
      // after the first has picked.
      screenforge.prepareRecordingStartPermissions
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 500)));
      fireEvent.click(screen.getByRole('button', { name: 'Record' }));
      // Each click re-renders the button: find it again.
      fireEvent.click(screen.getByRole('button', { name: 'Record' }));
      await screen.findByText('Starting in', undefined, { timeout: ASYNC_UI_TIMEOUT_MS });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      // Both clicks were handled; only the first one asked.
      expect(screenforge.prepareRecordingStartPermissions).toHaveBeenCalledTimes(1);
      expect(getDisplayMedia).toHaveBeenCalledTimes(1);
      expect(portalTrack.stop).not.toHaveBeenCalled();
    });

    it('opens no other share dialog while the area is being drawn', async () => {
      const area = { x: 1, y: 2, width: 300, height: 200, frame: { width: 2560, height: 1440 } };
      let draw: (value: typeof area) => void = () => undefined;
      screenforge.selectAreaOnStill.mockReturnValue(
        new Promise<typeof area>((resolve) => {
          draw = resolve;
        }),
      );
      await clickAreaOnPortal();
      await waitFor(() => expect(screenforge.selectAreaOnStill).toHaveBeenCalled());

      // The still may open on another monitor, leaving the toolbar clickable.
      fireEvent.click(screen.getByRole('button', { name: 'Area' }));
      fireEvent.click(screen.getByRole('button', { name: 'Record' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(getDisplayMedia).toHaveBeenCalledTimes(1);

      await act(async () => {
        draw(area);
      });
      await finishCountdown();
      await waitForRecordingState();
      expect(getDisplayMedia).toHaveBeenCalledTimes(1);
      expect(portalTrack.stop).not.toHaveBeenCalled();
    });

    it('lets go of the picked screen when no area is drawn', async () => {
      await clickAreaOnPortal();
      await waitFor(() => expect(screenforge.selectAreaOnStill).toHaveBeenCalled());
      await waitFor(() => expect(portalTrack.stop).toHaveBeenCalled());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4400);
      });

      expect(screen.queryByText('Starting in')).not.toBeInTheDocument();
      expect(screenforge.startRecording).not.toHaveBeenCalled();
      expect(screenforge.systemWarning).not.toHaveBeenCalled();
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

  describe('screenshot mode', () => {
    beforeEach(() => installMocks('native'));

    const switchToScreenshot = async () => {
      render(<FloatingToolbar />);
      await waitFor(() => expect(screenforge.getCaptureBackend).toHaveBeenCalled());
      fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }));
    };

    it('swaps Record for a shutter and hides the video-only controls', async () => {
      render(<FloatingToolbar />);
      await waitFor(() => expect(screenforge.getCaptureBackend).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: 'More options' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }));
      expect(screen.getByRole('button', { name: 'Screenshot' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.queryByRole('button', { name: 'Record' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Take screenshot' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'More options' })).not.toBeInTheDocument();
    });

    it('switches back to Video when the record shortcut is pressed', async () => {
      await switchToScreenshot();
      const onVideoMode = screenforge.onVideoModeRequested.mock.calls.at(-1)?.[0] as
        | (() => void)
        | undefined;
      act(() => onVideoMode?.());
      expect(screen.getByRole('button', { name: 'Video' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Record' })).toBeInTheDocument();
    });

    it('names the global shortcut in the Screenshot tooltip', async () => {
      render(<FloatingToolbar />);
      await waitFor(() => expect(screenforge.getCaptureShortcuts).toHaveBeenCalled());
      fireEvent.focus(screen.getByRole('button', { name: 'Screenshot' }));
      expect(await screen.findAllByText('Alt+Shift+S')).not.toHaveLength(0);
    });

    it('captures the display, asking only for screen access', async () => {
      await switchToScreenshot();
      fireEvent.click(screen.getByRole('button', { name: 'Take screenshot' }));
      await waitFor(() =>
        expect(screenforge.captureScreenshot).toHaveBeenCalledWith({
          kind: 'display',
          sourceId: 'screen:0',
        }),
      );
      // Screenshots don't track the cursor, so no Accessibility prompt.
      expect(screenforge.prepareScreenshotPermissions).toHaveBeenCalled();
      expect(screenforge.prepareRecordingStartPermissions).not.toHaveBeenCalled();
      expect(screenforge.startRecording).not.toHaveBeenCalled();
    });

    it('opens the area selector in screenshot mode, then captures the area', async () => {
      screenforge.openAreaSelector.mockResolvedValue({ x: 1, y: 2, width: 300, height: 200 });
      await switchToScreenshot();
      fireEvent.click(screen.getByRole('button', { name: 'Area' }));
      await waitFor(() =>
        expect(screenforge.captureScreenshot).toHaveBeenCalledWith({
          kind: 'area',
          sourceId: 'screen:0',
          area: { x: 1, y: 2, width: 300, height: 200 },
        }),
      );
      expect(screenforge.openAreaSelector).toHaveBeenCalledWith('screenshot');
    });

    it('does nothing when the area selection is cancelled', async () => {
      await switchToScreenshot();
      fireEvent.click(screen.getByRole('button', { name: 'Area' }));
      await waitFor(() => expect(screenforge.openAreaSelector).toHaveBeenCalled());
      expect(screenforge.captureScreenshot).not.toHaveBeenCalled();
    });

    it('stops when screen access is missing', async () => {
      screenforge.prepareScreenshotPermissions.mockRejectedValue(new Error('Screen access needed'));
      await switchToScreenshot();
      fireEvent.click(screen.getByRole('button', { name: 'Take screenshot' }));
      await waitFor(() =>
        expect(screenforge.systemWarning).toHaveBeenCalledWith('Screen access needed'),
      );
      expect(screenforge.captureScreenshot).not.toHaveBeenCalled();
    });

    it('warns when the capture fails', async () => {
      screenforge.captureScreenshot.mockRejectedValue(new Error('boom'));
      await switchToScreenshot();
      fireEvent.click(screen.getByRole('button', { name: 'Take screenshot' }));
      await waitFor(() =>
        expect(screenforge.systemWarning).toHaveBeenCalledWith(
          expect.stringMatching(/couldn't take the screenshot/i),
        ),
      );
      expect(screenforge.writeDiagnosticLog).toHaveBeenCalledWith(
        'toolbar.screenshot.failed',
        expect.objectContaining({ kind: 'display', message: 'boom' }),
      );
    });
  });

  describe('Linux on native Wayland: a window that is just the toolbar', () => {
    const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform');
    beforeEach(() => {
      installMocks('wayland-portal');
      screenforge.getToolbarLayout.mockResolvedValue('window');
      Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true });
    });
    afterEach(() => {
      delete (navigator as unknown as Record<string, unknown>).platform;
      if (platform) {
        Object.defineProperty(Navigator.prototype, 'platform', platform);
      }
    });

    it('sizes its window to the pill, never shapes click-through, and moves by its handle', async () => {
      // The pill (with its handle above it) is 600×84 at the window's top-left padding.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 24,
        top: 0,
        right: 624,
        bottom: 84,
        width: 600,
        height: 84,
        x: 24,
        y: 0,
        toJSON: () => ({}),
      });
      const { container } = render(<FloatingToolbar />);
      await waitFor(() =>
        expect(screenforge.setToolbarSize).toHaveBeenCalledWith({ width: 648, height: 108 }),
      );
      expect(screenforge.setToolbarShape).not.toHaveBeenCalled();
      const handle = container.querySelector('[data-toolbar-drag-handle]') as HTMLElement;
      // The handle is a window drag region (index.css: -webkit-app-region: drag).
      expect(handle).toHaveClass('app-drag');
    });

    it('opens its menus below the pill, where the window can grow', async () => {
      render(<FloatingToolbar />);
      const more = await screen.findByRole('button', { name: 'More options' });
      fireEvent.pointerDown(more, { button: 0, pointerType: 'mouse' });
      await waitFor(() =>
        expect(document.querySelector('[role="menu"]')).toHaveAttribute('data-side', 'bottom'),
      );
    });
  });

  it('keeps the full-screen overlay on macOS and Windows: never asks for a layout', async () => {
    installMocks('native');
    render(<FloatingToolbar />);
    await waitFor(() => expect(screenforge.getCaptureBackend).toHaveBeenCalled());
    expect(screenforge.getToolbarLayout).not.toHaveBeenCalled();
    expect(screenforge.setToolbarSize).not.toHaveBeenCalled();
  });
});
