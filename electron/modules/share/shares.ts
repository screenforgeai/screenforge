import path from 'node:path';
import { DirectorApiError } from '../director/client';
import type { DirectorShare, ShareApi } from './api';
import type { ShareStore } from './store';
import {
  partRange,
  PartUploadError,
  uploadParts,
  type ByteSource,
  type UploadedPart,
} from './upload';
import type {
  PendingShareUpload,
  ProjectShareLink,
  ShareActionResult,
  ShareContentType,
  ShareErrorCode,
  ShareJobState,
  ShareLibrary,
  ShareRequest,
} from '../../../src/types/index';

/** Director takes files up to 4 GiB; checked here before asking it. */
export const MAX_SHARE_BYTES = 4 * 1024 * 1024 * 1024;

const MAX_TITLE_LENGTH = 200;
const PROGRESS_INTERVAL_MS = 100;

export interface ShareManagerDeps {
  api: ShareApi;
  store: ShareStore;
  fetch: typeof globalThis.fetch;
  stat: (filePath: string) => Promise<{ size: number; mtimeMs: number } | null>;
  openSource: (filePath: string) => Promise<{ source: ByteSource; close: () => Promise<void> }>;
  writeClipboard: (text: string) => void;
  onState: (state: ShareJobState) => void;
  onLibrary: (library: ShareLibrary) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function contentTypeFor(filePath: string): ShareContentType | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4') {
    return 'video/mp4';
  }
  if (ext === '.webm') {
    return 'video/webm';
  }
  return null;
}

export function shareErrorCode(err: unknown): ShareErrorCode {
  if (err instanceof PartUploadError) {
    // Network, or a signed URL that expired: resuming re-signs the parts left.
    return 'interrupted';
  }
  if (!(err instanceof DirectorApiError)) {
    return 'failed';
  }
  if (err.status === 0) {
    return 'interrupted';
  }
  if (err.status === 401) {
    return 'signed-out';
  }
  if (err.code === 'SHARE_TOO_LONG') {
    return 'too-long';
  }
  if (err.code === 'SHARE_LIMIT_REACHED') {
    return 'limit-reached';
  }
  if (err.status === 413 || /TOO_LARGE/.test(err.code)) {
    return 'too-large';
  }
  if (err.status === 404) {
    return 'not-found';
  }
  return 'failed';
}

const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError';

const cleanTitle = (title: string) =>
  title.trim().slice(0, MAX_TITLE_LENGTH) || 'Screenforge recording';

/**
 * Hosted share links (screenforgeai/screenforge#26): uploads an exported
 * video to Director, copies its link, and keeps each project's link for the
 * library. One share runs at a time; an interrupted one resumes when the
 * same unchanged file is shared again.
 */
