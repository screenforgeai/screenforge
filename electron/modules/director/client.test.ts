import { describe, expect, it, vi } from 'vitest';
import { createDirectorClient, DirectorApiError, directorApiBase } from './client';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('directorApiBase', () => {
  it('is production Director unless overridden', () => {
    expect(directorApiBase({})).toBe('https://api.director.screenforge.co/api');
    expect(directorApiBase({ SCREENFORGE_DIRECTOR_API_URL: 'http://localhost:8000/api/' })).toBe(
      'http://localhost:8000/api',
    );
  });
});

describe('Director client', () => {
  it('mints a desktop sign-in code naming this computer', async () => {
    const fetch = vi.fn().mockResolvedValue(
      json(200, {
        message: 'ok',
        data: { code: 'ABCD-1234', expiresInMinutes: 10, approveUrl: 'https://d/desktop-login/x' },
      }),
    );
    const client = createDirectorClient({ baseUrl: 'https://api.test/api', fetch });

    const issued = await client.createLoginCode('Mohib’s MacBook');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/api/auth/desktop-login/code',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ deviceName: 'Mohib’s MacBook' }),
      }),
    );
    expect(issued).toEqual({
      code: 'ABCD-1234',
      expiresInMinutes: 10,
      approveUrl: 'https://d/desktop-login/x',
    });
  });

  it('polls a code, url-encoded', async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { data: { status: 'pending' } }));
    const client = createDirectorClient({ baseUrl: 'https://api.test/api', fetch });
    await expect(client.pollLoginCode('A/B')).resolves.toEqual({ status: 'pending' });
    expect(fetch.mock.calls[0][0]).toBe('https://api.test/api/auth/desktop-login/code/A%2FB');
  });

  it('sends the desktop token on authenticated calls', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(json(200, { data: { user: { id: 'u', email: 'e' }, scopes: [] } }));
    const client = createDirectorClient({
      baseUrl: 'https://api.test/api',
      fetch,
      getToken: () => 'sfd_secret',
    });
    await client.me();
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sfd_secret');
  });

  it('never sends a token on the unauthenticated sign-in calls', async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { data: { status: 'pending' } }));
    const client = createDirectorClient({
      baseUrl: 'https://api.test/api',
      fetch,
      getToken: () => 'sfd_secret',
    });
    await client.pollLoginCode('x');
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('refuses an authenticated call while signed out, without calling Director', async () => {
    const fetch = vi.fn();
    const client = createDirectorClient({ baseUrl: 'https://api.test/api', fetch });
    await expect(client.me()).rejects.toMatchObject({ status: 401, code: 'NOT_SIGNED_IN' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("turns Director's error body into a DirectorApiError with its code", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(json(400, { code: 'LOGIN_CODE_INVALID', message: 'That code expired.' }));
    const client = createDirectorClient({ baseUrl: 'https://api.test/api', fetch });
    const err = await client.pollLoginCode('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DirectorApiError);
    expect(err).toMatchObject({ status: 400, code: 'LOGIN_CODE_INVALID' });
  });

  it('reports a network failure as a DirectorApiError with status 0', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const client = createDirectorClient({
      baseUrl: 'https://api.test/api',
      fetch,
      getToken: () => 'sfd_secret',
    });
    await expect(client.me()).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});
