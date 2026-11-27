type PreviewDrawingListener = (drawing: boolean) => void;

const listeners = new Set<PreviewDrawingListener>();
let drawing = false;

/**
 * Whether the live preview's render loop is running. It runs while the video
 * plays and for a moment after any change; paused and settled, it sleeps and
 * leaves the GPU idle. The background pre-render paces itself by this.
 */
export function isPreviewDrawing(): boolean {
  return drawing;
}

/** Called by the preview loop as it wakes (true) and goes to sleep (false). */
export function setPreviewDrawing(next: boolean): void {
  if (next === drawing) {
    return;
  }
  drawing = next;
  for (const listener of listeners) {
    listener(next);
  }
}

/** Calls `listener` whenever the preview starts or stops drawing; returns the unsubscribe. */
export function onPreviewDrawingChanged(listener: PreviewDrawingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
