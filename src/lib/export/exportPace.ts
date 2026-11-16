/**
 * Logs how fast a capture renders while it runs: every `intervalMs`, the frames
 * done so far and the frame rate over that interval, so a slowdown partway
 * through (thermal throttling, a busy GPU, low priority) shows up in the log
 * instead of being averaged away in the final numbers.
 */
export function createExportPace(options: {
  totalFrames: number;
  intervalMs: number;
  emit: (data: Record<string, number>) => void;
  now?: () => number;
}) {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  let lastAt = startedAt;
  let lastFrames = 0;

  return {
    /** `frames` rendered so far; `stats` are running totals in ms, logged rounded. */
    sample(frames: number, stats: Record<string, number> = {}): void {
      const at = now();
      if (at - lastAt < options.intervalMs) {
        return;
      }
      const fps = (frames - lastFrames) / ((at - lastAt) / 1000);
      lastAt = at;
      lastFrames = frames;
      const rounded: Record<string, number> = {};
      for (const [name, value] of Object.entries(stats)) {
        rounded[name] = Math.round(value);
      }
      options.emit({
        frames,
        of: options.totalFrames,
        fps: Math.round(fps * 10) / 10,
        elapsedS: Math.round((at - startedAt) / 100) / 10,
        ...rounded,
      });
    },
  };
}
