/**
 * Route Planning Service — terrain-aware pathfinding.
 *
 * Finds the path of least resistance between two points, following terrain
 * the way a human would walk it: minimizing energy cost (slope + distance +
 * roughness), avoiding cliffs, preferring ridges or valleys where sensible.
 *
 * Algorithm: A* on the DEM grid with an energy-based cost function.
 *
 * Cost model (Tobler's hiking function + penalties):
 *  - Base cost = distance between cells
 *  - Slope penalty: uphill is expensive (exponential with steepness),
 *    downhill moderate (steeper downhill = more cost above 20°)
 *  - Cliff penalty: near-vertical drops are impassable
 *  - Roughness penalty: high local elevation variance = harder ground
 *  - Experience modifier: novices avoid steep terrain more
 *
 * For alternatives: add noise to the cost function and re-run A*,
 * producing different but still reasonable routes.
 *
 * Links to fall risk: each segment carries a fall risk score, and the
 * route response includes fall risk zones along the path.
 */

import type {
  RoutePlanRequest,
  RoutePlanResponse,
  PlannedRoute,
  RouteSegment,
  LngLat,
  TripParams,
  FallRiskZone,
  FallRiskLevel,
  RoutePreference,
  HikerProfile,
  CalibratedHikerModel,
} from '@shared/types'
import { demService } from './dem-service'
import { lngLatToTile, DEFAULT_ZOOM } from './dem-tiles'
import { computeOptimalZoom } from './dem-zoom'
import { deriveTripParams } from './trip-params'
import { calibrateHiker, assessClaimCredibility, maxReachRadius } from './hiker-profile'
import { fetchRoads, rasterizeRoads } from './road-service'
import { isWithinBounds } from '@shared/types'

