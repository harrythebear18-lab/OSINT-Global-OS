/**
 * Fall Risk Service — identifies where hikers are likely to fall.
 *
 * Computes a fall risk score per DEM cell based on:
 *  - Slope steepness (primary factor)
 *  - Curvature (convex ridges = exposure, concave gullies = trap falls)
 *  - Edge proximity (cliffs, drop-offs, gully rims)
 *  - Visibility (night, fog, extreme weather = higher risk)
 *  - Ground conditions (rain = slippery, snow = ice risk)
 *
 * Outputs:
 *  - Risk grid (0–1 per cell)
 *  - Clustered fall risk zones with level classification
 */

import type {
  FallRiskRequest,
  FallRiskResponse,
  FallRiskZone,
  FallRiskLevel,
  LngLat,
  TripParams,
} from '@shared/types'
import { demService } from './dem-service'
import { lngLatToTile, DEFAULT_ZOOM } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'
import { deriveTripParams } from './trip-params'

async function loadDemGrid(bounds: [LngLat, LngLat], zoom: number) {
  const [sw, ne] = bounds
  const effectiveZoom = computeOptimalZoom(bounds, zoom, 32)
  const minTile = lngLatToTile(sw.lng, ne.lat, effectiveZoom)
  const maxTile = lngLatToTile(ne.lng, sw.lat, effectiveZoom)
  const tilesX = maxTile.x - minTile.x + 1
  const tilesY = maxTile.y - minTile.y + 1

  const tileGrids: (number | null)[][][][] = []
  let firstTileW = 0

  for (let ty = 0; ty < tilesY; ty++) {
    tileGrids[ty] = []
    for (let tx = 0; tx < tilesX; tx++) {
      const tile = await demService.loadTile(minTile.x + tx, minTile.y + ty, effectiveZoom)
      tileGrids[ty][tx] = tile.grid
      if (ty === 0 && tx === 0) firstTileW = tile.width
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
  const gridWidthM = haversineMeters(sw.lng, latMid, ne.lng, latMid)
  const cellSizeM = gridWidthM / width
  const lngStep = (ne.lng - sw.lng) / width
  const latStep = (ne.lat - sw.lat) / height

  return { grid, width, height, cellSizeM, swLng: sw.lng, neLat: ne.lat, lngStep, latStep }
}

/**
 * Compute slope at a cell using 3x3 neighborhood (max slope to any neighbor).
 */
function cellSlope(grid: (number | null)[][], x: number, y: number, cellSizeM: number): number {
  const elev = grid[y]?.[x]
  if (elev == null) return 0
  let maxSlope = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const n = grid[y + dy]?.[x + dx]
      if (n == null) continue
      const dist = cellSizeM * Math.sqrt(dx * dx + dy * dy)
      const slope = (Math.atan2(Math.abs(n - elev), dist) * 180) / Math.PI
      maxSlope = Math.max(maxSlope, slope)
    }
  }
  return maxSlope
}

/**
 * Compute curvature: positive = convex (ridge/exposure), negative = concave (gully).
 * Uses the Laplacian (sum of second derivatives).
 */
function cellCurvature(grid: (number | null)[][], x: number, y: number): number {
  const elev = grid[y]?.[x]
  if (elev == null) return 0
  let sum = 0
  let count = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const n = grid[y + dy]?.[x + dx]
      if (n == null) continue
      sum += n - elev
      count++
    }
  }
  if (count === 0) return 0
  return -(sum / count) // positive = convex (ridge), negative = concave (gully)
}

/**
 * Detect cliff edges: cells where there's a sudden large elevation drop
 * to at least one neighbor (but not a gradual slope).
 */
function isCliffEdge(grid: (number | null)[][], x: number, y: number, cellSizeM: number): boolean {
  const elev = grid[y]?.[x]
  if (elev == null) return false
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const n = grid[y + dy]?.[x + dx]
      if (n == null) continue
      const drop = elev - n
      // Cliff: drop > 10m over one cell (~30m) = > 18° sudden drop
      if (drop > 10) return true
    }
  }
  return false
}

