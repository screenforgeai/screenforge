import type { AreaSelectorStillRequest } from '../../../src/types/index';

/** The largest still accepted: bigger than any screen, small enough to show. */
const MAX_SIDE = 16_384;
const MAX_BYTES = 200 * 1024 * 1024;

function isSide(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_SIDE;
}

/** A still sent by the toolbar (Wayland), checked before it is shown full screen; null if not one. */
export function toAreaSelectorStill(value: unknown): AreaSelectorStillRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const { png, width, height } = value as Record<string, unknown>;
  if (
    !(png instanceof Uint8Array) ||
    png.byteLength === 0 ||
    png.byteLength > MAX_BYTES ||
    !isSide(width) ||
    !isSide(height)
  ) {
    return null;
  }
  return { png, width, height };
}
