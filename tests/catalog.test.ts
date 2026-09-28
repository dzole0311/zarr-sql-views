import { afterEach, expect, it, vi } from 'vitest';
import { readCatalog, resolveStore } from '../src/engine/resolve';
afterEach(() => vi.unstubAllGlobals());
const serve = (doc: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => doc })),
  );
it('lists catalog children with resolved relative links and no automatic model selection', async () => {
  serve({
    type: 'Catalog',
    title: 'Weather',
    links: [
      { rel: 'self', href: './catalog.json' },
      { rel: 'child', title: 'AIFS', href: './aifs/collection.json' },
      { rel: 'child', title: 'GFS', href: './gfs/collection.json' },
      { rel: 'child', title: 'Duplicate', href: './gfs/collection.json' },
    ],
  });
  expect(await readCatalog('https://example.org/catalog.json')).toEqual({
    title: 'Weather',
    choices: [
      { title: 'AIFS', url: 'https://example.org/aifs/collection.json' },
      { title: 'GFS', url: 'https://example.org/gfs/collection.json' },
    ],
  });
  await expect(resolveStore('https://example.org/catalog.json')).rejects.toThrow(
    'Choose a dataset',
  );
});
it('leaves direct stores and collections on the direct-open path', async () => {
  serve({ type: 'Collection' });
  expect(await readCatalog('https://example.org/collection.json')).toBeNull();
  expect(await readCatalog('https://example.org/data.zarr')).toBeNull();
});
it('reports empty catalogs and failed requests', async () => {
  serve({ type: 'Catalog', links: [] });
  await expect(readCatalog('https://example.org/catalog.json')).rejects.toThrow(
    'no child datasets',
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 404 })),
  );
  await expect(readCatalog('https://example.org/catalog.json')).rejects.toThrow('404');
});
it('rejects unsupported virtual cloud references before opening the WASM reader', async () => {
  serve({
    type: 'Collection',
    assets: {
      'icechunk-https': {
        href: 'https://example.org/repo.icechunk',
        'icechunk:virtual_chunk_containers': [{ url_prefix: 's3://public-weather/' }],
      },
    },
  });
  await expect(resolveStore('https://example.org/collection.json')).rejects.toThrow('non-virtual');
});
it('still resolves ordinary materialized Icechunk collections', async () => {
  serve({
    type: 'Collection',
    assets: { 'icechunk-https': { href: 'https://example.org/repo.icechunk' } },
  });
  expect((await resolveStore('https://example.org/collection.json')).url).toBe(
    'https://example.org/repo.icechunk',
  );
});

it('resolves collections and Icechunk paths with query parameters', async () => {
  serve({
    type: 'Collection',
    assets: { data: { href: './repo.icechunk?version=1', type: 'application/octet-stream' } },
  });
  const result = await resolveStore('https://example.org/collection.json?version=1');
  expect(result.url).toBe('https://example.org/repo.icechunk?version=1');
  expect(result.icechunk).toBe(true);
});

it('reports malformed STAC documents and assets without unsafe casts', async () => {
  serve(null);
  await expect(readCatalog('https://example.org/catalog.json')).rejects.toThrow('STAC JSON object');
  serve({ type: 'Collection', assets: { 'icechunk-https': null, bad: 42 } });
  await expect(resolveStore('https://example.org/collection.json')).rejects.toThrow('no supported');
});

it('ignores malformed catalog links and falls back from nontext titles', async () => {
  serve({
    type: 'Catalog',
    title: {},
    links: [null, 42, { rel: 'child', href: './a/collection.json', title: {} }],
  });
  expect(await readCatalog('https://example.org/catalog.json')).toEqual({
    title: 'Dataset catalog',
    choices: [{ url: 'https://example.org/a/collection.json', title: 'a' }],
  });
});

it('reads Item properties and gives the selected asset precedence', async () => {
  serve({
    type: 'Feature',
    properties: {
      'cube:dimensions': { time: { type: 'temporal' } },
      'cube:variables': { old: { type: 'data' } },
    },
    assets: {
      data: {
        href: './data.zarr',
        'cube:variables': { snow: { type: 'data', dimensions: ['time'] } },
      },
    },
  });
  const result = await resolveStore('https://example.org/item.json');
  expect(result.variables).toEqual(['snow']);
  expect(result.cube.dimensions).toEqual({ time: { type: 'temporal' } });
  expect(result.url).toBe('https://example.org/data.zarr');
});
