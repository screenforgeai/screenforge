/**
 * The chunk runs of one capture, by run index. A run is registered the moment
 * its start arrives, before the start's own setup finishes, so encoded frames
 * that reach the main process during that setup wait for it instead of
 * finding no run (IPC handlers run concurrently).
 */
export class ChunkRuns<T> {
  private readonly runs = new Map<number, Promise<T>>();

  async start(runIndex: number, create: () => Promise<T>): Promise<void> {
    if (this.runs.has(runIndex)) {
      throw new Error(`Chunk run ${runIndex} already started`);
    }
    const ready = create();
    this.runs.set(runIndex, ready);
    try {
      await ready;
    } catch (error) {
      if (this.runs.get(runIndex) === ready) {
        this.runs.delete(runIndex);
      }
      throw error;
    }
  }

  get(runIndex: number): Promise<T> {
    const run = this.runs.get(runIndex);
    return run ?? Promise.reject(new Error(`Chunk run ${runIndex} was not started`));
  }

  /** The run, removed so it can be finished once. */
  take(runIndex: number): Promise<T> {
    const run = this.get(runIndex);
    this.runs.delete(runIndex);
    return run;
  }

  /** Every run whose start succeeded, for cleanup. */
  async settled(): Promise<T[]> {
    const results = await Promise.allSettled(this.runs.values());
    return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  }
}
