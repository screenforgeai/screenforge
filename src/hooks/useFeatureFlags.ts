import { useEffect, useState } from 'react';
import type { FeatureFlags } from '../types';

const OFF: FeatureFlags = { directorSharing: false, chunkedExport: false };

/** This release's feature flags, kept current from the main process; off until known. */
export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>(OFF);

  useEffect(() => {
    let isMounted = true;
    let receivedChange = false;

    // Subscribe first, so a change pushed while the snapshot loads wins.
    const unsubscribe = window.screenforge.onFeatureFlagsChanged((next) => {
      receivedChange = true;
      setFlags(next);
    });

    void window.screenforge
      .getFeatureFlags()
      .then((next) => {
        if (isMounted && !receivedChange) {
          setFlags(next);
        }
      })
      .catch(() => {
        // Unknown flags stay off.
      });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return flags;
}
