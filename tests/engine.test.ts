import { describe, it, expect } from 'vitest';
import { BudgetCache, Scheduler, chunkKey } from '../src/engine/cache';
import {
  coordinateIndices,
  planChunks,
  sourceOffset,
  sample,
  coordinateDate,
  validateExtent,
} from '../src/engine/coordinates';
import { normalizeUrl } from '../src/engine/resolve';
import { color } from '../src/render/colors';
import type { Volume } from '../src/engine/types';
const fixture: Volume = {
  id: 'fixture',
  shape: [3, 2, 4],
  data: new Float32Array(
    Array.from(
      { length: 24 },
      (_, i) => Math.floor(i / 8) * 100 + (Math.floor(i / 4) % 2) * 10 + (i % 4),
    ),
  ),
  lon: [0, 1, 2, 3],
  lat: [49, 50],
  times: [0, 6, 18],
  timeUnits: 'hours',
  init: 0,
  extent: [0, 49, 3, 50],
  min: 0,
  max: 213,
  missing: 0,
  units: 'C',
  variable: 'temperature',
};
describe('shared request scheduling', () => {
  it('deduplicates concurrent consumers and enforces concurrency', async () => {
    const scheduler = new Scheduler(2);
    let calls = 0,
      active = 0,
      max = 0;
    const task = async () => {
      calls++;
      max = Math.max(max, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return 42;
    };
    expect(
      await Promise.all([
        scheduler.run('a', task),
        scheduler.run('a', task),
        scheduler.run('b', task),
        scheduler.run('c', task),
      ]),
    ).toEqual([42, 42, 42, 42]);
    expect(calls).toBe(3);
    expect(max).toBe(2);
  });
  it('cancelling one consumer leaves the other able to use shared work', async () => {
    const s = new Scheduler(1),
      c = new AbortController();
    let finish!: (v: number) => void;
    let calls = 0;
    const task = () => {
      calls++;
      return new Promise<number>((r) => (finish = r));
    };
    const a = s.run('chunk', task, c.signal),
      b = s.run('chunk', task);
    c.abort();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    finish(7);
    expect(await b).toBe(7);
    expect(calls).toBe(1);
  });
  it('does not enqueue a consumer that is already cancelled', async () => {
    const c = new AbortController();
    c.abort();
    let called = false;
    await expect(
      new Scheduler().run(
        'a',
        async () => {
          called = true;
          return 1;
        },
        c.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(called).toBe(false);
  });
  it('prioritizes queued active work and retries failures', async () => {
    const s = new Scheduler(1);
    let release!: () => void;
    const first = s.run('first', () => new Promise<void>((r) => (release = r)));
    const order: string[] = [];
    const low = s.run('low', async () => {
      order.push('low');
    });
    const high = s.run(
      'high',
      async () => {
        order.push('high');
      },
      undefined,
      10,
    );
    release();
    await Promise.all([first, low, high]);
    expect(order).toEqual(['high', 'low']);
    await expect(
      s.run('failed', async () => {
        throw Error('offline');
      }),
    ).rejects.toThrow('offline');
    await new Promise((r) => setTimeout(r, 0));
    expect(await s.run('failed', async () => 9)).toBe(9);
  });
});
describe('cache isolation and bounded memory', () => {
  it('isolates all chunk identity dimensions', () => {
    const keys = [
      chunkKey('a', 'v1', 'temp', [0, 1]),
      chunkKey('a', 'v2', 'temp', [0, 1]),
      chunkKey('a', 'v1', 'wind', [0, 1]),
      chunkKey('b', 'v1', 'temp', [0, 1]),
      chunkKey('a', 'v1', 'temp', [1, 1]),
      chunkKey('a', 'v1', 'temp', [0, 1], 'overview'),
    ];
    expect(new Set(keys).size).toBe(6);
  });
  it('evicts least recently used bytes and skips oversized entries', () => {
    const c = new BudgetCache<number>(10);
    c.set('a', 1, 4);
    c.set('b', 2, 4);
    expect(c.get('a')).toBe(1);
    c.set('c', 3, 4);
    expect(c.get('b')).toBeUndefined();
    expect(c.bytes).toBe(8);
    c.set('big', 4, 99);
    expect(c.bytes).toBe(8);
    c.set('a', 5, 2);
    expect(c.bytes).toBe(6);
    c.clear();
    expect(c.bytes).toBe(0);
  });
});
describe('coordinates and chunk planning', () => {
  it('handles descending latitude and a longitude seam', () => {
    expect(coordinateIndices([90, 60, 30, 0], 30, 60)).toEqual([1, 2]);
    expect(coordinateIndices([0, 90, 170, 180, 190, 270], 170, -170, true)).toEqual([2, 3, 4]);
  });
  it('includes edge chunks, pins init and does not key on slice', () => {
    expect(planChunks([2, 3, 5], [1, 3, 2], [[1], [0, 1, 2], [1, 2, 4]])).toEqual([
      [1, 0, 0],
      [1, 0, 1],
      [1, 0, 2],
    ]);
    expect(() => planChunks([3], [2], [[3]])).toThrow('bounds');
  });
  it('uses source strides independently of axis order', () => {
    expect(sourceOffset([3, 2, 1], [1, 0, 0], [2, 3, 2], [6, 2, 1])).toBe(11);
    expect(sourceOffset([1, 3, 2], [0, 1, 0], [2, 2, 3], [1, 2, 4])).toBe(11);
  });
  it('interprets time units and rejects invalid regions', () => {
    expect(coordinateDate(6, 'hours since 2024-01-01')).toBe('2024-01-01T06:00:00.000Z');
    expect(() => validateExtent([0, 50, 40, 30])).toThrow();
  });
  it('normalizes public S3 URLs and rejects embedded credentials', () => {
    expect(normalizeUrl('s3://bucket/array.zarr')).toBe(
      'https://bucket.s3.amazonaws.com/array.zarr',
    );
    expect(() => normalizeUrl('https://user:password@a.com')).toThrow('credentials');
  });
});
describe('deterministic cube, map and readout agreement', () => {
  it('XY, XT and YT intersections agree with native values', () => {
    const x = 2,
      y = 1,
      t = 2;
    const xy = Array.from({ length: 8 }, (_, i) => sample(fixture, i % 4, Math.floor(i / 4), t));
    const xt = Array.from({ length: 12 }, (_, i) => sample(fixture, i % 4, y, Math.floor(i / 4)));
    const yt = Array.from({ length: 6 }, (_, i) => sample(fixture, x, i % 2, Math.floor(i / 2)));
    expect(xy[y * 4 + x]).toBe(212);
    expect(xt[t * 4 + x]).toBe(212);
    expect(yt[t * 2 + y]).toBe(212);
    expect(color(xy[y * 4 + x], 0, 213)).toEqual(color(sample(fixture, x, y, t), 0, 213));
  });
  it('preserves missing cells and irregular forecast coordinates', () => {
    const missing = { ...fixture, data: fixture.data.slice() };
    missing.data[14] = NaN;
    expect(sample(missing, 2, 1, 1)).toBeNaN();
    expect(sample(missing, 4, 0, 0)).toBeNaN();
    expect(missing.times).toEqual([0, 6, 18]);
  });
});

it('releases a scheduler slot after a task throws synchronously', async () => {
  const scheduler = new Scheduler(1);
  const failed = scheduler.run('failed', () => {
    throw Error('synchronous failure');
  });
  const queued = scheduler.run('next', async () => 42);
  await expect(failed).rejects.toThrow('synchronous failure');
  await expect(queued).resolves.toBe(42);
  await expect(scheduler.run('failed', async () => 7)).resolves.toBe(7);
});

it('rejects scheduler concurrency values that cannot make progress', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity])
    expect(() => new Scheduler(value)).toThrow(RangeError);
});

it('rejects embedded S3 credentials before URL conversion', () => {
  expect(() => normalizeUrl('s3://user:password@bucket/array.zarr')).toThrow('credentials');
});

it('does not alias fractional or nonfinite sample indices to valid cells', () => {
  expect(sample(fixture, 0, 0.5, 0)).toBeNaN();
  expect(sample(fixture, NaN, 0, 0)).toBeNaN();
});
