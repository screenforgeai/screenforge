import { globalShortcut } from 'electron';
import log from '../../lib/logger';
import { CAPTURE_SHORTCUTS, type CaptureShortcutAction } from '../../../src/lib/captureShortcuts';

import type { RegisteredCaptureShortcuts } from '../../../src/types/index';

export type CaptureShortcutHandlers = Record<CaptureShortcutAction, () => void>;

type ShortcutRegistry = Pick<typeof globalShortcut, 'register' | 'unregister'>;

/** Accelerators this module holds, so they can be released. */
let held: string[] = [];
/** The subset reported to the UI as working. */
let registered: RegisteredCaptureShortcuts = {};

type RegisterOptions = {
  /**
   * False where a successful register() doesn't prove the shortcut works:
   * on Wayland, Electron 45 reports success before the GlobalShortcuts portal
   * answers, and a denied bind is never reported (electron#52218). Those
   * shortcuts stay registered but aren't advertised.
   */
  canConfirm?: boolean;
};

/**
 * Registers the global capture shortcuts. A shortcut that another app already
 * holds (or that the Wayland portal refuses) fails silently at the OS level,
 * so each failure is logged and that shortcut is simply not offered in the UI.
 */
export function registerCaptureShortcuts(
  handlers: CaptureShortcutHandlers,
  registry: ShortcutRegistry = globalShortcut,
  { canConfirm = true }: RegisterOptions = {},
): RegisteredCaptureShortcuts {
  unregisterCaptureShortcuts(registry);

  const next: RegisteredCaptureShortcuts = {};
  for (const action of Object.keys(CAPTURE_SHORTCUTS) as CaptureShortcutAction[]) {
    const accelerator = CAPTURE_SHORTCUTS[action];
    try {
      if (registry.register(accelerator, handlers[action])) {
        held.push(accelerator);
        if (canConfirm) {
          next[action] = accelerator;
        }
      } else {
        log.warn('[capture-shortcuts] shortcut is taken by another app', { action, accelerator });
      }
    } catch (error) {
      log.warn('[capture-shortcuts] could not register shortcut', { action, accelerator, error });
    }
  }

  registered = next;
  log.info('[capture-shortcuts] registered', { held, advertised: registered });
  return { ...registered };
}

export function unregisterCaptureShortcuts(registry: ShortcutRegistry = globalShortcut): void {
  for (const accelerator of held) {
    try {
      registry.unregister(accelerator);
    } catch (error) {
      log.warn('[capture-shortcuts] could not unregister shortcut', { accelerator, error });
    }
  }
  held = [];
  registered = {};
}

export function getRegisteredCaptureShortcuts(): RegisteredCaptureShortcuts {
  return { ...registered };
}

/**
 * The toolbar's own recording state. Its countdown, and the moment between
 * the countdown and the capture starting, aren't visible to isRecordingBusy(),
 * and a shortcut screenshot then would close the toolbar mid-recording.
 */
let toolbarRecording = false;

export function setToolbarRecording(active: boolean): void {
  toolbarRecording = active;
}

export function isToolbarRecording(): boolean {
  return toolbarRecording;
}
