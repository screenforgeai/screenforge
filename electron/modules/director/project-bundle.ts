import fs from 'node:fs/promises';
import path from 'node:path';
import type { SavedProject, StoredProjectLike } from '../../../src/types/index';

/** A Director project bundle's files, by the names its project file uses. */
export const BUNDLE_FILES = ['project.json', 'recording.mp4', 'narration.wav'] as const;

export type ProjectBundleFailure = 'invalid' | 'missing-recording';

export class ProjectBundleError extends Error {
  constructor(
    readonly reason: ProjectBundleFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectBundleError';
  }
}

/** Director's project file: Screenforge's own shape, with bundle-relative paths. */
type BundleProject = StoredProjectLike & {
  captureViewport?: { width: number; height: number };
  captureScale?: number;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A bare file name in the bundle's own folder, or null. */
function bundleName(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return path.basename(value) === value && value !== '.' && value !== '..' ? value : null;
}

async function exists(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then((stat) => stat.isFile())
    .catch(() => false);
}

/**
 * Reads a project bundle (screenforgeai/screenforge#28): a project file next
 * to its recording and, optionally, narration. Paths in the file are names
 * in the bundle's folder; anything else is refused, so a bundle can never
 * point the library at another file on disk. Returns the project with
 * absolute paths, ready for the library to copy in.
 */
export async function readProjectBundle(projectFile: string): Promise<BundleProject> {
  const invalid = (detail: string) =>
    new ProjectBundleError('invalid', `This isn't a Screenforge project: ${detail}.`);
  const dir = path.dirname(projectFile);

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  } catch {
    throw invalid('the project file could not be read');
  }
  if (!isObject(parsed) || !isObject(parsed.result)) {
    throw invalid('it has no recording');
  }
  const result = parsed.result;
  const area = result.recordingArea;
  if (
    !Array.isArray(result.mouseData) ||
    typeof result.duration !== 'number' ||
    typeof result.startTime !== 'number' ||
    !isObject(area) ||
    typeof area.width !== 'number' ||
    typeof area.height !== 'number'
  ) {
    throw invalid('its recording is incomplete');
  }
  if (parsed.zoomClips !== undefined && !Array.isArray(parsed.zoomClips)) {
    throw invalid('its zoom clips are unreadable');
  }

  const recordingName = bundleName(result.filePath);
  if (!recordingName) {
    throw invalid('its recording is outside the project folder');
  }
  const recordingPath = path.join(dir, recordingName);
  if (!(await exists(recordingPath))) {
    throw new ProjectBundleError('missing-recording', 'The project’s recording is missing.');
  }

  // Narration is optional: a missing or misplaced one opens without audio.
  const audioName = result.audioPath === undefined ? null : bundleName(result.audioPath);
  const audioPath =
    audioName && (await exists(path.join(dir, audioName))) ? path.join(dir, audioName) : undefined;

  const project = parsed as unknown as BundleProject;
  const resolved: BundleProject['result'] = { ...project.result, filePath: recordingPath };
  delete resolved.audioPath;
  if (audioPath) {
    resolved.audioPath = audioPath;
  }
  return {
    ...project,
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : 'Director demo',
    zoomClips: project.zoomClips ?? [],
    result: resolved,
  };
}

/** The bundle as a library project under its own id, saved now. */
export function toLibraryProject(
  project: BundleProject,
  id: string,
  savedAt = new Date().toISOString(),
): SavedProject {
  return { ...project, id, savedAt, thumbnail: project.thumbnail ?? '' } as SavedProject;
}
