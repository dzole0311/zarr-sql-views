import { isWinterTime, timeValue, timeLabel } from '../engine/time-labels';
import { PanHint } from './PanHint';
import { insideProjectedFace } from '../render/surface-hit';
import { pointMarkerIcon } from '../render/point-marker';
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { OrbitView, OrbitViewport, COORDINATE_SYSTEM, type PickingInfo } from '@deck.gl/core';
import { LineLayer, TextLayer, IconLayer } from '@deck.gl/layers';
import { loadPlaces, placesInRegion, spacedPlaceLabels, type Place } from '../render/places';
import { webgl2Adapter } from '@luma.gl/webgl';
import { Plus, Minus, Hand, Box, Type } from 'lucide-react';
import { loadBoundaries, clipSegment, type Segment } from '../render/geography';
import { WorldMinimap } from './WorldMinimap';
import { CubeController } from '../render/cube-controller';
import { cubeProjection } from '../render/cube-projection';
import { VolumeLayer, CUBE_SIZE, normalized } from '../render/volume-layer';
import type { Palette } from '../render/colors';
import type { Extent, Volume } from '../engine/types';
import { coordinateDate } from '../engine/coordinates';
import { Button, Tip } from './ui/primitives';
import { draggedRegion } from '../render/region-drag';

export type Point = { x: number; y: number; t: number; value: number };

const cubeView = new OrbitView({ id: 'cube', ...cubeProjection });

const cameraController = {
  type: CubeController,
  keyboard: false,
  scrollZoom: { smooth: false, speed: 0.012 },
  zoomAround: 'pointer' as const,
  inertia: false,
  doubleClickZoom: false,
  touchZoom: true,
};

const initial = {
  target: [0, 0, 0] as [number, number, number],
  rotationX: 27,
  rotationOrbit: -34,
  zoom: 0,
  minZoom: -2,
  maxZoom: 3,
};

