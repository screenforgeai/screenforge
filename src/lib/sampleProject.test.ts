import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import sampleManifestJson from '../assets/sample-project/sample-project.json';
import { detectZoomClips } from './effects/zoom/analyze';
import {
  buildSampleRecordingResult,
  SAMPLE_PROJECT_VIDEO_FILENAME,
  type SampleProjectManifest,
} from './sampleProject';

const sampleManifest = sampleManifestJson as SampleProjectManifest;

const manifest: SampleProjectManifest = {
  version: 1,
  width: 1280,
  height: 800,
  duration: 12,
  events: [
    { type: 'move', x: 10, y: 20, timestamp: 0 },
    { type: 'mousedown', x: 100, y: 200, button: 1, timestamp: 1500 },
  ],
};

describe('buildSampleRecordingResult', () => {
  it('anchors the scripted events to the given start time', () => {
    const result = buildSampleRecordingResult(manifest, '/imports/sample.mp4', 1_700_000_000_000);

    expect(result.startTime).toBe(1_700_000_000_000);
    expect(result.mouseData.map((event) => event.timestamp)).toEqual([
      1_700_000_000_000, 1_700_000_001_500,
    ]);
    expect(result.mouseData[1]).toMatchObject({ type: 'mousedown', x: 100, y: 200, button: 1 });
  });

  it('describes the sample video as a recording of the full scripted area', () => {
    const result = buildSampleRecordingResult(manifest, '/imports/sample.mp4', 5_000);

    expect(result).toMatchObject({
      filePath: '/imports/sample.mp4',
      duration: 12,
      recordingArea: { x: 0, y: 0, width: 1280, height: 800 },
      hasEmbeddedAudio: false,
    });
    // It carries real cursor data, so the editor must treat it like a recording.
    expect(result.isImported).toBeUndefined();
  });

  it('does not share event objects with the manifest', () => {
    const result = buildSampleRecordingResult(manifest, '/imports/sample.mp4', 5_000);
    result.mouseData[0].x = 999;

    expect(manifest.events[0].x).toBe(10);
  });
});

describe('bundled sample project', () => {
  const videoPath = path.resolve(
    __dirname,
    '../assets/sample-project',
    SAMPLE_PROJECT_VIDEO_FILENAME,
  );

  it('is a short clip with a small video file', () => {
    expect(sampleManifest.duration).toBeGreaterThanOrEqual(8);
    expect(sampleManifest.duration).toBeLessThanOrEqual(15);
    expect(fs.statSync(videoPath).size).toBeLessThan(3 * 1024 * 1024);
  });

  it('keeps every pointer event inside the recorded area and inside the clip', () => {
    for (const event of sampleManifest.events) {
      expect(event.timestamp).toBeGreaterThanOrEqual(0);
      expect(event.timestamp).toBeLessThanOrEqual(sampleManifest.duration * 1000);
      if (event.x !== undefined && event.y !== undefined) {
        expect(event.x).toBeGreaterThanOrEqual(0);
        expect(event.x).toBeLessThanOrEqual(sampleManifest.width);
        expect(event.y).toBeGreaterThanOrEqual(0);
        expect(event.y).toBeLessThanOrEqual(sampleManifest.height);
      }
    }
  });

  it('gives auto-zoom several clicks to zoom in on', () => {
    const recording = buildSampleRecordingResult(sampleManifest, videoPath, 1_700_000_000_000);
    const clicks = recording.mouseData.filter((event) => event.type === 'mousedown');

    expect(clicks.length).toBeGreaterThanOrEqual(3);
    expect(detectZoomClips(recording).length).toBeGreaterThanOrEqual(2);
  });
});
