import type { FeatureFlags } from '../../../src/types/index';

/** The PostHog flag that turns on Screenforge Director sign-in and share links. */
export const DIRECTOR_SHARING_FLAG = 'director-sharing';
/** The PostHog flag that turns on chunked export and background prerendering. */
export const CHUNKED_EXPORT_FLAG = 'chunked-export';
/** The PostHog flag that renders exports without canvas MSAA. */
export const FAST_EXPORT_EDGES_FLAG = 'fast-export-edges';
/** The PostHog flag that moves an install to the beta update feed. */
export const BETA_UPDATES_FLAG = 'beta-updates';

/** Each app flag and the PostHog flag behind it. */
export const FEATURE_FLAG_KEYS: Record<keyof FeatureFlags, string> = {
  directorSharing: DIRECTOR_SHARING_FLAG,
  chunkedExport: CHUNKED_EXPORT_FLAG,
  fastExportEdges: FAST_EXPORT_EDGES_FLAG,
  betaUpdates: BETA_UPDATES_FLAG,
};

const NAMES = Object.keys(FEATURE_FLAG_KEYS) as (keyof FeatureFlags)[];

export interface FeatureFlagsDeps {
  isPackaged: boolean;
  /**
   * Per flag, from SCREENFORGE_FEATURE_<NAME> (e.g.
   * SCREENFORGE_FEATURE_DIRECTOR_SHARING): '1' forces it on, '0' off.
   */
  overrides: Partial<Record<keyof FeatureFlags, string | undefined>>;
  /** PostHog's answer for a flag; null when there's no answer to be had. */
  evaluate: (flag: string) => Promise<boolean | null>;
  /** The last answers; a flag missing from the file has none. */
  readCache: () => Promise<Partial<FeatureFlags> | null>;
  /** Only flags PostHog answered; forced (overridden) flags are never saved. */
  writeCache: (flags: Partial<FeatureFlags>) => Promise<void>;
  onChange: (flags: FeatureFlags) => void;
}

/**
 * Feature flags for this release, from PostHog. Off unless PostHog says on:
 * no client, usage data turned off, offline or an unknown flag all read as
 * off. The last answers are kept, so the app starts as it was instead of
 * flickering until PostHog replies. Development builds are on; an override
 * wins over everything.
 */
export function createFeatureFlags(deps: FeatureFlagsDeps) {
  const fixed = {} as Record<keyof FeatureFlags, boolean | null>;
  for (const name of NAMES) {
    const override = deps.overrides[name];
    const forced = override === '1' ? true : override === '0' ? false : null;
    fixed[name] = forced ?? (deps.isPackaged ? null : true);
  }
  const asked = NAMES.filter((name) => fixed[name] === null);
  let flags = Object.fromEntries(NAMES.map((name) => [name, fixed[name] ?? false])) as FeatureFlags;
  // Only the newest refresh may change the flags; an older one that answers
  // late is dropped (e.g. "Share usage data" turned off while it was asking).
  let generation = 0;
  // Cache writes run one at a time, in order, so the file ends with the
  // latest answers.
  let writes: Promise<void> = Promise.resolve();

  const set = (next: FeatureFlags) => {
    if (NAMES.some((name) => next[name] !== flags[name])) {
      flags = next;
      deps.onChange({ ...flags });
    }
  };
  const remember = (value: FeatureFlags): Promise<void> => {
    const answered = Object.fromEntries(asked.map((name) => [name, value[name]]));
    writes = writes.then(() => deps.writeCache(answered)).catch(() => undefined);
    return writes;
  };

  return {
    get: (): FeatureFlags => ({ ...flags }),

    /** The last answers, before PostHog replies. */
    async load(): Promise<void> {
      if (asked.length === 0) {
        deps.onChange({ ...flags });
        return;
      }
      const started = generation;
      const cached = await deps.readCache().catch(() => null);
      // A refresh started meanwhile asks PostHog, which knows better than the file.
      if (!cached || started !== generation) {
        return;
      }
      const next = { ...flags };
      for (const name of asked) {
        const value = cached[name];
        if (typeof value === 'boolean') {
          next[name] = value;
        }
      }
      set(next);
    },

    /** Asks PostHog again; a flag whose answer errors keeps its value. */
    async refresh(): Promise<void> {
      if (asked.length === 0) {
        return;
      }
      const mine = ++generation;
      const answers = await Promise.all(
        asked.map((name) =>
          deps.evaluate(FEATURE_FLAG_KEYS[name]).then(
            (answer) => ({ name, answer: answer === true, failed: false }),
            () => ({ name, answer: false, failed: true }),
          ),
        ),
      );
      if (mine !== generation || answers.every((a) => a.failed)) {
        return;
      }
      const next = { ...flags };
      for (const { name, answer, failed } of answers) {
        if (!failed) {
          next[name] = answer;
        }
      }
      set(next);
      await remember({ ...flags });
    },
  };
}

export type FeatureFlagStore = ReturnType<typeof createFeatureFlags>;
