import { DEFAULT_ZOOM_STYLE } from '../../../store/defaults';
import type { ZoomClip, ZoomEasing, ZoomStyleSettings } from '../../../types/timeline';
import { normalizeZoomEasing } from './clip';

/**
 * Auto-zoom style: a project-wide intensity (zoom depth) and easing preset.
 *
 * Intensity is baked into the `scale` of auto-detected clips (those carrying
 * `autoScale`), so every consumer of `zoomClips` — preview, export, camera and
 * cursor overlays — sees the same value. A clip whose scale no longer matches
 * what the current intensity would produce has been hand-tuned and is left
 * alone.
 *
 * Easing is stamped onto every clip (`clip.easing`) and read by
 * `interpolateCamera` and the zoom frame wrappers at render time.
 */

export const ZOOM_INTENSITY_MIN = 0.5;
export const ZOOM_INTENSITY_MAX = 1.5;
export const ZOOM_EASINGS: readonly ZoomEasing[] = ['gentle', 'standard', 'snappy'];

const MIN_ZOOM_SCALE = 1.1;
const MAX_ZOOM_SCALE = 4;
const SCALE_MATCH_EPSILON = 1e-6;
const AUTO_CLIP_ID_PREFIX = 'zoom-auto-';

export interface ZoomEasingProfile {
  /** Maps ramp progress 0–1 to zoom progress 0–1. */
  ease: (t: number) => number;
  /** Multiplier on each clip's easeIn/easeOut ramp durations. */
  rampScale: number;
  /** Multiplier on the camera's pan-follow spring halflife (larger = lazier panning). */
  panHalflifeScale: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(t: number): number {
  return clamp(t, 0, 1);
}

const ZOOM_EASING_PROFILES: Record<ZoomEasing, ZoomEasingProfile> = {
  // Longer ramps on a sine curve (peak speed ~0.58× standard) and lazier panning.
  gentle: {
    ease: (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t)),
    rampScale: 1.35,
    panHalflifeScale: 1.6,
  },
  // The original quadratic ease-in-out, ramps and pan pace — unchanged.
  standard: {
    ease: (t) => {
      const c = clamp01(t);
      return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c;
    },
    rampScale: 1,
    panHalflifeScale: 1,
  },
  // Shorter ramps on a cubic curve (peak speed ~2× standard) and quicker panning.
  snappy: {
    ease: (t) => {
      const c = clamp01(t);
      return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
    },
    rampScale: 0.7,
    panHalflifeScale: 0.6,
  },
};

export function getZoomEasingProfile(easing: unknown): ZoomEasingProfile {
  return ZOOM_EASING_PROFILES[normalizeZoomEasing(easing)];
}

export function normalizeZoomIntensity(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, ZOOM_INTENSITY_MIN, ZOOM_INTENSITY_MAX)
    : DEFAULT_ZOOM_STYLE.intensity;
}

export function normalizeZoomStyle(value: unknown): ZoomStyleSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<
    Record<keyof ZoomStyleSettings, unknown>
  >;
  return {
    intensity: normalizeZoomIntensity(raw.intensity),
    easing: normalizeZoomEasing(raw.easing),
  };
}

/** Scales the zoom depth (the part above 1×) of an analysed scale. */
export function applyZoomIntensity(baseScale: number, intensity: number): number {
  if (intensity === 1) {
    return baseScale;
  }
  const scaled = 1 + (baseScale - 1) * intensity;
  return Math.round(clamp(scaled, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE) * 100) / 100;
}

/**
 * Re-applies intensity to auto-detected clips that still sit at the scale the
 * previous intensity gave them. Hand-tuned clips and user-added clips (no
 * `autoScale`) keep their scale. Returns the input array when nothing changes.
 */
export function rescaleAutoZoomClips(
  clips: ZoomClip[],
  fromIntensity: number,
  toIntensity: number,
): ZoomClip[] {
  let changed = false;
  const next = clips.map((clip) => {
    if (clip.autoScale === undefined) {
      return clip;
    }
    const expected = applyZoomIntensity(clip.autoScale, fromIntensity);
    if (Math.abs(clip.scale - expected) > SCALE_MATCH_EPSILON) {
      return clip;
    }
    const scale = applyZoomIntensity(clip.autoScale, toIntensity);
    if (scale === clip.scale) {
      return clip;
    }
    changed = true;
    return { ...clip, scale };
  });
  return changed ? next : clips;
}

/** Applies the project's zoom style to clips straight out of auto-zoom analysis. */
export function prepareDetectedZoomClips(clips: ZoomClip[], style: ZoomStyleSettings): ZoomClip[] {
  return rescaleAutoZoomClips(clips, 1, style.intensity).map((clip) =>
    clip.easing === style.easing ? clip : { ...clip, easing: style.easing },
  );
}

interface ZoomStyleState {
  zoomStyle: ZoomStyleSettings;
  zoomClips: ZoomClip[];
}

/**
 * Builds the store patch for a zoom style change: intensity re-scales untouched
 * auto-detected clips, easing is set on every clip (there is no per-clip easing
 * control, so there is no hand-tuning to protect).
 */
export function applyZoomStyle(
  state: ZoomStyleState,
  change: Partial<ZoomStyleSettings>,
): ZoomStyleState {
  const zoomStyle = normalizeZoomStyle({ ...state.zoomStyle, ...change });
  let zoomClips = rescaleAutoZoomClips(
    state.zoomClips,
    state.zoomStyle.intensity,
    zoomStyle.intensity,
  );
  if (zoomClips.some((clip) => clip.easing !== zoomStyle.easing)) {
    zoomClips = zoomClips.map((clip) =>
      clip.easing === zoomStyle.easing ? clip : { ...clip, easing: zoomStyle.easing },
    );
  }
  return { zoomStyle, zoomClips };
}

/**
 * Store patch for applying a style preset's zoom style. Presets saved before
 * zoom style existed carry none and leave the project's zoom untouched.
 */
export function applyStylePresetZoom(
  state: ZoomStyleState,
  preset: { zoomStyle?: ZoomStyleSettings },
): Partial<ZoomStyleState> {
  if (!preset.zoomStyle) {
    return {};
  }
  return applyZoomStyle(state, normalizeZoomStyle(preset.zoomStyle));
}

/**
 * Projects saved before zoom style existed have no `autoScale`. Their
 * auto-detected clips (`zoom-auto-*` ids) were analysed at what is now 100%
 * intensity, so their current scale is taken as the analysed one.
 */
export function migrateLegacyAutoZoomClips(clips: ZoomClip[]): ZoomClip[] {
  return clips.map((clip) =>
    clip.autoScale === undefined && clip.id.startsWith(AUTO_CLIP_ID_PREFIX)
      ? { ...clip, autoScale: clip.scale }
      : clip,
  );
}
