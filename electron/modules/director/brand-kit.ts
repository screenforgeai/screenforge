import fs from 'node:fs/promises';
import path from 'node:path';
import { BRAND_KIT_PRESET_ID, brandKitToPreset } from '../../../src/lib/presets/brand-kit';
import { normalizeStylePreset } from '../../../src/lib/presets/style-preset';
import type { DirectorAccountState, DirectorBrandKit, StylePreset } from '../../../src/types/index';
import { isPresetImageMime, MAX_LOGO_BYTES, type PresetAssets } from '../presets/assets';
import { DirectorApiError, type DirectorClient } from './client';
import type { DirectorAccount } from './account';

/**
 * The Director workspace brand kit as a read-only style preset
 * (screenforgeai/screenforge#27). Synced at sign-in, at launch when signed
 * in, and when the presets menu opens (at most every few minutes); the
 * last synced copy is kept for when Director can't be reached.
 */

export interface BrandKitCacheEntry {
  workspaceId: string;
  preset: StylePreset;
}

type LogoImage = { bytes: Uint8Array; mime: string };

/** userData/director-brand-kit.json, plus the logo in the preset assets folder. */
export function createBrandKitCache({
  filePath,
  assets,
}: {
  filePath: string;
  assets: PresetAssets;
}) {
  return {
    async load(): Promise<BrandKitCacheEntry | null> {
      try {
        const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as Partial<BrandKitCacheEntry>;
        const preset = normalizeStylePreset(raw.preset);
        if (typeof raw.workspaceId !== 'string' || !preset || preset.id !== BRAND_KIT_PRESET_ID) {
          return null;
        }
        return { workspaceId: raw.workspaceId, preset: { ...preset, source: 'director' } };
      } catch {
        return null;
      }
    },
    async save(entry: BrandKitCacheEntry): Promise<void> {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(entry), 'utf8');
    },
    async clear(): Promise<void> {
      await fs.rm(filePath, { force: true });
      await assets.remove(BRAND_KIT_PRESET_ID);
    },
    writeLogo: (logo: LogoImage) =>
      assets.write(BRAND_KIT_PRESET_ID, 'logo', logo.bytes, logo.mime),
    removeLogo: () => assets.removeKind(BRAND_KIT_PRESET_ID, 'logo'),
  };
}

export type BrandKitCache = ReturnType<typeof createBrandKitCache>;

const sniffImageMime = (bytes: Uint8Array): string | null => {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47)) {
    return 'image/png';
  }
  if (starts(0xff, 0xd8, 0xff)) {
    return 'image/jpeg';
  }
  if (starts(0x47, 0x49, 0x46, 0x38)) {
    return 'image/gif';
  }
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    return 'image/webp';
  }
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return 'image/svg+xml';
  }
  return null;
};

/**
 * Downloads the brand kit logo from its signed URL (https only, an image,
 * at most 2 MB). Null when it can't; the caller keeps what it had.
 */
export async function downloadLogo(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  maxBytes = MAX_LOGO_BYTES,
): Promise<LogoImage | null> {
  try {
    if (new URL(url).protocol !== 'https:') {
      return null;
    }
    const response = await fetchImpl(url);
    if (!response.ok) {
      return null;
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > maxBytes) {
      return null;
    }
    const declared = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const mime = isPresetImageMime(declared) ? declared : sniffImageMime(bytes);
    return mime ? { bytes: Buffer.from(bytes), mime } : null;
  } catch {
    return null;
  }
}

export interface BrandKitSyncDeps {
  account: Pick<DirectorAccount, 'getState' | 'onChange' | 'call'>;
  client: Pick<DirectorClient, 'request'>;
  cache: BrandKitCache;
  downloadLogo: (url: string) => Promise<LogoImage | null>;
  now?: () => Date;
  /** Unforced syncs (the presets menu opening) run at most this often. */
  minIntervalMs?: number;
  log?: (message: string, detail?: unknown) => void;
}

const signedInWorkspace = (state: DirectorAccountState): string | null =>
  state.status === 'signed-in' ? state.workspace.id : null;

