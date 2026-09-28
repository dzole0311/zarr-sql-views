import { OrbitController } from '@deck.gl/core';

/** Keep orbit gestures on a consistent camera plane. Surface depth picking can
 * change between the slice, a side face and empty space during one gesture. */
export class CubeController extends OrbitController {
  protected _unproject3D = (): null => null;
}
