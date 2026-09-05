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

      // Compute convex hull of the cluster — follows the actual shape
      // of the risk area instead of drawing a rectangle that covers
      // unrelated safe terrain.
      const hullCells = convexHull(cluster.map((c) => ({ x: c.x, y: c.y })))
      let maxRisk = 0
      for (const c of cluster) {
        if (c.risk > maxRisk) maxRisk = c.risk
      }
      const level = classifyLevel(maxRisk)
      const key = `${cluster[0].x},${cluster[0].y}`
      const scores = componentScores.get(key) ?? { slope: 0, curvature: 0, edge: 0, visibility: 0 }

      // Determine reason
      let reason: string
      if (scores.edge > 0.7) reason = 'Cliff edge — extreme drop-off'
      else if (scores.slope > 0.7) reason = `Steep slope (${cellSlope(grid, cluster[0].x, cluster[0].y, cellSizeM).toFixed(0)}°)`
      else if (scores.curvature > 0.5) reason = 'Exposed ridge — convex terrain'
      else reason = 'Combined terrain risk'

      // Convert hull cells to lng/lat polygon
      const coords: LngLat[] = hullCells.map((c) => ({
        lng: swLng + c.x * lngStep,
        lat: neLat - c.y * latStep,
      }))
      // Close the ring
      coords.push(coords[0])

      zones.push({
        id: `fallrisk-${zoneId++}`,
        coords,
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

/**
 * Convex hull (Andrew's monotone chain) for a set of grid cells.
 * Returns the hull vertices in counter-clockwise order.
 */
function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length < 3) return points

  // Sort by x, then by y
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)

  // Remove duplicates
  const unique: { x: number; y: number }[] = []
  for (const p of sorted) {
    if (unique.length === 0 || unique[unique.length - 1].x !== p.x || unique[unique.length - 1].y !== p.y) {
      unique.push(p)
    }
  }

  if (unique.length < 3) return unique

  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  // Lower hull
  const lower: { x: number; y: number }[] = []
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  // Upper hull
  const upper: { x: number; y: number }[] = []
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

/**
 * Merge zones whose centroids are within `maxCellDist` grid cells of each other.
 * Combines their polygons into one and takes the highest risk score.
 */