const sameStyle = (a: StylePreset | null, b: StylePreset | null) =>
  JSON.stringify(a && { ...a, savedAt: '' }) === JSON.stringify(b && { ...b, savedAt: '' });

export function createBrandKitSync({
  account,
  client,
  cache,
  downloadLogo: download,
  now = () => new Date(),
  minIntervalMs = 5 * 60_000,
  log = () => undefined,
}: BrandKitSyncDeps) {
  let current: BrandKitCacheEntry | null = null;
  let lastAttemptAt: number | null = null;
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const setCurrent = (next: BrandKitCacheEntry | null) => {
    const changed = !sameStyle(current?.preset ?? null, next?.preset ?? null);
    current = next;
    if (changed) {
      for (const listener of listeners) {
        listener();
      }
    }
  };

  const forget = async () => {
    lastAttemptAt = null;
    setCurrent(null);
    await cache.clear().catch((err: unknown) => log('could not clear the brand kit', err));
  };

  const run = async (workspaceId: string, workspaceName: string | null) => {
    let kit: DirectorBrandKit;
    try {
      kit = await account.call(() =>
        client.request<DirectorBrandKit>('/desktop/brand-kit', { auth: true }),
      );
    } catch (err) {
      if (err instanceof DirectorApiError && err.status === 403) {
        // The token can't read the brand kit: not available, not an error.
        if (signedInWorkspace(account.getState()) === workspaceId) {
          await forget();
        }
        return;
      }
      // A 401 signs out (handled through onChange); otherwise keep the last copy.
      log('brand kit sync failed', err instanceof Error ? err.message : err);
      return;
    }
    if (!kit || typeof kit !== 'object' || signedInWorkspace(account.getState()) !== workspaceId) {
      return;
    }

    const previousLogo =
      current?.workspaceId === workspaceId ? (current.preset.logo?.path ?? null) : null;
    let logoPath: string | null = null;
    if (kit.logoUrl) {
      const logo = await download(kit.logoUrl);
      logoPath = logo ? await cache.writeLogo(logo).catch(() => previousLogo) : previousLogo;
    } else {
      await cache.removeLogo().catch(() => undefined);
    }
    if (signedInWorkspace(account.getState()) !== workspaceId) {
      return;
    }

    const entry: BrandKitCacheEntry = {
      workspaceId,
      preset: brandKitToPreset(kit, {
        name: workspaceName?.trim() || 'Brand kit',
        savedAt: now().toISOString(),
        logoPath,
      }),
    };
    await cache.save(entry).catch((err: unknown) => log('could not save the brand kit', err));
    setCurrent(entry);
  };

  const sync = ({ force = false }: { force?: boolean } = {}): Promise<void> => {
    const state = account.getState();
    if (state.status !== 'signed-in') {
      return Promise.resolve();
    }
    if (inFlight) {
      return inFlight;
    }
    const at = now().getTime();
    if (!force && lastAttemptAt !== null && at - lastAttemptAt < minIntervalMs) {
      return Promise.resolve();
    }
    lastAttemptAt = at;
    inFlight = run(state.workspace.id, state.workspace.name).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    /** The brand kit preset, or null when signed out or it isn't available. */
    getPreset: (): StylePreset | null => current?.preset ?? null,

    onChange(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    sync,

    /** Call once the account has restored its sign-in. */
    async start(): Promise<void> {
      const cached = await cache.load();
      const workspaceId = signedInWorkspace(account.getState());
      if (cached && cached.workspaceId === workspaceId) {
        setCurrent(cached);
      } else if (cached) {
        await cache.clear().catch(() => undefined);
      }

      account.onChange((state) => {
        if (state.status === 'signed-out') {
          void forget();
          return;
        }
        if (state.status === 'signed-in') {
          const switched = current && current.workspaceId !== state.workspace.id;
          void (switched ? forget() : Promise.resolve()).then(() => sync({ force: true }));
        }
      });

      await sync({ force: true });
    },
  };
}

export type BrandKitSync = ReturnType<typeof createBrandKitSync>;
