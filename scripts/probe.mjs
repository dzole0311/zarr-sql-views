import { loadEnv } from 'vite';
const env = {
  ...loadEnv(process.env.NODE_ENV || 'development', process.cwd(), 'VITE_'),
  ...process.env,
};
if (!env.VITE_DYNAMICAL_CATALOG_URL)
  throw Error('Set VITE_DYNAMICAL_CATALOG_URL before running this audit.');
/** Probe public AIFS metadata and sample chunks; requires network access. */
import { Repository, Storage } from '@earthmover/icechunk';
import * as z from 'zarrita';
const c = await (
  await fetch(new URL('ecmwf-aifs-single-forecast/collection.json', env.VITE_DYNAMICAL_CATALOG_URL))
).json();
const r = await Repository.open(Storage.newHttp(c.assets['icechunk-https'].href));
const s = await r.readonlySession({ branch: 'main' });
console.log('snapshot', s.snapshotId);
const a = await z.open(z.root(s.store).resolve('temperature_2m'), { kind: 'array' });
console.log('metadata', new TextDecoder().decode(await s.store.get('temperature_2m/zarr.json')));
const av = await z.open(z.root(s.store).resolve('ingested_forecast_length'), { kind: 'array' });
const d = await z.get(av);
console.log('availability', Array.from(d.data).filter(Number.isFinite).slice(-10));
for (const i of [3624, 3620, 3600, 3000, 1000]) {
  const start = performance.now();
  const chunk = await a.getChunk([i, 0, 0, 3]);
  let finite = 0;
  for (const v of chunk.data) if (Number.isFinite(v)) finite++;
  console.log({ i, finite, first: chunk.data.slice(0, 5), ms: performance.now() - start });
  if (finite) break;
}
