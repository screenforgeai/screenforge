import type { CaptureBackend, SystemAudioSupport } from '../../../src/types/index';

/**
 * Whether the capture path this machine uses records system (desktop) audio
 * into the screen recording:
 * - macOS 13+: the native ScreenCaptureKit helper captures system audio.
 * - macOS 12 and earlier: the FFmpeg AVFoundation fallback grabs the screen
 *   only (`Capture screen N:none`), so there is no system audio.
 * - Windows: the native helper records the default output device through
 *   WASAPI loopback.
 * - Linux: x11grab has no audio input and the Wayland portal stream is
 *   recorded without audio; PulseAudio/PipeWire monitor capture is not wired
 *   up yet.
 */
export function getSystemAudioSupport(options: {
  platform: NodeJS.Platform;
  captureBackend: CaptureBackend;
}): SystemAudioSupport {
  const { platform, captureBackend } = options;

  if (captureBackend === 'unsupported') {
    return { supported: false, reason: 'platform-not-supported' };
  }
  if (platform === 'darwin') {
    return captureBackend === 'native'
      ? { supported: true }
      : { supported: false, reason: 'macos-too-old' };
  }
  if (platform === 'win32') {
    return captureBackend === 'native'
      ? { supported: true }
      : { supported: false, reason: 'platform-not-supported' };
  }
  if (platform === 'linux') {
    return { supported: false, reason: 'linux-not-supported' };
  }
  return { supported: false, reason: 'platform-not-supported' };
}
