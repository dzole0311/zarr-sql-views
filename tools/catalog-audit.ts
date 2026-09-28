/** Run an explicit browser-triggered catalog audit through the production data client. */
import { DataClient } from '../src/engine/client';
import { readCatalog, AIFS } from '../src/engine/resolve';
import { initialRegion } from '../src/engine/initial-region';
import { coordinateIndices } from '../src/engine/coordinates';
import type { Metadata, Extent, Response } from '../src/engine/types';
const output = document.querySelector<HTMLPreElement>('#results')!;
const button = document.querySelector<HTMLButtonElement>('#run')!;
const rows: Record<string, unknown>[] = [];
const paint = () => {
  output.textContent = JSON.stringify(rows, null, 2);
};
button.onclick = async () => {
  button.disabled = true;
  rows.length = 0;
  const catalog = await readCatalog(AIFS);
  let cursor = 0;
  async function next() {
    while (cursor < catalog!.choices.length) {
      const choice = catalog!.choices[cursor++];
      const row: Record<string, unknown> = {
        title: choice.title,
        url: choice.url,
        status: 'opening',
      };
      rows.push(row);
      paint();
      const client = new DataClient();
      const start = performance.now();
      try {
        const request = (
          message:
            | { type: 'open'; options: { url: string } }
            | { type: 'load'; variable: string; init: number; extent: Extent },
        ) =>
          new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => {
              cancel();
              reject(Error('Timed out after 90 seconds'));
            }, 90000);
            const cancel = client.request(message, (response) => {
              if (response.type === 'progress') {
                row.progress = response.message;
                paint();
                return;
              }
              clearTimeout(timer);
              if (response.type === 'error') reject(Error(response.message));
              else resolve(response);
            });
          });
        const result = await request({ type: 'open', options: { url: choice.url } });
        if (result.type !== 'metadata') throw Error('No metadata');
        const meta: Metadata = result.metadata;
        row.variable = meta.variable;
        row.shape = meta.shape;
        row.chunks = meta.chunks;
        row.dimensions = meta.dimensions;
        row.timeSamples = meta.times.length;
        row.defaultRegion = initialRegion(meta, [-25, 34, 45, 72]);

        const region = row.defaultRegion as Extent;
        const x = coordinateIndices(meta.lon, region[0], region[2], true);
        const y = coordinateIndices(meta.lat, region[1], region[3]);
        const xs = x
          .slice(Math.max(0, Math.floor(x.length / 2) - 4), Math.floor(x.length / 2) + 4)
          .map((i) => ((((meta.lon[i] + 180) % 360) + 360) % 360) - 180)
          .sort((a, b) => a - b);
        const ys = y
          .slice(Math.max(0, Math.floor(y.length / 2) - 4), Math.floor(y.length / 2) + 4)
          .map((i) => meta.lat[i])
          .sort((a, b) => a - b);
        const extent: Extent = [xs[0], ys[0], xs.at(-1)!, ys.at(-1)!];
        row.sampleRegion = extent;
        row.status = 'loading';
        paint();
        const loaded = await request({
          type: 'load',
          variable: meta.variable,
          init: meta.complete.at(-1) ?? meta.initializations.length - 1,
          extent,
        });
        if (loaded.type !== 'volume') throw Error('No volume');
        row.status = 'passed';
        row.volumeShape = loaded.volume.shape;
        row.missing = loaded.volume.missing;
        row.min = loaded.volume.min;
        row.max = loaded.volume.max;
      } catch (error) {
        row.status = 'failed';
        row.error = (error as Error).message;
      } finally {
        client.dispose();
        row.seconds = Math.round((performance.now() - start) / 1000);
        delete row.progress;
        paint();
      }
    }
  }
  await Promise.all([next(), next()]);
  button.textContent = 'Audit complete';
  button.disabled = false;
};
