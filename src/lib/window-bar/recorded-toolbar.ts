/**
 * Finding (and cropping) the real browser toolbar in someone's own screen
 * recording, so our bar replaces it rather than stacking on top of it.
 *
 * Two signals have to agree before anything is cropped by itself:
 *   1. a stable band: the rows at the top that barely change across the
 *      recording (a toolbar holds still while the page under it moves);
 *   2. a line: the strongest near-full-width horizontal edge inside that
 *      band (the toolbar's bottom border).
 * When the browser is known, its usual toolbar height is a third check.
 * Anything short of agreement is a suggestion the person confirms ("Adjust
 * crop"), never a silent crop.
 */

/** getDisplayMedia's `displaySurface`: a tab, a window or a whole screen. */
export type DisplaySurface = 'browser' | 'window' | 'monitor';
export type RecordedBarCropMode = 'auto' | 'manual' | 'off';
export type KnownBrowser = 'chrome' | 'edge' | 'firefox' | 'safari' | 'arc' | 'brave' | 'opera';

export interface RgbaFrame {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/**
 * Usual toolbar heights in CSS px (tabs + address bar, with or without a
 * bookmarks bar), as [min, max] ranges. Multiply by the capture's scale.
 */
export const BROWSER_TOOLBAR_HEIGHTS: Record<KnownBrowser, [number, number][]> = {
  chrome: [
    [70, 92],
    [98, 122],
  ],
  edge: [
    [70, 92],
    [98, 124],
  ],
  brave: [
    [70, 92],
    [98, 122],
  ],
  opera: [
    [70, 96],
    [98, 124],
  ],
  firefox: [
    [72, 92],
    [100, 124],
  ],
  safari: [
    [50, 62],
    [74, 96],
    [100, 124],
  ],
  // Arc keeps its tabs in a sidebar: only a thin top strip, if any.
  arc: [[0, 52]],
};

export interface RecordedToolbarDetection {
  /**
   * 'crop' — both signals agree: crop `cropTop` rows by itself.
   * 'adjust' — a guess at `cropTop` the person should confirm or drag.
   * 'none' — nothing to crop (a tab capture, a whole screen, or crop off).
   */
  action: 'crop' | 'adjust' | 'none';
  /** Rows to crop from the top, in frame pixels. 0 for 'none'. */
  cropTop: number;
  /** Whether a window bar should be on by default for this recording. */
  windowBarDefault: boolean;
  /** What each signal found, for the editor and for debugging. */
  signals: {
    stableBand: number | null;
    line: number | null;
    priorAgrees: boolean | null;
  };
}

export interface DetectRecordedToolbarOptions {
  displaySurface?: DisplaySurface | null;
  mode?: RecordedBarCropMode;
  browser?: KnownBrowser | null;
  /** Device pixels per CSS px in the capture (2 on a Retina screen). */
  scale?: number;
}

/** Rows deeper than this share of the frame are never toolbar. */
const MAX_BAND_SHARE = 0.25;
/** A row "barely changes" when its average frame-to-frame change stays under this (0–255). */
const STABLE_ROW_CHANGE = 2.5;
/** An edge pixel: this much brightness step from the row above (0–255). */
const EDGE_STEP = 10;
/** "Near full width": this share of the columns have the edge. */
const LINE_COVERAGE = 0.85;

/** Every n-th column is enough to read rows (a 2880px frame needs ~360 samples). */
function columnStep(width: number): number {
  return Math.max(1, Math.floor(width / 360));
}

function luma(data: ArrayLike<number>, i: number): number {
  return 0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
}

/** Rows from the top whose content holds still across `frames`; null when it never settles or never moves. */
export function stableBandHeight(frames: RgbaFrame[]): number | null {
  const first = frames[0];
  if (!first || frames.length < 2) return null;
  const { width, height } = first;
  const step = columnStep(width);
  const maxRow = Math.floor(height * MAX_BAND_SHARE);
  const columns = Math.ceil(width / step);
  for (let y = 0; y < Math.min(height, maxRow + 1); y++) {
    let change = 0;
    let pairs = 0;
    for (let f = 1; f < frames.length; f++) {
      const a = frames[f - 1];
      const b = frames[f];
      if (!a || !b) continue;
      if (a.width !== width || b.width !== width || a.height !== height || b.height !== height)
        continue;
      let sum = 0;
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        sum += Math.abs(luma(a.data, i) - luma(b.data, i));
      }
      change += sum / columns;
      pairs++;
    }
    if (pairs === 0) return null;
    if (change / pairs > STABLE_ROW_CHANGE) return y === 0 ? null : y;
  }
  // Everything near the top held still: a static recording says nothing.
  return null;
}