export function Cube({
  volume,
  selectionMask,
  points,
  slices,
  range,
  palette,
  reset,
  onPoint,
  onError,
  onReady,
  onRegion,
  latitudeBounds,
  loading,
  loadError,
  regionFailure,
}: {
  volume: Volume;
  selectionMask: Uint8Array | null;
  points: (Point & { color: string; id: string; anchor: [number, number] })[];
  slices: [number, number, number];
  range: [number, number];
  palette: Palette;
  reset: number;
  onPoint: (v: Point) => void;
  onError: (error: Error) => void;
  onReady: () => void;
  onRegion: (extent: Extent) => void;
  latitudeBounds: [number, number];
  loading: boolean;
  loadError: string;
  regionFailure: { message: string } | null;
}) {
  const size = CUBE_SIZE;

  const [showLabels, setShowLabels] = useState(() => {
    try {
      const saved =
        localStorage.getItem('zarr-sql-views-place-labels') ??
        localStorage.getItem('strata-place-labels');
      if (saved !== null) localStorage.setItem('zarr-sql-views-place-labels', saved);

      return saved !== 'off';
    } catch {
      return true;
    }
  });

  const toggleLabels = () => {
    const next = !showLabels;
    setShowLabels(next);
    try {
      localStorage.setItem('zarr-sql-views-place-labels', next ? 'on' : 'off');
    } catch {}
  };

  const [entranceReady, setEntranceReady] = useState(false);
  const [entranceZoom, setEntranceZoom] = useState(-0.07);
  const entranceFrame = useRef(0);

  const stopEntrance = useCallback(() => {
    cancelAnimationFrame(entranceFrame.current);
    setEntranceZoom(0);
  }, []);

  useEffect(() => {
    if (!entranceReady) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduced.matches) {
      setEntranceZoom(0);

      return;
    }

    const started = performance.now();

    const frame = (now: number) => {
      const progress = Math.min(1, (now - started) / 480);

      setEntranceZoom(-0.07 * Math.pow(1 - progress, 3));
      if (progress < 1) entranceFrame.current = requestAnimationFrame(frame);
    };

    entranceFrame.current = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(entranceFrame.current);
  }, [entranceReady]);

  const reportReady = useCallback(() => {
    setEntranceReady(true);
    onReady();
  }, [onReady]);

  const [commandHeld, setCommandHeld] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const [regionDragging, setRegionDragging] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('region-pan-active', regionDragging);

    return () => document.documentElement.classList.remove('region-pan-active');
  }, [regionDragging]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => setCommandHeld(event.metaKey);

    const blur = () => {
      setCommandHeld(false);
      setPointerInside(false);
      setRegionDragging(false);
    };

    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', blur);

    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const [regionPreview, setRegionPreview] = useState<Extent | null>(null);
  const [pendingRegion, setPendingRegion] = useState<Extent | null>(null);

  useEffect(() => {
    lastRegionRequest.current = '';
    setPendingRegion(null);
    if (!regionDrag.current) setRegionPreview(null);
  }, [volume]);

  const regionCallback = useRef(onRegion);
  regionCallback.current = onRegion;
  const lastRegionRequest = useRef('');

  const requestRegion = (next: Extent) => {
    const key = JSON.stringify(next);
    if (key === lastRegionRequest.current) return;
    lastRegionRequest.current = key;
    regionCallback.current(next);
  };

  useEffect(() => {
    if (!regionPreview) return;
    const timer = setTimeout(() => requestRegion(regionPreview), 250);

    return () => clearTimeout(timer);
  }, [regionPreview]);

  const displayedRegion = regionPreview || pendingRegion;

  const regionOffset = useMemo<[number, number]>(() => {
    if (!displayedRegion) return [0, 0];
    const dx = ((displayedRegion[0] - volume.extent[0] + 540) % 360) - 180;

    return [
      dx / ((volume.lon.at(-1)! - volume.lon[0] + 360) % 360 || 360),
      (displayedRegion[1] - volume.extent[1]) / (volume.lat.at(-1)! - volume.lat[0] || 1),
    ];
  }, [displayedRegion, volume]);

  const [borders, setBorders] = useState<Segment[]>([]);

  useEffect(() => {
    let active = true;

    loadBoundaries()
      .then((data) => {
        if (active) setBorders(data);
      })
      .catch((error) => {
        if (active) onError(error);
      });

    return () => {
      active = false;
    };
  }, [onError]);

  const [places, setPlaces] = useState<Place[]>([]);

  useEffect(() => {
    let active = true;

    loadPlaces()
      .then((data) => {
        if (active) setPlaces(data);
      })
      .catch((error) => console.warn(error));

    return () => {
      active = false;
    };
  }, []);

  const placeLabels = useMemo(() => {
    const span = (volume.lon.at(-1)! - volume.lon[0] + 360) % 360 || 1;
    const west = volume.lon[0] + regionOffset[0] * span;
    const dy = regionOffset[1] * (volume.lat.at(-1)! - volume.lat[0]);
    const south = volume.lat[0] + dy,
      north = volume.lat.at(-1)! + dy;
    const east = west + ((volume.lon[slices[0]] - volume.lon[0] + 360) % 360);
    const z = (normalized(volume.times, slices[2]) - 0.5) * size[2] + 0.3;

    return placesInRegion(places, [west, volume.lat[slices[1]] + dy, east, north]).map((place) => ({
      ...place,
      position: [
        ((place.lon - west) / span - 0.5) * size[0],
        ((place.lat - south) / (north - south || 1) - 0.5) * size[1],
        z,
      ] as [number, number, number],
    }));
  }, [places, volume, slices, regionOffset, size]);

  const geographicLines = useMemo(() => {
    const west =
      volume.lon[0] + regionOffset[0] * ((volume.lon.at(-1)! - volume.lon[0] + 360) % 360 || 360);
    const span = (volume.lon.at(-1)! - volume.lon[0] + 360) % 360 || 1;
    const dy = regionOffset[1] * (volume.lat.at(-1)! - volume.lat[0]);
    const south = volume.lat[0] + dy,
      north = volume.lat.at(-1)! + dy;
    const eastCut = west + ((volume.lon[slices[0]] - volume.lon[0] + 360) % 360);
    const southCut = volume.lat[slices[1]] + dy;
    const z = (normalized(volume.times, slices[2]) - 0.5) * size[2] + 0.15;

    const position = ([lon, lat]: [number, number]): [number, number, number] => [
      ((lon - west) / span - 0.5) * size[0],
      ((lat - south) / (north - south || 1) - 0.5) * size[1],
      z,
    ];

    const lines: { source: [number, number, number]; target: [number, number, number] }[] = [];
    for (const border of borders)
      for (const shift of [-360, 0, 360]) {
        const clipped = clipSegment(
          {
            source: [border.source[0] + shift, border.source[1]],
            target: [border.target[0] + shift, border.target[1]],
          },
          [west, southCut, eastCut, north],
        );

        if (clipped)
          lines.push({ source: position(clipped.source), target: position(clipped.target) });
      }

    return lines;
  }, [borders, volume, slices, regionOffset, size]);

  const [camera, setCamera] = useState({ ...initial, zoom: -0.8 });
  const [mode, setMode] = useState<'orbit' | 'pan'>('orbit');
  const [hover, setHover] = useState<Point | null>(null);
  const [overTopFace, setOverTopFace] = useState(false);
  const [cameraDragging, setCameraDragging] = useState(false);
  const [hasPanned, setHasPanned] = useState(false);
  const hoverActive =
    Boolean(hover) && pointerInside && !regionDragging && !cameraDragging && !displayedRegion;

  const controller = useMemo(
    () => ({
      ...cameraController,
      dragMode: mode === 'pan' ? ('pan' as const) : ('rotate' as const),
      dragPan: true,
      dragRotate: true,
    }),
    [mode],
  );

  const [contextVersion, setContextVersion] = useState(0);
  const host = useRef<HTMLDivElement>(null);

  const regionDrag = useRef<{
    x: number;
    y: number;
    pointer: number;
    extent: Extent;
    ax: number[];
    ay: number[];
    next: Extent | null;
  } | null>(null);

  useEffect(() => {
    if (regionFailure) {
      setHover(null);
      lastRegionRequest.current = '';
    }
  }, [regionFailure]);

  const regionGestureContext = useRef({ latitudeBounds, volume, requestRegion });
  regionGestureContext.current = { latitudeBounds, volume, requestRegion };

  useEffect(() => {
    const update = (event: PointerEvent) => {
      const drag = regionDrag.current;
      if (!drag || drag.pointer !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      setCommandHeld(event.metaKey);
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
      setHasPanned(true);

      drag.next = draggedRegion(
        drag.extent,
        event.clientX - drag.x,
        event.clientY - drag.y,
        drag.ax,
        drag.ay,
        regionGestureContext.current.latitudeBounds,
      );

      setRegionPreview(drag.next);
    };

    const finish = (commit: boolean) => {
      const drag = regionDrag.current;
      if (!drag) return;
      regionDrag.current = null;
      setRegionDragging(false);
      setRegionPreview(null);
      if (host.current?.hasPointerCapture(drag.pointer))
        host.current.releasePointerCapture(drag.pointer);
      if (commit && drag.next) {
        const context = regionGestureContext.current;
        setPendingRegion(
          drag.next.every((n, i) => n === context.volume.extent[i]) ? null : drag.next,
        );
        context.requestRegion(drag.next);
      }
    };

    const release = (event: PointerEvent) => {
      if (regionDrag.current?.pointer !== event.pointerId) return;
      update(event);
      finish(true);
    };

    const cancel = (event: PointerEvent) => {
      if (regionDrag.current?.pointer === event.pointerId) finish(false);
    };
    const blur = () => finish(true);
    window.addEventListener('pointermove', update, { capture: true, passive: false });
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', blur);

    return () => {
      window.removeEventListener('pointermove', update, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const fitZoom = useRef(-0.8);
  const [compact, setCompact] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let fitted = false;

    const fit = () => {
      const r = el.getBoundingClientRect();
      setCompact(r.width < 600 || r.height < 380);
      setViewportSize({ width: r.width, height: r.height });
      fitZoom.current = Math.log2(
        Math.max(0.25, Math.min((r.width - 70) / 650, (r.height - 100) / 540)),
      );
      if (!fitted) {
        fitted = true;
        setCamera((c) => ({ ...c, zoom: fitZoom.current }));
      }
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  useEffect(() => setCamera({ ...initial, zoom: fitZoom.current }), [reset]);

  useEffect(() => {
    const el = host.current;
    const lost = (e: Event) => e.preventDefault();
    const recover = () => setContextVersion((v) => v + 1);
    el?.addEventListener('webglcontextlost', lost, true);
    el?.addEventListener('webglcontextrestored', recover, true);

    return () => {
      el?.removeEventListener('webglcontextrestored', recover, true);
      el?.removeEventListener('webglcontextlost', lost, true);
    };
  }, []);

  const { wire, axes, labels } = useMemo(() => {
    type Line = { source: [number, number, number]; target: [number, number, number] };
    type Label = { position: [number, number, number]; text: string; title?: boolean };
    const wire: Line[] = [],
      axes: Line[] = [],
      labels: Label[] = [];
    const [w, h, d] = size.map((n) => n / 2);

    const p = (x: number, y: number, z: number): [number, number, number] => [
      x * w * 1.003,
      y * h * 1.003,
      z * d * 1.003,
    ];

    for (const a of [-1, 1])
      for (const b of [-1, 1])
        wire.push(
          { source: p(-1, a, b), target: p(1, a, b) },
          { source: p(a, -1, b), target: p(a, 1, b) },
          { source: p(a, b, -1), target: p(a, b, 1) },
        );
    const degrees = (v: number, positive: string, negative: string) =>
      `${Math.abs(v).toFixed(v % 1 ? 2 : 0)}° ${v < 0 ? negative : positive}`;

    const projection = new OrbitViewport({
      width: 1000,
      height: 1000,
      ...camera,
      zoom: 0,
      ...cubeProjection,
    });

    const values = [
      volume.lon.map(
        (n) =>
          ((n + regionOffset[0] * ((volume.lon.at(-1)! - volume.lon[0] + 360) % 360 || 360) + 540) %
            360) -
          180,
      ),
      volume.lat.map((n) => n + regionOffset[1] * (volume.lat.at(-1)! - volume.lat[0])),
      volume.times.map((v) => timeValue(v, volume.timeUnits)),
    ];

    const names = [
      'Longitude',
      'Latitude',
      isWinterTime(volume.timeUnits)
        ? 'Winter'
        : volume.timeUnits.includes('since ')
          ? 'Elapsed time'
          : 'Lead time',
    ];

    const halves = [w, h, d];
    for (let axis = 0; axis < 3; axis++) {
      const fixed = [0, 1, 2].filter((n) => n !== axis);

      const candidates: [number, number][] = [
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ];

      const score = (signs: [number, number]) => {
        const q = [0, 0, 0];
        fixed.forEach((n, i) => (q[n] = signs[i] * halves[n]));
        const projected = projection.project(q);

        return axis === 2 ? -projected[0] : projected[1];
      };

      const signs = candidates.reduce((best, next) => (score(next) > score(best) ? next : best));

      const position = (f: number, pad: number): [number, number, number] => {
        const q = [0, 0, 0];
        q[axis] = (2 * f - 1) * halves[axis];
        fixed.forEach((n, i) => (q[n] = signs[i] * (halves[n] + pad)));

        return q as [number, number, number];
      };

      axes.push({ source: position(0, 12), target: position(1, 12) });
      for (const f of compact ? [0, 1] : [0, 0.5, 1]) {
        const index = Math.round(f * (values[axis].length - 1));
        const number = values[axis][index];

        const fraction =
          axis === 2
            ? (number - values[axis][0]) / (values[axis].at(-1)! - values[axis][0] || 1)
            : f;

        axes.push({ source: position(fraction, 12), target: position(fraction, 18) });

        labels.push({
          position: position(fraction, 30),
          text:
            axis === 2
              ? isWinterTime(volume.timeUnits)
                ? String(number)
                : `${number} h`
              : degrees(number, axis === 0 ? 'E' : 'N', axis === 0 ? 'W' : 'S'),
        });
      }
      labels.push({ position: position(0.5, compact ? 62 : 57), text: names[axis], title: true });
    }

    return { wire, axes, labels };
  }, [volume, camera.rotationOrbit, camera.rotationX, compact, regionOffset, size]);

  const selectedPositions = useMemo(
    () =>
      points
        .filter((p) => p.x <= slices[0] && p.y >= slices[1])
        .map((p) => ({
          ...p,
          position: [
            (p.anchor[0] - 0.5) * size[0],
            (p.anchor[1] - 0.5) * size[1],
            (normalized(volume.times, p.t) - 0.5) * size[2],
          ] as [number, number, number],
        })),
    [volume, points, slices[0], slices[1], size],
  );

  const visiblePlaceLabels = useMemo(() => {
    const projection = new OrbitViewport({
      ...viewportSize,
      ...camera,
      ...cubeProjection,
      zoom: camera.zoom + entranceZoom,
    });

    return spacedPlaceLabels(
      placeLabels,
      (place) => projection.project(place.position),
      viewportSize,
      camera.zoom - fitZoom.current,
    );
  }, [placeLabels, viewportSize, camera, entranceZoom]);

  const topFace = useMemo(() => {
    const projection = new OrbitViewport({
      ...viewportSize,
      ...camera,
      ...cubeProjection,
      zoom: camera.zoom + entranceZoom,
    });

    const longitude = volume.lon.map((n) => (n - volume.lon[0] + 360) % 360);
    const west = -size[0] / 2;
    const east = (normalized(longitude, slices[0]) - 0.5) * size[0];
    const south = (normalized(volume.lat, slices[1]) - 0.5) * size[1];
    const north = size[1] / 2;
    const top = (normalized(volume.times, slices[2]) - 0.5) * size[2];

    return [
      [west, south, top],
      [east, south, top],
      [east, north, top],
      [west, north, top],
    ].map((point) => projection.project(point));
  }, [volume, slices, size, viewportSize, camera, entranceZoom]);

  const layers = useMemo(
    () => [
      new VolumeLayer({
        id: 'volume',
        opacity: 1,
        parameters: { blend: false, depthWriteEnabled: true, depthCompare: 'less-equal' },
        volume,
        size,
        selectionMask,
        regionOffset,
        slices,
        range,
        palette,
        onReady: reportReady,
        pickable: true,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      }),
      ...[true, false].map(
        (halo) =>
          new LineLayer({
            id: halo ? 'country-border-halo' : 'country-borders',
            data: geographicLines,
            getSourcePosition: (d) => d.source,
            getTargetPosition: (d) => d.target,
            getColor: halo ? [255, 255, 255, 235] : [35, 48, 67, 245],
            getWidth: halo ? 3 : 1.2,
            parameters: { depthCompare: 'less-equal', depthWriteEnabled: false },
            coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
            pickable: false,
          }),
      ),
      new TextLayer({
        id: 'place-labels',
        visible: showLabels,
        data: visiblePlaceLabels,
        getPosition: (d) => d.position,
        getText: (d) => d.name,
        getSize: 13,
        getColor: [39, 42, 49, 255],
        characterSet: 'auto',
        fontFamily: 'Inter, sans-serif',
        fontWeight: 500,
        fontSettings: { sdf: true, buffer: 8 },
        outlineWidth: 5,
        outlineColor: [255, 255, 255, 230],
        parameters: { depthCompare: 'always', depthWriteEnabled: false },
        billboard: true,
        pickable: false,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      }),
      new LineLayer({
        id: 'cube-edges',
        data: wire,
        getSourcePosition: (d) => d.source as [number, number, number],
        getTargetPosition: (d) => d.target as [number, number, number],
        getColor: [92, 104, 122, 170],
        parameters: { depthWriteEnabled: false },
        getWidth: 1,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      }),
      new LineLayer({
        id: 'coordinate-axes',
        data: axes,
        getSourcePosition: (d) => d.source,
        getTargetPosition: (d) => d.target,
        getColor: [78, 91, 113, 255],
        getWidth: 1.4,
        parameters: { depthCompare: 'always', depthWriteEnabled: false },
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      }),
      new TextLayer({
        id: 'axis-labels',
        data: labels,
        getPosition: (d) => d.position as [number, number, number],
        getText: (d) => d.text,
        getSize: (d) => (d.title ? 12 : 10),
        getAngle: (d) =>
          compact && (d.text === 'Lead time' || d.text === 'Elapsed time') ? 90 : 0,
        getPixelOffset: (d) => {
          if (d.text === 'Lead time' || d.text === 'Elapsed time')
            return compact ? [0, 0] : [-35, 0];
          if (/° [EW]$/.test(d.text)) return [-10, 5];
          if (/° [NS]$/.test(d.text)) return [10, 5];

          return [0, 0];
        },
        getColor: [65, 77, 97],
        characterSet: 'auto',
        fontFamily: 'Inter, sans-serif',
        fontWeight: 400,
        background: true,
        getBackgroundColor: [248, 249, 251, 235],
        backgroundPadding: [3, 2],
        parameters: { depthCompare: 'always', depthWriteEnabled: false },
        billboard: true,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      }),
      new IconLayer({
        id: 'selected-point',
        data: selectedPositions,
        getPosition: (d) => d.position,
        getIcon: (d) => pointMarkerIcon(d.color),
        getSize: 18,
        sizeUnits: 'pixels',
        billboard: true,
        pickable: false,
        parameters: { depthCompare: 'always', depthWriteEnabled: false },
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      }),
    ],
    [
      volume,
      size,
      selectionMask,
      regionOffset,
      slices,
      range,
      palette,
      reportReady,
      geographicLines,
      visiblePlaceLabels,
      showLabels,
      wire,
      axes,
      labels,
      selectedPositions,
      compact,
    ],
  );

  return (
    <div
      ref={host}
      className={`cube-container ${entranceReady ? 'cube-arrived' : 'cube-awaiting-frame'} ${commandHeld ? 'region-grab' : ''} ${regionDragging ? 'region-grabbing' : ''}`}
      aria-busy={loading}
      onPointerEnter={(e) => {
        setPointerInside(true);
        setCommandHeld(e.metaKey);
      }}
      onPointerLeave={() => {
        setPointerInside(false);
        setHover(null);
      }}
      role="region"
      aria-label="Interactive forecast cube"
      tabIndex={0}
      onContextMenu={(e) => e.preventDefault()}
      onWheelCapture={stopEntrance}
      onPointerDownCapture={(e) => {
        stopEntrance();
        if (!e.metaKey || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();

        const projection = new OrbitViewport({
          width: r.width,
          height: r.height,
          ...camera,
          ...cubeProjection,
        });

        const o = projection.project([0, 0, 0]);
        const px = projection.project([size[0], 0, 0]),
          py = projection.project([0, size[1], 0]);

        regionDrag.current = {
          x: e.clientX,
          y: e.clientY,
          pointer: e.pointerId,
          extent: displayedRegion || volume.extent,
          ax: [px[0] - o[0], px[1] - o[1]],
          ay: [py[0] - o[0], py[1] - o[1]],
          next: null,
        };

        setRegionDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        setHover(null);
      }}
      onClickCapture={(e) => {
        if (e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();

          setCamera((c) => ({
            ...c,
            rotationOrbit: c.rotationOrbit + (e.key === 'ArrowRight' ? 5 : -5),
          }));
        }

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();

          setCamera((c) => ({
            ...c,
            rotationX: Math.max(-85, Math.min(85, c.rotationX + (e.key === 'ArrowUp' ? 5 : -5))),
          }));
        }

        if (e.key === 'r') setCamera({ ...initial, zoom: fitZoom.current });
      }}
    >
      <DeckGL
        key={contextVersion}
        deviceProps={{ type: 'webgl', adapters: [webgl2Adapter] }}
        views={cubeView}
        viewState={{ ...camera, zoom: camera.zoom + entranceZoom }}
        onViewStateChange={({ viewState }) =>
          setCamera({
            ...viewState,
            zoom: viewState.zoom - entranceZoom,
          } as typeof initial)
        }
        controller={controller}
        layers={layers}
        onError={onError}
        onHover={(i: PickingInfo) => {
          const point = displayedRegion ? null : (i.object as Point | undefined);
          setHover(point || null);
          setOverTopFace(
            Boolean(point && point.t === slices[2] && insideProjectedFace(i.x, i.y, topFace)),
          );
        }}
        onClick={(i: PickingInfo, event) => {
          if (event.srcEvent instanceof MouseEvent && event.srcEvent.button !== 0) return;
          if (i.object && !displayedRegion) onPoint(i.object);
        }}
        onDragStart={() => setCameraDragging(true)}
        onDragEnd={() => setCameraDragging(false)}
        getCursor={({ isDragging }) =>
          regionDragging || commandHeld ? 'move' : isDragging ? 'grabbing' : 'grab'
        }
      />
      <PanHint
        active={
          hoverActive && overTopFace && !loading && !loadError && !regionFailure && !hasPanned
        }
        commandHeld={commandHeld}
      />
      {(loading || loadError || regionFailure || regionDragging) && (
        <div className="canvas-region-status" role="status" aria-live="polite">
          {loading ? (
            <span className="region-spinner" aria-hidden="true" />
          ) : !loadError && !regionFailure ? (
            <Hand size={13} aria-hidden="true" />
          ) : null}
          <span>
            {loadError ||
              regionFailure?.message ||
              (loading
                ? 'Loading region…'
                : regionDragging
                  ? 'Moving region'
                  : 'Drag to move region')}
          </span>
        </div>
      )}
      <WorldMinimap extent={displayedRegion || volume.extent} />
      <div className="camera-tools">
        {(
          [
            { id: 'orbit', label: 'Orbit', icon: <Box size={15} /> },
            { id: 'pan', label: 'Pan', icon: <Hand size={15} /> },
          ] as const
        ).map((item) => (
          <Tip
            key={item.id}
            label={
              item.id === 'orbit'
                ? 'Drag to orbit · Cmd-drag to move region · Shift-drag to pan · Scroll to zoom'
                : 'Drag to pan · Scroll to zoom'
            }
          >
            <Button
              variant="ghost"
              className={`icon ${mode === item.id ? 'active' : ''}`}
              onClick={() => setMode(item.id)}
              aria-label={item.label}
            >
              {item.icon}
            </Button>
          </Tip>
        ))}
        <i />
        <Tip label="Reset camera (R)">
          <Button
            variant="ghost"
            className="icon"
            aria-label="Reset camera"
            onClick={() => setCamera({ ...initial, zoom: fitZoom.current })}
          >
            Reset
          </Button>
        </Tip>
        <Tip label="Zoom in">
          <Button
            variant="ghost"
            className="icon"
            aria-label="Zoom in"
            onClick={() => setCamera((c) => ({ ...c, zoom: Math.min(3, c.zoom + 0.2) }))}
          >
            <Plus size={16} />
          </Button>
        </Tip>
        <Tip label="Zoom out">
          <Button
            variant="ghost"
            className="icon"
            aria-label="Zoom out"
            onClick={() => setCamera((c) => ({ ...c, zoom: Math.max(-2, c.zoom - 0.2) }))}
          >
            <Minus size={16} />
          </Button>
        </Tip>
        <i />
        <Tip label={showLabels ? 'Hide place labels' : 'Show place labels'}>
          <Button
            variant="ghost"
            className={`icon ${showLabels ? 'active' : ''}`}
            aria-label="Place labels"
            aria-pressed={showLabels}
            onClick={toggleLabels}
          >
            <Type size={16} />
          </Button>
        </Tip>
      </div>
      {hover ? (
        <div className="hover-inspector">
          <span>
            {volume.lon[hover.x]?.toFixed(2)}° E · {volume.lat[hover.y]?.toFixed(2)}° N
          </span>
          <b>
            {Number.isFinite(hover.value) ? String(hover.value) : 'Missing'}{' '}
            <small>{volume.units === 'degree_Celsius' ? '°C' : volume.units}</small>
          </b>
          <span>
            {volume.timeUnits.includes('since ')
              ? coordinateDate(volume.times[hover.t], volume.timeUnits)
                  .replace('T', ' ')
                  .replace('.000Z', ' UTC')
              : timeLabel(volume.times[hover.t], volume.timeUnits)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
