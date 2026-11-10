import { useEffect, useState } from 'react';
import type { ShareLibrary } from '../types';

const EMPTY: ShareLibrary = { links: {}, pending: {} };

/**
 * Each project's share link and unfinished upload. Shows what's saved
 * straight away, then asks Director for the latest status and expiry.
 */
export const useShareLibrary = (): ShareLibrary => {
  const [library, setLibrary] = useState<ShareLibrary>(EMPTY);

  useEffect(() => {
    let isMounted = true;
    const unsubscribe = window.screenforge.onShareLibraryChanged((next) => {
      if (isMounted) {
        setLibrary(next);
      }
    });
    const apply = (next: ShareLibrary) => {
      if (isMounted) {
        setLibrary(next);
      }
    };
    void window.screenforge
      .getShareLibrary()
      .then(apply)
      .then(() => window.screenforge.refreshShareLibrary())
      .then(apply)
      .catch(() => undefined);
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return library;
};
