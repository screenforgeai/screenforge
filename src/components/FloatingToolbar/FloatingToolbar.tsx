import { useState, useRef, useEffect, useCallback, useEffectEvent, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, useDragControls, useReducedMotion } from 'framer-motion';
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
  IconCamera,
} from 'src/lib/icons';
import { trackEvent } from 'src/lib/analytics';
import {
  WAYLAND_PICKED_SCREEN_ID,
  WAYLAND_PICKED_WINDOW_ID,
} from 'src/lib/recording/waylandPicker';
import { grabStreamStill } from 'src/lib/recording/streamStill';
import { cn } from 'src/lib/utils';
import { formatShortcut } from 'src/lib/captureShortcuts';
import { readableErrorMessage } from 'src/lib/ipcError';
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
  SystemAudioSupport,
  ToolbarLayout,
  ToolbarShapeRect,
  ScreenshotCaptureRequest,
  RegisteredCaptureShortcuts,
  RecordingCaptureSource,
  SelectedArea,
} from '../../types/index';
import { displaySurfaceOf } from '../../lib/recording/captureSource';
import { FloatingToolbarMic } from './_components/FloatingToolbarMic';
import { getSystemAudioNoticeKey } from '../../lib/recording/systemAudio';
import { FloatingToolbarMenuEmptyState } from './_components/FloatingToolbarMenuEmptyState';

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
const IS_MAC = navigator.platform.startsWith('Mac');
const SHAPE_MEASURE_INTERVAL_MS = 200;
// Keeps drop shadows and hover affordances inside the drawable region while
// the shape is shrunken. Tooltips and menus only appear in the hovered
// full-window state, so they need no extra padding.
const SHAPE_PAD = 24;
// 'window' layout (native Wayland): room around the pill for its shadow and the drag handle.
const WINDOW_PAD = 24;

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

/**
 * One spring drives every part of the Video ↔ Screenshot switch, so the pill,
 * the collapsing controls and the shutter move as one gesture. A spring rather
 * than a fixed curve keeps it smooth when the switch is flicked mid-animation;
 * a small bounce gives it life without a wobble.
 */
const MODE_SPRING = { type: 'spring', visualDuration: 0.42, bounce: 0.14 } as const;
/** Content fades lead the spring so nothing is seen squeezing. */
const MODE_FADE = { duration: 0.18, ease: [0.32, 0.72, 0, 1] } as const;
const INSTANT = { duration: 0 } as const;

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
  return readableErrorMessage(err, 'Could not finish the recording. Please try again.');
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

/** A global shortcut beside a tooltip label, styled like the editor's hotkey hints. */
const ShortcutHint = ({ accelerator }: { accelerator?: string }) =>
  accelerator ? (
    <span className="ml-1 text-sf-muted">{formatShortcut(accelerator, IS_MAC)}</span>
  ) : null;