/** Load DEM grid covering the bounding box (auto-zoom for large areas). */
async function loadDemGrid(
  bounds: [LngLat, LngLat],
  zoom: number,
): Promise<{ grid: (number | null)[][]; width: number; height: number; cellSizeM: number; swLng: number; neLat: number; lngStep: number; latStep: number }> {
  // Auto-reduce zoom for large areas instead of throwing an error
  const effectiveZoom = computeOptimalZoom(bounds, zoom, 32)
  const [sw, ne] = bounds
  const minTile = lngLatToTile(sw.lng, ne.lat, effectiveZoom)
  const maxTile = lngLatToTile(ne.lng, sw.lat, effectiveZoom)
  const tilesX = maxTile.x - minTile.x + 1
  const tilesY = maxTile.y - minTile.y + 1

  const tileGrids: (number | null)[][][][] = []
  let firstTileW = 0
  let firstTileH = 0

  for (let ty = 0; ty < tilesY; ty++) {
    tileGrids[ty] = []
    for (let tx = 0; tx < tilesX; tx++) {
      const tile = await demService.loadTile(minTile.x + tx, minTile.y + ty, effectiveZoom)
      tileGrids[ty][tx] = tile.grid
      if (ty === 0 && tx === 0) {
        firstTileW = tile.width
        firstTileH = tile.height
      }
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

  // Check we actually got data
  if (width === 0 || height === 0) {
    throw new Error('No elevation data available for this area.')
  }

  // Cap total cells — route planning needs finer resolution than other
  // analyses because the path quality depends on having enough waypoints
  // to follow terrain features. Allow up to 300k cells.
  const maxCells = 300000
  let step = 1
  if (width * height > maxCells) {
    step = Math.ceil(Math.sqrt((width * height) / maxCells))
  }

  let effectiveGrid = grid
  let effectiveWidth = width
  let effectiveHeight = height
  if (step > 1) {
    effectiveGrid = []
    for (let y = 0; y < height; y += step) {
      const row: (number | null)[] = []
      for (let x = 0; x < width; x += step) {
        row.push(grid[y]?.[x] ?? null)
      }
      effectiveGrid.push(row)
    }
    effectiveHeight = effectiveGrid.length
    effectiveWidth = effectiveGrid[0]?.length ?? 0
  }

  const latMid = (sw.lat + ne.lat) / 2
  const gridWidthM = haversineMeters(sw.lng, latMid, ne.lng, latMid)
  const cellSizeM = (gridWidthM / width) * step
  const lngStep = (ne.lng - sw.lng) / effectiveWidth
  const latStep = (ne.lat - sw.lat) / effectiveHeight

  return { grid: effectiveGrid, width: effectiveWidth, height: effectiveHeight, cellSizeM, swLng: sw.lng, neLat: ne.lat, lngStep, latStep }
}

/** Convert lng/lat to grid cell coordinates. */
function lngLatToCell(lng: number, lat: number, swLng: number, neLat: number, lngStep: number, latStep: number, width: number, height: number): { x: number; y: number } {
  const x = Math.min(width - 1, Math.max(0, Math.round((lng - swLng) / lngStep)))
  const y = Math.min(height - 1, Math.max(0, Math.round((neLat - lat) / latStep)))
  return { x, y }
}

/** Convert grid cell to lng/lat. */
function cellToLngLat(x: number, y: number, swLng: number, neLat: number, lngStep: number, latStep: number): LngLat {
  return { lng: swLng + x * lngStep, lat: neLat - y * latStep }
}

/**
 * Compute slope between two adjacent cells in degrees.
 */
function slopeBetween(grid: (number | null)[][], x1: number, y1: number, x2: number, y2: number, cellSizeM: number): number {
  const e1 = grid[y1]?.[x1]
  const e2 = grid[y2]?.[x2]
  if (e1 == null || e2 == null) return 0
  const dist = cellSizeM * Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
  if (dist === 0) return 0
  return (Math.atan2(Math.abs(e2 - e1), dist) * 180) / Math.PI
}

/**
 * Compute local roughness (elevation variance in 3x3 neighborhood).
 */
function localRoughness(grid: (number | null)[][], x: number, y: number): number {
  const vals: number[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const v = grid[y + dy]?.[x + dx]
      if (v != null) vals.push(v)
    }
  }
  if (vals.length < 2) return 0
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length
  return Math.sqrt(variance)
}

/**
 * Energy cost for moving from cell (x1,y1) to (x2,y2).
 *
 * Base model: Tobler's hiking function gives walking speed as:
 *   speed (km/h) = 6 * exp(-3.5 * |slope + 0.05|)
 * where slope = rise/run (positive = uphill).
 * Cost = time = distance / speed.
 *
 * The route preference modifies this base cost:
 *  - least-effort:   Pure Tobler. Uphill is slower but not prohibitive.
 *  - shortest:       Nearly ignore slope. Direct path, only cliffs block.
 *  - peak-ridge:     Uphill is CHEAPER (reward elevation gain toward peak).
 *                    Ridge cells get a bonus. Steep downhill penalized.
 *  - valley-contour: Penalize ALL elevation changes. Prefer flat traverses.
 *  - scenic-trail:   Balanced. Mild ridge preference, avoid steep both ways.
 */
function movementCost(
  grid: (number | null)[][],
  x1: number, y1: number, x2: number, y2: number,
  cellSizeM: number,
  impassableSlopeDeg: number,
  noise: number = 0,
  preference: RoutePreference = 'least-effort',
  roadGrid?: Float32Array | null,
  width?: number,
): number {
  const e1 = grid[y1]?.[x1]
  const e2 = grid[y2]?.[x2]
  if (e1 == null || e2 == null) return Infinity

  const dx = x2 - x1
  const dy = y2 - y1
  const dist = cellSizeM * Math.sqrt(dx * dx + dy * dy)
  if (dist === 0) return 0
  const dElev = e2 - e1
  const slopeDeg = (Math.atan2(Math.abs(dElev), dist) * 180) / Math.PI

  // Impassable above threshold (cliffs, near-vertical drops)
  if (slopeDeg > impassableSlopeDeg) return Infinity

  // Tobler's hiking function: speed in km/h
  const slopeRatio = dElev / dist // positive = uphill, negative = downhill
  const speedKmh = 6 * Math.exp(-3.5 * Math.abs(slopeRatio + 0.05))
  const flatSpeed = 6 * Math.exp(-3.5 * 0.05) // ~5.03 km/h on flat

  // Base time cost normalized so flat ≈ 1.0 * dist
  const baseTimeCost = (dist * 3.6) / speedKmh / ((3.6) / flatSpeed)

  // Roughness penalty (terrain difficulty independent of slope)
  const roughness = localRoughness(grid, x2, y2)
  const roughnessCost = dist * (roughness / 80)

  // Noise for alternative routes
  const noiseCost = noise * dist * (0.3 + Math.random() * 0.7)

  // ── Road preference ──
  // If a road/trail passes through the destination cell, the cost is
  // multiplied by the road's cost multiplier (0.15-0.50). This makes
  // A* strongly prefer following roads in urban/countryside areas.
  // In wilderness with no roads, this has no effect (all cells = 1.0).
  let roadMultiplier = 1.0
  if (roadGrid && width) {
    const roadCost = roadGrid[y2 * width + x2]
    if (roadCost < 1.0) {
      roadMultiplier = roadCost
    }
  }

  // ── Apply route preference modifier ──
  let slopeCost: number
  switch (preference) {
    case 'shortest': {
      // Nearly ignore slope — just distance + roughness + cliff check
      slopeCost = dist * (1 + slopeDeg / 60) // very mild slope factor
      break
    }
    case 'peak-ridge': {
      // Uphill is REWARDED (hiker wants to gain elevation toward peak).
      // Downhill is penalized (going the wrong way off a peak).
      // Ridge cells get a bonus.
      if (dElev > 0) {
        // Uphill: cheaper than Tobler — reward elevation gain
        // At 20° uphill: Tobler gives ~3.6x, we give ~1.5x
        slopeCost = dist * (1 + slopeDeg / 40)
      } else {
        // Downhill: penalize — you're descending away from the goal
        slopeCost = baseTimeCost * 1.5
      }
      // Ridge bonus: if destination cell is a local high, reduce cost
      const isRidge = isRidgeCell(grid, x2, y2)
      if (isRidge) slopeCost *= 0.7
      break
    }
    case 'valley-contour': {
      // Penalize ALL elevation changes — prefer traversing along contours
      // Both uphill and downhill are expensive. Valleys get a bonus.
      slopeCost = baseTimeCost * (1 + slopeDeg / 15)
      const isValley = isValleyCell(grid, x2, y2)
      if (isValley) slopeCost *= 0.75
      break
    }
    case 'scenic-trail': {
      // Balanced: mild Tobler, slight ridge preference, avoid steep both ways
      slopeCost = baseTimeCost
      // Extra penalty for steep in either direction (trails avoid steep)
      if (slopeDeg > 25) slopeCost *= 1.3
      // Mild ridge preference
      const isRidge = isRidgeCell(grid, x2, y2)
      if (isRidge) slopeCost *= 0.9
      break
    }
    case 'least-effort':
    default: {
      // Pure Tobler — uphill is slower but not prohibitive, gentle downhill
      // is slightly faster, steep downhill is harder. This naturally allows
      // uphill routes when they're shorter.
      slopeCost = baseTimeCost
      break
    }
  }

  return (slopeCost + roughnessCost + noiseCost) * roadMultiplier
}

/** Check if a cell is a local ridge (higher than most neighbors). */
function isRidgeCell(grid: (number | null)[][], x: number, y: number): boolean {
  const elev = grid[y]?.[x]
  if (elev == null) return false
  let higher = 0
  let count = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const n = grid[y + dy]?.[x + dx]
      if (n == null) continue
      count++
      if (n < elev) higher++
    }
  }
  return count > 0 && higher > count * 0.6
}