/**
 * The strongest near-full-width horizontal edge in rows 0–`maxRow` of
 * `frame` (the stable band, so moving page content never counts), as the
 * row a crop would start at: just below a 1px divider, or at the edge
 * itself when the toolbar simply meets the page. Null when there's none.
 */
export function strongestHorizontalLine(frame: RgbaFrame, maxRow: number): number | null {
  const { data, width, height } = frame;
  const step = columnStep(width);
  const last = Math.min(height - 1, Math.floor(maxRow));
  const columns = Math.ceil(width / step);
  const edgeAt = (y: number): { coverage: number; contrast: number } => {
    let hits = 0;
    let contrast = 0;
    for (let x = 0; x < width; x += step) {
      const delta = Math.abs(
        luma(data, (y * width + x) * 4) - luma(data, ((y - 1) * width + x) * 4),
      );
      if (delta >= EDGE_STEP) {
        hits++;
        contrast += delta;
      }
    }
    return { coverage: hits / columns, contrast: contrast / Math.max(hits, 1) };
  };
  let bestRow = -1;
  let bestScore = 0;
  for (let y = 1; y <= last; y++) {
    const { coverage, contrast } = edgeAt(y);
    const score = coverage * contrast;
    // Ties go to the lower row: the toolbar's bottom, not its tab strip.
    if (coverage >= LINE_COVERAGE && score >= bestScore) {
      bestRow = y;
      bestScore = score;
    }
  }
  if (bestRow < 0) return null;
  // The band ends on the line: crop everything down to and including it.
  if (bestRow === last) return last + 1;
  // A thin divider has its other side right below it; a plain edge doesn't.
  const below = edgeAt(bestRow + 1);
  return below.coverage >= LINE_COVERAGE ? bestRow + 1 : bestRow;
}

function priorAgrees(cropTop: number, browser: KnownBrowser, scale: number): boolean {
  return BROWSER_TOOLBAR_HEIGHTS[browser].some(
    ([min, max]) => cropTop >= min * scale - 2 && cropTop <= max * scale + 2,
  );
}

/** Pick ~`count` evenly spaced sample times across a recording `duration` seconds long. */
export function toolbarSampleTimes(duration: number, count = 20): number[] {
  if (!(duration > 0)) return [0];
  const times: number[] = [];
  for (let i = 0; i < count; i++) times.push((duration * (i + 0.5)) / count);
  return times;
}

export function detectRecordedToolbar(
  frames: RgbaFrame[],
  options: DetectRecordedToolbarOptions = {},
): RecordedToolbarDetection {
  const { displaySurface, mode = 'auto', browser = null, scale = 1 } = options;
  const none = (windowBarDefault: boolean): RecordedToolbarDetection => ({
    action: 'none',
    cropTop: 0,
    windowBarDefault,
    signals: { stableBand: null, line: null, priorAgrees: null },
  });
  // A tab capture has no toolbar in it; a whole screen gets no window bar.
  if (displaySurface === 'browser') return none(true);
  if (displaySurface === 'monitor') return none(false);
  const first = frames[0];
  if (mode === 'off' || !first) return none(true);

  const { height } = first;
  const band = stableBandHeight(frames);
  const line = strongestHorizontalLine(first, band === null ? height * MAX_BAND_SHARE : band - 1);
  const tolerance = Math.max(3, Math.round(height * 0.006));
  const signalsAgree = band !== null && line !== null && Math.abs(line - band) <= tolerance;
  const guess = line ?? band ?? 0;
  const prior = browser && guess > 0 ? priorAgrees(guess, browser, scale) : null;
  const agree = signalsAgree && prior !== false;

  return {
    action:
      mode === 'auto' && agree && guess > 0
        ? 'crop'
        : guess > 0 || mode === 'manual'
          ? 'adjust'
          : 'none',
    cropTop: guess,
    windowBarDefault: true,
    signals: { stableBand: band, line, priorAgrees: prior },
  };
}

/** The crop as render-core's normalized FrameSettings.cropRect. */
export function cropRectForToolbar(cropTop: number, frameHeight: number) {
  const y = Math.min(0.5, Math.max(0, cropTop / Math.max(frameHeight, 1)));
  return { x: 0, y, width: 1, height: 1 - y };
}

/** One crop per video: kept until the recorded window changes size. */
export interface RecordedBarCrop {
  mode: RecordedBarCropMode;
  cropTop: number;
  width: number;
  height: number;
}

export function needsToolbarRedetect(
  crop: RecordedBarCrop | null,
  width: number,
  height: number,
): boolean {
  return !crop || crop.width !== width || crop.height !== height;
}