export const FloatingToolbar = () => {
  const { t } = useTranslation('toolbar');
  const [tab, setTab] = useState<SourceTab>('display');
  // One source picker serves both: Video records it, Screenshot grabs a still.
  const [captureMode, setCaptureMode] = useState<'video' | 'photo'>('video');
  // Global shortcuts that registered, named in the tooltips so people find them.
  const [captureShortcuts, setCaptureShortcuts] = useState<RegisteredCaptureShortcuts>({});
  const reduceMotion = useReducedMotion();
  const modeSpring = reduceMotion ? INSTANT : MODE_SPRING;
  const modeFade = reduceMotion ? INSTANT : MODE_FADE;
  const [recordState, setRecordState] = useState<RecordState>('idle');
  // Before the countdown (append mode, permissions, area) and after Stop
  // (saving, handing the recording to the editor) the toolbar is still busy.
  // A count, so a second Record click can't end the first one's preparation.
  const [preparingRecordings, setPreparingRecordings] = useState(0);
  // Wayland: set from a Record or Area click until its countdown starts or it is cancelled
  // (share dialog, area drawing included), so a second click cannot open another dialog.
  const pickingShareRef = useRef(false);
  const [isSavingRecording, setIsSavingRecording] = useState(false);
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
  const [systemAudioSupport, setSystemAudioSupport] = useState<SystemAudioSupport | null>(null);
  const systemAudioNoticeKey = getSystemAudioNoticeKey(systemAudioSupport);
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
  const [isAppendMode, setIsAppendMode] = useState(false);
  const [sceneOverlayOpen, setSceneOverlayOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedArea, setSelectedArea] = useState<SelectedArea | null>(null);

  useEffect(() => {
    window.screenforge.getAppendMode().then(setIsAppendMode);
  }, []);

  useEffect(() => {
    window.screenforge
      .getCaptureShortcuts()
      .then(setCaptureShortcuts)
      .catch(() => undefined);
    // The record shortcut reopens the toolbar ready for video.
    return window.screenforge.onVideoModeRequested(() => setCaptureMode('video'));
  }, []);

  // From the Record click until the recording reaches the editor, a shortcut
  // screenshot would close this toolbar mid-flow, so it waits.
  useEffect(() => {
    window.screenforge.setToolbarRecording(
      recordState !== 'idle' || preparingRecordings > 0 || isSavingRecording,
    );
  }, [recordState, preparingRecordings, isSavingRecording]);
  useEffect(() => () => window.screenforge.setToolbarRecording(false), []);

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
  // What this recording captures, kept for its window bar (RecordingResult.captureSource).
  const captureSourceRef = useRef<RecordingCaptureSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recordStateRef = useRef<RecordState>('idle');
  // The recorded display went away while startRecording was still in flight.
  const sourceLostDuringStartRef = useRef(false);
  const micLevelRef = useRef(0);
  const micUiUpdateTsRef = useRef(0);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraRecorderRef = useRef<MediaRecorder | null>(null);
  const cameraChunksRef = useRef<Blob[]>([]);
  // Wayland (Linux): the toolbar records the screen itself from the PipeWire
  // portal stream — the main process can't grab the screen on Wayland.
  const captureBackendRef = useRef<CaptureBackend>('native');
  // Wayland's portal backend: windows are picked in the system share dialog, not listed here.
  const [portalCapture, setPortalCapture] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const screenChunksRef = useRef<Blob[]>([]);
  const [screenTrack, setScreenTrack] = useState<MediaStreamTrack | null>(null);
  const toolbarRootRef = useRef<HTMLDivElement | null>(null);
  const toolbarInteractiveRef = useRef<boolean | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragControls = useDragControls();
  // How this window is laid out (electron/modules/app/toolbar-layout.ts). macOS and Windows are
  // always the full-screen overlay; on Linux, native Wayland gets a window that is just the
  // toolbar, so ask the main process before drawing.
  const [layout, setLayout] = useState<ToolbarLayout | null>(() =>
    navigator.platform.startsWith('Linux') ? null : 'overlay',
  );
  useEffect(() => {
    if (layout !== null) {
      return;
    }
    let live = true;
    window.screenforge
      .getToolbarLayout()
      .then((next) => live && setLayout(next))
      .catch(() => live && setLayout('overlay'));
    return () => {
      live = false;
    };
  }, [layout]);
  const asWindow = layout === 'window';
  // As a window it only grows downward (Wayland keeps its top-left where the user put it), so its
  // menus and tooltips open below the pill and never flip up out of the window.
  const popSide = asWindow ? 'bottom' : 'top';
  const toolbarWrapperRef = useRef<HTMLDivElement | null>(null);

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
        setPortalCapture(backend === 'wayland-portal');
      })
      .catch((err) => {
        console.error('[recording] could not resolve capture backend:', err);
      });
    window.screenforge
      .getSystemAudioSupport()
      .then(setSystemAudioSupport)
      .catch((err) => {
        console.error('[recording] could not resolve system audio support:', err);
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

  // Screenshots need screen access only: no cursor tracking, so no Accessibility.
  const ensureScreenshotPermissions = useCallback(async (): Promise<boolean> => {
    try {
      await window.screenforge.prepareScreenshotPermissions();
      return true;
    } catch (err) {
      logToolbarDiagnostic('toolbar.screenshot.permissions-failed', {
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

  // The recorded display was unplugged (or switched off) mid-recording: stop
  // and keep what was captured, and say why instead of failing silently.
  useEffect(() => {
    return window.screenforge.onRecordingSourceLost(() => {
      if (recordStateRef.current === 'countdown') {
        // The capture is still starting: stop once it has (see handleStart).
        sourceLostDuringStartRef.current = true;
        return;
      }
      if (recordStateRef.current !== 'recording' && recordStateRef.current !== 'paused') {
        return;
      }
      // Several displays can go at once: stop only for the first event.
      recordStateRef.current = 'idle';
      window.screenforge.systemWarning(t('recordingDisplayRemoved'));
      handleStopEvent();
    });
  }, [t]);

  // Wayland: the user can end the capture from the OS screen-share indicator —
  // treat that like pressing stop.
  useEffect(() => {
    if (!screenTrack) {
      return;
    }

    const onEnded = () => {
      if (recordStateRef.current === 'countdown' && !screenRecorderRef.current) {
        // Ended before recording began: there is nothing to keep.
        stopWaylandStream();
        setRecordState('idle');
        setCountdown(3);
        return;
      }
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
    // Wayland: a window is picked in the share dialog, so there is no window: source id; the
    // portal stream itself is the capture.
    const pickWindowInDialog = captureBackendRef.current === 'wayland-portal' && tab === 'window';
    const sourceId = pickWindowInDialog
      ? resolveSourceIdForTab('display', null, sources)
      : resolveSourceIdForTab(tab, selectedSource, sources);
    if (!sourceId) {
      discardWaylandPortalCapture();
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

    sourceLostDuringStartRef.current = false;
    try {
      if (tab === 'window') {
        focusDesktopSourceWindow(selectedSource);
      }

      const cropArea = tab === 'area' ? selectedArea : null;
      captureSourceRef.current = {
        kind: tab,
        ...(tab === 'window' && selectedSource?.appName && { appName: selectedSource.appName }),
        ...(tab === 'window' &&
          selectedSource?.windowTitle && { windowTitle: selectedSource.windowTitle }),
      };
      if (captureBackendRef.current === 'wayland-portal') {
        // Picked in the share dialog before the countdown (pickWaylandShare).
        if (!screenStreamRef.current) {
          await openWaylandPortalStream(pickWindowInDialog ? 'window' : 'screen');
        }
        try {
          startWaylandRecorder();
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

    if (sourceLostDuringStartRef.current) {
      sourceLostDuringStartRef.current = false;
      recordStateRef.current = 'idle';
      window.screenforge.systemWarning(t('recordingDisplayRemoved'));
      void handleStop();
    }
  }

  async function takePhoto(request: ScreenshotCaptureRequest) {
    try {
      const outcome = await window.screenforge.captureScreenshot(request);
      // Wayland: the share dialog was closed without a pick. Nothing to warn about.
      if (outcome === 'cancelled') {
        return;
      }
      trackEvent('screenshot_taken', { kind: request.kind });
    } catch (err) {
      window.screenforge.writeDiagnosticLog('toolbar.screenshot.failed', {
        kind: request.kind,
        message: getErrorMessage(err),
      });
      trackEvent('screenshot_failed', { source: request.kind });
      window.screenforge.systemWarning(t('captureFailed', { ns: 'screenshot' }));
    }
  }

  async function handleShutterClick() {
    if (!(await ensureScreenshotPermissions())) {
      return;
    }
    // Wayland: the screen or window is picked in the system share dialog.
    if (captureBackendRef.current === 'wayland-portal') {
      await takePhoto(
        tab === 'window'
          ? { kind: 'window', sourceId: WAYLAND_PICKED_WINDOW_ID }
          : { kind: 'display', sourceId: WAYLAND_PICKED_SCREEN_ID },
      );
      return;
    }
    if (tab === 'window' && selectedSource) {
      await takePhoto({ kind: 'window', sourceId: selectedSource.id });
      return;
    }
    await takePhoto({
      kind: 'display',
      sourceId: resolveSourceIdForTab('display', selectedSource, sources) ?? 'screen:0',
    });
  }

  async function handleAreaPhotoClick() {
    // Wayland: the main process asks for the screen in the share dialog first, then the area is
    // drawn on a still of it (as the screenshot shortcut does there).
    if (captureBackendRef.current === 'wayland-portal') {
      void window.screenforge.takeScreenshot();
      return;
    }
    setTab('area');
    if (!(await ensureScreenshotPermissions())) {
      return;
    }
    const area = await window.screenforge.openAreaSelector('screenshot');
    if (!area) {
      setTab('display');
      return;
    }
    await takePhoto({
      kind: 'area',
      sourceId: resolveSourceIdForTab('display', selectedSource, sources) ?? 'screen:0',
      area,
    });
  }

  async function handleAreaRecordClick() {
    if (recordState !== 'idle' || pickingShareRef.current) {
      return;
    }

    const onPortal = captureBackendRef.current === 'wayland-portal';
    pickingShareRef.current = onPortal;
    setTab('area');
    setPreparingRecordings((n) => n + 1);
    try {
      try {
        setIsAppendMode(await window.screenforge.getAppendMode());
      } catch {
        setIsAppendMode(false);
      }

      const hasRecordingPermissions = await ensureRecordingStartPermissions();
      if (!hasRecordingPermissions) {
        return;
      }

      const area =
        captureBackendRef.current === 'wayland-portal'
          ? await pickWaylandArea()
          : await window.screenforge.openAreaSelector();
      if (!area) {
        setTab('display');
        return;
      }

      setSelectedArea(area);
      setCountdown(3);
      setRecordState('countdown');
    } finally {
      // Batched with the countdown above, so busy never dips in between.
      setPreparingRecordings((n) => n - 1);
      if (onPortal) {
        pickingShareRef.current = false;
      }
    }
  }

  async function handleRecordClick() {
    if (pickingShareRef.current) {
      return;
    }
    const onPortal = captureBackendRef.current === 'wayland-portal';
    pickingShareRef.current = onPortal;
    setPreparingRecordings((n) => n + 1);
    try {
      try {
        setIsAppendMode(await window.screenforge.getAppendMode());
      } catch {
        setIsAppendMode(false);
      }

      const hasRecordingPermissions = await ensureRecordingStartPermissions();
      if (!hasRecordingPermissions) {
        return;
      }
      if (
        captureBackendRef.current === 'wayland-portal' &&
        !(await pickWaylandShare(tab === 'window' ? 'window' : 'screen'))
      ) {
        return;
      }

      setCountdown(3);
      setRecordState('countdown');
    } finally {
      setPreparingRecordings((n) => n - 1);
      if (onPortal) {
        pickingShareRef.current = false;
      }
    }
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
    // What this recording captured, taken now: a next recording may start
    // (and set its own) before this one has finished saving.
    const captureSource = captureSourceRef.current;
    captureSourceRef.current = null;
    logToolbarDiagnostic('toolbar.recording.stop-clicked', {
      elapsed,
      micEnabled,
      cameraEnabled,
    });
    setDiscardConfirming(false);
    setRecordState('idle');
    setIsSavingRecording(true);

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
        areaCrop,
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
        areaCrop,
        hasEmbeddedAudio,
        audioPath: timelineAudioPath ?? undefined,
        cameraPath: cameraPath ?? undefined,
        ...(captureSource && { captureSource }),
      });
    } catch (err) {
      console.error('[recording] stop pipeline failed:', err);
      const message = getErrorMessage(err);
      logToolbarDiagnostic('toolbar.recording.stop-failed', { message });
      trackEvent('recording_failed', {
        error: message,
        elapsed_seconds: elapsed,
        has_mic: micEnabled,
        has_camera: cameraEnabled,
        is_append: isAppendMode,
      });
      window.screenforge.recordingFailed(message);
    } finally {
      setIsSavingRecording(false);
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

  /**
   * Wayland: opens the OS share dialog on its screens or (from the Window tab) its windows, so the
   * user picks what to record before the countdown. Resolves false when nothing was picked.
   */
  async function pickWaylandShare(kind: 'screen' | 'window'): Promise<boolean> {
    try {
      await openWaylandPortalStream(kind);
      return true;
    } catch (err) {
      stopWaylandStream();
      // Closing the dialog without a pick is a choice, not an error.
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) {
        console.error('[recording] share dialog failed:', err);
        window.screenforge.systemWarning(getErrorMessage(err));
      }
      logToolbarDiagnostic('toolbar.recording.share-not-picked', {
        kind,
        message: getErrorMessage(err),
      });
      return false;
    }
  }

  /**
   * Wayland: the screen is picked in the share dialog first, then the area is drawn on a still
   * of it (a selector over the live screen could land on any monitor). Null when either is
   * cancelled; the picked screen is let go then.
   */
  async function pickWaylandArea(): Promise<SelectedArea | null> {
    if (!(await pickWaylandShare('screen'))) {
      return null;
    }
    try {
      const stream = screenStreamRef.current;
      if (stream) {
        const area = await window.screenforge.selectAreaOnStill(await grabStreamStill(stream));
        // The share may have been ended from the system indicator while the area was drawn.
        const stillShared =
          screenStreamRef.current === stream &&
          stream.getVideoTracks().some((track) => track.readyState === 'live');
        if (area && stillShared) {
          return area;
        }
      }
    } catch (err) {
      console.error('[recording] drawing the area on the picked screen failed:', err);
      // Ended from the system indicator: the user stopped it, nothing to warn about.
      const shared = screenStreamRef.current
        ?.getVideoTracks()
        .some((track) => track.readyState === 'live');
      if (shared) {
        window.screenforge.systemWarning(getErrorMessage(err));
      }
    }
    stopWaylandStream();
    return null;
  }

  async function openWaylandPortalStream(kind: 'screen' | 'window'): Promise<void> {
    // Stored before the share request below reads it.
    await window.screenforge.setShareKind(kind);
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: { frameRate: { ideal: 60, max: 60 } },
    });
    screenStreamRef.current = stream;
    // Tracked via state so the track-ended effect below can react when the
    // user ends the capture from the OS screen-share indicator.
    const [videoTrack] = stream.getVideoTracks();
    setScreenTrack(videoTrack ?? null);
  }

  /** Records the stream picked in the share dialog, once the countdown is over. */
  function startWaylandRecorder(): void {
    const stream = screenStreamRef.current;
    if (!stream) {
      throw new Error('Nothing was picked to record.');
    }
    screenChunksRef.current = [];
    const [videoTrack] = stream.getVideoTracks();
    // The portal, not the toolbar, decides what's shared: a tab, a window or a screen.
    const displaySurface = displaySurfaceOf(videoTrack);
    if (displaySurface) {
      captureSourceRef.current = {
        kind: displaySurface === 'monitor' ? 'display' : 'window',
        displaySurface,
      };
    }

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
    isDragging || windowMenuOpen || micMenuOpen || cameraMenuOpen || moreMenuOpen;
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
    if (!IS_LINUX || layout !== 'overlay') {
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
  }, [layout, recordState]);

  // 'window' layout: keep the window just big enough for the pill and whatever menu or tooltip
  // is open below it. Measured every frame (cheap: a few rects) so a menu never shows clipped.
  useEffect(() => {
    if (!asWindow) {
      return;
    }
    let frame = 0;
    let lastSent = '';
    const measure = () => {
      let right = 0;
      let bottom = 0;
      const parts = [
        toolbarWrapperRef.current,
        ...document.querySelectorAll('[data-radix-popper-content-wrapper]'),
      ];
      for (const part of parts) {
        const rect = part?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          continue;
        }
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
      }
      if (right > 0 && bottom > 0) {
        const size = {
          width: Math.ceil(right + WINDOW_PAD),
          height: Math.ceil(bottom + WINDOW_PAD),
        };
        const key = `${size.width}x${size.height}`;
        if (key !== lastSent) {
          lastSent = key;
          window.screenforge.setToolbarSize(size);
        }
      }
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [asWindow]);

  if (layout === null) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={
        asWindow
          ? 'relative flex h-full w-full items-start justify-start bg-transparent'
          : 'relative flex h-full w-full items-end justify-center pb-10 bg-transparent'
      }
      style={asWindow ? { padding: WINDOW_PAD, paddingTop: 0 } : undefined}
    >
      {/* Area recording indicator — dims outside the selected region during countdown/recording/paused */}
      <AnimatePresence>
        {!asWindow &&
          (recordState === 'countdown' ||
            recordState === 'recording' ||
            recordState === 'paused') &&
          selectedArea &&
          // Drawn on a still (Wayland): in the still's pixels, not this window's.
          !selectedArea.frame && (
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
        ref={toolbarWrapperRef}
        // As a window, the drag handle moves the window itself (below), not the pill inside it.
        drag={!asWindow}
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
            if (asWindow) {
              return;
            }
            e.preventDefault();
            dragControls.start(e);
          }}
          data-toolbar-interactive="true"
          data-toolbar-drag-handle=""
          className={cn(
            'absolute top-0 left-1/2 -translate-x-1/2 flex cursor-grab flex-col items-center gap-1 px-4 py-1 transition-opacity group-hover:opacity-100',
            // As a window the handle is a drag region, moving the window itself; it gets no
            // hover events, so it stays faintly visible.
            asWindow ? 'app-drag opacity-60' : 'opacity-0',
          )}
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
                    <TooltipContent side={popSide} avoidCollisions={!asWindow}>
                      {t('minimizeToDock')}
                    </TooltipContent>
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
                    <TooltipContent side={popSide} avoidCollisions={!asWindow}>
                      {t('home')}
                    </TooltipContent>
                  </Tooltip>

                  <div className="mx-3">
                    <Divider />
                  </div>

                  {/* Video | Screenshot */}
                  <div
                    role="group"
                    aria-label={t('captureMode')}
                    className="flex items-center gap-0.5 rounded-full bg-sf-bg p-1"
                  >
                    {(['video', 'photo'] as const).map((mode) => (
                      <Tooltip key={mode}>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-pressed={captureMode === mode}
                            aria-label={
                              mode === 'video' ? t('captureModeVideo') : t('captureModeScreenshot')
                            }
                            onClick={() => setCaptureMode(mode)}
                            className={`${toolbarButtonCls} relative flex cursor-pointer items-center justify-center rounded-full p-2 outline-none hover:bg-transparent ${
                              captureMode === mode
                                ? 'text-sf-primary'
                                : 'text-sf-secondary hover:text-sf-primary'
                            } transition-colors duration-300`}
                          >
                            {/* One pill that slides between the two icons. */}
                            {captureMode === mode && (
                              <motion.span
                                layoutId="capture-mode-pill"
                                transition={modeSpring}
                                className="absolute inset-0 rounded-full bg-[#1e1e22] shadow-sm"
                              />
                            )}
                            <span className="relative z-10 flex">
                              {mode === 'video' ? (
                                <IconVideo size={16} />
                              ) : (
                                <IconCamera size={16} />
                              )}
                            </span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side={popSide} avoidCollisions={!asWindow}>
                          {mode === 'video' ? t('captureModeVideo') : t('captureModeScreenshot')}
                          <ShortcutHint
                            accelerator={
                              mode === 'video'
                                ? captureShortcuts.record
                                : captureShortcuts.screenshot
                            }
                          />
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>

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
                      <TooltipContent side={popSide} avoidCollisions={!asWindow}>
                        {t('display')}
                      </TooltipContent>
                    </Tooltip>

                    {portalCapture ? (
                      // Wayland: no list to show (apps cannot see other apps' windows there);
                      // the window is picked in the share dialog when recording starts.
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('window')}
                            onClick={() => setTab('window')}
                            className={`${toolbarButtonCls} ${tabCls(tab === 'window')}`}
                          >
                            <IconAppWindow size={16} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent
                          side={popSide}
                          avoidCollisions={!asWindow}
                          className="max-w-[180px] text-center"
                        >
                          {t('windowPickOnRecord')}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
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
                                aria-label={t('window')}
                                onClick={() => setTab('window')}
                                className={`${toolbarButtonCls} ${tabCls(tab === 'window')}`}
                              >
                                <IconAppWindow size={16} />
                              </Button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent side={popSide} avoidCollisions={!asWindow}>
                            {tab === 'window' && selectedSource
                              ? getWindowSourcePrimaryLabel(selectedSource)
                              : t('window')}
                          </TooltipContent>
                        </Tooltip>

                        <DropdownMenuContent
                          side={popSide}
                          avoidCollisions={!asWindow}
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
                                  <span className="truncate">
                                    {getWindowSourcePrimaryLabel(src)}
                                  </span>
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
                    )}

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('area')}
                          onClick={() =>
                            void (captureMode === 'photo'
                              ? handleAreaPhotoClick()
                              : handleAreaRecordClick())
                          }
                          className={`${toolbarButtonCls} ${tabCls(tab === 'area')}`}
                        >
                          <IconCrop size={16} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side={popSide} avoidCollisions={!asWindow}>
                        {t('area')}
                        {captureMode === 'photo' && (
                          <ShortcutHint accelerator={captureShortcuts.screenshot} />
                        )}
                      </TooltipContent>
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

                  {/* Video-only controls fold away for screenshots: the
                      width springs shut while the controls fade and blur out
                      ahead of it, so the toolbar reads as one piece reshaping
                      rather than buttons popping. */}
                  <AnimatePresence initial={false}>
                    {captureMode === 'video' && (
                      <motion.div
                        key="video-controls"
                        className="flex items-center"
                        initial={{ width: 0, overflow: 'hidden' }}
                        animate={{
                          width: 'auto',
                          transition: modeSpring,
                          transitionEnd: { overflow: 'visible' },
                        }}
                        exit={{ width: 0, overflow: 'hidden', transition: modeSpring }}
                      >
                        <motion.div
                          className="flex w-max items-center"
                          initial={{ opacity: 0, scale: 0.92, filter: 'blur(4px)' }}
                          animate={{
                            opacity: 1,
                            scale: 1,
                            filter: 'blur(0px)',
                            transition: { ...modeFade, delay: reduceMotion ? 0 : 0.08 },
                          }}
                          exit={{
                            opacity: 0,
                            scale: 0.92,
                            filter: 'blur(4px)',
                            transition: modeFade,
                          }}
                        >
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
                            systemAudioNotice={
                              systemAudioNoticeKey ? t(systemAudioNoticeKey) : null
                            }
                            onMenuOpenChange={setMicMenuOpen}
                            popSide={popSide}
                            avoidCollisions={!asWindow}
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
                              <TooltipContent side={popSide} avoidCollisions={!asWindow}>
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
                                      disabled={
                                        cameraLocked || cameraLoading || cameraDevices.length === 0
                                      }
                                      className={`${toolbarButtonCls} px-1.5 text-sf-primary/80 hover:bg-[#1e1e22] hover:text-sf-primary`}
                                    >
                                      <ChevronDown className="size-3.5" strokeWidth={2.25} />
                                    </Button>
                                  </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent side={popSide} avoidCollisions={!asWindow}>
                                  {selectedCamera?.label
                                    ? t('cameraSourceLabel', { label: selectedCamera.label })
                                    : t('cameraSource')}
                                </TooltipContent>
                              </Tooltip>

                              <DropdownMenuContent
                                side={popSide}
                                avoidCollisions={!asWindow}
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
                                      <DropdownMenuRadioItem
                                        key={device.deviceId}
                                        value={device.deviceId}
                                      >
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
                                    aria-label={t('moreOptions')}
                                    className={`${toolbarButtonCls} cursor-pointer rounded-full text-sf-secondary hover:text-sf-primary ${moreMenuOpen ? 'bg-[#1e1e22] text-sf-primary' : ''}`}
                                  >
                                    <IconMoreVertical size={16} />
                                  </Button>
                                </DropdownMenuTrigger>
                              </TooltipTrigger>
                              <TooltipContent side={popSide} avoidCollisions={!asWindow}>
                                {t('moreOptions')}
                              </TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent
                              side={popSide}
                              avoidCollisions={!asWindow}
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
                        </motion.div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="mx-2"></div>

                  {/* Record */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          void (captureMode === 'photo'
                            ? handleShutterClick()
                            : handleRecordClick());
                        }}
                        aria-label={captureMode === 'photo' ? t('takeScreenshot') : t('record')}
                        disabled={
                          (tab === 'window' && !selectedSource && !portalCapture) || tab === 'area'
                        }
                        className={`${toolbarButtonCls} relative flex h-9 w-9 cursor-pointer items-center justify-center overflow-visible rounded-full bg-transparent p-0 transition-transform hover:bg-transparent active:scale-95 disabled:opacity-40`}
                      >
                        {/* The button's fill morphs red ↔ white on the same
                            spring as the switch, then settles. */}
                        <motion.span
                          aria-hidden
                          className="absolute inset-0 rounded-full"
                          initial={false}
                          animate={
                            captureMode === 'photo'
                              ? {
                                  backgroundColor: '#f5f5f7',
                                  boxShadow: '0 0 14px rgba(255,255,255,0.35)',
                                }
                              : {
                                  backgroundColor: '#e54d4d',
                                  boxShadow: '0 0 14px rgba(229,77,77,0.5)',
                                }
                          }
                          transition={modeSpring}
                        />
                        <AnimatePresence mode="popLayout" initial={false}>
                          <motion.span
                            key={captureMode}
                            className={`relative z-10 flex ${
                              captureMode === 'photo' ? 'text-[#111113]' : 'text-white'
                            }`}
                            initial={{ opacity: 0, scale: 0.5, rotate: -45, filter: 'blur(3px)' }}
                            animate={{
                              opacity: 1,
                              scale: 1,
                              rotate: 0,
                              filter: 'blur(0px)',
                              transition: modeSpring,
                            }}
                            exit={{
                              opacity: 0,
                              scale: 0.5,
                              rotate: 45,
                              filter: 'blur(3px)',
                              transition: modeFade,
                            }}
                          >
                            {captureMode === 'photo' ? (
                              <IconCamera size={16} />
                            ) : (
                              <IconPlayerRecordFilled size={14} />
                            )}
                          </motion.span>
                        </AnimatePresence>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side={popSide} avoidCollisions={!asWindow}>
                      {captureMode === 'photo' ? t('takeScreenshot') : t('record')}
                    </TooltipContent>
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
                          <TooltipContent side={popSide} avoidCollisions={!asWindow}>
                            {t('ariaConfirmDiscard')}
                          </TooltipContent>
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
                          <TooltipContent side={popSide} avoidCollisions={!asWindow}>
                            {t('ariaCancelDiscard')}
                          </TooltipContent>
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
                          <TooltipContent side={popSide} avoidCollisions={!asWindow}>
                            {t('discardRecording')}
                          </TooltipContent>
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
                          <TooltipContent side={popSide} avoidCollisions={!asWindow}>
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
                    <TooltipContent side={popSide} avoidCollisions={!asWindow}>
                      {t('stopRecording')}
                    </TooltipContent>
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