/** Check if a cell is a local valley (lower than most neighbors). */
function isValleyCell(grid: (number | null)[][], x: number, y: number): boolean {
  const elev = grid[y]?.[x]
  if (elev == null) return false
  let lower = 0
  let count = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const n = grid[y + dy]?.[x + dx]
      if (n == null) continue
      count++
      if (n > elev) lower++
    }
  }
  return count > 0 && lower > count * 0.6
}

/**
 * A* pathfinding on the DEM grid.
 * Uses a binary heap for the open set — O(log n) push/pop instead of O(n) scan.
 */
function astar(
  grid: (number | null)[][],
  width: number, height: number,
  startX: number, startY: number,
  endX: number, endY: number,
  cellSizeM: number,
  impassableSlopeDeg: number,
  noise: number = 0,
  preference: RoutePreference = 'least-effort',
  roadGrid?: Float32Array | null,
): { x: number; y: number }[] | null {
  // 8-directional movement
  const dx = [1, 1, 0, -1, -1, -1, 0, 1]
  const dy = [0, 1, 1, 1, 0, -1, -1, -1]

  const totalCells = width * height
  const gScore = new Float64Array(totalCells).fill(Infinity)
  const cameFrom = new Int32Array(totalCells).fill(-1)
  const closed = new Uint8Array(totalCells)
  const inOpen = new Uint8Array(totalCells)

  const startIdx = startY * width + startX
  const endIdx = endY * width + endX

  // Binary heap (min-heap by f-score)
  const heap: number[] = [] // stores cell indices
  const fScores = new Float64Array(totalCells).fill(Infinity)

  const heapPush = (idx: number) => {
    heap.push(idx)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (fScores[heap[i]] < fScores[heap[parent]]) {
        [heap[i], heap[parent]] = [heap[parent], heap[i]]
        i = parent
      } else break
    }
  }

  const heapPop = (): number => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      const n = heap.length
      while (true) {
        let smallest = i
        const l = 2 * i + 1
        const r = 2 * i + 2
        if (l < n && fScores[heap[l]] < fScores[heap[smallest]]) smallest = l
        if (r < n && fScores[heap[r]] < fScores[heap[smallest]]) smallest = r
        if (smallest !== i) {
          [heap[i], heap[smallest]] = [heap[smallest], heap[i]]
          i = smallest
        } else break
      }
    }
    return top
  }

  // Heuristic: straight-line distance (admissible)
  const heuristic = (x: number, y: number) =>
    cellSizeM * Math.sqrt((x - endX) ** 2 + (y - endY) ** 2)

  gScore[startIdx] = 0
  fScores[startIdx] = heuristic(startX, startY)
  heapPush(startIdx)
  inOpen[startIdx] = 1

  let iterations = 0
  const maxIterations = Math.min(totalCells * 4, 200000)

  while (heap.length > 0 && iterations < maxIterations) {
    iterations++

    const currentIdx = heapPop()
    inOpen[currentIdx] = 0

    if (currentIdx === endIdx) {
      // Reconstruct path
      const path: { x: number; y: number }[] = []
      let idx = currentIdx
      while (idx !== -1) {
        path.unshift({ x: idx % width, y: Math.floor(idx / width) })
        idx = cameFrom[idx]
      }
      return path
    }

    if (closed[currentIdx]) continue
    closed[currentIdx] = 1

    const cx = currentIdx % width
    const cy = Math.floor(currentIdx / width)

    for (let d = 0; d < 8; d++) {
      const nx = cx + dx[d]
      const ny = cy + dy[d]
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
      const nIdx = ny * width + nx
      if (closed[nIdx]) continue

      const cost = movementCost(grid, cx, cy, nx, ny, cellSizeM, impassableSlopeDeg, noise, preference, roadGrid, width)
      if (!isFinite(cost)) continue

      const tentativeG = gScore[currentIdx] + cost
      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = currentIdx
        gScore[nIdx] = tentativeG
        fScores[nIdx] = tentativeG + heuristic(nx, ny)
        if (!inOpen[nIdx]) {
          heapPush(nIdx)
          inOpen[nIdx] = 1
        }
      }
    }
  }

  return null // no path found
}

