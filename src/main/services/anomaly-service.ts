/**
 * Anomaly Service — implements AnomalyService interface.
 *
 * Computes terrain anomalies as local deviations from a smoothed
 * elevation surface. Runs per-viewport (per tile), not globally.
 *
 * Method:
 *  1. Smooth the DEM with a Gaussian-like box blur (kernel ~11px)
 *  2. Residual = original - smoothed
 *  3. Highlight pixels where |residual| > N std devs (default 2.5)
 *  4. Cluster highlighted pixels into polygons
 *
 * Performance: O(W*H) per tile — fast enough for on-demand viewport computation.
 */

import type { AnomalyService } from './types'
import type {
  AnomalyTileResponse,
  AnomalyPolygon,
  AnomalyAnalysisRequest,
  AnomalyAnalysisResponse,
  AnomalyZone,
  LngLat,
} from '@shared/types'
import type { DemTile } from './types'
import { demService } from './dem-service'
import { lngLatToTile, DEFAULT_ZOOM } from './dem-tiles'

const STD_DEV_THRESHOLD = 2.5
const BLUR_RADIUS = 5 // ~11px kernel

function boxBlur(grid: (number | null)[][], width: number, height: number): number[][] {
  const blurred: number[][] = []
  for (let y = 0; y < height; y++) {
    const row: number[] = []
    for (let x = 0; x < width; x++) {
      let sum = 0
      let count = 0
      for (let dy = -BLUR_RADIUS; dy <= BLUR_RADIUS; dy++) {
        for (let dx = -BLUR_RADIUS; dx <= BLUR_RADIUS; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const v = grid[ny]?.[nx]
            if (v != null) {
              sum += v
              count++
            }
          }
        }
      }
      row.push(count > 0 ? sum / count : 0)
    }
    blurred.push(row)
  }
  return blurred
}

/**
 * Cluster anomaly pixels into polygons using a simple flood-fill
 * approach. Returns polygons as arrays of LngLat (simplified outlines).
 */
function clusterAnomalies(
  anomalyMask: boolean[][],
  width: number,
  height: number,
  tile: DemTile,
): AnomalyPolygon[] {
  const visited: boolean[][] = Array.from({ length: height }, () => new Array(width).fill(false))
  const polygons: AnomalyPolygon[] = []
  const [sw, ne] = tile.bounds
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height

  let polyId = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visited[y][x] || !anomalyMask[y][x]) continue

      // Flood fill to find the cluster
      const cluster: { x: number; y: number }[] = []
      const stack = [{ x, y }]
      let strengthSum = 0

      while (stack.length > 0) {
        const p = stack.pop()!
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue
        if (visited[p.y][p.x] || !anomalyMask[p.y][p.x]) continue
        visited[p.y][p.x] = true
        cluster.push(p)
        stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 })
      }

      // Only keep clusters with enough pixels
      if (cluster.length < 5) continue

      // Create a simple bounding polygon from the cluster extents
      // (Proper contour extraction would be better, but this is fast)
      const minX = Math.min(...cluster.map((p) => p.x))
      const maxX = Math.max(...cluster.map((p) => p.x))
      const minY = Math.min(...cluster.map((p) => p.y))
      const maxY = Math.max(...cluster.map((p) => p.y))

      const coords: LngLat[] = [
        { lng: sw.lng + minX * lngStep, lat: ne.lat - minY * latStep },
        { lng: sw.lng + maxX * lngStep, lat: ne.lat - minY * latStep },
        { lng: sw.lng + maxX * lngStep, lat: ne.lat - maxY * latStep },
        { lng: sw.lng + minX * lngStep, lat: ne.lat - maxY * latStep },
      ]

      polygons.push({
        id: `anomaly-${polyId++}`,
        coords,
        strength: strengthSum / cluster.length,
      })
    }
  }

  return polygons
}

export const anomalyService: AnomalyService = {
  compute(tile: DemTile): AnomalyTileResponse {
    const { grid, width, height } = tile

    // 1. Smooth
    const smoothed = boxBlur(grid, width, height)

    // 2. Compute residuals
    const residuals: number[][] = []
    for (let y = 0; y < height; y++) {
      const row: number[] = []
      for (let x = 0; x < width; x++) {
        row.push((grid[y]?.[x] ?? 0) - (smoothed[y]?.[x] ?? 0))
      }
      residuals.push(row)
    }

    // 3. Compute std dev
    const allResiduals = residuals.flat()
    const mean = allResiduals.reduce((a, b) => a + b, 0) / allResiduals.length
    const variance = allResiduals.reduce((a, b) => a + (b - mean) ** 2, 0) / allResiduals.length
    const stdDev = Math.sqrt(variance)

    if (stdDev < 0.1) return { polygons: [] }

    // 4. Build anomaly mask
    const mask: boolean[][] = Array.from({ length: height }, () => new Array(width).fill(false))
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (Math.abs(residuals[y][x]) > STD_DEV_THRESHOLD * stdDev) {
          mask[y][x] = true
        }
      }
    }

    // 5. Cluster into polygons
    const polygons = clusterAnomalies(mask, width, height, tile)
    return { polygons }
  },
}

