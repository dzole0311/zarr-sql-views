import { isWinterTime } from '../engine/time-labels';
import { useEffect, useState, useRef, useMemo } from 'react';
import type { Volume } from '../engine/types';
import { createAnalysisState, updateFilters, useParamValue, applySQL } from './state';
import type { AnalysisRuntime, MatchResult } from './runtime';

/** Own the lazy analysis runtime for a volume and suppress results after cancellation.
 * Geographic pans preserve SQL selections; variable and initialization changes reset them. */
export function useAnalysis(volume: Volume | null, enabled: boolean) {
  const [state] = useState(createAnalysisState);
  const value = useParamValue(state.value),
    hours = useParamValue(state.hours);
  const appliedSQL = useParamValue(state.appliedSQL);
  const scope = useRef<string | null>(null);

  const pendingMatches = useMemo<MatchResult | null>(
    () => (volume && appliedSQL ? { mask: new Uint8Array(volume.data.length), count: 0 } : null),
    [volume, appliedSQL],
  );

  const [runtime, setRuntime] = useState<AnalysisRuntime | null>(null);
  const [matches, setMatches] = useState<MatchResult | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const nextScope = volume ? `${volume.variable}:${volume.init}` : null;

    if (!volume || scope.current !== nextScope) {
      state.value.update({ mode: 'all', low: volume?.min ?? 0, high: volume?.max ?? 30 });
      state.hours.update(null);
      applySQL(state, null);

      state.sqlDraft.update(
        volume
          ? `SELECT cell_id, longitude, latitude, ${isWinterTime(volume.timeUnits) ? 'winter' : 'forecast_hour'}, value\nFROM loaded_forecast\nWHERE value > ${Number(((volume.min + volume.max) / 2).toPrecision(6))}`
          : '',
      );
    }

    scope.current = nextScope;
    setMatches(null);
    setRuntime(null);
    setError('');
    if (!volume || !enabled) return;
    const abort = new AbortController();
    let instance: AnalysisRuntime | undefined;
    setStatus('Preparing local analysis…');

    import('./runtime')
      .then(async (module) => {
        instance = await module.createRuntime(volume, abort.signal);
        if (abort.signal.aborted) {
          instance.dispose();

          return;
        }

        setRuntime(instance);

        const client = new module.MatchClient(
          instance,
          state,
          (value) => {
            if (!abort.signal.aborted) {
              setMatches(value);
              setStatus('');
              setError('');
            }
          },
          (error) => {
            if (!abort.signal.aborted) {
              setStatus(error ? '' : 'Updating selection…');
              setError(error || '');
            }
          },
        );

        instance.coordinator.connect(client);
      })
      .catch((error) => {
        if (!abort.signal.aborted) {
          setError(error.message);
          setStatus('');
        }
      });

    return () => {
      abort.abort();
      instance?.dispose();
    };
  }, [volume, enabled, state]);

  useEffect(() => {
    const timer = setTimeout(() => updateFilters(state), 120);

    return () => clearTimeout(timer);
  }, [state, value, hours]);

  return {
    state,
    runtime,
    matches:
      appliedSQL || value.mode !== 'all' || hours
        ? runtime?.volume === volume && matches
          ? matches
          : pendingMatches
        : null,
    status,
    error,
  };
}

export type Analysis = ReturnType<typeof useAnalysis>;
