/** Director's desktop API, as the Screenforge app uses it (screenforgeai/director#277). */

export const DEFAULT_DIRECTOR_API_URL = 'https://api.director.screenforge.co/api';

/** Every Director call gives up after this, so a stalled request reads as offline. */
const REQUEST_TIMEOUT_MS = 15_000;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function directorApiBase(env: Record<string, string | undefined>): string {
  const override = env.SCREENFORGE_DIRECTOR_API_URL?.trim();
  const base = (override || DEFAULT_DIRECTOR_API_URL).replace(/\/+$/, '');
  // The desktop token travels to this URL: only https, or http on this computer.
  try {
    const url = new URL(base);
    if (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))
    ) {
      return base;
    }
  } catch {
    // Not a URL: use production Director.
  }
  return DEFAULT_DIRECTOR_API_URL;
}

export class DirectorApiError extends Error {
  constructor(
    /** HTTP status; 0 when Director couldn't be reached. */
    readonly status: number,
    /** Director's error code (e.g. LOGIN_CODE_INVALID), or NETWORK_ERROR / HTTP_<status>. */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DirectorApiError';
  }
}

export interface IssuedLoginCode {
  code: string;
  expiresInMinutes: number;
  approveUrl: string;
}

export interface DirectorUser {
  id: string;
  email: string;
}

export interface DirectorWorkspace {
  id: string;
  name: string | null;
}

export interface LoginCodePoll {
  status: 'pending' | 'approved';
  accessToken?: string;
  user?: DirectorUser;
  workspace?: DirectorWorkspace;
}

export interface DesktopProfile {
  user: DirectorUser;
  workspace: DirectorWorkspace & { slug?: string | null };
  scopes: string[];
}

export interface DirectorClientOptions {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  /** The desktop token for authenticated routes; null when signed out. */
  getToken?: () => string | null;
}

export type DirectorClient = ReturnType<typeof createDirectorClient>;

export function createDirectorClient({ baseUrl, fetch, getToken }: DirectorClientOptions) {
  const request = async <T>(
    path: string,
    init: { method?: string; body?: unknown; auth?: boolean } = {},
  ): Promise<T> => {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (init.auth) {
      const token = getToken?.();
      if (!token) {
        throw new DirectorApiError(401, 'NOT_SIGNED_IN', 'Not signed in to Director.');
      }
      headers.authorization = `Bearer ${token}`;
    }
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new DirectorApiError(
        0,
        'NETWORK_ERROR',
        err instanceof Error ? err.message : 'Could not reach Director.',
      );
    }
    const payload = (await response.json().catch(() => null)) as {
      data?: T;
      code?: string;
      message?: string;
    } | null;
    if (!response.ok) {
      throw new DirectorApiError(
        response.status,
        payload?.code ?? `HTTP_${response.status}`,
        payload?.message ?? `Director answered ${response.status}.`,
      );
    }
    return payload?.data as T;
  };

  return {
    request,
    createLoginCode: (deviceName: string) =>
      request<IssuedLoginCode>('/auth/desktop-login/code', {
        method: 'POST',
        body: { deviceName },
      }),
    pollLoginCode: (code: string) =>
      request<LoginCodePoll>(`/auth/desktop-login/code/${encodeURIComponent(code)}`),
    me: () => request<DesktopProfile>('/desktop/me', { auth: true }),
    signOut: () => request<null>('/desktop/sign-out', { method: 'POST', auth: true }),
  };
}
