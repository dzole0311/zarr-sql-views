import { isWinterTime, timeValue, timeLabel } from '../engine/time-labels';
import { formatValue } from '../render/value-scale';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Volume } from '../engine/types';
import { sample } from '../engine/coordinates';
import type { ForecastPoint } from '../analysis/points';
import { X as CloseIcon } from 'lucide-react';

export function TimeSeries({
  volume,
  time,
  forecasts,
  onRemove,
  onTime,
}: {
  volume: Volume;
  time: number;
  forecasts: ForecastPoint[];
  onRemove: (id: string) => void;
  onTime: (n: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [axis, setAxis] = useState({ left: 36, right: 624 });
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [size, setSize] = useState({ width: 640, height: 140 });

  useEffect(() => {
    const node = host.current!;
    const main = node.closest('main');
    const slider = main?.querySelector<HTMLElement>('.transport .slider');
    const thumb = slider?.querySelector<HTMLElement>('.slider-thumb');
    if (!main || !slider || !thumb) return;

    const measure = () => {
      const r = node.getBoundingClientRect(),
        track = slider.getBoundingClientRect();
      const radius = thumb.getBoundingClientRect().width / 2;
      setSize({ width: r.width, height: Math.max(70, r.height) });
      setAxis({ left: track.left - r.left + radius, right: track.right - r.left - radius });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(slider);
    observer.observe(main);
    measure();

    return () => observer.disconnect();
  }, []);

  const series = useMemo(
    () =>
      forecasts.map((p) => ({
        ...p,
        values: p.volume.times.map((_, t) => sample(p.volume, 0, 0, t)),
      })),
    [forecasts],
  );

  const [min, max] = useMemo(() => {
    let low = Infinity,
      high = -Infinity;
    for (const point of series)
      for (const value of point.values) {
        if (!Number.isFinite(value)) continue;
        low = Math.min(low, value);
        high = Math.max(high, value);
      }

    return Number.isFinite(low) ? [low, high] : [0, 1];
  }, [series]);

  const padding = (max - min || 1) * 0.1;
  const lo = min - padding,
    span = max - min + padding * 2;
  const hours = volume.times.map((n) => timeValue(n, volume.timeUnits));
  const timeSpan = hours.at(-1)! - hours[0] || 1;
  const { width, height } = size;
  const X = (i: number) =>
    axis.left + ((hours[i] - hours[0]) / timeSpan) * (axis.right - axis.left);
  const Y = (v: number) => height - 26 - ((v - lo) / span) * (height - 38);

  const paths = series.map((series) => {
    let path = '',
      valid = false;

    series.values.forEach((v, i) => {
      if (!Number.isFinite(v)) {
        valid = false;

        return;
      }

      path += `${valid ? 'L' : 'M'}${X(i)},${Y(v)} `;
      valid = true;
    });

    return { ...series, path };
  });

  return (
    <section className="time-series point-series">
      <div className="panel-heading">
        <span>
          {isWinterTime(volume.timeUnits) || volume.timeUnits.includes('since ')
            ? 'Point history'
            : forecasts.length === 1
              ? 'Point forecast'
              : 'Point forecasts'}
        </span>
        <span>
          {timeLabel(volume.times[time], volume.timeUnits)} ·{' '}
          {volume.units === 'degree_Celsius' ? '°C' : volume.units}
        </span>
      </div>
      <div className="forecast-legend">
        {series.map((p) => (
          <div key={p.id} className="forecast-legend-item">
            <span className="forecast-swatch" style={{ background: p.color }} />
            <span>
              {Math.abs(p.volume.lat[0]).toFixed(2)}° {p.volume.lat[0] < 0 ? 'S' : 'N'},{' '}
              {Math.abs(p.volume.lon[0]).toFixed(2)}° {p.volume.lon[0] < 0 ? 'W' : 'E'}
            </span>
            <strong style={{ color: p.color }}>{formatValue(p.values[time])}</strong>
            <button
              aria-label={`Remove point ${p.id}`}
              title="Remove point"
              onClick={() => onRemove(p.id)}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        ))}
      </div>
      <div ref={host} className="point-chart">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className={keyboardFocus ? 'keyboard-focus' : undefined}
          onPointerDown={(e) => {
            e.preventDefault();
            setKeyboardFocus(false);
          }}
          onFocus={() => setKeyboardFocus(true)}
          onBlur={() => setKeyboardFocus(false)}
          role="slider"
          tabIndex={0}
          aria-label={isWinterTime(volume.timeUnits) ? 'Point winter' : 'Point forecast hour'}
          aria-valuemin={hours[0]}
          aria-valuemax={hours.at(-1)}
          aria-valuenow={hours[time]}
          aria-valuetext={timeLabel(volume.times[time], volume.timeUnits)}
          onKeyDown={(e) => {
            setKeyboardFocus(true);
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
              e.preventDefault();

              onTime(
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? hours.length - 1
                    : Math.max(
                        0,
                        Math.min(hours.length - 1, time + (e.key === 'ArrowRight' ? 1 : -1)),
                      ),
              );
            }
          }}
          onClick={(e) => {
            const h =
              hours[0] +
              ((e.clientX - e.currentTarget.getBoundingClientRect().left - axis.left) /
                (axis.right - axis.left)) *
                timeSpan;

            let closest = 0;
            hours.forEach((v, i) => {
              if (Math.abs(v - h) < Math.abs(hours[closest] - h)) closest = i;
            });
            onTime(closest);
          }}
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line
                x1={axis.left}
                x2={axis.right}
                y1={Y(min + f * (max - min))}
                y2={Y(min + f * (max - min))}
              />
              <text x={axis.left - 32} y={Y(min + f * (max - min)) + 3}>
                {formatValue(min + f * (max - min))}
              </text>
            </g>
          ))}
          {paths.map((p) => (
            <path key={p.id} d={p.path} fill="none" style={{ stroke: p.color }} strokeWidth="1.8" />
          ))}
          <line className="point-cursor" x1={X(time)} x2={X(time)} y1="8" y2={height - 24} />
          {series.map((p) =>
            Number.isFinite(p.values[time]) ? (
              <circle
                key={p.id}
                cx={X(time)}
                cy={Y(p.values[time])}
                r="3"
                style={{ fill: p.color }}
                strokeWidth="2"
              />
            ) : null,
          )}
          {(width < 420 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => (
            <text
              key={f}
              x={axis.left + f * (axis.right - axis.left)}
              y={height - 6}
              textAnchor="middle"
            >
              {Math.round(hours[0] + f * timeSpan)}
              {isWinterTime(volume.timeUnits) ? '' : ' h'}
            </text>
          ))}
        </svg>
      </div>
    </section>
  );
}
