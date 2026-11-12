import { createScreenforgeFileUrl } from 'src/lib/screenforge-url';
import { IconInfo, IconPlus, IconVideo, IconCamera } from 'src/lib/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { trackEvent } from 'src/lib/analytics';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../../store';
import { usePixiRenderer } from '../../../hooks/usePixiRenderer';
import { useRecordedBarDetection } from '../../../hooks/useRecordedBarDetection';
import { Button, Spinner, Tooltip, TooltipContent, TooltipTrigger } from 'src/lib/ui';
import { getFrameGeometry, resolveAspectRatioValue } from 'src/lib/effects/frame';
import { FrameCropOverlay } from './FrameCropOverlay';
import { CameraOverlayEditor } from './CameraOverlayEditor';
import { MaskOverlayEditor } from './MaskOverlayEditor';
import { TextOverlayEditor } from './TextOverlayEditor';
import { Maximize2, Minimize2 } from 'lucide-react';
import { playShutterSound } from 'src/lib/screenshot/shutter-sound';

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

type ScreenshotToastProps = {
  id: string | number;
  thumbnail: string;
  filePath: string;
  onAnnotate: () => void;
};

const ScreenshotToast = ({ id, thumbnail, filePath, onAnnotate }: ScreenshotToastProps) => {
  const { t } = useTranslation('common');
  const { t: tScreenshot } = useTranslation('screenshot');
  return (
    <div className="flex items-center gap-3 w-full px-3 py-[10px] rounded-xl select-none">
      {/* Thumbnail — double-bezel housing */}
      <div className="shrink-0 p-[2.5px] bg-white/[0.04] ring-1 ring-inset ring-white/[0.06]">
        <div className="w-[56px] h-[34px] overflow-hidden bg-black/50">
          <img src={thumbnail} alt="" className="w-full h-full object-cover" draggable={false} />
        </div>
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p
          className="truncate text-sm font-[500] text-white/[0.88]"
          style={{ WebkitFontSmoothing: 'antialiased' }}
        >
          {t('screenshotSaved')}
        </p>
        <p
          className="mt-.5 truncate text-xs text-white/[0.32]"
          style={{ WebkitFontSmoothing: 'antialiased' }}
        >
          ~/Pictures/Screenforge
        </p>
      </div>

      {/* Open in the Screenshot editor */}
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0 ml-3"
        onClick={() => {
          onAnnotate();
          toast.dismiss(id);
        }}
      >
        {tScreenshot('annotate')}
      </Button>

      {/* Show in Finder */}
      <Button
        variant="secondary"
        size="sm"
        className="shrink-0"
        onClick={() => {
          void window.screenforge.revealExportInFolder(filePath);
          toast.dismiss(id);
        }}
      >
        {t('showInFinder')}
      </Button>
    </div>
  );
};

const ProcessingOverlay = () => {
  const { t } = useTranslation('common');
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 select-none">
      <Spinner className="w-6 h-6" />
      <span className="text-sm font-medium text-sf-muted">{t('processing')}</span>
    </div>
  );
};

