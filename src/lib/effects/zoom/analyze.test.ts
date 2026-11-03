import { describe, expect, it } from 'vitest';
import type {
  CursorEvent,
  KeyCategory,
  RecordingArea,
  RecordingResult,
} from '../../../types/index';
import { ADD_ZOOM_MIN_CONFIDENCE, detectZoomClips, inferZoomDefaultsAtTime } from './analyze';

const START_TIME = 1_000;

function move(t: number, nx: number, ny: number): CursorEvent {
  return {
    type: 'move',
    x: nx * 1000,
    y: ny * 1000,
    timestamp: START_TIME + t * 1000,
  };
}

function click(
  t: number,
  nx: number,
  ny: number,
  button: string | number | undefined = undefined,
): CursorEvent {
  return {
    type: 'mousedown',
    x: nx * 1000,
    y: ny * 1000,
    button,
    timestamp: START_TIME + t * 1000,
  };
}

function keydown(t: number, keyCategory: KeyCategory = 'character'): CursorEvent {
  return {
    type: 'keydown',
    keyCategory,
    modifiers: { meta: false, ctrl: false, alt: false, shift: false },
    timestamp: START_TIME + t * 1000,
  };
}

function makeRecording(
  events: CursorEvent[],
  recordingArea: RecordingArea = { x: 0, y: 0, width: 1000, height: 1000 },
): RecordingResult {
  return {
    filePath: 'fixture.mp4',
    mouseData: [...events].sort((a, b) => a.timestamp - b.timestamp),
    duration: 10,
    startTime: START_TIME,
    recordingArea,
  };
}

