import { useEffect, useRef, useState } from 'react';
import type { Volume } from '../engine/types';
import { isWinterTime, timeValue } from '../engine/time-labels';
import { readOnlyQuery, useParamValue, applySQL } from '../analysis/state';
import type { Analysis } from '../analysis/useAnalysis';
import { Button, Popover } from './ui/primitives';
import { Info } from 'lucide-react';

export function AnalysisControls({
  volume,
  analysis,
  onEnable,
  slices,
  onReveal,
}: {
  volume: Volume;
  analysis: Analysis;
  onEnable: () => void;
  slices: [number, number, number];
  onReveal: (cuts: [number, number, number]) => void;
}) {
  const { state, runtime, matches, status, error } = analysis;
  const unit = volume.units === 'degree_Celsius' ? '°C' : volume.units;
  const last = timeValue(volume.times.at(-1)!, volume.timeUnits);
  const first = timeValue(volume.times[0], volume.timeUnits);
  const query = useParamValue(state.sqlDraft);
  const setQuery = (value: string) => state.sqlDraft.update(value);
  const applied = useParamValue(state.appliedSQL);
  const [queryError, setQueryError] = useState(''),
    [running, setRunning] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    generation.current++;
    setRunning(false);
    setQueryError('');

    return () => {
      generation.current++;
    };
  }, [volume]);

  const reset = () => {
    generation.current++;
    applySQL(state, null);
    setRunning(false);
    setQueryError('');
  };

  const run = async () => {
    if (!runtime) return;
    const id = ++generation.current;
    setRunning(true);
    setQueryError('');
    try {
      const source = readOnlyQuery(query);

      const schema = (await runtime.coordinator.query(
        `DESCRIBE SELECT * FROM ${source} AS result`,
        { type: 'json', cache: false },
      )) as { column_name: string }[];

      if (id !== generation.current) return;
      const hasIds = schema.some((field) => field.column_name === 'cell_id');
      applySQL(state, hasIds ? query : null);
    } catch (error) {
      if (id === generation.current) setQueryError((error as Error).message);
    } finally {
      if (id === generation.current) setRunning(false);
    }
  };

  const active = applied;
  const cuts = matches?.revealCuts;

  const clipped =
    !status &&
    !error &&
    matches &&
    matches.count > 0 &&
    cuts &&
    (cuts[0] > slices[0] || cuts[1] < slices[1] || cuts[2] > slices[2]);

  return (
    <details
      className="control-section analysis-controls sql-only"
      open
      onToggle={(e) => {
        if (e.currentTarget.open) onEnable();
      }}
    >
      <summary>SQL{active ? <span className="active-dot" /> : null}</summary>
      {(active || error) && (
        <div className="selection-summary">
          <p
            className={`selection-status ${error ? 'query-error' : ''}`}
            role="status"
            title={
              error ||
              `${matches?.count.toLocaleString() ?? 0} of ${volume.data.length.toLocaleString()} cells in the loaded region`
            }
          >
            {error ||
              (status
                ? 'Updating…'
                : matches
                  ? `${matches.count.toLocaleString()} cells`
                  : 'Preparing…')}
          </p>
          {active && (
            <button className="text-button" onClick={reset}>
              Clear
            </button>
          )}
        </div>
      )}
      {active && clipped && (
        <div className="selection-clipped">
          <p>SQL matches extend beyond the current slices.</p>
          <Button
            onClick={() =>
              onReveal([
                Math.max(slices[0], cuts[0]),
                Math.min(slices[1], cuts[1]),
                Math.max(slices[2], cuts[2]),
              ])
            }
          >
            Reveal all matches
          </Button>
        </div>
      )}
      <div className="sql-disclosure">
        <div className="query-toolbar">
          <code>loaded_forecast</code>
          <Popover
            trigger={
              <Button variant="ghost" className="icon" aria-label="Query reference">
                <Info size={14} />
              </Button>
            }
          >
            <div className="query-reference">
              <strong>Loaded region</strong>
              <p>
                {first} to {last} {isWinterTime(volume.timeUnits) ? 'winters' : 'forecast hours'} ·{' '}
                {unit}
              </p>
              <p>
                Columns: cell_id, longitude, latitude,{' '}
                {isWinterTime(volume.timeUnits) ? 'winter' : 'forecast_hour'}, value
                {volume.variable === 'temperature_2m' ? ', temperature' : ''}.
              </p>
              <p>
                Include cell_id to show matching cells in the cube. Filter values and time
                coordinates in your WHERE clause.
              </p>
            </div>
          </Popover>
        </div>
        <textarea
          aria-label="SQL query"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button className="run-query" disabled={!runtime || running} onClick={run}>
          {running ? 'Running…' : !runtime ? 'Preparing…' : 'Run query'}
        </Button>
        {queryError && (
          <p className="query-error" role="alert">
            {queryError}
          </p>
        )}
      </div>
    </details>
  );
}
