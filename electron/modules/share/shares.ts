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
  PendingShareDeletion,
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
  /** True for a file this app exported (sharing is limited to those). */
  isExported: (filePath: string) => Promise<boolean>;
  /** The signed-in Director account as `workspace:user`, or null. */
  currentAccount: () => string | null;
  /** Opens the file, refusing one that is no longer the size and time checked. */
  openSource: (
    filePath: string,
    expected: { size: number; mtimeMs: number },
  ) => Promise<{ source: ByteSource; close: () => Promise<void> }>;
  writeClipboard: (text: string) => void;
  onState: (state: ShareJobState) => void;
  onLibrary: (library: ShareLibrary) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Director runs on this computer, so its storage may too (http on localhost). */
  allowLoopbackUploads?: boolean;
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

/**
 * A watch link is opened and copied, so only https is kept. The host can't be
 * pinned: Director builds it from the workspace's site, which may be a custom domain.
 */
export function safeWatchUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
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

  /**
   * Whether a saved record belongs to the signed-in account. Records are
   * only acted on, and listed, under the account that made them (records
   * from before accounts were kept belong to whoever is signed in).
   */
  const ownedNow = (record: { account?: string | null }): boolean => {
    const account = deps.currentAccount();
    return !record.account || account === null || record.account === account;
  };
  const actionableNow = (record: { account?: string | null }): boolean =>
    !record.account || record.account === deps.currentAccount();

  /** A saved link as shown: local expiry applied, and no watch link that isn't https. */
  const fromStore = (link: ProjectShareLink): ProjectShareLink =>
    withLocalExpiry({ ...link, watchUrl: safeWatchUrl(link.watchUrl) });

  const toLink = (share: DirectorShare, title: string, justCompleted = false): ProjectShareLink => {
    const status: ProjectShareLink['status'] =
      share.status === 'expired'
        ? 'expired'
        : share.status === 'live' || (justCompleted && share.status !== 'removed')
          ? 'live'
          : 'removed';
    const account = deps.currentAccount();
    return withLocalExpiry({
      shareId: share.id,
      title: share.title || title,
      watchUrl: safeWatchUrl(share.watchUrl),
      expiresAt: share.expiresAt,
      status,
      sharedAt: share.sharedAt,
      ...(account ? { account } : {}),
    });
  };

  const getLibrary = async (): Promise<ShareLibrary> => {
    const [links, uploads] = await Promise.all([deps.store.getLinks(), deps.store.getUploads()]);
    const pending: ShareLibrary['pending'] = {};
    for (const upload of uploads) {
      if (upload.projectId && ownedNow(upload)) {
        pending[upload.projectId] = {
          fileName: path.basename(upload.filePath),
          sizeBytes: upload.sizeBytes,
        };
      }
    }
    return {
      links: Object.fromEntries(
        Object.entries(links)
          .filter(([, link]) => ownedNow(link))
          .map(([projectId, link]) => [projectId, fromStore(link)]),
      ),
      pending,
    };
  };

  const publishLibrary = async () => {
    deps.onLibrary(await getLibrary());
  };

  /** Deletes a share in Director under its own account; true once it's gone there. */
  const deleteRemote = async (deletion: PendingShareDeletion): Promise<boolean> => {
    if (!actionableNow(deletion)) {
      return false;
    }
    try {
      await deps.api.remove(deletion.shareId);
    } catch (err) {
      if (shareErrorCode(err) !== 'not-found') {
        return false;
      }
    }
    await deps.store.removeDeletion(deletion.shareId);
    return true;
  };

  /**
   * Drops an unfinished upload here. Its deletion in Director is recorded
   * first and kept until Director confirms it, so a failure never strands
   * the parts already uploaded out of reach.
   */
  const forgetUpload = async (upload: { shareId: string; account?: string | null }) => {
    const deletion = {
      shareId: upload.shareId,
      account: upload.account ?? deps.currentAccount(),
    };
    await deps.store.forgetUpload(deletion);
    await deleteRemote(deletion);
  };

  /** Retries the deletions Director hasn't confirmed, for the signed-in account. */
  const retryDeletions = async () => {
    for (const deletion of await deps.store.getDeletions()) {
      await deleteRemote(deletion);
    }
  };

  const matchesFile = async (upload: PendingShareUpload | null) => {
    if (!upload || !actionableNow(upload)) {
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
      const resumable =
        !!pending &&
        actionableNow(pending) &&
        pending.sizeBytes === file.size &&
        pending.mtimeMs === file.mtimeMs;
      // Only a file this app exported, or one it was already uploading.
      if (!resumable && !(await deps.isExported(filePath))) {
        return fail('failed');
      }
      if (pending && resumable) {
        try {
          const plan = await deps.api.resume(pending.shareId);
          shareId = pending.shareId;
          recorded = true;
          partSize = plan.partSize;
          targets = plan.parts;
          alreadyUploaded = plan.uploadedParts;
        } catch (err) {
          const code = shareErrorCode(err);
          const gone =
            code === 'not-found' ||
            (err instanceof DirectorApiError && err.code === 'SHARE_NOT_UPLOADING');
          if (!gone) {
            // A moment's failure (network, sign-in, a 5xx): keep the parts
            // already in Director and resume later.
            return fail(code === 'failed' ? 'interrupted' : code, true);
          }
          // Director no longer has it, or can't resume it: start over.
          await forgetUpload(pending);
        }
      } else if (pending) {
        // A changed file, or another account's upload: that account deletes
        // it when it's next signed in here.
        await forgetUpload(pending);
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
        const account = deps.currentAccount();
        await deps.store.putUpload({
          shareId,
          filePath,
          sizeBytes: file.size,
          mtimeMs: file.mtimeMs,
          projectId,
          title,
          durationS,
          contentType,
          ...(account ? { account } : {}),
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

      const { source, close } = await deps.openSource(filePath, {
        size: file.size,
        mtimeMs: file.mtimeMs,
      });
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
          allowLoopback: deps.allowLoopbackUploads,
          onProgress: (bytes) => emitProgress(baseBytes + bytes, baseBytes + bytes >= file.size),
        });
      } finally {
        await close().catch(() => undefined);
      }
      signal.throwIfAborted();

      setState({ status: 'finishing', filePath, projectId });
      const parts = [...alreadyUploaded, ...sent].sort((a, b) => a.partNumber - b.partNumber);
      const completed = await deps.api.complete(shareId, parts);
      const link = toLink(completed, title, true);
      // The link is saved before the upload record goes, so a failure here
      // never leaves a live share the app has no record of.
      if (projectId) {
        await deps.store.setLink(projectId, link);
      }
      await deps.store.removeUpload(shareId);
      recorded = false;
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
          await forgetUpload({ shareId });
        }
        setState({ status: 'idle' });
        return state;
      }
      const code = shareErrorCode(err);
      const resumable = recorded && (code === 'interrupted' || code === 'signed-out');
      if (shareId && recorded && !resumable) {
        await forgetUpload({ shareId });
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
      if (!upload || !actionableNow(upload)) {
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
      if (upload && !actionableNow(upload)) {
        return { ok: false, error: 'signed-out' };
      }
      if (upload) {
        await forgetUpload(upload);
        await publishLibrary();
      }
      return { ok: true };
    },

    getLibrary,

    /** Brings each link's status and expiry up to date; keeps what's saved when offline. */
    async refreshLibrary(): Promise<ShareLibrary> {
      try {
        await retryDeletions();
        const shares = await deps.api.list();
        const byId = new Map(shares.map((s) => [s.id, s]));
        await deps.store.updateLinks((links) =>
          Object.fromEntries(
            Object.entries(links).map(([projectId, link]) => {
              // Director lists only the signed-in account's shares.
              if (!actionableNow(link)) {
                return [projectId, link];
              }
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
      if (!actionableNow(link)) {
        return { ok: false, error: 'signed-out' };
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
      const watchUrl = safeWatchUrl(link?.watchUrl);
      if (!watchUrl) {
        return false;
      }
      deps.writeClipboard(watchUrl);
      return true;
    },
  };
}

export type ShareManager = ReturnType<typeof createShareManager>;
