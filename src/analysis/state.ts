import { useCallback, useState, useSyncExternalStore, type SetStateAction } from 'react';
import { Param, Selection } from '@uwdata/mosaic-core';
import { sql } from '@uwdata/mosaic-sql';

/** Mosaic owns shared values; React only subscribes to them. */
export function useParamValue<T>(param: Param<T>) {
  const subscribe = useCallback(
    (notify: () => void) => {
      param.addEventListener('value', notify);

      return () => {
        param.removeEventListener('value', notify);
      };
    },
    [param],
  );

  return useSyncExternalStore(subscribe, () => param.value as T);
}

/** Create a stable Mosaic parameter with React-compatible functional state updates. */
export function useMosaicState<T>(initial: T) {
  const [param] = useState(() => Param.value(initial));
  const value = useParamValue(param);

  const set = useCallback(
    (next: SetStateAction<T>) => {
      param.update(typeof next === 'function' ? (next as (v: T) => T)(param.value as T) : next);
    },
    [param],
  );

  return [value, set, param] as const;
}

export type ValueFilter = {
  mode: 'all' | 'above' | 'below' | 'between';
  low: number;
  high: number;
};

export function createAnalysisState() {
  return {
    selection: Selection.intersect(),
    sqlDraft: Param.value(''),
    appliedSQL: Param.value<string | null>(null),
    value: Param.value<ValueFilter>({ mode: 'all', low: 0, high: 30 }),
    hours: Param.value<[number, number] | null>(null),
    sources: { value: {}, hours: {}, sql: {} },
  };
}

export type AnalysisState = ReturnType<typeof createAnalysisState>;

export function valuePredicate(filter: ValueFilter) {
  if (!Number.isFinite(filter.low) || !Number.isFinite(filter.high))
    throw Error('Enter finite filter values.');
  switch (filter.mode) {
    case 'above':
      return sql`value > ${filter.low}`;
    case 'below':
      return sql`value < ${filter.low}`;
    case 'between':
      return sql`value BETWEEN ${Math.min(filter.low, filter.high)} AND ${Math.max(filter.low, filter.high)}`;
    default:
      return null;
  }
}

/** Publish threshold and time selections through their stable Mosaic source identities. */
export function updateFilters(state: AnalysisState) {
  const value = state.value.value!;

  state.selection.update({
    source: state.sources.value,
    fields: [],
    value,
    predicate: valuePredicate(value),
  });

  const hours = state.hours.value;

  state.selection.update({
    source: state.sources.hours,
    fields: [],
    value: hours,
    predicate: hours ? sql`forecast_hour BETWEEN ${hours[0]} AND ${hours[1]}` : null,
  });
}

/** Wrapping a single SELECT lets DuckDB's parser enforce read-only expression context. */
export function readOnlyQuery(input: string) {
  const text = input.trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(text) || text.includes(';')) {
    throw Error('Use a single SELECT query over loaded_forecast.');
  }

  return `(${text})`;
}

/** Keep the SQL expression in Mosaic, rather than region-specific cell IDs. */
export function applySQL(state: AnalysisState, query: string | null) {
  const source = query ? readOnlyQuery(query) : null;
  state.appliedSQL.update(query);

  state.selection.update({
    source: state.sources.sql,
    fields: [],
    value: query,
    predicate: source ? sql`cell_id IN (SELECT cell_id FROM ${source} AS sql_selection)` : null,
  });
}
