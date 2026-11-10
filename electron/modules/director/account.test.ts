import { describe, expect, it, vi } from 'vitest';
import { createDirectorAccount } from './account';
import { DirectorApiError } from './client';
import type { SignedInAccount } from './sign-in';

const ACCOUNT: SignedInAccount = {
  accessToken: 'sfd_token',
  user: { id: 'u1', email: 'mohib@screenforge.co' },
  workspace: { id: 'w1', name: 'Screenforge' },
};

const setup = ({ stored = null as SignedInAccount | null, canPersist = true } = {}) => {
  const store = {
    canPersist: vi.fn(() => canPersist),
    save: vi.fn(async () => canPersist),
    load: vi.fn(async () => stored),
    clear: vi.fn(async () => undefined),
  };
  const client = {
    createLoginCode: vi.fn().mockResolvedValue({
      code: 'CODE',
      expiresInMinutes: 10,
      approveUrl: 'https://director.screenforge.co/desktop-login/CODE',
    }),
    pollLoginCode: vi.fn().mockResolvedValue({ status: 'approved', ...ACCOUNT }),
    signOut: vi.fn().mockResolvedValue(null),
  };
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const states: unknown[] = [];
  const account = createDirectorAccount({
    store,
    client,
    openExternal,
    deviceName: 'MacBook',
    sleep: async () => undefined,
  });
  account.onChange((s) => states.push(s));
  return { account, store, client, openExternal, states };
};

