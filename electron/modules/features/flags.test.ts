// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { FeatureFlags } from '../../../src/types';
import {
  CHUNKED_EXPORT_FLAG,
  createFeatureFlags,
  DIRECTOR_SHARING_FLAG,
  type FeatureFlagsDeps,
} from './flags';

const setup = (over: Partial<FeatureFlagsDeps> = {}) => {
  let cached: Partial<FeatureFlags> | null = null;
  const deps: FeatureFlagsDeps = {
    isPackaged: true,
    overrides: {},
    evaluate: vi.fn(async () => true),
    readCache: vi.fn(async () => cached),
    writeCache: vi.fn(async (value: FeatureFlags) => {
      cached = value;
    }),
    onChange: vi.fn(),
    ...over,
  };
  return { flags: createFeatureFlags(deps), deps };
};

const ON = { directorSharing: true, chunkedExport: true };
const OFF = { directorSharing: false, chunkedExport: false };

describe('feature flags', () => {
  it('asks PostHog for each flag', async () => {
    const { flags, deps } = setup();
    await flags.refresh();
    expect(DIRECTOR_SHARING_FLAG).toBe('director-sharing');
    expect(CHUNKED_EXPORT_FLAG).toBe('chunked-export');
    expect(deps.evaluate).toHaveBeenCalledWith(DIRECTOR_SHARING_FLAG);
    expect(deps.evaluate).toHaveBeenCalledWith(CHUNKED_EXPORT_FLAG);
    expect(flags.get()).toEqual(ON);
  });

  it('answers each flag on its own', async () => {
    const { flags } = setup({
      evaluate: vi.fn(async (flag: string) => flag === CHUNKED_EXPORT_FLAG),
    });
    await flags.refresh();
    expect(flags.get()).toEqual({ directorSharing: false, chunkedExport: true });
  });

  it('is off until PostHog says otherwise', () => {
    expect(setup().flags.get()).toEqual(OFF);
  });

  it('is off when PostHog has no answer (no client, opted out, offline)', async () => {
    const { flags } = setup({ evaluate: vi.fn(async () => null) });
    await flags.refresh();
    expect(flags.get()).toEqual(OFF);
  });

  it('starts from the last answers, so the app does not flicker at launch', async () => {
    const { flags, deps } = setup({
      readCache: vi.fn(async () => ON),
      evaluate: vi.fn(async () => new Promise<boolean | null>(() => undefined)),
    });
    await flags.load();
    expect(flags.get()).toEqual(ON);
    expect(deps.onChange).toHaveBeenCalledWith(ON);
  });

  it('reads a cache written before chunked export existed', async () => {
    const { flags } = setup({
      readCache: vi.fn(async () => ({ directorSharing: true })),
      evaluate: vi.fn(async () => new Promise<boolean | null>(() => undefined)),
    });
    await flags.load();
    expect(flags.get()).toEqual({ directorSharing: true, chunkedExport: false });
  });

  it('remembers fresh answers and announces a change', async () => {
    const { flags, deps } = setup({ evaluate: vi.fn(async () => true) });
    await flags.refresh();
    expect(deps.writeCache).toHaveBeenCalledWith(ON);
    expect(deps.onChange).toHaveBeenCalledWith(ON);

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
    expect(flags.get()).toEqual(OFF);
  });

  it('is on in development builds, without asking PostHog', async () => {
    const { flags, deps } = setup({ isPackaged: false });
    await flags.load();
    await flags.refresh();
    expect(flags.get()).toEqual(ON);
    expect(deps.evaluate).not.toHaveBeenCalled();
  });

  it.each([
    ['directorSharing', '1', true],
    ['directorSharing', '0', false],
    ['chunkedExport', '1', true],
    ['chunkedExport', '0', false],
  ] as const)('can force %s with an override of %s', async (name, override, on) => {
    const { flags, deps } = setup({
      overrides: { [name]: override },
      evaluate: vi.fn(async () => !on),
    });
    await flags.load();
    await flags.refresh();
    expect(flags.get()[name]).toBe(on);
    // The forced flag is never asked; the other one still is.
    const asked = (deps.evaluate as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    const forcedKey = name === 'chunkedExport' ? CHUNKED_EXPORT_FLAG : DIRECTOR_SHARING_FLAG;
    expect(asked).not.toContain(forcedKey);
    expect(asked).toHaveLength(1);
  });

  it('lets the newest refresh win, even when an older one answers last', async () => {
    const answers: ((value: boolean | null) => void)[] = [];
    const { flags, deps } = setup({
      overrides: { chunkedExport: '0' },
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

    expect(flags.get()).toEqual(OFF);
    expect(deps.writeCache).toHaveBeenLastCalledWith(OFF);
    expect(deps.writeCache).not.toHaveBeenCalledWith({
      directorSharing: true,
      chunkedExport: false,
    });
  });

  it('writes the cache in order, so the file ends with the latest answers', async () => {
    const writes: FeatureFlags[] = [];
    const gate: { release?: () => void } = {};
    let answer = true;
    const { flags, deps } = setup({
      evaluate: vi.fn(async () => answer),
      writeCache: vi.fn(async (value: FeatureFlags) => {
        if (!gate.release) {
          await new Promise<void>((resolve) => {
            gate.release = resolve;
          });
        }
        writes.push(value);
      }),
    });

    const first = flags.refresh();
    // The first answers are being written when newer ones arrive.
    await vi.waitFor(() => expect(deps.writeCache).toHaveBeenCalledTimes(1));
    answer = false;
    const second = flags.refresh();
    await vi.waitFor(() => expect(flags.get().directorSharing).toBe(false));
    gate.release?.();
    await Promise.all([first, second]);

    expect(writes).toEqual([ON, OFF]);
    expect(flags.get()).toEqual(OFF);
  });

  it('keeps its answers when PostHog errors', async () => {
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
    expect(flags.get()).toEqual(ON);
  });
});
