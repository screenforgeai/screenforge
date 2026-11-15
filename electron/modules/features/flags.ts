import type { FeatureFlags } from '../../../src/types/index';

/** The PostHog flag that turns on Screenforge Director sign-in and share links. */
export const DIRECTOR_SHARING_FLAG = 'director-sharing';

export interface FeatureFlagsDeps {
  isPackaged: boolean;
  /** SCREENFORGE_FEATURE_DIRECTOR_SHARING: '1' forces it on, '0' off. */
  override: string | undefined;
  /** PostHog's answer for a flag; null when there's no answer to be had. */
  evaluate: (flag: string) => Promise<boolean | null>;
  readCache: () => Promise<boolean | null>;
  writeCache: (value: boolean) => Promise<void>;
  onChange: (flags: FeatureFlags) => void;
}

/**
 * Feature flags for this release, from PostHog. Off unless PostHog says on:
 * no client, usage data turned off, offline or an unknown flag all read as
 * off. The last answer is kept, so the app starts as it was instead of
 * flickering until PostHog replies. Development builds are on; an override
 * wins over everything.
 */
export function createFeatureFlags(deps: FeatureFlagsDeps) {
  const forced = deps.override === '1' ? true : deps.override === '0' ? false : null;
  const fixed = forced ?? (deps.isPackaged ? null : true);
  let directorSharing = fixed ?? false;
  // Only the newest refresh may change the flag; an older one that answers
  // late is dropped (e.g. "Share usage data" turned off while it was asking).
  let generation = 0;
  // Cache writes run one at a time, in order, so the file ends with the
  // latest answer.
  let writes: Promise<void> = Promise.resolve();

  const set = (value: boolean) => {
    if (value !== directorSharing) {
      directorSharing = value;
      deps.onChange({ directorSharing });
    }
  };
  const remember = (value: boolean): Promise<void> => {
    writes = writes.then(() => deps.writeCache(value)).catch(() => undefined);
    return writes;
  };

  return {
    get: (): FeatureFlags => ({ directorSharing }),

    /** The last answer, before PostHog replies. */
    async load(): Promise<void> {
      if (fixed !== null) {
        deps.onChange({ directorSharing });
        return;
      }
      const started = generation;
      const cached = await deps.readCache().catch(() => null);
      // A refresh started meanwhile asks PostHog, which knows better than the file.
      if (cached !== null && started === generation) {
        set(cached);
      }
    },

    /** Asks PostHog again; an error keeps the current answer. */
    async refresh(): Promise<void> {
      if (fixed !== null) {
        return;
      }
      const mine = ++generation;
      let answer: boolean | null;
      try {
        answer = await deps.evaluate(DIRECTOR_SHARING_FLAG);
      } catch {
        return;
      }
      if (mine !== generation) {
        return;
      }
      set(answer === true);
      await remember(answer === true);
    },
  };
}

export type FeatureFlagStore = ReturnType<typeof createFeatureFlags>;
