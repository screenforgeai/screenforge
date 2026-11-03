import { useEffect, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

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
    { preventDefault: true, enableOnFormTags: false },
    [],
  );

  useHotkeys(
    'meta+a, ctrl+a',
    () => {
      blurFocusedButtonOrAction();
      callbacksRef.current.onSelectAll();
    },
    { preventDefault: true },
    [],
  );

  useHotkeys(
    'meta+b, ctrl+b',
    () => {
      blurFocusedButtonOrAction();
      callbacksRef.current.onSplitAtPlayhead();
    },
    { preventDefault: true },
    [],
  );

  useHotkeys(
    'meta+shift+z, ctrl+shift+z, ctrl+y',
    () => {
      blurFocusedButtonOrAction();
      callbacksRef.current.onRedo();
    },
    { preventDefault: true },
    [],
  );

  useHotkeys(
    'meta+z, ctrl+z',
    () => {
      blurFocusedButtonOrAction();
      callbacksRef.current.onUndo();
    },
    { preventDefault: true },
    [],
  );

  useHotkeys('escape', () => callbacksRef.current.onClearSelection(), {}, []);

  useHotkeys(
    'delete, backspace',
    () => {
      blurFocusedButtonOrAction();
      callbacksRef.current.onDeleteSelected();
    },
    { preventDefault: true },
    [],
  );

  useHotkeys('z', () => callbacksRef.current.onAddZoom(), { preventDefault: true }, []);

  useHotkeys(
    'shift+z',
    () => callbacksRef.current.onAddCinematicZoom(),
    { preventDefault: true },
    [],
  );

  useHotkeys('t', () => callbacksRef.current.onAddText(), { preventDefault: true }, []);

  useHotkeys('m', () => callbacksRef.current.onAddMask(), { preventDefault: true }, []);
}
