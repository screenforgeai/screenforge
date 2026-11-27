import { describe, expect, it } from 'vitest';
import { getStopTimeouts } from './stopTimeouts';

describe('getStopTimeouts', () => {
  it('keeps the old limits for short recordings', () => {
    const timeouts = getStopTimeouts(5, 'native');
    expect(timeouts.videoMs).toBeGreaterThanOrEqual(15_000);
    expect(timeouts.videoMs).toBeLessThan(20_000);
    expect(timeouts.audioMergeMs).toBeGreaterThanOrEqual(15_000);
    expect(timeouts.audioMergeMs).toBeLessThan(20_000);
    expect(timeouts.micMs).toBe(5_000);
    expect(timeouts.cameraMs).toBe(7_000);
  });

  // An hour of HEVC is 9–16 GB. Merging the mic copies all of it (and Windows
  // also remuxes it at stop): a fixed 15 s silently dropped the mic, or failed
  // the whole recording, on long takes while the work carried on regardless.
  it('allows steps that rewrite the whole file to scale with the recording', () => {
    const timeouts = getStopTimeouts(60 * 60, 'native');
    // Room for a 16 GB file at ~60 MB/s.
    expect(timeouts.videoMs).toBeGreaterThanOrEqual(5 * 60_000);
    expect(timeouts.audioMergeMs).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it('gives the Wayland transcode at least its old 10 minutes, and more than real time for long takes', () => {
    expect(getStopTimeouts(5, 'wayland-portal').videoMs).toBeGreaterThanOrEqual(10 * 60_000);
    expect(getStopTimeouts(60 * 60, 'wayland-portal').videoMs).toBeGreaterThan(60 * 60_000);
  });

  it('treats a missing or bad length as a short recording', () => {
    expect(getStopTimeouts(Number.NaN, 'native')).toEqual(getStopTimeouts(0, 'native'));
    expect(getStopTimeouts(-10, 'native')).toEqual(getStopTimeouts(0, 'native'));
  });
});
