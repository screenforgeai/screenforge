import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BACKGROUND } from '../../../src/lib/effects/frame/analyze';
import { DEFAULT_CURSOR_SETTINGS } from '../../../src/store/defaults';
import type { DirectorAccountState, DirectorBrandKit } from '../../../src/types/index';
import { createPresetAssets } from '../presets/assets';
import {
  createBrandKitCache,
  createBrandKitSync,
  downloadLogo,
  type BrandKitSyncDeps,
} from './brand-kit';
import { DirectorApiError } from './client';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);

const KIT: DirectorBrandKit = {
  logoUrl: 'https://storage.example.com/logo?sig=1',
  accent: '#c2410c',
  accentDark: null,
  font: 'sans',
  captions: {
    position: 'bottom',
    textColor: '#ffffff',
    backgroundColor: '#000000',
    backgroundOpacity: 50,
    highlightWithAccent: true,
  },
  background: { ...DEFAULT_BACKGROUND, wallpaperSeed: 4 },
  cursor: DEFAULT_CURSOR_SETTINGS,
  defaultPresetId: null,
};

const SIGNED_IN: DirectorAccountState = {
  status: 'signed-in',
  user: { id: 'u1', email: 'mohib@screenforge.co' },
  workspace: { id: 'w1', name: 'Acme' },
  remembered: true,
};

