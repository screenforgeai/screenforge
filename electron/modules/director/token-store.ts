import fs from 'node:fs/promises';
import path from 'node:path';
import type { SignedInAccount } from './sign-in';

/** The part of Electron's safeStorage the store uses (OS keychain-backed). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  /** Linux only in Electron; 'basic_text' means no real keychain. */
  getSelectedStorageBackend?(): string;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * The Director account, encrypted with the OS keychain (macOS Keychain,
 * Windows DPAPI, the Linux secret service) and kept in userData. Where
 * there is no real keychain the account is never written: the user stays
 * signed in until Screenforge quits.
 */
export function createTokenStore({
  filePath,
  safeStorage,
}: {
  filePath: string;
  safeStorage: SafeStorageLike;
}) {
  const canPersist = () =>
    safeStorage.isEncryptionAvailable() &&
    safeStorage.getSelectedStorageBackend?.() !== 'basic_text';

  return {
    canPersist,
    async save(account: SignedInAccount): Promise<boolean> {
      if (!canPersist()) {
        return false;
      }
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, safeStorage.encryptString(JSON.stringify(account)), {
        mode: 0o600,
      });
      return true;
    },
    async load(): Promise<SignedInAccount | null> {
      if (!canPersist()) {
        return null;
      }
      try {
        const account = JSON.parse(
          safeStorage.decryptString(await fs.readFile(filePath)),
        ) as Partial<SignedInAccount>;
        return typeof account.accessToken === 'string' && account.user && account.workspace
          ? (account as SignedInAccount)
          : null;
      } catch {
        return null;
      }
    },
    async clear(): Promise<void> {
      await fs.rm(filePath, { force: true });
    },
  };
}
