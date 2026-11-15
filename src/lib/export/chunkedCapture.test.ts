import { describe, expect, it } from 'vitest';
import type { CaptureWindowParams } from '../../types';
import type { MediaSegment } from '../../types/timeline';
import type { MotionClip } from '../animation/motionClips';
import { computeChunkKeys } from './chunkKeys';
import { buildChunkKeyInputs, chunkLookbackSeconds } from './chunkedCapture';
import { planChunks } from './chunkPlan';

const FPS = 30;
const DURATION = 40;

const segment = (overrides: Partial<MediaSegment> = {}): MediaSegment =>
  ({
    id: 'clip-1',
    timelineStart: 0,
    timelineEnd: DURATION,
    sourceStart: 0,
    sourceEnd: DURATION,
    videoEnabled: true,
    audioEnabled: true,
    ...overrides,
  }) as MediaSegment;

function params(overrides: {
  motionClips?: MotionClip[];
  cameraClips?: unknown[];
  segments?: MediaSegment[];
}): CaptureWindowParams {
  return {
    workspaceId: 'ws',
    jobId: 'job',
    recording: { filePath: '/r.mp4', duration: DURATION } as CaptureWindowParams['recording'],
    mediaSegments: overrides.segments ?? [segment()],
    frame: {},
    storeSnapshot: {
      frame: {},
      zoomClips: [],
      textClips: [],
      camera: {},
      keyboard: {},
      cursorEnabled: true,
      cursorHideWhenIdle: false,
      cursorIdleHideSeconds: 3,
      cameraClips: overrides.cameraClips ?? [],
      maskClips: [],
      motionClips: overrides.motionClips ?? [],
    } as unknown as CaptureWindowParams['storeSnapshot'],
    duration: DURATION,
    fps: FPS,
    sourceFps: FPS,
    targetWidth: 1280,
    targetHeight: 720,
    format: 'mp4',
    quality: 'high',
    resolution: '720p',
    includeAudio: false,
    cursor: { clickSound: 'none', clickSoundVolume: 0 },
  };
}

function keysFor(p: CaptureWindowParams): string[] {
  const segments = p.mediaSegments as MediaSegment[];
  const totalFrames = DURATION * FPS;
  const chunks = planChunks(totalFrames, FPS);
  return computeChunkKeys(
    buildChunkKeyInputs(
      p,
      { totalFrames, fps: FPS, playableSegments: segments, analyzedData: new Map() },
      chunks,
    ),
  );
}

function changed(a: string[], b: string[]): number[] {
  return a.flatMap((key, i) => (key === b[i] ? [] : [i]));
}

const push = (
  start: number,
  end: number,
  amount: MotionClip['amount'] = 'default',
): MotionClip => ({
  id: `push-${start}`,
  move: 'slowPush',
  start,
  end,
  amount,
  feel: 'smooth',
});

describe('buildChunkKeyInputs', () => {
  it('keys on motion as resolved, so a pose carried from an early move counts', () => {
    // A slow push from 2–4 s holds its end pose for the rest of the timeline.
    const before = keysFor(params({ motionClips: [push(2, 4)] }));
    const after = keysFor(params({ motionClips: [push(2, 4, 'strong')] }));
    const diff = changed(before, after);
    expect(diff).toContain(1); // the move itself (2–4 s)
    expect(diff).toContain(19); // the held pose at 38–40 s
  });

  it('keeps chunks whose resolved motion is unchanged', () => {
    // An intro at 0–1.5 s ends at the identity pose; changing its amount
    // only changes the first chunk.
    const intro = (amount: MotionClip['amount']): MotionClip => ({
      id: 'intro',
      move: 'rise',
      start: 0,
      end: 1.5,
      amount,
      feel: 'smooth',
      clipId: 'clip-1',
    });
    const diff = changed(
      keysFor(params({ motionClips: [intro('default')] })),
      keysFor(params({ motionClips: [intro('strong')] })),
    );
    expect(diff).toEqual([0]);
  });

  it('notices a renamed segment that a motion clip is pinned to', () => {
    const intro: MotionClip = {
      id: 'intro',
      move: 'rise',
      start: 0,
      end: 1.5,
      amount: 'default',
      feel: 'smooth',
      clipId: 'clip-1',
    };
    const diff = changed(
      keysFor(params({ motionClips: [intro] })),
      keysFor(params({ motionClips: [intro], segments: [segment({ id: 'renamed' })] })),
    );
    expect(diff).toContain(0);
  });

  it('treats camera clips as global', () => {
    const diff = changed(
      keysFor(params({ cameraClips: [{ id: 'c', start: 30, end: 32 }] })),
      keysFor(params({ cameraClips: [{ id: 'c', start: 30, end: 33 }] })),
    );
    expect(diff).toHaveLength(20);
  });

  it('looks back far enough for idle hiding', () => {
    expect(chunkLookbackSeconds(params({}))).toBe(5);
    const p = params({});
    p.storeSnapshot.cursorHideWhenIdle = true;
    p.storeSnapshot.cursorIdleHideSeconds = 8;
    expect(chunkLookbackSeconds(p)).toBe(10);
  });
});
