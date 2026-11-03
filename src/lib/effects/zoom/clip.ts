import { DEFAULT_ZOOM_CLIP } from '../../../store/defaults';
import type {
  CinematicTiltDirection,
  CinematicTiltMode,
  ZoomClip,
  ZoomPreset,
} from '../../../types/timeline';

type ZoomClipCinematicFields =
  | 'preset'
  | 'cinematicIntensity'
  | 'cinematicDepth'
  | 'cinematicFocus'
  | 'cinematicBackgroundFade'
  | 'cinematicTilt'
  | 'cinematicMotionBlur'
  | 'cinematicTiltMode'
  | 'cinematicTiltDirection';

export type LegacyZoomClip = Omit<ZoomClip, ZoomClipCinematicFields> &
  Partial<Record<ZoomClipCinematicFields, unknown>>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeZoomPreset(value: unknown): ZoomPreset {
  return value === 'cinematic' ? 'cinematic' : 'standard';
}

export function normalizeCinematicIntensity(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, 0, 1)
    : DEFAULT_ZOOM_CLIP.cinematicIntensity;
}

export function normalizeCinematicDepth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, 0, 1)
    : DEFAULT_ZOOM_CLIP.cinematicDepth;
}

export function normalizeCinematicFocus(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, 0, 1)
    : DEFAULT_ZOOM_CLIP.cinematicFocus;
}

export function normalizeCinematicBackgroundFade(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, 0, 1)
    : DEFAULT_ZOOM_CLIP.cinematicBackgroundFade;
}

export function normalizeCinematicTilt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, 0, 1)
    : DEFAULT_ZOOM_CLIP.cinematicTilt;
}

export function normalizeCinematicMotionBlur(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, 0, 1)
    : DEFAULT_ZOOM_CLIP.cinematicMotionBlur;
}

export function normalizeCinematicTiltMode(value: unknown): CinematicTiltMode {
  if (value === 'static' || value === 'follow') {
    return value;
  }
  return DEFAULT_ZOOM_CLIP.cinematicTiltMode;
}

export function normalizeCinematicTiltDirection(value: unknown): CinematicTiltDirection {
  if (value === 'left' || value === 'right') {
    return value;
  }
  return DEFAULT_ZOOM_CLIP.cinematicTiltDirection;
}

export function normalizeZoomClip(clip: LegacyZoomClip): ZoomClip {
  return {
    ...clip,
    preset: normalizeZoomPreset(clip.preset),
    cinematicIntensity: normalizeCinematicIntensity(clip.cinematicIntensity),
    cinematicDepth: normalizeCinematicDepth(clip.cinematicDepth),
    cinematicFocus: normalizeCinematicFocus(clip.cinematicFocus),
    cinematicBackgroundFade: normalizeCinematicBackgroundFade(clip.cinematicBackgroundFade),
    cinematicTilt: normalizeCinematicTilt(clip.cinematicTilt),
    cinematicMotionBlur: normalizeCinematicMotionBlur(clip.cinematicMotionBlur),
    cinematicTiltMode: normalizeCinematicTiltMode(clip.cinematicTiltMode),
    cinematicTiltDirection: normalizeCinematicTiltDirection(clip.cinematicTiltDirection),
  };
}

export function normalizeZoomClips(clips: LegacyZoomClip[]): ZoomClip[] {
  return clips.map(normalizeZoomClip);
}
