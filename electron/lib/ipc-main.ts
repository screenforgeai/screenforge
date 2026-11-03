import { ipcMain, type WebContents } from 'electron';

export function handleChannel<Args extends unknown[], Result>(
  channel: string,
  handler: (...args: Args) => Result | Promise<Result>,
): void {
  // Dev reload safety: replace existing handler instead of throwing
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, (_event, ...args: Args) => handler(...args));
}

export function handleChannelWithSender<Args extends unknown[], Result>(
  channel: string,
  handler: (sender: WebContents, ...args: Args) => Result | Promise<Result>,
): void {
  // Dev reload safety: replace existing handler instead of throwing
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, (event, ...args: Args) => handler(event.sender, ...args));
}

// Track wrappers so re-registration (dev hot-reload) removes the old listener first.
const listenChannelWrappers = new Map<string, (...args: unknown[]) => void>();

export function listenChannel<Args extends unknown[]>(
  channel: string,
  handler: (...args: Args) => void,
): void {
  const existing = listenChannelWrappers.get(channel);
  if (existing) {
    ipcMain.removeListener(channel, existing);
  }
  const wrapper = (_event: Electron.IpcMainEvent, ...args: Args) => handler(...args);
  listenChannelWrappers.set(channel, wrapper as (...args: unknown[]) => void);
  ipcMain.on(channel, wrapper);
}
