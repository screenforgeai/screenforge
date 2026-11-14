/**
 * Links that open Screenforge from outside: a browser after signing in to
 * Director, or Director's "Open in Screenforge". Their own scheme, separate
 * from `screenforge://`, which only serves local files to the app's windows
 * (electron/protocol.ts) and must never be reachable from a web page.
 */
export const APP_LINK_SCHEME = 'screenforge-app';

export type AppLink = { type: 'sign-in' } | { type: 'open-director-demo'; demoId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The action a link asks for, or null for anything Screenforge doesn't handle. */
export function parseAppLink(raw: string): AppLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_LINK_SCHEME}:`) {
    return null;
  }
  // `screenforge-app://sign-in/x` parses as host "sign-in", path "/x".
  const parts = [url.hostname, ...url.pathname.split('/')].filter(Boolean);
  if (parts.length === 1 && parts[0] === 'sign-in') {
    return { type: 'sign-in' };
  }
  if (
    parts.length === 4 &&
    parts[0] === 'director' &&
    parts[1] === 'demos' &&
    UUID.test(parts[2]) &&
    parts[3] === 'open'
  ) {
    return { type: 'open-director-demo', demoId: parts[2].toLowerCase() };
  }
  return null;
}

/**
 * Windows and Linux hand a link to the app on its command line (a cold
 * start, or the second instance that `second-instance` reports).
 */
export function findAppLinkInArgv(argv: readonly string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${APP_LINK_SCHEME}://`)) ?? null;
}
