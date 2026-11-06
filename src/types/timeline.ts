// ── Selected action ───────────────────────────────────────────────────────────

export type SelectedZoomAction = {
  id: string;
  start: number;
  end: number;
  effectId: string;
} | null;

// ── Clip transition ───────────────────────────────────────────────────────────

export type TransitionType =
  | 'none'
  | 'fade'
  | 'fade-white'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'grow'
  | 'shrink'
  | 'blur';

export interface ClipTransition {
  type: TransitionType;
  duration: number; // seconds, 0.0–1.5
}

/**
 * Clip transitions are no longer edited: Motion intros and outros pinned to a
 * clip do this job now, and old projects are converted when they open (see
 * lib/animation/migrateTransitions). The fields stay so old data still reads.
 */
export const NO_CLIP_TRANSITION: ClipTransition = {
  type: 'none',
  duration: 0,
};

// ── Primary media segments (video/audio timeline model) ──────────────────────

export interface MediaSegment {
  id: string;
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  sourceEnd: number;
  videoEnabled?: boolean;
  audioEnabled?: boolean;
  cursorEnabled?: boolean; // false = hide cursor overlay for this segment (e.g. imported clips)
  transitionIn?: ClipTransition; // undefined for first clip (no incoming transition)
  transitionOut?: ClipTransition; // undefined for last clip (no outgoing transition)
  speed?: number; // undefined | 1.0 = normal; 0.25–4.0
}

// ── Zoom clip (persisted in store) ────────────────────────────────────────────

export type ZoomPreset = 'standard' | 'cinematic';
export type CinematicTiltMode = 'static' | 'follow';
export type CinematicTiltDirection = 'left' | 'right';
/** Pace of the zoom ramps and camera panning; 'standard' is the original feel. */
export type ZoomEasing = 'gentle' | 'standard' | 'snappy';

/** Project-wide auto-zoom style, also saved in style presets. */
export interface ZoomStyleSettings {
  /** Multiplier on the zoom depth (scale above 1×) of auto-detected zooms; 1 = as analysed. */
  intensity: number;
  easing: ZoomEasing;
}

export interface ZoomClip {
  id: string;
  start: number; // video time (seconds)
  end: number; // video time (seconds)
  scale: number; // zoom level: 1.0–4.0
  cx: number; // 0–1 normalised zoom centre x (manual mode)
  cy: number; // 0–1 normalised zoom centre y (manual mode)
  easeIn: number; // ramp-up duration (seconds)
  easeOut: number; // ramp-down duration (seconds)
  mode: 'auto' | 'manual'; // auto = follow cursor, manual = fixed cx/cy
  preset: ZoomPreset; // standard = transform only, cinematic = optical zoom treatment
  cinematicIntensity: number; // 0–1
  cinematicDepth: number; // 0–1
  cinematicFocus: number; // 0–1, larger = wider sharp focus area
  cinematicBackgroundFade: number; // 0–1
  cinematicTilt: number; // 0–1
  cinematicMotionBlur: number; // 0–1
  cinematicTiltMode: CinematicTiltMode; // locked at clip start
  cinematicTiltDirection: CinematicTiltDirection; // auto = cursor-based, left/right = forced direction
  easing: ZoomEasing; // ramp curve + pan pace, stamped from the project's zoom style
  autoScale?: number; // auto-detected clips only: the analysed scale before zoom intensity
}

// ── Inspector form config ─────────────────────────────────────────────────────

export interface ZoomConfig {
  scale: number;
  cx: number;
  cy: number;
  easeIn: number;
  easeOut: number;
}

export type ClipConfig = ZoomConfig;

// ── Timeline indicator (read-only metadata markers on the indicators row) ─────

export type TimelineIndicatorKind = 'keyboard-shortcut' | 'mouse-click';

export interface TimelineIndicator {
  id: string;
  kind: TimelineIndicatorKind;
  start: number;
  end: number;
  label: string;
}

export interface CameraClip {
  id: string;
  start: number;
  end: number;
  x: number;
  y: number;
  size: number;
  layout?: import('../types').CameraLayoutPreset;
}

// ── Mask clip (privacy redaction overlay) ────────────────────────────────────

export type MaskType = 'blur' | 'solid';

export interface MaskClip {
  id: string;
  start: number; // video timeline time (seconds)
  end: number; // video timeline time (seconds)
  x: number; // normalized 0–1 (fraction of canvas width)
  y: number; // normalized 0–1 (fraction of canvas height)
  width: number; // normalized 0–1
  height: number; // normalized 0–1
  type: MaskType;
  blurAmount: number; // 4–40 px (used when type === 'blur')
  color: string; // hex color (used when type === 'solid')
}

// ── Clip metadata ─────────────────────────────────────────────────────────────

export const CLIP_DEFS: Record<string, { label: string }> = {
  zoom: { label: 'Zoom' },
  camera: { label: 'Camera' },
  video: { label: 'Video' },
  audio: { label: 'Audio' },
};