function mergeNearbyZones(
  zones: FallRiskZone[],
  swLng: number, neLat: number,
  lngStep: number, latStep: number,
  maxCellDist: number,
): FallRiskZone[] {
  if (zones.length < 2) return zones

  // Compute centroid for each zone in grid coordinates
  const centroids = zones.map((z) => {
    let sumLng = 0, sumLat = 0
    for (const c of z.coords) { sumLng += c.lng; sumLat += c.lat }
    const n = z.coords.length || 1
    return {
      lng: sumLng / n,
      lat: sumLat / n,
      x: (sumLng / n - swLng) / lngStep,
      y: (neLat - sumLat / n) / latStep,
    }
  })

  // Union-find to group nearby zones
  const parent = zones.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  const maxDistSq = maxCellDist * maxCellDist
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const dx = centroids[i].x - centroids[j].x
      const dy = centroids[i].y - centroids[j].y
      if (dx * dx + dy * dy <= maxDistSq) {
        union(i, j)
      }
    }
  }

  // Group zones by their root
  const groups = new Map<number, number[]>()
  for (let i = 0; i < zones.length; i++) {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root)!.push(i)
  }

  // Merge each group into one zone
  const merged: FallRiskZone[] = []
  let id = 0
  for (const indices of groups.values()) {
    if (indices.length === 1) {
      const z = zones[indices[0]]
      merged.push({ ...z, id: `fallrisk-${id++}` })
      continue
    }

    // Combine all coords from all zones in the group
    const allCoords: LngLat[] = []
    let maxRisk = 0
    let bestLevel: FallRiskLevel = 'low'
    let bestReason = ''
    let slopeScore = 0, curvatureScore = 0, edgeScore = 0, visibilityScore = 0

    for (const idx of indices) {
      const z = zones[idx]
      allCoords.push(...z.coords)
      if (z.risk > maxRisk) {
        maxRisk = z.risk
        bestLevel = z.level
        bestReason = z.reason
      }
      slopeScore = Math.max(slopeScore, z.slopeScore)
      curvatureScore = Math.max(curvatureScore, z.curvatureScore)
      edgeScore = Math.max(edgeScore, z.edgeScore)
      visibilityScore = Math.max(visibilityScore, z.visibilityScore)
    }

    // Compute convex hull of all combined coords
    const hullPoints = allCoords.map((c) => ({
      x: (c.lng - swLng) / lngStep,
      y: (neLat - c.lat) / latStep,
    }))
    const hull = convexHull(hullPoints)
    const hullCoords: LngLat[] = hull.map((p) => ({
      lng: swLng + p.x * lngStep,
      lat: neLat - p.y * latStep,
    }))
    hullCoords.push(hullCoords[0]) // close ring

    merged.push({
      id: `fallrisk-${id++}`,
      coords: hullCoords,
      risk: maxRisk,
      level: bestLevel,
      reason: bestReason,
      slopeScore,
      curvatureScore,
      edgeScore,
      visibilityScore,
    })
  }

  return merged
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
  const { bounds, tripParams, demZoom, mode, routeCoords } = req
  const analysisMode = mode || 'active-sar'
  const isActiveSAR = analysisMode === 'active-sar'
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

  // In active SAR mode with a route, only compute risk near the corridor.
  // In legacy mode, scan the full bbox (where could someone have fallen anywhere).
  const corridorMask = isActiveSAR && routeCoords && routeCoords.length > 0
    ? buildCorridorMask(routeCoords, width, height, swLng, neLat, lngStep, latStep, 200)
    : null // null = scan everything

  for (let y = 0; y < height; y++) {
    const row: number[] = []
    for (let x = 0; x < width; x++) {
      // Skip cells outside corridor in active SAR mode
      if (corridorMask && !corridorMask[y]?.[x]) {
        row.push(0)
        continue
      }
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

  // Cluster into zones
  // Active SAR: threshold 0.4 (medium+ only — safety critical)
  // Legacy: threshold 0.3 (include lower risk — exploratory)
  const clusterThreshold = isActiveSAR ? 0.4 : 0.3
  const zones = clusterRiskZones(
    riskGrid, clusterThreshold, width, height, grid, cellSizeM,
    swLng, neLat, lngStep, latStep, componentScores,
  )

  return { zones, grid: riskGrid, bounds }
}

/**
 * Build a mask of grid cells within `corridorWidthM` of the route polyline.
 * Used in active SAR mode to constrain fall risk to the route corridor.
 */
function buildCorridorMask(
  routeCoords: LngLat[],
  width: number, height: number,
  swLng: number, neLat: number,
  lngStep: number, latStep: number,
  corridorWidthM: number,
): Uint8Array[] {
  const mask: Uint8Array[] = []
  for (let y = 0; y < height; y++) {
    mask.push(new Uint8Array(width))
  }

  const latPerM = 1 / 111320
  const corridorDeg = corridorWidthM * latPerM

  // For each route segment, mark cells within corridor width
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const a = routeCoords[i]
    const b = routeCoords[i + 1]

    // Bounding box of segment + corridor
    const minLng = Math.min(a.lng, b.lng) - corridorDeg
    const maxLng = Math.max(a.lng, b.lng) + corridorDeg
    const minLat = Math.min(a.lat, b.lat) - corridorDeg
    const maxLat = Math.max(a.lat, b.lat) + corridorDeg

    const xStart = Math.max(0, Math.floor((minLng - swLng) / lngStep))
    const xEnd = Math.min(width - 1, Math.ceil((maxLng - swLng) / lngStep))
    const yStart = Math.max(0, Math.floor((neLat - maxLat) / latStep))
    const yEnd = Math.min(height - 1, Math.ceil((neLat - minLat) / latStep))

    for (let y = yStart; y <= yEnd; y++) {
      for (let x = xStart; x <= xEnd; x++) {
        const cellLng = swLng + x * lngStep
        const cellLat = neLat - y * latStep
        // Distance from point to line segment
        const dist = pointToSegmentDist(cellLng, cellLat, a.lng, a.lat, b.lng, b.lat, latPerM)
        if (dist <= corridorWidthM) {
          mask[y][x] = 1
        }
      }
    }
  }

  return mask
}

/** Distance from point to line segment in meters. */
function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
  latPerM: number,
): number {
  const lngPerM = latPerM / Math.cos((py * Math.PI) / 180)
  const dx = (bx - ax) / lngPerM
  const dy = (by - ay) / latPerM
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) {
    const ddx = (px - ax) / lngPerM
    const ddy = (py - ay) / latPerM
    return Math.sqrt(ddx * ddx + ddy * ddy)
  }
  let t = (((px - ax) / lngPerM) * dx + ((py - ay) / latPerM) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const projX = ax + t * (bx - ax)
  const projY = ay + t * (by - ay)
  const ddx = (px - projX) / lngPerM
  const ddy = (py - projY) / latPerM
  return Math.sqrt(ddx * ddx + ddy * ddy)
}
