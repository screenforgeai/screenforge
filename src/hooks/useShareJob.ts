import { useEffect, useState } from 'react';
import type { ShareJobState } from '../types';

const IDLE: ShareJobState = { status: 'idle' };

/** The share upload running in the main process, kept current. */
export const useShareJob = (): ShareJobState => {
  const [state, setState] = useState<ShareJobState>(IDLE);

  useEffect(() => {
    let isMounted = true;
    let receivedChange = false;
    const unsubscribe = window.screenforge.onShareStateChanged((next) => {
      receivedChange = true;
      setState(next);
    });
    void window.screenforge
      .getShareState()
      .then((next) => {
        if (isMounted && !receivedChange) {
          setState(next);
        }
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return state;
};
