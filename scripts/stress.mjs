/** Measure live store metadata and source-chunk sizes for the documented stress audit. */
import { Repository, Storage } from '@earthmover/icechunk';
import * as z from 'zarrita';
const collections = ['ecmwf-ifs-ens-forecast-15-day-0-25-degree'];
for (const id of collections) {
  const doc = await (await fetch(`https://stac.dynamical.org/${id}/collection.json`)).json();
  const repo = await Repository.open(Storage.newHttp(doc.assets['icechunk-https'].href));
  const session = await repo.readonlySession({ branch: 'main' });
  const arr = await z.open(z.root(session.store).resolve('temperature_2m'), { kind: 'array' });
  console.log(
    JSON.stringify(
      {
        id,
        snapshot: session.snapshotId,
        shape: arr.shape,
        chunks: arr.chunks,
        dimensions: arr.dimensionNames,
        dtype: arr.dtype,
        decodedChunkMiB: (arr.chunks.reduce((a, b) => a * b, 1) * 4) / 1048576,
      },
      null,
      2,
    ),
  );
}
const url =
  'https://storage.googleapis.com/gcp-public-data-arco-era5/ar/full_37-1h-0p25deg-chunk-1.zarr-v3';
const arr = await z.open(z.root(new z.FetchStore(url)).resolve('2m_temperature'), {
  kind: 'array',
});
console.log(
  JSON.stringify(
    {
      id: 'ARCO-ERA5',
      url,
      shape: arr.shape,
      chunks: arr.chunks,
      dimensions: arr.dimensionNames,
      dtype: arr.dtype,
      decodedChunkMiB: (arr.chunks.reduce((a, b) => a * b, 1) * 4) / 1048576,
    },
    null,
    2,
  ),
);