export const CanvasPreview = ({ videoRef, canvasRef }: Props) => {
  // Finds (and crops off) a recorded browser toolbar once per window recording.
  useRecordedBarDetection();
  const { t } = useTranslation('common');
  const {
    recordingResult,
    isProcessing,
    isGapPlayback,
    isCropEditing,
    frame,
    focusMode,
    setFocusMode,
    setActiveWidget,
  } = useStore(
    useShallow((s) => ({
      recordingResult: s.recordingResult,
      isProcessing: s.isProcessing,
      isGapPlayback: s.isGapPlayback,
      isCropEditing: s.isCropEditing,
      frame: s.frame,
      focusMode: s.focusMode,
      setFocusMode: s.setFocusMode,
      setActiveWidget: s.setActiveWidget,
    })),
  );
  const [isHovered, setIsHovered] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);

  const handleCapture = useCallback(
    async (source: 'button' | 'shortcut' = 'button') => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      playShutterSound();
      setIsFlashing(true);
      setTimeout(() => setIsFlashing(false), 180);

      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const { width, height } = canvas;

      const thumb = document.createElement('canvas');
      const ratio = canvas.width / Math.max(canvas.height, 1);
      thumb.width = 112;
      thumb.height = Math.round(112 / ratio);
      thumb.getContext('2d')?.drawImage(canvas, 0, 0, thumb.width, thumb.height);
      const thumbUrl = thumb.toDataURL('image/jpeg', 0.8);

      try {
        const filePath = await window.screenforge.saveScreenshot(dataUrl);
        trackEvent('screenshot_captured', { source });
        const openInEditor = () => {
          useStore.getState().openScreenshotEditor({ kind: 'frame', dataUrl, width, height });
          trackEvent('screenshot_editor_opened', { kind: 'frame' });
        };
        toast.custom(
          (id) => (
            <ScreenshotToast
              id={id}
              thumbnail={thumbUrl}
              filePath={filePath}
              onAnnotate={openInEditor}
            />
          ),
          { duration: 4000, unstyled: true },
        );
      } catch {
        trackEvent('screenshot_failed', { source });
        toast.error(t('screenshotFailed'));
      }
    },
    [canvasRef, t],
  );

  useHotkeys('backquote', () => setFocusMode(!useStore.getState().focusMode), {
    enableOnFormTags: true,
    // Not `enabled`: a false `enabled` callback swallows the key (see
    // useTimelineGlobalHotkeys), and the Screenshot editor needs its keys.
    ignoreEventWhen: () => useStore.getState().screenshotCapture !== null,
  });
  useHotkeys('meta+shift+c, ctrl+shift+c', () => void handleCapture('shortcut'), {
    enabled: !!recordingResult,
    ignoreEventWhen: () => useStore.getState().screenshotCapture !== null,
    preventDefault: true,
  });
  const fallbackSourceWidth = recordingResult?.recordingArea.width ?? 16;
  const fallbackSourceHeight = recordingResult?.recordingArea.height ?? 9;
  const [metadataDimensions, setMetadataDimensions] = useState<{
    filePath: string;
    width: number;
    height: number;
  } | null>(null);
  const sourceDimensions =
    metadataDimensions && metadataDimensions.filePath === recordingResult?.filePath
      ? { width: metadataDimensions.width, height: metadataDimensions.height }
      : { width: fallbackSourceWidth, height: fallbackSourceHeight };
  // During crop editing, size the container to the full source ratio (matching the
  // Pixi canvas which expands to full source). After editing, use the confirmed
  // canvas ratio (for 'original' AR this is the crop's aspect ratio, not the source).
  const previewAspectRatio = isCropEditing
    ? resolveAspectRatioValue(frame.aspectRatioId, sourceDimensions.width, sourceDimensions.height)
    : (() => {
        const g = getFrameGeometry(frame, sourceDimensions.width, sourceDimensions.height);
        return g.canvasWidth / Math.max(g.canvasHeight, 1);
      })();
  const containerRef = useRef<HTMLDivElement>(null);

  usePixiRenderer(canvasRef, videoRef, recordingResult);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !recordingResult?.filePath) {
      return;
    }

    const updateFromMetadata = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setMetadataDimensions({
          filePath: recordingResult.filePath,
          width: video.videoWidth,
          height: video.videoHeight,
        });
      }
    };

    let repairing = false;
    const handleError = () => {
      const err = video.error;
      window.screenforge.writeDiagnosticLog('canvas-preview.video-error', {
        filePath: recordingResult.filePath,
        currentSrc: video.currentSrc,
        readyState: video.readyState,
        networkState: video.networkState,
        error: err ? { code: err.code, message: err.message } : null,
      });

      // code 3 = MEDIA_ERR_DECODE — VT -12909 from a corrupt concat stream.
      // Re-encode the file in-place to a clean H.264 stream, then reload.
      if (err?.code === 3 && !repairing) {
        repairing = true;
        window.screenforge.writeDiagnosticLog('canvas-preview.video-repair-start', {
          filePath: recordingResult.filePath,
        });
        window.screenforge
          .reencodeRecording(recordingResult.filePath)
          .then(() => {
            window.screenforge.writeDiagnosticLog('canvas-preview.video-repair-done', {
              filePath: recordingResult.filePath,
            });
            video.load();
          })
          .catch((repairErr: unknown) => {
            window.screenforge.writeDiagnosticLog('canvas-preview.video-repair-failed', {
              filePath: recordingResult.filePath,
              message: repairErr instanceof Error ? repairErr.message : String(repairErr),
            });
          })
          .finally(() => {
            repairing = false;
          });
      }
    };

    if (video.readyState >= 1) {
      updateFromMetadata();
    }

    video.addEventListener('loadedmetadata', updateFromMetadata);
    video.addEventListener('error', handleError);
    return () => {
      video.removeEventListener('loadedmetadata', updateFromMetadata);
      video.removeEventListener('error', handleError);
    };
  }, [videoRef, recordingResult?.filePath]);

  return (
    <div
      className="relative flex min-h-[220px] flex-1 items-center justify-center overflow-hidden bg-sf-bg"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={focusMode ? t('exitFocusMode') : t('focusMode')}
            onClick={() => setFocusMode(!focusMode)}
            className="absolute top-2 right-2 z-20 size-7 rounded-md text-sf-secondary/60 hover:text-sf-primary hover:bg-white/8 transition-colors"
          >
            {focusMode ? (
              <Minimize2 className="size-3.5" strokeWidth={1.8} />
            ) : (
              <Maximize2 className="size-3.5" strokeWidth={1.8} />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {focusMode ? t('exitFocusMode') : t('focusMode')}
        </TooltipContent>
      </Tooltip>
      {isProcessing && !recordingResult ? (
        <ProcessingOverlay />
      ) : recordingResult ? (
        <>
          {/* Off-screen video — source of truth for playback controls and frame decoding.
               Must NOT use display:none — Chromium skips frame decoding for hidden elements,
               making ctx.drawImage() produce blank frames.
               Sized to fill the container (visibility:hidden keeps it invisible without
               affecting Chromium's decode-buffer allocation heuristics, which shrink
               the buffer for 1×1 elements and cause first-play stutter). */}
          <video
            ref={videoRef}
            // screenforge:// is cross-origin to the app page; CORS mode keeps
            // the frames untainted so the WebGL preview can upload them.
            crossOrigin="anonymous"
            src={createScreenforgeFileUrl(recordingResult.filePath)}
            preload="auto"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              visibility: 'hidden',
              pointerEvents: 'none',
            }}
          />
          {/* Visible canvas — renders video frame + all effect layers */}
          <div
            ref={containerRef}
            className="relative h-auto w-full max-h-full max-w-full shrink-0"
            style={{
              aspectRatio: `${previewAspectRatio}`,
            }}
            onPointerDown={(e) => {
              if (e.target === canvasRef.current) {
                setActiveWidget('frame');
              }
            }}
          >
            <canvas
              ref={canvasRef}
              className="block h-full w-full max-h-full max-w-full"
              style={{ objectFit: 'contain' }}
            />
            {isGapPlayback && <div className="pointer-events-none absolute inset-0 bg-black" />}
            {isCropEditing && (
              <FrameCropOverlay
                containerRef={containerRef}
                sourceWidth={sourceDimensions.width}
                sourceHeight={sourceDimensions.height}
              />
            )}
            {!isCropEditing && (
              <CameraOverlayEditor containerRef={containerRef} canvasRef={canvasRef} />
            )}
            <MaskOverlayEditor containerRef={containerRef} canvasRef={canvasRef} />
            <TextOverlayEditor containerRef={containerRef} canvasRef={canvasRef} />
            <AnimatePresence>
              {isFlashing && (
                <motion.div
                  key="flash"
                  className="pointer-events-none absolute inset-0 z-30 bg-white"
                  initial={{ opacity: 0.55 }}
                  animate={{ opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {isHovered && recordingResult && (
                <motion.div
                  key="capture-btn"
                  className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => void handleCapture()}
                        className="cursor-pointer flex items-center justify-center size-9 rounded-md border border-white/[0.12] bg-black/45 backdrop-blur-sm text-white/60 hover:text-white/90 hover:bg-black/60 transition-colors focus-visible:outline-none active:scale-95"
                        aria-label={t('captureFrame')}
                      >
                        <IconCamera size={16} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{t('captureFrame')}</TooltipContent>
                  </Tooltip>
                </motion.div>
              )}
            </AnimatePresence>
            {metadataDimensions && metadataDimensions.filePath === recordingResult.filePath && (
              <div className="pointer-events-none absolute bottom-2 right-2 z-10">
                <div className="flex items-center gap-1 rounded border border-white/[0.07] bg-black/40 px-1.5 py-[3px] backdrop-blur-sm">
                  <span className="tabular-nums text-xs leading-none tracking-[0.02em] text-white/40">
                    {metadataDimensions.width}&thinsp;×&thinsp;{metadataDimensions.height}
                  </span>
                </div>
              </div>
            )}
            <div className="absolute bottom-2 left-2 z-10">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="flex items-center gap-1 rounded border border-white/[0.07] bg-black/40 px-1.5 py-[3px] backdrop-blur-sm cursor-default focus-visible:outline-none"
                    aria-label={t('previewQualityInfo')}
                  >
                    <IconInfo size={12} color="rgba(255,255,255,0.35)" stroke={1.8} />
                    <span className="text-xs leading-none tracking-[0.02em] text-white/35">
                      {t('previewLabel')}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[220px] text-center">
                  {t('previewQualityDesc')}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <IconVideo size={40} className="text-sf-muted" />
          <div className="text-lg font-medium text-sf-primary/90">{t('noRecording')}</div>
          <Button
            size="md"
            className="mt-3 gap-1 flex items-center"
            onClick={() => {
              void window.screenforge
                .clearAppendMode()
                .catch(() => undefined)
                .then(() => {
                  window.screenforge.showToolbar();
                });
            }}
          >
            <IconPlus className="fill-white" /> {t('newRecording')}
          </Button>
        </div>
      )}
    </div>
  );
};