/**
 * Classify terrain type for a cell.
 */
function classifyTerrain(grid: (number | null)[][], x: number, y: number, width: number, height: number): RouteSegment['terrain'] {
  const elev = grid[y]?.[x]
  if (elev == null) return 'flat'

  // Check if ridge (higher than neighbors in most directions) or valley (lower)
  let higher = 0
  let lower = 0
  let count = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const n = grid[y + dy]?.[x + dx]
      if (n == null) continue
      count++
      if (n < elev) higher++
      else if (n > elev) lower++
    }
  }
  if (count === 0) return 'flat'
  if (higher > count * 0.6) return 'ridge'
  if (lower > count * 0.6) return 'valley'
  return 'slope'
}

/**
 * Compute fall risk for a cell (simplified — full fall risk service is separate).
 */
function cellFallRisk(grid: (number | null)[][], x: number, y: number, cellSizeM: number, visibilityFactor: number): number {
  const elev = grid[y]?.[x]
  if (elev == null) return 0

  // Slope-based risk
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

  // Slope risk: 0 below 20°, ramps to 1 at 50°+
  const slopeRisk = Math.max(0, Math.min(1, (maxSlope - 20) / 30))

  // Curvature: convex (ridge) = more exposure
  const roughness = localRoughness(grid, x, y)
  const curvatureRisk = Math.min(1, roughness / 30)

  // Visibility: low visibility increases risk
  const visibilityRisk = visibilityFactor

  return Math.min(1, slopeRisk * 0.6 + curvatureRisk * 0.2 + visibilityRisk * 0.2)
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
 * Smooth a grid path using Catmull-Rom spline interpolation.
 * A* on a grid produces angular paths with 45°/90° turns. This inserts
 * intermediate points between cells, producing a natural-looking curve
 * that follows the terrain without the stair-step pattern.
 *
 * The spline passes through all original A* waypoints but adds smooth
 * transitions between them, so the rendered route looks like a trail
 * rather than a grid path.
 */
function smoothPath(
  path: { x: number; y: number }[],
  grid: (number | null)[][],
  width: number, height: number,
  cellSizeM: number,
  swLng: number, neLat: number, lngStep: number, latStep: number,
): LngLat[] {
  if (path.length < 3) {
    return path.map((p) => cellToLngLat(p.x, p.y, swLng, neLat, lngStep, latStep))
  }

  // Convert grid cells to lng/lat
  const points = path.map((p) => {
    const ll = cellToLngLat(p.x, p.y, swLng, neLat, lngStep, latStep)
    return { x: ll.lng, y: ll.lat }
  })

  // Catmull-Rom spline: for each segment between points[i] and points[i+1],
  // generate intermediate points using the control points [i-1, i, i+1, i+2].
  // This produces a smooth curve that passes through every original point.
  const smoothed: LngLat[] = []
  const segmentsPerSpan = 4 // 4 intermediate points between each pair of original points

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(points.length - 1, i + 2)]

    for (let t = 0; t < segmentsPerSpan; t++) {
      const s = t / segmentsPerSpan
      // Catmull-Rom interpolation
      const s2 = s * s
      const s3 = s2 * s
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * s +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3
      )
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * s +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3
      )
      smoothed.push({ lng: x, lat: y })
    }
  }
  // Add the final point
  smoothed.push({ lng: points[points.length - 1].x, lat: points[points.length - 1].y })

  return smoothed
}

