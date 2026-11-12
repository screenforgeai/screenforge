import type { WindowBarSettings } from '../../window-bar/types';
import type { RecordedBarCrop } from '../../window-bar/recorded-toolbar';

// ── Shared clip-transition alpha ─────────────────────────────────────────────
// Written by frame/pixi.ts each frame, read by cursor/pixi.ts so the cursor
// fades in/out in sync with every clip transition (fade, slide, grow, etc.).
let _clipTransitionAlpha = 1;

export function setClipTransitionAlpha(alpha: number): void {
  _clipTransitionAlpha = alpha;
}

export function getClipTransitionAlpha(): number {
  return _clipTransitionAlpha;
}

export type BackgroundType = 'wallpaper' | 'gradient' | 'solid' | 'blur';

export interface BackgroundSettings {
  type: BackgroundType;
  solidColor: string;
  gradientPresetId: string;
  gradientFrom: string;
  gradientTo: string;
  gradientAngle: number;
  padding: number;
  cornerRadius: number;
  shadowBlur: number;
  shadowOpacity: number;
  wallpaperSeed: number;
  blurIntensity: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameSettings {
  aspectRatioId: string;
  cropRect: CropRect;
  background: BackgroundSettings;
  /**
   * A Mac, Windows or browser bar over the recording. The preset's corner
   * radius and shadow wrap bar and page together as one window. Absent (or
   * style 'none') draws no bar, exactly as before it existed.
   */
  windowBar?: WindowBarSettings;
  /**
   * The person's own browser toolbar, recorded with the page: whether to crop
   * it off (Auto / Manual / Off), and where. The crop itself is applied
   * through cropRect; this remembers how it was decided. One per recording,
   * so it lives with the project, not in style presets.
   */
  recordedBar?: RecordedBarSettings;
}

export interface RecordedBarSettings extends RecordedBarCrop {
  /** What detection found: crop by itself, ask the person to adjust, or nothing to crop. */
  detected: 'crop' | 'adjust' | 'none';
}

export * from './analyze';
export * from './presets';
export * from './render';
export * from './wallpapers';