describe('detectZoomClips', () => {
  it('produces a tighter, stronger zoom for dense repeated interactions', () => {
    const recording = makeRecording([
      move(0.35, 0.46, 0.48),
      move(0.55, 0.48, 0.49),
      move(0.75, 0.495, 0.5),
      click(1.0, 0.5, 0.5),
      move(1.1, 0.501, 0.499),
      click(1.28, 0.503, 0.5),
      move(1.45, 0.502, 0.501),
      move(1.7, 0.5, 0.5),
      move(2.4, 0.7, 0.72),
    ]);

    const [clip] = detectZoomClips(recording);
    expect(clip).toBeTruthy();
    expect(clip.scale).toBeGreaterThan(2.1);
    expect(Math.abs(clip.cx - 0.5)).toBeLessThan(0.03);
    expect(clip.start).toBeLessThan(1);
  });

  it('backs off scale for broader interaction regions', () => {
    const recording = makeRecording([
      move(0.4, 0.22, 0.2),
      click(0.8, 0.22, 0.2),
      move(1.1, 0.3, 0.26),
      click(1.5, 0.34, 0.31),
      move(1.9, 0.4, 0.38),
      click(2.2, 0.46, 0.42),
      move(2.5, 0.48, 0.45),
      move(3.2, 0.66, 0.58),
    ]);

    const [clip] = detectZoomClips(recording);
    expect(clip).toBeTruthy();
    expect(clip.scale).toBeGreaterThanOrEqual(1.4);
    expect(clip.scale).toBeLessThan(2.2);
  });

  it('merges rapid neighboring click clusters into one sustained zoom clip', () => {
    const recording = makeRecording([
      move(0.4, 0.27, 0.41),
      move(0.75, 0.285, 0.42),
      click(1.0, 0.29, 0.42),
      move(1.25, 0.3, 0.425),
      move(1.55, 0.48, 0.43),
      move(1.75, 0.54, 0.44),
      click(1.95, 0.56, 0.44),
      move(2.15, 0.57, 0.442),
      move(2.6, 0.62, 0.47),
    ]);

    const clips = detectZoomClips(recording);
    expect(clips).toHaveLength(1);
    expect(clips[0].start).toBeLessThan(1.0);
    expect(clips[0].end).toBeGreaterThan(1.95);
  });

  it('never emits separate zoom clips for temporally close clicks', () => {
    const recording = makeRecording([
      move(0.45, 0.2, 0.28),
      click(0.8, 0.22, 0.3),
      move(1.1, 0.48, 0.4),
      move(1.35, 0.68, 0.54),
      click(1.6, 0.76, 0.58),
      move(1.9, 0.78, 0.59),
      move(2.7, 0.82, 0.64),
    ]);

    const clips = detectZoomClips(recording);
    expect(clips).toHaveLength(1);
    expect(clips[0].start).toBeLessThan(0.8);
    expect(clips[0].end).toBeGreaterThan(1.6);
  });

  it('merges short side-by-side zoom clips into one longer zoom', () => {
    const recording = makeRecording([
      move(1.05, 0.48, 0.38),
      move(1.35, 0.54, 0.41),
      move(1.55, 0.56, 0.42),
      move(1.8, 0.59, 0.445),
      click(1.95, 0.6, 0.45),
      move(2.25, 0.61, 0.46),
      move(2.7, 0.79, 0.58),
      click(3.08, 0.82, 0.6),
      move(3.35, 0.83, 0.61),
    ]);

    const clips = detectZoomClips(recording);
    expect(clips).toHaveLength(1);
    expect(clips[0].start).toBeLessThan(2.0);
    expect(clips[0].end).toBeGreaterThan(3.0);
  });

  it('does not create zoom clips from typing alone', () => {
    const recording = makeRecording([
      move(0.5, 0.4, 0.42),
      keydown(1.0),
      keydown(1.35),
      keydown(1.8, 'whitespace'),
      move(2.2, 0.41, 0.43),
    ]);

    expect(detectZoomClips(recording)).toHaveLength(0);
  });

  it('caps tight zooms that overlap typing so the view calms down', () => {
    const recording = makeRecording([
      move(0.35, 0.48, 0.48),
      move(0.7, 0.5, 0.5),
      click(1.0, 0.5, 0.5),
      click(1.2, 0.502, 0.501),
      keydown(1.45),
      keydown(1.75),
      move(2.1, 0.505, 0.502),
    ]);

    const clips = detectZoomClips(recording);
    expect(clips).toHaveLength(1);
    expect(clips[0].scale).toBeLessThanOrEqual(1.55);
  });

  it('keeps comfortable typing-overlap zooms from becoming more aggressive', () => {
    const recording = makeRecording([
      move(0.3, 0.18, 0.22),
      click(0.7, 0.18, 0.22),
      move(1.0, 0.3, 0.28),
      click(1.2, 0.42, 0.36),
      keydown(1.45),
      keydown(1.9),
      move(2.4, 0.48, 0.42),
    ]);

    const clips = detectZoomClips(recording);
    expect(clips).toHaveLength(1);
    expect(clips[0].scale).toBeLessThanOrEqual(1.55);
  });

  it('drops weak single-click clips that would be all transition', () => {
    const recording = makeRecording([
      move(0.8, 0.3, 0.3),
      click(1.0, 0.3, 0.3),
      move(1.2, 0.75, 0.72),
    ]);

    expect(detectZoomClips(recording)).toHaveLength(0);
  });

  it('stitches side-by-side clusters with a medium gap into one sustained zoom', () => {
    const recording = makeRecording([
      move(0.8, 0.2, 0.24),
      click(1.0, 0.22, 0.25),
      click(1.18, 0.225, 0.255),
      move(1.8, 0.55, 0.46),
      click(3.0, 0.62, 0.48),
      click(3.18, 0.625, 0.485),
      move(3.5, 0.66, 0.5),
    ]);

    const clips = detectZoomClips(recording);
    expect(clips).toHaveLength(1);
    expect(clips[0].end - clips[0].start).toBeGreaterThan(3);
  });

  it('ignores right-click-only interactions', () => {
    const recording = makeRecording([
      move(0.5, 0.45, 0.45),
      click(1.0, 0.46, 0.46, 'right'),
      click(1.22, 0.462, 0.462, 'right'),
      move(1.6, 0.47, 0.47),
    ]);

    expect(detectZoomClips(recording)).toHaveLength(0);
  });

  it('uses aspect-aware distance so wide recordings do not falsely merge far horizontal regions', () => {
    const area = { x: 0, y: 0, width: 3000, height: 500 };
    const wideMove = (t: number, nx: number, ny: number): CursorEvent => ({
      type: 'move',
      x: nx * area.width,
      y: ny * area.height,
      timestamp: START_TIME + t * 1000,
    });
    const wideClick = (t: number, nx: number, ny: number): CursorEvent => ({
      type: 'mousedown',
      x: nx * area.width,
      y: ny * area.height,
      timestamp: START_TIME + t * 1000,
    });
    const recording = makeRecording(
      [
        wideMove(0.7, 0.2, 0.42),
        wideClick(1.0, 0.2, 0.42),
        wideClick(1.2, 0.202, 0.421),
        wideClick(1.4, 0.201, 0.42),
        wideMove(2.2, 0.32, 0.42),
        wideClick(4.1, 0.42, 0.42),
        wideClick(4.3, 0.422, 0.421),
        wideClick(4.5, 0.421, 0.42),
        wideMove(5.0, 0.44, 0.42),
      ],
      area,
    );

    const clips = detectZoomClips(recording);
    expect(clips).toHaveLength(2);
  });
});

describe('inferZoomDefaultsAtTime', () => {
  it('uses nearby strong interaction context for add-zoom defaults', () => {
    const recording = makeRecording([
      move(4.2, 0.58, 0.4),
      move(4.45, 0.6, 0.42),
      click(4.8, 0.61, 0.43),
      move(4.95, 0.612, 0.432),
      click(5.08, 0.615, 0.434),
      move(5.3, 0.616, 0.435),
      move(5.9, 0.72, 0.54),
    ]);

    const defaults = inferZoomDefaultsAtTime(recording, 5.0);
    expect(defaults.confidence).toBeGreaterThanOrEqual(ADD_ZOOM_MIN_CONFIDENCE);
    expect(defaults.scale).not.toBe(2);
    expect(defaults.scale).toBeGreaterThan(2);
  });

  it('falls back to cursor-local context when there is no strong nearby interaction', () => {
    const recording = makeRecording([
      move(2.5, 0.2, 0.3),
      move(2.7, 0.35, 0.52),
      move(2.9, 0.55, 0.44),
      move(3.1, 0.74, 0.62),
      move(3.3, 0.82, 0.7),
    ]);

    const defaults = inferZoomDefaultsAtTime(recording, 3.0);
    expect(defaults.confidence).toBeLessThan(ADD_ZOOM_MIN_CONFIDENCE);
    expect(defaults.cx).toBeGreaterThan(0.5);
    expect(defaults.cx).toBeLessThan(0.7);
  });
});