/**
 * Build a PlannedRoute from a grid path.
 */
function buildRoute(
  path: { x: number; y: number }[],
  grid: (number | null)[][],
  width: number, height: number,
  cellSizeM: number,
  swLng: number, neLat: number, lngStep: number, latStep: number,
  id: string,
  type: 'primary' | 'alternative',
  walkSpeedMps: number,
  impassableSlopeDeg: number,
  visibilityFactor: number,
): PlannedRoute {
  // Generate smoothed coordinates for rendering — this replaces the
  // angular grid path with a natural curve that looks like a trail.
  const coords = smoothPath(path, grid, width, height, cellSizeM, swLng, neLat, lngStep, latStep)
  const segments: RouteSegment[] = []
  const elevations: PlannedRoute['elevations'] = []
  let totalDistanceM = 0
  let totalCost = 0
  let maxFallRisk = 0

  // Use the original grid path for terrain analysis (elevation, slope, etc.)
  // but the smoothed path for rendering.
  for (let i = 0; i < path.length; i++) {
    const cell = path[i]
    const lngLat = cellToLngLat(cell.x, cell.y, swLng, neLat, lngStep, latStep)

    const elev = grid[cell.y]?.[cell.x] ?? null
    elevations.push({ lng: lngLat.lng, lat: lngLat.lat, elevation: elev, distance: totalDistanceM })

    if (i > 0) {
      const prev = path[i - 1]
      const segDist = cellSizeM * Math.sqrt((cell.x - prev.x) ** 2 + (cell.y - prev.y) ** 2)
      const slopeDeg = slopeBetween(grid, prev.x, prev.y, cell.x, cell.y, cellSizeM)
      const terrain = classifyTerrain(grid, cell.x, cell.y, width, height)
      const fallRisk = cellFallRisk(grid, cell.x, cell.y, cellSizeM, visibilityFactor)
      const cost = movementCost(grid, prev.x, prev.y, cell.x, cell.y, cellSizeM, impassableSlopeDeg)

      totalDistanceM += segDist
      totalCost += cost
      maxFallRisk = Math.max(maxFallRisk, fallRisk)

      // Add every Nth segment to avoid spamming the segment list
      const segInterval = Math.max(1, Math.floor(path.length / 50))
      if (i % segInterval === 0 || i === path.length - 1) {
        segments.push({
          coords: [cellToLngLat(prev.x, prev.y, swLng, neLat, lngStep, latStep), lngLat],
          cost,
          slopeDeg,
          terrain,
          fallRisk,
        })
      }
    }
  }

  const estimatedHours = totalDistanceM / (walkSpeedMps * 3600)

  return {
    id,
    type,
    coords,
    segments,
    totalDistanceM,
    totalCost,
    estimatedHours,
    maxFallRisk,
    hasDangerSections: maxFallRisk > 0.5,
    elevations,
  }
}

