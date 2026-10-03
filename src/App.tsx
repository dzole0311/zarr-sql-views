import { remapSlices } from './render/slice-remap';
import { snowfallExample, isSnowfallExample } from './engine/examples';
import { isWinterTime, timeLabel } from './engine/time-labels';
import { squareExtent } from './engine/square-extent';
import { RegionDialog } from './components/RegionDialog';
import { valueRange, formatValue } from './render/value-scale';
import { regularDataset, isAvailableForecast } from './engine/dataset-support';
import { initialRegion } from './engine/initial-region';
import { OnboardingTour } from './components/OnboardingTour';
import { RunPicker } from './components/RunPicker';
import {
  addForecastPoint,
  anchoredCell,
  refreshForecastPoints,
  type ForecastPoint,
} from './analysis/points';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  PanelLeft,
  Plus,
  FolderOpen,
  Play,
  Pause,
  Settings2,
  AlertCircle,
  Search,
  X,
} from 'lucide-react';
import { Command } from 'cmdk';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { DataClient } from './engine/client';
import { AIFS, readCatalog, type CatalogChoice } from './engine/resolve';
import { coordinateDate, coordinateIndices, validateExtent } from './engine/coordinates';
import type { Extent, Metadata, Metrics, Volume, OpenRequest } from './engine/types';
import { Cube } from './components/Cube';
import { AnalysisControls } from './components/AnalysisControls';
import { useMosaicState } from './analysis/state';
import { useAnalysis } from './analysis/useAnalysis';
import { TimeSeries } from './components/LinkedViews';
import { Button, Dialog, Popover, Slider, Tip, TooltipProvider } from './components/ui/primitives';
import { gradient, snowfallRange, type Palette } from './render/colors';

const DEFAULT_EXTENT: Extent = [-25, 34, 45, 72];

const initialParams = new URLSearchParams(location.search);

const initialExtent = (() => {
  try {
    const e = JSON.parse(initialParams.get('extent') || 'null');
    if (!Array.isArray(e) || e.length !== 4) return DEFAULT_EXTENT;
    validateExtent(e as Extent);

    return e as Extent;
  } catch {
    return DEFAULT_EXTENT;
  }
})();

const prettyUnit = (u: string) => (u === 'degree_Celsius' ? '°C' : u);

const mb = (n: number) => (n / 1048576).toFixed(1) + ' MiB';

function dateLabel(v: number, units: string) {
  try {
    return coordinateDate(v, units)
      .replace('T', ' · ')
      .replace(/:00\.000Z$/, ' UTC');
  } catch {
    return String(v);
  }
}

