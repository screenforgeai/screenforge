import { useEffect, useState } from 'react';
import type { DirectorAccountState } from '../types';

/** The optional Director sign-in, kept current from the main process. */
export function useDirectorAccount(): DirectorAccountState | null {
  const [state, setState] = useState<DirectorAccountState | null>(null);

  useEffect(() => {
    let isMounted = true;
    let receivedChange = false;

    // Subscribe first, so a change pushed while the snapshot loads wins.
    const unsubscribe = window.screenforge.onDirectorAccountChanged((next) => {
      receivedChange = true;
      setState(next);
    });

    void window.screenforge
      .getDirectorAccount()
      .then((next) => {
        if (isMounted && !receivedChange) {
          setState(next);
        }
      })
      .catch(() => {
        // The account is optional; never block the UI on it.
      });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return state;
}
