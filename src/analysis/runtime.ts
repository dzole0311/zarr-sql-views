import { AsyncDuckDB, VoidLogger } from '@duckdb/duckdb-wasm';
import wasmURL from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import workerURL from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import {
  Coordinator,
  MosaicClient,
  wasmConnector,
  type Connector,
  type ConnectorQueryRequest,
} from '@uwdata/mosaic-core';
import type { Table } from '@uwdata/flechette';
import { Query, sql, type FilterExpr } from '@uwdata/mosaic-sql';
import type { Volume } from '../engine/types';
import { forecastViewSQL } from './forecast-view';
import type { AnalysisState } from './state';
import { createQueryQueue } from './query-queue';

/** Load dense values in bounded Arrow batches and disable external SQL access.
 * The abort signal terminates the dedicated worker, including during initialization. */
async function createBackend(volume: Volume, signal: AbortSignal) {
  const worker = new Worker(workerURL);
  const db = new AsyncDuckDB(new VoidLogger(), worker);
  const stop = () => {
    worker.terminate();
  };
  signal.addEventListener('abort', stop, { once: true });
  const check = () => {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  };
  try {
    check();
    await db.instantiate(wasmURL);
    check();
    const connection = await db.connect();
    await connection.query(
      "SET memory_limit='256MB'; SET threads=1; SET preserve_insertion_order=false;",
    );

    for (let start = 0; start < volume.data.length; start += 65536) {
      check();
      const end = Math.min(start + 65536, volume.data.length);
      const ids = Int32Array.from({ length: end - start }, (_, i) => start + i);

      await connection.insertArrowFromIPCStream(
        tableToIPC(tableFromArrays({ cell_id: ids, value: volume.data.slice(start, end) })),
        {
          name: 'samples',
          create: start === 0,
        },
      );
    }
    check();
    await connection.query(forecastViewSQL(volume));
    await connection.query('SET enable_external_access=false; SET lock_configuration=true;');

    return {
      connector: wasmConnector({ duckdb: db, connection }),
      dispose() {
        signal.removeEventListener('abort', stop);
        stop();
      },
    };
  } catch (error) {
    signal.removeEventListener('abort', stop);
    stop();
    throw error;
  }
}

/** Create a serialized Mosaic/DuckDB runtime with one recovery attempt per engine failure.
 * Call dispose when the owning volume is retired. */
export async function createRuntime(volume: Volume, signal: AbortSignal) {
  let backend = await createBackend(volume, signal);

  const query = createQueryQueue<ConnectorQueryRequest, unknown>({
    signal,

    execute: (request) =>
      request.type === 'exec'
        ? backend.connector.query({ ...request, type: 'exec' })
        : request.type === 'json'
          ? backend.connector.query({ ...request, type: 'json' })
          : backend.connector.query({ ...request, type: 'arrow' }),
    recover: async () => {
      backend.dispose();
      backend = await createBackend(volume, signal);
    },
  });

  const coordinator = new Coordinator({ query } as Connector, {
    cache: false,
    consolidate: false,
    preagg: { enabled: false },
  });

  let disposed = false;

  return {
    volume,
    coordinator,
    dispose() {
      if (disposed) return;
      disposed = true;
      coordinator.clear();
      backend.dispose();
    },
  };
}

export type AnalysisRuntime = Awaited<ReturnType<typeof createRuntime>>;

export type MatchResult = {
  mask: Uint8Array;
  count: number;
  /** Smallest slice bounds that reveal every matched cell. */
  revealCuts?: [number, number, number];
};

export class MatchClient extends MosaicClient {
  constructor(
    private runtime: AnalysisRuntime,
    state: AnalysisState,
    private result: (value: MatchResult) => void,
    private status: (error?: string) => void,
  ) {
    super(state.selection);
  }

  get filterStable() {
    return false;
  }

  query(filter?: FilterExpr | null) {
    return Query.from('loaded_forecast')
      .select('cell_id')
      .where(sql`value IS NOT NULL`, filter ?? []);
  }

  queryPending() {
    this.status();

    return this;
  }

  queryResult(data: unknown) {
    const table = data as Table;
    const ids = table.getChild('cell_id')!;
    const mask = new Uint8Array(this.runtime.volume.data.length);
    const [, ny, nx] = this.runtime.volume.shape;
    const revealCuts: [number, number, number] = [0, ny - 1, 0];
    for (let i = 0; i < table.numRows; i++) {
      const id = Number(ids.get(i));
      mask[id] = 255;
      revealCuts[0] = Math.max(revealCuts[0], id % nx);
      revealCuts[1] = Math.min(revealCuts[1], Math.floor(id / nx) % ny);
      revealCuts[2] = Math.max(revealCuts[2], Math.floor(id / (nx * ny)));
    }
    if (this.coordinator) this.result({ mask, count: table.numRows, revealCuts });

    return this;
  }

  queryError(error: Error) {
    if (this.coordinator) this.status(error.message);

    return this;
  }
}
