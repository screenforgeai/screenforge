import cameraCaptureSound from 'src/assets/sounds/camera-capture.mp3';

/** The camera shutter heard whenever a screenshot is taken, from the preview or the toolbar. */
export function playShutterSound(): void {
  const audio = new Audio(cameraCaptureSound);
  // Playback can be refused (no output device, autoplay policy); a silent
  // capture is fine, an unhandled rejection is not.
  audio.play().catch(() => undefined);
}
