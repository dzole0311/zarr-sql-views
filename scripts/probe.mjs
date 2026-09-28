/** Probe public AIFS metadata and sample chunks; requires network access. */
import { Repository, Storage } from '@earthmover/icechunk';
import * as z from 'zarrita';
const c = await (
  await fetch('https://stac.dynamical.org/ecmwf-aifs-single-forecast/collection.json')
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
