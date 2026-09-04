/**
 * DEM Zoom Utility — picks the optimal zoom level for a bounding box
 * to stay within a tile budget.
 *
 * Terrarium DEM tiles are available from z0 to z15. At higher zoom,
 * resolution is better but more tiles are needed to cover the same area.
 * At lower zoom, fewer tiles but coarser elevation data.
 *
 * This utility automatically reduces the zoom level until the tile count
 * fits within the budget, allowing analysis of much larger areas at
 * slightly lower resolution.
 */

import { lngLatToTile } from './dem-tiles'
import type { LngLat } from '@shared/types'

/** Default maximum tiles per dimension (64 tiles = ~70km at z15, ~140km at z14). */
const DEFAULT_MAX_TILES_PER_DIM = 64

/**
 * Compute the optimal DEM zoom level for a bounding box.
 * Starts at the preferred zoom and reduces until the tile count fits.
 *
 * @param bounds [SW, NE] bounding box
 * @param preferredZoom Start with this zoom (default 15)
 * @param maxTilesPerDim Max tiles in either dimension (default 64)
 * @returns The highest zoom level that fits within the tile budget
 */
export function computeOptimalZoom(
  bounds: [LngLat, LngLat],
  preferredZoom: number = 15,
  maxTilesPerDim: number = DEFAULT_MAX_TILES_PER_DIM,
): number {
  const [sw, ne] = bounds
  let zoom = preferredZoom

  while (zoom > 0) {
    const minTile = lngLatToTile(sw.lng, ne.lat, zoom)
    const maxTile = lngLatToTile(ne.lng, sw.lat, zoom)
    const tilesX = maxTile.x - minTile.x + 1
    const tilesY = maxTile.y - minTile.y + 1

    if (tilesX <= maxTilesPerDim && tilesY <= maxTilesPerDim) {
      return zoom
    }
    zoom--
  }

  return 0
}

/**
 * Compute the tile count for a bounding box at a given zoom.
 */
export function countTiles(bounds: [LngLat, LngLat], zoom: number): { tilesX: number; tilesY: number; total: number } {
  const [sw, ne] = bounds
  const minTile = lngLatToTile(sw.lng, ne.lat, zoom)
  const maxTile = lngLatToTile(ne.lng, sw.lat, zoom)
  const tilesX = maxTile.x - minTile.x + 1
  const tilesY = maxTile.y - minTile.y + 1
  return { tilesX, tilesY, total: tilesX * tilesY }
}

/**
 * Estimate the cell size (meters) at a given zoom level at a given latitude.
 * Terrarium tiles are 256x256 pixels.
 */
export function estimateCellSizeM(zoom: number, lat: number): number {
  // Earth circumference ~40075km, 256 pixels per tile, 2^zoom tiles per row
  const metersPerPixel = (40075000 * Math.cos((lat * Math.PI) / 180)) / (256 * Math.pow(2, zoom))
  return metersPerPixel
}
