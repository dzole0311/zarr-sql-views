import { memo } from 'react';
import type { Extent } from '../engine/types';
import { minimapRegions } from '../render/minimap';

export const WorldMinimap = memo(function WorldMinimap({ extent }: { extent: Extent }) {
  return (
    <div className="world-minimap">
      <svg
        viewBox="0 0 360 180"
        role="img"
        aria-label="World overview showing the cube's geographic region"
      >
        <title>Current region</title>
        <image href="/world-overview.svg" width="360" height="180" />
        {minimapRegions(extent).map((rect, i) => (
          <rect
            key={i}
            {...rect}
            className="world-minimap-region"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
});
