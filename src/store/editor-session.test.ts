import { describe, expect, it } from 'vitest';
import type { RecordingResult } from '../types/index';
import { DEFAULT_FRAME, getFrameGeometry } from '../lib/effects/frame';
import { createRecordingSession } from './editor-session';

function recording(overrides: Partial<RecordingResult> = {}): RecordingResult {
  return {
    filePath: 'fixture.mp4',
    mouseData: [],
    duration: 5,
    startTime: 1_000,
    recordingArea: { x: 0, y: 0, width: 1512, height: 982 },
    ...overrides,
  };
}

describe('createRecordingSession', () => {
  it('opens an area recording cropped to exactly the selected pixels', () => {
    const session = createRecordingSession(
      recording({
        areaCrop: {
          x: 302,
          y: 196,
          width: 1201,
          height: 803,
          sourceWidth: 3024,
          sourceHeight: 1964,
        },
      }),
    );

    expect(session.frame.aspectRatioId).toBe('original');
    expect(session.frame.background).toEqual(DEFAULT_FRAME.background);
    const geometry = getFrameGeometry(session.frame, 3024, 1964);
    expect(geometry.cropRectPixels).toEqual({ x: 302, y: 196, width: 1201, height: 803 });
    expect([geometry.canvasWidth, geometry.canvasHeight]).toEqual([1201, 803]);
  });

  it('leaves other recordings uncropped', () => {
    expect(createRecordingSession(recording()).frame.cropRect).toEqual(DEFAULT_FRAME.cropRect);
  });

  it('does not share the default frame object', () => {
    const session = createRecordingSession(
      recording({
        areaCrop: { x: 0, y: 0, width: 100, height: 100, sourceWidth: 200, sourceHeight: 200 },
      }),
    );
    expect(session.frame.background).not.toBe(DEFAULT_FRAME.background);
  });
});