/**
 * Extract fall risk zones along the route.
 */
function extractRouteFallRiskZones(
  route: PlannedRoute,
  swLng: number, neLat: number, lngStep: number, latStep: number,
): FallRiskZone[] {
  const zones: FallRiskZone[] = []
  let zoneId = 0
  let currentZone: RouteSegment[] = []
  let zoneStartIdx = 0

  for (let i = 0; i < route.segments.length; i++) {
    const seg = route.segments[i]
    if (seg.fallRisk > 0.4) {
      if (currentZone.length === 0) zoneStartIdx = i
      currentZone.push(seg)
    } else if (currentZone.length > 0) {
      // End of danger zone
      if (currentZone.length >= 2) {
        const coords = currentZone.flatMap((s) => s.coords)
        const maxRisk = Math.max(...currentZone.map((s) => s.fallRisk))
        const level: FallRiskLevel = maxRisk > 0.7 ? 'extreme' : maxRisk > 0.5 ? 'high' : 'medium'
        zones.push({
          id: `fallrisk-${zoneId++}`,
          coords,
          risk: maxRisk,
          level,
          reason: `Slope ${currentZone[0].slopeDeg.toFixed(0)}°, ${currentZone[0].terrain} terrain`,
          slopeScore: maxRisk * 0.6,
          curvatureScore: maxRisk * 0.2,
          edgeScore: maxRisk * 0.1,
          visibilityScore: maxRisk * 0.1,
        })
      }
      currentZone = []
    }
  }

  // Don't forget trailing zone
  if (currentZone.length >= 2) {
    const coords = currentZone.flatMap((s) => s.coords)
    const maxRisk = Math.max(...currentZone.map((s) => s.fallRisk))
    const level: FallRiskLevel = maxRisk > 0.7 ? 'extreme' : maxRisk > 0.5 ? 'high' : 'medium'
    zones.push({
      id: `fallrisk-${zoneId++}`,
      coords,
      risk: maxRisk,
      level,
      reason: `Slope ${currentZone[0].slopeDeg.toFixed(0)}°, ${currentZone[0].terrain} terrain`,
      slopeScore: maxRisk * 0.6,
      curvatureScore: maxRisk * 0.2,
      edgeScore: maxRisk * 0.1,
      visibilityScore: maxRisk * 0.1,
    })
  }

  return zones
}

