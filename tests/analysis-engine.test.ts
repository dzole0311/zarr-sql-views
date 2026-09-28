import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createAnalysisState, applySQL } from '../src/analysis/state';
import { forecastViewSQL } from '../src/analysis/forecast-view';

it('repeated full-region filters stay within 64 MB without coordinate joins', async () => {
  const require = createRequire(import.meta.url);
  const root = path.dirname(path.dirname(require.resolve('@duckdb/duckdb-wasm')));
  const duck = require(path.join(root, 'dist/duckdb-node-blocking.cjs'));
  const db = await duck.createDuckDB(
    {
      mvp: { mainModule: path.join(root, 'dist/duckdb-mvp.wasm') },
      eh: { mainModule: path.join(root, 'dist/duckdb-eh.wasm') },
    },
    new duck.VoidLogger(),
    duck.NODE_RUNTIME,
  );
  await db.instantiate();
  const connection = db.connect();
  try {
    connection.query("SET memory_limit='64MB'; SET threads=1; SET preserve_insertion_order=false;");
    connection.query(
      'CREATE TABLE samples AS SELECT i::INTEGER AS cell_id, (i % 41)::FLOAT AS value FROM range(1581181) t(i)',
    );
    connection.query(
      forecastViewSQL({
        shape: [61, 161, 161],
        lon: Array.from({ length: 161 }, (_, i) => i / 4),
        lat: Array.from({ length: 161 }, (_, i) => 30 + i / 4),
        times: Array.from({ length: 61 }, (_, i) => i * 6),
        timeUnits: 'hours',
        variable: 'temperature_2m',
      }),
    );
    const plan = connection
      .query('EXPLAIN SELECT cell_id FROM loaded_forecast WHERE value > 21.0123911322249')
      .toArray()
      .map((r: { explain_value: string }) => r.explain_value)
      .join('');
    expect(plan).not.toContain('JOIN');
    for (let i = 0; i < 100; i++) {
      const threshold = (i % 41) + 0.0123911322249;
      const op = i % 2 ? '<' : '>';
      const result = connection.query(
        `SELECT cell_id FROM loaded_forecast WHERE value IS NOT NULL AND value ${op} ${threshold}`,
      );
      const expected = Number(
        connection.query(`SELECT count(*) AS n FROM samples WHERE value ${op} ${threshold}`).get(0)
          .n,
      );
      expect(result.numRows).toBe(expected);
    }
    const row = connection.query('SELECT * FROM loaded_forecast WHERE cell_id=1581180').get(0);
    expect([row.longitude, row.latitude, row.forecast_hour]).toEqual([40, 70, 360]);
    expect(row.temperature).toBe(row.value);
    connection.query(
      'SELECT forecast_hour,avg(value) FROM loaded_forecast WHERE value>21 GROUP BY forecast_hour',
    );
    connection.query(
      'SELECT * FROM loaded_forecast WHERE x_index=80 AND y_index=80 ORDER BY forecast_hour',
    );

    const state = createAnalysisState();
    const query = 'SELECT cell_id FROM loaded_forecast WHERE value > 21';
    state.sqlDraft.update(query);
    applySQL(state, query);
    await state.selection.pending('value');
    const predicate = String(state.selection.predicate()[0]);
    expect(
      connection.query(`SELECT cell_id FROM loaded_forecast WHERE ${predicate}`).numRows,
    ).toBeGreaterThan(0);
    connection.query('UPDATE samples SET value=0');
    expect(connection.query(`SELECT cell_id FROM loaded_forecast WHERE ${predicate}`).numRows).toBe(
      0,
    );
    expect(state.appliedSQL.value).toBe(query);
    state.sqlDraft.update('SELECT cell_id FROM loaded_forecast WHERE value < 5');
    await state.sqlDraft.pending('value');
    expect(state.appliedSQL.value).toBe(query);
    applySQL(state, null);
    await state.selection.pending('value');
    expect(state.selection.predicate()).toEqual([]);
  } finally {
    connection.close();
    db.reset();
  }
}, 30000);
