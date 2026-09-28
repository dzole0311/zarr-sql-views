import { isWinterTime, timeValue } from '../engine/time-labels';
import type { Volume } from '../engine/types';

/** Row identity already encodes coordinates. Constant-array lookup avoids
 * cardinality estimates and hash joins, and unused coordinates are pruned.
 */
export function forecastViewSQL(
  volume: Pick<Volume, 'shape' | 'lon' | 'lat' | 'times' | 'timeUnits' | 'variable'>,
) {
  const [, ny, nx] = volume.shape;

  const list = (values: number[]) => {
    if (!values.length || values.some((v) => !Number.isFinite(v)))
      throw Error('Invalid analysis coordinates.');

    return `[${values.join(',')}]::DOUBLE[]`;
  };

  const x = `(cell_id % ${nx})`,
    y = `((cell_id // ${nx}) % ${ny})`,
    t = `(cell_id // ${nx * ny})`;
  const timeColumn = isWinterTime(volume.timeUnits)
    ? `NULL::DOUBLE AS forecast_hour, list_extract(${list(volume.times)}, ${t} + 1) AS winter`
    : `list_extract(${list(volume.times.map((v) => timeValue(v, volume.timeUnits)))}, ${t} + 1) AS forecast_hour`;
  const value = 'CASE WHEN isfinite(value) THEN value ELSE NULL END';

  return `CREATE VIEW loaded_forecast AS SELECT cell_id,
    ${value} AS value, ${x} AS x_index, ${y} AS y_index, ${t} AS time_index,
    list_extract(${list(volume.lon)}, ${x} + 1) AS longitude,
    list_extract(${list(volume.lat)}, ${y} + 1) AS latitude,
    ${timeColumn}
    ${volume.variable === 'temperature_2m' ? `, ${value} AS temperature` : ''}
    FROM samples`;
}
