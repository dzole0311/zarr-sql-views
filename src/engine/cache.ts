/** Byte-accounted LRU; entries larger than the budget are never retained. */
export class BudgetCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  bytes = 0;
  hits = 0;

  constructor(readonly budget: number) {}

  /** Return and promote an entry to the most recently used position. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;

    return entry.value;
  }

  /** Replace an entry, evicting older entries until it fits the byte budget. */
  set(key: string, value: T, bytes: number) {
    this.delete(key);
    if (bytes > this.budget) return;
    while (this.bytes + bytes > this.budget) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
  }

  delete(key: string) {
    const old = this.entries.get(key);
    if (old) {
      this.bytes -= old.bytes;
      this.entries.delete(key);
    }
  }

  /** Release retained entries while preserving the lifetime hit counter. */
  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}

export const chunkKey = (
  store: string,
  snapshot: string,
  variable: string,
  coords: number[],
  resolution = 'native',
) => JSON.stringify([store, snapshot, variable, resolution, coords]);

/** One consumer's abort only detaches that consumer. Shared work may finish into cache. */
export class Scheduler {
  private active = 0;
  private queued: { priority: number; run: () => void }[] = [];
  private pending = new Map<string, Promise<unknown>>();

  constructor(readonly concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency < 1)
      throw new RangeError('Scheduler concurrency must be a positive integer.');
  }

  /** Share keyed work, prioritize queued jobs, and detach aborted consumers independently. */
  run<T>(key: string, task: () => Promise<T>, signal?: AbortSignal, priority = 0): Promise<T> {
    if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    let shared = this.pending.get(key) as Promise<T> | undefined;
    if (!shared) {
      shared = new Promise<T>((resolve, reject) => {
        this.queued.push({
          priority,
          run: () => {
            this.active++;

            const execute = async () => {
              try {
                resolve(await task());
              } catch (error) {
                reject(error);
              } finally {
                await Promise.resolve();
                this.active--;
                this.pending.delete(key);
                this.pump();
              }
            };

            void execute();
          },
        });
      });

      this.pending.set(key, shared);
      this.pump();
    }

    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        cleanup();
        reject(new DOMException('Cancelled', 'AbortError'));
      };

      const cleanup = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, { once: true });

      shared!.then(
        (v) => {
          cleanup();
          if (!signal?.aborted) resolve(v);
        },
        (e) => {
          cleanup();
          reject(e);
        },
      );
    });
  }

  private pump() {
    this.queued.sort((a, b) => b.priority - a.priority);
    while (this.active < this.concurrency && this.queued.length) this.queued.shift()!.run();
  }
}