/**
 * Compute fall risk score (0–1) for a single cell.
 */
function computeFallRisk(
  grid: (number | null)[][],
  x: number, y: number,
  cellSizeM: number,
  visibilityFactor: number,
  groundSlipFactor: number,
): { risk: number; slope: number; curvature: number; edge: number; visibility: number } {
  const slope = cellSlope(grid, x, y, cellSizeM)
  const curvature = cellCurvature(grid, x, y)
  const cliffEdge = isCliffEdge(grid, x, y, cellSizeM)

  // Slope risk: 0 below 20°, ramps to 1 at 50°+
  const slopeRisk = Math.max(0, Math.min(1, (slope - 20) / 30))

  // Curvature risk: convex ridges = exposure (high risk), concave = moderate (trap falls)
  const curvatureRisk = Math.max(0, Math.min(1, Math.abs(curvature) / 15))

  // Edge risk: cliff edges are maximum danger
  const edgeRisk = cliffEdge ? 1.0 : Math.min(0.5, slopeRisk * 0.3)

  // Visibility risk
  const visibilityRisk = visibilityFactor

  // Ground slip risk (rain/snow)
  const groundRisk = slopeRisk * groundSlipFactor

  // Weighted combination
  const risk = Math.min(1,
    slopeRisk * 0.35 +
    curvatureRisk * 0.15 +
    edgeRisk * 0.25 +
    visibilityRisk * 0.10 +
    groundRisk * 0.15
  )

  return { risk, slope: slopeRisk, curvature: curvatureRisk, edge: edgeRisk, visibility: visibilityRisk }
}

function classifyLevel(risk: number): FallRiskLevel {
  if (risk > 0.7) return 'extreme'
  if (risk > 0.5) return 'high'
  if (risk > 0.3) return 'medium'
  return 'low'
}

/**
 * Cluster high-risk cells into zones.
 */
function clusterRiskZones(
  riskGrid: number[][],
  threshold: number,
  width: number, height: number,
  grid: (number | null)[][],
  cellSizeM: number,
  swLng: number, neLat: number, lngStep: number, latStep: number,
  componentScores: Map<string, { slope: number; curvature: number; edge: number; visibility: number }>,
): FallRiskZone[] {
  const visited = new Uint8Array(width * height)
  const zones: FallRiskZone[] = []
  let zoneId = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      if (visited[idx] || riskGrid[y]?.[x] < threshold) continue

      // Flood fill
      const cluster: { x: number; y: number; risk: number }[] = []
      const stack = [{ x, y }]
      while (stack.length > 0) {
        const p = stack.pop()!
        if (p.x < 0 || p.x >= width || p.y < 0 || p.y >= height) continue
        const pidx = p.y * width + p.x
        if (visited[pidx]) continue
        const r = riskGrid[p.y]?.[p.x]
        if (r == null || r < threshold) continue
        visited[pidx] = 1
        cluster.push({ x: p.x, y: p.y, risk: r })
        stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 })
      }

      if (cluster.length < 3) continue

      // Bounding box (loop instead of spread to avoid stack overflow on large clusters)
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      let maxRisk = 0
      for (const c of cluster) {
        if (c.x < minX) minX = c.x
        if (c.x > maxX) maxX = c.x
        if (c.y < minY) minY = c.y
        if (c.y > maxY) maxY = c.y
        if (c.risk > maxRisk) maxRisk = c.risk
      }
      const level = classifyLevel(maxRisk)
      const key = `${minX},${minY}`
      const scores = componentScores.get(key) ?? { slope: 0, curvature: 0, edge: 0, visibility: 0 }

      // Determine reason
      let reason: string
      if (scores.edge > 0.7) reason = 'Cliff edge — extreme drop-off'
      else if (scores.slope > 0.7) reason = `Steep slope (${cellSlope(grid, cluster[0].x, cluster[0].y, cellSizeM).toFixed(0)}°)`
      else if (scores.curvature > 0.5) reason = 'Exposed ridge — convex terrain'
      else reason = 'Combined terrain risk'

      zones.push({
        id: `fallrisk-${zoneId++}`,
        coords: [
          { lng: swLng + minX * lngStep, lat: neLat - minY * latStep },
          { lng: swLng + maxX * lngStep, lat: neLat - minY * latStep },
          { lng: swLng + maxX * lngStep, lat: neLat - maxY * latStep },
          { lng: swLng + minX * lngStep, lat: neLat - maxY * latStep },
        ],
        risk: maxRisk,
        level,
        reason,
        slopeScore: scores.slope,
        curvatureScore: scores.curvature,
        edgeScore: scores.edge,
        visibilityScore: scores.visibility,
      })
    }
  }

  return zones
}