/**
 * Main route planning function.
 * When a hiker profile is provided, the route is calibrated against
 * known anchors and the hiker's psychology, producing a more realistic
 * reconstruction of their probable path.
 */
export async function planRoute(req: RoutePlanRequest): Promise<RoutePlanResponse> {
  const { start, end, bounds, tripParams, demZoom, includeAlternatives, routePreference, hikerProfile, mode } = req
  const analysisMode = mode || 'active-sar'
  const isLegacy = analysisMode === 'legacy-research'
  const zoom = demZoom ?? DEFAULT_ZOOM

  // Legacy mode: always include alternatives (trail network analysis)
  // Active SAR: only if explicitly requested (single corridor focus)
  const wantAlternatives = isLegacy || includeAlternatives

  // Load DEM grid
  const { grid, width, height, cellSizeM, swLng, neLat, lngStep, latStep } = await loadDemGrid(bounds, zoom)

  // Validate start/end are within bounds — clamp if slightly outside, reject only if way outside
  const tolerance = 0.01
  const [bsw, bne] = bounds
  const expandedBounds: [LngLat, LngLat] = [
    { lng: bsw.lng - tolerance, lat: bsw.lat - tolerance },
    { lng: bne.lng + tolerance, lat: bne.lat + tolerance },
  ]
  if (!isWithinBounds(start, expandedBounds)) {
    throw new Error('Start point is too far outside the drawn analysis area. Right-click within the bounding box.')
  }
  if (!isWithinBounds(end, expandedBounds)) {
    throw new Error('End point is too far outside the drawn analysis area. Shift+click within the bounding box.')
  }

  // Clamp start/end to the actual bounds so the grid lookup works
  const clampedStart: LngLat = {
    lng: Math.max(bsw.lng, Math.min(bne.lng, start.lng)),
    lat: Math.max(bsw.lat, Math.min(bne.lat, start.lat)),
  }
  const clampedEnd: LngLat = {
    lng: Math.max(bsw.lng, Math.min(bne.lng, end.lng)),
    lat: Math.max(bsw.lat, Math.min(bne.lat, end.lat)),
  }

  // ── Derive trip params and optionally calibrate hiker profile ──
  const effectiveTripParams = hikerProfile?.tripParams ?? tripParams
  const derived = effectiveTripParams ? deriveTripParams(effectiveTripParams) : null
  const baseSlopeDeg = derived?.impassableSlopeDeg ?? 35
  const baseWalkSpeed = derived?.walkSpeedMps ?? 1.11

  let preference: RoutePreference = routePreference ?? 'least-effort'
  let impassableSlopeDeg = baseSlopeDeg
  let walkSpeedMps = baseWalkSpeed
  let calibration: CalibratedHikerModel | undefined
  let credibility: RoutePlanResponse['credibility'] | undefined
  let reachRadius: RoutePlanResponse['reachRadius'] | undefined

  if (hikerProfile) {
    // Calibrate the hiker profile against known anchors
    calibration = calibrateHiker(hikerProfile, baseWalkSpeed, baseSlopeDeg)
    preference = calibration.routePreference
    impassableSlopeDeg = calibration.effectiveSlopeThreshold
    walkSpeedMps = calibration.actualWalkSpeedMps

    // Assess credibility of claimed trip time
    const straightDist = haversineMeters(start.lng, start.lat, end.lng, end.lat)
    credibility = assessClaimCredibility(hikerProfile, calibration, straightDist)

    // Compute search reach radius
    const hours = hikerProfile.claimedTripHours > 0
      ? hikerProfile.claimedTripHours * calibration.perceptionScale
      : calibration.totalTripHours
    const radius = maxReachRadius(calibration, hours)
    reachRadius = radius
  }

  // Visibility factor from trip params (night/fog = higher)
  const visibilityFactor = effectiveTripParams
    ? (effectiveTripParams.timeOfDay === 'night' ? 0.4 : effectiveTripParams.weather === 'extreme' ? 0.3 : 0.1)
    : 0.1

  // Convert start/end to grid cells (using clamped points)
  const startCell = lngLatToCell(clampedStart.lng, clampedStart.lat, swLng, neLat, lngStep, latStep, width, height)
  const endCell = lngLatToCell(clampedEnd.lng, clampedEnd.lat, swLng, neLat, lngStep, latStep, width, height)

  // ── Fetch OSM roads/trails and rasterize onto the grid ──
  // This lets A* follow roads in urban/countryside areas. In wilderness
  // with no roads, the road grid is all 1.0 (no effect on cost).
  // Failures are non-fatal — we just fall back to terrain-only routing.
  let roadGrid: Float32Array | null = null
  try {
    const roadRes = await fetchRoads(bounds)
    if (roadRes.segments.length > 0) {
      roadGrid = rasterizeRoads(
        roadRes.segments, width, height,
        swLng, neLat, lngStep, latStep,
      )
    }
  } catch {
    // Overpass may be down or rate-limited — continue without roads
  }

  // Run A* for primary route
  const primaryPath = astar(grid, width, height, startCell.x, startCell.y, endCell.x, endCell.y, cellSizeM, impassableSlopeDeg, 0, preference, roadGrid)

  if (!primaryPath) {
    throw new Error('No route found — terrain may be too steep or impassable between these points.')
  }

  const primary = buildRoute(
    primaryPath, grid, width, height, cellSizeM,
    swLng, neLat, lngStep, latStep,
    'route-primary', 'primary', walkSpeedMps, impassableSlopeDeg, visibilityFactor,
  )

  // Generate alternatives if requested (legacy mode: always, active SAR: only if requested)
  const alternatives: PlannedRoute[] = []
  if (wantAlternatives) {
    // Legacy mode: generate more alternatives for trail network analysis
    const altCount = isLegacy ? 4 : 2
    for (let i = 0; i < altCount; i++) {
      const altPath = astar(grid, width, height, startCell.x, startCell.y, endCell.x, endCell.y, cellSizeM, impassableSlopeDeg, 0.5 + i * 0.3, preference, roadGrid)
      if (altPath) {
        const alt = buildRoute(
          altPath, grid, width, height, cellSizeM,
          swLng, neLat, lngStep, latStep,
          `route-alt-${i}`, 'alternative', walkSpeedMps, impassableSlopeDeg, visibilityFactor,
        )
        // Only keep if it's meaningfully different from primary
        if (alt.totalCost > primary.totalCost * 0.8) {
          alternatives.push(alt)
        }
      }
    }
  }

  // Extract fall risk zones along the primary route
  const fallRiskZones = extractRouteFallRiskZones(primary, swLng, neLat, lngStep, latStep)

  return {
    primary,
    alternatives,
    fallRiskZones,
    bounds,
    calibration,
    credibility,
    reachRadius,
  }
}
