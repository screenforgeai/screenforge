/**
 * Studio looks: one-click settings that place a screenshot in a lit 3D studio
 * (backdrop, lighting, camera, lens). A look is the only thing a user picks;
 * every value below is tuned so the result is good without further controls.
 */
import nightGlowThumb from '../../../assets/studio-looks/night-glow.jpg';
import paperStudioThumb from '../../../assets/studio-looks/paper-studio.jpg';
import graphiteStageThumb from '../../../assets/studio-looks/graphite-stage.jpg';
import warmSunsetThumb from '../../../assets/studio-looks/warm-sunset.jpg';
import auroraThumb from '../../../assets/studio-looks/aurora.jpg';
import rimLightThumb from '../../../assets/studio-looks/rim-light.jpg';
import macroThumb from '../../../assets/studio-looks/macro.jpg';

export type StudioWallId =
  | 'night'
  | 'ventura'
  | 'sequoia'
  | 'shadeshifter'
  | 'graphite'
  | 'paper'
  | 'black';
export type StudioLightId = 'studio' | 'dramatic' | 'bright' | 'rim';
export type StudioEdgeId = 'glass' | 'silver' | 'graphite';
export type StudioCameraId = 'hero' | 'front' | 'left' | 'macro' | 'straight';

export interface StudioSettings {
  wall: StudioWallId;
  light: StudioLightId;
  edge: StudioEdgeId;
  camera: StudioCameraId;
  /** Where the key light and reflections come from, in degrees (0 = right, 90 = front, 180 = left). */
  envRot: number;
  envInt: number;
  /** Size of the key light: larger means softer shadows. */
  lightSize: number;
  /** How much of the backdrop shows up in the reflections. */
  bgRefl: number;
  /** Glass reflection on the screen. */
  reflect: number;
  /** Turn of the panel about its vertical axis, degrees. */
  tilt: number;
  /** How far the panel leans back, degrees. */
  lean: number;
  thick: number;
  radiusPx: number;
  shadowStr: number;
  /** Distance from the backdrop. */
  lift: number;
  screenGlow: number;
  floor: boolean;
  mirrorStr: number;
  dof: boolean;
  dofAmt: number;
  glow: boolean;
  bloomMode: 'highlights' | 'colour';
  grain: boolean;
  vignette: number;
  fisheye: number;
  fringe: number;
  screenFade: number;
  fadeAngle: number;
  fadeSoft: number;
  /** Viewing-angle falloff of the screen, 0..1. */
  lcd: number;
  /** How the camera exposes the screen; 'auto' follows the screenshot's brightness. */
  screenGain: number | 'auto';
}

export interface StudioLook {
  id: string;
  label: string;
  thumb: string;
  settings: StudioSettings;
}

const BASE: StudioSettings = {
  wall: 'night',
  light: 'studio',
  edge: 'glass',
  camera: 'hero',
  envRot: 30,
  envInt: 1,
  lightSize: 0.6,
  bgRefl: 0.6,
  reflect: 0.4,
  tilt: 14,
  lean: 0,
  thick: 0.3,
  radiusPx: 24,
  shadowStr: 0.55,
  lift: 0.3,
  screenGlow: 0.3,
  floor: false,
  mirrorStr: 0.3,
  dof: false,
  dofAmt: 0.4,
  glow: true,
  bloomMode: 'highlights',
  grain: true,
  vignette: 0.22,
  fisheye: 0,
  fringe: 0,
  screenFade: 0,
  fadeAngle: 135,
  fadeSoft: 0.5,
  lcd: 0,
  screenGain: 1,
};

const look = (
  id: string,
  label: string,
  thumb: string,
  settings: Partial<StudioSettings>,
): StudioLook => ({ id, label, thumb, settings: { ...BASE, ...settings } });

