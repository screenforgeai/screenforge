import { describe, expect, it, vi } from 'vitest';
import { runSignIn, SignInError } from './sign-in';
import { DirectorApiError } from './client';

const APPROVED = {
  status: 'approved' as const,
  accessToken: 'sfd_token',
  user: { id: 'u1', email: 'mohib@screenforge.co' },
  workspace: { id: 'w1', name: 'Screenforge' },
};

const setup = (polls: unknown[]) => {
  const client = {
    createLoginCode: vi.fn().mockResolvedValue({
      code: 'CODE',
      expiresInMinutes: 10,
      approveUrl: 'https://director.screenforge.co/desktop-login/CODE',
    }),
    pollLoginCode: vi.fn(),
  };
  for (const p of polls) {
    if (p instanceof Error) {
      client.pollLoginCode.mockRejectedValueOnce(p);
    } else {
      client.pollLoginCode.mockResolvedValueOnce(p);
    }
  }
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const onCode = vi.fn();
  let now = 0;
  const sleep = vi.fn(async (ms: number) => {
    now += ms;
  });
  return { client, openExternal, onCode, sleep, now: () => now };
};

describe('runSignIn', () => {
  it('opens the approval page, polls until approved and returns the account', async () => {
    const s = setup([{ status: 'pending' }, { status: 'pending' }, APPROVED]);

    const result = await runSignIn({
      client: s.client,
      deviceName: 'MacBook',
      openExternal: s.openExternal,
      onCode: s.onCode,
      sleep: s.sleep,
      now: s.now,
      intervalMs: 2000,
    });

    expect(s.client.createLoginCode).toHaveBeenCalledWith('MacBook');
    expect(s.openExternal).toHaveBeenCalledWith(
      'https://director.screenforge.co/desktop-login/CODE',
    );
    expect(s.onCode).toHaveBeenCalledWith({
      code: 'CODE',
      approveUrl: 'https://director.screenforge.co/desktop-login/CODE',
    });
    expect(s.client.pollLoginCode).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      accessToken: 'sfd_token',
      user: APPROVED.user,
      workspace: APPROVED.workspace,
    });
  });

  it('only opens https approval pages', async () => {
    const s = setup([APPROVED]);
    s.client.createLoginCode.mockResolvedValue({
      code: 'C',
      expiresInMinutes: 10,
      approveUrl: 'file:///etc/passwd',
    });
    await expect(
      runSignIn({ client: s.client, openExternal: s.openExternal, sleep: s.sleep, now: s.now }),
    ).rejects.toMatchObject({ reason: 'failed' });
    expect(s.openExternal).not.toHaveBeenCalled();
  });

  it('gives up once the code has expired', async () => {
    const s = setup(Array.from({ length: 1000 }, () => ({ status: 'pending' })));
    const err = await runSignIn({
      client: s.client,
      openExternal: s.openExternal,
      sleep: s.sleep,
      now: s.now,
      intervalMs: 2000,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SignInError);
    expect(err).toMatchObject({ reason: 'expired' });
    // 10 minutes at one poll per 2 s.
    expect(s.client.pollLoginCode.mock.calls.length).toBeLessThanOrEqual(301);
  });

  it('treats a code Director no longer knows as expired', async () => {
    const s = setup([{ status: 'pending' }, new DirectorApiError(400, 'LOGIN_CODE_INVALID', 'x')]);
    await expect(
      runSignIn({ client: s.client, openExternal: s.openExternal, sleep: s.sleep, now: s.now }),
    ).rejects.toMatchObject({ reason: 'expired' });
  });

  it('keeps polling through a network blip', async () => {
    const s = setup([new DirectorApiError(0, 'NETWORK_ERROR', 'offline'), APPROVED]);
    await expect(
      runSignIn({ client: s.client, openExternal: s.openExternal, sleep: s.sleep, now: s.now }),
    ).resolves.toMatchObject({ accessToken: 'sfd_token' });
  });

  it('stops when cancelled', async () => {
    const s = setup(Array.from({ length: 10 }, () => ({ status: 'pending' })));
    const controller = new AbortController();
    s.sleep.mockImplementation(async () => controller.abort());
    await expect(
      runSignIn({
        client: s.client,
        openExternal: s.openExternal,
        sleep: s.sleep,
        now: s.now,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ reason: 'cancelled' });
  });

  it('stays cancelled when the approval lands while the cancel is in flight', async () => {
    const s = setup([]);
    const controller = new AbortController();
    s.client.pollLoginCode.mockImplementation(async () => {
      controller.abort();
      return APPROVED;
    });
    await expect(
      runSignIn({
        client: s.client,
        openExternal: s.openExternal,
        sleep: s.sleep,
        now: s.now,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ reason: 'cancelled' });
  });

  it('fails when an approval comes back without a token', async () => {
    const s = setup([{ status: 'approved' }]);
    await expect(
      runSignIn({ client: s.client, openExternal: s.openExternal, sleep: s.sleep, now: s.now }),
    ).rejects.toMatchObject({ reason: 'failed' });
  });
});
