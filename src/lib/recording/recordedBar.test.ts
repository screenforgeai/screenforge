import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME, type FrameSettings, type RecordedBarSettings } from '../effects/frame';
import type { RecordingResult } from '../../types/index';
import type { WindowBarSettings } from '../window-bar';
import {
  applyRecordedBar,
  cropRectWithTop,
  recordedBarEligibility,
  recordedBarFromDetection,
  shouldDetectRecordedBar,
} from './recordedBar';

const H = 1000;
const mac: WindowBarSettings = {
  enabled: true,
  style: 'mac',
  theme: 'auto',
  center: 'custom',
  customText: 'acme.com',
};
/** A frame whose window bar is on: the recorded toolbar is only cropped then. */
const withBar: FrameSettings = { ...DEFAULT_FRAME, windowBar: mac };
const bar = (patch: Partial<RecordedBarSettings> = {}): RecordedBarSettings => ({
  mode: 'auto',
  cropTop: 80,
  width: 1600,
  height: H,
  detected: 'crop',
  ...patch,
});

describe('recordedBarEligibility', () => {
  it('looks for a toolbar only in a window recording', () => {
    expect(recordedBarEligibility({ kind: 'window', appName: 'Google Chrome' })).toBe('detect');
    expect(recordedBarEligibility({ kind: 'window', displaySurface: 'window' })).toBe('detect');
    expect(recordedBarEligibility({ kind: 'window', displaySurface: 'browser' })).toBe('tab');
    expect(recordedBarEligibility({ kind: 'display', displaySurface: 'monitor' })).toBe('screen');
    expect(recordedBarEligibility({ kind: 'area' })).toBe('screen');
    expect(recordedBarEligibility(undefined)).toBe('unknown');
  });

  it('runs once per recording', () => {
    const result = { captureSource: { kind: 'window' } } as RecordingResult;
    expect(shouldDetectRecordedBar(result, DEFAULT_FRAME)).toBe(true);
    expect(shouldDetectRecordedBar(result, { ...DEFAULT_FRAME, recordedBar: bar() })).toBe(false);
    expect(shouldDetectRecordedBar({ ...result, isImported: true }, DEFAULT_FRAME)).toBe(false);
  });
});

describe('applyRecordedBar', () => {
  it('crops just below the toolbar when detection is sure', () => {
    const frame = applyRecordedBar(withBar, bar(), H);
    expect(frame.cropRect).toEqual({ x: 0, y: 0.08, width: 1, height: 0.92 });
    expect(frame.recordedBar?.cropTop).toBe(80);
  });

  it('leaves the frame alone when detection only has a guess', () => {
    const frame = applyRecordedBar(withBar, bar({ detected: 'adjust' }), H);
    expect(frame.cropRect).toEqual(DEFAULT_FRAME.cropRect);
  });

  it('applies a manual line even without detection', () => {
    const frame = applyRecordedBar(withBar, bar({ mode: 'manual', detected: 'none' }), H);
    expect(frame.cropRect.y).toBeCloseTo(0.08);
  });

  it('leaves the recorded toolbar alone while the window bar is off', () => {
    const off = { ...withBar, windowBar: { ...mac, enabled: false } };
    expect(applyRecordedBar(off, bar(), H).cropRect).toEqual(DEFAULT_FRAME.cropRect);
    expect(applyRecordedBar(DEFAULT_FRAME, bar(), H).cropRect).toEqual(DEFAULT_FRAME.cropRect);
  });

  it('puts the top back when the bar is switched off', () => {
    const cropped = applyRecordedBar(withBar, bar(), H);
    const off = { ...cropped, windowBar: { ...mac, enabled: false } };
    expect(applyRecordedBar(off, bar(), H).cropRect.y).toBe(0);
  });

  it('puts the top back when turned off, keeping the rest of the crop', () => {
    const cropped: FrameSettings = {
      ...applyRecordedBar(withBar, bar(), H),
    };
    cropped.cropRect = { ...cropped.cropRect, x: 0.1, width: 0.8 };
    const off = applyRecordedBar(cropped, bar({ mode: 'off' }), H);
    expect(off.cropRect).toEqual({ x: 0.1, y: 0, width: 0.8, height: 1 });
  });

  it('never undoes a top crop the person drew themselves', () => {
    const drawn: FrameSettings = {
      ...withBar,
      cropRect: { x: 0, y: 0.2, width: 1, height: 0.8 },
      recordedBar: bar({ detected: 'adjust' }),
    };
    expect(applyRecordedBar(drawn, bar({ mode: 'off' }), H).cropRect.y).toBe(0.2);
  });
});

describe('cropRectWithTop', () => {
  it('keeps the bottom edge where it was', () => {
    expect(cropRectWithTop({ x: 0, y: 0, width: 1, height: 0.9 }, 100, H)).toEqual({
      x: 0,
      y: 0.1,
      width: 1,
      height: 0.8,
    });
  });
});

describe('recordedBarFromDetection', () => {
  it("moves the line from sampled rows to the video's rows", () => {
    expect(
      recordedBarFromDetection({ action: 'crop', cropTop: 40 }, 540, { width: 3200, height: 2160 }),
    ).toEqual({ mode: 'auto', detected: 'crop', cropTop: 160, width: 3200, height: 2160 });
  });
});
