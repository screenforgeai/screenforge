import path from 'node:path';
import type { PendingShareUpload, ProjectShareLink } from '../../../src/types/index';

/** The part of node:fs/promises the store uses. */
export interface ShareStoreFs {
  readFile(filePath: string, encoding: 'utf8'): Promise<string>;
  writeFile(filePath: string, data: string, encoding: 'utf8'): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mkdir(dir: string, options: { recursive: true }): Promise<unknown>;
}

interface ShareData {
  uploads: PendingShareUpload[];
  /** Keyed by project id. */
  links: Record<string, ProjectShareLink>;
}

const empty = (): ShareData => ({ uploads: [], links: {} });

/**
 * Share links and unfinished uploads, kept as JSON in userData. Holds no
 * token; every change is written whole, through a temp file.
 */
export function createShareStore({ filePath, fs }: { filePath: string; fs: ShareStoreFs }) {
  let data: ShareData | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const load = async (): Promise<ShareData> => {
    if (data) {
      return data;
    }
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<ShareData>;
      data = {
        uploads: Array.isArray(parsed.uploads) ? parsed.uploads : [],
        links: parsed.links && typeof parsed.links === 'object' ? parsed.links : {},
      };
    } catch {
      data = empty();
    }
    return data;
  };

  /** Runs changes one at a time, so two never overwrite each other. */
  const change = (mutate: (current: ShareData) => ShareData): Promise<void> => {
    const next = queue.then(async () => {
      const updated = mutate(await load());
      data = updated;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.tmp`;
      await fs.writeFile(temp, JSON.stringify(updated), 'utf8');
      await fs.rename(temp, filePath);
    });
    queue = next.catch(() => undefined);
    return next;
  };

  const read = async () => {
    await queue;
    return load();
  };

  return {
    async getUploads(): Promise<PendingShareUpload[]> {
      return [...(await read()).uploads];
    },
    async findUpload(
      by: { filePath: string } | { projectId: string },
    ): Promise<PendingShareUpload | null> {
      const { uploads } = await read();
      return (
        uploads.find((u) =>
          'filePath' in by ? u.filePath === by.filePath : u.projectId === by.projectId,
        ) ?? null
      );
    },
    putUpload(upload: PendingShareUpload): Promise<void> {
      return change((current) => ({
        ...current,
        uploads: [
          ...current.uploads.filter(
            (u) => u.filePath !== upload.filePath && u.shareId !== upload.shareId,
          ),
          upload,
        ],
      }));
    },
    removeUpload(shareId: string): Promise<void> {
      return change((current) => ({
        ...current,
        uploads: current.uploads.filter((u) => u.shareId !== shareId),
      }));
    },
    async getLinks(): Promise<Record<string, ProjectShareLink>> {
      return { ...(await read()).links };
    },
    setLink(projectId: string, link: ProjectShareLink): Promise<void> {
      return change((current) => ({ ...current, links: { ...current.links, [projectId]: link } }));
    },
    removeLink(projectId: string): Promise<void> {
      return change((current) => {
        const links = { ...current.links };
        delete links[projectId];
        return { ...current, links };
      });
    },
    updateLinks(
      mutate: (links: Record<string, ProjectShareLink>) => Record<string, ProjectShareLink>,
    ): Promise<void> {
      return change((current) => ({ ...current, links: mutate({ ...current.links }) }));
    },
  };
}

export type ShareStore = ReturnType<typeof createShareStore>;
