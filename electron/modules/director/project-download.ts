import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { BUNDLE_FILES } from './project-bundle';

/** GET /desktop/demos/:id/project (screenforgeai/director#280). */
export interface ProjectBundleManifest {
  demoId: string;
  name: string;
  expiresInSeconds: number;
  files: { path: string; url: string }[];
}

export interface DownloadProjectBundleOptions {
  demoId: string;
  /** An authenticated Director GET returning the response's data. */
  request: (path: string) => Promise<ProjectBundleManifest>;
  fetch: typeof globalThis.fetch;
  /** An empty folder for the bundle. */
  dir: string;
  onProgress?: (progress: { filesDone: number; filesTotal: number }) => void;
}

/**
 * Downloads a Director recording's project bundle into `dir`: only the
 * bundle's own file names, only over https, streamed to disk (the
 * recording can be large).
 */
export async function downloadProjectBundle({
  demoId,
  request,
  fetch,
  dir,
  onProgress,
}: DownloadProjectBundleOptions): Promise<{ projectFile: string; name: string }> {
  const manifest = await request(`/desktop/demos/${encodeURIComponent(demoId)}/project`);
  const allowed = new Set<string>(BUNDLE_FILES);
  const files = manifest.files.filter((file) => allowed.has(file.path));
  if (
    !files.some((file) => file.path === 'project.json') ||
    files.some((file) => !/^https:\/\//i.test(file.url))
  ) {
    throw new Error('Director sent no usable project file.');
  }

  await fs.mkdir(dir, { recursive: true });
  let filesDone = 0;
  onProgress?.({ filesDone, filesTotal: files.length });
  for (const file of files) {
    const response = await fetch(file.url);
    if (!response.ok || !response.body) {
      throw new Error(`Downloading ${file.path} failed (${response.status}).`);
    }
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream),
      createWriteStream(path.join(dir, file.path)),
    );
    filesDone += 1;
    onProgress?.({ filesDone, filesTotal: files.length });
  }
  return { projectFile: path.join(dir, 'project.json'), name: manifest.name };
}
