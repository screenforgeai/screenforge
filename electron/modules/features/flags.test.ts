// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createFeatureFlags, DIRECTOR_SHARING_FLAG, type FeatureFlagsDeps } from './flags';

const setup = (over: Partial<FeatureFlagsDeps> = {}) => {
  let cached: boolean | null = null;
  const deps: FeatureFlagsDeps = {
    isPackaged: true,
    override: undefined,
    evaluate: vi.fn(async () => true),
    readCache: vi.fn(async () => cached),
    writeCache: vi.fn(async (value: boolean) => {
      cached = value;
    }),
    onChange: vi.fn(),
    ...over,
  };
  return { flags: createFeatureFlags(deps), deps };
};

describe('feature flags', () => {
  it('asks PostHog for the director-sharing flag', async () => {
    const { flags, deps } = setup();
    await flags.refresh();
    expect(deps.evaluate).toHaveBeenCalledWith(DIRECTOR_SHARING_FLAG);
    expect(DIRECTOR_SHARING_FLAG).toBe('director-sharing');
    expect(flags.get()).toEqual({ directorSharing: true });
  });

  it('is off until PostHog says otherwise', () => {
    expect(setup().flags.get()).toEqual({ directorSharing: false });
  });

  it('is off when PostHog has no answer (no client, opted out, offline)', async () => {
    const { flags } = setup({ evaluate: vi.fn(async () => null) });
    await flags.refresh();
    expect(flags.get().directorSharing).toBe(false);
  });

  it('starts from the last answer, so the app does not flicker at launch', async () => {
    const { flags, deps } = setup({
      readCache: vi.fn(async () => true),
      evaluate: vi.fn(async () => new Promise<boolean | null>(() => undefined)),
    });
    await flags.load();
    expect(flags.get().directorSharing).toBe(true);
    expect(deps.onChange).toHaveBeenCalledWith({ directorSharing: true });
  });

  it('remembers a fresh answer and announces a change', async () => {
    const { flags, deps } = setup({ evaluate: vi.fn(async () => true) });
    await flags.refresh();
    expect(deps.writeCache).toHaveBeenCalledWith(true);
    expect(deps.onChange).toHaveBeenCalledWith({ directorSharing: true });

    (deps.onChange as ReturnType<typeof vi.fn>).mockClear();
    await flags.refresh();
    expect(deps.onChange).not.toHaveBeenCalled();
  });

  it('turns off when PostHog stops answering yes', async () => {
    let answer: boolean | null = true;
    const { flags } = setup({ evaluate: vi.fn(async () => answer) });
    await flags.refresh();
    answer = null;
    await flags.refresh();
    expect(flags.get().directorSharing).toBe(false);
  });

  it('is on in development builds, without asking PostHog', async () => {
    const { flags, deps } = setup({ isPackaged: false });
    await flags.load();
    await flags.refresh();
    expect(flags.get().directorSharing).toBe(true);
    expect(deps.evaluate).not.toHaveBeenCalled();
  });

  it.each([
    ['1', true],
    ['0', false],
  ] as const)(
    'can be forced with SCREENFORGE_FEATURE_DIRECTOR_SHARING=%s',
    async (override, on) => {
      const { flags, deps } = setup({ override, evaluate: vi.fn(async () => !on) });
      await flags.load();
      await flags.refresh();
      expect(flags.get().directorSharing).toBe(on);
      expect(deps.evaluate).not.toHaveBeenCalled();
    },
  );

  it('lets the newest refresh win, even when an older one answers last', async () => {
    const answers: ((value: boolean | null) => void)[] = [];
    const { flags, deps } = setup({
      evaluate: vi.fn(
        () =>
          new Promise<boolean | null>((resolve) => {
            answers.push(resolve);
          }),
      ),
    });

    const older = flags.refresh();
    const newer = flags.refresh(); // e.g. "Share usage data" was just turned off
    answers[1](null);
    await newer;
    answers[0](true);
    await older;

    expect(flags.get().directorSharing).toBe(false);
    expect(deps.writeCache).toHaveBeenLastCalledWith(false);
    expect(deps.writeCache).not.toHaveBeenCalledWith(true);
  });

  it('writes the cache in order, so the file ends with the latest answer', async () => {
    const writes: boolean[] = [];
    const gate: { release?: () => void } = {};
    let answer = true;
    const { flags, deps } = setup({
      evaluate: vi.fn(async () => answer),
      writeCache: vi.fn(async (value: boolean) => {
        if (!gate.release) {
          await new Promise<void>((resolve) => {
            gate.release = resolve;
          });
        }
        writes.push(value);
      }),
    });

    const first = flags.refresh();
    // The first answer is being written when a newer one arrives.
    await vi.waitFor(() => expect(deps.writeCache).toHaveBeenCalledTimes(1));
    answer = false;
    const second = flags.refresh();
    await vi.waitFor(() => expect(flags.get().directorSharing).toBe(false));
    gate.release?.();
    await Promise.all([first, second]);

    expect(writes).toEqual([true, false]);
    expect(flags.get().directorSharing).toBe(false);
  });

  it('keeps its answer when PostHog errors', async () => {
    let fail = false;
    const { flags } = setup({
      evaluate: vi.fn(async () => {
        if (fail) {
          throw new Error('network');
        }
        return true;
      }),
    });
    await flags.refresh();
    fail = true;
    await expect(flags.refresh()).resolves.toBeUndefined();
    expect(flags.get().directorSharing).toBe(true);
  });
});