/* ------------------------------------------------------------------ */
/* Area-based anomaly analysis (for map overlay)                       */
/* ------------------------------------------------------------------ */

async function loadDemGridArea(bounds: [LngLat, LngLat], zoom: number) {
  const [sw, ne] = bounds
  const minTile = lngLatToTile(sw.lng, ne.lat, zoom)
  const maxTile = lngLatToTile(ne.lng, sw.lat, zoom)
  const tilesX = maxTile.x - minTile.x + 1
  const tilesY = maxTile.y - minTile.y + 1
  if (tilesX > 8 || tilesY > 8) throw new Error('Analysis area too large. Draw a smaller bounding box.')

  const tileGrids: (number | null)[][][][] = []
  for (let ty = 0; ty < tilesY; ty++) {
    tileGrids[ty] = []
    for (let tx = 0; tx < tilesX; tx++) {
      const tile = await demService.loadTile(minTile.x + tx, minTile.y + ty, zoom)
      tileGrids[ty][tx] = tile.grid
    }
  }
  const grid: (number | null)[][] = []
  for (let ty = 0; ty < tilesY; ty++) {
    for (let row = 0; row < tileGrids[ty][0].length; row++) {
      const mergedRow: (number | null)[] = []
      for (let tx = 0; tx < tilesX; tx++) {
        const tileRow = tileGrids[ty][tx][row]
        if (tileRow) mergedRow.push(...tileRow)
      }
      grid.push(mergedRow)
    }
  }
  const height = grid.length
  const width = grid[0]?.length ?? 0
  const latMid = (sw.lat + ne.lat) / 2
  const lngSpanM = haversineMeters(sw.lng, latMid, ne.lng, latMid)
  const cellSizeM = lngSpanM / width
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height
  return { grid, width, height, cellSizeM, swLng: sw.lng, neLat: ne.lat, lngStep, latStep }
}

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export async function analyzeAnomalyArea(req: AnomalyAnalysisRequest): Promise<AnomalyAnalysisResponse> {
  const { bounds, threshold, demZoom } = req
  const zoom = demZoom ?? DEFAULT_ZOOM
  const stdThreshold = threshold ?? STD_DEV_THRESHOLD

  const { grid, width, height, cellSizeM, swLng, neLat, lngStep, latStep } =
    await loadDemGridArea(bounds, zoom)

  // 1. Smooth
  const smoothed = boxBlur(grid, width, height)

  // 2. Residuals
  const residuals: number[][] = []
  for (let y = 0; y < height; y++) {
    const row: number[] = []
    for (let x = 0; x < width; x++) {
      row.push((grid[y]?.[x] ?? 0) - (smoothed[y]?.[x] ?? 0))
    }
    residuals.push(row)
  }

  // 3. Std dev
  const allResiduals = residuals.flat()
  const mean = allResiduals.reduce((a, b) => a + b, 0) / allResiduals.length
  const variance = allResiduals.reduce((a, b) => a + (b - mean) ** 2, 0) / allResiduals.length
  const stdDev = Math.sqrt(variance)
  if (stdDev < 0.1) return { zones: [], bounds }

  // 4. Mask + classify type (depression vs prominence)
  const mask: boolean[][] = Array.from({ length: height }, () => new Array(width).fill(false))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (Math.abs(residuals[y][x]) > stdThreshold * stdDev) {
        mask[y][x] = true
      }
    }
  }

  // 5. Cluster into zones with type classification
  const visited = new Uint8Array(width * height)
  const zones: AnomalyZone[] = []
  let zoneId = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (visited[idx] || !mask[y][x]) continue

      const cluster: { x: number; y: number; residual: number }[] = []
      const stack = [{ x, y }]
      while (stack.length > 0) {
        const p = stack.pop()!
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue
        const pidx = p.y * width + p.x
        if (visited[pidx] || !mask[p.y][p.x]) continue
        visited[pidx] = 1
        cluster.push({ x: p.x, y: p.y, residual: residuals[p.y][p.x] })
        stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 })
      }

      if (cluster.length < 5) continue

      const minX = Math.min(...cluster.map((c) => c.x))
      const maxX = Math.max(...cluster.map((c) => c.x))
      const minY = Math.min(...cluster.map((c) => c.y))
      const maxY = Math.max(...cluster.map((c) => c.y))
      const avgResidual = cluster.reduce((a, c) => a + c.residual, 0) / cluster.length
      const strength = Math.abs(avgResidual) / stdDev
      const sizeM = Math.max(maxX - minX, maxY - minY) * cellSizeM

      zones.push({
        id: `anomaly-zone-${zoneId++}`,
        coords: [
          { lng: swLng + minX * lngStep, lat: neLat - minY * latStep },
          { lng: swLng + maxX * lngStep, lat: neLat - minY * latStep },
          { lng: swLng + maxX * lngStep, lat: neLat - maxY * latStep },
          { lng: swLng + minX * lngStep, lat: neLat - maxY * latStep },
        ],
        strength,
        type: avgResidual < 0 ? 'depression' : 'prominence',
        sizeM,
      })
    }
  }

  return { zones, bounds }
}