describe('Director account', () => {
  it('starts signed out', () => {
    expect(setup().account.getState()).toEqual({ status: 'signed-out' });
  });

  it('restores a saved sign-in at launch, without the token', async () => {
    const { account } = setup({ stored: ACCOUNT });
    await account.init();
    expect(account.getState()).toEqual({
      status: 'signed-in',
      user: ACCOUNT.user,
      workspace: ACCOUNT.workspace,
      remembered: true,
    });
    expect(account.getToken()).toBe('sfd_token');
    expect(JSON.stringify(account.getState())).not.toContain('sfd_token');
  });

  it('signs in through the browser and remembers it in the keychain', async () => {
    const { account, store, openExternal, states } = setup();
    await account.signIn();
    expect(openExternal).toHaveBeenCalledWith('https://director.screenforge.co/desktop-login/CODE');
    expect(states).toContainEqual({
      status: 'signing-in',
      approveUrl: 'https://director.screenforge.co/desktop-login/CODE',
    });
    expect(store.save).toHaveBeenCalledWith(ACCOUNT);
    expect(account.getState()).toMatchObject({ status: 'signed-in', remembered: true });
  });

  it("says so when there's no keychain to remember the sign-in in", async () => {
    const { account } = setup({ canPersist: false });
    await account.signIn();
    expect(account.getState()).toMatchObject({ status: 'signed-in', remembered: false });
  });

  it('does not start a second sign-in while one is waiting', async () => {
    const { account, client } = setup();
    client.pollLoginCode.mockResolvedValueOnce({ status: 'pending' });
    await Promise.all([account.signIn(), account.signIn()]);
    expect(client.createLoginCode).toHaveBeenCalledTimes(1);
  });

  it('does not start a new sign-in over an account that is already signed in', async () => {
    const { account, client, store } = setup({ stored: ACCOUNT });
    await account.init();
    await account.signIn();
    expect(client.createLoginCode).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(account.getState()).toMatchObject({ status: 'signed-in' });
    expect(account.getToken()).toBe('sfd_token');
  });

  it('goes back to signed out, saying why, when the link expires', async () => {
    const { account, client } = setup();
    client.pollLoginCode.mockRejectedValue(new DirectorApiError(400, 'LOGIN_CODE_INVALID', 'x'));
    await account.signIn();
    expect(account.getState()).toEqual({ status: 'signed-out', error: 'expired' });
  });

  it('stops waiting when cancelled', async () => {
    const { account, client } = setup();
    client.pollLoginCode.mockImplementation(async () => {
      account.cancelSignIn();
      return { status: 'pending' };
    });
    await account.signIn();
    expect(account.getState()).toEqual({ status: 'signed-out' });
    expect(account.getToken()).toBeNull();
  });

  it('signs out: revokes the token in Director and forgets it here', async () => {
    const { account, store, client } = setup({ stored: ACCOUNT });
    await account.init();
    await account.signOut();
    expect(client.signOut).toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalled();
    expect(account.getState()).toEqual({ status: 'signed-out' });
    expect(account.getToken()).toBeNull();
  });

  it('still signs out here when Director cannot be reached', async () => {
    const { account, store, client } = setup({ stored: ACCOUNT });
    await account.init();
    client.signOut.mockRejectedValue(new DirectorApiError(0, 'NETWORK_ERROR', 'offline'));
    await account.signOut();
    expect(store.clear).toHaveBeenCalled();
    expect(account.getState()).toEqual({ status: 'signed-out' });
  });

  it('signs out here when Director revoked the token, even if the saved copy stays', async () => {
    const { account, store } = setup({ stored: ACCOUNT });
    await account.init();
    store.clear.mockRejectedValue(new Error('EPERM'));
    await account.signOut();
    expect(account.getState()).toEqual({ status: 'signed-out' });
    expect(account.getToken()).toBeNull();
  });

  it('does not claim to sign out when the token is neither revoked nor deleted', async () => {
    const { account, store, client } = setup({ stored: ACCOUNT });
    await account.init();
    client.signOut.mockRejectedValue(new DirectorApiError(0, 'NETWORK_ERROR', 'offline'));
    store.clear.mockRejectedValue(new Error('EPERM'));
    await expect(account.signOut()).rejects.toThrow();
    expect(account.getState()).toMatchObject({ status: 'signed-in' });
    expect(account.getToken()).toBe('sfd_token');
  });

  it('cancels a waiting sign-in on sign-out, so a later approval is not kept', async () => {
    const { account, client, store } = setup();
    let approve: () => void = () => undefined;
    client.pollLoginCode.mockImplementation(
      () =>
        new Promise((resolve) => {
          approve = () => resolve({ status: 'approved', ...ACCOUNT });
        }),
    );
    const signingIn = account.signIn();
    await vi.waitFor(() => expect(client.pollLoginCode).toHaveBeenCalled());
    await account.signOut();
    approve();
    await signingIn;
    expect(store.save).not.toHaveBeenCalled();
    expect(account.getToken()).toBeNull();
    expect(account.getState()).toEqual({ status: 'signed-out' });
  });

  it('does not restore a saved sign-in that a sign-out overtook at launch', async () => {
    const { account, store } = setup();
    let finishLoad: (value: SignedInAccount | null) => void = () => undefined;
    store.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
    );
    const starting = account.init();
    await account.signOut();
    finishLoad(ACCOUNT);
    await starting;
    expect(account.getToken()).toBeNull();
    expect(account.getState()).toEqual({ status: 'signed-out' });
  });

  it('forgets a token Director no longer accepts (disconnected in Director)', async () => {
    const { account, store } = setup({ stored: ACCOUNT });
    await account.init();
    await expect(
      account.call(async () => {
        throw new DirectorApiError(401, 'UNAUTHORIZED', 'Authentication required');
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(store.clear).toHaveBeenCalled();
    expect(account.getState()).toEqual({ status: 'signed-out', error: 'disconnected' });
  });

  it('keeps the sign-in on other errors', async () => {
    const { account, store } = setup({ stored: ACCOUNT });
    await account.init();
    await expect(
      account.call(async () => {
        throw new DirectorApiError(403, 'FORBIDDEN', 'no');
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(store.clear).not.toHaveBeenCalled();
    expect(account.getState()).toMatchObject({ status: 'signed-in' });
  });
});
