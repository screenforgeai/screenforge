import type { DesktopSource } from '../../types/index';
import { WAYLAND_PICKED_SCREEN_ID } from './waylandPicker';

/** The screens that are real monitors (Wayland's synthetic one is picked in the share dialog). */
export function listChoosableScreens(sources: readonly DesktopSource[]): DesktopSource[] {
  return sources.filter(
    (source) => source.id.startsWith('screen:') && source.id !== WAYLAND_PICKED_SCREEN_ID,
  );
}

/**
 * The screen to record: the one chosen while it is still attached, else the main display, else
 * the first. Null when no screen is listed.
 */
export function resolveChosenScreen(
  screens: readonly DesktopSource[],
  chosenId: string | null,
): DesktopSource | null {
  const choosable = listChoosableScreens(screens);
  return (
    (chosenId ? choosable.find((source) => source.id === chosenId) : undefined) ??
    choosable.find((source) => source.isPrimary) ??
    choosable[0] ??
    null
  );
}

/** "2560 × 1440", the screen's size in DIPs, or null when it is not known. */
export function formatScreenSize(source: DesktopSource): string | null {
  const size = source.displaySize;
  return size ? `${size.width} × ${size.height}` : null;
}
