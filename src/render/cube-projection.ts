/** OrbitViewport scales depth as well as screen position when zooming. A distant
 * camera keeps the near plane outside the cube at close zoom. In orthographic
 * mode, reducing fovy moves the camera back without changing the screen scale. */
export const cubeProjection = {
  orbitAxis: 'Z' as const,
  orthographic: true,
  fovy: 1,
  near: 0.1,
  far: 1000,
};
