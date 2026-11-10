import { describe, expect, it } from 'vitest';
import { getSystemAudioSupport } from './system-audio';

describe('getSystemAudioSupport', () => {
  it('is supported on macOS 13+ (ScreenCaptureKit records system audio)', () => {
    expect(getSystemAudioSupport({ platform: 'darwin', captureBackend: 'native' })).toEqual({
      supported: true,
    });
  });

  it('is unsupported on macOS 12 and earlier (the AVFoundation fallback has no audio input)', () => {
    expect(getSystemAudioSupport({ platform: 'darwin', captureBackend: 'ffmpeg-x11' })).toEqual({
      supported: false,
      reason: 'macos-too-old',
    });
  });

  it('is supported on Windows (the native helper records WASAPI loopback)', () => {
    expect(getSystemAudioSupport({ platform: 'win32', captureBackend: 'native' })).toEqual({
      supported: true,
    });
  });

  it('is unsupported on Linux X11 (x11grab has no audio input)', () => {
    expect(getSystemAudioSupport({ platform: 'linux', captureBackend: 'ffmpeg-x11' })).toEqual({
      supported: false,
      reason: 'linux-not-supported',
    });
  });

  it('is unsupported on Linux Wayland (the portal stream is recorded without audio)', () => {
    expect(getSystemAudioSupport({ platform: 'linux', captureBackend: 'wayland-portal' })).toEqual({
      supported: false,
      reason: 'linux-not-supported',
    });
  });

  it('is unsupported when screen capture itself is unavailable', () => {
    expect(getSystemAudioSupport({ platform: 'linux', captureBackend: 'unsupported' })).toEqual({
      supported: false,
      reason: 'platform-not-supported',
    });
    expect(getSystemAudioSupport({ platform: 'freebsd', captureBackend: 'ffmpeg-x11' })).toEqual({
      supported: false,
      reason: 'platform-not-supported',
    });
  });
});
