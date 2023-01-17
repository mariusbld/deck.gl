import {Viewport} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import {TraversalParameters, getOSMTileIndices} from './tile-2d-traversal';
import type {TileIndex} from './tile-index-utils';
import {transformBox, Bounds, ZRange} from './bounding-box-utils';

import {getTraversalParametersFromViewport} from '../tile-layer/viewport-utils';

const TILE_SIZE = 512;
const DEFAULT_EXTENT: Bounds = [-Infinity, -Infinity, Infinity, Infinity];

/** Parameters for getTileIndices */
export type GetTileIndicesOptions = {
  isGeospatial: boolean;
  viewport: Viewport;
  maxZoom?: number;
  minZoom?: number;
  zRange: ZRange | undefined;
  extent: Bounds;
  tileSize?: number;
  modelMatrix?: Matrix4;
  modelMatrixInverse?: Matrix4;
  zoomOffset?: number;
};

/**
 * Returns all tile indices in the current viewport. If the current zoom level is smaller
 * than minZoom, return an empty array. If the current zoom level is greater than maxZoom,
 * return tiles that are on maxZoom.
 */
// eslint-disable-next-line complexity
export function getTileIndices({
  isGeospatial,
  viewport,
  maxZoom,
  minZoom,
  zRange,
  extent,
  tileSize = TILE_SIZE,
  modelMatrix,
  modelMatrixInverse,
  zoomOffset = 0
}: GetTileIndicesOptions) {
  let z = isGeospatial
    ? Math.round(viewport.zoom + Math.log2(TILE_SIZE / tileSize)) + zoomOffset
    : Math.ceil(viewport.zoom) + zoomOffset;

  if (typeof minZoom === 'number' && Number.isFinite(minZoom) && z < minZoom) {
    if (!extent) {
      return [];
    }
    z = minZoom;
  }

  if (typeof maxZoom === 'number' && Number.isFinite(maxZoom) && z > maxZoom) {
    z = maxZoom;
  }

  let transformedExtent = extent;
  if (modelMatrix && modelMatrixInverse && extent && !isGeospatial) {
    transformedExtent = transformBox(extent, modelMatrix);
  }

  const traversalParameters = getTraversalParametersFromViewport(
    viewport,
    0, // maxZ???
    zRange,
    extent
  );

  let tileIndices;
  if (isGeospatial) {
    tileIndices = getOSMTileIndices(traversalParameters);
  } else {
    const bounds = getBoundingBox(viewport, null, extent);
    tileIndices = getIdentityTileIndices(
      bounds,
      z,
      tileSize,
      transformedExtent || DEFAULT_EXTENT,
      modelMatrixInverse
    );
  }
  return tileIndices;
}

/**
 * gets the bounding box of a viewport
 */
function getBoundingBox(viewport: Viewport, zRange: number[] | null, extent: Bounds): Bounds {
  let bounds;
  if (zRange && zRange.length === 2) {
    const [minZ, maxZ] = zRange;
    const bounds0 = viewport.getBounds({z: minZ});
    const bounds1 = viewport.getBounds({z: maxZ});
    bounds = [
      Math.min(bounds0[0], bounds1[0]),
      Math.min(bounds0[1], bounds1[1]),
      Math.max(bounds0[2], bounds1[2]),
      Math.max(bounds0[3], bounds1[3])
    ];
  } else {
    bounds = viewport.getBounds();
  }
  if (!viewport.isGeospatial) {
    return [
      // Top corner should not be more then bottom corner in either direction
      Math.max(Math.min(bounds[0], extent[2]), extent[0]),
      Math.max(Math.min(bounds[1], extent[3]), extent[1]),
      // Bottom corner should not be less then top corner in either direction
      Math.min(Math.max(bounds[2], extent[0]), extent[2]),
      Math.min(Math.max(bounds[3], extent[1]), extent[3])
    ];
  }
  return [
    Math.max(bounds[0], extent[0]),
    Math.max(bounds[1], extent[1]),
    Math.min(bounds[2], extent[2]),
    Math.min(bounds[3], extent[3])
  ];
}

/** Get culling bounds in world space */
export function getCullBounds({
  viewport,
  z,
  cullRect
}: {
  /** Current viewport */
  viewport: Viewport;
  /** Current z range */
  z: ZRange | number | undefined;
  /** Culling rectangle in screen space */
  cullRect: {x: number; y: number; width: number; height: number};
}): [number, number, number, number] {
  const x = cullRect.x - viewport.x;
  const y = cullRect.y - viewport.y;
  const {width, height} = cullRect;

  if (!Array.isArray(z)) {
    const unprojectOption = {targetZ: z || 0};

    const topLeft = viewport.unproject([x, y], unprojectOption);
    const topRight = viewport.unproject([x + width, y], unprojectOption);
    const bottomLeft = viewport.unproject([x, y + height], unprojectOption);
    const bottomRight = viewport.unproject([x + width, y + height], unprojectOption);

    return [
      Math.min(topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]),
      Math.min(topLeft[1], topRight[1], bottomLeft[1], bottomRight[1]),
      Math.max(topLeft[0], topRight[0], bottomLeft[0], bottomRight[0]),
      Math.max(topLeft[1], topRight[1], bottomLeft[1], bottomRight[1])
    ];
  }

  const bounds0 = getCullBounds({viewport, z: z[0], cullRect});
  const bounds1 = getCullBounds({viewport, z: z[1], cullRect});

  return [
    Math.min(bounds0[0], bounds1[0]),
    Math.min(bounds0[1], bounds1[1]),
    Math.max(bounds0[2], bounds1[2]),
    Math.max(bounds0[3], bounds1[3])
  ];
}

function getIndexingCoords(bbox: Bounds, scale: number, modelMatrixInverse?: Matrix4): Bounds {
  if (modelMatrixInverse) {
    const transformedTileIndex = transformBox(bbox, modelMatrixInverse).map(
      i => (i * scale) / TILE_SIZE
    );
    return transformedTileIndex as Bounds;
  }
  return bbox.map(i => (i * scale) / TILE_SIZE) as Bounds;
}

function getIdentityTileIndices(
  bbox: Bounds,
  z: number,
  tileSize: number,
  extent: Bounds,
  modelMatrixInverse?: Matrix4
) {
  const scale = getScale(z, tileSize);
  const [minX, minY, maxX, maxY] = getIndexingCoords(bbox, scale, modelMatrixInverse);
  const indices: TileIndex[] = [];

  /*
      |  TILE  |  TILE  |  TILE  |
        |(minX)            |(maxX)
   */
  for (let x = Math.floor(minX); x < maxX; x++) {
    for (let y = Math.floor(minY); y < maxY; y++) {
      indices.push({x, y, z});
    }
  }
  return indices;
}

function getScale(z: number, tileSize: number): number {
  return (Math.pow(2, z) * TILE_SIZE) / tileSize;
}