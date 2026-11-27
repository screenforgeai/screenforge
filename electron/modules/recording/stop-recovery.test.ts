// @vitest-environment node

// The toolbar runs the stop pipeline in a hidden window. If its renderer dies
// mid-save (an hour of camera used to be one ~2 GB ArrayBuffer), nothing ever
// told the editor, which sat on "Processing" for good while the screen
// recording itself was already on disk. These check the main process can
// finish the stop on its own and hand the video to the editor.

import { describe, expect, it, vi } from 'vitest';
import { createStopRecovery, type StopResult } from './stop-recovery';

const stopResult = (overrides: Partial<StopResult> = {}): StopResult => ({
  events: [{ type: 'move', x: 1, y: 2, timestamp: 10 }],
  startTime: 1_000,
  stopTime: 61_000,
  durationMs: 60_000,
  recordingArea: { x: 0, y: 0, width: 1920, height: 1080 },
  hasEmbeddedAudio: false,
  filePath: '/tmp/screen.mp4',
  ...overrides,
});

describe('createStopRecovery', () => {
  it('passes stops through unchanged', async () => {
    const result = stopResult();
    const stopRecording = vi.fn().mockResolvedValue(result);
    const recovery = createStopRecovery({ stopRecording, isRecordingBusy: () => false });

    await expect(recovery.stop({ webmPath: '/tmp/x.webm' })).resolves.toBe(result);
    expect(stopRecording).toHaveBeenCalledWith({ webmPath: '/tmp/x.webm' });
  });

  it('recovers the video from a stop the toolbar started but never finished', async () => {
    let finish: (value: StopResult) => void = () => undefined;
    const stopRecording = vi.fn(() => new Promise<StopResult>((resolve) => (finish = resolve)));
    const recovery = createStopRecovery({ stopRecording, isRecordingBusy: () => false });

    void recovery.stop();
    const recovered = recovery.recover();
    finish(stopResult({ areaCrop: { x: 1, y: 2, width: 3, height: 4 } as never }));

    await expect(recovered).resolves.toEqual({
      filePath: '/tmp/screen.mp4',
      mouseData: [{ type: 'move', x: 1, y: 2, timestamp: 10 }],
      duration: 60,
      startTime: 1_000,
      recordingArea: { x: 0, y: 0, width: 1920, height: 1080 },
      captureBoundsTimeline: undefined,
      areaCrop: { x: 1, y: 2, width: 3, height: 4 },
      hasEmbeddedAudio: false,
    });
    // The capture was stopped once, by the toolbar.
    expect(stopRecording).toHaveBeenCalledTimes(1);
  });

  it('stops a capture that is still running when the toolbar died before stopping it', async () => {
    const stopRecording = vi.fn().mockResolvedValue(stopResult());
    const recovery = createStopRecovery({ stopRecording, isRecordingBusy: () => true });

    const recovered = await recovery.recover();

    expect(stopRecording).toHaveBeenCalledWith(undefined);
    expect(recovered?.filePath).toBe('/tmp/screen.mp4');
  });

  it('falls back to the stop and start times when the file has no probed duration', async () => {
    const stopRecording = vi.fn().mockResolvedValue(stopResult({ durationMs: 0 }));
    const recovery = createStopRecovery({ stopRecording, isRecordingBusy: () => true });

    await expect(recovery.recover()).resolves.toMatchObject({ duration: 60 });
  });

  it('has nothing to recover once the stop was reset or never happened', async () => {
    const stopRecording = vi.fn().mockResolvedValue(stopResult());
    const recovery = createStopRecovery({ stopRecording, isRecordingBusy: () => false });

    await expect(recovery.recover()).resolves.toBeNull();

    await recovery.stop();
    recovery.reset();
    await expect(recovery.recover()).resolves.toBeNull();
  });

  it('rejects when the stop itself failed', async () => {
    const stopRecording = vi.fn().mockRejectedValue(new Error('nothing was captured'));
    const recovery = createStopRecovery({ stopRecording, isRecordingBusy: () => false });

    await expect(recovery.stop()).rejects.toThrow('nothing was captured');
    await expect(recovery.recover()).rejects.toThrow('nothing was captured');
  });
});
