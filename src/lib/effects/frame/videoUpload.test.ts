import { describe, expect, it } from 'vitest';
import { needsVideoUpload, videoUploadKey } from './videoUpload';

const full = { x: 0, y: 0, width: 1920, height: 1080 };

describe('video texture uploads', () => {
  it('uploads every tick when the source does not name its frame (export)', () => {
    const key = videoUploadKey('crop', undefined, full);
    expect(key).toBeNull();
    expect(needsVideoUpload(null, key)).toBe(true);
    expect(needsVideoUpload('whole:3', key)).toBe(true);
  });

  it('skips the upload while the video still shows the frame already on the GPU', () => {
    const key = videoUploadKey('whole', 7, full);
    expect(needsVideoUpload(key, videoUploadKey('whole', 7, full))).toBe(false);
  });

  it('uploads when a new frame arrives', () => {
    expect(
      needsVideoUpload(videoUploadKey('whole', 7, full), videoUploadKey('whole', 8, full)),
    ).toBe(true);
  });

  it('uploads the first frame after the texture was rebuilt', () => {
    expect(needsVideoUpload(null, videoUploadKey('whole', 7, full))).toBe(true);
  });

  it('re-copies the same frame when the crop moves or resizes', () => {
    const before = videoUploadKey('crop', 7, { x: 0, y: 0, width: 800, height: 600 });
    const moved = videoUploadKey('crop', 7, { x: 10, y: 0, width: 800, height: 600 });
    const resized = videoUploadKey('crop', 7, { x: 0, y: 0, width: 640, height: 600 });
    expect(needsVideoUpload(before, moved)).toBe(true);
    expect(needsVideoUpload(before, resized)).toBe(true);
  });

  it('uploads the same frame again when switching between the whole and the cropped texture', () => {
    const whole = videoUploadKey('whole', 7, full);
    const crop = videoUploadKey('crop', 7, full);
    expect(needsVideoUpload(whole, crop)).toBe(true);
    expect(needsVideoUpload(crop, whole)).toBe(true);
  });
});
