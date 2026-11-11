import { globalShortcut } from 'electron';
import log from '../../lib/logger';
import { CAPTURE_SHORTCUTS, type CaptureShortcutAction } from '../../../src/lib/captureShortcuts';

import type { RegisteredCaptureShortcuts } from '../../../src/types/index';

export type CaptureShortcutHandlers = Record<CaptureShortcutAction, () => void>;

type ShortcutRegistry = Pick<typeof globalShortcut, 'register' | 'unregister'>;

let registered: RegisteredCaptureShortcuts = {};

/**
 * Registers the global capture shortcuts. A shortcut that another app already
 * holds (or that the Wayland portal refuses) fails silently at the OS level,
 * so each failure is logged and that shortcut is simply not offered in the UI.
 */
export function registerCaptureShortcuts(
  handlers: CaptureShortcutHandlers,
  registry: ShortcutRegistry = globalShortcut,
): RegisteredCaptureShortcuts {
  unregisterCaptureShortcuts(registry);

  const next: RegisteredCaptureShortcuts = {};
  for (const action of Object.keys(CAPTURE_SHORTCUTS) as CaptureShortcutAction[]) {
    const accelerator = CAPTURE_SHORTCUTS[action];
    try {
      if (registry.register(accelerator, handlers[action])) {
        next[action] = accelerator;
      } else {
        log.warn('[capture-shortcuts] shortcut is taken by another app', { action, accelerator });
      }
    } catch (error) {
      log.warn('[capture-shortcuts] could not register shortcut', { action, accelerator, error });
    }
  }

  registered = next;
  log.info('[capture-shortcuts] registered', registered);
  return { ...registered };
}

export function unregisterCaptureShortcuts(registry: ShortcutRegistry = globalShortcut): void {
  for (const accelerator of Object.values(registered)) {
    try {
      registry.unregister(accelerator);
    } catch (error) {
      log.warn('[capture-shortcuts] could not unregister shortcut', { accelerator, error });
    }
  }
  registered = {};
}

export function getRegisteredCaptureShortcuts(): RegisteredCaptureShortcuts {
  return { ...registered };
}
