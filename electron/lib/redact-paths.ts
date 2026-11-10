import os from 'node:os';

/**
 * Keeps the user's name out of anything sent off the machine: error messages
 * often carry file paths, and a path under the home folder carries the name.
 */

// "/Users/<name>" and "/home/<name>", but not "/home/..." inside a URL.
const UNIX_PROFILE = /(?<![\w.-])\/(?:Users|home)\/[^/\\\s'"`]+/g;
// "C:\Users\<name>" (or with forward slashes). Windows names can contain spaces.
const WINDOWS_PROFILE = /\b[A-Za-z]:[\\/]Users[\\/][^\\/'"`\n]+/gi;

const MAX_DEPTH = 6;

export function redactUserPaths(text: string, home: string = os.homedir()): string {
  let out = text;
  if (home && home.length > 1) {
    out = out.split(home).join('~');
  }
  return out.replace(UNIX_PROFILE, '~').replace(WINDOWS_PROFILE, '~');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** `redactUserPaths` applied to every string in plain objects and arrays. */
export function redactUserPathsDeep<T>(value: T, home?: string, depth = 0): T {
  if (typeof value === 'string') {
    return redactUserPaths(value, home) as T;
  }
  if (depth >= MAX_DEPTH) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactUserPathsDeep(item, home, depth + 1)) as T;
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactUserPathsDeep(item, home, depth + 1)]),
    ) as T;
  }
  return value;
}
