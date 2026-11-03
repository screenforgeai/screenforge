import os from 'node:os';

export function shouldUseMacNativeCapture(): boolean {
  // Require macOS 13 (Ventura, kernel 22.x) — minimum for ScreenCaptureKit.
  // Use SCK in both dev and packaged builds; AVFoundation does not respect
  // setContentProtection and would show the toolbar in captured video.
  return process.platform === 'darwin' && parseInt(os.release(), 10) >= 22;
}

export function shouldUseNativeCapture(): boolean {
  if (process.platform === 'darwin') {
    return parseInt(os.release(), 10) >= 22;
  }
  // Windows: always use ScreenforgeCapture.exe (WGC + Media Foundation).
  return process.platform === 'win32';
}