export default function App() {
  const sidebarPanel = usePanelRef();
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 650px)').matches);

  useEffect(() => {
    const query = matchMedia('(max-width: 650px)');

    const update = () => {
      setNarrow(query.matches);
      setSidebar(false);
      sidebarPanel.current?.collapse();
    };

    query.addEventListener('change', update);

    return () => query.removeEventListener('change', update);
  }, []);

  const [selectedForecasts, setSelectedForecasts] = useMosaicState<ForecastPoint[]>([]);
  const openStarted = useRef(0),
    [firstPlane, setFirstPlane] = useState<number | null>(null);

  const markReady = useCallback(
    () => setFirstPlane((v) => v ?? performance.now() - openStarted.current),
    [],
  );

  const client = useRef<DataClient | null>(null),
    cancel = useRef<(() => void) | null>(null);
  const [meta, setMeta] = useState<Metadata | null>(null),
    [volume, setVolume] = useState<Volume | null>(null),
    [metrics, setMetrics] = useState<Metrics | null>(null);

  const [url, setUrl] = useState(initialParams.get('dataset') || AIFS),
    [variable, setVariable] = useState(initialParams.get('variable') || 'temperature_2m'),
    [init, setInit] = useState(0),
    [extent, setExtent] = useState<Extent>(initialExtent),
    [slices, setSlices] = useMosaicState<[number, number, number]>([0, 0, 0]);

  const [range, setRange] = useMosaicState<[number, number]>([-10, 35]),
    [palette, setPalette] = useMosaicState<Palette>('thermal');
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [regionDialog, setRegionDialog] = useState(false),
    [commands, setCommands] = useState(false),
    [diagnostics, setDiagnostics] = useState(false),
    [sidebar, setSidebar] = useState(true),
    [linked, setLinked] = useState(false),
    [playing, setPlaying] = useState(false),
    [reset, setReset] = useState(0);

  const [regionFailure, setRegionFailure] = useState<{ message: string } | null>(null);

  useEffect(() => {
    if (!regionFailure) return;
    const timer = setTimeout(() => setRegionFailure(null), 5000);

    return () => clearTimeout(timer);
  }, [regionFailure]);

  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const analysis = useAnalysis(volume, analysisEnabled);

  const renderError = useCallback((e: Error) => {
    console.error('zarr-sql-views rendering:', e);
    setError(e.message);
  }, []);

  const times = useRef<number[]>([]),
    stalls = useRef(0);
  const [warmStats, setWarmStats] = useState<{ p95: number; count: number } | null>(null);
  const warmStart = useRef<number | null>(null);
  const loadedShape = useRef<[number, number, number] | null>(null);
  const slicesRef = useRef(slices);
  slicesRef.current = slices;

  const load = useCallback((m: Metadata, v: string, i: number, e: Extent, keepView = false) => {
    let region: Extent;
    try {
      validateExtent(e);
      region = isSnowfallExample(m.url) ? e : squareExtent(e);
    } catch (error) {
      if (keepView) setRegionFailure({ message: 'Cannot move to this area.' });
      else setError((error as Error).message);
      setBusy(false);

      return;
    }
    cancel.current?.();
    setRegionFailure(null);
    if (
      keepView &&
      (!coordinateIndices(m.lon, region[0], region[2], true).length ||
        !coordinateIndices(m.lat, region[1], region[3]).length)
    ) {
      setBusy(false);
      setRegionFailure({ message: 'No data in this area.' });

      return;
    }

    setBusy(true);
    if (!keepView) {
      setVolume(null);
      setSelectedForecasts([]);
    }

    setError('');
    setPlaying(false);
    setMessage('Preparing regional selection…');

    cancel.current = client.current!.request(
      { type: 'load', variable: v, init: i, extent: region },
      (r) => {
        if (r.type === 'progress') setMessage(r.message);
        if (r.type === 'error') {
          if (keepView)
            setRegionFailure({
              message: r.message.startsWith('No source values')
                ? 'No data in this area.'
                : 'Could not load this area. Keep panning to try another region.',
            });
          else setError(r.message);

          setBusy(false);
        }

        if (r.type === 'volume') {
          setVolume(r.volume);
          if (keepView)
            setSelectedForecasts((previous) => refreshForecastPoints(previous, r.volume));
          setExtent(region);
          setMetrics(r.metrics);
          setBusy(false);
          if (isSnowfallExample(m.url) && ['winter_anomaly', 'event_anomaly'].includes(v)) {
            if (!keepView) setRange([...snowfallRange]);
          } else if (!keepView || paletteRef.current !== 'snowfall') {
            const nextRange = valueRange(r.volume.min, r.volume.max);
            const limit = Math.max(Math.abs(nextRange[0]), Math.abs(nextRange[1]));
            setRange(paletteRef.current === 'snowfall' ? [-limit, limit] : nextRange);
          }

          const shape = r.volume.shape;
          const previousShape = loadedShape.current;
          loadedShape.current = shape;

          const selected: [number, number, number] = [shape[2] - 1, 0, shape[0] - 1];
          setSlices((previous) =>
            keepView && previousShape ? remapSlices(previous, previousShape, shape) : selected,
          );
          setMeta({ ...m, variable: v, units: r.volume.units });
        }
      },
    );
  }, []);

  const openStore = useCallback(
    (options: OpenRequest, requestedExtent: Extent = DEFAULT_EXTENT) => {
      openStarted.current = performance.now();
      setFirstPlane(null);
      setRegionFailure(null);
      cancel.current?.();
      client.current?.dispose();
      client.current = new DataClient();
      setVolume(null);
      setSelectedForecasts([]);
      setMeta(null);
      setBusy(true);
      setError('');
      setPlaying(false);
      setMessage('Connecting to the remote dataset…');
      setUrl(options.url);

      setPalette(
        isSnowfallExample(options.url) &&
          (!options.variable || ['winter_anomaly', 'event_anomaly'].includes(options.variable))
          ? 'snowfall'
          : 'thermal',
      );

      cancel.current = client.current.request({ type: 'open', options }, (r) => {
        if (r.type === 'progress') setMessage(r.message);
        if (r.type === 'error') {
          setError(r.message);
          setBusy(false);
        }

        if (r.type === 'metadata') {
          setMeta(r.metadata);
          setMetrics(r.metrics);
          setVariable(r.metadata.variable);
          const desired = Number(initialParams.get('init'));

          const index =
            initialParams.has('init') &&
            Number.isInteger(desired) &&
            desired >= 0 &&
            desired < r.metadata.initializations.length
              ? desired
              : (r.metadata.complete.at(-1) ?? r.metadata.initializations.length - 1);

          setInit(index);
          try {
            const region = initialRegion(r.metadata, requestedExtent);
            setExtent(region);
            load(r.metadata, r.metadata.variable, index, region);
          } catch (error) {
            setError((error as Error).message);
            setBusy(false);
          }
        }
      });
    },
    [load],
  );

  const [catalog, setCatalog] = useState<{ title: string; choices: CatalogChoice[] } | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const catalogRequest = useRef(0);

  const open = useCallback(
    async (options: OpenRequest, requestedExtent: Extent = DEFAULT_EXTENT) => {
      const request = ++catalogRequest.current;
      setCatalogLoading(true);
      setCatalogError('');
      setCatalog(null);
      try {
        if (!options.url)
          throw Error('Set VITE_DYNAMICAL_CATALOG_URL to enable the dataset catalog.');
        const result = await readCatalog(options.url);
        if (request !== catalogRequest.current) return;
        setCatalogLoading(false);
        if (result)
          setCatalog({
            ...result,
            choices: result.choices.filter((choice) => isAvailableForecast(choice.url)),
          });
        else
          openStore(
            options,
            isSnowfallExample(options.url) && requestedExtent === DEFAULT_EXTENT
              ? snowfallExample.extent
              : requestedExtent,
          );
      } catch (error) {
        if (request !== catalogRequest.current) return;
        setCatalogLoading(false);
        setCatalogError((error as Error).message);
      }
    },
    [openStore],
  );

  useEffect(() => {
    if (initialParams.has('dataset'))
      open({ url, variable: initialParams.get('variable') || undefined }, initialExtent);

    return () => {
      catalogRequest.current++;
      client.current?.dispose();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommands((v) => !v);
      }

      if (e.key === 'Escape') setPlaying(false);
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!playing || !volume) return;

    const timer = setInterval(
      () => setSlices((s) => [s[0], s[1], (s[2] + 1) % volume.shape[0]]),
      175,
    );

    return () => clearInterval(timer);
  }, [playing, volume]);

  useEffect(() => {
    if (!volume) return;

    const params = new URLSearchParams({
      view: '2',
      dataset: url,
      variable,
      init: String(init),
      extent: JSON.stringify(extent),
      slices: JSON.stringify(slices),
    });

    history.replaceState(null, '', '?' + params);
    if (warmStart.current !== null) {
      const started = warmStart.current;

      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          times.current.push(performance.now() - started);
          times.current = times.current.slice(-200);
          const sorted = [...times.current].sort((a, b) => a - b);
          setWarmStats({ count: sorted.length, p95: sorted[Math.floor(sorted.length * 0.95)] });
        }),
      );

      warmStart.current = null;
    }
  }, [slices, volume, url, variable, init, extent]);

  useEffect(() => {
    let id = 0,
      last = performance.now();

    const tick = (now: number) => {
      if (now - last > 50) stalls.current++;
      last = now;
      id = requestAnimationFrame(tick);
    };

    id = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (diagnostics && client.current)
      client.current.request({ type: 'stats' }, (r) => {
        if (r.type === 'stats') setMetrics(r.metrics);
      });
  }, [diagnostics]);

  const updateSlices = (v: [number, number, number]) => {
    warmStart.current = performance.now();
    setSlices(v);
  };

  const resetCube = () => {
    setPlaying(false);
    if (volume) updateSlices([volume.shape[2] - 1, 0, volume.shape[0] - 1]);
    setReset((n) => n + 1);
  };

  const changeSlice = (axis: number, value: number) => {
    const s = [...slicesRef.current] as [number, number, number];
    s[axis] = value;
    updateSlices(s);
  };

  const initializationOptions = useMemo(
    () =>
      meta
        ? [...meta.initializations.keys()]
            .reverse()
            .map((i) => ({ value: i, label: dateLabel(meta.initializations[i], meta.initUnits) }))
        : [],
    [meta?.initializations, meta?.initUnits],
  );

  const selectedCells = useMemo(
    () =>
      volume
        ? selectedForecasts.flatMap((p) => {
            const cell = anchoredCell(p, volume);

            return cell
              ? [{ ...cell, t: slices[2], value: NaN, color: p.color, id: p.id, anchor: p.anchor }]
              : [];
          })
        : [],
    [volume, selectedForecasts, slices[2]],
  );

  const prepareTour = useCallback(
    (open: boolean) => {
      setSidebar(open);
      if (open) sidebarPanel.current?.expand();
      else sidebarPanel.current?.collapse();
    },
    [sidebarPanel],
  );

  const toggleSidebar = () => {
    if (narrow) {
      setSidebar((v) => !v);

      return;
    }

    if (sidebarPanel.current?.isCollapsed()) sidebarPanel.current.expand();
    else sidebarPanel.current?.collapse();
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="app-shell">
        <header className="app-bar">
          <div className="header-identity">
            <a href="/" className="brand" aria-label="zarr-sql-views home">
              <span>zarr-sql-views</span>
            </a>
            {meta && (
              <div className="header-context" title={meta.title}>
                {meta.title}
              </div>
            )}
          </div>
          <div className="bar-actions">
            <Button variant="ghost" onClick={() => open({ url: AIFS })}>
              <FolderOpen size={15} />
              <span>Open dataset</span>
            </Button>
          </div>
        </header>
        <OnboardingTour ready={!!volume && !busy} prepare={prepareTour} />
        {busy && !volume && (
          <div className="dataset-loading-overlay">
            <div className="loading-state" role="status">
              <div className="loading-caption">
                <span>Loading dataset</span>
                <Button
                  variant="ghost"
                  className="icon"
                  aria-label="Cancel loading"
                  onClick={() => {
                    cancel.current?.();
                    setBusy(false);
                    setMessage('');
                  }}
                >
                  <X size={14} />
                </Button>
              </div>
              <progress
                aria-label="Dataset loading progress"
                max={1}
                value={
                  /Loaded (\d+) of (\d+)/.test(message)
                    ? Number(message.match(/Loaded (\d+) of (\d+)/)![1]) /
                      Number(message.match(/Loaded (\d+) of (\d+)/)![2])
                    : undefined
                }
              />
            </div>
          </div>
        )}
        <div className="workspace" inert={busy && !volume} aria-busy={busy && !volume}>
          {meta && (
            <nav className="control-rail" aria-label="View controls">
              <Tip label={sidebar ? 'Collapse controls' : 'Expand controls'}>
                <Button
                  className="icon"
                  variant="ghost"
                  aria-label={sidebar ? 'Collapse controls' : 'Expand controls'}
                  aria-expanded={sidebar}
                  onClick={toggleSidebar}
                >
                  <PanelLeft size={19} />
                </Button>
              </Tip>
            </nav>
          )}
          <Group orientation="horizontal" className="workbench">
            {meta && (
              <Panel
                className={`sidebar-panel ${sidebar ? 'expanded' : ''}`}
                panelRef={sidebarPanel}
                collapsible
                collapsedSize="0px"
                defaultSize="280px"
                minSize="260px"
                maxSize="340px"
                onResize={(size) => {
                  if (!narrow) setSidebar(size.inPixels > 0);
                }}
              >
                <aside className="sidebar" inert={!sidebar} aria-hidden={!sidebar}>
                  <div className="sidebar-content">
                    <div className="control-section dataset-controls">
                      {meta && !meta.axes.init && !isWinterTime(meta.timeUnits) && (
                        <p className="analysis-window-note">
                          Most recent {meta.times.length} time samples
                        </p>
                      )}
                      <label htmlFor="data-variable">Variable</label>
                      <select
                        id="data-variable"
                        value={variable}
                        disabled={!meta || busy}
                        onChange={(e) => {
                          setVariable(e.target.value);
                          if (meta) {
                            if (isSnowfallExample(meta.url))
                              openStore({ url: meta.url, variable: e.target.value }, extent);
                            else load(meta, e.target.value, init, extent);
                          }
                        }}
                      >
                        {meta?.variables.map((v) => (
                          <option
                            key={v.name}
                            value={v.name}
                            disabled={!!v.disabledReason}
                            title={v.disabledReason}
                          >
                            {v.label}
                          </option>
                        ))}
                      </select>
                      {meta?.axes.init && (
                        <>
                          <label htmlFor="initialization">Forecast run</label>
                          <RunPicker
                            options={initializationOptions}
                            value={init}
                            disabled={!meta || busy}
                            onChange={(i) => {
                              setInit(i);
                              if (meta) load(meta, variable, i, extent);
                            }}
                          />
                        </>
                      )}
                    </div>
                    {volume ? (
                      <div className="control-section">
                        {' '}
                        <div className="legend">
                          <div>
                            <span>Color scale</span>
                            <Popover
                              trigger={
                                <Button
                                  variant="ghost"
                                  className="icon"
                                  aria-label="Color settings"
                                >
                                  <Settings2 size={14} />
                                </Button>
                              }
                            >
                              <label>
                                Color palette
                                <select
                                  aria-label="Color palette"
                                  value={palette}
                                  onChange={(e) => {
                                    const next = e.target.value as Palette;
                                    setPalette(next);
                                    if (next === 'snowfall') {
                                      const limit = Math.max(
                                        Math.abs(range[0]),
                                        Math.abs(range[1]),
                                      );

                                      setRange([-limit, limit]);
                                    }
                                  }}
                                >
                                  <option value="snowfall">
                                    Snowfall anomaly (brown–white–blue)
                                  </option>
                                  <option value="thermal">Thermal</option>
                                  <option value="ocean">Ocean</option>
                                  <option value="ember">Ember</option>
                                </select>
                              </label>
                              <div className="range-fields">
                                <label>
                                  Minimum
                                  <input
                                    aria-label="Color minimum"
                                    type="number"
                                    value={range[0]}
                                    step="any"
                                    onChange={(e) => {
                                      const n = Number(e.target.value);
                                      if (palette === 'snowfall') {
                                        if (n < 0) setRange([n, -n]);
                                      } else if (n < range[1]) setRange([n, range[1]]);
                                    }}
                                  />
                                </label>
                                <label>
                                  Maximum
                                  <input
                                    aria-label="Color maximum"
                                    type="number"
                                    value={range[1]}
                                    step="any"
                                    onChange={(e) => {
                                      const n = Number(e.target.value);
                                      if (palette === 'snowfall') {
                                        if (n > 0) setRange([-n, n]);
                                      } else if (n > range[0]) setRange([range[0], n]);
                                    }}
                                  />
                                </label>
                              </div>
                            </Popover>
                          </div>
                          <div className="color-bar" style={{ background: gradient(palette) }} />
                          <div className="legend-numbers">
                            <span>
                              {volume!.min < range[0] ? '≤ ' : ''}
                              {formatValue(range[0])} {prettyUnit(volume!.units)}
                            </span>
                            <span>{formatValue((range[0] + range[1]) / 2)}</span>
                            <span>
                              {volume!.max > range[1] ? '≥ ' : ''}
                              {formatValue(range[1])} {prettyUnit(volume!.units)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {volume && (
                      <AnalysisControls
                        volume={volume}
                        analysis={analysis}
                        slices={slices}
                        onReveal={updateSlices}
                        onEnable={() => setAnalysisEnabled(true)}
                      />
                    )}
                  </div>
                  <div className="control-section diagnostics-controls">
                    <Button variant="ghost" onClick={() => setDiagnostics(true)}>
                      Dataset details
                    </Button>
                  </div>
                </aside>
              </Panel>
            )}
            {meta && <Separator className="sidebar-resizer" />}
            <Panel minSize="150px">
              <main className="main-view">
                {volume ? (
                  <Group orientation="vertical" className="viewer-panels">
                    <Panel defaultSize={linked ? '70%' : '100%'} minSize="35%">
                      <div className="visualization">
                        <Cube
                          selectionMask={analysis.matches?.mask ?? null}
                          volume={volume}
                          points={selectedCells}
                          slices={slices}
                          onSlices={updateSlices}
                          onSliceStart={(axis) => {
                            if (axis === 2) setPlaying(false);
                          }}
                          range={range}
                          palette={palette}
                          reset={reset}
                          onReset={resetCube}
                          onPoint={(p) => {
                            setSelectedForecasts((previous) =>
                              addForecastPoint(previous, volume, p.x, p.y),
                            );
                            setLinked(true);
                            changeSlice(2, p.t);
                          }}
                          onError={renderError}
                          onReady={markReady}
                          loading={busy}
                          loadError={error}
                          regionFailure={regionFailure}
                          latitudeBounds={[
                            Math.min(...(meta?.lat || [-90])),
                            Math.max(...(meta?.lat || [90])),
                          ]}
                          onRegion={(next) => {
                            if (meta) load(meta, variable, init, next, true);
                          }}
                        />
                      </div>
                    </Panel>
                    {linked ? (
                      <>
                        <Separator className="panel-separator" />
                        <Panel defaultSize="30%" minSize="23%" maxSize="48%">
                          <TimeSeries
                            volume={volume}
                            forecasts={selectedForecasts}
                            onRemove={(id) => {
                              setSelectedForecasts((previous) =>
                                previous.filter((p) => p.id !== id),
                              );
                              if (selectedForecasts.length === 1) setLinked(false);
                            }}
                            time={slices[2]}
                            onTime={(v) => changeSlice(2, v)}
                          />
                        </Panel>
                      </>
                    ) : null}
                  </Group>
                ) : (
                  <div className="empty-stage">
                    {busy ? null : error ? (
                      <div className="error-state" role="alert">
                        <AlertCircle size={30} />
                        <h2>Unable to load dataset</h2>
                        <p>{error}</p>
                        <div>
                          {regularDataset(url) && (
                            <Button
                              variant="primary"
                              onClick={() => open({ url: regularDataset(url)!.url })}
                            >
                              Open {regularDataset(url)!.title}
                            </Button>
                          )}
                          <Button
                            onClick={() =>
                              meta
                                ? load(meta, variable, init, extent)
                                : open({ url, variable }, extent)
                            }
                          >
                            Retry
                          </Button>
                          <Button variant="primary" onClick={() => open({ url: AIFS })}>
                            Open another dataset
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="welcome">
                        <h2>Explore a data cube</h2>
                        <Button
                          variant="primary"
                          className="example-button"
                          onClick={() => open({ url: AIFS })}
                        >
                          Browse datasets
                        </Button>
                        <button className="open-own" onClick={() => open({ url: AIFS })}>
                          <Plus size={14} />
                          Open another dataset
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {volume ? (
                  <div className="transport">
                    <Button
                      className="icon play"
                      variant="ghost"
                      aria-label={
                        playing
                          ? 'Pause playback'
                          : meta?.axes.init
                            ? 'Play forecast'
                            : 'Play timeline'
                      }
                      onClick={() => setPlaying((v) => !v)}
                    >
                      {playing ? <Pause size={15} /> : <Play size={15} />}
                    </Button>
                    <span className="lead-label">
                      {timeLabel(volume.times[slices[2]], volume.timeUnits)}
                    </span>
                    <Slider
                      label={
                        isWinterTime(volume.timeUnits) ? 'Winter playback' : 'Forecast playback'
                      }
                      value={volume.times[slices[2]] - volume.times[0]}
                      max={volume.times.at(-1)! - volume.times[0]}
                      step={0.001}
                      onStep={(direction) =>
                        changeSlice(
                          2,
                          Math.max(0, Math.min(volume.times.length - 1, slices[2] + direction)),
                        )
                      }
                      onChange={(v) => {
                        const target = volume.times[0] + v;
                        let closest = 0;

                        volume.times.forEach((t, i) => {
                          if (Math.abs(t - target) < Math.abs(volume.times[closest] - target))
                            closest = i;
                        });

                        changeSlice(2, closest);
                      }}
                    />
                    <span className="end-label">
                      {timeLabel(volume.times.at(-1)!, volume.timeUnits)}
                    </span>
                  </div>
                ) : null}
              </main>
            </Panel>
          </Group>
        </div>

        {error && volume ? (
          <div className="render-error" role="alert">
            Rendering error: {error}
            <Button
              onClick={() => {
                setReset((n) => n + 1);
                setError('');
              }}
            >
              Dismiss
            </Button>
          </div>
        ) : null}
        <Dialog
          open={catalogLoading || !!catalog || !!catalogError}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              ++catalogRequest.current;
              setCatalog(null);
              setCatalogLoading(false);
              setCatalogError('');
            }
          }}
          title="Choose a dataset"
        >
          {catalogLoading && <p role="status">Loading catalog…</p>}
          {catalogError && (
            <>
              <p role="alert">{catalogError}</p>
              <Button onClick={() => open({ url: AIFS })}>Try again</Button>
            </>
          )}
          <div className="catalog-choices">
            {catalog?.choices.map((choice) => (
              <button key={choice.url} onClick={() => open({ url: choice.url })}>
                <span>{choice.title}</span>
              </button>
            ))}
            <button
              disabled={!snowfallExample.url}
              onClick={() => open({ url: snowfallExample.url }, snowfallExample.extent)}
            >
              <span>{snowfallExample.title}</span>
            </button>
          </div>
          <div className="custom-dataset">
            <div className="custom-dataset-heading">
              <label htmlFor="custom-dataset-url">Paste your own URL (in progress)</label>
            </div>
            <input id="custom-dataset-url" type="url" placeholder="https://…" disabled />
          </div>
        </Dialog>
        <RegionDialog
          open={regionDialog}
          onClose={setRegionDialog}
          extent={extent}
          onApply={(e) => {
            setExtent(e);
            setRegionDialog(false);
            if (meta) load(meta, variable, init, e);
          }}
        />
        <Dialog
          open={commands}
          onOpenChange={setCommands}
          title="Go anywhere"
          description="Search actions and navigate your exploration."
        >
          <Command>
            <div className="command-search">
              <Search size={18} />
              <Command.Input placeholder="Search actions…" autoFocus />
            </div>
            <Command.List>
              <Command.Empty>No matching actions.</Command.Empty>
              {[
                ['Open dataset', () => open({ url: AIFS })],
                ['Reset cube', resetCube],
                ['Toggle controls', toggleSidebar],
                ['Toggle point forecast', () => setLinked((v) => !v)],
                ['Edit region', () => setRegionDialog(true)],

                ['View dataset details', () => setDiagnostics(true)],
              ].map(([label, fn]) => (
                <Command.Item
                  key={String(label)}
                  onSelect={() => {
                    (fn as () => void)();
                    setCommands(false);
                  }}
                >
                  {String(label)}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Dialog>
        <Dialog open={diagnostics} onOpenChange={setDiagnostics} title="Dataset details">
          <div className="diagnostic-grid">
            {metrics ? (
              Object.entries({
                'First data-backed plane': firstPlane
                  ? `${firstPlane.toFixed(0)} ms`
                  : 'Not yet rendered',
                'Metadata / open': `${metrics.openMs.toFixed(0)} ms`,
                'Last volume load': `${metrics.loadMs.toFixed(0)} ms`,
                'HTTP requests': metrics.requests,
                'HTTP payload headers': mb(metrics.responseBytes),
                'Observable transfer': metrics.transferBytes
                  ? mb(metrics.transferBytes)
                  : 'Unavailable (TAO)',
                'Decoded chunk cache': mb(metrics.decodedBytes),
                'Byte / range cache': mb(metrics.byteCacheBytes),
                'Cache hits': metrics.cacheHits,
                'Codec decode time': `${metrics.cpuDecodeMs.toFixed(0)} ms`,
                'Coalesced requests saved': metrics.coalescedRequests,
                'Read + decode time': `${metrics.decodeMs.toFixed(0)} ms`,
                'GPU volume allocation': volume ? mb(volume.data.length * 4) : 'Not available',
                'Warm UI p95 (2 frames)': warmStats
                  ? `${warmStats.p95.toFixed(1)} ms / ${warmStats.count} moves`
                  : 'Scrub slices to measure',
                'Frame gaps > 50 ms': stalls.current,
              }).map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <b>{v}</b>
                </div>
              ))
            ) : (
              <p>Open a dataset to start measuring.</p>
            )}
          </div>
          {meta ? (
            <>
              <p className="diagnostic-note">{meta.availability}</p>
              <dl>
                <dt>Snapshot</dt>
                <dd>{meta.snapshot}</dd>
                <dt>Source</dt>
                <dd>{meta.storeUrl}</dd>
                <dt>Chunk shape / dtype</dt>
                <dd>
                  {meta.chunks.join(' × ')} / {meta.dtype}
                </dd>
              </dl>
              <details>
                <summary>Codec metadata</summary>
                <pre>{JSON.stringify(meta.codecs, null, 2)}</pre>
              </details>
              <p className="diagnostic-note">
                Application budgets: 48 MiB bytes, 128 MiB decoded, 64 MiB volume / GPU. Icechunk
                WASM has its own memory. Timing includes network and decoding; transfer headers omit
                protocol overhead.
              </p>
            </>
          ) : null}
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
