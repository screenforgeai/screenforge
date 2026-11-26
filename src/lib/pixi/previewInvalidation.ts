type PreviewInvalidationListener = () => void;

const listeners = new Set<PreviewInvalidationListener>();

/**
 * Asks the live preview to draw again. The preview stops drawing once it is paused and
 * settled, so anything it shows that changes outside the store must call this: an image
 * or font that finishes loading, a camera frame that arrives, a timed sample that ends.
 */
export function invalidatePreview(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Calls `listener` on every invalidatePreview(); returns the unsubscribe. */
export function onPreviewInvalidated(listener: PreviewInvalidationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
