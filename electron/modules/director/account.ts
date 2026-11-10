import { DirectorApiError, type DirectorClient } from './client';
import { runSignIn, SignInError, type SignedInAccount } from './sign-in';
import type { createTokenStore } from './token-store';
import type { DirectorAccountState } from '../../../src/types/index';

export type { DirectorAccountState };

type TokenStore = Pick<
  ReturnType<typeof createTokenStore>,
  'canPersist' | 'save' | 'load' | 'clear'
>;

export interface DirectorAccountDeps {
  store: TokenStore;
  client: Pick<DirectorClient, 'createLoginCode' | 'pollLoginCode' | 'signOut'>;
  openExternal: (url: string) => Promise<void>;
  deviceName: string;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The optional Director sign-in (screenforgeai/screenforge#25): Screenforge
 * works without it; with it, hosted share links, the brand kit and opening
 * Director recordings turn on.
 */
export function createDirectorAccount(deps: DirectorAccountDeps) {
  let state: DirectorAccountState = { status: 'signed-out' };
  let account: SignedInAccount | null = null;
  let pending: { promise: Promise<void>; controller: AbortController } | null = null;
  const listeners = new Set<(state: DirectorAccountState) => void>();

  const setState = (next: DirectorAccountState) => {
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
  };

  const signedIn = async (next: SignedInAccount) => {
    account = next;
    const remembered = await deps.store.save(next).catch(() => false);
    setState({ status: 'signed-in', user: next.user, workspace: next.workspace, remembered });
  };

  const forget = async (error?: 'disconnected') => {
    account = null;
    await deps.store.clear().catch(() => undefined);
    setState(error ? { status: 'signed-out', error } : { status: 'signed-out' });
  };

  return {
    getState: () => state,
    /** For authenticated Director calls; never sent to a renderer. */
    getToken: () => account?.accessToken ?? null,
    onChange(listener: (state: DirectorAccountState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async init(): Promise<void> {
      const stored = await deps.store.load();
      if (stored) {
        account = stored;
        setState({
          status: 'signed-in',
          user: stored.user,
          workspace: stored.workspace,
          remembered: true,
        });
      }
    },

    signIn(): Promise<void> {
      if (pending) {
        return pending.promise;
      }
      // Already signed in: sign out first, so the old token is revoked and forgotten.
      if (account) {
        return Promise.resolve();
      }
      const controller = new AbortController();
      const promise = runSignIn({
        client: deps.client,
        deviceName: deps.deviceName,
        openExternal: deps.openExternal,
        onCode: ({ approveUrl }) => setState({ status: 'signing-in', approveUrl }),
        sleep: deps.sleep,
        signal: controller.signal,
      })
        .then(signedIn)
        .catch((err: unknown) => {
          const reason = err instanceof SignInError ? err.reason : 'failed';
          setState(
            reason === 'cancelled'
              ? { status: 'signed-out' }
              : { status: 'signed-out', error: reason },
          );
        })
        .finally(() => {
          pending = null;
        });
      pending = { promise, controller };
      return promise;
    },

    cancelSignIn(): void {
      pending?.controller.abort();
    },

    /** Revokes the token in Director when it can; always forgets it here. */
    async signOut(): Promise<void> {
      if (account) {
        await deps.client.signOut().catch(() => undefined);
      }
      await forget();
    },

    /**
     * Runs an authenticated Director call. A 401 means the token was
     * disconnected in Director (or its person left the workspace): sign out
     * here too, rather than failing the same way forever.
     */
    async call<T>(fn: () => Promise<T>): Promise<T> {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof DirectorApiError && err.status === 401 && account) {
          await forget('disconnected');
        }
        throw err;
      }
    },
  };
}

export type DirectorAccount = ReturnType<typeof createDirectorAccount>;
