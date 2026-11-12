/**
 * The window bar inside the frame effect: which page it shows at time t,
 * which theme it settled on, and its laid-out shapes. Shared by the Canvas 2D
 * and Pixi pipelines so both draw the same bar.
 */
import { layoutWindowBar, type WindowBarScene } from '../../window-bar/layout';
import { normalizePageVisits, pageAtTime } from '../../window-bar/page';
import {
  AUTO_THEME_SAMPLE_ROWS,
  resolveWindowBarTheme,
  topBandBrightness,
} from '../../window-bar/theme';
import type { PageVisit, ResolvedWindowBarTheme, WindowBarTheme } from '../../window-bar/types';
import type { FrameGeometry } from './analyze';
import { hasWindowBar, isCompactWindowBar } from './analyze';
import type { FrameSettings } from './index';

/** Columns sampled across the top band: plenty for an average. */
const SAMPLE_COLUMNS = 64;

let sampleCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;

/**
 * Average brightness of the top 24 rows of `source` below `top` (the crop's
 * top edge), 0–1. Null when the source can't be read (not loaded yet,
 * tainted, or no canvas in this environment).
 */
export function sampleTopBandBrightness(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  top = 0,
): number | null {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }
  const rows = Math.min(AUTO_THEME_SAMPLE_ROWS, Math.max(1, sourceHeight - top));
  try {
    if (!sampleCanvas) {
      sampleCanvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(SAMPLE_COLUMNS, AUTO_THEME_SAMPLE_ROWS)
          : document.createElement('canvas');
      sampleCanvas.width = SAMPLE_COLUMNS;
      sampleCanvas.height = AUTO_THEME_SAMPLE_ROWS;
    }
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) {
      return null;
    }
    ctx.clearRect(0, 0, SAMPLE_COLUMNS, AUTO_THEME_SAMPLE_ROWS);
    ctx.drawImage(source, 0, top, sourceWidth, rows, 0, 0, SAMPLE_COLUMNS, rows);
    const { data } = ctx.getImageData(0, 0, SAMPLE_COLUMNS, rows);
    return topBandBrightness(data, SAMPLE_COLUMNS, rows, rows);
  } catch {
    return null;
  }
}

export interface WindowBarFrameState {
  pageVisits?: PageVisit[] | null;
  /** A theme the host already decided; otherwise 'auto' samples the first frame. */
  windowBarTheme?: ResolvedWindowBarTheme | null;
}

/**
 * One per pipeline instance (one video). Decides 'auto' once, from the
 * first frame it can read, and keeps it for the whole video.
 */
export class WindowBarPainter {
  private decidedTheme: ResolvedWindowBarTheme | null = null;
  private visitsRef: PageVisit[] | null | undefined = undefined;
  private visits: PageVisit[] = [];

  /** The bar to draw at `t`, in canvas px of the window's width; null for none. */
  sceneAt(
    frame: FrameSettings,
    geometry: Pick<FrameGeometry, 'windowRect' | 'barHeight'>,
    t: number,
    state: WindowBarFrameState,
    sampleFirstFrame: () => number | null,
  ): WindowBarScene | null {
    const settings = frame.windowBar;
    if (!settings || !hasWindowBar(frame) || geometry.barHeight <= 0) {
      return null;
    }
    if (state.pageVisits !== this.visitsRef) {
      this.visitsRef = state.pageVisits;
      this.visits = normalizePageVisits(state.pageVisits);
    }
    const theme = this.themeFor(settings.theme, state.windowBarTheme, sampleFirstFrame);
    const { page, previous, mix } = pageAtTime(this.visits, t);
    return layoutWindowBar({
      settings,
      theme,
      width: geometry.windowRect.width,
      page,
      previousPage: previous,
      mix,
      compact: isCompactWindowBar(frame),
    });
  }

  private themeFor(
    theme: WindowBarTheme,
    hostTheme: ResolvedWindowBarTheme | null | undefined,
    sample: () => number | null,
  ): ResolvedWindowBarTheme {
    if (theme !== 'auto') {
      return theme;
    }
    if (hostTheme) {
      return hostTheme;
    }
    if (this.decidedTheme) {
      return this.decidedTheme;
    }
    const brightness = sample();
    // Nothing readable yet: light for now, and try again next frame.
    if (brightness === null) {
      return 'light';
    }
    this.decidedTheme = resolveWindowBarTheme('auto', brightness);
    return this.decidedTheme;
  }
}
