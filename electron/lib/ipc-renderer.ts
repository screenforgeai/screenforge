import { ipcRenderer } from 'electron';

export function createInvokeBridge<Args extends unknown[], Result>(channel: string) {
  return (...args: Args): Promise<Result> =>
    ipcRenderer.invoke(channel, ...args) as Promise<Result>;
}

export function createSendBridge<Args extends unknown[]>(channel: string) {
  return (...args: Args): void => {
    ipcRenderer.send(channel, ...args);
  };
}

export function createSubscription<Payload>(channel: string) {
  return (cb: (payload: Payload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Payload) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

export function createVoidSubscription(channel: string) {
  return (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}
