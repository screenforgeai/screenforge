import { createScreenforgeFileUrl } from 'src/lib/screenforge-url';
import { Timeline } from '@xzdarcy/react-timeline-editor';
import type { TimelineState } from '@xzdarcy/react-timeline-editor';
import '@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css';
import type { TimelineAction } from '@xzdarcy/timeline-engine';
import { analyzeKeyboardData, mapKeyboardDataToTimeline } from '../../../../lib/effects/keyboard';
import {
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  memo,
  startTransition,
  useEffectEvent,
} from 'react';
import type { OnScrollParams } from 'react-virtualized';
import type { RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../../../store';
import { useResizable } from '../../../../hooks/useResizable';
import {
  DEFAULT_DUR,
  GHOST_WIDTH,
  SCALE,
  LANE_H,
  RULER_H,
  EFFECTS,
  TL_H_DEFAULT,
  TL_H_MIN,
  TL_H_MAX,
  SCALE_STEP,
  SCALE_MIN,
  SCALE_MAX,
  INITIAL_LAYERS,
} from './constants';
import type { Layer } from './constants';
import { ActionClip } from './_components/ActionClip';
import { IndicatorClip } from './_components/IndicatorClip';
import { ResizeHandle } from './_components/ResizeHandle';
import { TimelineToolbar } from './_components/TimelineToolbar';
import { TimelineGutter } from './_components/TimelineGutter';
import { TimelineGhostZone } from './_components/TimelineGhostZone';
import { TimelineProcessingClip } from './_components/TimelineProcessingClip';
import { useTimelineGlobalHotkeys } from './_hooks/useTimelineGlobalHotkeys';
import { useImportVideo } from '../../../../hooks/useImportVideo';
import {
  findSegmentAtTime,
  getEffectiveTransition,
  isMediaTrackEnabled,
  setMediaTrackEnabled,
  mediaSegmentsToActions,
  moveMediaSegment,
  sortMediaSegments,
  splitMediaSegmentsAtTime,
  splitZoomClipsAtTime,
  splitTextClipsAtTime,
  splitMusicClipsAtTime,
  splitCameraClipsAtTime,
  splitMaskClipsAtTime,
  trimMediaSegmentEdge,
  applyRippleDelete,
} from '../../../../lib/helpers/segments';
import { CLIP_FADE_IN_HOLD } from '../../../../lib/effects/frame/pixi';
import type { MediaTrack } from '../../../../lib/helpers/segments';
import { resolveTimelineAudioPath } from '../../../../lib/recording/audioSource';
import { defaultCinematicZoomClip, defaultZoomClip } from '../../../../lib/effects/zoom';
import { IconAiMagic, IconPlayerRecord, IconVideo, IconZoom } from '../../../../lib/icons';
import { trackEvent } from '../../../../lib/analytics';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../../../lib/ui';

// Stable reference so React.memo can bail out when only ghost state changes.
const TIMELINE_STYLE = { height: '100%', width: '100%', background: '#0d0d0f' } as const;
// Wrap the library component so it never reconciles unless its actual data props change.
const MemoTimeline = memo(Timeline);

const LAYER_ORDER: Record<string, number> = {
  indicators: 0,
  video: 1,
  audio: 2,
  music: 3,
  zoom: 5,
  camera: 6,
  mask: 7,
  text: 8,
};
const SNAP_PX = 8;
const EDGE_EPSILON = 0.0001;
const PLAYING_SYNC_EPSILON = 0.12;
const PAUSED_SYNC_EPSILON = 1 / 60;
const AUDIO_ACTION_SUFFIX = '-audio';
const PREVIEW_MIN_H = 220;
const TIMELINE_START_LEFT = 20;
const PLAYHEAD_SCROLL_PADDING_MIN_PX = 72;
const PLAYHEAD_SCROLL_PADDING_MAX_PX = 160;
const PLAYHEAD_SCROLL_TARGET_MIN_RATIO = 0.35;
const PLAYHEAD_SCROLL_TARGET_MAX_RATIO = 0.65;
const AUTO_FOLLOW_RELEASE_GRACE_MS = 350;
const AUTO_FOLLOW_POINTER_DOWN_GRACE_MS = 800;
const AUTO_FOLLOW_POINTER_MOVE_GRACE_MS = 220;

function getNearestSnap(time: number, targets: number[], threshold: number): number {
  let nearest = time;
  let min = Number.POSITIVE_INFINITY;

  for (const target of targets) {
    const delta = Math.abs(target - time);
    if (delta < min) {
      min = delta;
      nearest = target;
    }
  }

  return min <= threshold ? nearest : time;
}

function getSegmentIdFromAction(action: Pick<TimelineAction, 'id' | 'effectId'>): string {
  if (action.effectId === 'audio' && action.id.endsWith(AUDIO_ACTION_SUFFIX)) {
    return action.id.slice(0, -AUDIO_ACTION_SUFFIX.length);
  }

  return action.id;
}

interface CanvasTimelineProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  availableHeight: number;
}

