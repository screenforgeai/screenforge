import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { SavedProject, StoredProjectLike } from '../../../src/types/index';
import { normalizeSavedProject } from '../../../src/lib/effects/frame';

const projectsDir = () => path.join(app.getPath('userData'), 'projects');
const projectAssetsDir = () => path.join(projectsDir(), 'assets');

type ManagedAssetKind = 'recording' | 'audio' | 'camera';

function getManagedAssetStem(projectId: string, kind: ManagedAssetKind): string {
  switch (kind) {
    case 'recording':
      return projectId;
    case 'audio':
      return `${projectId}-audio`;
    case 'camera':
      return `${projectId}-camera`;
  }
}

function getFallbackExtension(kind: ManagedAssetKind): string {
  switch (kind) {
    case 'recording':
    case 'audio':
    case 'camera':
      return '.webm';
  }
}

async function removeManagedAssetVariants(
  projectId: string,
  kind: ManagedAssetKind,
  keepPath?: string,
): Promise<void> {
  const dir = projectAssetsDir();
  const stem = getManagedAssetStem(projectId, kind);
  const keepName = keepPath ? path.basename(keepPath) : null;
  const files = await fs.readdir(dir).catch(() => []);

  await Promise.all(
    files
      .filter((name) => name.startsWith(`${stem}.`) && name !== keepName)
      .map((name) => fs.unlink(path.join(dir, name)).catch(() => undefined)),
  );
}

/**
 * Whether the destination already holds a finished copy of the source. A fresh
 * recording keeps playing from its temp file, so every autosave passes the
 * temp path again; without this each save re-copied the whole video. A copy is
 * never older than its source (copyFile either stamps it now or keeps the
 * source's times), and one cut short has the wrong size.
 */
async function isCopyOf(sourcePath: string, destinationPath: string): Promise<boolean> {
  const [source, destination] = await Promise.all([
    fs.stat(sourcePath),
    fs.stat(destinationPath).catch(() => null),
  ]);
  return (
    destination !== null &&
    destination.size === source.size &&
    destination.mtimeMs >= source.mtimeMs
  );
}

async function persistProjectAsset(
  projectId: string,
  kind: ManagedAssetKind,
  sourcePath: string | undefined,
): Promise<string | undefined> {
  if (!sourcePath) {
    await removeManagedAssetVariants(projectId, kind);
    return undefined;
  }

  await fs.mkdir(projectAssetsDir(), { recursive: true });

  const extension = path.extname(sourcePath) || getFallbackExtension(kind);
  const destinationPath = path.join(
    projectAssetsDir(),
    `${getManagedAssetStem(projectId, kind)}${extension}`,
  );

  if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
    await removeManagedAssetVariants(projectId, kind, destinationPath);
    return destinationPath;
  }

  await removeManagedAssetVariants(projectId, kind, destinationPath);
  if (!(await isCopyOf(sourcePath, destinationPath))) {
    // A copy-on-write clone where the file system can (APFS, Btrfs, ReFS):
    // instant for a multi-GB recording. Falls back to a plain copy elsewhere.
    await fs.copyFile(sourcePath, destinationPath, fsConstants.COPYFILE_FICLONE);
  }
  return destinationPath;
}

export async function initializeLibrary(): Promise<void> {
  await fs.mkdir(projectAssetsDir(), { recursive: true });
}

export async function getProjects(): Promise<SavedProject[]> {
  const dir = projectsDir();

  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    const projects = await Promise.all(
      jsonFiles.map(async (f) => {
        const raw = await fs.readFile(path.join(dir, f), 'utf8');
        return normalizeSavedProject(JSON.parse(raw) as StoredProjectLike);
      }),
    );
    return projects.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

export async function saveProject(project: SavedProject): Promise<SavedProject> {
  const dir = projectsDir();
  const filePath = path.join(dir, `${project.id}.json`);
  const normalized = normalizeSavedProject(project);

  await initializeLibrary();

  const { filePath: sourceFilePath, audioPath, cameraPath } = normalized.result;
  const [filePathPersisted, cameraPathPersisted] = await Promise.all([
    persistProjectAsset(normalized.id, 'recording', sourceFilePath),
    persistProjectAsset(normalized.id, 'camera', cameraPath),
  ]);
  // With the mic merged in, the audio track is the recording itself: point at
  // the one copy instead of copying the whole video a second time.
  const audioIsRecording =
    audioPath !== undefined &&
    [sourceFilePath, filePathPersisted].some(
      (candidate) => candidate && path.resolve(candidate) === path.resolve(audioPath),
    );
  const audioPathPersisted = audioIsRecording
    ? await removeManagedAssetVariants(normalized.id, 'audio').then(() => filePathPersisted)
    : await persistProjectAsset(normalized.id, 'audio', audioPath);

  const persisted = normalizeSavedProject({
    ...normalized,
    result: {
      ...normalized.result,
      filePath: filePathPersisted ?? normalized.result.filePath,
      audioPath: audioPathPersisted,
      cameraPath: cameraPathPersisted,
    },
  });

  // Through a temp file and a rename, so a crash mid-write can't corrupt the project.
  const tempFilePath = `${filePath}.tmp`;
  await fs.writeFile(tempFilePath, JSON.stringify(persisted), 'utf8');
  await fs.rename(tempFilePath, filePath);

  return persisted;
}

export async function deleteProject(id: string): Promise<void> {
  const filePath = path.join(projectsDir(), `${id}.json`);

  await Promise.all([
    fs.unlink(filePath).catch(() => {
      /* ignore missing file */
    }),
    removeManagedAssetVariants(id, 'recording'),
    removeManagedAssetVariants(id, 'audio'),
    removeManagedAssetVariants(id, 'camera'),
  ]);
}
