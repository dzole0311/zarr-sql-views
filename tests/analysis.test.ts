import { describe, expect, it } from 'vitest';
import { Param } from '@uwdata/mosaic-core';
import {
  createAnalysisState,
  readOnlyQuery,
  updateFilters,
  valuePredicate,
} from '../src/analysis/state';

describe('linked analysis selections', () => {
  it('intersects threshold and time window, and clears them independently', async () => {
    const state = createAnalysisState();
    state.value.update({ mode: 'above', low: 20, high: 30 });
    state.hours.update([48, 96]);
    updateFilters(state);
    await state.selection.pending('value');
    expect(String(state.selection.predicate())).toContain('value > 20');
    expect(String(state.selection.predicate())).toContain('forecast_hour BETWEEN 48 AND 96');
    state.value.update({ mode: 'all', low: 20, high: 30 });
    updateFilters(state);
    await state.selection.pending('value');
    expect(String(state.selection.predicate())).not.toContain('value >');
    expect(String(state.selection.predicate())).toContain('forecast_hour BETWEEN');
    state.hours.update(null);
    updateFilters(state);
    await state.selection.pending('value');
    expect(state.selection.predicate()).toEqual([]);
  });
  it('normalizes reversed bounds and rejects nonfinite thresholds', () => {
    expect(String(valuePredicate({ mode: 'between', low: 30, high: -5 }))).toBe(
      'value BETWEEN -5 AND 30',
    );
    expect(() => valuePredicate({ mode: 'above', low: NaN, high: 1 })).toThrow();
  });
  it('publishes slider values without waiting for database queries', async () => {
    const cuts = Param.value([160, 0, 60]);
    let current = cuts.value;
    cuts.addEventListener('value', (value) => {
      current = value;
    });
    cuts.update([160, 0, 30]);
    expect(current).toEqual([160, 0, 30]);
    cuts.update([80, 5, 20]);
    await cuts.pending('value');
    expect(cuts.value).toEqual([80, 5, 20]);
  });
});
describe('local SQL query envelope', () => {
  it('accepts SELECT and CTE queries as subqueries', () => {
    expect(readOnlyQuery(' SELECT * FROM loaded_forecast; ')).toBe(
      '(SELECT * FROM loaded_forecast)',
    );
    expect(
      readOnlyQuery(
        'WITH hot AS (SELECT * FROM loaded_forecast WHERE value > 30) SELECT * FROM hot',
      ),
    ).toContain('(WITH hot');
  });
  it('rejects mutation statements and multiple statements', () => {
    for (const input of [
      'DELETE FROM samples',
      'SELECT 1; DROP TABLE samples',
      "COPY samples TO 'file'",
      'INSTALL httpfs',
      '',
    ]) {
      expect(() => readOnlyQuery(input)).toThrow('single SELECT');
    }
  });
});
