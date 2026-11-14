export interface UnwrappedIpcError {
  /** The IPC channel whose handler failed. */
  channel: string;
  /** The cause's error type, e.g. "TypeError"; null when the handler rejected with a non-Error. */
  name: string | null;
  /** The cause's own message. */
  message: string;
}

const REMOTE_METHOD_WRAPPER = /^Error invoking remote method '([^']+)': ([\s\S]*)$/;
const LEADING_ERROR_NAME = /^((?:[A-Z][A-Za-z0-9]*)?Error): ([\s\S]*)$/;

/**
 * When an ipcRenderer.invoke handler throws, Electron rejects in the renderer
 * with "Error invoking remote method '<channel>': <name>: <message>". Returns
 * the cause underneath, or null when the message isn't wrapped that way.
 */
export function unwrapIpcErrorMessage(message: string): UnwrappedIpcError | null {
  const wrapped = REMOTE_METHOD_WRAPPER.exec(message);
  if (!wrapped) {
    return null;
  }
  const [, channel, cause] = wrapped;
  const named = LEADING_ERROR_NAME.exec(cause);
  return named
    ? { channel, name: named[1], message: named[2] }
    : { channel, name: null, message: cause };
}

/** An error's message as a person should read it, without Electron's IPC wrapper. */
export function readableErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) {
    return fallback;
  }
  return unwrapIpcErrorMessage(error.message)?.message || error.message;
}
