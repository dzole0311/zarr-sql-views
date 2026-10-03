import { sourceCoopUrl } from './config';
import type { Extent, OpenRequest } from './types';

/** Direct-store example: no STAC document or consolidated metadata is required. */
export const snowfallExample = {
  title: 'El Niño snowfall',
  url: sourceCoopUrl,
  variable: 'winter_anomaly',
  variables: [
    'anomaly',
    'below_count',
    'event_anomaly',
    'winter_anomaly',
    'jfm_snowfall',
    'roni_djf',
  ],
  axes: { x: 'longitude', y: 'latitude', t: 'winter' },
  extent: [-170, 10, -50, 85] as Extent,
};

export function isSnowfallExample(url: string) {
  return !!snowfallExample.url && url.replace(/\/$/, '') === snowfallExample.url;
}

export function exampleOptions(options: OpenRequest): OpenRequest {
  return isSnowfallExample(options.url)
    ? {
        ...options,
        variable: options.variable || snowfallExample.variable,
        axes: options.axes || {
          ...snowfallExample.axes,
          t: options.variable === 'event_anomaly' ? 'year' : 'winter',
        },
      }
    : options;
}
