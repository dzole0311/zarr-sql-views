const availableForecasts = new Set(['ecmwf-aifs-single-forecast', 'noaa-gfs-forecast']);

export function isAvailableForecast(url: string): boolean {
  const parsed = new URL(url);

  return (
    parsed.hostname === 'stac.dynamical.org' &&
    availableForecasts.has(parsed.pathname.split('/')[1])
  );
}

export function defaultVariable(names: string[]) {
  return (
    ['temperature_2m', 'precipitation_surface'].find((name) => names.includes(name)) ?? names[0]
  );
}

/** Reject projected or rotated coordinates that cannot be rendered as longitude/latitude. */
export function assertGeographicCoordinates(
  x: Record<string, unknown>,
  y: Record<string, unknown>,
) {
  if (
    [x, y].some(
      (a) =>
        /^grid_(longitude|latitude)$/.test(String(a.standard_name)) ||
        /rotated/i.test(String(a.long_name ?? '')),
    )
  )
    throw Error(
      'This dataset uses a rotated geographic grid. zarr-sql-views needs a coordinate transformation before it can display this dataset correctly.',
    );

  if (!/degree/.test(String(x.units)) || !/degree/.test(String(y.units)))
    throw Error(
      'This dataset uses a projected grid. zarr-sql-views currently supports regular longitude/latitude grids; projected-grid support is not available yet.',
    );
}

const checked = new Set([
  'noaa-gfs-analysis',
  'noaa-gfs-forecast',
  'noaa-gefs-analysis',
  'noaa-mrms-conus-analysis-hourly',
  'ecmwf-aifs-single-forecast',
  'dwd-icon-eu-forecast-5-day',
  'nasa-imerg-analysis-early',
  'nasa-imerg-analysis-late',
]);

const ensemble = new Set([
  'noaa-gefs-forecast-35-day',
  'noaa-gefs-forecast-10-day-0-25-degree-virtual',
  'noaa-gefs-forecast-16-day-0-5-degree-virtual',
  'noaa-gefs-forecast-35-day-0-5-degree-virtual',
  'ecmwf-aifs-ens-forecast',
  'ecmwf-ifs-ens-forecast-15-day-0-25-degree',
  'ecmwf-ifs-ens-forecast-46-day-daily-1-5-degree',
  'ecmwf-ifs-ens-forecast-46-day-6-hourly-1-5-degree',
]);

const projected = new Set([
  'noaa-hrrr-forecast-18-hour-virtual',
  'noaa-hrrr-forecast-48-hour',
  'noaa-hrrr-forecast-48-hour-virtual',
  'noaa-hrrr-analysis',
  'noaa-hrrr-analysis-virtual',
]);

const virtual = new Set([
  'noaa-gfs-analysis-virtual',
  'noaa-gfs-forecast-virtual',
  'noaa-gefs-analysis-0-25-degree-virtual',
  'ecmwf-aifs-single-forecast-virtual',
]);

/** Return the September 2026 sample-audit status for known Dynamical datasets.
 * This snapshot does not guarantee other variables, runs, or future source updates. */
export function catalogSupport(
  url: string,
): { note: string; disabled: boolean; rank: number } | null {
  const parsed = new URL(url);
  if (parsed.hostname !== 'stac.dynamical.org') return null;
  const id = parsed.pathname.split('/')[1];
  if (checked.has(id)) return { note: 'Sample load verified', disabled: false, rank: 0 };
  if (ensemble.has(id))
    return { note: 'Ensemble member selection not supported yet', disabled: true, rank: 2 };
  if (projected.has(id))
    return { note: 'Projected grid not supported yet', disabled: true, rank: 2 };
  if (id === 'eccc-hrdps-forecast')
    return { note: 'Rotated grid not supported yet', disabled: true, rank: 2 };
  if (virtual.has(id))
    return { note: 'Virtual cloud chunks not supported in browser yet', disabled: true, rank: 2 };

  return null;
}

export function regularDataset(url: string): { url: string; title: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'stac.dynamical.org') return null;

  const alternatives: Record<string, [string, string]> = {
    'noaa-gfs-analysis-virtual': ['noaa-gfs-analysis', 'NOAA GFS analysis'],
    'noaa-gfs-forecast-virtual': ['noaa-gfs-forecast', 'NOAA GFS forecast'],
    'noaa-gefs-analysis-0-25-degree-virtual': ['noaa-gefs-analysis', 'NOAA GEFS analysis'],
    'ecmwf-aifs-single-forecast-virtual': [
      'ecmwf-aifs-single-forecast',
      'ECMWF AIFS Single forecast',
    ],
  };

  const alternative = alternatives[parsed.pathname.split('/')[1]];

  return alternative
    ? { url: `https://stac.dynamical.org/${alternative[0]}/collection.json`, title: alternative[1] }
    : null;
}

/** Include pressure levels omitted by generic source long names so fields remain distinguishable. */
export function variableLabel(name: string, longName: unknown): string {
  const pressure = name.match(/_(\d+(?:\.\d+)?)hpa$/i);

  const label =
    typeof longName === 'string' && longName.trim()
      ? longName.trim()
      : name.replace(/_\d+(?:\.\d+)?hpa$/i, '').replaceAll('_', ' ');

  if (!pressure || new RegExp(`\\b${pressure[1].replace('.', '\\.')}\\s*hpa\\b`, 'i').test(label))
    return label;

  return `${label} (${pressure[1]} hPa)`;
}
