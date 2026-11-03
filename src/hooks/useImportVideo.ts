import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { useProjectPersistence } from '../components/ProjectPersistenceProvider';
import { DEFAULT_CLIP_TRANSITION } from '../types/timeline';
import { trackEvent } from '../lib/analytics';

export const useImportVideo = () => {
  const [isImporting, setIsImporting] = useState(false);
  const { beginNewRecording } = useProjectPersistence();

  const {
    recordingResult,
    mediaSegments,
    loadRecordingSession,
    appendRecordingSession,
    incrementRecordingCount,
    setActiveWidget,
    setProcessingSegment,
  } = useStore(
    useShallow((s) => ({
      recordingResult: s.recordingResult,
      mediaSegments: s.mediaSegments,
      loadRecordingSession: s.loadRecordingSession,
      appendRecordingSession: s.appendRecordingSession,
      incrementRecordingCount: s.incrementRecordingCount,
      setActiveWidget: s.setActiveWidget,
      setProcessingSegment: s.setProcessingSegment,
    })),
  );

  const importAsNewProject = useCallback(async () => {
    if (isImporting) {
      return;
    }
    setIsImporting(true);
    try {
      const result = await window.screenforge.importVideo();
      if (!result) {
        return;
      }
      loadRecordingSession(result);
      incrementRecordingCount();
      setActiveWidget('frame');
      beginNewRecording();
      trackEvent('video_imported', { source: 'new_project' });
    } catch {
      // dialog cancelled or probe failed — silent
    } finally {
      setIsImporting(false);
    }
  }, [
    isImporting,
    loadRecordingSession,
    incrementRecordingCount,
    setActiveWidget,
    beginNewRecording,
  ]);

  const insertImportedClip = useCallback(
    async (insertTime: number) => {
      if (isImporting || !recordingResult) {
        return;
      }
      setIsImporting(true);
      try {
        const imported = await window.screenforge.importVideoForInsert();
        if (!imported) {
          return;
        }

        setProcessingSegment({
          timelineStart: insertTime,
          timelineEnd: insertTime + imported.duration,
        });

        const mergedPath = await window.screenforge.concatRecordings(
          recordingResult.filePath,
          imported.filePath,
        );

        // Probe the actual merged file duration so sourceStart is frame-accurate.
        // existingDuration is a sum of probed durations and drifts from the real
        // frame-aligned boundary after each -r 30 re-encode.
        const mergedProbe = await window.screenforge
          .probeExportSource(mergedPath)
          .catch(() => null);
        const actualMergedDuration =
          mergedProbe?.duration ?? recordingResult.duration + imported.duration;
        const sourceStart = actualMergedDuration - imported.duration;

        const mergedResult = {
          ...recordingResult,
          filePath: mergedPath,
          duration: actualMergedDuration,
        };

        const newSegment = {
          id: `video-segment-insert-${Date.now()}`,
          timelineStart: insertTime,
          timelineEnd: insertTime + imported.duration,
          sourceStart,
          sourceEnd: actualMergedDuration,
          videoEnabled: true as const,
          audioEnabled: true,
          cursorEnabled: false as const,
          transitionIn: DEFAULT_CLIP_TRANSITION,
        };

        appendRecordingSession(mergedResult, [...mediaSegments, newSegment]);
        trackEvent('video_imported', { source: 'insert_clip' });
      } catch {
        // silent on cancel or concat failure
      } finally {
        setIsImporting(false);
        setProcessingSegment(null);
      }
    },
    [isImporting, recordingResult, mediaSegments, appendRecordingSession, setProcessingSegment],
  );

  return { isImporting, importAsNewProject, insertImportedClip };
};
