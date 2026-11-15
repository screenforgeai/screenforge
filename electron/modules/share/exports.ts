import path from 'node:path';

/** Enough of a file's identity to know it's the same one later. */
export interface FileIdentity {
  size: number;
  mtimeMs: number;
  /** Device and inode: absent where only size and time are known. */
  dev?: number;
  ino?: number;
}

/** Same size and time, and the same device and inode when both sides have them. */
export function sameFile(expected: FileIdentity, actual: FileIdentity): boolean {
  if (expected.size !== actual.size || expected.mtimeMs !== actual.mtimeMs) {
    return false;
  }
  if (
    expected.dev !== undefined &&
    expected.ino !== undefined &&
    actual.dev !== undefined &&
    actual.ino !== undefined
  ) {
    return expected.dev === actual.dev && expected.ino === actual.ino;
  }
  return true;
}

/**
 * The files this run of the app exported. Sharing uploads a file to Director,
 * so it's limited to these (and to uploads already under way): a compromised
 * renderer can't name any other .mp4 or .webm on disk and get it uploaded.
 */
export function createExportRegistry() {
  const files = new Map<string, FileIdentity>();
  return {
    remember(filePath: string, identity: FileIdentity): void {
      files.set(path.resolve(filePath), identity);
    },
    known(filePath: string): FileIdentity | null {
      return files.get(path.resolve(filePath)) ?? null;
    },
    matches(filePath: string, identity: FileIdentity): boolean {
      const known = files.get(path.resolve(filePath));
      return !!known && sameFile(known, identity);
    },
  };
}

export type ExportRegistry = ReturnType<typeof createExportRegistry>;

/** The app's one registry: the export channel fills it, the share manager reads it. */
export const exportedFiles = createExportRegistry();
