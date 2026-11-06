import {
  DirectorApiError,
  type DirectorClient,
  type DirectorUser,
  type DirectorWorkspace,
} from './client';

export interface SignedInAccount {
  accessToken: string;
  user: DirectorUser;
  workspace: DirectorWorkspace;
}

export type SignInFailure = 'expired' | 'cancelled' | 'failed';

export class SignInError extends Error {
  constructor(
    readonly reason: SignInFailure,
    message: string,
  ) {
    super(message);
    this.name = 'SignInError';
  }
}

export interface RunSignInOptions {
  client: Pick<DirectorClient, 'createLoginCode' | 'pollLoginCode'>;
  /** Shown on Director's approval page and in its Connected apps list. */
  deviceName?: string;
  openExternal: (url: string) => Promise<void>;
  /** The code and page, for the app to show while it waits. */
  onCode?: (issued: { code: string; approveUrl: string }) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  intervalMs?: number;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Director's desktop sign-in: mint a code, open its approval page in the
 * browser, and poll until someone signed in to Director approves it. The
 * token comes back once, on the poll that lands after approval.
 */
export async function runSignIn({
  client,
  deviceName = 'Screenforge',
  openExternal,
  onCode,
  sleep = realSleep,
  now = Date.now,
  signal,
  intervalMs = 2000,
}: RunSignInOptions): Promise<SignedInAccount> {
  const cancelled = () => new SignInError('cancelled', 'Sign-in was cancelled.');
  const issued = await client.createLoginCode(deviceName).catch((err: unknown) => {
    throw new SignInError('failed', err instanceof Error ? err.message : String(err));
  });
  // Only ever hand the OS browser a web page.
  if (
    !/^https:\/\//i.test(issued.approveUrl) &&
    !/^http:\/\/localhost[:/]/i.test(issued.approveUrl)
  ) {
    throw new SignInError('failed', 'Director sent an approval link Screenforge will not open.');
  }
  if (signal?.aborted) {
    throw cancelled();
  }
  onCode?.({ code: issued.code, approveUrl: issued.approveUrl });
  await openExternal(issued.approveUrl);

  const deadline = now() + issued.expiresInMinutes * 60_000;
  while (now() <= deadline) {
    if (signal?.aborted) {
      throw cancelled();
    }
    let poll;
    try {
      poll = await client.pollLoginCode(issued.code);
    } catch (err) {
      if (err instanceof DirectorApiError && err.status === 0) {
        poll = null; // Offline for a moment: keep waiting.
      } else if (err instanceof DirectorApiError && err.code === 'LOGIN_CODE_INVALID') {
        throw new SignInError('expired', 'The sign-in link expired.');
      } else {
        throw new SignInError('failed', err instanceof Error ? err.message : String(err));
      }
    }
    if (poll?.status === 'approved') {
      if (!poll.accessToken || !poll.user || !poll.workspace) {
        throw new SignInError('failed', 'Director approved the sign-in but sent no account.');
      }
      return { accessToken: poll.accessToken, user: poll.user, workspace: poll.workspace };
    }
    await sleep(intervalMs);
  }
  if (signal?.aborted) {
    throw cancelled();
  }
  throw new SignInError('expired', 'The sign-in link expired.');
}
