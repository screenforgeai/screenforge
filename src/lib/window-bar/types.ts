/**
 * Window bar: a Mac, Windows or browser title bar drawn over the top of a
 * demo video or a capture, so the recording reads as a real window.
 */

export type WindowBarStyle = 'none' | 'mac' | 'windows' | 'browser';
export type WindowBarTheme = 'auto' | 'light' | 'dark';
export type WindowBarCenter = 'url' | 'domain' | 'title' | 'custom' | 'none';

/** What a project's frame (and a style preset) stores. */
export interface WindowBarSettings {
  style: WindowBarStyle;
  theme: WindowBarTheme;
  /** What the address box (Mac, browser) or the title (Windows) shows. */
  center: WindowBarCenter;
  /** Shown when `center` is 'custom'. */
  customText?: string;
}

/** Off, so presets saved before the window bar existed look exactly as before. */
export const DEFAULT_WINDOW_BAR: WindowBarSettings = {
  style: 'none',
  theme: 'auto',
  center: 'url',
};

/** A theme once 'auto' has been decided. */
export type ResolvedWindowBarTheme = 'light' | 'dark';

/** A page the recording showed, from `t` seconds on (video time). */
export interface PageVisit {
  t: number;
  url: string;
  title?: string;
}

/** The page the bar describes: a URL, a title, or both. */
export interface WindowBarPage {
  url?: string;
  title?: string;
}
