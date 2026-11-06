/** A logo drawn in a corner of the video, over everything else. */
export type LogoCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const LOGO_CORNERS: LogoCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export interface LogoSettings {
  /** The image as a data URL, so a project keeps its logo on its own. */
  src: string;
  corner: LogoCorner;
  /** Width as a fraction of the canvas width. */
  size: number;
  /** 0–100. */
  opacity: number;
}

export const LOGO_SIZE_MIN = 0.03;
export const LOGO_SIZE_MAX = 0.3;
/** A logo never grows taller than this fraction of the canvas height. */
const LOGO_MAX_HEIGHT = 0.25;
/** Gap from the canvas edges, as a fraction of the canvas height. */
const LOGO_MARGIN = 0.04;

export const DEFAULT_LOGO_SETTINGS: Omit<LogoSettings, 'src'> = {
  corner: 'bottom-right',
  size: 0.1,
  opacity: 100,
};

export interface LogoRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Where the logo goes on a canvas, keeping the image's aspect ratio. */
export function computeLogoRect(
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
  logo: Pick<LogoSettings, 'corner' | 'size'>,
): LogoRect {
  const aspect = imageWidth > 0 && imageHeight > 0 ? imageWidth / imageHeight : 1;
  let width = canvasWidth * logo.size;
  let height = width / aspect;
  const maxHeight = canvasHeight * LOGO_MAX_HEIGHT;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }
  const margin = Math.round(canvasHeight * LOGO_MARGIN);
  const left = logo.corner === 'top-left' || logo.corner === 'bottom-left';
  const top = logo.corner === 'top-left' || logo.corner === 'top-right';
  return {
    x: left ? margin : canvasWidth - margin - width,
    y: top ? margin : canvasHeight - margin - height,
    width,
    height,
  };
}

const isCorner = (value: unknown): value is LogoCorner =>
  typeof value === 'string' && (LOGO_CORNERS as string[]).includes(value);

const finiteOr = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** The corner, size and opacity of a stored logo, with defaults for anything missing. */
export function normalizeLogoPlacement(raw: Record<string, unknown>): Omit<LogoSettings, 'src'> {
  return {
    corner: isCorner(raw.corner) ? raw.corner : DEFAULT_LOGO_SETTINGS.corner,
    size: clamp(finiteOr(raw.size, DEFAULT_LOGO_SETTINGS.size), LOGO_SIZE_MIN, LOGO_SIZE_MAX),
    opacity: clamp(finiteOr(raw.opacity, DEFAULT_LOGO_SETTINGS.opacity), 0, 100),
  };
}

/** A saved project's logo, or null when there is none (or it's unusable). */
export function normalizeLogoSettings(raw: unknown): LogoSettings | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.src !== 'string' || !record.src) {
    return null;
  }
  return { src: record.src, ...normalizeLogoPlacement(record) };
}