const fakeAccount = (initial: DirectorAccountState) => {
  let state = initial;
  const listeners = new Set<(s: DirectorAccountState) => void>();
  return {
    getState: () => state,
    onChange(listener: (s: DirectorAccountState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    call: <T>(fn: () => Promise<T>): Promise<T> => fn(),
    set(next: DirectorAccountState) {
      state = next;
      for (const listener of listeners) {
        listener(next);
      }
    },
  };
};

describe('brand kit sync', () => {
  let dir: string;
  let clock: number;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-brand-kit-'));
    clock = Date.parse('2026-11-06T10:00:00.000Z');
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  const setup = ({
    state = SIGNED_IN as DirectorAccountState,
    kit = KIT as DirectorBrandKit | Error,
    logo = { bytes: PNG, mime: 'image/png' } as { bytes: Buffer; mime: string } | null,
  } = {}) => {
    const account = fakeAccount(state);
    const client = {
      request: vi.fn(async () => {
        if (kit instanceof Error) {
          throw kit;
        }
        return kit;
      }),
    };
    const assets = createPresetAssets(path.join(dir, 'preset-assets'));
    const cache = createBrandKitCache({ filePath: path.join(dir, 'brand-kit.json'), assets });
    const download = vi.fn(async () => logo);
    const sync = createBrandKitSync({
      account,
      client: client as unknown as BrandKitSyncDeps['client'],
      cache,
      downloadLogo: download,
      now: () => new Date(clock),
      minIntervalMs: 5 * 60_000,
    });
    const changes = vi.fn();
    sync.onChange(changes);
    return { sync, account, client, cache, download, changes, assets };
  };

  it('syncs at launch when signed in, with the logo saved locally', async () => {
    const { sync, client, download, changes } = setup();
    await sync.start();
    expect(client.request).toHaveBeenCalledWith('/desktop/brand-kit', { auth: true });
    expect(download).toHaveBeenCalledWith(KIT.logoUrl);
    const preset = sync.getPreset();
    expect(preset).toMatchObject({ id: 'director-brand-kit', source: 'director', name: 'Acme' });
    expect(preset?.logo?.path).toBe(
      path.join(dir, 'preset-assets', 'director-brand-kit', 'logo.png'),
    );
    expect(await fs.readFile(preset?.logo?.path ?? '')).toEqual(PNG);
    expect(JSON.stringify(preset)).not.toContain('sig=1');
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('does nothing while signed out', async () => {
    const { sync, client } = setup({ state: { status: 'signed-out' } });
    await sync.start();
    expect(client.request).not.toHaveBeenCalled();
    expect(sync.getPreset()).toBeNull();
  });

  it('syncs when the user signs in, and forgets the kit on sign-out', async () => {
    const { sync, account, client, changes, assets } = setup({ state: { status: 'signed-out' } });
    await sync.start();
    account.set(SIGNED_IN);
    await vi.waitFor(() => expect(sync.getPreset()).not.toBeNull());
    expect(client.request).toHaveBeenCalledTimes(1);

    account.set({ status: 'signed-out' });
    await vi.waitFor(() => expect(sync.getPreset()).toBeNull());
    await vi.waitFor(async () => {
      await expect(fs.stat(path.join(assets.root, 'director-brand-kit'))).rejects.toThrow();
      await expect(fs.stat(path.join(dir, 'brand-kit.json'))).rejects.toThrow();
    });
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('syncs at most every few minutes unless forced', async () => {
    const { sync, client } = setup();
    await sync.start();
    await sync.sync();
    expect(client.request).toHaveBeenCalledTimes(1);
    clock += 5 * 60_000 + 1;
    await sync.sync();
    expect(client.request).toHaveBeenCalledTimes(2);
    await sync.sync({ force: true });
    expect(client.request).toHaveBeenCalledTimes(3);
  });

  it('shares one request between overlapping syncs', async () => {
    const { sync, client } = setup();
    await Promise.all([sync.sync({ force: true }), sync.sync({ force: true })]);
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('keeps the last synced copy across a restart when Director is unreachable', async () => {
    const first = setup();
    await first.sync.start();
    const synced = first.sync.getPreset();

    const offline = setup({ kit: new DirectorApiError(0, 'NETWORK_ERROR', 'offline') });
    await offline.sync.start();
    expect(offline.sync.getPreset()).toEqual(synced);
  });

  it('drops a cached kit that belongs to another workspace', async () => {
    const first = setup();
    await first.sync.start();

    const other = setup({
      state: { ...SIGNED_IN, workspace: { id: 'w2', name: 'Other' } },
      kit: new DirectorApiError(0, 'NETWORK_ERROR', 'offline'),
    });
    await other.sync.start();
    expect(other.sync.getPreset()).toBeNull();
  });

  it('removes the kit when the token may not read it (403)', async () => {
    const first = setup();
    await first.sync.start();

    const forbidden = setup({ kit: new DirectorApiError(403, 'FORBIDDEN', 'Missing scope') });
    await forbidden.sync.start();
    expect(forbidden.sync.getPreset()).toBeNull();
    expect(await forbidden.cache.load()).toBeNull();
  });

  it('keeps the previous logo if a new download fails, and drops it when the kit has none', async () => {
    const { sync, download } = setup();
    await sync.start();
    const logoPath = sync.getPreset()?.logo?.path;

    download.mockResolvedValueOnce(null);
    await sync.sync({ force: true });
    expect(sync.getPreset()?.logo?.path).toBe(logoPath);

    const noLogo = setup({ kit: { ...KIT, logoUrl: null } });
    await noLogo.sync.start();
    expect(noLogo.sync.getPreset()?.logo).toBeNull();
    await expect(fs.stat(logoPath as string)).rejects.toThrow();
  });

  it('only tells listeners when the kit changed', async () => {
    const { sync, changes } = setup();
    await sync.start();
    clock += 60 * 60_000;
    await sync.sync({ force: true });
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('throws away a sync that finished after the user signed out', async () => {
    const { sync, account, client } = setup();
    let release: (kit: DirectorBrandKit) => void = () => undefined;
    client.request.mockImplementationOnce(
      () => new Promise<DirectorBrandKit>((resolve) => (release = resolve)),
    );
    const pending = sync.sync({ force: true });
    account.set({ status: 'signed-out' });
    release(KIT);
    await pending;
    expect(sync.getPreset()).toBeNull();
  });
});

describe('downloadLogo', () => {
  const respond = (body: Uint8Array, headers: Record<string, string>, status = 200) =>
    vi.fn(async () => new Response(body, { status, headers }));

  it('downloads an image', async () => {
    const fetch = respond(PNG, { 'content-type': 'image/png' });
    expect(await downloadLogo(fetch, 'https://cdn.example.com/l.png')).toEqual({
      bytes: PNG,
      mime: 'image/png',
    });
  });

  it('works out the type from the bytes when storage sends a generic one', async () => {
    const fetch = respond(PNG, { 'content-type': 'application/octet-stream' });
    expect((await downloadLogo(fetch, 'https://cdn.example.com/l'))?.mime).toBe('image/png');
  });

  it('refuses non-https URLs, errors, non-images and oversized files', async () => {
    const ok = respond(PNG, { 'content-type': 'image/png' });
    expect(await downloadLogo(ok, 'http://cdn.example.com/l.png')).toBeNull();
    expect(await downloadLogo(ok, 'file:///etc/passwd')).toBeNull();
    expect(ok).not.toHaveBeenCalled();

    expect(
      await downloadLogo(respond(PNG, { 'content-type': 'image/png' }, 404), 'https://x.co/l'),
    ).toBeNull();
    expect(
      await downloadLogo(
        respond(Buffer.from('<html>'), { 'content-type': 'text/html' }),
        'https://x.co/l',
      ),
    ).toBeNull();
    expect(
      await downloadLogo(respond(PNG, { 'content-type': 'image/png' }), 'https://x.co/l', 4),
    ).toBeNull();
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await downloadLogo(failing, 'https://x.co/l')).toBeNull();
  });
});
