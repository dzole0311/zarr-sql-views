import { volumeModule, vs, fs } from './volume-shaders';
import {
  Layer,
  project32,
  picking,
  type LayerProps,
  type UpdateParameters,
  type PickingInfo,
} from '@deck.gl/core';
import { Model, Geometry } from '@luma.gl/engine';
import type { Buffer, Texture } from '@luma.gl/core';
import type { Volume } from '../engine/types';
import { colorSprite, paletteNames, type Palette } from './colors';
import { voxelTimelineFaces } from './voxel-faces';

/** Fixed display dimensions keep the geographic volume cube-shaped for every region. */
export const CUBE_SIZE: [number, number, number] = [350, 350, 250];

/** Map a coordinate to [0, 1]; singleton axes occupy the origin. */
export const normalized = (arr: number[], i: number) =>
  arr.length < 2 ? 0 : (arr[i] - arr[0]) / (arr[arr.length - 1] - arr[0]);

type Props = LayerProps & {
  volume: Volume;
  size: [number, number, number];
  selectionMask?: Uint8Array | null;
  regionOffset?: [number, number];
  slices: [number, number, number];
  range: [number, number];
  palette: Palette;
  onReady?: () => void;
};

/** Render a canonical volume with reusable surface geometry and GPU selection masks.
 * Slider motion changes uniforms; source textures upload only when the volume changes.
 * Missing cells render black, and picking reads source-precision CPU values. */
export class VolumeLayer extends Layer<Props> {
  static layerName = 'ZarrSQLViewsVolumeLayer';
  declare state: {
    model: Model;
    faceBuffer: Buffer;
    faceCount: number;
    texture: Texture;
    selectionTexture: Texture;
    coords: Texture;
    paletteTexture: Texture;
    reported?: boolean;
  };

  getNumInstances() {
    return this.state?.faceCount ?? 1;
  }

  getShaders() {
    return super.getShaders({
      vs,
      fs,
      modules: [project32, picking, volumeModule],
    });
  }

  initializeState() {
    const positions = [];
    for (let axis = 0; axis < 6; axis++)
      for (const [x, y] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
        [1, 1],
        [0, 1],
      ])
        positions.push(x, y, axis);

