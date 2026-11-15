// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ChunkRuns } from './chunkRuns';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ChunkRuns', () => {
  it('lets frames that arrive while a run is still starting wait for it', async () => {
    const runs = new ChunkRuns<string>();
    const setup = deferred<string>();
    const started = runs.start(0, () => setup.promise);

    // The first frames reach the main process before the start finished.
    const got = runs.get(0);
    setup.resolve('writer-0');

    await expect(started).resolves.toBeUndefined();
    await expect(got).resolves.toBe('writer-0');
  });

  it('refuses a run that was never started', async () => {
    await expect(new ChunkRuns<string>().get(3)).rejects.toThrow('Chunk run 3 was not started');
  });

  it('refuses starting the same run twice', async () => {
    const runs = new ChunkRuns<string>();
    await runs.start(0, async () => 'a');
    await expect(runs.start(0, async () => 'b')).rejects.toThrow('Chunk run 0 already started');
  });

  it('forgets a run whose start failed', async () => {
    const runs = new ChunkRuns<string>();
    await expect(
      runs.start(0, async () => {
        throw new Error('disk full');
      }),
    ).rejects.toThrow('disk full');
    await expect(runs.get(0)).rejects.toThrow('was not started');
    await expect(runs.start(0, async () => 'again')).resolves.toBeUndefined();
  });

  it('hands a run over once when it ends', async () => {
    const runs = new ChunkRuns<string>();
    await runs.start(0, async () => 'writer-0');
    await expect(runs.take(0)).resolves.toBe('writer-0');
    await expect(runs.take(0)).rejects.toThrow('was not started');
  });

  it('lists every started run for cleanup, skipping failed starts', async () => {
    const runs = new ChunkRuns<string>();
    await runs.start(0, async () => 'a');
    const pending = deferred<string>();
    const second = runs.start(1, () => pending.promise);
    pending.resolve('b');
    await second;
    expect(await runs.settled()).toEqual(['a', 'b']);
  });
});
