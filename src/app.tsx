import { useEffect, useRef, useState, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AnimatePresence, motion } from 'motion/react';
import { WidgetLibrary } from './components/WidgetLibrary/WidgetLibrary';
import { Canvas } from './components/Canvas/Canvas';
import { TopNav } from './components/TopNav';
import {
  ProjectPersistenceProvider,
  useProjectPersistence,
} from './components/ProjectPersistenceProvider';
import { Toaster } from 'sonner';
import { useStore } from './store';
import { getToastStyle, getToasterStyle, TOASTER_TOAST_CLASSNAMES } from './lib/toast';
import { FFmpegSetupModal } from './components/FFmpegSetupModal';
import { trackEvent } from './lib/analytics';
import i18n from './i18n';
import { DEFAULT_CLIP_TRANSITION } from './types/timeline';

type AppShellProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  previewCanvasRef: RefObject<HTMLCanvasElement | null>;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unknown error';
}

const AppShell = ({ videoRef, previewCanvasRef }: AppShellProps) => {
  const { beginNewRecording } = useProjectPersistence();
  const {
    setIsProcessing,
    setSavedProjects,
    setActiveWidget,
    incrementRecordingCount,
    loadRecordingSession,
    focusMode,
    isAppendMode,
    appendStartTime,
    appendRecordingSession,
    setProcessingSegment,
    recordingResult,
    mediaSegments,
    cameraMediaSegments,
    cameraClips,
    camera,
  } = useStore(
    useShallow((s) => ({
      setIsProcessing: s.setIsProcessing,
      setSavedProjects: s.setSavedProjects,
      setActiveWidget: s.setActiveWidget,
      incrementRecordingCount: s.incrementRecordingCount,
      loadRecordingSession: s.loadRecordingSession,
      focusMode: s.focusMode,
      isAppendMode: s.isAppendMode,
      appendStartTime: s.appendStartTime,
      appendRecordingSession: s.appendRecordingSession,
      setProcessingSegment: s.setProcessingSegment,
      recordingResult: s.recordingResult,
      mediaSegments: s.mediaSegments,
      cameraMediaSegments: s.cameraMediaSegments,
      cameraClips: s.cameraClips,
      camera: s.camera,
    })),
  );

  const [ffmpegMissing, setFfmpegMissing] = useState(false);

  useEffect(() => {
    trackEvent('app_opened');
    window.screenforge.getSettings().then((settings) => {
      const { name, email } = settings.profile;
      if (name || email) {
        window.screenforge.identifyUser({ name: name || undefined, email: email || undefined });
      }
      if (settings.language && settings.language !== i18n.language) {
        void i18n.changeLanguage(settings.language);
      }
    });
  }, []);

  useEffect(() => {
    window.screenforge.checkFFmpegStatus().then(({ available }) => {
      if (!available) {
        setFfmpegMissing(true);
        trackEvent('ffmpeg_missing_shown');
      }
    });
  }, []);

  useEffect(() => {
    return window.screenforge.onRecordingProcessing(() => {
      window.screenforge.writeDiagnosticLog('app.recording-processing.received');
      const state = useStore.getState();
      if (!state.isAppendMode) {
        state.setRecordingResult(null);
      }
      setIsProcessing(true);
    });
  }, [setIsProcessing]);

  useEffect(() => {
    return window.screenforge.onRecordingLoad(async (result) => {
      window.screenforge.writeDiagnosticLog('app.recording-load.received', {
        duration: result.duration,
      });
      try {
        if (isAppendMode && recordingResult) {
          const existingDuration = recordingResult.duration;
          const appendTimelineStartPreview = appendStartTime ?? existingDuration;
          setProcessingSegment({
            timelineStart: appendTimelineStartPreview,
            timelineEnd: appendTimelineStartPreview + result.duration,
          });
          const [mergedPath, mergedCameraPath] = await Promise.all([
            window.screenforge.concatRecordings(recordingResult.filePath, result.filePath),
            recordingResult.cameraPath && result.cameraPath
              ? window.screenforge.concatRecordings(recordingResult.cameraPath, result.cameraPath)
              : Promise.resolve(result.cameraPath ?? recordingResult.cameraPath ?? undefined),
          ]);

          // Probe the actual merged file to get a frame-accurate source boundary.
          // existingDuration is a running sum of probed durations; each -r 30
          // re-encode can round by up to one frame (33 ms), and the error
          // accumulates across multiple append sessions.
          const [mergedProbe, mergedCameraProbe] = await Promise.all([
            window.screenforge.probeExportSource(mergedPath).catch(() => null),
            mergedCameraPath && recordingResult.cameraPath && result.cameraPath
              ? window.screenforge.probeExportSource(mergedCameraPath).catch(() => null)
              : Promise.resolve(null),
          ]);
          const actualMergedDuration = mergedProbe?.duration ?? existingDuration + result.duration;
          const newSegmentSourceStart = actualMergedDuration - result.duration;

          // Both recordings' audio ends up embedded in mergedPath via concatRecordings.
          // If either recording had explicit audio (mic), update audioPath to the merged
          // video so the timeline audio lane renders clips at the correct source offsets.
          const hadExplicitAudio = Boolean(recordingResult.audioPath || result.audioPath);
          const mergedResult = {
            ...recordingResult,
            filePath: mergedPath,
            cameraPath: mergedCameraPath,
            duration: actualMergedDuration,
            ...(hadExplicitAudio ? { audioPath: mergedPath, hasEmbeddedAudio: true as const } : {}),
            mouseData: [
              ...recordingResult.mouseData,
              ...result.mouseData.map((e) => ({
                ...e,
                // Normalize from session-2 epoch time to session-1 epoch time,
                // then shift by existingDuration so events land at the correct
                // source-time range in the concatenated video.
                timestamp:
                  e.timestamp -
                  result.startTime +
                  recordingResult.startTime +
                  existingDuration * 1000,
              })),
            ],
          };
          const appendTimelineStart = appendStartTime ?? existingDuration;
          const newSegment = {
            id: `video-segment-append-${Date.now()}`,
            timelineStart: appendTimelineStart,
            timelineEnd: appendTimelineStart + result.duration,
            sourceStart: newSegmentSourceStart,
            sourceEnd: actualMergedDuration,
            videoEnabled: true as const,
            audioEnabled: true,
            transitionIn: DEFAULT_CLIP_TRANSITION,
          };
          const appendedEnd = appendTimelineStart + result.duration;
          const cameraRangeAlreadyCovered = cameraClips.some(
            (c) => c.start <= appendTimelineStart && c.end >= appendedEnd,
          );
          const nextCameraClips =
            result.cameraPath && !cameraRangeAlreadyCovered
              ? [
                  ...cameraClips,
                  {
                    id: `camera-append-${Date.now()}`,
                    start: appendTimelineStart,
                    end: appendedEnd,
                    x: camera.x,
                    y: camera.y,
                    size: camera.size,
                  },
                ]
              : cameraClips;

          // Build camera-specific media segments so camera source time is
          // resolved against the camera file, not the main video file.
          // When only one session has camera, the files are NOT concatenated,
          // so source offsets differ from the main video segments.
          let nextCameraMediaSegments = cameraMediaSegments;
          if (recordingResult.cameraPath && result.cameraPath) {
            // Both sessions had camera — files are concatenated. New camera
            // segment continues from where the existing camera file ends.
            const existingCameraSourceEnd =
              cameraMediaSegments.length > 0
                ? Math.max(...cameraMediaSegments.map((s) => s.sourceEnd))
                : existingDuration;
            const actualCameraMergedDuration =
              mergedCameraProbe?.duration ?? existingCameraSourceEnd + result.duration;
            nextCameraMediaSegments = [
              ...cameraMediaSegments,
              {
                id: `camera-segment-append-${Date.now()}`,
                timelineStart: appendTimelineStart,
                timelineEnd: appendedEnd,
                sourceStart: actualCameraMergedDuration - result.duration,
                sourceEnd: actualCameraMergedDuration,
                videoEnabled: true as const,
                audioEnabled: true,
              },
            ];
          } else if (result.cameraPath && !recordingResult.cameraPath) {
            // Only the new session has camera — camera file starts at 0.
            nextCameraMediaSegments = [
              {
                id: `camera-segment-append-${Date.now()}`,
                timelineStart: appendTimelineStart,
                timelineEnd: appendedEnd,
                sourceStart: 0,
                sourceEnd: result.duration,
                videoEnabled: true as const,
                audioEnabled: true,
              },
            ];
          }
          // If only the first session had camera (result.cameraPath is null),
          // cameraMediaSegments stays unchanged.

          appendRecordingSession(
            mergedResult,
            [...mediaSegments, newSegment],
            nextCameraClips,
            nextCameraMediaSegments,
          );
          trackEvent('recording_appended', {
            duration_seconds: Math.round(result.duration),
            total_duration_seconds: Math.round(existingDuration + result.duration),
          });
          window.screenforge.writeDiagnosticLog('app.recording-load.appended');
        } else {
          setIsProcessing(false);
          loadRecordingSession(result);
          incrementRecordingCount();
          setActiveWidget('frame');
          beginNewRecording();
          window.screenforge.writeDiagnosticLog('app.recording-load.applied');
        }
        setIsProcessing(false);
      } catch (error) {
        const message = getErrorMessage(error);
        window.screenforge.writeDiagnosticLog('app.recording-load.failed', { message });
        setProcessingSegment(null);
        setIsProcessing(false);
        window.screenforge.systemWarning(
          `Failed to load the recording. Please check the Screenforge log file.\n${message}`,
        );
      }
    });
  }, [
    appendRecordingSession,
    appendStartTime,
    beginNewRecording,
    camera.size,
    camera.x,
    camera.y,
    cameraClips,
    cameraMediaSegments,
    incrementRecordingCount,
    isAppendMode,
    loadRecordingSession,
    mediaSegments,
    recordingResult,
    setActiveWidget,
    setIsProcessing,
    setProcessingSegment,
  ]);

  useEffect(() => {
    return window.screenforge.onRecordingFailed((message) => {
      window.screenforge.writeDiagnosticLog('app.recording-failed.received', { message });
      setIsProcessing(false);
      window.screenforge.systemWarning(message);
    });
  }, [setIsProcessing]);

  useEffect(() => {
    return window.screenforge.onImportTriggeredFromTray((result) => {
      loadRecordingSession(result);
      incrementRecordingCount();
      setActiveWidget('frame');
      beginNewRecording();
      trackEvent('video_imported', { source: 'tray' });
    });
  }, [loadRecordingSession, incrementRecordingCount, setActiveWidget, beginNewRecording]);

  useEffect(() => {
    window.screenforge.getProjects().then(setSavedProjects);
  }, [setSavedProjects]);

  return (
    <>
      <main className="flex flex-col h-screen overflow-hidden bg-sf-bg font-sans text-sf-primary">
        <TopNav onOpenFFmpegSetup={() => setFfmpegMissing(true)} />
        <div className="flex w-full flex-1 min-h-0 overflow-hidden">
          <AnimatePresence initial={false}>
            {!focusMode && (
              <motion.div
                key="sidebar"
                initial={{ width: 0 }}
                animate={{ width: 346 }}
                exit={{ width: 0 }}
                transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                className="flex overflow-hidden shrink-0 h-full"
              >
                <WidgetLibrary />
              </motion.div>
            )}
          </AnimatePresence>
          <Canvas videoRef={videoRef} canvasRef={previewCanvasRef} />
        </div>
      </main>
      <Toaster
        theme="dark"
        richColors={false}
        position="top-center"
        offset={{ top: 16 }}
        mobileOffset={{ top: 16 }}
        visibleToasts={1}
        style={getToasterStyle()}
        toastOptions={{
          duration: 2200,
          style: getToastStyle(),
          classNames: TOASTER_TOAST_CLASSNAMES,
        }}
      />
      <FFmpegSetupModal open={ffmpegMissing} onReady={() => setFfmpegMissing(false)} />
    </>
  );
};

const App = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  return (
    <ProjectPersistenceProvider videoRef={videoRef} canvasRef={previewCanvasRef}>
      <AppShell videoRef={videoRef} previewCanvasRef={previewCanvasRef} />
    </ProjectPersistenceProvider>
  );
};

export default App;
