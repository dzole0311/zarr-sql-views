import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Settings2, X } from 'lucide-react';
import type { OrbitViewport } from '@deck.gl/core';
import type { Volume } from '../engine/types';
import { timeLabel } from '../engine/time-labels';
import { slicePlanes, draggedSliceIndex, type SliceCuts } from '../render/slice-planes';
import { Button, Tip } from './ui/primitives';

type Cuts = SliceCuts;
const names = ['Longitude', 'Latitude', 'Time'];

/** Shares the cube's cuts with playback, SQL reveal, picking and URL state. */
export function SliceExplorer({
  volume,
  slices,
  onChange,
  projection,
  disabled,
  enabled,
  onExit,
  onStart,
}: {
  volume: Volume;
  slices: Cuts;
  onChange: (cuts: Cuts) => void;
  projection: OrbitViewport;
  disabled: boolean;
  enabled: boolean;
  onExit: () => void;
  onStart: (axis: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [axis, setAxis] = useState(0);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    fraction: number;
    dx: number;
    dy: number;
    original: Cuts;
  } | null>(null);
  useEffect(() => {
    drag.current = null;
    setDragging(false);
    setActive(null);
  }, [volume, disabled, enabled]);
  const coordinates = useMemo(
    () => [volume.lon.map((n) => (n - volume.lon[0] + 360) % 360), volume.lat, volume.times],
    [volume],
  );
  const panel = useRef<HTMLDivElement>(null);
  const closePanel = () => {
    setOpen(false);
    panel.current
      ?.querySelector<HTMLButtonElement>('[aria-label="Precise slice controls"]')
      ?.focus();
  };
  const restoreSlices = () => {
    onStart(2);
    onChange(full);
  };
  const values = coordinates[axis];
  const full: Cuts = [volume.shape[2] - 1, 0, volume.shape[0] - 1];
  const changed = slices.some((n, i) => n !== full[i]);
  const updateAxis = (axis: number, index: number) => {
    onStart(axis);
    const next = [...slices] as Cuts;
    next[axis] = Math.max(0, Math.min(coordinates[axis].length - 1, index));
    onChange(next);
  };
  const update = (index: number) => updateAxis(axis, index);
  const labelFor = (axis: number, index: number) => {
    if (axis === 2) return timeLabel(volume.times[index], volume.timeUnits);
    const value = (axis === 0 ? volume.lon : volume.lat)[index];
    const direction = axis === 0 ? (value < 0 ? 'W' : 'E') : value < 0 ? 'S' : 'N';
    return `${Math.abs(value).toFixed(2)}° ${direction}`;
  };
  const label = (index: number) => labelFor(axis, index);
  const planes = useMemo(
    () => slicePlanes(coordinates, slices, projection),
    [coordinates, slices, projection],
  );

  if (!enabled) return null;
  return (
    <>
      <div
        ref={panel}
        className="slice-explorer"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (open) closePanel();
            else onExit();
            e.stopPropagation();
          }
        }}
      >
        <div className="slice-toolbar">
          <Tip label="Adjust slice position">
            <Button
              variant="ghost"
              className="icon"
              aria-label="Precise slice controls"
              aria-expanded={open}
              aria-controls="voxel-slice-panel"
              onClick={() => {
                setOpen(!open);
              }}
            >
              <Settings2 size={14} aria-hidden="true" />
            </Button>
          </Tip>
          <Tip label="Restore all slices">
            <Button
              variant="ghost"
              className="icon"
              aria-label="Reset all slices"
              disabled={!changed || disabled}
              onClick={restoreSlices}
            >
              <RotateCcw size={14} aria-hidden="true" />
            </Button>
          </Tip>
          <Button variant="ghost" onClick={onExit}>
            Done
          </Button>
        </div>
        {open && (
          <section
            id="voxel-slice-panel"
            className="slice-panel"
            aria-label="Slice volume controls"
          >
            <div className="slice-panel-heading">
              <strong>Explore the interior</strong>
              <Button
                variant="ghost"
                className="icon"
                aria-label="Close slice controls"
                onClick={closePanel}
              >
                <X size={14} aria-hidden="true" />
              </Button>
            </div>
            <p>Choose a dimension and adjust its position.</p>
            <div className="slice-axis-options" role="group" aria-label="Slice plane">
              {names.map((name, i) => (
                <button key={name} aria-pressed={axis === i} onClick={() => setAxis(i)}>
                  {name}
                </button>
              ))}
            </div>
            <div className="slice-position-label">
              <label htmlFor="voxel-slice-position">Position</label>
              <output htmlFor="voxel-slice-position">{label(slices[axis])}</output>
            </div>
            <input
              id="voxel-slice-position"
              aria-label={`${names[axis]} slice position`}
              aria-valuetext={label(slices[axis])}
              type="range"
              min={0}
              max={values.length - 1}
              step={1}
              value={slices[axis]}
              disabled={disabled || values.length < 2}
              onChange={(e) => update(Number(e.target.value))}
            />
            <div className="slice-endpoints">
              <span>{label(0)}</span>
              <span>{label(values.length - 1)}</span>
            </div>
            <div className="slice-panel-footer">
              <span>
                {axis === 0
                  ? 'Keeps the west side'
                  : axis === 1
                    ? 'Keeps the north side'
                    : 'Keeps earlier time steps'}
              </span>
            </div>
          </section>
        )}
      </div>
      {!disabled && (
        <div className="slice-instruction" id="slice-instructions">
          {active !== null
            ? `${names[active]} · ${labelFor(active, slices[active])}${dragging ? '. Press Esc to cancel' : '. Drag to move the cut'}`
            : 'Drag a face to slice. Press Esc to finish.'}
        </div>
      )}
      {!disabled && (
        <svg className="slice-face-surfaces" aria-label="Interactive slice faces">
          {planes.map(({ corners, fraction, visible, dx, dy }, axis) => {
            const values = coordinates[axis];
            const update = (index: number) => updateAxis(axis, index);
            if (values.length < 2 || !visible) return null;
            return (
              <polygon
                key={axis}
                points={corners}
                data-slice-surface="true"
                className={`slice-face-target ${active === axis ? 'is-active' : ''}`}
                role="slider"
                tabIndex={0}
                aria-label={`${names[axis]} slice face`}
                aria-describedby="slice-instructions"
                aria-valuemin={0}
                aria-valuemax={values.length - 1}
                aria-valuenow={slices[axis]}
                aria-valuetext={labelFor(axis, slices[axis])}
                onPointerEnter={() => {
                  if (!drag.current) setActive(axis);
                }}
                onPointerLeave={() => {
                  if (!drag.current) setActive(null);
                }}
                onFocus={() => {
                  setAxis(axis);
                  setActive(axis);
                }}
                onBlur={() => {
                  if (!drag.current) setActive(null);
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  setAxis(axis);
                  setActive(axis);
                  setDragging(true);
                  e.currentTarget.focus();
                  onStart(axis);
                  drag.current = {
                    pointer: e.pointerId,
                    x: e.clientX,
                    y: e.clientY,
                    fraction,
                    dx,
                    dy,
                    original: [...slices],
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d || d.pointer !== e.pointerId) return;
                  update(
                    draggedSliceIndex(
                      values,
                      d.fraction,
                      d.dx,
                      d.dy,
                      e.clientX - d.x,
                      e.clientY - d.y,
                    ),
                  );
                }}
                onPointerUp={(e) => {
                  drag.current = null;
                  setDragging(false);
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={() => {
                  if (drag.current) onChange(drag.current.original);
                  drag.current = null;
                  setDragging(false);
                }}
                onLostPointerCapture={() => {
                  drag.current = null;
                  setDragging(false);
                }}
                onKeyDown={(e) => {
                  if (
                    [
                      'ArrowLeft',
                      'ArrowDown',
                      'ArrowRight',
                      'ArrowUp',
                      'Home',
                      'End',
                      'Escape',
                    ].includes(e.key)
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === 'Escape') {
                      if (!drag.current) {
                        onExit();
                        return;
                      }
                      onChange(drag.current.original);
                      if (e.currentTarget.hasPointerCapture(drag.current.pointer))
                        e.currentTarget.releasePointerCapture(drag.current.pointer);
                      drag.current = null;
                      setDragging(false);
                    } else
                      update(
                        e.key === 'Home'
                          ? 0
                          : e.key === 'End'
                            ? values.length - 1
                            : slices[axis] + (['ArrowLeft', 'ArrowDown'].includes(e.key) ? -1 : 1),
                      );
                  }
                }}
              />
            );
          })}
        </svg>
      )}
    </>
  );
}
