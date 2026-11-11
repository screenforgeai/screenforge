/**
 * Global capture shortcuts, as Electron accelerators. Shared by the main
 * process (which registers them) and the renderer (which shows them in
 * tooltips and the Shortcuts dialog).
 *
 * Alt+Shift mirrors Windows' Win+Shift+S / Win+Shift+R (apps can't take the
 * Win key) and keeps clear of macOS ⌘⇧3/4/5 and the browser shortcuts that
 * Ctrl/⌘+Shift letters collide with.
 */
export const CAPTURE_SHORTCUTS = {
  /** Opens the area selector and takes a screenshot of the selection. */
  screenshot: 'Alt+Shift+S',
  /** Opens the toolbar, ready to record video. */
  record: 'Alt+Shift+R',
} as const;

export type CaptureShortcutAction = keyof typeof CAPTURE_SHORTCUTS;

const MAC_KEYS: Record<string, string> = {
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Command: '⌘',
  Cmd: '⌘',
  CommandOrControl: '⌘',
  CmdOrCtrl: '⌘',
  Control: '⌃',
  Ctrl: '⌃',
};

const PC_KEYS: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  CmdOrCtrl: 'Ctrl',
  Control: 'Ctrl',
};

/** Splits an accelerator into the keys a user presses, written for their platform. */
export const shortcutKeys = (accelerator: string, isMac: boolean): string[] =>
  accelerator.split('+').map((key) => (isMac ? MAC_KEYS[key] : PC_KEYS[key]) ?? key);

/** An accelerator as one label: "⌥⇧S" on macOS, "Alt+Shift+S" elsewhere. */
export const formatShortcut = (accelerator: string, isMac: boolean): string =>
  shortcutKeys(accelerator, isMac).join(isMac ? '' : '+');