function haversineMeters(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Main fall risk analysis.
 */
export async function analyzeFallRisk(req: FallRiskRequest): Promise<FallRiskResponse> {
  const { bounds, tripParams, demZoom } = req
  const zoom = demZoom ?? DEFAULT_ZOOM

  const { grid: rawGrid, width: rawWidth, height: rawHeight, cellSizeM: rawCellSizeM, swLng, neLat, lngStep: rawLngStep, latStep: rawLatStep } = await loadDemGrid(bounds, zoom)

  // Grid size cap: downsample if too large to prevent stack overflow + hangs
  const MAX_CELLS = 1_000_000
  const cellCount = rawWidth * rawHeight
  let grid = rawGrid
  let width = rawWidth
  let height = rawHeight
  let cellSizeM = rawCellSizeM
  let lngStep = rawLngStep
  let latStep = rawLatStep

  if (cellCount > MAX_CELLS) {
    const step = Math.ceil(Math.sqrt(cellCount / MAX_CELLS))
    const downsampled: (number | null)[][] = []
    for (let y = 0; y < rawHeight; y += step) {
      const row: (number | null)[] = []
      for (let x = 0; x < rawWidth; x += step) {
        row.push(rawGrid[y]?.[x] ?? null)
      }
      downsampled.push(row)
    }
    grid = downsampled
    height = downsampled.length
    width = downsampled[0]?.length ?? 0
    cellSizeM = rawCellSizeM * step
    lngStep = (neLat - swLng) / width // recalculate — note: swLng/neLat are bounds, not neLat
    // Correct lngStep/latStep for downsampled grid
    const [bsw, bne] = bounds
    lngStep = (bne.lng - bsw.lng) / width
    latStep = (bne.lat - bsw.lat) / height
  }

  // Derive visibility + ground conditions from trip params
  const visibilityFactor = tripParams
    ? (tripParams.timeOfDay === 'night' ? 0.4
      : tripParams.weather === 'extreme' ? 0.3
      : tripParams.weather === 'snow' ? 0.25
      : tripParams.weather === 'rain' ? 0.15
      : 0.05)
    : 0.05

  const groundSlipFactor = tripParams
    ? (tripParams.weather === 'rain' ? 1.3
      : tripParams.weather === 'snow' ? 1.5
      : tripParams.weather === 'extreme' ? 1.8
      : 1.0)
    : 1.0

  // Compute risk grid
  const riskGrid: number[][] = []
  const componentScores = new Map<string, { slope: number; curvature: number; edge: number; visibility: number }>()

  for (let y = 0; y < height; y++) {
    const row: number[] = []
    for (let x = 0; x < width; x++) {
      const { risk, slope, curvature, edge, visibility } = computeFallRisk(
        grid, x, y, cellSizeM, visibilityFactor, groundSlipFactor,
      )
      row.push(risk)
      if (risk > 0.3) {
        componentScores.set(`${x},${y}`, { slope, curvature, edge, visibility })
      }
    }
    riskGrid.push(row)
  }

  // Cluster into zones (threshold = 0.4 for medium+ risk)
  const zones = clusterRiskZones(
    riskGrid, 0.4, width, height, grid, cellSizeM,
    swLng, neLat, lngStep, latStep, componentScores,
  )

  return { zones, grid: riskGrid, bounds }
}