export const STUDIO_LOOKS: readonly StudioLook[] = [
  look('night-glow', 'Night glow', nightGlowThumb, {
    wall: 'night',
    tilt: 12,
    screenGlow: 0.4,
  }),
  look('paper-studio', 'Paper studio', paperStudioThumb, {
    wall: 'paper',
    camera: 'front',
    envRot: 40,
    lightSize: 0.5,
    bgRefl: 0.4,
    reflect: 0.35,
    tilt: 0,
    thick: 0.25,
    shadowStr: 0.6,
    lift: 0.25,
    screenGlow: 0,
  }),
  look('graphite-stage', 'Graphite stage', graphiteStageThumb, {
    wall: 'graphite',
    edge: 'silver',
    envRot: 20,
    envInt: 1.1,
    lightSize: 0.55,
    bgRefl: 0.5,
    reflect: 0.45,
    tilt: 16,
    thick: 0.45,
    lift: 0.35,
    screenGlow: 0.25,
    floor: true,
    mirrorStr: 0.25,
  }),
  look('warm-sunset', 'Warm sunset', warmSunsetThumb, {
    wall: 'ventura',
    light: 'dramatic',
    edge: 'graphite',
    camera: 'left',
    envRot: 60,
    lightSize: 0.7,
    bgRefl: 0.7,
    tilt: -12,
    thick: 0.35,
    shadowStr: 0.5,
    lift: 0.4,
    screenGlow: 0.5,
  }),
  look('aurora', 'Aurora', auroraThumb, {
    wall: 'sequoia',
    light: 'bright',
    camera: 'front',
    envInt: 0.9,
    lightSize: 0.7,
    reflect: 0.3,
    tilt: 0,
    shadowStr: 0.45,
    screenGlow: 0.4,
    dof: true,
    dofAmt: 0.35,
  }),
  look('rim-light', 'Rim light', rimLightThumb, {
    wall: 'shadeshifter',
    light: 'rim',
    envRot: 0,
    envInt: 1.1,
    lightSize: 0.5,
    reflect: 0.55,
    tilt: 18,
    thick: 0.55,
    shadowStr: 0.5,
  }),
  // A close lens skimming a leaned-back screen: one sharp band, the rest melting
  // into soft discs, vivid colour glowing, the far side sinking into shadow.
  // Starts straight-on, the whole screenshot sharp and framed; turning the camera (a drag)
  // brings in the angle, and with it the focus fall-off and the screen's viewing-angle dimming.
  look('macro', 'Macro', macroThumb, {
    wall: 'black',
    edge: 'graphite',
    camera: 'straight',
    envInt: 0.9,
    lightSize: 0.5,
    bgRefl: 0.3,
    reflect: 0.08,
    tilt: 0,
    shadowStr: 0.6,
    screenGlow: 0.2,
    dof: true,
    dofAmt: 0.85,
    bloomMode: 'colour',
    lean: 0,
    // The lab's grade, kept straight-on: a deep vignette and the top of the screen sinking
    // into shadow, so the screenshot reads as lit in a dark room rather than glowing flat.
    // The glass reflects little (reflect, above): facing the camera it would mirror the soft
    // boxes in front of it as a grey haze over the whole screen.
    vignette: 0.7,
    fisheye: 0.12,
    fringe: 0.3,
    screenFade: 0.6,
    fadeAngle: 90,
    fadeSoft: 0.65,
    lcd: 1,
    screenGain: 'auto',
  }),
];

export const getStudioLook = (id: string | null | undefined): StudioLook | null =>
  STUDIO_LOOKS.find((item) => item.id === id) ?? null;

export interface ImageStats {
  /** Mean luminance, 0..1. */
  lum: number;
  /** Mean colourfulness (max - min channel), 0..1. */
  sat: number;
  /** Share of pixels that are a strong colour accent, not a tint. */
  vivid: number;
}

/** Brightness and colour of a (downscaled) screenshot, from its RGBA pixels. */
export const imageStats = (data: Uint8ClampedArray): ImageStats => {
  const count = data.length / 4;
  if (count === 0) {
    return { lum: 0.5, sat: 0, vivid: 0 };
  }
  let lum = 0;
  let sat = 0;
  let vivid = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sat += hi - lo;
    if (hi - lo > 0.3 && hi > 0.4) {
      vivid++;
    }
  }
  return { lum: lum / count, sat: sat / count, vivid: vivid / count };
};

/** The look that sets a screenshot off best, judged by its brightness and colour. */
export const pickLookId = ({ lum, sat, vivid }: ImageStats): string => {
  if (lum > 0.62) {
    return 'night-glow';
  }
  if (lum < 0.3) {
    return vivid > 0.01 ? 'macro' : 'paper-studio';
  }
  return sat > 0.22 ? 'graphite-stage' : 'warm-sunset';
};

const smoothstep = (x: number, min: number, max: number) => {
  const t = Math.min(1, Math.max(0, (x - min) / (max - min)));
  return t * t * (3 - 2 * t);
};

/**
 * 'auto' exposes a light screen down, the way a photo of a white display reads
 * light grey rather than glowing; a dark screen keeps its full brightness.
 */
export const screenGainFor = (gain: StudioSettings['screenGain'], lum: number): number =>
  gain === 'auto' ? 1 - 0.3 * smoothstep(lum, 0.35, 0.7) : gain;

/** A point on the output, as fractions of its width and height (0,0 = top left). */
export interface StudioPoint {
  x: number;
  y: number;
}

const HANDLE_SWING = 0.32;
const HANDLE_REST_Y = 0.18;
const KEY_SIDE = 3.2;
const KEY_HEIGHT = 4.2;

/** Where the light handle sits for a look's own key light. */
export const defaultLightHandle = (envRot: number): StudioPoint => ({
  x: 0.5 - HANDLE_SWING * Math.cos((envRot * Math.PI) / 180),
  y: HANDLE_REST_Y,
});

/**
 * The key light (shadow direction and reflections) for a handle position: the
 * handle's side picks where the light and its reflections come from, its height
 * how high the light hangs.
 */
export const keyLightFromHandle = (handle: StudioPoint) => {
  const across = (handle.x - 0.5) / HANDLE_SWING;
  return {
    side: across * KEY_SIDE,
    height: KEY_HEIGHT + (HANDLE_REST_Y - handle.y) * 10,
    envRot: (Math.acos(Math.min(1, Math.max(-1, -across))) * 180) / Math.PI,
  };
};
