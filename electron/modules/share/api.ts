import type { ShareContentType } from '../../../src/types/index';
import type { PartTarget, UploadedPart } from './upload';

/** A share link as Director returns it (screenforgeai/director#290). */
export interface DirectorShare {
  id: string;
  title: string;
  /** 'uploading' | 'live' | 'expired' | 'removed'; anything else counts as not live. */
  status: string;
  watchUrl: string | null;
  /** Null: never expires (paid plans). */
  expiresAt: string | null;
  sizeBytes: number;
  durationS: number;
  sharedAt: string | null;
  createdAt: string;
}

export interface CreateShareBody {
  title: string;
  contentType: ShareContentType;
  sizeBytes: number;
  durationS: number;
}

export interface ShareApi {
  create(body: CreateShareBody): Promise<{
    share: DirectorShare;
    upload: { partSize: number; parts: PartTarget[] };
  }>;
  /** The parts still to send, freshly signed, and the ones Director already has. */
  resume(
    shareId: string,
  ): Promise<{ partSize: number; uploadedParts: UploadedPart[]; parts: PartTarget[] }>;
  complete(shareId: string, parts: UploadedPart[]): Promise<DirectorShare>;
  list(): Promise<DirectorShare[]>;
  remove(shareId: string): Promise<null>;
}

type Request = <T>(
  path: string,
  init?: { method?: string; body?: unknown; auth?: boolean },
) => Promise<T>;

/**
 * Director's desktop share routes. `call` is the account's wrapper, which
 * signs out here when Director answers 401.
 */
export function createShareApi(
  request: Request,
  call: <T>(fn: () => Promise<T>) => Promise<T>,
): ShareApi {
  const id = (shareId: string) => encodeURIComponent(shareId);
  return {
    create: (body) => call(() => request('/desktop/shares', { method: 'POST', body, auth: true })),
    resume: (shareId) =>
      call(() => request(`/desktop/shares/${id(shareId)}/upload`, { auth: true })),
    complete: (shareId, parts) =>
      call(() =>
        request(`/desktop/shares/${id(shareId)}/complete`, {
          method: 'POST',
          body: { parts },
          auth: true,
        }),
      ),
    list: () => call(() => request('/desktop/shares', { auth: true })),
    remove: (shareId) =>
      call(() => request(`/desktop/shares/${id(shareId)}`, { method: 'DELETE', auth: true })),
  };
}
