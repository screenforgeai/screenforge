import { describe, expect, it } from 'vitest';
import type { RecordingResult } from '../../../types/index';
import { getClickEvents, getMoveEvents } from '../cursor/analyze';
import { getZoomCrop, toCropSpacePoint, toCropSpaceRecording } from './crop-space';
import { DEFAULT_FRAME } from '../frame';

const display = { x: 0, y: 0, width: 1512, height: 982 };
// The selected area: x 302–1058, y 196–687 on the display.
const crop = {
  x: 302 / 1512,
  y: 196 / 982,
  width: 756 / 1512,
  height: 491 / 982,
};

function recording(overrides: Partial<RecordingResult> = {}): RecordingResult {
  return {
    filePath: 'fixture.mp4',
    duration: 4,
    startTime: 1_000,
    recordingArea: display,
    mouseData: [
      { type: 'move', x: 302, y: 196, timestamp: 1_000 },
      { type: 'move', x: 680, y: 441.5, timestamp: 1_100 },
      { type: 'move', x: 1058, y: 687, timestamp: 1_200 },
      { type: 'move', x: 1300, y: 900, timestamp: 1_300 },
      { type: 'mousedown', x: 680, y: 441.5, timestamp: 1_150 },
    ],
    ...overrides,
  } as RecordingResult;
}

describe('toCropSpacePoint', () => {
  it('maps the crop corners and centre to 0, 1 and 0.5', () => {
    expect(toCropSpacePoint({ nx: crop.x, ny: crop.y }, crop)).toEqual({ nx: 0, ny: 0 });
    const centre = toCropSpacePoint(
      { nx: crop.x + crop.width / 2, ny: crop.y + crop.height / 2 },
      crop,
    );
    expect(centre.nx).toBeCloseTo(0.5, 12);
    expect(centre.ny).toBeCloseTo(0.5, 12);
    const corner = toCropSpacePoint({ nx: crop.x + crop.width, ny: crop.y + crop.height }, crop);
    expect(corner.nx).toBeCloseTo(1, 12);
    expect(corner.ny).toBeCloseTo(1, 12);
  });

  it('leaves points outside the crop outside 0–1', () => {
    const outside = toCropSpacePoint({ nx: 1300 / 1512, ny: 900 / 982 }, crop);
    expect(outside.nx).toBeGreaterThan(1);
    expect(outside.ny).toBeGreaterThan(1);
  });

  it('is the identity without a crop', () => {
    const point = { nx: 0.3, ny: 0.7 };
    expect(toCropSpacePoint(point, { x: 0, y: 0, width: 1, height: 1 })).toBe(point);
  });
});

describe('toCropSpaceRecording', () => {
  it('gives zoom analysis the same positions as converting the cursor', () => {
    const source = recording();
    const cropped = toCropSpaceRecording(source, crop);
    const moves = getMoveEvents(source.mouseData, source.startTime, source.recordingArea);
    const croppedMoves = getMoveEvents(cropped.mouseData, cropped.startTime, cropped.recordingArea);
    expect(croppedMoves).toHaveLength(moves.length);
    croppedMoves.forEach((move, i) => {
      const expected = toCropSpacePoint(moves[i], crop);
      expect(move.nx).toBeCloseTo(expected.nx, 9);
      expect(move.ny).toBeCloseTo(expected.ny, 9);
    });

    const [click] = getClickEvents(cropped.mouseData, cropped.startTime, cropped.recordingArea);
    expect(click.nx).toBeCloseTo(0.5, 9);
    expect(click.ny).toBeCloseTo(0.5, 9);
  });

  it('narrows every window bounds sample to the crop', () => {
    const source = recording({
      captureBoundsTimeline: [
        { x: 100, y: 50, width: 1000, height: 800, timestamp: 1_000 },
        { x: 200, y: 50, width: 1000, height: 800, timestamp: 1_200, scaleFactor: 2 },
      ],
    });
    const cropped = toCropSpaceRecording(source, {
      x: 0.25,
      y: 0.5,
      width: 0.5,
      height: 0.25,
    });
    expect(cropped.captureBoundsTimeline).toEqual([
      { x: 350, y: 450, width: 500, height: 200, timestamp: 1_000 },
      { x: 450, y: 450, width: 500, height: 200, timestamp: 1_200, scaleFactor: 2 },
    ]);
  });

  it('returns the recording unchanged without a crop', () => {
    const source = recording();
    expect(toCropSpaceRecording(source, { x: 0, y: 0, width: 1, height: 1 })).toBe(source);
  });
});

describe('getZoomCrop', () => {
  const frame = { ...DEFAULT_FRAME, cropRect: crop };

  it('is the frame crop', () => {
    expect(getZoomCrop({ frame })).toBe(crop);
  });

  it('is the whole recording while the crop is being edited, as the preview shows', () => {
    expect(getZoomCrop({ frame, isCropEditing: true })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
});
