import * as React from 'react';

/**
 * How many modal dialogs are open right now. Per-frame work that a modal hides
 * (the editor preview's render loop) reads it and stands down, so the modal's
 * open/close animation doesn't fight it for the GPU and main thread.
 *
 * A plain counter rather than store state: changing it re-renders nothing, and
 * the readers poll it from a requestAnimationFrame loop anyway.
 */
let openModals = 0;

/** Marks one modal as open. Call the returned function once it closes. */
export const markModalOpen = (): (() => void) => {
  openModals += 1;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    openModals -= 1;
  };
};

export const isModalOpen = (): boolean => openModals > 0;

/** Counts a dialog as open while `isOpen` is true and it stays mounted. */
export const useModalActivity = (isOpen: boolean): void => {
  React.useEffect(() => (isOpen ? markModalOpen() : undefined), [isOpen]);
};
