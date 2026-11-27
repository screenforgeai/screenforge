import type { CaptureBackend } from '../../types/index';

export type StopTimeouts = {
  /** Finishing the screen capture (on Windows this includes a full-file remux). */
  videoMs: number;
  micMs: number;
  cameraMs: number;
  /** Copying the video into a new file with the mic track added. */
  audioMergeMs: number;
};

const BASE_MS = 15_000;
// Steps that rewrite the whole video: an hour of capture is up to ~16 GB, so
// allow 100 ms per recorded second (an hour gets 6 minutes, ~45 MB/s).
const FILE_REWRITE_MS_PER_SECOND = 100;
// Wayland transcodes the portal webm to H.264, which can be slower than real time.
const WAYLAND_BASE_MS = 10 * 60_000;
const WAYLAND_TRANSCODE_MS_PER_SECOND = 1_500;
// Mic and camera stream to disk while recording; stopping only flushes the last chunk.
const MIC_STOP_MS = 5_000;
const CAMERA_STOP_MS = 7_000;

/**
 * How long each step of saving a recording may take before it is given up on.
 * These guard against a hang, so they grow with the recording's length rather
 * than cutting off a long take that is still saving normally.
 */
export function getStopTimeouts(durationSeconds: number, backend: CaptureBackend): StopTimeouts {
  const seconds = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  const fileRewriteMs = BASE_MS + seconds * FILE_REWRITE_MS_PER_SECOND;
  return {
    videoMs:
      backend === 'wayland-portal'
        ? WAYLAND_BASE_MS + seconds * WAYLAND_TRANSCODE_MS_PER_SECOND
        : fileRewriteMs,
    micMs: MIC_STOP_MS,
    cameraMs: CAMERA_STOP_MS,
    audioMergeMs: fileRewriteMs,
  };
}
