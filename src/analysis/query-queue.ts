/** Keep one WASM query in flight, and rebuild a damaged engine once per query.
 * Ordinary SQL errors are returned without restarting or repeating the query.
 */
export function createQueryQueue<T, R>(options: {
  execute: (request: T) => Promise<R>;
  recover: () => Promise<void>;
  signal: AbortSignal;
}) {
  let tail: Promise<unknown> = Promise.resolve();
  const check = () => {
    if (options.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  };

  return (request: T): Promise<R> => {
    const run = async () => {
      check();
      try {
        const value = await options.execute(request);
        check();

        return value;
      } catch (error) {
        check();
        if (!isEngineFailure(error)) throw error;
        console.warn('Restarting local analysis after engine failure:', error);
        await options.recover();
        check();
        try {
          const value = await options.execute(request);
          check();

          return value;
        } catch (retryError) {
          check();
          if (isEngineFailure(retryError))
            throw new Error(
              'Local analysis could not finish this query. Try a smaller region or a simpler query.',
              { cause: retryError },
            );

          throw retryError;
        }
      }
    };

    const result = tail.then(run);
    tail = result.catch(() => {});

    return result;
  };
}

export function isEngineFailure(error: unknown) {
  return /_setThrew|memory access out of bounds|out of memory|allocation.*failed|wasm.*trap|unreachable|aborted\(/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
