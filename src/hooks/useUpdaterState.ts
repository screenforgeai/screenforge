import { useEffect, useState } from 'react';
import type { UpdaterState } from '../types';

export function useUpdaterState(): UpdaterState | null {
  const [state, setState] = useState<UpdaterState | null>(null);

  useEffect(() => {
    let isMounted = true;
    let receivedStateChange = false;

    const unsubscribe = window.screenforge.onUpdaterStateChanged((nextState) => {
      receivedStateChange = true;
      setState(nextState);
    });

    void window.screenforge
      .getUpdaterState()
      .then((nextState) => {
        if (isMounted && !receivedStateChange) {
          setState(nextState);
        }
      })
      .catch(() => {
        // Updater state is best-effort and should never block renderer boot.
      });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return state;
}
