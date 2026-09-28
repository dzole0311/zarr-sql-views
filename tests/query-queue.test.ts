import { expect, it, vi } from 'vitest';
import { createQueryQueue } from '../src/analysis/query-queue';

it('serializes burst queries and retries an engine failure after rebuilding', async () => {
  const order: string[] = [];
  let failed = false,
    inFlight = 0;
  const queue = createQueryQueue({
    signal: new AbortController().signal,
    execute: async (id: number) => {
      expect(inFlight++).toBe(0);
      order.push(`start ${id}`);
      await Promise.resolve();
      inFlight--;
      if (id === 2 && !failed) {
        failed = true;
        throw new ReferenceError('_setThrew is not defined');
      }
      order.push(`end ${id}`);
      return id;
    },
    recover: async () => {
      order.push('rebuild');
    },
  });
  expect(await Promise.all([1, 2, 3, 4].map(queue))).toEqual([1, 2, 3, 4]);
  expect(order).toEqual([
    'start 1',
    'end 1',
    'start 2',
    'rebuild',
    'start 2',
    'end 2',
    'start 3',
    'end 3',
    'start 4',
    'end 4',
  ]);
});
it('does not restart for bad SQL and allows the next query to succeed', async () => {
  const recover = vi.fn();
  const queue = createQueryQueue({
    signal: new AbortController().signal,
    recover,
    execute: async (bad: boolean) => {
      if (bad) throw Error('Binder Error: unknown column');
      return 42;
    },
  });
  await expect(queue(true)).rejects.toThrow('unknown column');
  expect(await queue(false)).toBe(42);
  expect(recover).not.toHaveBeenCalled();
});
it('bounds recovery to one retry and gives an actionable failure', async () => {
  const recover = vi.fn(async () => {}),
    execute = vi.fn(async () => {
      throw Error('memory access out of bounds');
    });
  const queue = createQueryQueue({ signal: new AbortController().signal, recover, execute });
  await expect(queue(null)).rejects.toThrow('smaller region');
  expect(recover).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(2);
});
it('does not publish results or restart after dataset cancellation', async () => {
  const controller = new AbortController(),
    recover = vi.fn();
  const queue = createQueryQueue({
    signal: controller.signal,
    recover,
    execute: async () => {
      controller.abort();
      throw Error('_setThrew is not defined');
    },
  });
  await expect(queue(null)).rejects.toThrow('Cancelled');
  expect(recover).not.toHaveBeenCalled();
});
