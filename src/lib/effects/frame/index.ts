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
  /** A logo in a corner of the video (from a style preset). Absent: none. */
  logo?: import('../logo/layout').LogoSettings | null;
}

export * from './analyze';
export * from './presets';
export * from './render';
export * from './wallpapers';
