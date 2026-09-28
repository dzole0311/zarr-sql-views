import type { Request, Response } from './types';

/** Own a data worker and route request-scoped progress and terminal responses.
 * Dispose the client when switching stores or unmounting the application. */
export class DataClient {
  private worker: Worker;
  private next = 0;
  private callbacks = new Map<number, (message: Response) => void>();

  constructor() {
    this.worker = new Worker(new URL('./data.worker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (e: MessageEvent<Response>) => {
      this.callbacks.get(e.data.id)?.(e.data);
      if (e.data.type !== 'progress') this.callbacks.delete(e.data.id);
    };

    this.worker.onerror = (e) => {
      for (const [id, callback] of this.callbacks)
        callback({
          id,
          type: 'error',
          message: `Data worker failed: ${e.message}. Check cross-origin isolation and WASM support.`,
        });
      this.callbacks.clear();
    };
  }

  /** Dispatch work and return a function that detaches the callback and requests cancellation. */
  request(
    request:
      | Omit<Extract<Request, { type: 'open' }>, 'id'>
      | Omit<Extract<Request, { type: 'load' }>, 'id'>
      | { type: 'stats' },
    callback: (r: Response) => void,
  ) {
    const id = ++this.next;
    this.callbacks.set(id, callback);
    this.worker.postMessage({ ...request, id });

    return () => {
      this.callbacks.delete(id);
      this.worker.postMessage({ id: ++this.next, type: 'cancel', target: id });
    };
  }

  dispose() {
    this.worker.terminate();
    this.callbacks.clear();
  }
}
