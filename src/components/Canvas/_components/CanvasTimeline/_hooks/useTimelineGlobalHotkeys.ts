import { useEffect, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useStore } from 'src/store';

interface TimelineHotkeys {
  onTogglePlay: () => void;
  onSplitAtPlayhead: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelected: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onAddZoom: () => void;
  onAddCinematicZoom: () => void;
  onAddText: () => void;
  onAddMask: () => void;
}

function blurFocusedButtonOrAction(): void {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) {
    return;
  }

  const isButtonLike = Boolean(activeElement.closest('button, [role="button"], a[href]'));
  const isTimelineAction = Boolean(activeElement.closest('.timeline-editor-action'));
  if (isButtonLike || isTimelineAction) {
    activeElement.blur();
  }
}

// The Screenshot editor overlays the timeline; its keys (Delete, Cmd+Z, T…)
// must not also edit the video underneath.
const isTimelineFocusable = () => useStore.getState().screenshotCapture === null;

export function useTimelineGlobalHotkeys(callbacks: TimelineHotkeys): void {
  const callbacksRef = useRef<TimelineHotkeys>(callbacks);

  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  useHotkeys(
    'space',
    () => {
      blurFocusedButtonOrAction();
      callbacksRef.current.onTogglePlay();
    },
    { preventDefault: true, enableOnFormTags: false, enabled: isTimelineFocusable },
    [],
  );

  useHotkeys(
    'meta+a, ctrl+a',
    () => {
      blurFocusedButtonOrAction();
      callbacksRef.current.onSelectAll();
    },
    { preventDefault: true, enabled: isTimelineFocusable },
    [],
  );

  useHotkeys(
    'meta+b, ctrl+b',
    () => {
      blurFocusedButtonOrAction();
      callbacksRef.current.onSplitAtPlayhead();
    },
    { preventDefault: true, enabled: isTimelineFocusable },
    [],
  );

  useHotkeys(
    'meta+shift+z, ctrl+shift+z, ctrl+y',
    () => {
      blurFocusedButtonOrAction();
      callbacksRef.current.onRedo();
    },
    { preventDefault: true, enabled: isTimelineFocusable },
    [],
  );

  useHotkeys(
    'meta+z, ctrl+z',
    () => {
      blurFocusedButtonOrAction();
      callbacksRef.current.onUndo();
    },
    { preventDefault: true, enabled: isTimelineFocusable },
    [],
  );

  useHotkeys(
    'escape',
    () => callbacksRef.current.onClearSelection(),
    { enabled: isTimelineFocusable },
    [],
  );

  useHotkeys(
    'delete, backspace',
    () => {
      blurFocusedButtonOrAction();
      callbacksRef.current.onDeleteSelected();
    },
    { preventDefault: true, enabled: isTimelineFocusable },
    [],
  );

  useHotkeys(
    'z',
    () => callbacksRef.current.onAddZoom(),
    { preventDefault: true, enabled: isTimelineFocusable },
    [],
  );

  useHotkeys(
    'shift+z',
    () => callbacksRef.current.onAddCinematicZoom(),
    { preventDefault: true, enabled: isTimelineFocusable },
    [],
  );

  useHotkeys(
    't',
    () => callbacksRef.current.onAddText(),
    { preventDefault: true, enabled: isTimelineFocusable },
    [],
  );

  useHotkeys(
    'm',
    () => callbacksRef.current.onAddMask(),
    { preventDefault: true, enabled: isTimelineFocusable },
    [],
  );
}
