import type { ResolvedWindowBarTheme, WindowBarStyle } from './types';

/** Sizes are for a 1280px-wide window and scale with the window's width. */
export const REFERENCE_WINDOW_WIDTH = 1280;
export const MIN_BAR_HEIGHT = 24;
export const MAX_BAR_HEIGHT = 72;

/** Bar height at the reference width, per style. */
export const BASE_BAR_HEIGHT: Record<Exclude<WindowBarStyle, 'none'>, number> = {
  mac: 36,
  windows: 36,
  browser: 40,
};

export interface WindowBarColors {
  bar: string;
  divider: string;
  address: string;
  addressEdge: string;
  text: string;
  /** Browser arrows and Windows controls. */
  icon: string;
}

export const WINDOW_BAR_COLORS: Record<ResolvedWindowBarTheme, WindowBarColors> = {
  light: {
    bar: '#F2F3F5',
    divider: '#DFE2E6',
    address: '#FFFFFF',
    addressEdge: '#DFE2E6',
    text: '#3F4652',
    icon: '#5B6472',
  },
  dark: {
    bar: '#2B2D32',
    divider: '#17181B',
    address: '#1E2024',
    addressEdge: '#3A3D43',
    text: '#D3D6DC',
    icon: '#A3A9B3',
  },
};

/** Close, minimize, zoom. The same in both themes. */
export const MAC_DOT_COLORS = ['#FF5F57', '#FEBC2E', '#28C840'] as const;
/** The dots' 0.5px inner edge, so they hold up on a light bar. */
export const MAC_DOT_EDGE = 'rgba(0,0,0,0.18)';

/** Inter, never SF Pro: it ships everywhere we render. */
export const WINDOW_BAR_FONT = "Inter, 'Inter Variable', system-ui, sans-serif";
export const WINDOW_BAR_FONT_WEIGHT = 500;

/** How long the address takes to crossfade to the next page, in seconds. */
export const PAGE_CROSSFADE_SECONDS = 0.15;
