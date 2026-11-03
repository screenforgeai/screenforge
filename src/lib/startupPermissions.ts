import type { PreloadProgress } from '../types';

export function getPreloadPercent(progress: PreloadProgress): number {
  if (progress.total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((progress.completed / progress.total) * 100)));
}