export const CanvasTimeline = ({ videoRef, availableHeight }: CanvasTimelineProps) => {
  const {
    recordingResult,
    selectedClip,
    zoomClips,
    textClips,
    mediaSegments,
    cameraEnabled,
    keyboardEnabled,
    canUndo,
    canRedo,
    currentTime,
    pendingSeekTime,
    pendingPauseSeekTime,
    pendingPlayFromStartToken,
    setSelectedClip,
    setActiveWidget,
    commitEdit,
    undo,
    redo,
    setIsGapPlayback,
    setCurrentTime,
    clearPendingSeek,
    clearPendingPauseSeek,
    clearPendingPlayFromStart,
    setLayerHidden,
    focusMode,
    setIsAppendMode,
    setAppendStartTime,
    processingSegment,
    musicClips,
    cameraClips,
    maskClips,
    isExporting,
  } = useStore(
    useShallow((s) => ({
      recordingResult: s.recordingResult,
      selectedClip: s.selectedClip,
      zoomClips: s.zoomClips,
      textClips: s.textClips,
      mediaSegments: s.mediaSegments,
      cameraEnabled: s.camera.enabled,
      keyboardEnabled: s.keyboard.enabled,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      currentTime: s.currentTime,
      pendingSeekTime: s.pendingSeekTime,
      pendingPauseSeekTime: s.pendingPauseSeekTime,
      pendingPlayFromStartToken: s.pendingPlayFromStartToken,
      setSelectedClip: s.setSelectedClip,
      setActiveWidget: s.setActiveWidget,
      commitEdit: s.commitEdit,
      undo: s.undo,
      redo: s.redo,
      setIsGapPlayback: s.setIsGapPlayback,
      setCurrentTime: s.setCurrentTime,
      clearPendingSeek: s.clearPendingSeek,
      clearPendingPauseSeek: s.clearPendingPauseSeek,
      clearPendingPlayFromStart: s.clearPendingPlayFromStart,
      setLayerHidden: s.setLayerHidden,
      focusMode: s.focusMode,
      setIsAppendMode: s.setIsAppendMode,
      setAppendStartTime: s.setAppendStartTime,
      processingSegment: s.processingSegment,
      musicClips: s.musicClips,
      cameraClips: s.cameraClips,
      maskClips: s.maskClips,
      isExporting: s.isExporting,
    })),
  );

  const recordingFilePath = recordingResult?.filePath ?? null;
  const recordingHasEmbeddedAudio = recordingResult?.hasEmbeddedAudio ?? false;
  const recordingIsImported = recordingResult?.isImported ?? false;
  const recordingCameraPath = recordingResult?.cameraPath ?? null;
  const audioPath = recordingResult?.audioPath ?? null;
  // Show the audio lane for explicit mic/separate audio, or for imported videos with embedded audio.
  const hasAudioLane = Boolean(audioPath) || (recordingIsImported && recordingHasEmbeddedAudio);
  const selectedClipId = selectedClip?.id ?? null;
  const musicAudiosRef = useRef(new Map<string, HTMLAudioElement>());
  // Tracks whether the last pointerdown on any clip was a clean click (no hold / move / leave).
  const clipClickRef = useRef<{ t: number; x: number; y: number; clean: boolean } | null>(null);

  const duration = useMemo(() => {
    if (!recordingResult) {
      return 0;
    }
    if (mediaSegments.length === 0) {
      return recordingResult.duration;
    }
    return mediaSegments.reduce((max, seg) => Math.max(max, seg.timelineEnd), 0);
  }, [recordingResult, mediaSegments]);

  const totalDur = duration > 0 ? duration : DEFAULT_DUR;
  const timelineRef = useRef<TimelineState>(null);
  const rafRef = useRef<number | null>(null);
  const totalDurRef = useRef(totalDur);
  useLayoutEffect(() => {
    totalDurRef.current = totalDur;
  });
  const playClockStartRef = useRef(0);
  const playTimelineStartRef = useRef(0);
  // Tracks the performance.now() timestamp until which video playback should be
  // held at sourceStart so that the Pixi fade-in reveals the first frame rather
  // than content that has already scrolled 0.35 s into the new segment.
  const segmentTransitionFreezeRef = useRef(0);
  const lastPlayingSegmentIdRef = useRef<string | null>(null);
  const scrollLeftRef = useRef(0);
  const timelineViewportWidthRef = useRef(0);
  const autoFollowSuspendUntilRef = useRef(0);
  const timelinePointerDownRef = useRef(false);
  // Always-current refs for data used inside capture-phase event handlers.
  // useCallback memoizes closures; these refs ensure handlers never read stale
  // state in the window between a Zustand commit and the next React re-render.
  const sortedLayersRef = useRef<typeof sortedLayers>([]);
  const zoomClipsRef = useRef<typeof zoomClips>([]);
  const textClipsRef = useRef<typeof textClips>([]);
  const musicClipsRef = useRef<typeof musicClips>([]);
  const cameraClipsRef = useRef<typeof cameraClips>([]);
  const maskClipsRef = useRef<typeof maskClips>([]);
  const orderedSegmentsRef = useRef<typeof orderedSegments>([]);
  const processingSegmentRef = useRef<typeof processingSegment>(null);
  const musicFileInputRef = useRef<HTMLInputElement>(null);
  const ghostVideoDropdownRef = useRef<{ x: number; rowTop: number } | null>(null);
  const ghostZoomDropdownRef = useRef<{ x: number; rowTop: number } | null>(null);
  // True while any ActionClip context menu is open — prevents ghost-zone and row clicks
  // from leaking through the Radix portal to the timeline underneath.
  const isContextMenuOpenRef = useRef(false);
  // Tracks the timeline-time under the ghost cursor without triggering re-renders.
  // Updated on every pointer move; read only on click.
  const hoverGhostTimeRef = useRef<number>(0);
  // Cached bounding rect of the timeline content div — refreshed on pointer enter
  // so we never call getBoundingClientRect() inside the hot pointer-move handler.
  const contentDivRectRef = useRef<DOMRect | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const effectiveTimelineMax = useMemo(() => {
    if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
      return TL_H_DEFAULT;
    }

    const byAvailableSpace = availableHeight - PREVIEW_MIN_H;
    return Math.min(TL_H_MAX, Math.max(TL_H_MIN, byAvailableSpace));
  }, [availableHeight]);
  const { height: tlHeight, onMouseDown: handleResizeMouseDown } = useResizable({
    min: TL_H_MIN,
    max: effectiveTimelineMax,
    initial: TL_H_DEFAULT,
  });

  const [playing, setPlaying] = useState(false);
  const [scaleWidth, setScaleWidth] = useState(80);
  const [layers, setLayers] = useState<Layer[]>(INITIAL_LAYERS);
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const [hoverGhost, setHoverGhost] = useState<{
    lane: 'video' | 'zoom' | 'text' | 'music' | 'camera' | 'mask';
    time: number;
    x: number;
    rowTop: number;
  } | null>(null);
  const [ghostVideoDropdown, setGhostVideoDropdown] = useState<{
    x: number;
    rowTop: number;
  } | null>(null);
  const [ghostZoomDropdown, setGhostZoomDropdown] = useState<{
    x: number;
    rowTop: number;
  } | null>(null);
  const orderedSegments = useMemo(() => sortMediaSegments(mediaSegments), [mediaSegments]);
  const segmentsById = useMemo(
    () => new Map(orderedSegments.map((segment) => [segment.id, segment])),
    [orderedSegments],
  );
  const audioSrc = useMemo(() => {
    if (!recordingFilePath) {
      return null;
    }

    const resolvedAudioPath = resolveTimelineAudioPath({
      filePath: recordingFilePath,
      audioPath: audioPath ?? undefined,
      hasEmbeddedAudio: recordingHasEmbeddedAudio,
    });

    return resolvedAudioPath ? createScreenforgeFileUrl(resolvedAudioPath) : null;
  }, [audioPath, recordingFilePath, recordingHasEmbeddedAudio]);
  const timelineScaleCount = useMemo(() => {
    const maxZoomEnd = zoomClips
      .filter((c) => c.start <= c.end)
      .reduce((max, c) => Math.max(max, c.end), 0);
    const maxTextEnd = textClips.reduce((max, c) => Math.max(max, c.end), 0);
    return Math.ceil(Math.max(totalDur, maxZoomEnd, maxTextEnd) / SCALE);
  }, [totalDur, zoomClips, textClips]);

  // analyzeKeyboardData is expensive — only re-run when the recording itself changes.
  const keyboardAnalyzedData = useMemo(() => {
    if (!recordingResult || !keyboardEnabled) {
      return null;
    }
    return analyzeKeyboardData(recordingResult);
  }, [recordingResult, keyboardEnabled]);

  // mapKeyboardDataToTimeline is cheap — re-run whenever segments change (e.g. speed).
  const keyboardTimelineData = useMemo(() => {
    if (!keyboardAnalyzedData) {
      return null;
    }
    return mapKeyboardDataToTimeline(keyboardAnalyzedData, mediaSegments);
  }, [keyboardAnalyzedData, mediaSegments]);

  // Mouse click indicators derived from mousedown events in mouseData
  const mouseClickIndicators = useMemo<Array<{ id: string; start: number; end: number }>>(() => {
    if (!recordingResult) {
      return [];
    }
    const { mouseData, startTime } = recordingResult;
    const rawClicks = mouseData
      .filter((e) => e.type === 'mousedown')
      .map((e, i) => ({
        id: `click-${i}`,
        start: (e.timestamp - startTime) / 1000,
        end: (e.timestamp - startTime) / 1000 + 0.1,
      }));

    const remapped =
      mediaSegments.length === 0
        ? rawClicks
        : (() => {
            const ordered = sortMediaSegments(mediaSegments);
            return rawClicks
              .flatMap((click) => {
                for (const seg of ordered) {
                  if (!isMediaTrackEnabled(seg, 'video')) {
                    continue;
                  }
                  if (click.start >= seg.sourceStart && click.start < seg.sourceEnd) {
                    const tStart =
                      seg.timelineStart + (click.start - seg.sourceStart) / (seg.speed ?? 1);
                    return [{ id: click.id, start: tStart, end: tStart + 0.1 }];
                  }
                }
                return [];
              })
              .sort((a, b) => a.start - b.start);
          })();

    return remapped.sort((a, b) => a.start - b.start);
  }, [recordingResult, mediaSegments]);

  const indicatorMergedGroups = useMemo(() => {
    const MIN_PILL_W = 44;
    const PILL_GAP = 6;
    const groupThresholdSecs = ((MIN_PILL_W + PILL_GAP) / scaleWidth) * SCALE;

    const allEvents = [
      ...(keyboardTimelineData?.comboEvents ?? []).map((c) => ({
        start: c.start,
        end: c.end,
        kind: 'keyboard-shortcut' as const,
        label: c.keys.join(' '),
      })),
      ...mouseClickIndicators.map((c) => ({
        start: c.start,
        end: c.end,
        kind: 'mouse-click' as const,
        label: 'Click',
      })),
    ].sort((a, b) => a.start - b.start);

    const groups: { start: number; end: number; kbLabels: string[]; clickCount: number }[] = [];
    for (const ev of allEvents) {
      const last = groups[groups.length - 1];
      if (last && ev.start - last.end < groupThresholdSecs) {
        last.end = Math.max(last.end, ev.end);
        if (ev.kind === 'keyboard-shortcut') {
          last.kbLabels.push(ev.label);
        } else {
          last.clickCount++;
        }
      } else {
        groups.push({
          start: ev.start,
          end: ev.end,
          kbLabels: ev.kind === 'keyboard-shortcut' ? [ev.label] : [],
          clickCount: ev.kind === 'mouse-click' ? 1 : 0,
        });
      }
    }
    return groups;
  }, [keyboardTimelineData, mouseClickIndicators, scaleWidth]);

  const syncedLayers = useMemo(
    () =>
      layers.map((layer) => (layer.id === 'camera' ? { ...layer, hidden: !cameraEnabled } : layer)),
    [layers, cameraEnabled],
  );

  const sortedLayers = useMemo(
    () =>
      [
        ...syncedLayers.filter((layer) => {
          if (layer.id === 'camera') {
            return Boolean(recordingCameraPath);
          }
          if (layer.id === 'audio') {
            return hasAudioLane;
          }
          if (layer.id === 'music') {
            return musicClips.length > 0;
          }
          if (layer.id === 'mask') {
            return maskClips.length > 0;
          }
          if (layer.id === 'indicators') {
            return true;
          }
          return true;
        }),
      ].sort(
        (a, b) =>
          (LAYER_ORDER[a.id] ?? Number.MAX_SAFE_INTEGER) -
          (LAYER_ORDER[b.id] ?? Number.MAX_SAFE_INTEGER),
      ),
    [hasAudioLane, maskClips, musicClips, syncedLayers, recordingCameraPath],
  );

  // Keep always-current refs in sync after every render so capture-phase
  // handlers never read stale values between a commitEdit() and re-render.
  useLayoutEffect(() => {
    sortedLayersRef.current = sortedLayers;
    zoomClipsRef.current = zoomClips;
    textClipsRef.current = textClips;
    musicClipsRef.current = musicClips;
    cameraClipsRef.current = cameraClips;
    maskClipsRef.current = maskClips;
    orderedSegmentsRef.current = orderedSegments;
    processingSegmentRef.current = processingSegment;
    ghostVideoDropdownRef.current = ghostVideoDropdown;
    ghostZoomDropdownRef.current = ghostZoomDropdown;
  });

  const snapThresholdSeconds = useMemo(() => (SNAP_PX / scaleWidth) * SCALE, [scaleWidth]);

  const lastSegmentEnd = useMemo(
    () => orderedSegments.reduce((max, seg) => Math.max(max, seg.timelineEnd), 0),
    [orderedSegments],
  );

  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    isContextMenuOpenRef.current = open;
    if (open) {
      setHoverGhost(null);
    }
  }, []);

  const handleAppendClick = useCallback(() => {
    setAppendStartTime(lastSegmentEnd);
    setIsAppendMode(true);
    window.screenforge.activateAppendMode();
    window.screenforge.showToolbar();
  }, [lastSegmentEnd, setAppendStartTime, setIsAppendMode]);

  const { isImporting, insertImportedClip } = useImportVideo();

  const handleAddZoomAtTime = useCallback(
    (time: number, preset: 'standard' | 'cinematic' = 'standard') => {
      const halfSec = (GHOST_WIDTH / 2 / scaleWidth) * SCALE;
      const start = Math.max(0, time - halfSec);
      const end = time + halfSec;
      const clip =
        preset === 'cinematic'
          ? defaultCinematicZoomClip(`zoom-${Date.now()}`, start, end)
          : defaultZoomClip(`zoom-${Date.now()}`, start, end);
      commitEdit(preset === 'cinematic' ? 'Add cinematic zoom clip' : 'Add zoom clip', (state) => ({
        zoomClips: [...state.zoomClips, clip].sort((a, b) => a.start - b.start),
      }));
      trackEvent('zoom_clip_added', { source: 'timeline', preset });
    },
    [scaleWidth, commitEdit],
  );

  const handleAddTextAtTime = useCallback(
    (time: number) => {
      const halfSec = (GHOST_WIDTH / 2 / scaleWidth) * SCALE;
      const start = Math.max(0, time - halfSec);
      const end = time + halfSec;
      const id = `text-${Date.now()}`;
      commitEdit('Add text clip', (state) => ({
        textClips: [
          ...state.textClips,
          {
            id,
            start,
            end,
            content: 'Text',
            x: 0.3,
            y: 0.4,
            width: 0.4,
            fontFamily: 'Instrument Sans',
            fontSize: 48,
            bold: false,
            italic: false,
            underline: false,
            align: 'center' as const,
            verticalAlign: 'top' as const,
            color: '#F4F0EE',
            colorOpacity: 100,
            backgroundEnabled: false,
            backgroundColor: '#0A0A0C',
            backgroundOpacity: 72,
            backgroundRadius: 12,
            backgroundPadding: 16,
            animationIn: 'fade' as const,
            animationInDuration: 0.3,
            animationOut: 'fade' as const,
            animationOutDuration: 0.3,
          },
        ].sort((a, b) => a.start - b.start),
      }));
      trackEvent('text_clip_added', { source: 'timeline' });
    },
    [scaleWidth, commitEdit],
  );

  const handleAddMusicAtTime = useCallback(() => {
    musicFileInputRef.current?.click();
  }, []);

  const handleAddMaskAtTime = useCallback(
    (time: number) => {
      const halfSec = (GHOST_WIDTH / 2 / scaleWidth) * SCALE;
      const start = Math.max(0, time - halfSec);
      const end = time + halfSec;
      const id = `mask-${Date.now()}`;
      commitEdit('Add mask', (s) => ({
        maskClips: [
          ...s.maskClips,
          {
            id,
            start,
            end,
            x: 0.3,
            y: 0.3,
            width: 0.2,
            height: 0.1,
            type: 'blur' as const,
            blurAmount: 20,
            color: '#000000',
          },
        ],
      }));
      setActiveWidget('mask');
    },
    [scaleWidth, commitEdit, setActiveWidget],
  );

  const handleMusicFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) {
        return;
      }
      const filePath = window.screenforge.getPathForFile(file);
      if (!filePath) {
        return;
      }
      const originalName = file.name.replace(/\.[^.]+$/, '');
      const projectId = useStore.getState().currentProjectId ?? 'default';
      const insertTime = hoverGhostTimeRef.current;
      try {
        const { filePath: savedPath, duration } = await window.screenforge.saveMusic(
          filePath,
          projectId,
        );
        commitEdit('Add music clip', (state) => ({
          musicClips: [
            ...state.musicClips,
            {
              id: `music-${Date.now()}`,
              name: originalName,
              filePath: savedPath,
              startTime: 0,
              duration,
              timelineStart: insertTime,
              timelineEnd: Math.min(insertTime + duration, totalDurRef.current),
              fitToVideo: false,
              volume: 0.5,
            },
          ],
        }));
        useStore.getState().setLayerHidden('music', false);
        trackEvent('music_clip_added', { source: 'timeline' });
      } catch {
        // silently ignore — user can retry via widget
      }
    },
    [commitEdit],
  );

  const handleContentMouseMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Never update ghost during drag / resize — these cause CanvasTimeline
      // re-renders mid-drag which stutter the timeline library's drag rendering.
      if (timelinePointerDownRef.current) {
        // Invalidate clip click if pointer moved significantly from the down position.
        const cc = clipClickRef.current;
        if (cc?.clean) {
          const dx = e.clientX - cc.x;
          const dy = e.clientY - cc.y;
          if (Math.hypot(dx, dy) > 6) {
            cc.clean = false;
          }
        }
        setHoverGhost(null);
        return;
      }
      if (ghostVideoDropdownRef.current || ghostZoomDropdownRef.current) {
        return;
      }

      if (!recordingResult) {
        setHoverGhost(null);
        return;
      }
      const rect = contentDivRectRef.current ?? e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      // Snap to integer pixels to prevent sub-pixel oscillation at clip edges.
      const snappedX = Math.round(mouseX);

      const relativeY = mouseY - RULER_H + scrollTop;
      const rowIndex = Math.floor(relativeY / LANE_H);

      const currentLayers = sortedLayersRef.current;
      if (rowIndex < 0 || rowIndex >= currentLayers.length) {
        setHoverGhost(null);
        return;
      }

      const layer = currentLayers[rowIndex];
      if (!layer || layer.id === 'indicators' || layer.id === 'audio') {
        setHoverGhost(null);
        return;
      }

      if (snappedX < TIMELINE_START_LEFT) {
        setHoverGhost(null);
        return;
      }

      const time = Math.max(
        0,
        ((snappedX - TIMELINE_START_LEFT + scrollLeftRef.current) / scaleWidth) * SCALE,
      );

      const rowTop = RULER_H + rowIndex * LANE_H - scrollTop;
      const ghostHalfSec = (GHOST_WIDTH / 2 / scaleWidth) * SCALE;
      const ghostStart = time - ghostHalfSec;
      const ghostEnd = time + ghostHalfSec;

      let isEmpty = false;
      if (layer.id === 'video') {
        // Range check: ghost visual bounds must not overlap any video segment or the
        // processing-ghost loader (which is not yet in orderedSegments).
        const segs = orderedSegmentsRef.current;
        const ps = processingSegmentRef.current;
        isEmpty =
          !segs.some((seg) => ghostEnd > seg.timelineStart && ghostStart < seg.timelineEnd) &&
          !(ps && ghostEnd > ps.timelineStart && ghostStart < ps.timelineEnd);
      } else if (layer.id === 'zoom') {
        const clips = zoomClipsRef.current;
        // Range check: ghost visual bounds must not overlap any existing zoom clip.
        // Skip inverted clips (start > end) — data artifacts from a previous bug.
        isEmpty = !clips.some((c) => {
          if (c.start > c.end) {
            return false;
          }
          return ghostEnd > c.start && ghostStart < c.end;
        });
      } else if (layer.id === 'text') {
        const clips = textClipsRef.current;
        isEmpty = !clips.some((c) => time >= c.start && time < c.end);
      } else if (layer.id === 'music') {
        const clips = musicClipsRef.current;
        isEmpty = !clips.some((c) => time >= c.timelineStart && time < c.timelineEnd);
      } else if (layer.id === 'mask') {
        isEmpty = !maskClipsRef.current.some((c) => time >= c.start && time < c.end);
      }

      if (!isEmpty) {
        setHoverGhost(null);
        return;
      }

      // Always keep the time ref current (used on click, not for rendering).
      hoverGhostTimeRef.current = time;

      const laneId = layer.id as 'video' | 'zoom' | 'text' | 'music' | 'camera' | 'mask';
      // Functional update: bail out without a re-render when the ghost's
      // visible position (integer x, row, lane) has not actually changed.
      setHoverGhost((prev) => {
        if (prev && prev.lane === laneId && prev.x === snappedX && prev.rowTop === rowTop) {
          return prev;
        }
        return { lane: laneId, time, x: snappedX, rowTop };
      });
    },
    [recordingResult, scrollTop, scaleWidth],
  );

  const handleContentMouseLeave = useCallback(() => {
    // Keep the ghost visible when a ghost dropdown is open so the +box
    // stays rendered as an anchor while the user interacts with the menu.
    if (ghostVideoDropdownRef.current || ghostZoomDropdownRef.current) {
      return;
    }
    setHoverGhost(null);
  }, []);

  // Capture-phase click handler: intercepts clicks that land inside the ghost
  // zone bounds and routes them to the correct action, preventing the underlying
  // timeline row click (seekTo) from also firing.
  const handleGhostZoneClickCapture = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!hoverGhost || isContextMenuOpenRef.current) {
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const ghostLeft = hoverGhost.x - GHOST_WIDTH / 2;
      const ghostRight = hoverGhost.x + GHOST_WIDTH / 2;
      const ghostTop = hoverGhost.rowTop + 4;
      const ghostBottom = hoverGhost.rowTop + LANE_H - 4;
      if (
        clickX >= ghostLeft &&
        clickX <= ghostRight &&
        clickY >= ghostTop &&
        clickY <= ghostBottom
      ) {
        e.stopPropagation();
        if (hoverGhost.lane === 'video') {
          setGhostVideoDropdown({ x: hoverGhost.x, rowTop: hoverGhost.rowTop });
        } else if (hoverGhost.lane === 'zoom') {
          setGhostZoomDropdown({ x: hoverGhost.x, rowTop: hoverGhost.rowTop });
        } else if (hoverGhost.lane === 'text') {
          handleAddTextAtTime(hoverGhostTimeRef.current);
        } else if (hoverGhost.lane === 'music') {
          handleAddMusicAtTime();
        } else if (hoverGhost.lane === 'mask') {
          handleAddMaskAtTime(hoverGhostTimeRef.current);
          setHoverGhost(null);
        }
      }
    },
    [hoverGhost, handleAddTextAtTime, handleAddMusicAtTime, handleAddMaskAtTime],
  );

  const suspendAutoFollow = useCallback((durationMs: number = AUTO_FOLLOW_RELEASE_GRACE_MS) => {
    autoFollowSuspendUntilRef.current = performance.now() + durationMs;
  }, []);

  const ensurePlayheadVisible = useCallback(
    (time: number, opts: { force?: boolean } = {}) => {
      if (
        !opts.force &&
        (timelinePointerDownRef.current || performance.now() < autoFollowSuspendUntilRef.current)
      ) {
        return;
      }

      const viewportWidth = Math.max(
        timelineViewportWidthRef.current,
        timelineRef.current?.target?.clientWidth ?? 0,
      );
      if (viewportWidth <= 0) {
        return;
      }

      const currentScrollLeft = Math.max(0, scrollLeftRef.current);
      const playheadLeft = TIMELINE_START_LEFT + (time / SCALE) * scaleWidth;
      const padding = Math.min(
        PLAYHEAD_SCROLL_PADDING_MAX_PX,
        Math.max(PLAYHEAD_SCROLL_PADDING_MIN_PX, viewportWidth * 0.18),
      );
      const minVisibleLeft = currentScrollLeft + padding;
      const maxVisibleLeft = currentScrollLeft + viewportWidth - padding;
      const forwardTargetLeft = Math.max(padding, viewportWidth * PLAYHEAD_SCROLL_TARGET_MIN_RATIO);
      const backwardTargetLeft = Math.min(
        viewportWidth - padding,
        viewportWidth * PLAYHEAD_SCROLL_TARGET_MAX_RATIO,
      );
      let nextScrollLeft = currentScrollLeft;

      if (playheadLeft < minVisibleLeft) {
        nextScrollLeft = playheadLeft - backwardTargetLeft;
      } else if (playheadLeft > maxVisibleLeft) {
        nextScrollLeft = playheadLeft - forwardTargetLeft;
      }

      if (Math.abs(nextScrollLeft - currentScrollLeft) < 1) {
        return;
      }

      const maxScrollLeft = Math.max(
        0,
        timelineScaleCount * scaleWidth + TIMELINE_START_LEFT - viewportWidth,
      );
      const clampedScrollLeft = Math.max(0, Math.min(nextScrollLeft, maxScrollLeft));

      scrollLeftRef.current = clampedScrollLeft;
      timelineRef.current?.setScrollLeft(clampedScrollLeft);
    },
    [scaleWidth, timelineScaleCount],
  );

  const snapTargets = useMemo(() => {
    const points = new Set<number>([0, totalDur, currentTime]);

    for (const seg of orderedSegments) {
      points.add(seg.timelineStart);
      points.add(seg.timelineEnd);
    }

    for (const clip of zoomClips) {
      points.add(clip.start);
      points.add(clip.end);
    }

    return [...points].sort((a, b) => a - b);
  }, [currentTime, orderedSegments, totalDur, zoomClips]);

  const snapTime = useCallback(
    (time: number) => getNearestSnap(time, snapTargets, snapThresholdSeconds),
    [snapTargets, snapThresholdSeconds],
  );

  const syncVideoForTimeline = useCallback(
    (timelineTime: number, shouldPlay: boolean) => {
      const video = videoRef.current;
      if (!video) {
        return;
      }

      const activeSegment = findSegmentAtTime(orderedSegments, timelineTime);
      if (!activeSegment) {
        setIsGapPlayback(true);
        video.pause();
        return;
      }

      const speed = activeSegment.speed ?? 1;
      const sourceTime =
        activeSegment.sourceStart + (timelineTime - activeSegment.timelineStart) * speed;
      const hasVideo = isMediaTrackEnabled(activeSegment, 'video');
      const hasAudio = isMediaTrackEnabled(activeSegment, 'audio');
      const audioLayerHidden = useStore.getState().hiddenLayers.audio;

      setIsGapPlayback(!hasVideo);
      video.muted = !hasAudio || audioLayerHidden;
      video.playbackRate = speed;

      const syncEpsilon = shouldPlay ? PLAYING_SYNC_EPSILON : PAUSED_SYNC_EPSILON;
      if (Math.abs(video.currentTime - sourceTime) > syncEpsilon) {
        video.currentTime = sourceTime;
      }

      // During the fade-in hold period, keep the video paused at sourceStart so
      // that the very first visible frame after the transition is frame 0 of the
      // new segment, not a frame N seconds in.
      const effectiveShouldPlay =
        shouldPlay && !(performance.now() < segmentTransitionFreezeRef.current);

      if (effectiveShouldPlay) {
        if (video.paused) {
          video.play().catch(Object);
        }
      } else {
        video.pause();
      }
    },
    [orderedSegments, setIsGapPlayback, videoRef],
  );

  const getLayerActions = useCallback(
    (id: string, actions: TimelineAction[]) => {
      if (id === 'indicators') {
        return [];
      }

      if (id === 'video') {
        if (!recordingFilePath) {
          return [];
        }
        return mediaSegmentsToActions(
          orderedSegments.filter((segment) => isMediaTrackEnabled(segment, 'video')),
        );
      }

      if (id === 'audio') {
        if (!recordingFilePath || !audioSrc || !hasAudioLane) {
          return [];
        }
        return orderedSegments
          .filter((segment) => isMediaTrackEnabled(segment, 'audio'))
          .map((seg) => ({
            id: `${seg.id}-audio`,
            start: seg.timelineStart,
            end: seg.timelineEnd,
            effectId: 'audio',
            flexible: false,
            movable: true,
          }));
      }

      if (id === 'zoom') {
        return zoomClips.map((c) => ({
          id: c.id,
          start: c.start,
          end: c.end,
          effectId: 'zoom',
          preset: c.preset,
          movable: true,
          flexible: true,
        }));
      }

      if (id === 'camera') {
        if (!recordingCameraPath || !cameraEnabled) {
          return [];
        }
        if (cameraClips.length === 0) {
          return [];
        }
        return cameraClips.map((c) => ({
          id: c.id,
          start: c.start,
          end: c.end,
          effectId: 'camera',
          movable: true,
          flexible: true,
        }));
      }

      if (id === 'mask') {
        return maskClips.map((c) => ({
          id: c.id,
          start: c.start,
          end: c.end,
          effectId: 'mask',
          movable: true,
          flexible: true,
        }));
      }

      if (id === 'text') {
        return textClips.map((c) => ({
          id: c.id,
          start: c.start,
          end: c.end,
          effectId: 'text',
          movable: true,
          flexible: true,
          content: c.content,
        }));
      }

      if (id === 'music') {
        return musicClips.map((clip) => ({
          id: clip.id,
          start: clip.timelineStart,
          end: clip.fitToVideo ? totalDur : clip.timelineEnd,
          effectId: 'music',
          movable: true,
          flexible: true,
          label: clip.name ?? 'Music',
        }));
      }

      return actions;
    },
    [
      audioPath,
      audioSrc,
      cameraClips,
      cameraEnabled,
      hasAudioLane,
      maskClips,
      musicClips,
      orderedSegments,
      recordingCameraPath,
      recordingFilePath,
      totalDur,
      zoomClips,
      textClips,
    ],
  );

  const editorData = useMemo(
    () =>
      sortedLayers.map(({ id, actions, hidden }) => ({
        id,
        actions: hidden ? [] : getLayerActions(id, actions),
      })),
    [getLayerActions, sortedLayers],
  );

  const splitAtTime = useCallback(
    (time: number) => {
      if (!recordingFilePath || orderedSegments.length === 0) {
        return;
      }

      const clamped = Math.max(0, Math.min(totalDur, time));
      const splitPoint = snapTime(clamped);
      const effectId = selectedClip?.effectId;

      if (effectId === 'zoom') {
        commitEdit('Split zoom clip', (state) => ({
          zoomClips: splitZoomClipsAtTime(state.zoomClips, splitPoint),
          selectedClip: null,
        }));
        return;
      }

      if (effectId === 'text') {
        commitEdit('Split text clip', (state) => ({
          textClips: splitTextClipsAtTime(state.textClips, splitPoint),
          selectedClip: null,
        }));
        return;
      }

      if (effectId === 'music') {
        commitEdit('Split music clip', (state) => ({
          musicClips: splitMusicClipsAtTime(state.musicClips, splitPoint),
          selectedClip: null,
        }));
        trackEvent('music_clip_split');
        return;
      }

      if (effectId === 'camera') {
        commitEdit('Split camera clip', (state) => ({
          cameraClips: splitCameraClipsAtTime(state.cameraClips, splitPoint),
          selectedClip: null,
        }));
        return;
      }

      if (effectId === 'mask') {
        commitEdit('Split mask clip', (state) => ({
          maskClips: splitMaskClipsAtTime(state.maskClips, splitPoint),
          selectedClip: null,
        }));
        return;
      }

      if (effectId === 'video' || effectId === 'audio') {
        const nextSegments = splitMediaSegmentsAtTime(orderedSegments, splitPoint);
        if (nextSegments.length === orderedSegments.length) {
          return;
        }
        commitEdit('Split video clip', (state) => ({
          mediaSegments: nextSegments,
          cameraMediaSegments: splitMediaSegmentsAtTime(state.cameraMediaSegments, splitPoint),
          selectedClip: null,
        }));
        return;
      }

      // Nothing selected — split everything at the playhead
      const nextSegments = splitMediaSegmentsAtTime(orderedSegments, splitPoint);
      if (nextSegments.length === orderedSegments.length) {
        return;
      }

      commitEdit('Split at playhead', (state) => ({
        mediaSegments: nextSegments,
        cameraMediaSegments: splitMediaSegmentsAtTime(state.cameraMediaSegments, splitPoint),
        zoomClips: splitZoomClipsAtTime(state.zoomClips, splitPoint),
        cameraClips: splitCameraClipsAtTime(state.cameraClips, splitPoint),
        selectedClip: null,
      }));
    },
    [commitEdit, orderedSegments, recordingFilePath, selectedClip, snapTime, totalDur],
  );

  const syncMusicForTimeline = useCallback((timelineTime: number, shouldPlay: boolean) => {
    const clips = useStore.getState().musicClips;
    const audios = musicAudiosRef.current;
    for (const clip of clips) {
      const audio = audios.get(clip.id);
      if (!audio || !clip.filePath) {
        audio?.pause();
        continue;
      }
      const clipEnd = clip.fitToVideo ? Infinity : clip.timelineEnd;
      const inRange = timelineTime >= clip.timelineStart && timelineTime <= clipEnd;
      if (!inRange) {
        if (!audio.paused) {
          audio.pause();
        }
        continue;
      }
      const offsetInClip = timelineTime - clip.timelineStart;
      const audioDuration = audio.duration > 0 ? audio.duration : clip.duration || 60;
      const targetTime = audioDuration > 0 ? offsetInClip % audioDuration : offsetInClip;
      if (
        isFinite(targetTime) &&
        Math.abs(audio.currentTime - targetTime) > (shouldPlay ? 0.3 : 0.05)
      ) {
        audio.currentTime = targetTime;
      }
      audio.volume = Math.max(0, Math.min(1, clip.volume));
      if (shouldPlay && audio.paused && audio.readyState >= 2) {
        void audio.play().catch(Object);
      } else if (!shouldPlay && !audio.paused) {
        audio.pause();
      }
    }
    for (const [id, audio] of audios) {
      if (!clips.find((c) => c.id === id)) {
        audio.pause();
      }
    }
  }, []); // reads from store + refs — intentionally no deps

  const startRaf = useCallback(
    (startTime: number) => {
      playClockStartRef.current = performance.now();
      playTimelineStartRef.current = startTime;
      segmentTransitionFreezeRef.current = 0;
      lastPlayingSegmentIdRef.current = findSegmentAtTime(orderedSegments, startTime)?.id ?? null;

      const tick = () => {
        const now = performance.now();
        const elapsed = (now - playClockStartRef.current) / 1000;
        playClockStartRef.current = now;

        let timelineTime = playTimelineStartRef.current;
        const activeSegment = findSegmentAtTime(orderedSegments, timelineTime);

        // Detect crossing into a new segment at its boundary. Only freeze when
        // the playhead is within 50 ms of the segment start (natural playthrough
        // or a seek to the very beginning), not mid-segment seeks.
        if (activeSegment && activeSegment.id !== lastPlayingSegmentIdRef.current) {
          lastPlayingSegmentIdRef.current = activeSegment.id;
          const atBoundary = timelineTime - activeSegment.timelineStart < 0.05;
          if (atBoundary) {
            const transition = getEffectiveTransition(activeSegment);
            const fadeDur = transition.type !== 'none' ? transition.duration : 0;
            if (fadeDur > 0) {
              segmentTransitionFreezeRef.current = now + (CLIP_FADE_IN_HOLD + fadeDur) * 1000;
            }
          }
        } else if (!activeSegment) {
          lastPlayingSegmentIdRef.current = null;
        }
        const video = videoRef.current;

        const curTotalDur = totalDurRef.current;

        if (activeSegment && video && video.ended) {
          // Video ended naturally (e.g. clip boundary = video EOF).
          // video.paused is also true when ended, so the normal branch would never
          // advance timelineTime — the tick would loop forever calling video.play()
          // on an ended element, which resets playback to t=0 and causes a blackout.
          // Push timelineTime to curTotalDur so the end condition fires immediately.
          timelineTime = curTotalDur;
        } else if (
          activeSegment &&
          video &&
          video.readyState >= 2 &&
          !video.seeking &&
          !video.paused
        ) {
          const speed = activeSegment.speed ?? 1;
          const segDuration = activeSegment.timelineEnd - activeSegment.timelineStart;
          const sourceOffset = Math.max(
            0,
            Math.min(segDuration * speed, video.currentTime - activeSegment.sourceStart),
          );
          timelineTime = activeSegment.timelineStart + sourceOffset / speed;
        } else if (!activeSegment) {
          timelineTime += elapsed;
        }

        timelineTime = Math.min(curTotalDur, timelineTime);
        playTimelineStartRef.current = timelineTime;

        setCurrentTime(timelineTime);
        timelineRef.current?.setTime(timelineTime);
        ensurePlayheadVisible(timelineTime);

        if (timelineTime >= curTotalDur) {
          setPlaying(false);
          // Pause only — do NOT call with shouldPlay=true at totalDur, which would
          // invoke video.play() on an ended element and reset it to t=0.
          syncVideoForTimeline(timelineTime, false);
          syncMusicForTimeline(timelineTime, false);
          rafRef.current = null;
          return;
        }

        syncVideoForTimeline(timelineTime, true);
        syncMusicForTimeline(timelineTime, true);
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [
      ensurePlayheadVisible,
      orderedSegments,
      setCurrentTime,
      syncMusicForTimeline,
      syncVideoForTimeline,
      videoRef,
    ],
  );

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => {
    const audios = musicAudiosRef.current;
    const currentIds = new Set(musicClips.map((c) => c.id));
    for (const [id, audio] of audios) {
      if (!currentIds.has(id)) {
        audio.pause();
        audios.delete(id);
      }
    }
    for (const clip of musicClips) {
      let audio = audios.get(clip.id);
      if (!audio) {
        audio = new Audio();
        audios.set(clip.id, audio);
      }
      if (clip.filePath) {
        const src = createScreenforgeFileUrl(clip.filePath);
        if (audio.src !== src) {
          audio.pause();
          audio.src = src;
        }
        audio.loop = true;
        audio.volume = Math.max(0, Math.min(1, clip.volume));
      } else {
        audio.pause();
        audio.removeAttribute('src');
      }
    }
    return () => {
      for (const [, audio] of audios) {
        audio.pause();
      }
    };
  }, [musicClips]);

  const playFrom = useCallback(
    (startTime: number) => {
      const vid = videoRef.current;
      if (!vid) {
        return;
      }

      setCurrentTime(startTime);
      timelineRef.current?.setTime(startTime);
      ensurePlayheadVisible(startTime, { force: true });
      syncVideoForTimeline(startTime, true);
      syncMusicForTimeline(startTime, true);
      setPlaying(true);
      startRaf(startTime);
    },
    [
      ensurePlayheadVisible,
      setCurrentTime,
      startRaf,
      syncMusicForTimeline,
      syncVideoForTimeline,
      videoRef,
    ],
  );

  const resetTimelineForRecordingChange = useEffectEvent(() => {
    stopRaf();
    startTransition(() => {
      setPlaying(false);
      setLayers(INITIAL_LAYERS);
      setScrollTop(0);
      setScrollLeft(0);
    });
    setCurrentTime(0);
    timelineRef.current?.setTime(0);
    scrollLeftRef.current = 0;
    timelineViewportWidthRef.current = 0;
    timelineRef.current?.setScrollLeft(0);
    timelineRef.current?.setScrollTop(0);
    syncVideoForTimeline(0, false);
    syncMusicForTimeline(0, false);
  });

  useEffect(() => () => stopRaf(), [stopRaf]);

  useEffect(() => {
    const handlePointerRelease = () => {
      if (!timelinePointerDownRef.current) {
        return;
      }

      timelinePointerDownRef.current = false;
      suspendAutoFollow();
    };

    window.addEventListener('pointerup', handlePointerRelease, true);
    window.addEventListener('pointercancel', handlePointerRelease, true);

    return () => {
      window.removeEventListener('pointerup', handlePointerRelease, true);
      window.removeEventListener('pointercancel', handlePointerRelease, true);
    };
  }, [suspendAutoFollow]);

  // Reset local timeline state whenever the active recording changes
  useEffect(() => {
    resetTimelineForRecordingChange();
  }, [recordingFilePath]);

  const handleTimelineScroll = useCallback((params: OnScrollParams) => {
    scrollLeftRef.current = Math.max(0, params.scrollLeft);
    timelineViewportWidthRef.current = Math.max(0, params.clientWidth);
    setScrollTop(Math.max(0, params.scrollTop));
    setScrollLeft(Math.max(0, params.scrollLeft));
  }, []);

  const handleGutterWheelScroll = useCallback((deltaY: number) => {
    if (!Number.isFinite(deltaY) || deltaY === 0) {
      return;
    }

    setScrollTop((prev) => {
      const next = Math.max(0, prev + deltaY);
      timelineRef.current?.setScrollTop(next);
      return next;
    });
  }, []);

  const handleTimelinePointerDownCapture = useCallback(() => {
    timelinePointerDownRef.current = true;
    suspendAutoFollow(AUTO_FOLLOW_POINTER_DOWN_GRACE_MS);
  }, [suspendAutoFollow]);

  const handleTimelinePointerEnter = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      contentDivRectRef.current = e.currentTarget.getBoundingClientRect();
      suspendAutoFollow(AUTO_FOLLOW_POINTER_MOVE_GRACE_MS);
    },
    [suspendAutoFollow],
  );

  const handleTimelinePointerMove = useCallback(() => {
    suspendAutoFollow(AUTO_FOLLOW_POINTER_MOVE_GRACE_MS);
  }, [suspendAutoFollow]);

  const togglePlay = useCallback(() => {
    if (selectedClip?.effectId === 'text') {
      setSelectedClip(null);
    }
    if (playing) {
      stopRaf();
      syncVideoForTimeline(currentTime, false);
      syncMusicForTimeline(currentTime, false);
      videoRef.current?.pause();
      setPlaying(false);
    } else {
      const startTime = currentTime >= totalDur - EDGE_EPSILON ? 0 : currentTime;
      playFrom(startTime);
    }
  }, [
    currentTime,
    playFrom,
    playing,
    selectedClip,
    setSelectedClip,
    stopRaf,
    syncMusicForTimeline,
    syncVideoForTimeline,
    totalDur,
    videoRef,
  ]);

  const handleStop = useCallback(() => {
    stopRaf();
    setPlaying(false);
    setCurrentTime(0);
    timelineRef.current?.setTime(0);
    syncVideoForTimeline(0, false);
    syncMusicForTimeline(0, false);
  }, [stopRaf, setCurrentTime, syncMusicForTimeline, syncVideoForTimeline]);

  const toggleHidden = (id: string) => {
    if (id === 'camera') {
      commitEdit(cameraEnabled ? 'Hide camera' : 'Show camera', (state) => ({
        camera: { ...state.camera, enabled: !state.camera.enabled },
      }));
      return;
    }
    setLayers((ls) => {
      const layer = ls.find((l) => l.id === id);
      const nextHidden = layer ? !layer.hidden : false;
      // indicators visibility is local-only — not persisted in the store
      if (id !== 'indicators') {
        setLayerHidden(id as Parameters<typeof setLayerHidden>[0], nextHidden);
      }
      return ls.map((l) => (l.id === id ? { ...l, hidden: nextHidden } : l));
    });
  };

  const handleFitToVideo = useCallback(
    (action: TimelineAction) => {
      commitEdit('Fit music to video', (state) => ({
        musicClips: state.musicClips.map((c) =>
          c.id === action.id ? { ...c, fitToVideo: true, timelineEnd: totalDur } : c,
        ),
      }));
      trackEvent('music_clip_fit_to_video');
    },
    [commitEdit, totalDur],
  );

  const deleteClip = useCallback(
    (action: Pick<TimelineAction, 'id' | 'effectId'>) => {
      if (action.effectId === 'zoom') {
        const clip = zoomClipsRef.current.find((c) => c.id === action.id);
        commitEdit('Delete zoom clip', (state) => ({
          zoomClips: state.zoomClips.filter((c) => c.id !== action.id),
          selectedClip: null,
        }));
        trackEvent('zoom_clip_deleted', {
          source: 'timeline',
          preset: clip?.preset,
          scale: clip?.scale,
          duration_seconds: clip ? Math.round((clip.end - clip.start) * 100) / 100 : undefined,
        });
        return;
      }

      if (action.effectId === 'text') {
        commitEdit('Delete text clip', (state) => ({
          textClips: state.textClips.filter((c) => c.id !== action.id),
          selectedClip: null,
        }));
        trackEvent('text_clip_deleted', { source: 'timeline' });
        return;
      }

      if (action.effectId === 'music') {
        commitEdit('Delete music clip', (state) => ({
          musicClips: state.musicClips.filter((c) => c.id !== action.id),
          selectedClip: null,
        }));
        trackEvent('music_clip_deleted', { source: 'timeline' });
        return;
      }

      if (action.effectId === 'mask') {
        commitEdit('Delete mask clip', (state) => ({
          maskClips: state.maskClips.filter((c) => c.id !== action.id),
          selectedClip: null,
        }));
        return;
      }

      if (action.effectId === 'camera') {
        commitEdit('Delete camera clip', (state) => {
          const nextCameraClips = state.cameraClips.filter((c) => c.id !== action.id);
          const removingLast = nextCameraClips.length === 0;
          return {
            cameraClips: nextCameraClips,
            selectedClip: null,
            ...(removingLast && state.recordingResult
              ? {
                  camera: { ...state.camera, enabled: false },
                  recordingResult: { ...state.recordingResult, cameraPath: undefined },
                }
              : {}),
          };
        });
        trackEvent('camera_clip_deleted', { source: 'timeline' });
        return;
      }

      if (action.effectId === 'video' || action.effectId === 'audio') {
        const segmentId = getSegmentIdFromAction(action);
        const track = action.effectId as MediaTrack;

        const isAudioTrackVisible = hasAudioLane;
        const isSegmentFullyRemoved = (seg: (typeof orderedSegments)[0], t: MediaTrack) => {
          const after = setMediaTrackEnabled(seg, t, false);
          return (
            !isMediaTrackEnabled(after, 'video') &&
            (!isMediaTrackEnabled(after, 'audio') || !isAudioTrackVisible)
          );
        };

        const originalSeg = orderedSegments.find((s) => s.id === segmentId);
        const willBeFullyRemoved = originalSeg != null && isSegmentFullyRemoved(originalSeg, track);

        commitEdit(`Delete ${track} clip`, (state) => {
          const seg = state.mediaSegments.find((s) => s.id === segmentId);
          if (!seg) {
            return { mediaSegments: state.mediaSegments, selectedClip: null };
          }

          const toggled = setMediaTrackEnabled(seg, track, false);
          const fullyRemoved =
            !isMediaTrackEnabled(toggled, 'video') &&
            (!isMediaTrackEnabled(toggled, 'audio') || !isAudioTrackVisible);

          const withToggle = state.mediaSegments.map((s) => (s.id === segmentId ? toggled : s));

          if (!fullyRemoved) {
            return {
              mediaSegments: withToggle.filter(
                (s) => isMediaTrackEnabled(s, 'video') || isMediaTrackEnabled(s, 'audio'),
              ),
              selectedClip: null,
            };
          }

          // Fully removed — ripple: shift subsequent segments left to close the gap.
          const { segments: rippleSegments, zoomClips: rippleZoomClips } = applyRippleDelete(
            state.mediaSegments,
            state.zoomClips,
            new Set([segmentId]),
          );
          return { mediaSegments: rippleSegments, zoomClips: rippleZoomClips, selectedClip: null };
        });

        // Shift the playhead left if it was past the deleted segment.
        if (willBeFullyRemoved && originalSeg && currentTime > originalSeg.timelineStart) {
          const deletedDuration = originalSeg.timelineEnd - originalSeg.timelineStart;
          const nextTime = Math.max(originalSeg.timelineStart, currentTime - deletedDuration);
          setCurrentTime(nextTime);
          timelineRef.current?.setTime(nextTime);
        }
      }
    },
    [audioPath, hasAudioLane, commitEdit, currentTime, orderedSegments, setCurrentTime],
  );

  const deleteSelectedClip = useCallback(() => {
    if (multiSelectedIds.size > 0) {
      const actionsToDelete = editorData
        .flatMap((layer) => layer.actions)
        .filter((action) => multiSelectedIds.has(action.id));

      if (actionsToDelete.length === 0) {
        setMultiSelectedIds(new Set());
        return;
      }

      const hasCameraActions = actionsToDelete.some((a) => a.effectId === 'camera');

      commitEdit('Delete selected clips', (state) => {
        let workingSegments = [...state.mediaSegments];
        let clips = [...state.zoomClips];
        let textClips = [...state.textClips];
        let cameraClips = [...state.cameraClips];
        let maskClips = [...state.maskClips];

        for (const action of actionsToDelete) {
          if (action.effectId === 'zoom') {
            clips = clips.filter((c) => c.id !== action.id);
          } else if (action.effectId === 'text') {
            textClips = textClips.filter((c) => c.id !== action.id);
          } else if (action.effectId === 'mask') {
            maskClips = maskClips.filter((c) => c.id !== action.id);
          } else if (action.effectId === 'camera') {
            cameraClips = cameraClips.filter((c) => c.id !== action.id);
          } else if (action.effectId === 'video' || action.effectId === 'audio') {
            const segId = getSegmentIdFromAction(action);
            const track = action.effectId as MediaTrack;
            workingSegments = workingSegments.map((seg) =>
              seg.id === segId ? setMediaTrackEnabled(seg, track, false) : seg,
            );
          }
        }

        const removingAllCameraClips = hasCameraActions && cameraClips.length === 0;
        const cameraUpdate =
          removingAllCameraClips && state.recordingResult
            ? {
                camera: { ...state.camera, enabled: false },
                recordingResult: { ...state.recordingResult, cameraPath: undefined },
              }
            : {};

        const fullyRemovedIds = new Set(
          workingSegments
            .filter(
              (s) =>
                !isMediaTrackEnabled(s, 'video') &&
                (!isMediaTrackEnabled(s, 'audio') || !hasAudioLane),
            )
            .map((s) => s.id),
        );

        const partialSegments = workingSegments.filter(
          (s) => isMediaTrackEnabled(s, 'video') || isMediaTrackEnabled(s, 'audio'),
        );

        if (fullyRemovedIds.size === 0) {
          return {
            mediaSegments: partialSegments,
            zoomClips: clips,
            textClips,
            cameraClips,
            maskClips,
            selectedClip: null,
            ...cameraUpdate,
          };
        }

        // Ripple using the original positions for the deleted segments.
        const { segments: rippleSegments, zoomClips: rippleZoomClips } = applyRippleDelete(
          state.mediaSegments,
          clips,
          fullyRemovedIds,
        );
        return {
          mediaSegments: rippleSegments,
          zoomClips: rippleZoomClips,
          textClips,
          cameraClips,
          maskClips,
          selectedClip: null,
          ...cameraUpdate,
        };
      });

      if (hasCameraActions) {
        trackEvent('camera_clip_deleted', { source: 'timeline' });
      }

      setMultiSelectedIds(new Set());
      return;
    }

    if (!selectedClip) {
      return;
    }

    deleteClip(selectedClip);
  }, [hasAudioLane, commitEdit, deleteClip, editorData, multiSelectedIds, selectedClip]);

  const selectAll = useCallback(() => {
    const allIds = editorData
      .flatMap((layer) => layer.actions)
      .filter((action) => action.effectId !== 'camera')
      .map((action) => action.id);
    setMultiSelectedIds(new Set(allIds));
  }, [editorData]);

  const clearSelection = useCallback(() => {
    setMultiSelectedIds(new Set());
    setSelectedClip(null);
  }, [setSelectedClip]);

  const handleShortcutAddZoom = useCallback(
    () => handleAddZoomAtTime(currentTime, 'standard'),
    [handleAddZoomAtTime, currentTime],
  );
  const handleShortcutAddCinematicZoom = useCallback(
    () => handleAddZoomAtTime(currentTime, 'cinematic'),
    [handleAddZoomAtTime, currentTime],
  );
  const handleShortcutAddText = useCallback(
    () => handleAddTextAtTime(currentTime),
    [handleAddTextAtTime, currentTime],
  );
  const handleShortcutAddMask = useCallback(
    () => handleAddMaskAtTime(currentTime),
    [handleAddMaskAtTime, currentTime],
  );

  useTimelineGlobalHotkeys({
    onTogglePlay: togglePlay,
    onSplitAtPlayhead: () => splitAtTime(currentTime),
    onUndo: undo,
    onRedo: redo,
    onDeleteSelected: deleteSelectedClip,
    onSelectAll: selectAll,
    onClearSelection: clearSelection,
    onAddZoom: handleShortcutAddZoom,
    onAddCinematicZoom: handleShortcutAddCinematicZoom,
    onAddText: handleShortcutAddText,
    onAddMask: handleShortcutAddMask,
  });

  const updateZoomClip = useCallback(
    (actionId: string, start: number, end: number, label: string) => {
      commitEdit(label, (state) => ({
        zoomClips: state.zoomClips
          .map((c) => (c.id === actionId ? { ...c, start, end } : c))
          .sort((a, b) => a.start - b.start),
      }));
    },
    [commitEdit],
  );

  const handleActionResizeEnd = useCallback(
    ({ action, start, end }: { action: TimelineAction; start: number; end: number }) => {
      if (action.effectId === 'zoom') {
        updateZoomClip(action.id, start, end, 'Resize zoom clip');
        return;
      }

      if (action.effectId === 'text') {
        commitEdit('Resize text clip', (state) => ({
          textClips: state.textClips
            .map((c) => (c.id === action.id ? { ...c, start, end } : c))
            .sort((a, b) => a.start - b.start),
        }));
        return;
      }

      if (action.effectId === 'music') {
        commitEdit('Resize music clip', (state) => ({
          musicClips: state.musicClips.map((c) =>
            c.id === action.id
              ? { ...c, timelineStart: start, timelineEnd: end, fitToVideo: false }
              : c,
          ),
        }));
        return;
      }

      if (action.effectId === 'camera') {
        commitEdit('Resize camera clip', (state) => ({
          cameraClips: state.cameraClips
            .map((c) => (c.id === action.id ? { ...c, start, end } : c))
            .sort((a, b) => a.start - b.start),
        }));
        return;
      }

      if (action.effectId === 'mask') {
        commitEdit('Resize mask clip', (state) => ({
          maskClips: state.maskClips
            .map((c) => (c.id === action.id ? { ...c, start, end } : c))
            .sort((a, b) => a.start - b.start),
        }));
        return;
      }

      if (action.effectId !== 'video') {
        return;
      }

      const seg = orderedSegments.find((s) => s.id === action.id);
      if (!seg) {
        return;
      }

      const sourceDuration = recordingResult?.duration ?? totalDur;
      let nextSegments = orderedSegments;

      const snappedStart = snapTime(Math.max(0, start));
      const snappedEnd = snapTime(Math.min(totalDur, end));

      if (Math.abs(snappedStart - seg.timelineStart) > EDGE_EPSILON) {
        nextSegments = trimMediaSegmentEdge(
          nextSegments,
          action.id,
          'start',
          snappedStart,
          sourceDuration,
        );
      }

      if (Math.abs(snappedEnd - seg.timelineEnd) > EDGE_EPSILON) {
        nextSegments = trimMediaSegmentEdge(
          nextSegments,
          action.id,
          'end',
          snappedEnd,
          sourceDuration,
        );
      }

      commitEdit('Trim media segment', () => ({
        mediaSegments: nextSegments,
        selectedClip: null,
      }));
      trackEvent('segment_trimmed');
    },
    [commitEdit, orderedSegments, recordingResult, snapTime, totalDur, updateZoomClip],
  );

  const selectClip = useCallback(
    (action: TimelineAction, event?: { metaKey: boolean; ctrlKey: boolean }) => {
      const isModifier = Boolean(event?.metaKey || event?.ctrlKey);

      if (isModifier) {
        setMultiSelectedIds((prev) => {
          const next = new Set(prev);
          // Seed with the single-selected clip when first entering multi-select
          if (next.size === 0 && selectedClipId) {
            next.add(selectedClipId);
          }
          if (next.has(action.id)) {
            next.delete(action.id);
          } else {
            next.add(action.id);
          }
          return next;
        });
        return;
      }

      setMultiSelectedIds(new Set());
      setSelectedClip({
        id: action.id,
        start: action.start,
        end: action.end,
        effectId: action.effectId,
      });
      if (action.effectId === 'text') {
        setActiveWidget('text');
      }
      if (action.effectId === 'mask') {
        setActiveWidget('mask');
      }
    },
    [selectedClipId, setSelectedClip, setActiveWidget],
  );

  const seekTo = useCallback(
    (time: number, opts: { snap?: boolean; fromUser?: boolean; shouldPlay?: boolean } = {}) => {
      const clamped = Math.max(0, Math.min(totalDur, time));
      const next = opts.snap === false ? clamped : snapTime(clamped);

      if (opts.fromUser) {
        suspendAutoFollow();
      }

      const resolvedShouldPlay = opts.shouldPlay !== undefined ? opts.shouldPlay : playing;

      // Re-anchor playback clock when seeking mid-play; otherwise RAF tick snaps back
      // to the old timeline origin captured at play start.
      if (resolvedShouldPlay) {
        playTimelineStartRef.current = next;
        playClockStartRef.current = performance.now();
      }

      setCurrentTime(next);
      timelineRef.current?.setTime(next);
      ensurePlayheadVisible(next, { force: true });
      syncVideoForTimeline(next, resolvedShouldPlay);
    },
    [
      ensurePlayheadVisible,
      playing,
      setCurrentTime,
      snapTime,
      suspendAutoFollow,
      syncVideoForTimeline,
      totalDur,
    ],
  );

  const getScaleRender = useCallback(
    (scale: number) => (
      <span
        style={{
          fontSize: 12,
          color: 'var(--color-sf-secondary)',
          fontFamily: 'monospace',
          whiteSpace: 'nowrap',
        }}
      >
        {scale < 60
          ? `${scale}s`
          : `${Math.floor(scale / 60)}:${String(scale % 60).padStart(2, '0')}`}
      </span>
    ),
    [],
  );

  const handleActionPointerDown = useCallback((e: React.PointerEvent) => {
    clipClickRef.current = { t: performance.now(), x: e.clientX, y: e.clientY, clean: true };
  }, []);

  const handleActionPointerLeave = useCallback(() => {
    if (clipClickRef.current) {
      clipClickRef.current.clean = false;
    }
  }, []);

  const getActionRender = useCallback(
    (action: TimelineAction) => {
      const audioSegment =
        action.effectId === 'audio' ? segmentsById.get(getSegmentIdFromAction(action)) : undefined;
      const videoSegment = action.effectId === 'video' ? segmentsById.get(action.id) : undefined;
      const cameraSpeed =
        action.effectId === 'camera'
          ? findSegmentAtTime(orderedSegments, action.start)?.speed
          : undefined;

      return (
        <ActionClip
          action={action}
          onDelete={deleteClip}
          onSelect={selectClip}
          onFitToVideo={handleFitToVideo}
          onContextMenuOpenChange={handleContextMenuOpenChange}
          selected={action.id === selectedClipId}
          multiSelected={multiSelectedIds.has(action.id)}
          audioWaveform={
            action.effectId === 'audio' && audioSrc && audioSegment
              ? {
                  audioSrc,
                  sourceStart: audioSegment.sourceStart,
                  sourceEnd: audioSegment.sourceEnd,
                }
              : undefined
          }
          speed={videoSegment?.speed ?? audioSegment?.speed ?? cameraSpeed}
          onPointerDown={handleActionPointerDown}
          onPointerLeave={handleActionPointerLeave}
        />
      );
    },
    [
      deleteClip,
      selectClip,
      handleFitToVideo,
      handleActionPointerDown,
      handleActionPointerLeave,
      handleContextMenuOpenChange,
      selectedClipId,
      multiSelectedIds,
      segmentsById,
      orderedSegments,
      audioSrc,
    ],
  );

  const handleClickAction = useCallback(
    (e: React.MouseEvent, { action, time }: { action: TimelineAction; time: number }) => {
      if (isContextMenuOpenRef.current) {
        return;
      }
      if (action.effectId === 'music') {
        setActiveWidget('music');
      }
      const isModifier = e.metaKey || e.ctrlKey;
      selectClip(action, e as React.MouseEvent<HTMLElement>);
      if (!isModifier) {
        const cc = clipClickRef.current;
        const elapsed = cc ? performance.now() - cc.t : Infinity;
        if (cc?.clean && elapsed < 400) {
          seekTo(time, { snap: false, fromUser: true });
        }
        clipClickRef.current = null;
      }
    },
    [selectClip, seekTo, setActiveWidget],
  );

  const handleClickRow = useCallback(
    (e: React.MouseEvent, { time }: { time: number }) => {
      if (isContextMenuOpenRef.current) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('.timeline-editor-action')) {
        return;
      }
      if (!e.metaKey && !e.ctrlKey) {
        setMultiSelectedIds(new Set());
      }
      seekTo(time, { snap: false, fromUser: true });
    },
    [seekTo, setMultiSelectedIds],
  );

  const handleClickTimeArea = useCallback(
    (time: number): boolean => {
      setMultiSelectedIds(new Set());
      seekTo(time, { snap: false, fromUser: true });
      return false;
    },
    [seekTo, setMultiSelectedIds],
  );

  const handleCursorDrag = useCallback(
    (time: number): boolean => {
      seekTo(time, { snap: false, fromUser: true });
      return false;
    },
    [seekTo],
  );

  const handleCursorDragEnd = useCallback(
    (time: number): boolean => {
      seekTo(time, { snap: false, fromUser: true });
      return false;
    },
    [seekTo],
  );

  const handleActionMoveEnd = useCallback(
    ({
      action,
      start,
      end,
    }: {
      action: Pick<TimelineAction, 'id' | 'effectId'>;
      start: number;
      end: number;
    }) => {
      if (action.effectId === 'zoom') {
        updateZoomClip(action.id, start, end, 'Move zoom clip');
        return;
      }
      if (action.effectId === 'text') {
        commitEdit('Move text clip', (state) => ({
          textClips: state.textClips
            .map((c) => (c.id === action.id ? { ...c, start, end } : c))
            .sort((a, b) => a.start - b.start),
        }));
        return;
      }
      if (action.effectId === 'music') {
        commitEdit('Move music clip', (state) => ({
          musicClips: state.musicClips.map((c) =>
            c.id === action.id ? { ...c, timelineStart: start, timelineEnd: end } : c,
          ),
        }));
        return;
      }
      if (action.effectId === 'camera') {
        commitEdit('Move camera clip', (state) => ({
          cameraClips: state.cameraClips
            .map((c) => (c.id === action.id ? { ...c, start, end } : c))
            .sort((a, b) => a.start - b.start),
        }));
        return;
      }
      if (action.effectId === 'mask') {
        commitEdit('Move mask clip', (state) => ({
          maskClips: state.maskClips
            .map((c) => (c.id === action.id ? { ...c, start, end } : c))
            .sort((a, b) => a.start - b.start),
        }));
        return;
      }
      if (action.effectId !== 'video' && action.effectId !== 'audio') {
        return;
      }
      const segmentId = getSegmentIdFromAction(action);
      const snappedStart = snapTime(Math.max(0, start));
      const nextSegments = moveMediaSegment(orderedSegments, segmentId, snappedStart);
      if (nextSegments === orderedSegments) {
        return;
      }
      commitEdit('Move media segment', () => ({
        mediaSegments: nextSegments,
        selectedClip: null,
      }));
    },
    [updateZoomClip, snapTime, orderedSegments, commitEdit],
  );

  const handlePendingPauseSeek = useEffectEvent((time: number) => {
    stopRaf();
    setPlaying(false);
    seekTo(time, { snap: false, shouldPlay: false });
    clearPendingPauseSeek();
  });

  useEffect(() => {
    if (pendingPauseSeekTime === null) {
      return;
    }

    handlePendingPauseSeek(pendingPauseSeekTime);
  }, [pendingPauseSeekTime]);

  const handlePendingPlayFromStart = useEffectEvent(() => {
    stopRaf();
    playFrom(0);
    clearPendingPlayFromStart();
  });

  useEffect(() => {
    if (pendingPlayFromStartToken === null) {
      return;
    }

    handlePendingPlayFromStart();
  }, [pendingPlayFromStartToken]);

  useEffect(() => {
    if (pendingSeekTime === null) {
      return;
    }

    seekTo(pendingSeekTime, { snap: false });
    clearPendingSeek();
  }, [clearPendingSeek, pendingSeekTime, seekTo]);

  return (
    <div
      className="flex flex-col shrink-0 select-none border-t border-sf-border sf-timeline-wrapper"
      style={{
        height: focusMode ? TL_H_MIN : tlHeight,
        maxHeight: focusMode ? TL_H_MIN : effectiveTimelineMax,
        background: '#0d0d0f',
        transition: 'height 0.2s ease, max-height 0.2s ease',
      }}
    >
      <ResizeHandle onMouseDown={handleResizeMouseDown} />

      <TimelineToolbar
        playing={playing}
        currentTime={currentTime}
        totalDur={totalDur}
        scaleWidth={scaleWidth}
        canUndo={canUndo}
        canRedo={canRedo}
        onTogglePlay={togglePlay}
        onStop={handleStop}
        onSplit={() => splitAtTime(currentTime)}
        onUndo={undo}
        onRedo={redo}
        onZoomIn={() => setScaleWidth((w) => Math.min(SCALE_MAX, w + SCALE_STEP))}
        onZoomOut={() => setScaleWidth((w) => Math.max(SCALE_MIN, w - SCALE_STEP))}
      />

      <div className="flex flex-1 overflow-hidden">
        <TimelineGutter
          layers={sortedLayers}
          scrollTop={scrollTop}
          onToggleHidden={toggleHidden}
          onWheelScroll={handleGutterWheelScroll}
        />

        <div
          className="relative flex-1 w-full"
          style={{ cursor: hoverGhost ? 'pointer' : 'default' }}
          onPointerDownCapture={handleTimelinePointerDownCapture}
          onPointerEnter={handleTimelinePointerEnter}
          onPointerMove={handleTimelinePointerMove}
          onPointerMoveCapture={handleContentMouseMove}
          onMouseLeave={handleContentMouseLeave}
          onClickCapture={handleGhostZoneClickCapture}
        >
          <MemoTimeline
            ref={timelineRef}
            editorData={editorData}
            effects={EFFECTS}
            style={TIMELINE_STYLE}
            scale={SCALE}
            scaleWidth={scaleWidth}
            startLeft={TIMELINE_START_LEFT}
            minScaleCount={timelineScaleCount}
            maxScaleCount={timelineScaleCount}
            rowHeight={LANE_H}
            autoScroll={true}
            dragLine
            scaleSplitCount={5}
            getScaleRender={getScaleRender}
            getActionRender={getActionRender}
            onClickAction={handleClickAction}
            onClickRow={handleClickRow}
            onClickTimeArea={handleClickTimeArea}
            onActionMoveEnd={handleActionMoveEnd}
            onActionResizeEnd={handleActionResizeEnd}
            onCursorDrag={handleCursorDrag}
            onCursorDragEnd={handleCursorDragEnd}
            onScroll={handleTimelineScroll}
          />

          {/* Processing ghost — shown while record-more concat is in progress */}
          {processingSegment && layers.findIndex((l) => l.id === 'video') >= 0 && (
            <TimelineProcessingClip
              timelineStart={processingSegment.timelineStart}
              timelineEnd={processingSegment.timelineEnd}
              scaleWidth={scaleWidth}
              scrollLeft={scrollLeft}
              rowTop={RULER_H + layers.findIndex((l) => l.id === 'video') * LANE_H - scrollTop}
            />
          )}

          {/* Hover ghost — follows mouse into empty timeline lanes */}
          {hoverGhost && (
            <TimelineGhostZone x={hoverGhost.x} rowTop={hoverGhost.rowTop} lane={hoverGhost.lane} />
          )}

          {/* Continue recording dropdown — anchored to a zero-size trigger at the click position */}
          <DropdownMenu
            open={ghostVideoDropdown !== null}
            onOpenChange={(open) => {
              if (!open) {
                setGhostVideoDropdown(null);
                setHoverGhost(null);
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <div
                className="pointer-events-none absolute"
                style={{
                  left: ghostVideoDropdown?.x ?? 0,
                  top: ghostVideoDropdown ? ghostVideoDropdown.rowTop + LANE_H : 0,
                  width: 0,
                  height: 0,
                }}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="center" className="w-40 p-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="w-full"
                    style={isExporting ? { cursor: 'not-allowed' } : undefined}
                  >
                    <DropdownMenuItem
                      disabled={isExporting}
                      className={`gap-2 py-1.5 px-2 text-sm${isExporting ? '' : ' cursor-pointer'}`}
                      onClick={() => {
                        if (isExporting) {
                          return;
                        }
                        setGhostVideoDropdown(null);
                        setHoverGhost(null);
                        handleAppendClick();
                      }}
                    >
                      <IconPlayerRecord
                        size={11}
                        color={isExporting ? undefined : 'var(--primary)'}
                        style={{ position: 'relative', top: '-0.5px' }}
                      />
                      <span className={isExporting ? undefined : 'text-primary'}>Record</span>
                    </DropdownMenuItem>
                  </div>
                </TooltipTrigger>
                {isExporting && <TooltipContent side="right">Exporting in progress</TooltipContent>}
              </Tooltip>

              <DropdownMenuSeparator />

              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="w-full"
                    style={isExporting || isImporting ? { cursor: 'not-allowed' } : undefined}
                  >
                    <DropdownMenuItem
                      disabled={isExporting || isImporting}
                      className={`gap-2 py-1.5 px-2 text-sm${isExporting || isImporting ? '' : ' cursor-pointer'}`}
                      onClick={() => {
                        if (isExporting || isImporting) {
                          return;
                        }
                        setGhostVideoDropdown(null);
                        setHoverGhost(null);
                        const ghostHalfSec = (GHOST_WIDTH / 2 / scaleWidth) * SCALE;
                        void insertImportedClip(
                          Math.max(0, hoverGhostTimeRef.current - ghostHalfSec),
                        );
                      }}
                    >
                      <IconVideo size={11} style={{ position: 'relative', top: '-0.5px' }} />
                      <span>Insert clip</span>
                    </DropdownMenuItem>
                  </div>
                </TooltipTrigger>
                {(isExporting || isImporting) && (
                  <TooltipContent side="right">
                    {isExporting ? 'Exporting in progress' : 'Importing…'}
                  </TooltipContent>
                )}
              </Tooltip>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Zoom insert dropdown — anchored to the empty zoom-lane ghost */}
          <DropdownMenu
            open={ghostZoomDropdown !== null}
            onOpenChange={(open) => {
              if (!open) {
                setGhostZoomDropdown(null);
                setHoverGhost(null);
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <div
                className="pointer-events-none absolute"
                style={{
                  left: ghostZoomDropdown?.x ?? 0,
                  top: ghostZoomDropdown ? ghostZoomDropdown.rowTop + LANE_H : 0,
                  width: 0,
                  height: 0,
                }}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="center" className="w-44 p-1">
              <DropdownMenuItem
                className="cursor-pointer gap-2 py-1.5 px-2 text-sm"
                onClick={() => {
                  setGhostZoomDropdown(null);
                  setHoverGhost(null);
                  handleAddZoomAtTime(hoverGhostTimeRef.current, 'standard');
                }}
              >
                <IconZoom size={11} style={{ position: 'relative', top: '-0.5px' }} />
                <span>Add zoom</span>
              </DropdownMenuItem>

              <DropdownMenuItem
                className="cursor-pointer gap-2 py-1.5 px-2 text-sm"
                onClick={() => {
                  setGhostZoomDropdown(null);
                  setHoverGhost(null);
                  handleAddZoomAtTime(hoverGhostTimeRef.current, 'cinematic');
                }}
              >
                <IconAiMagic size={11} style={{ position: 'relative', top: '-0.5px' }} />
                <span>Cinematic zoom</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Indicators overlay — positioned absolutely over the timeline */}
          {(() => {
            const indicatorsLayer = sortedLayers.find((l) => l.id === 'indicators');
            if (!indicatorsLayer || indicatorsLayer.hidden || !keyboardTimelineData) {
              return null;
            }
            const rowIndex = sortedLayers.indexOf(indicatorsLayer);
            const rowTop = RULER_H + rowIndex * LANE_H - scrollTop;

            const mergedGroups = indicatorMergedGroups;

            return (
              <div
                className="pointer-events-none absolute inset-0 overflow-hidden"
                style={{ zIndex: 2 }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: rowTop,
                    left: 0,
                    right: 0,
                    height: LANE_H,
                    overflow: 'hidden',
                  }}
                >
                  {mergedGroups.map((group, i) => {
                    const x = TIMELINE_START_LEFT + (group.start / SCALE) * scaleWidth - scrollLeft;
                    const rawW = ((group.end - group.start) / SCALE) * scaleWidth;
                    const hasKb = group.kbLabels.length > 0;
                    const hasClick = group.clickCount > 0;
                    const isMixed = hasKb && hasClick;

                    // Dominant kind drives icon and colour
                    const kind = hasKb ? 'keyboard-shortcut' : 'mouse-click';

                    // Build a compact label
                    let label: string;
                    if (isMixed) {
                      const kbPart =
                        group.kbLabels.length > 1
                          ? `${group.kbLabels[0]} +${group.kbLabels.length - 1}`
                          : group.kbLabels[0];
                      const clickPart =
                        group.clickCount > 1 ? `${group.clickCount} Clicks` : 'Click';
                      label = `${kbPart} | ${clickPart}`;
                    } else if (hasKb) {
                      const extra = group.kbLabels.length - 1;
                      label = extra > 0 ? `${group.kbLabels[0]} +${extra}` : group.kbLabels[0];
                    } else {
                      label = group.clickCount > 1 ? `${group.clickCount} Clicks` : 'Click';
                    }

                    // Tooltip shows each event on its own line
                    const tooltipLines = [
                      ...group.kbLabels,
                      ...(group.clickCount > 0
                        ? [`${group.clickCount} mouse click${group.clickCount > 1 ? 's' : ''}`]
                        : []),
                    ];

                    return (
                      <IndicatorClip
                        key={`ind-${i}-${group.start}`}
                        kind={kind}
                        label={label}
                        tooltip={tooltipLines.join('\n')}
                        mixed={isMixed}
                        x={x}
                        width={rawW}
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const clickOffsetSecs = ((e.clientX - rect.left) / scaleWidth) * SCALE;
                          seekTo(Math.max(0, group.start + clickOffsetSecs), {
                            snap: false,
                            fromUser: true,
                          });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Hidden file input for music ghost-zone add */}
      <input
        ref={musicFileInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/x-m4a,audio/aac"
        className="hidden"
        onChange={(e) => {
          void handleMusicFileSelect(e);
        }}
      />
    </div>
  );
};
