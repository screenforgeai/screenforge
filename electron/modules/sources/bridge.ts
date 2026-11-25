import { CH } from '../../channels';
import { createInvokeBridge, createVoidSubscription } from '../../lib/ipc-renderer';
import type {
  AreaSelectorStillRequest,
  DesktopSource,
  DisplayInfo,
} from '../../../src/types/index';

export const sourcesBridge = {
  getSources: createInvokeBridge<[], DesktopSource[]>(CH.sources.GET),
  /** The attached displays, in OS order. Cheap: it captures nothing, so it can be asked often. */
  getDisplays: createInvokeBridge<[], DisplayInfo[]>(CH.sources.DISPLAYS),
  /** The screen source that shows a display, or null when the screens can't be listed. */
  getScreenSourceForDisplay: createInvokeBridge<[displayId: number], string | null>(
    CH.sources.SOURCE_FOR_DISPLAY,
  ),
  /**
   * Wayland: what the next screen-share dialog asks for, a screen or a window. Awaited, so it is
   * stored before the share request that reads it.
   */
  setShareKind: createInvokeBridge<['screen' | 'window'], void>(CH.sources.SET_SHARE_KIND),
  /**
   * Wayland: picks a screen in the system share dialog through the capture helper, which records
   * it without the system pointer. 'unavailable' when the helper can't run here: the screen is
   * then shared through Chromium instead.
   */
  pickScreen: createInvokeBridge<[], 'picked' | 'cancelled' | 'unavailable'>(
    CH.sources.PICK_SCREEN,
  ),
  /** Wayland: the screen picked with pickScreen as it looks now, to draw an area on. */
  screenStill: createInvokeBridge<[], AreaSelectorStillRequest>(CH.sources.SCREEN_STILL),
  /** Wayland: lets the screen picked with pickScreen go. */
  endShare: createInvokeBridge<[], void>(CH.sources.END_SHARE),
  /** Wayland: the screen picked with pickScreen stopped being shared from outside the app. */
  onShareEnded: createVoidSubscription(CH.sources.SHARE_ENDED),
};
