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
  await fs.copyFile(sourcePath, destinationPath);
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

  const [filePathPersisted, audioPathPersisted, cameraPathPersisted] = await Promise.all([
    persistProjectAsset(normalized.id, 'recording', normalized.result.filePath),
    persistProjectAsset(normalized.id, 'audio', normalized.result.audioPath),
    persistProjectAsset(normalized.id, 'camera', normalized.result.cameraPath),
  ]);

  const persisted = normalizeSavedProject({
    ...normalized,
    result: {
      ...normalized.result,
      filePath: filePathPersisted ?? normalized.result.filePath,
      audioPath: audioPathPersisted,
      cameraPath: cameraPathPersisted,
    },
  });

  await fs.writeFile(filePath, JSON.stringify(persisted), 'utf8');

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
