import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTokenStore, type SafeStorageLike } from './token-store';

const ACCOUNT = {
  accessToken: 'sfd_secret_token',
  user: { id: 'u1', email: 'mohib@screenforge.co' },
  workspace: { id: 'w1', name: 'Screenforge' },
};

// Reversible stand-in for the OS keychain's encryption.
const keychain = (backend = 'keychain'): SafeStorageLike => ({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => backend,
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s).toString('base64')}`),
  decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString(),
});

describe('token store', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-token-'));
    file = path.join(dir, 'director-account.bin');
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it('round-trips the account through the OS keychain', async () => {
    const store = createTokenStore({ filePath: file, safeStorage: keychain() });
    expect(await store.save(ACCOUNT)).toBe(true);
    expect(await store.load()).toEqual(ACCOUNT);
  });

  it('never writes the token in plain text', async () => {
    const store = createTokenStore({ filePath: file, safeStorage: keychain() });
    await store.save(ACCOUNT);
    expect((await fs.readFile(file)).toString()).not.toContain('sfd_secret_token');
  });

  it("doesn't persist where there's no real keychain (Linux without a secret service)", async () => {
    for (const safeStorage of [
      keychain('basic_text'),
      { ...keychain(), isEncryptionAvailable: () => false },
    ]) {
      const store = createTokenStore({ filePath: file, safeStorage });
      expect(store.canPersist()).toBe(false);
      expect(await store.save(ACCOUNT)).toBe(false);
      await expect(fs.stat(file)).rejects.toThrow();
    }
  });

  it('loads nothing when there is no file, or it cannot be read', async () => {
    const store = createTokenStore({ filePath: file, safeStorage: keychain() });
    expect(await store.load()).toBeNull();
    await fs.writeFile(file, 'garbage');
    expect(await store.load()).toBeNull();
  });

  it('clears the stored account on sign-out', async () => {
    const store = createTokenStore({ filePath: file, safeStorage: keychain() });
    await store.save(ACCOUNT);
    await store.clear();
    expect(await store.load()).toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});
