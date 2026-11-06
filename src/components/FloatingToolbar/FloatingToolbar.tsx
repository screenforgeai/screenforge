import { useState, useRef, useEffect, useCallback, useEffectEvent, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import {
  IconX,
  IconHome,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconDeviceDesktop,
  IconAppWindow,
  IconPlayerRecordFilled,
  IconCheck,
  IconVideo,
  IconVideoOff,
  IconTrash,
  IconMoreVertical,
  IconScript,
  IconCrop,
} from 'src/lib/icons';
import { trackEvent } from 'src/lib/analytics';
import {
  Button,
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../lib/ui';
import type {
  DesktopSource,
  CursorEvent,
  CaptureBackend,
  ToolbarShapeRect,
} from '../../types/index';
import { FloatingToolbarMic } from './_components/FloatingToolbarMic';
import { FloatingToolbarMenuEmptyState } from './_components/FloatingToolbarMenuEmptyState';
import { FloatingToolbarScreenshot } from './_components/FloatingToolbarScreenshot';

type SourceTab = 'display' | 'window' | 'area';
type RecordState = 'idle' | 'countdown' | 'recording' | 'paused';

const VIDEO_STOP_TIMEOUT_MS = 15000;
// Wayland finalization uploads the webm and transcodes it to H.264, which
// scales with recording length — allow far longer than the native path.
const WAYLAND_VIDEO_STOP_TIMEOUT_MS = 10 * 60 * 1000;
const MIC_STOP_TIMEOUT_MS = 5000;
const CAMERA_STOP_TIMEOUT_MS = 7000;
const AUDIO_MERGE_TIMEOUT_MS = 15000;
const CAMERA_CAPTURE_BITRATE = 4_000_000;

// Linux: setIgnoreMouseEvents' `forward` option is unsupported, so a
// click-through window would never receive the mouse events the hover
// detection below relies on. Instead the window's input region (X11 shape) is
// restricted to the toolbar rects, which the renderer measures and reports —
// hovering the toolbar expands the shape to the full window (the same
// "interactive" state macOS/Windows use) and leaving shrinks it back.
const IS_LINUX = navigator.platform.startsWith('Linux');
const SHAPE_MEASURE_INTERVAL_MS = 200;
// Keeps drop shadows and hover affordances inside the drawable region while
// the shape is shrunken. Tooltips and menus only appear in the hovered
// full-window state, so they need no extra padding.
const SHAPE_PAD = 24;

// Prefer hardware-accelerated H.264 over software VP8/VP9 for camera recording.
// On Apple Silicon, H.264 is encoded by VideoToolbox; VP8 is pure CPU (libvpx).
const CAMERA_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1',
  'video/webm;codecs=h264',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
];

function chooseCameraRecorderOptions(): MediaRecorderOptions {
  const mimeType = CAMERA_MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
  return mimeType
    ? { mimeType, videoBitsPerSecond: CAMERA_CAPTURE_BITRATE }
    : { videoBitsPerSecond: CAMERA_CAPTURE_BITRATE };
}

const Divider = () => {
  return <div className="h-6 w-px bg-sf-border-lt" />;
};

function formatTime(secs: number): string {
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function tabCls(active: boolean, disabled = false) {
  return [
    'flex items-center justify-center rounded-full p-2 transition-all outline-none focus:outline-none focus-visible:outline-none',
    active ? 'bg-[#1e1e22] text-sf-primary shadow-sm' : 'text-sf-secondary hover:text-sf-primary',
    disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
  ]
    .filter(Boolean)
    .join(' ');
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }

  return 'Could not finish the recording. Please try again.';
}

function logToolbarDiagnostic(scope: string, payload?: unknown): void {
  window.screenforge.writeDiagnosticLog(scope, payload);
}

function resolveSourceIdForTab(
  tab: SourceTab,
  selectedSource: DesktopSource | null,
  sources: DesktopSource[],
): string | null {
  if (tab === 'display') {
    return (
      (selectedSource?.id?.startsWith('screen') ? selectedSource.id : null) ??
      sources.find((source) => source.id.startsWith('screen'))?.id ??
      'screen:0'
    );
  }

  if (tab === 'window') {
    return selectedSource?.id ?? null;
  }

  if (tab === 'area') {
    return sources.find((source) => source.id.startsWith('screen'))?.id ?? 'screen:0';
  }

  return null;
}

function pauseMediaRecorder(recorder: MediaRecorder | null, label: string): void {
  if (!recorder || recorder.state !== 'recording') {
    return;
  }

  try {
    recorder.pause();
  } catch (error) {
    console.warn(`[${label}] failed to pause recorder:`, error);
  }
}

function resumeMediaRecorder(recorder: MediaRecorder | null, label: string): void {
  if (!recorder || recorder.state !== 'paused') {
    return;
  }

  try {
    recorder.resume();
  } catch (error) {
    console.warn(`[${label}] failed to resume recorder:`, error);
  }
}

const IRRELEVANT_WINDOW_NAME_PATTERNS = [
  /^gesture overlay$/i,
  /^gesture blocking overlay$/i,
  /^app icon overlay$/i,
  /^window overlay$/i,
  /^app icon window$/i,
  /^window gesture icon$/i,
  /^window gesture overlay$/i,
  /^screenforgetoolbar$/i,
];
const IRRELEVANT_WINDOW_APP_NAME_PATTERNS = [/^screenforge$/i, /^screenforgecapture$/i];

function cleanSourceText(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getWindowSourcePrimaryLabel(source: DesktopSource): string {
  return cleanSourceText(source.appName) ?? cleanSourceText(source.name) ?? 'Window';
}

function getWindowSourceTitle(source: DesktopSource): string | null {
  return cleanSourceText(source.windowTitle) ?? cleanSourceText(source.name);
}

function focusDesktopSourceWindow(source: DesktopSource | null): void {
  if (!source?.id.startsWith('window')) {
    return;
  }

  window.screenforge.focusWindow({
    appName: cleanSourceText(source.appName) ?? undefined,
    windowTitle: getWindowSourceTitle(source) ?? undefined,
    sourceId: source.id,
  });
}

function getWindowSourceSubtitle(
  source: DesktopSource,
  duplicatePrimaryLabelCounts: Map<string, number>,
): string | null {
  const primaryLabel = getWindowSourcePrimaryLabel(source);
  const windowTitle = getWindowSourceTitle(source);
  const duplicateCount = duplicatePrimaryLabelCounts.get(primaryLabel) ?? 0;

  if (!windowTitle || windowTitle === primaryLabel) {
    return null;
  }

  return duplicateCount > 1 ? windowTitle : null;
}

function isRelevantWindowSource(source: DesktopSource): boolean {
  if (!source.id.startsWith('window')) {
    return false;
  }

  const appName = cleanSourceText(source.appName);
  const rawName = cleanSourceText(source.name);
  const windowTitle = getWindowSourceTitle(source);

  if (appName && IRRELEVANT_WINDOW_APP_NAME_PATTERNS.some((pattern) => pattern.test(appName))) {
    return false;
  }

  return ![rawName, windowTitle].some((value) =>
    value ? IRRELEVANT_WINDOW_NAME_PATTERNS.some((pattern) => pattern.test(value)) : false,
  );
}

function getWindowSourceRelevance(source: DesktopSource): number {
  let score = 0;
  const primaryLabel = getWindowSourcePrimaryLabel(source);
  const windowTitle = getWindowSourceTitle(source);

  if (source.appIcon) {
    score += 4;
  }

  if (source.appName) {
    score += 3;
  }

  if (source.thumbnail) {
    score += 2;
  }

  if (primaryLabel.length > 0) {
    score += 1;
  }

  if (windowTitle && /^(window|untitled)$/i.test(windowTitle)) {
    score -= 1;
  }

  return score;
}

export const FloatingToolbar = () => {
  const { t } = useTranslation('toolbar');
  const [tab, setTab] = useState<SourceTab>('display');
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string | null>(null);
  const [micLoading, setMicLoading] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [windowMenuOpen, setWindowMenuOpen] = useState(false);
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [discardConfirming, setDiscardConfirming] = useState(false);
  const [teleprompterOpen, setTeleprompterOpen] = useState(false);
  const [teleprompterLoading, setTeleprompterLoading] = useState(false);
  const teleprompterLoadingRef = useRef(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [screenshotMenuOpen, setScreenshotMenuOpen] = useState(false);
  const [isAppendMode, setIsAppendMode] = useState(false);
  const [sceneOverlayOpen, setSceneOverlayOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedArea, setSelectedArea] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    window.screenforge.getAppendMode().then(setIsAppendMode);
  }, []);

  useEffect(() => {
    const unsubReady = window.screenforge.onTeleprompterReady(() => {
      teleprompterLoadingRef.current = false;
      setTeleprompterOpen(true);
      setTeleprompterLoading(false);
      setMoreMenuOpen(false);
    });
    const unsubClosed = window.screenforge.onTeleprompterClosed(() => {
      teleprompterLoadingRef.current = false;
      setTeleprompterOpen(false);
      setTeleprompterLoading(false);
    });
    return () => {
      unsubReady();
      unsubClosed();
    };
  }, []);

  useEffect(() => {
    const unsubReady = window.screenforge.onSceneOverlayReady(() => setSceneOverlayOpen(true));
    const unsubClosed = window.screenforge.onSceneOverlayClosed(() => setSceneOverlayOpen(false));
    return () => {
      unsubReady();
      unsubClosed();
    };
  }, []);

  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recordStateRef = useRef<RecordState>('idle');
  const micLevelRef = useRef(0);
  const micUiUpdateTsRef = useRef(0);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraRecorderRef = useRef<MediaRecorder | null>(null);
  const cameraChunksRef = useRef<Blob[]>([]);
  // Wayland (Linux): the toolbar records the screen itself from the PipeWire
  // portal stream — the main process can't grab the screen on Wayland.
  const captureBackendRef = useRef<CaptureBackend>('native');
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const screenChunksRef = useRef<Blob[]>([]);
  const [screenTrack, setScreenTrack] = useState<MediaStreamTrack | null>(null);
  const toolbarRootRef = useRef<HTMLDivElement | null>(null);
  const toolbarInteractiveRef = useRef<boolean | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragControls = useDragControls();

  const windowSources = useMemo(
    () =>
      sources.filter(isRelevantWindowSource).sort((a, b) => {
        const relevanceDelta = getWindowSourceRelevance(b) - getWindowSourceRelevance(a);
        if (relevanceDelta !== 0) {
          return relevanceDelta;
        }
        return getWindowSourcePrimaryLabel(a).localeCompare(getWindowSourcePrimaryLabel(b));
      }),
    [sources],
  );

  const duplicateWindowAppCounts = useMemo(
    () =>
      windowSources.reduce((counts, source) => {
        const label = getWindowSourcePrimaryLabel(source);
        counts.set(label, (counts.get(label) ?? 0) + 1);
        return counts;
      }, new Map<string, number>()),
    [windowSources],
  );

  const toolbarButtonCls =
    'focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:border-transparent';

  const handleStartEvent = useEffectEvent(() => {
    void handleStart();
  });

  const handleStopEvent = useEffectEvent(() => {
    void handleStop();
  });

  useEffect(() => {
    if (!selectedSource) {
      return;
    }

    const nextSelectedSource =
      windowSources.find((source) => source.id === selectedSource.id) ?? null;

    if (!nextSelectedSource) {
      setSelectedSource(null);
      return;
    }

    if (
      nextSelectedSource.name !== selectedSource.name ||
      nextSelectedSource.thumbnail !== selectedSource.thumbnail ||
      nextSelectedSource.appIcon !== selectedSource.appIcon ||
      nextSelectedSource.appName !== selectedSource.appName ||
      nextSelectedSource.windowTitle !== selectedSource.windowTitle
    ) {
      setSelectedSource(nextSelectedSource);
    }
  }, [selectedSource, windowSources]);

  useEffect(() => {
    recordStateRef.current = recordState;
  }, [recordState]);

  useEffect(() => {
    window.screenforge
      .getCaptureBackend()
      .then((backend) => {
        captureBackendRef.current = backend;
      })
      .catch((err) => {
        console.error('[recording] could not resolve capture backend:', err);
      });
  }, []);

  useEffect(() => {
    if (recordState === 'idle' && micEnabled) {
      setMicLevel(micLevelRef.current);
    }
  }, [micEnabled, recordState]);

  const stopAnalyserLoop = useCallback(() => {
    if (analyserRafRef.current !== null) {
      cancelAnimationFrame(analyserRafRef.current);
      analyserRafRef.current = null;
    }
    audioCtxRef.current?.close().catch(() => {
      /* swallow close errors */
    });
    audioCtxRef.current = null;
    micLevelRef.current = 0;
    micUiUpdateTsRef.current = 0;
    setMicLevel(0);
  }, []);

  const startAnalyserLoop = useCallback(
    (stream: MediaStream) => {
      stopAnalyserLoop();

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.85;
      source.connect(analyser);

      audioCtxRef.current = audioCtx;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        const nextLevel = Math.min(1, avg / 80);
        micLevelRef.current = nextLevel;

        const now = performance.now();
        const canUpdateUi =
          recordStateRef.current === 'idle' && now - micUiUpdateTsRef.current >= 50;
        if (canUpdateUi) {
          micUiUpdateTsRef.current = now;
          setMicLevel((prev) => (Math.abs(prev - nextLevel) < 0.02 ? prev : nextLevel));
        }

        analyserRafRef.current = requestAnimationFrame(tick);
      };

      analyserRafRef.current = requestAnimationFrame(tick);
    },
    [stopAnalyserLoop],
  );

  const stopMicStream = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    stopAnalyserLoop();
  }, [stopAnalyserLoop]);

  const refreshMicDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === 'audioinput');
      setMicDevices(audioInputs);

      if (audioInputs.length === 0) {
        setSelectedMicId(null);
        return;
      }

      setSelectedMicId((current) => {
        if (!current) {
          return audioInputs[0].deviceId;
        }
        return audioInputs.some((device) => device.deviceId === current)
          ? current
          : audioInputs[0].deviceId;
      });
    } catch (err) {
      console.error('[mic] enumerateDevices failed:', err);
      setMicDevices([]);
      setSelectedMicId(null);
    }
  }, []);

  const refreshCameraDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((device) => device.kind === 'videoinput');
      setCameraDevices(videoInputs);

      if (videoInputs.length === 0) {
        setSelectedCameraId(null);
        return;
      }

      setSelectedCameraId((current) => {
        if (!current) {
          return videoInputs[0].deviceId;
        }
        return videoInputs.some((device) => device.deviceId === current)
          ? current
          : videoInputs[0].deviceId;
      });
    } catch (err) {
      console.error('[camera] enumerateDevices failed:', err);
      setCameraDevices([]);
      setSelectedCameraId(null);
    }
  }, []);

  const ensureRecordingStartPermissions = useCallback(async (): Promise<boolean> => {
    try {
      await window.screenforge.prepareRecordingStartPermissions();
      logToolbarDiagnostic('toolbar.recording.permissions-granted');
      return true;
    } catch (err) {
      logToolbarDiagnostic('toolbar.recording.permissions-failed', {
        message: getErrorMessage(err),
      });
      window.screenforge.systemWarning(getErrorMessage(err));
      return false;
    }
  }, []);

  const ensureRendererMediaAccess = useCallback(
    async (permission: 'microphone' | 'camera'): Promise<boolean> => {
      const statuses = await window.screenforge.getStartupPermissionStatuses().catch(() => null);
      const currentStatus = statuses?.[permission];

      if (currentStatus === 'granted') {
        return true;
      }

      if (currentStatus === 'not-determined' || currentStatus === 'unknown') {
        const nextStatus = await window.screenforge
          .requestMediaAccess(permission)
          .catch(() => 'unknown');
        return nextStatus === 'granted';
      }

      return false;
    },
    [],
  );

  const startMicStream = useCallback(
    async (deviceId: string | null, fallbackToDefault = true): Promise<boolean> => {
      try {
        const hasPermission = await ensureRendererMediaAccess('microphone');
        if (!hasPermission) {
          setMicEnabled(false);
          return false;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          },
          video: false,
        });

        stopMicStream();
        micStreamRef.current = stream;
        setMicEnabled(true);

        const activeTrack = stream.getAudioTracks()[0];
        const activeDeviceId = activeTrack?.getSettings().deviceId ?? deviceId;
        if (activeDeviceId) {
          setSelectedMicId(activeDeviceId);
        }

        startAnalyserLoop(stream);
        void refreshMicDevices();
        return true;
      } catch (err) {
        if (deviceId && fallbackToDefault) {
          return startMicStream(null, false);
        }

        console.error('[mic] getUserMedia denied:', err);
        stopMicStream();
        setMicEnabled(false);
        const e = err as DOMException;
        const message =
          e?.name === 'NotFoundError' || e?.name === 'DevicesNotFoundError'
            ? t('micNotFound')
            : t('micDenied');
        window.screenforge.systemWarning(message);
        return false;
      }
    },
    [ensureRendererMediaAccess, refreshMicDevices, startAnalyserLoop, stopMicStream, t],
  );

  const stopCameraPreview = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    window.screenforge.closeCameraPreview();
  }, []);

  const startCameraPreview = useCallback(
    async (deviceId: string | null, fallbackToDefault = true): Promise<boolean> => {
      try {
        const hasPermission = await ensureRendererMediaAccess('camera');
        if (!hasPermission) {
          setCameraEnabled(false);
          return false;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          },
          audio: false,
        });

        stopCameraPreview();
        cameraStreamRef.current = stream;
        setCameraEnabled(true);

        const activeTrack = stream.getVideoTracks()[0];
        const activeDeviceId = activeTrack?.getSettings().deviceId ?? deviceId;
        if (activeDeviceId) {
          setSelectedCameraId(activeDeviceId);
        }

        window.screenforge.openCameraPreview(activeDeviceId ?? null);

        void refreshCameraDevices();
        return true;
      } catch (err) {
        if (deviceId && fallbackToDefault) {
          return startCameraPreview(null, false);
        }

        console.error('[camera] getUserMedia denied:', err);
        setCameraEnabled(false);
        const e = err as DOMException;
        const message =
          e?.name === 'NotFoundError' || e?.name === 'DevicesNotFoundError'
            ? t('cameraNotFound')
            : t('cameraDenied');
        window.screenforge.systemWarning(message);
        return false;
      }
    },
    [ensureRendererMediaAccess, refreshCameraDevices, stopCameraPreview, t],
  );

  useEffect(() => {
    void refreshMicDevices();
    void refreshCameraDevices();

    const onDeviceChange = () => {
      void refreshMicDevices();
      void refreshCameraDevices();
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    };
  }, [refreshCameraDevices, refreshMicDevices]);

  useEffect(() => {
    if (recordState === 'recording') {
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [recordState]);

  useEffect(() => {
    if (recordState !== 'countdown') {
      return;
    }
    if (countdown <= 0) {
      handleStartEvent();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, recordState]);

  // Linux: main process sends this when F9 is pressed or tray stop is clicked.
  useEffect(() => {
    return window.screenforge.onStopRequested(() => {
      handleStopEvent();
    });
  }, []);

  // Wayland: the user can end the capture from the OS screen-share indicator —
  // treat that like pressing stop.
  useEffect(() => {
    if (!screenTrack) {
      return;
    }

    const onEnded = () => {
      if (recordStateRef.current === 'recording' || recordStateRef.current === 'paused') {
        handleStopEvent();
      }
    };
    screenTrack.addEventListener('ended', onEnded);
    return () => {
      screenTrack.removeEventListener('ended', onEnded);
    };
  }, [screenTrack]);

  // Cleanup mic stream and audio context on unmount
  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch (err) {
          console.error('[audio] recorder stop on unmount failed:', err);
        }
      }
      mediaRecorderRef.current = null;
      stopMicStream();

      const cameraRecorder = cameraRecorderRef.current;
      if (cameraRecorder && cameraRecorder.state !== 'inactive') {
        try {
          cameraRecorder.stop();
        } catch (err) {
          console.error('[camera] recorder stop on unmount failed:', err);
        }
      }
      cameraRecorderRef.current = null;
      stopCameraPreview();

      const screenRecorder = screenRecorderRef.current;
      if (screenRecorder && screenRecorder.state !== 'inactive') {
        try {
          screenRecorder.stop();
        } catch (err) {
          console.error('[screen] recorder stop on unmount failed:', err);
        }
      }
      screenRecorderRef.current = null;
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    };
  }, [stopCameraPreview, stopMicStream]);

  async function handleStart() {
    const sourceId = resolveSourceIdForTab(tab, selectedSource, sources);
    if (!sourceId) {
      window.screenforge.systemWarning(tab === 'window' ? t('chooseWindow') : t('noDisplaySource'));
      return;
    }

    const startedAt = Date.now();
    logToolbarDiagnostic('toolbar.recording.start-clicked', {
      sourceId,
      tab,
      micEnabled,
      cameraEnabled,
    });

    try {
      if (tab === 'window') {
        focusDesktopSourceWindow(selectedSource);
      }

      const cropArea = tab === 'area' ? selectedArea : null;
      if (captureBackendRef.current === 'wayland-portal') {
        await startWaylandPortalCapture();
        try {
          await window.screenforge.startRecording(sourceId, cropArea, { rendererCapture: true });
        } catch (err) {
          discardWaylandPortalCapture();
          throw err;
        }
      } else {
        await window.screenforge.startRecording(sourceId, cropArea);
      }
    } catch (err) {
      console.error('[recording] start failed:', err);
      logToolbarDiagnostic('toolbar.recording.start-failed', {
        sourceId,
        message: getErrorMessage(err),
      });
      setRecordState('idle');
      setCountdown(3);
      window.screenforge.systemWarning(getErrorMessage(err));
      return;
    }

    const startupLatencyMs = Date.now() - startedAt;
    logToolbarDiagnostic('toolbar.recording.start-resolved', {
      sourceId,
      startupLatencyMs,
    });
    trackEvent('recording_started', {
      source_type: tab,
      has_mic: micEnabled,
      has_camera: cameraEnabled,
      startup_latency_ms: startupLatencyMs,
    });

    startTimeRef.current = Date.now();
    setElapsed(0);
    setRecordState('recording');
    localStorage.setItem('sf:recording-start', Date.now().toString());
    // On Linux: hides the toolbar window so it doesn't appear in the recording.
    // Main process replaces it with a system tray icon + F9 shortcut to stop.
    window.screenforge.hideToolbar();

    // Mic level visualisation is unused during recording — stop the RAF/FFT loop.
    stopAnalyserLoop();

    // Start mic recording if enabled (after FFmpeg is confirmed capturing)
    if (micEnabled && micStreamRef.current) {
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(micStreamRef.current);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start(1000);
    }

    if (cameraEnabled && cameraStreamRef.current) {
      cameraChunksRef.current = [];
      const recorder = new MediaRecorder(cameraStreamRef.current, chooseCameraRecorderOptions());
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          cameraChunksRef.current.push(e.data);
        }
      };
      cameraRecorderRef.current = recorder;
      recorder.start(1000);
    }
  }

  async function handleAreaRecordClick() {
    if (recordState !== 'idle') {
      return;
    }

    setTab('area');

    try {
      setIsAppendMode(await window.screenforge.getAppendMode());
    } catch {
      setIsAppendMode(false);
    }

    const hasRecordingPermissions = await ensureRecordingStartPermissions();
    if (!hasRecordingPermissions) {
      return;
    }

    const area = await window.screenforge.openAreaSelector();
    if (!area) {
      setTab('display');
      return;
    }

    setSelectedArea(area);
    setCountdown(3);
    setRecordState('countdown');
  }

  async function handleRecordClick() {
    try {
      setIsAppendMode(await window.screenforge.getAppendMode());
    } catch {
      setIsAppendMode(false);
    }

    const hasRecordingPermissions = await ensureRecordingStartPermissions();
    if (!hasRecordingPermissions) {
      return;
    }

    setCountdown(3);
    setRecordState('countdown');
  }

  function handlePause() {
    if (recordState === 'recording') {
      window.screenforge.pauseRecording();
      pauseMediaRecorder(mediaRecorderRef.current, 'audio');
      pauseMediaRecorder(cameraRecorderRef.current, 'camera');
      pauseMediaRecorder(screenRecorderRef.current, 'screen');
      setRecordState('paused');
      trackEvent('recording_paused', { elapsed_seconds: elapsed });
    } else {
      window.screenforge.resumeRecording();
      resumeMediaRecorder(mediaRecorderRef.current, 'audio');
      resumeMediaRecorder(cameraRecorderRef.current, 'camera');
      resumeMediaRecorder(screenRecorderRef.current, 'screen');
      startTimeRef.current = Date.now() - elapsed * 1000;
      setRecordState('recording');
      trackEvent('recording_resumed', { elapsed_seconds: elapsed });
    }
  }

  async function handleDiscard() {
    setDiscardConfirming(false);
    setRecordState('idle');

    // Stop mic recorder without saving
    const micRecorder = mediaRecorderRef.current;
    if (micRecorder && micRecorder.state !== 'inactive') {
      try {
        micRecorder.stop();
      } catch {
        /* swallow */
      }
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];

    // Stop camera recorder without saving
    const camRecorder = cameraRecorderRef.current;
    if (camRecorder && camRecorder.state !== 'inactive') {
      try {
        camRecorder.stop();
      } catch {
        /* swallow */
      }
    }
    cameraRecorderRef.current = null;
    cameraChunksRef.current = [];
    stopCameraPreview();

    discardWaylandPortalCapture();

    try {
      await window.screenforge.discardRecording();
    } catch (err) {
      console.error('[recording] discard failed:', err);
    }

    await window.screenforge.clearAppendMode().catch(() => undefined);
    setIsAppendMode(false);

    if (micEnabled && micStreamRef.current) {
      startAnalyserLoop(micStreamRef.current);
    }

    logToolbarDiagnostic('toolbar.recording.discarded', { elapsed });
    trackEvent('recording_discarded', { elapsed_seconds: elapsed });
  }

  async function handleStop() {
    logToolbarDiagnostic('toolbar.recording.stop-clicked', {
      elapsed,
      micEnabled,
      cameraEnabled,
    });
    setDiscardConfirming(false);
    setRecordState('idle');

    if (teleprompterOpen) {
      window.screenforge.closeTeleprompter();
    }

    window.screenforge.closeSceneOverlay();
    window.screenforge.recordingProcessing();
    window.screenforge.closeCameraPreview();
    logToolbarDiagnostic('toolbar.recording.processing-emitted');

    try {
      // Stop MediaRecorder and FFmpeg concurrently to minimise drift.
      // Mic finalization should never block the video from loading forever.
      const [micResult, cameraResult, videoResult] = await Promise.allSettled([
        withTimeout(stopMicRecording(), 'Microphone finalization', MIC_STOP_TIMEOUT_MS),
        withTimeout(stopCameraRecording(), 'Camera finalization', CAMERA_STOP_TIMEOUT_MS),
        withTimeout(
          stopVideoRecording(),
          'Video finalization',
          captureBackendRef.current === 'wayland-portal'
            ? WAYLAND_VIDEO_STOP_TIMEOUT_MS
            : VIDEO_STOP_TIMEOUT_MS,
        ),
      ]);

      if (videoResult.status === 'rejected') {
        throw videoResult.reason;
      }

      const {
        mouseData,
        recordingArea,
        captureBoundsTimeline,
        filePath,
        hasEmbeddedAudio: sourceHasEmbeddedAudio,
        startTime,
        durationMs,
      } = videoResult.value;
      // Use the probed media duration as the authoritative timeline length.
      // durationMs = effectiveDurationMs from stopRecording(), which uses ffprobe on the
      // actual file. Falling back to elapsed (wall time) would make the timeline longer than
      // the video when the OS terminates the capture stream early, causing the playhead to
      // jump to the end as soon as video.ended fires.
      const duration = durationMs > 0 ? durationMs / 1000 : elapsed;
      const audioPath = micResult.status === 'fulfilled' ? micResult.value : null;
      const cameraPath = cameraResult.status === 'fulfilled' ? cameraResult.value : null;

      if (micResult.status === 'rejected') {
        console.error('[audio] mic stop failed:', micResult.reason);
        logToolbarDiagnostic('toolbar.recording.mic-stop-failed', {
          message: getErrorMessage(micResult.reason),
        });
      }
      if (cameraResult.status === 'rejected') {
        console.error('[camera] camera stop failed:', cameraResult.reason);
        logToolbarDiagnostic('toolbar.recording.camera-stop-failed', {
          message: getErrorMessage(cameraResult.reason),
        });
        window.screenforge.systemWarning(t('cameraCaptureFailed'));
      }

      let finalPath = filePath;
      let timelineAudioPath = audioPath;
      let hasEmbeddedAudio = sourceHasEmbeddedAudio;
      if (audioPath) {
        try {
          finalPath = await withTimeout(
            window.screenforge.mergeAudio(filePath, audioPath),
            'Audio merge',
            AUDIO_MERGE_TIMEOUT_MS,
          );
          if (finalPath !== filePath) {
            timelineAudioPath = finalPath;
          }
          hasEmbeddedAudio = true;
        } catch (err) {
          console.error('[audio] merge failed, using video-only output:', err);
          logToolbarDiagnostic('toolbar.recording.audio-merge-failed', {
            message: getErrorMessage(err),
          });
        }
      }

      logToolbarDiagnostic('toolbar.recording.finished-emitted', {
        filePath: finalPath,
        duration,
        audioPath: timelineAudioPath,
        hasEmbeddedAudio,
        cameraPath,
      });
      trackEvent('recording_completed', {
        duration_seconds: Math.round(duration),
        has_mic: Boolean(audioPath),
        has_camera: Boolean(cameraPath),
        is_append: isAppendMode,
      });
      window.screenforge.recordingFinished({
        filePath: finalPath,
        mouseData: mouseData as CursorEvent[],
        duration,
        startTime,
        recordingArea,
        captureBoundsTimeline,
        hasEmbeddedAudio,
        audioPath: timelineAudioPath ?? undefined,
        cameraPath: cameraPath ?? undefined,
      });
    } catch (err) {
      console.error('[recording] stop pipeline failed:', err);
      logToolbarDiagnostic('toolbar.recording.stop-failed', {
        message: getErrorMessage(err),
      });
      window.screenforge.recordingFailed(getErrorMessage(err));
    } finally {
      await window.screenforge.clearAppendMode().catch(() => undefined);
      setIsAppendMode(false);
      if (micEnabled && micStreamRef.current) {
        startAnalyserLoop(micStreamRef.current);
      }
    }
  }

  function handleTabChange(t: SourceTab) {
    setTab(t);
    if (t !== 'window') {
      setSelectedSource(null);
    }
    if (t !== 'area') {
      setSelectedArea(null);
    }
  }

  async function handleMicToggle() {
    if (recordState !== 'idle' || micLoading) {
      return;
    }

    if (micEnabled) {
      stopMicStream();
      setMicEnabled(false);
      return;
    }

    setMicLoading(true);
    try {
      const didStart = await startMicStream(selectedMicId);
      if (didStart) {
        setMicEnabled(true);
      }
    } finally {
      setMicLoading(false);
    }
  }

  async function handleMicDeviceSelect(deviceId: string) {
    if (recordState !== 'idle' || micLoading) {
      return;
    }

    setSelectedMicId(deviceId);
    if (!micEnabled) {
      return;
    }

    setMicLoading(true);
    try {
      await startMicStream(deviceId);
    } finally {
      setMicLoading(false);
    }
  }

  async function handleCameraToggle() {
    if (recordState !== 'idle' || cameraLoading) {
      return;
    }

    if (cameraEnabled) {
      stopCameraPreview();
      setCameraEnabled(false);
      return;
    }

    setCameraLoading(true);
    try {
      const didStart = await startCameraPreview(selectedCameraId);
      if (didStart) {
        setCameraEnabled(true);
      }
    } finally {
      setCameraLoading(false);
    }
  }

  async function handleCameraDeviceSelect(deviceId: string) {
    if (recordState !== 'idle' || cameraLoading) {
      return;
    }

    setSelectedCameraId(deviceId);
    if (!cameraEnabled) {
      return;
    }

    setCameraLoading(true);
    try {
      await startCameraPreview(deviceId);
    } finally {
      setCameraLoading(false);
    }
  }

  // ── Wayland portal capture (Linux) ─────────────────────────────────────────
  // On Wayland the main process cannot grab the screen; the toolbar records
  // the PipeWire portal stream with MediaRecorder and hands the webm to the
  // main process at stop time for transcoding.

  function stopWaylandStream(): void {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenTrack(null);
  }

  async function startWaylandPortalCapture(): Promise<void> {
    // Opens the OS screen-share picker (user chooses a screen or window).
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: { frameRate: { ideal: 60, max: 60 } },
    });
    screenStreamRef.current = stream;
    screenChunksRef.current = [];

    // Tracked via state so the track-ended effect below can react when the
    // user ends the capture from the OS screen-share indicator.
    const [videoTrack] = stream.getVideoTracks();
    setScreenTrack(videoTrack ?? null);

    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find((candidate) =>
      MediaRecorder.isTypeSupported(candidate),
    );
    const settings = videoTrack?.getSettings();
    const pixels =
      (settings?.width ?? window.screen.width * window.devicePixelRatio) *
      (settings?.height ?? window.screen.height * window.devicePixelRatio);
    const videoBitsPerSecond = Math.min(40_000_000, Math.max(8_000_000, Math.round(pixels * 4)));

    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond,
    });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        screenChunksRef.current.push(e.data);
      }
    };
    screenRecorderRef.current = recorder;
    recorder.start(1000);
  }

  async function stopWaylandPortalCapture(): Promise<{
    webmPath: string;
    width?: number;
    height?: number;
  } | null> {
    const recorder = screenRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      stopWaylandStream();
      return null;
    }

    const [videoTrack] = screenStreamRef.current?.getVideoTracks() ?? [];
    const settings = videoTrack?.getSettings();

    return new Promise((resolve, reject) => {
      recorder.addEventListener(
        'stop',
        async () => {
          const blob = new Blob(screenChunksRef.current, { type: 'video/webm' });
          screenChunksRef.current = [];
          screenRecorderRef.current = null;
          stopWaylandStream();

          try {
            if (blob.size === 0) {
              throw new Error('Screen capture did not produce any video data.');
            }
            const buffer = await blob.arrayBuffer();
            const webmPath = await window.screenforge.saveRecording(buffer);
            resolve({ webmPath, width: settings?.width, height: settings?.height });
          } catch (err) {
            reject(err);
          }
        },
        { once: true },
      );

      recorder.requestData();
      recorder.stop();
    });
  }

  function discardWaylandPortalCapture(): void {
    const recorder = screenRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* swallow */
      }
    }
    screenRecorderRef.current = null;
    screenChunksRef.current = [];
    stopWaylandStream();
  }

  async function stopVideoRecording(): Promise<
    Awaited<ReturnType<typeof window.screenforge.stopRecording>>
  > {
    if (captureBackendRef.current === 'wayland-portal') {
      const rendererCapture = await stopWaylandPortalCapture();
      return window.screenforge.stopRecording(rendererCapture ?? undefined);
    }
    return window.screenforge.stopRecording();
  }

  async function stopMicRecording(): Promise<string | null> {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return null;
    }

    return new Promise<string | null>((resolve) => {
      recorder.addEventListener(
        'stop',
        async () => {
          const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          audioChunksRef.current = [];
          mediaRecorderRef.current = null;

          try {
            const buffer = await blob.arrayBuffer();
            const audioPath = await window.screenforge.saveAudioCapture(buffer);
            resolve(audioPath);
          } catch (err) {
            console.error('[audio] saveAudioCapture failed:', err);
            resolve(null);
          }
        },
        { once: true },
      );

      recorder.requestData();
      recorder.stop();
    });
  }

  async function stopCameraRecording(): Promise<string | null> {
    const recorder = cameraRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return null;
    }

    return new Promise<string | null>((resolve) => {
      recorder.addEventListener(
        'stop',
        async () => {
          const blob = new Blob(cameraChunksRef.current, { type: 'video/webm' });
          cameraChunksRef.current = [];
          cameraRecorderRef.current = null;

          try {
            const buffer = await blob.arrayBuffer();
            const cameraPath = await window.screenforge.saveCameraCapture(buffer);
            resolve(cameraPath);
          } catch (err) {
            console.error('[camera] saveCameraCapture failed:', err);
            resolve(null);
          }
        },
        { once: true },
      );

      recorder.requestData();
      recorder.stop();
    });
  }

  const pillVisible = tab === 'window' && !!selectedSource;
  const activeWindowSource = pillVisible ? selectedSource : null;
  const cameraLocked = recordState !== 'idle';
  const selectedMic =
    micDevices.find((device) => device.deviceId === selectedMicId) ?? micDevices[0] ?? null;
  const selectedCamera =
    cameraDevices.find((device) => device.deviceId === selectedCameraId) ??
    cameraDevices[0] ??
    null;
  const overlayActive =
    isDragging ||
    windowMenuOpen ||
    micMenuOpen ||
    cameraMenuOpen ||
    moreMenuOpen ||
    screenshotMenuOpen;
  const isPaused = recordState === 'paused';

  const setToolbarMouseInteractivity = useCallback((interactive: boolean) => {
    if (toolbarInteractiveRef.current === interactive) {
      return;
    }

    toolbarInteractiveRef.current = interactive;
    window.screenforge.setToolbarMouseInteractivity(interactive);
  }, []);

  useEffect(() => {
    if (overlayActive) {
      setToolbarMouseInteractivity(true);
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const interactive = Boolean(target?.closest('[data-toolbar-interactive="true"]'));
      setToolbarMouseInteractivity(interactive);
    };

    const handleWindowBlur = () => {
      setToolbarMouseInteractivity(false);
    };

    setToolbarMouseInteractivity(false);
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [windowMenuOpen, micMenuOpen, cameraMenuOpen, overlayActive, setToolbarMouseInteractivity]);

  useEffect(() => {
    if (!IS_LINUX) {
      return;
    }

    let lastSent = '';

    const measure = () => {
      const rects: ToolbarShapeRect[] = [];

      if (recordState !== 'idle') {
        // Countdown draws the full-screen area dim overlay, and shape clips
        // drawing as well as input. During actual recording the window is
        // hidden anyway (tray mode), so the full shape is inert.
        rects.push({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
      } else {
        document.querySelectorAll('[data-toolbar-interactive="true"]').forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            return;
          }
          rects.push({
            x: Math.max(0, Math.round(rect.left) - SHAPE_PAD),
            y: Math.max(0, Math.round(rect.top) - SHAPE_PAD),
            width: Math.round(rect.width) + SHAPE_PAD * 2,
            height: Math.round(rect.height) + SHAPE_PAD * 2,
          });
        });
      }

      const key = JSON.stringify(rects);
      if (key === lastSent) {
        return;
      }
      lastSent = key;
      window.screenforge.setToolbarShape(rects);
    };

    // Poll: framer-motion transforms and layout animations move the toolbar
    // without firing events we could subscribe to. The main process defers
    // applying new rects while the window is in its hovered full-window
    // state, so this never mutates the shape mid-gesture.
    measure();
    const intervalId = window.setInterval(measure, SHAPE_MEASURE_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [recordState]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-end justify-center pb-10 bg-transparent"
    >
      {/* Area recording indicator — dims outside the selected region during countdown/recording/paused */}
      <AnimatePresence>
        {(recordState === 'countdown' || recordState === 'recording' || recordState === 'paused') &&
          selectedArea && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="fixed pointer-events-none"
              style={{
                left: selectedArea.x,
                top: selectedArea.y,
                width: selectedArea.width,
                height: selectedArea.height,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
                borderRadius: 2,
                zIndex: 0,
              }}
            />
          )}
      </AnimatePresence>

      <motion.div
        drag
        dragControls={dragControls}
        dragListener={false}
        dragMomentum={false}
        dragElastic={0}
        dragConstraints={containerRef}
        whileDrag={{ cursor: 'grabbing' }}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={() => setIsDragging(false)}
        data-toolbar-interactive="true"
        className="group relative"
        style={{ paddingTop: 24 }}
      >
        <div
          onPointerDown={(e) => {
            e.preventDefault();
            dragControls.start(e);
          }}
          data-toolbar-interactive="true"
          className="absolute top-0 left-1/2 -translate-x-1/2 flex cursor-grab flex-col items-center gap-1 px-4 py-1 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <div className="flex gap-1">
            <div className="h-1 w-1 rounded-full bg-[#6b6b6b]" />
            <div className="h-1 w-1 rounded-full bg-[#6b6b6b]" />
            <div className="h-1 w-1 rounded-full bg-[#6b6b6b]" />
          </div>
          <div className="flex gap-1">
            <div className="h-1 w-1 rounded-full bg-[#6b6b6b]" />
            <div className="h-1 w-1 rounded-full bg-[#6b6b6b]" />
            <div className="h-1 w-1 rounded-full bg-[#6b6b6b]" />
          </div>
        </div>
        <div
          ref={toolbarRootRef}
          className="relative h-[60px] overflow-hidden rounded-full border border-sf-border-lt bg-[#111113]/90 shadow-2xl"
          style={{ backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
        >
          <div className="flex h-full w-max items-center px-4">
            <AnimatePresence mode="wait">
              {recordState === 'countdown' ? (
                <motion.div
                  key="countdown"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-2 px-2"
                >
                  <span className="text-md text-sf-secondary">{t('startingIn')}</span>
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={countdown}
                      initial={{ opacity: 0, scale: 1.4 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.6 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                      className="min-w-[1ch] text-center font-mono text-2xl font-bold tabular-nums text-sf-primary"
                    >
                      {countdown}
                    </motion.span>
                  </AnimatePresence>
                </motion.div>
              ) : recordState === 'idle' ? (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-0"
                >
                  {/* Minimize to dock */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => window.screenforge.minimizeToDock()}
                        className={`${toolbarButtonCls} cursor-pointer rounded-full text-sf-secondary hover:text-sf-primary`}
                      >
                        <IconX size={15} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{t('minimizeToDock')}</TooltipContent>
                  </Tooltip>

                  {/* Home */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          if (sceneOverlayOpen) {
                            localStorage.setItem('sf:open-scene-modal', Date.now().toString());
                          }
                          window.screenforge.showMain();
                        }}
                        className={`${toolbarButtonCls} cursor-pointer rounded-full text-sf-secondary hover:text-sf-primary`}
                      >
                        <IconHome size={15} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{t('home')}</TooltipContent>
                  </Tooltip>

                  <div className="mx-3">
                    <Divider />
                  </div>

                  {/* Source tabs */}
                  <div className="flex items-center gap-0.5 rounded-full bg-sf-bg p-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleTabChange('display')}
                          className={`${toolbarButtonCls} ${tabCls(tab === 'display')}`}
                        >
                          <IconDeviceDesktop size={16} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{t('display')}</TooltipContent>
                    </Tooltip>

                    <DropdownMenu
                      onOpenChange={(open) => {
                        setWindowMenuOpen(open);
                        if (open) {
                          setSources([]);
                          setSourcesLoading(true);
                          window.screenforge.getSources().then((s) => {
                            setSources(s);
                            setSourcesLoading(false);
                          });
                        } else {
                          setSourcesLoading(false);
                        }
                      }}
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setTab('window')}
                              className={`${toolbarButtonCls} ${tabCls(tab === 'window')}`}
                            >
                              <IconAppWindow size={16} />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {tab === 'window' && selectedSource
                            ? getWindowSourcePrimaryLabel(selectedSource)
                            : t('window')}
                        </TooltipContent>
                      </Tooltip>

                      <DropdownMenuContent
                        side="top"
                        sideOffset={10}
                        align="center"
                        className="min-w-[240px] max-h-56"
                      >
                        {sourcesLoading ? (
                          <div className="flex items-center justify-center py-8">
                            <Spinner className="size-4 text-sf-border fill-sf-primary" />
                          </div>
                        ) : windowSources.length === 0 ? (
                          <FloatingToolbarMenuEmptyState
                            icon={<IconAppWindow size={16} />}
                            title={t('noWindows_title')}
                            description={t('noWindows_desc')}
                          />
                        ) : (
                          windowSources.map((src) => (
                            <DropdownMenuItem
                              key={src.id}
                              textValue={[
                                getWindowSourcePrimaryLabel(src),
                                getWindowSourceSubtitle(src, duplicateWindowAppCounts),
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              onSelect={() => {
                                setSelectedSource(src);
                                setTab('window');
                                focusDesktopSourceWindow(src);
                              }}
                              className={
                                selectedSource?.id === src.id ? 'bg-[#17171c] font-medium' : ''
                              }
                            >
                              {src.appIcon && (
                                <img
                                  src={src.appIcon}
                                  alt=""
                                  className="h-4 w-4 shrink-0 rounded-sm"
                                />
                              )}
                              <div className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate">{getWindowSourcePrimaryLabel(src)}</span>
                                {getWindowSourceSubtitle(src, duplicateWindowAppCounts) && (
                                  <span className="truncate text-xs text-sf-secondary">
                                    {getWindowSourceSubtitle(src, duplicateWindowAppCounts)}
                                  </span>
                                )}
                              </div>
                              {selectedSource?.id === src.id && (
                                <IconCheck size={12} className="shrink-0 text-primary" />
                              )}
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => void handleAreaRecordClick()}
                          className={`${toolbarButtonCls} ${tabCls(tab === 'area')}`}
                        >
                          <IconCrop size={16} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Area</TooltipContent>
                    </Tooltip>
                  </div>

                  <motion.div
                    className="overflow-hidden"
                    animate={{
                      maxWidth: pillVisible ? 360 : 0,
                      marginLeft: pillVisible ? 8 : 0,
                    }}
                    transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
                  >
                    <AnimatePresence mode="wait">
                      {activeWindowSource && (
                        <motion.div
                          key={activeWindowSource.id}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{
                            opacity: 1,
                            scale: 1,
                            transition: { duration: 0.2, delay: 0.32 },
                          }}
                          exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
                          className="flex items-center gap-2 whitespace-nowrap rounded-full bg-[#25252c] px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                        >
                          {activeWindowSource.appIcon && (
                            <img
                              src={activeWindowSource.appIcon}
                              alt=""
                              className="h-4 w-4 shrink-0 rounded-sm"
                            />
                          )}
                          <span className="text-sm font-medium text-sf-primary">
                            {getWindowSourcePrimaryLabel(activeWindowSource)}
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>

                  <div className="mx-3">
                    <Divider />
                  </div>

                  {/* Mic */}
                  <FloatingToolbarMic
                    recordState={recordState}
                    micEnabled={micEnabled}
                    micLoading={micLoading}
                    micLevel={micLevel}
                    micDevices={micDevices}
                    selectedMicId={selectedMic?.deviceId ?? null}
                    onMenuOpenChange={setMicMenuOpen}
                    onToggle={handleMicToggle}
                    onSelectMicDevice={(deviceId) => {
                      void handleMicDeviceSelect(deviceId);
                    }}
                    onOpenMicMenu={() => {
                      void refreshMicDevices();
                    }}
                  />

                  <div className="mx-3">
                    <Divider />
                  </div>

                  {/* Camera */}
                  <div className="flex items-center gap-1 rounded-full bg-sf-bg p-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            void handleCameraToggle();
                          }}
                          disabled={cameraLocked || cameraLoading}
                          className={`${toolbarButtonCls} cursor-pointer rounded-full transition-colors ${
                            cameraEnabled
                              ? 'bg-[#1e1e22] text-sf-primary'
                              : 'text-sf-secondary hover:text-sf-primary'
                          }`}
                        >
                          {cameraLoading ? (
                            <Spinner className="size-4 text-sf-border fill-sf-primary" />
                          ) : cameraEnabled ? (
                            <IconVideo size={16} />
                          ) : (
                            <IconVideoOff size={16} />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {cameraLocked
                          ? t('cameraLocked')
                          : cameraLoading
                            ? t('loadingCamera')
                            : cameraEnabled
                              ? t('cameraOff')
                              : t('cameraOn')}
                      </TooltipContent>
                    </Tooltip>

                    <DropdownMenu
                      onOpenChange={(open) => {
                        setCameraMenuOpen(open);
                        if (open) {
                          void refreshCameraDevices();
                        }
                      }}
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={cameraLocked || cameraLoading || cameraDevices.length === 0}
                              className={`${toolbarButtonCls} px-1.5 text-sf-primary/80 hover:bg-[#1e1e22] hover:text-sf-primary`}
                            >
                              <ChevronDown className="size-3.5" strokeWidth={2.25} />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {selectedCamera?.label
                            ? t('cameraSourceLabel', { label: selectedCamera.label })
                            : t('cameraSource')}
                        </TooltipContent>
                      </Tooltip>

                      <DropdownMenuContent
                        side="top"
                        sideOffset={10}
                        align="center"
                        className="min-w-[220px] max-h-56"
                      >
                        {cameraDevices.length === 0 ? (
                          <FloatingToolbarMenuEmptyState
                            icon={<IconVideoOff size={16} />}
                            title={t('noCameras_title')}
                            description={t('noCameras_desc')}
                          />
                        ) : (
                          <DropdownMenuRadioGroup
                            value={selectedCamera?.deviceId}
                            onValueChange={(value) => {
                              void handleCameraDeviceSelect(value);
                            }}
                          >
                            {cameraDevices.map((device, idx) => (
                              <DropdownMenuRadioItem key={device.deviceId} value={device.deviceId}>
                                {device.label || `Camera ${idx + 1}`}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="mx-1"></div>

                  {/* More options */}
                  <DropdownMenu
                    open={moreMenuOpen}
                    onOpenChange={(open) => {
                      if (!open && teleprompterLoadingRef.current) {
                        return;
                      }
                      setMoreMenuOpen(open);
                    }}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className={`${toolbarButtonCls} cursor-pointer rounded-full text-sf-secondary hover:text-sf-primary ${moreMenuOpen ? 'bg-[#1e1e22] text-sf-primary' : ''}`}
                          >
                            <IconMoreVertical size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="top">{t('moreOptions')}</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent
                      side="top"
                      sideOffset={10}
                      align="center"
                      className="min-w-[180px]"
                    >
                      <DropdownMenuItem
                        className="gap-2.5"
                        onSelect={() => {
                          const opening = !teleprompterOpen;
                          window.screenforge.toggleTeleprompter();
                          setTeleprompterOpen(opening);
                          if (opening) {
                            teleprompterLoadingRef.current = true;
                            setTeleprompterLoading(true);
                          }
                        }}
                      >
                        <IconScript size={15} className="shrink-0 text-sf-secondary" />
                        <span className="flex-1">{t('teleprompter')}</span>
                        {teleprompterOpen &&
                          (teleprompterLoading ? (
                            <Spinner className="size-3 shrink-0 fill-sf-secondary text-sf-border" />
                          ) : (
                            <IconCheck size={12} className="shrink-0 text-primary" />
                          ))}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Screenshot (no recording) */}
                  <FloatingToolbarScreenshot
                    disabled={recordState !== 'idle'}
                    displaySourceId={
                      resolveSourceIdForTab('display', selectedSource, sources) ?? 'screen:0'
                    }
                    windowSources={windowSources}
                    sourcesLoading={sourcesLoading}
                    getWindowLabel={getWindowSourcePrimaryLabel}
                    ensurePermissions={ensureRecordingStartPermissions}
                    onMenuOpenChange={(open) => {
                      setScreenshotMenuOpen(open);
                      if (open) {
                        setSourcesLoading(true);
                        window.screenforge
                          .getSources()
                          .then(setSources)
                          .catch(() => undefined)
                          .finally(() => setSourcesLoading(false));
                      }
                    }}
                  />

                  <div className="mx-2"></div>

                  {/* Record */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          void handleRecordClick();
                        }}
                        aria-label={t('record')}
                        disabled={(tab === 'window' && !selectedSource) || tab === 'area'}
                        className={`${toolbarButtonCls} flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-[#e54d4d] text-white shadow-[0_0_14px_rgba(229,77,77,0.5)] transition-all hover:bg-[#ef5f5f] active:scale-95 disabled:opacity-40`}
                      >
                        <IconPlayerRecordFilled size={14} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{t('record')}</TooltipContent>
                  </Tooltip>
                </motion.div>
              ) : (
                <motion.div
                  key="recording"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center"
                >
                  <div className="relative flex h-7 w-7 items-center justify-center">
                    {!isPaused && (
                      <div
                        className={`absolute h-5 w-5 animate-ping rounded-full opacity-25 ${
                          isAppendMode ? 'bg-[var(--primary)]' : 'bg-[#e54d4d]'
                        }`}
                      />
                    )}
                    <div
                      className={`h-3 w-3 rounded-full transition-colors ${
                        isPaused
                          ? 'bg-sf-primary/55'
                          : isAppendMode
                            ? 'bg-[var(--primary)]'
                            : 'bg-[#e54d4d]'
                      }`}
                    />
                  </div>

                  <div className="mx-4 flex flex-col items-start">
                    {isAppendMode && (
                      <span className="text-[9px] font-medium uppercase tracking-widest text-[var(--primary)]/60">
                        Continuing
                      </span>
                    )}
                    <span
                      className={`min-w-[42px] font-mono text-md tabular-nums transition-colors ${
                        isPaused ? 'text-sf-secondary' : 'text-sf-primary'
                      }`}
                    >
                      {formatTime(elapsed)}
                    </span>
                  </div>

                  <Divider />

                  <AnimatePresence mode="wait">
                    {discardConfirming ? (
                      <motion.div
                        key="discard-confirm"
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: 'auto' }}
                        exit={{ opacity: 0, width: 0 }}
                        transition={{ duration: 0.18 }}
                        className="mx-3 flex items-center gap-1.5 overflow-hidden"
                      >
                        <span className="whitespace-nowrap text-xs text-sf-secondary">
                          {t('discardConfirm')}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => {
                                void handleDiscard();
                              }}
                              aria-label={t('ariaConfirmDiscard')}
                              className={`${toolbarButtonCls} flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-[#e54d4d]/15 text-[#e54d4d] hover:bg-[#e54d4d]/25 active:scale-95`}
                            >
                              <IconCheck size={13} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">{t('ariaConfirmDiscard')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setDiscardConfirming(false)}
                              className={`${toolbarButtonCls} flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-sf-secondary hover:text-sf-primary active:scale-95`}
                            >
                              <IconX size={13} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">{t('ariaCancelDiscard')}</TooltipContent>
                        </Tooltip>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="discard-idle"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="mx-3 flex items-center gap-1"
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setDiscardConfirming(true)}
                              aria-label={t('discardRecording')}
                              className={`${toolbarButtonCls} cursor-pointer rounded-full text-sf-secondary hover:text-[#e54d4d]`}
                            >
                              <IconTrash size={14} />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">{t('discardRecording')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={handlePause}
                              aria-label={isPaused ? t('resumeRecording') : t('pauseRecording')}
                              className={`${toolbarButtonCls} cursor-pointer rounded-full text-sf-secondary hover:text-sf-primary`}
                            >
                              {isPaused ? (
                                <IconPlayerPlayFilled size={15} />
                              ) : (
                                <IconPlayerPauseFilled size={15} />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            {isPaused ? t('resumeRecording') : t('pauseRecording')}
                          </TooltipContent>
                        </Tooltip>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={handleStop}
                        aria-label={t('stopRecording')}
                        className={`${toolbarButtonCls} flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-[#e54d4d] text-white shadow-[0_0_12px_rgba(229,77,77,0.4)] transition-all hover:bg-[#ef5f5f] active:scale-95`}
                      >
                        <IconPlayerStopFilled size={14} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{t('stopRecording')}</TooltipContent>
                  </Tooltip>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