    const model = new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      geometry: new Geometry({
        topology: 'triangle-list',
        attributes: { positions: { size: 3, value: new Float32Array(positions) } },
      }),
      isInstanced: true,
      instanceCount: 1,
      bufferLayout: [{ name: 'instanceCellFace', format: 'float32x2', stepMode: 'instance' }],
      parameters: {
        blend: false,
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
        cullMode: 'none',
      },
    });

    const faceBuffer = this.context.device.createBuffer({ data: new Float32Array([0, 0]) });
    model.setAttributes({ instanceCellFace: faceBuffer });

    this.setState({
      model,
      faceBuffer,
      faceCount: 1,
      paletteTexture: this.context.device.createTexture({
        format: 'rgba8unorm',
        width: 256,
        height: paletteNames.length,
        data: new Uint8Array(colorSprite().data.buffer),
        mipLevels: 1,
        sampler: {
          minFilter: 'linear',
          magFilter: 'linear',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge',
        },
      }),
    });
  }

  updateState({ props, oldProps }: UpdateParameters<this>) {
    if (!this.state.model) return;
    if (props.volume !== oldProps.volume) {
      const v = props.volume;
      this.state.texture?.destroy();
      this.state.coords?.destroy();
      const [depth, height, width] = v.shape;
      const max = this.context.device.limits.maxTextureDimension3D;
      if (Math.max(width, height, depth) > max)
        throw Error(`Selection exceeds this GPU's ${max}-voxel 3D texture limit.`);
      if (v.data.length * 4 > 64 * 1024 * 1024) throw Error('GPU texture budget exceeded.');

      const texture = this.context.device.createTexture({
        dimension: '3d',
        format: 'r32float',
        width,
        height,
        depth,
        data: v.data instanceof Float32Array ? v.data : new Float32Array(v.data),
        mipLevels: 1,
        sampler: {
          minFilter: 'nearest',
          magFilter: 'nearest',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge',
          addressModeW: 'clamp-to-edge',
        },
      });

      const coordWidth = Math.max(width, height, depth);
      const coordData = new Float32Array(coordWidth * 3);
      const lon = v.lon.map((n) => (n - v.lon[0] + 360) % 360);
      [lon, v.lat, v.times].forEach((values, row) =>
        values.forEach((_, i) => (coordData[row * coordWidth + i] = normalized(values, i))),
      );

      const coords = this.context.device.createTexture({
        format: 'r32float',
        width: coordWidth,
        height: 3,
        data: coordData,
        mipLevels: 1,
        sampler: { minFilter: 'nearest', magFilter: 'nearest' },
      });

      this.setState({ texture, coords, reported: false });
      this.state.model.setBindings({ volumeTexture: texture, coordinatesTexture: coords });
    }

    if (props.volume !== oldProps.volume || props.selectionMask !== oldProps.selectionMask) {
      this.state.selectionTexture?.destroy();
      const mask = props.selectionMask;
      const [depth, height, width] = mask ? props.volume.shape : [1, 1, 1];

      const selectionTexture = this.context.device.createTexture({
        dimension: '3d',
        format: 'r8unorm',
        width,
        height,
        depth,
        data: mask || new Uint8Array([255]),
        mipLevels: 1,
        sampler: { minFilter: 'nearest', magFilter: 'nearest' },
      });

      this.setState({ selectionTexture });
      this.state.model.setBindings({ selectionTexture });
    }

    if (
      props.volume !== oldProps.volume ||
      props.selectionMask !== oldProps.selectionMask ||
      props.slices[0] !== oldProps.slices?.[0] ||
      props.slices[1] !== oldProps.slices?.[1]
    ) {
      const faces = props.selectionMask
        ? voxelTimelineFaces(props.selectionMask, props.volume.shape, props.slices)
        : new Float32Array([0, 0]);
      this.state.faceBuffer.destroy();
      const faceBuffer = this.context.device.createBuffer({
        data: faces.length ? faces : new Float32Array([0, 0]),
      });
      this.state.model.setAttributes({ instanceCellFace: faceBuffer });
      this.state.model.setInstanceCount(faces.length / 2);
      this.state.model.setVertexCount(props.selectionMask ? 6 : 36);
      this.setState({ faceBuffer, faceCount: faces.length / 2 });
    }
  }

  draw() {
    if (!this.state.model || !this.state.texture || !this.state.faceCount) return;
    const { volume: v, slices, range, palette } = this.props;
    const lon = v.lon.map((n) => (n - v.lon[0] + 360) % 360);
    this.state.model.setBindings({ paletteTexture: this.state.paletteTexture });

    this.state.model.shaderInputs.setProps({
      volume: {
        regionOffset: this.props.regionOffset || [0, 0],
        slices: [
          normalized(lon, slices[0]),
          normalized(v.lat, slices[1]),
          normalized(v.times, slices[2]),
        ],
        size: this.props.size,
        counts: [v.shape[2], v.shape[1], v.shape[0]],
        filterActive: this.props.selectionMask ? 1 : 0,
        timeIndex: slices[2],
        valueRange: range,
        spatialCoverage: v.spatialCoverage ?? [0, 0, v.shape[2] - 1, v.shape[1] - 1],
        paletteIndex: paletteNames.indexOf(palette),
      },
    });

    if (this.state.model.draw(this.context.renderPass) && !this.state.reported) {
      this.state.reported = true;
      queueMicrotask(() => this.props.onReady?.());
    }
  }

  getPickingInfo({ info }: { info: PickingInfo }) {
    const { volume: v } = this.props;
    const n = info.index;
    if (n >= 0 && n < v.data.length) {
      const x = n % v.shape[2],
        y = Math.floor(n / v.shape[2]) % v.shape[1],
        t = Math.floor(n / (v.shape[2] * v.shape[1]));
      info.object = { x, y, t, value: v.data[n] };
    }

    return info;
  }

  finalizeState() {
    this.state.faceBuffer?.destroy();
    this.state.texture?.destroy();
    this.state.selectionTexture?.destroy();
    this.state.coords?.destroy();
    this.state.paletteTexture?.destroy();
    this.state.model?.destroy();
  }
}