export function createShareManager(deps: ShareManagerDeps) {
  const now = deps.now ?? Date.now;
  let state: ShareJobState = { status: 'idle' };
  let active: AbortController | null = null;

  const setState = (next: ShareJobState) => {
    state = next;
    deps.onState(next);
  };

  /** Shows a live link whose expiry has passed as expired, even offline. */
  const withLocalExpiry = (link: ProjectShareLink): ProjectShareLink =>
    link.status === 'live' && link.expiresAt && Date.parse(link.expiresAt) <= now()
      ? { ...link, status: 'expired' }
      : link;

  const toLink = (share: DirectorShare, title: string, justCompleted = false): ProjectShareLink => {
    const status: ProjectShareLink['status'] =
      share.status === 'expired'
        ? 'expired'
        : share.status === 'live' || (justCompleted && share.status !== 'removed')
          ? 'live'
          : 'removed';
    return withLocalExpiry({
      shareId: share.id,
      title: share.title || title,
      watchUrl: share.watchUrl,
      expiresAt: share.expiresAt,
      status,
      sharedAt: share.sharedAt,
    });
  };

  const getLibrary = async (): Promise<ShareLibrary> => {
    const [links, uploads] = await Promise.all([deps.store.getLinks(), deps.store.getUploads()]);
    const pending: ShareLibrary['pending'] = {};
    for (const upload of uploads) {
      if (upload.projectId) {
        pending[upload.projectId] = {
          fileName: path.basename(upload.filePath),
          sizeBytes: upload.sizeBytes,
        };
      }
    }
    return {
      links: Object.fromEntries(
        Object.entries(links).map(([projectId, link]) => [projectId, withLocalExpiry(link)]),
      ),
      pending,
    };
  };

  const publishLibrary = async () => {
    deps.onLibrary(await getLibrary());
  };

  /** Removes an unfinished share here and, when it can, in Director. */
  const forgetUpload = async (shareId: string) => {
    await deps.store.removeUpload(shareId);
    await deps.api.remove(shareId).catch(() => undefined);
  };

  const matchesFile = async (upload: PendingShareUpload | null) => {
    if (!upload) {
      return false;
    }
    const file = await deps.stat(upload.filePath);
    return !!file && file.size === upload.sizeBytes && file.mtimeMs === upload.mtimeMs;
  };

  const share = async (request: ShareRequest): Promise<ShareJobState> => {
    const { filePath, projectId } = request;
    const fail = (error: ShareErrorCode, resumable = false): ShareJobState => {
      const failed: ShareJobState = { status: 'failed', filePath, projectId, error, resumable };
      setState(failed);
      return failed;
    };

    if (active) {
      return { status: 'failed', filePath, projectId, error: 'busy', resumable: false };
    }
    const contentType = contentTypeFor(filePath);
    if (!contentType) {
      return fail('unsupported-format');
    }

    const controller = new AbortController();
    active = controller;
    const { signal } = controller;
    let shareId: string | null = null;
    let recorded = false;

    try {
      setState({ status: 'preparing', filePath, projectId });
      const file = await deps.stat(filePath);
      if (!file || file.size === 0) {
        return fail('file-missing');
      }
      if (file.size > MAX_SHARE_BYTES) {
        return fail('too-large');
      }

      const title = cleanTitle(request.title);
      const durationS = Math.max(1, Math.round(request.durationS));
      let partSize = 0;
      let targets: { partNumber: number; url: string }[] = [];
      let alreadyUploaded: UploadedPart[] = [];

      const pending = await deps.store.findUpload({ filePath });
      if (pending && pending.sizeBytes === file.size && pending.mtimeMs === file.mtimeMs) {
        try {
          const plan = await deps.api.resume(pending.shareId);
          shareId = pending.shareId;
          recorded = true;
          partSize = plan.partSize;
          targets = plan.parts;
          alreadyUploaded = plan.uploadedParts;
        } catch (err) {
          const code = shareErrorCode(err);
          if (code === 'interrupted' || code === 'signed-out') {
            return fail(code, true);
          }
          // Director no longer has it (or can't resume it): start over.
          await forgetUpload(pending.shareId);
        }
      } else if (pending) {
        await forgetUpload(pending.shareId);
      }
      signal.throwIfAborted();

      if (!shareId) {
        const created = await deps.api.create({
          title,
          contentType,
          sizeBytes: file.size,
          durationS,
        });
        shareId = created.share.id;
        partSize = created.upload.partSize;
        targets = created.upload.parts;
        await deps.store.putUpload({
          shareId,
          filePath,
          sizeBytes: file.size,
          mtimeMs: file.mtimeMs,
          projectId,
          title,
          durationS,
          contentType,
        });
        recorded = true;
        signal.throwIfAborted();
      }

      const baseBytes = alreadyUploaded.reduce((sum, part) => {
        const { start, end } = partRange(part.partNumber, partSize, file.size);
        return sum + (end - start);
      }, 0);
      let lastEmit = 0;
      const emitProgress = (uploadedBytes: number, force = false) => {
        const t = now();
        if (!force && t - lastEmit < PROGRESS_INTERVAL_MS) {
          return;
        }
        lastEmit = t;
        setState({
          status: 'uploading',
          filePath,
          projectId,
          uploadedBytes: Math.min(file.size, uploadedBytes),
          totalBytes: file.size,
        });
      };
      emitProgress(baseBytes, true);

      const { source, close } = await deps.openSource(filePath);
      let sent: UploadedPart[];
      try {
        sent = await uploadParts({
          source,
          sizeBytes: file.size,
          partSize,
          parts: targets,
          fetch: deps.fetch,
          signal,
          sleep: deps.sleep,
          onProgress: (bytes) => emitProgress(baseBytes + bytes, baseBytes + bytes >= file.size),
        });
      } finally {
        await close().catch(() => undefined);
      }
      signal.throwIfAborted();

      setState({ status: 'finishing', filePath, projectId });
      const parts = [...alreadyUploaded, ...sent].sort((a, b) => a.partNumber - b.partNumber);
      const completed = await deps.api.complete(shareId, parts);
      await deps.store.removeUpload(shareId);
      recorded = false;

      const link = toLink(completed, title, true);
      if (projectId) {
        await deps.store.setLink(projectId, link);
      }
      let copied = false;
      if (link.watchUrl) {
        try {
          deps.writeClipboard(link.watchUrl);
          copied = true;
        } catch {
          copied = false;
        }
      }
      const done: ShareJobState = { status: 'done', filePath, projectId, link, copied };
      setState(done);
      return done;
    } catch (err) {
      if (signal.aborted || isAbort(err)) {
        if (shareId) {
          await forgetUpload(shareId);
        }
        setState({ status: 'idle' });
        return state;
      }
      const code = shareErrorCode(err);
      const resumable = recorded && (code === 'interrupted' || code === 'signed-out');
      if (shareId && recorded && !resumable) {
        await forgetUpload(shareId);
      }
      return fail(code, resumable);
    } finally {
      active = null;
      await publishLibrary().catch(() => undefined);
    }
  };

  return {
    getState: () => state,
    share,

    cancel(): void {
      active?.abort();
    },

    /** True when sharing this file again would pick up an interrupted upload. */
    async canResume(filePath: string): Promise<boolean> {
      return matchesFile(await deps.store.findUpload({ filePath }));
    },

    async resumeProject(projectId: string): Promise<ShareJobState> {
      const upload = await deps.store.findUpload({ projectId });
      if (!upload) {
        return { status: 'failed', filePath: '', projectId, error: 'not-found', resumable: false };
      }
      return share({
        filePath: upload.filePath,
        projectId,
        title: upload.title,
        durationS: upload.durationS,
      });
    },

    async discardPending(projectId: string): Promise<ShareActionResult> {
      const upload = await deps.store.findUpload({ projectId });
      if (upload) {
        await forgetUpload(upload.shareId);
        await publishLibrary();
      }
      return { ok: true };
    },

    getLibrary,

    /** Brings each link's status and expiry up to date; keeps what's saved when offline. */
    async refreshLibrary(): Promise<ShareLibrary> {
      try {
        const shares = await deps.api.list();
        const byId = new Map(shares.map((s) => [s.id, s]));
        await deps.store.updateLinks((links) =>
          Object.fromEntries(
            Object.entries(links).map(([projectId, link]) => {
              const current = byId.get(link.shareId);
              return [
                projectId,
                current ? toLink(current, link.title) : { ...link, status: 'removed' as const },
              ];
            }),
          ),
        );
      } catch {
        // Signed out or offline: the saved links still say what they can.
      }
      const library = await getLibrary();
      deps.onLibrary(library);
      return library;
    },

    async removeLink(projectId: string): Promise<ShareActionResult> {
      const link = (await deps.store.getLinks())[projectId];
      if (!link) {
        return { ok: true };
      }
      if (withLocalExpiry(link).status === 'live') {
        try {
          await deps.api.remove(link.shareId);
        } catch (err) {
          const code = shareErrorCode(err);
          if (code !== 'not-found') {
            return { ok: false, error: code };
          }
        }
      }
      await deps.store.removeLink(projectId);
      await publishLibrary();
      return { ok: true };
    },

    async copyLink(projectId: string): Promise<boolean> {
      const link = (await deps.store.getLinks())[projectId];
      if (!link?.watchUrl) {
        return false;
      }
      deps.writeClipboard(link.watchUrl);
      return true;
    },
  };
}

export type ShareManager = ReturnType<typeof createShareManager>;
