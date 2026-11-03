import type { KeyboardCaptionBackground, KeyboardCaptionSize } from '../../../types';

export const KEYBOARD_CAPTION_SIZE_OPTIONS: Array<{
  value: KeyboardCaptionSize;
  label: string;
}> = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

export const KEYBOARD_CAPTION_BACKGROUND_OPTIONS: Array<{
  value: KeyboardCaptionBackground;
  label: string;
}> = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

export interface KeyboardCaptionPalette {
  panelColor: number;
  panelAlpha: number;
  panelBorderColor: number;
  panelBorderAlpha: number;
  textColor: number;
  shadowColor: number;
  shadowAlpha: number;
  shadowBlur: number;
  shadowDistance: number;
}

export function resolveKeyboardCaptionSize(size: KeyboardCaptionSize): number {
  switch (size) {
    case 'small':
      return 0.86;
    case 'large':
      return 1.18;
    case 'medium':
    default:
      return 1;
  }
}

export function resolveKeyboardCaptionPalette(
  background: KeyboardCaptionBackground,
): KeyboardCaptionPalette {
  switch (background) {
    case 'light':
      return {
        panelColor: 0xfbfbfa,
        panelAlpha: 0.94,
        panelBorderColor: 0x2f3437,
        panelBorderAlpha: 0.1,
        textColor: 0x111111,
        shadowColor: 0x000000,
        shadowAlpha: 0.18,
        shadowBlur: 20,
        shadowDistance: 6,
      };
    case 'dark':
    default:
      return {
        panelColor: 0x0d1117,
        panelAlpha: 0.97,
        panelBorderColor: 0xfbfbfa,
        panelBorderAlpha: 0.14,
        textColor: 0xffffff,
        shadowColor: 0x000000,
        shadowAlpha: 0.44,
        shadowBlur: 22,
        shadowDistance: 6,
      };
  }
}

export function colorToRgba(color: number, alpha: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
