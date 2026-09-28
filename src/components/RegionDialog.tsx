import { useEffect, useRef, useState } from 'react';
import type { Extent } from '../engine/types';
import { Button, Dialog } from './ui/primitives';

export function RegionDialog({
  open,
  onClose,
  extent,
  onApply,
}: {
  open: boolean;
  onClose: (v: boolean) => void;
  extent: Extent;
  onApply: (e: Extent) => void;
}) {
  const [draft, setDraft] = useState(extent);
  const start = useRef<[number, number] | null>(null);
  useEffect(() => setDraft(extent), [extent, open]);

  const coordinate = (e: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();

    return [
      Math.round(Math.max(-180, Math.min(180, ((e.clientX - r.left) / r.width) * 360 - 180))),
      Math.round(Math.max(-90, Math.min(90, 90 - ((e.clientY - r.top) / r.height) * 180))),
    ];
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onClose}
      title="Choose your region"
      description="Select bounds on the map or enter them below. The longer side is cropped to keep the region square."
    >
      <svg
        className="region-selector"
        viewBox="0 0 360 180"
        onPointerDown={(e) => {
          start.current = coordinate(e);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const p = coordinate(e);

          setDraft([
            Math.min(start.current[0], p[0]),
            Math.min(start.current[1], p[1]),
            Math.max(start.current[0], p[0]),
            Math.max(start.current[1], p[1]),
          ]);
        }}
        onPointerUp={() => {
          start.current = null;
        }}
      >
        <rect width="360" height="180" fill="#172021" />
        {[-120, -60, 0, 60, 120].map((n) => (
          <g key={n}>
            <line x1={n + 180} x2={n + 180} y1="0" y2="180" stroke="#334041" />
            <text x={n + 182} y="174">
              {n}°
            </text>
          </g>
        ))}
        {[-60, -30, 0, 30, 60].map((n) => (
          <g key={n}>
            <line x1="0" x2="360" y1={90 - n} y2={90 - n} stroke="#334041" />
            <text x="3" y={87 - n}>
              {n}°
            </text>
          </g>
        ))}
        <rect
          x={draft[0] + 180}
          y={90 - draft[3]}
          width={Math.max(1, draft[2] - draft[0])}
          height={Math.max(1, draft[3] - draft[1])}
          fill="#bad99533"
          stroke="#bddf97"
        />
      </svg>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onApply(draft);
        }}
      >
        <div className="extent-fields">
          {['West', 'South', 'East', 'North'].map((name, i) => (
            <label key={name}>
              {name}
              <input
                type="number"
                required
                min={i % 2 ? -90 : -180}
                max={i % 2 ? 90 : 180}
                step="any"
                value={draft[i]}
                onChange={(e) => {
                  const next = [...draft] as Extent;
                  next[i] = Number(e.target.value);
                  setDraft(next);
                }}
              />
            </label>
          ))}
        </div>
        <p className="dialog-note">
          A smaller visible region may still read a whole source chunk. Selection limits are checked
          before allocating data.
        </p>
        <Button variant="primary" type="submit" className="full-width">
          Explore region
        </Button>
      </form>
    </Dialog>
  );
}
